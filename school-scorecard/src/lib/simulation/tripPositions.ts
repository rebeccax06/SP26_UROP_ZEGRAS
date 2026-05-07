/**
 * Pure math for the bus-simulation page. No I/O, no React, no Mapbox.
 *
 * Inputs come from `buildTripsForDate.ts`. The page calls `locateTripAt` once
 * per trip per animation frame (~30 fps × 150 trips = ~4500 calls/sec, easy).
 *
 * Coordinate convention: every `[number, number]` is `[lon, lat]` (Mapbox order).
 * Times are seconds since service-day midnight (so 25:30:00 = 91800; GTFS lets
 * stop_times go past 24h for after-midnight trips).
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in meters between two [lon, lat] points. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface ShapeProjection {
  /** Original shape coordinates in [lon, lat] order. */
  coords: [number, number][];
  /** cumDist[i] = meters from coords[0] to coords[i] along the polyline. */
  cumDist: number[];
}

/**
 * Pre-compute cumulative distances along a polyline so we can interpolate
 * positions by "meters along shape" in O(log n).
 */
export function buildShapeProjection(coords: [number, number][]): ShapeProjection {
  const n = coords.length;
  const cumDist = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    cumDist[i] = cumDist[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!);
  }
  return { coords, cumDist };
}

/** Index of the shape point closest to `(lon, lat)` (linear scan, O(n)). */
function closestShapeIndex(shape: ShapeProjection, lon: number, lat: number): number {
  let best = 0;
  let bestSqDeg = Infinity;
  const { coords } = shape;
  for (let i = 0; i < coords.length; i++) {
    const sLon = coords[i]![0];
    const sLat = coords[i]![1];
    const d = (sLon - lon) ** 2 + (sLat - lat) ** 2;
    if (d < bestSqDeg) {
      bestSqDeg = d;
      best = i;
    }
  }
  return best;
}

/** Project a stop onto the shape and return its cumulative-distance value. */
export function projectStopDistance(shape: ShapeProjection, lon: number, lat: number): number {
  const idx = closestShapeIndex(shape, lon, lat);
  return shape.cumDist[idx]!;
}

/**
 * Position at `targetDist` meters along the shape (clamped to [0, totalDist]).
 * Uses a linear scan over cumDist; fine for a few thousand vertices.
 */
export function pointAtDistance(shape: ShapeProjection, targetDist: number): [number, number] {
  const { coords, cumDist } = shape;
  const total = cumDist[cumDist.length - 1] ?? 0;
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0]!;
  const t = Math.max(0, Math.min(total, targetDist));
  // Find segment i such that cumDist[i] <= t <= cumDist[i+1].
  let i = 0;
  while (i < cumDist.length - 1 && cumDist[i + 1]! < t) i++;
  const segStart = cumDist[i]!;
  const segEnd = cumDist[i + 1] ?? segStart;
  const segLen = segEnd - segStart;
  const f = segLen > 0 ? (t - segStart) / segLen : 0;
  const a = coords[i]!;
  const b = coords[i + 1] ?? a;
  return [a[0]! + f * (b[0]! - a[0]!), a[1]! + f * (b[1]! - a[1]!)];
}

// ---------------------------------------------------------------------------
// Trip timelines
// ---------------------------------------------------------------------------

/** A stop in a trip's scheduled (and possibly actual) timeline. */
export interface TripStopFrame {
  stopId: string;
  /** Distance along the shape, in meters from shape origin. */
  distAlongShape: number;
  /** Scheduled departure (or arrival) seconds since service-day midnight. */
  scheduledSec: number;
  /** Observed actual seconds since midnight, or null if not present in CSV. */
  actualSec: number | null;
}

export interface SimulationTrip {
  tripId: string;
  /** Original observed half_trip_id (or null when no observed match). */
  halfTripId: string | null;
  /** GTFS direction_id, "0" or "1". */
  directionId: string;
  /** Sorted by stop_sequence; first.distAlongShape == 0 is not guaranteed. */
  stops: TripStopFrame[];
  /** Cached for quick "is this trip active" checks. */
  firstSchedSec: number;
  lastSchedSec: number;
  /** First/last observed-actual seconds; null if no actuals at all. */
  firstActualSec: number | null;
  lastActualSec: number | null;
}

export type DotKind = 'scheduled' | 'actualKnown' | 'actualMissing';

export interface TripDot {
  kind: DotKind;
  position: [number, number];
}

export interface TripSnapshot {
  /** Trip identity for keying GeoJSON features. */
  tripId: string;
  directionId: string;
  scheduled: TripDot;
  actual: TripDot;
}

/**
 * Linear interpolation along time → distance. Used for both scheduled (dense
 * stops) and actual (sparse known timepoints).
 *
 * Returns null when t is outside [stops[0].t, stops[last].t] AND `clampOutside`
 * is false (used for actuals: we want a "no data yet" signal).
 *
 * `getTime` returns null for stops that have no time on this axis (used so the
 * actual axis can skip stops with `actualSec == null`).
 */
function interpolateOnTimeline(
  stops: TripStopFrame[],
  t: number,
  getTime: (s: TripStopFrame) => number | null,
  clampOutside: boolean,
): { distAlongShape: number; outOfRange: boolean } | null {
  // Compress to only the stops that have a time on this axis.
  const known: { d: number; t: number }[] = [];
  for (const s of stops) {
    const ts = getTime(s);
    if (ts != null) known.push({ d: s.distAlongShape, t: ts });
  }
  if (known.length === 0) return null;
  if (known.length === 1) {
    return { distAlongShape: known[0]!.d, outOfRange: t !== known[0]!.t };
  }
  const first = known[0]!;
  const last = known[known.length - 1]!;
  if (t <= first.t) {
    return clampOutside
      ? { distAlongShape: first.d, outOfRange: t < first.t }
      : { distAlongShape: first.d, outOfRange: t < first.t };
  }
  if (t >= last.t) {
    return clampOutside
      ? { distAlongShape: last.d, outOfRange: t > last.t }
      : { distAlongShape: last.d, outOfRange: t > last.t };
  }
  // Bracket-search.
  let lo = 0;
  let hi = known.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (known[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = known[lo]!;
  const b = known[hi]!;
  const dt = b.t - a.t;
  const f = dt > 0 ? (t - a.t) / dt : 0;
  return { distAlongShape: a.d + f * (b.d - a.d), outOfRange: false };
}

/**
 * Compute the scheduled and actual dot positions for a single trip at time `t`.
 *
 * Returns null when `t` is outside the trip's scheduled window (we don't draw
 * dots for trips that haven't started or already finished).
 */
export function locateTripAt(trip: SimulationTrip, shape: ShapeProjection, t: number): TripSnapshot | null {
  if (trip.stops.length < 2) return null;
  if (t < trip.firstSchedSec || t > trip.lastSchedSec) return null;

  const sched = interpolateOnTimeline(trip.stops, t, (s) => s.scheduledSec, true);
  if (!sched) return null;
  const scheduledPos = pointAtDistance(shape, sched.distAlongShape);

  // Actual dot: interpolate by time using only stops with actualSec != null.
  // Outside the known-actual window → "actualMissing" (gray) at clamp position.
  // No actuals at all → "actualMissing" overlaid on the scheduled position (since
  // we have no observed data for this trip, the gray dot rides with schedule).
  if (trip.firstActualSec == null || trip.lastActualSec == null) {
    return {
      tripId: trip.tripId,
      directionId: trip.directionId,
      scheduled: { kind: 'scheduled', position: scheduledPos },
      actual: { kind: 'actualMissing', position: scheduledPos },
    };
  }
  const actual = interpolateOnTimeline(trip.stops, t, (s) => s.actualSec, true);
  // actual is non-null because firstActualSec != null guarantees at least one
  // stop has actualSec.
  if (!actual) {
    return {
      tripId: trip.tripId,
      directionId: trip.directionId,
      scheduled: { kind: 'scheduled', position: scheduledPos },
      actual: { kind: 'actualMissing', position: scheduledPos },
    };
  }
  const actualPos = pointAtDistance(shape, actual.distAlongShape);
  const inWindow = t >= trip.firstActualSec && t <= trip.lastActualSec;
  return {
    tripId: trip.tripId,
    directionId: trip.directionId,
    scheduled: { kind: 'scheduled', position: scheduledPos },
    actual: { kind: inWindow ? 'actualKnown' : 'actualMissing', position: actualPos },
  };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Parse "H:MM:SS" or "HH:MM:SS" (GTFS allows H ≥ 24) to seconds since midnight. */
export function parseGtfsTimeSec(t: string): number {
  const m = t.match(/^(\d+):(\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10);
}

/** Format seconds since midnight back to "HH:MM:SS" (handles >24h). */
export function formatSecToHms(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

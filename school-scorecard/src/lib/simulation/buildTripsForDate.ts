/**
 * Server-side: assemble the per-trip timelines that the simulation page needs
 * for one route + one historical date.
 *
 * Single source of truth: the **MBTA archived bus arrival/departure CSV** for
 * `(routeId, date)`. Every trip's scheduled and actual timepoint times come
 * from rows on that calendar day — the same data lineage the heatmap uses for
 * on-time and bunching. This keeps the simulation aligned with the
 * visualization's purpose: comparing scheduled vs actual *for the date being
 * shown*, never a borrowed schedule from a different rating.
 *
 * GTFS is consulted only for **map geometry**:
 *  - `stops.txt`  → lat/lon for each timepoint's stop_id (animation positions).
 *  - `shapes.txt` → route polyline per direction (the line the dot follows).
 * Route shapes change rarely, so the bundled GTFS feed remains usable even
 * when its `calendar.txt` does not cover `date`.
 *
 * Each CSV `half_trip_id` becomes one `SimulationTrip` with timepoints sorted
 * by `time_point_order`. Trips with fewer than 2 valid timepoints (after
 * stop-coord lookup) are dropped — `tripPositions.locateTripAt` requires ≥ 2.
 *
 * CSV directions ("Inbound"/"Outbound") map to GTFS direction_id ("1"/"0")
 * via {@link CSV_DIR_TO_GTFS} so the right shape is picked.
 */

import fs from 'fs';
import { createInterface } from 'readline';

import { getMbtaBusArrivalCsvPath } from '@/lib/analysis/mbtaBusCsvPath';
import { getShapeCoordinatesForRouteDirection, loadGtfs } from '@/lib/gtfs/loadGtfs';
import {
  buildShapeProjection,
  projectStopDistance,
  type SimulationTrip,
  type ShapeProjection,
  type TripStopFrame,
} from './tripPositions';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// CSV → GTFS direction mapping (matches existing `route-headways/route.ts`).
const CSV_DIR_TO_GTFS: Record<string, string> = { Outbound: '0', Inbound: '1' };

interface ObservedTimepoint {
  stopId: string;
  scheduledSec: number;
  actualSec: number; // -1 if missing
  timePointOrder: number;
}

interface ObservedHalfTrip {
  halfTripId: string;
  csvDirection: string; // "Inbound" | "Outbound"
  gtfsDirection: string; // "0" | "1"
  timepoints: ObservedTimepoint[];
}

/** Date may arrive as YYYY-MM-DD or YYYYMMDD; CSV stores YYYY-MM-DD. */
function normalizeDateForCsv(date: string): string {
  if (/^\d{8}$/.test(date)) return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  return date;
}

// ---------------------------------------------------------------------------
// CSV scan: pull just the rows for (routeId, date), grouped by half_trip_id
// ---------------------------------------------------------------------------

async function loadObservedHalfTripsForRouteDate(
  routeId: string,
  date: string,
): Promise<ObservedHalfTrip[]> {
  const csvPath = getMbtaBusArrivalCsvPath();
  if (!csvPath) {
    if (DEBUG) console.warn('[simulation] No MBTA CSV path');
    return [];
  }
  const wantedDate = normalizeDateForCsv(date);

  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;
  const byHalfTrip = new Map<string, ObservedHalfTrip>();

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    const parts = line.split(',');
    if (parts.length < 13) continue;
    if (parts[0] !== wantedDate) continue;
    if (parts[1] !== routeId) continue;
    const standardType = parts[8];
    if (standardType !== 'Schedule' && standardType !== 'Headway') continue;

    const csvDirection = parts[2]!;
    const gtfsDirection = CSV_DIR_TO_GTFS[csvDirection];
    if (!gtfsDirection) continue;
    const halfTripId = parts[3]!;
    const stopId = parts[4]!;
    const timePointOrder = parseInt(parts[6]!, 10);
    if (Number.isNaN(timePointOrder)) continue;

    const scheduledSec = parseTimepointTsLocal(parts[9]!, wantedDate);
    if (scheduledSec < 0) continue;

    const actualTs = parts[10] ?? '';
    const actualSec = actualTs ? parseTimepointTsLocal(actualTs, wantedDate) : -1;

    let group = byHalfTrip.get(halfTripId);
    if (!group) {
      group = { halfTripId, csvDirection, gtfsDirection, timepoints: [] };
      byHalfTrip.set(halfTripId, group);
    }
    group.timepoints.push({ stopId, scheduledSec, actualSec, timePointOrder });
  }

  // Sort timepoints by order; dedup duplicates (Schedule + Headway rows for
  // the same timepoint can both appear — keep the one with an actual when
  // possible, else the first).
  const result: ObservedHalfTrip[] = [];
  for (const ht of Array.from(byHalfTrip.values())) {
    ht.timepoints.sort((a, b) => a.timePointOrder - b.timePointOrder);
    const dedup: ObservedTimepoint[] = [];
    for (const tp of ht.timepoints) {
      const prev = dedup[dedup.length - 1];
      if (prev && prev.timePointOrder === tp.timePointOrder) {
        if (prev.actualSec < 0 && tp.actualSec >= 0) prev.actualSec = tp.actualSec;
        continue;
      }
      dedup.push(tp);
    }
    ht.timepoints = dedup;
    if (ht.timepoints.length >= 1) result.push(ht);
  }
  if (DEBUG) console.log('[simulation] Observed half-trips:', result.length, 'for', routeId, date);
  return result;
}

/**
 * "1900-01-01T18:55:00Z" + service_date "2026-01-15" → seconds since midnight
 * America/New_York for that service day (with GTFS-style overflow past 24h).
 *
 * The MBTA CSV stores the time-of-day in UTC (the placeholder date 1900-01-01
 * is meaningless). To match the convention used elsewhere in the project we
 * convert to America/New_York. EST is UTC-5, EDT is UTC-4; we let `Intl` pick
 * the correct offset using the actual service_date.
 *
 * If the local calendar day ends up after the service date (e.g. a trip whose
 * scheduled timepoint is after midnight local), we add 24h so the value lines
 * up with GTFS's 25:00, 26:00, … convention.
 *
 * Returns -1 on parse failure.
 */
const localTzFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function parseTimepointTsLocal(ts: string, serviceDate: string): number {
  const m = ts.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return -1;
  const ymd = serviceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ymd) return -1;
  const utc = new Date(Date.UTC(
    parseInt(ymd[1]!, 10),
    parseInt(ymd[2]!, 10) - 1,
    parseInt(ymd[3]!, 10),
    parseInt(m[1]!, 10),
    parseInt(m[2]!, 10),
    parseInt(m[3]!, 10),
  ));
  const parts = localTzFmt.formatToParts(utc);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  let h = parseInt(pick('hour'), 10);
  if (h === 24) h = 0; // Intl quirk
  const min = parseInt(pick('minute'), 10);
  const s = parseInt(pick('second'), 10);
  let sec = h * 3600 + min * 60 + s;
  const localDate = `${pick('year')}-${pick('month')}-${pick('day')}`;
  if (localDate > serviceDate) sec += 86400;
  else if (localDate < serviceDate) sec -= 86400;
  return sec;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SimulationDataset {
  routeId: string;
  date: string;
  /** Per-direction shape coords [lon, lat][]. Keys: "0" | "1". */
  shapesByDirection: Record<string, [number, number][]>;
  trips: SimulationTrip[];
  /** Min/max scheduled sec across all trips, useful for the scrubber range. */
  minSchedSec: number;
  maxSchedSec: number;
  /**
   * Diagnostics. With CSV-as-source-of-truth, every observed half-trip becomes
   * a trip (when ≥ 2 timepoints have stop coords); `matchedTripCount` counts
   * trips that also have at least one observed actual time. `observedHalfTripCount`
   * is the raw CSV count for `(route, date)` before geometry filtering.
   */
  observedHalfTripCount: number;
  matchedTripCount: number;
}

export async function buildSimulationDataset(
  routeId: string,
  date: string,
): Promise<SimulationDataset> {
  const gtfs = await loadGtfs();

  // Pre-build shape projections per direction. Routes shapes change slowly, so
  // the bundled GTFS shape is fine even when its calendar doesn't cover `date`.
  const shapeProjByDir: Record<string, ShapeProjection> = {};
  const shapesByDirection: Record<string, [number, number][]> = {};
  for (const dir of ['0', '1']) {
    const coords = getShapeCoordinatesForRouteDirection(gtfs, routeId, dir);
    if (coords && coords.length >= 2) {
      shapeProjByDir[dir] = buildShapeProjection(coords);
      shapesByDirection[dir] = coords;
    }
  }

  const observed = await loadObservedHalfTripsForRouteDate(routeId, date);
  const trips: SimulationTrip[] = [];
  let matchedCount = 0;

  for (const half of observed) {
    const shape = shapeProjByDir[half.gtfsDirection];
    if (!shape) continue;

    const stops: TripStopFrame[] = [];
    for (const tp of half.timepoints) {
      const stopRow = gtfs.stops.get(tp.stopId);
      if (!stopRow) continue; // CSV stop_id missing from GTFS — can't position on map
      const lon = parseFloat(stopRow.stop_lon);
      const lat = parseFloat(stopRow.stop_lat);
      if (Number.isNaN(lon) || Number.isNaN(lat)) continue;
      stops.push({
        stopId: tp.stopId,
        distAlongShape: projectStopDistance(shape, lon, lat),
        scheduledSec: tp.scheduledSec,
        actualSec: tp.actualSec >= 0 ? tp.actualSec : null,
      });
    }
    if (stops.length < 2) continue;

    // Some MBTA shapes loop or backtrack at terminals. Clamp distAlongShape so
    // it monotonically advances along time_point_order (prevents the dot from
    // snapping backwards near terminals). Quickest fix: take running max.
    let runningMax = 0;
    for (const s of stops) {
      if (s.distAlongShape < runningMax) s.distAlongShape = runningMax;
      else runningMax = s.distAlongShape;
    }

    let firstActual: number | null = null;
    let lastActual: number | null = null;
    for (const s of stops) {
      if (s.actualSec == null) continue;
      if (firstActual == null || s.actualSec < firstActual) firstActual = s.actualSec;
      if (lastActual == null || s.actualSec > lastActual) lastActual = s.actualSec;
    }
    if (firstActual != null) matchedCount++;

    trips.push({
      tripId: half.halfTripId,
      halfTripId: half.halfTripId,
      directionId: half.gtfsDirection,
      stops,
      firstSchedSec: stops[0]!.scheduledSec,
      lastSchedSec: stops[stops.length - 1]!.scheduledSec,
      firstActualSec: firstActual,
      lastActualSec: lastActual,
    });
  }

  let minSchedSec = Number.POSITIVE_INFINITY;
  let maxSchedSec = Number.NEGATIVE_INFINITY;
  for (const t of trips) {
    if (t.firstSchedSec < minSchedSec) minSchedSec = t.firstSchedSec;
    if (t.lastSchedSec > maxSchedSec) maxSchedSec = t.lastSchedSec;
  }
  if (!Number.isFinite(minSchedSec)) minSchedSec = 5 * 3600;
  if (!Number.isFinite(maxSchedSec)) maxSchedSec = 26 * 3600;

  if (DEBUG) {
    console.log(
      '[simulation]',
      routeId,
      date,
      '·',
      observed.length,
      'observed half-trips ·',
      trips.length,
      'renderable trips ·',
      matchedCount,
      'with actuals',
    );
  }

  return {
    routeId,
    date,
    shapesByDirection,
    trips,
    minSchedSec,
    maxSchedSec,
    observedHalfTripCount: observed.length,
    matchedTripCount: matchedCount,
  };
}

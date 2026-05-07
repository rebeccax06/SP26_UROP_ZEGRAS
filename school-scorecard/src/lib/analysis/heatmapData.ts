/**
 * Heatmap data aggregation from MBTA Bus Arrival/Departure CSV.
 *
 * ────────────────────────────────────────────────────────────────
 * CSV SCHEMA (13 columns, comma-separated, first row is header)
 * ────────────────────────────────────────────────────────────────
 *  Col  Name                Description
 *  0    service_date        Service date, either YYYYMMDD or ISO string
 *  1    route_id            MBTA route identifier (e.g. "28", "66")
 *  2    direction_id        "0" (outbound) or "1" (inbound)
 *  3    half_trip_id        Unique identifier for a half-trip
 *  4    stop_id             Stop identifier (joins to GTFS stops.txt for display names)
 *  5    time_point_id       Time-point identifier
 *  6    time_point_order    Integer ordering stops along the route
 *  7    point_type          Type of point (e.g. "Midpoint", "Startpoint")
 *  8    standard_type       "Schedule" or "Headway"
 *  9    scheduled           Scheduled time (ISO with placeholder date: "1900-01-01THH:MM:SSZ")
 *  10   actual              Actual arrival time (same format, may be empty)
 *  11   scheduled_headway   Seconds between scheduled trips (populated for Schedule-standard)
 *  12   headway             Actual headway in seconds (populated for Headway-standard)
 *
 * ────────────────────────────────────────────────────────────────
 * ON-TIME DEFINITION (matches data-analysis.py)
 * ────────────────────────────────────────────────────────────────
 *  A trip observation at a stop is "on time" if:
 *    actual_seconds - scheduled_seconds ∈ [-60, +300]
 *  i.e. no more than 1 minute early, no more than 5 minutes late.
 *
 * ────────────────────────────────────────────────────────────────
 * HEATMAP AGGREGATION
 * ────────────────────────────────────────────────────────────────
 *  Rows = stops (ordered like data-analysis.py heatmap_stop_date: per (stop_id,
 *  direction_id) take min time_point_order, sort by direction_id then order,
 *  then unique stop_id preserving that order). Y-axis labels use stop_name from
 *  GTFS stops.txt when available, else stop_id (same as Python load_stop_names).
 *
 *  The MBTA CSV can list time-point rows at stops not on this route’s GTFS pattern. When GTFS
 *  loads and at least one aggregated cell matches a GTFS stop_id on the route, we keep only
 *  those stops; otherwise we keep the full CSV heatmap (CSV vs GTFS stop_id mismatch is common
 *  across feed versions).
 *
 *  Row order: **Route 28** — `getRoute28HeatmapYAxisStopIdsResolved()` (Mattapan→Ruggles corridor `stop_id` order + static tails).
 *  **Route 1** — `getRoute1HeatmapYAxisStopIdsFromGtfs()` (longest GTFS trip on route 1). Both use the
 *  same canonical row builder (full axis, grey cells when no cell, orphans at bottom).
 *  keeping only stops that have heatmap cells; any extra CSV stops append at the bottom. Other routes:
 *  when GTFS loads, median `stop_sequence` per direction, then merged (Ruggles-first heuristic). CSV-only
 *  stops fall back to time_point_order sort.
 *
 *  Columns = service dates (sorted chronologically)
 *  Cell value = on_time_rate for that (stop_id, service_date) group
 *    = count(on_time) / count(valid observations)
 *
 * ────────────────────────────────────────────────────────────────
 * DRILL-DOWN TRIP DETAIL
 * ────────────────────────────────────────────────────────────────
 *  For a selected (stop_id, service_date), return every raw CSV row
 *  matching that route + stop + date, with computed fields:
 *    - delaySec (actual - scheduled)
 *    - isOnTime (boolean)
 *
 * Rows are parsed with `parseCsvLine` from `loadGtfs.ts` (quoted fields) so column indices match pandas.read_csv.
 *
 * TODO: The scheduled/actual timestamps use a placeholder date
 * "1900-01-01". Overnight routes wrapping past midnight may have
 * ambiguous times. Additional normalization may be needed.
 */

import fs from 'fs';
import { createInterface } from 'readline';
import { getMbtaBusArrivalCsvPath } from '@/lib/analysis/mbtaBusCsvPath';
import { getRoute1HeatmapStopRankResolved, getRoute1HeatmapYAxisStopIdsFromGtfs } from '@/lib/analysis/route1HeatmapStopOrder';
import { getRoute28HeatmapStopRankResolved, getRoute28HeatmapYAxisStopIdsResolved } from '@/lib/analysis/route28HeatmapStopOrder';
import type { GtfsTrip } from '@/lib/gtfs/types';
import { getGtfsStopIdsOnRoutePattern } from '@/lib/gtfs/getGtfsStopIdsOnRoutePattern';
import { loadGtfs, loadGtfsStopIdToNameMap, parseCsvLine } from '@/lib/gtfs/loadGtfs';

const ON_TIME_EARLY_SEC = 60;
const ON_TIME_LATE_SEC = 300;
const MIN_SAMPLES = 5;

// ─── Types ───────────────────────────────────────────────────────

export interface HeatmapCell {
  stopId: string;
  serviceDate: string;
  onTimeRate: number;
  onTimeCount: number;
  totalTrips: number;
}

export interface HeatmapStop {
  stopId: string;
  /** From GTFS stops.txt stop_name when available (matches data-analysis.py). */
  stopName: string;
  directionId: string;
  timePointOrder: number;
}

export interface HeatmapPayload {
  routeId: string;
  csvPath: string | null;
  stops: HeatmapStop[];
  dates: string[];
  cells: HeatmapCell[];
}

export interface DrilldownTrip {
  serviceDate: string;
  routeId: string;
  directionId: string;
  halfTripId: string;
  stopId: string;
  timePointId: string;
  timePointOrder: number;
  pointType: string;
  standardType: string;
  scheduledTime: string;
  actualTime: string;
  scheduledSec: number;
  actualSec: number;
  delaySec: number;
  isOnTime: boolean;
  scheduledHeadway: number | null;
  actualHeadway: number | null;
}

export interface DrilldownPayload {
  routeId: string;
  stopId: string;
  /** GTFS stop_name when available. */
  stopName: string;
  serviceDate: string;
  trips: DrilldownTrip[];
}

// ─── Helpers ─────────────────────────────────────────────────────

function parseTimestampSec(ts: string): number {
  if (!ts) return -1;
  const m = ts.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    const spaceParts = ts.split(' ');
    if (spaceParts.length >= 2) {
      const timePart = spaceParts[1]!;
      const hms = timePart.split(':');
      if (hms.length >= 3) {
        const h = parseInt(hms[0]!, 10);
        const min = parseInt(hms[1]!, 10);
        const sec = parseFloat(hms[2]!);
        if (!isNaN(h) && !isNaN(min) && !isNaN(sec)) {
          return h * 3600 + min * 60 + sec;
        }
      }
    }
    return -1;
  }
  return parseInt(m[1]!, 10) * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10);
}

function formatSecondsAsTime(sec: number): string {
  if (sec < 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function serviceDateToIso(serviceDate: string): string {
  const s = serviceDate.trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return s;
}

function isOnTime(actualSec: number, scheduledSec: number): boolean {
  const diff = actualSec - scheduledSec;
  return diff >= -ON_TIME_EARLY_SEC && diff <= ON_TIME_LATE_SEC;
}

/** Normalize stop_id from CSV/GTFS so canonical lists and cell keys always match. */
function normHeatmapStopId(id: string): string {
  return String(id ?? '').trim();
}

/** Routes that rebuild the heatmap Y-axis from GTFS-backed canonical stop order (not CSV time-point sort). */
function usesCanonicalHeatmapRebuild(routeId: string): boolean {
  const id = normHeatmapStopId(routeId);
  return id === '28' || id === '1';
}

async function getCanonicalHeatmapYAxisStopIds(routeId: string): Promise<string[] | null> {
  const id = normHeatmapStopId(routeId);
  if (id === '28') return await getRoute28HeatmapYAxisStopIdsResolved();
  if (id === '1') return await getRoute1HeatmapYAxisStopIdsFromGtfs();
  return null;
}

async function getCanonicalHeatmapStopRank(routeId: string): Promise<Map<string, number> | null> {
  const id = normHeatmapStopId(routeId);
  if (id === '28') {
    const m = await getRoute28HeatmapStopRankResolved();
    return m.size > 0 ? m : null;
  }
  if (id === '1') {
    const m = await getRoute1HeatmapStopRankResolved();
    return m.size > 0 ? m : null;
  }
  return null;
}

// ─── Aggregation row for grouping ────────────────────────────────

interface RawRow {
  serviceDate: string;
  directionId: string;
  stopId: string;
  timePointOrder: number;
  scheduledSec: number;
  actualSec: number;
}

function medianOfNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * stop_id → display rank (0 = first row). Per GTFS direction_id, each stop’s rank along the
 * line is the median of its stop_sequence across all trips on the route (handles variants).
 * Directions are merged so a “Ruggles”-headed line is listed first when the first stop name
 * matches, then the other direction’s stops not already placed.
 */
async function getGtfsStopDisplayOrderRank(routeId: string): Promise<Map<string, number> | null> {
  const canonical = await getCanonicalHeatmapStopRank(routeId);
  if (canonical && canonical.size > 0) return canonical;

  try {
    const idx = await loadGtfs();
    const routeIdsToScan = new Set<string>([routeId]);
    for (const r of Array.from(idx.routes.values())) {
      if (r.route_short_name === routeId) routeIdsToScan.add(r.route_id);
    }
    const allTrips: GtfsTrip[] = [];
    for (const rid of Array.from(routeIdsToScan)) {
      const ts = idx.tripsByRoute.get(rid);
      if (ts) allTrips.push(...ts);
    }
    if (!allTrips.length) return null;

    // stop_id → sequences seen on trips with this (trip.direction_id)
    const seqByDirStop = new Map<string, number[]>();
    for (const t of allTrips) {
      const d = t.direction_id ?? '';
      const sts = idx.stopTimesByTrip.get(t.trip_id);
      if (!sts?.length) continue;
      for (const st of sts) {
        const sid = st.stop_id;
        if (!sid) continue;
        const seq = parseInt(String(st.stop_sequence), 10);
        const n = Number.isFinite(seq) ? seq : 0;
        const key = `${d}\t${sid}`;
        let arr = seqByDirStop.get(key);
        if (!arr) {
          arr = [];
          seqByDirStop.set(key, arr);
        }
        arr.push(n);
      }
    }
    if (seqByDirStop.size === 0) return null;

    const dirIds = new Set<string>();
    for (const k of Array.from(seqByDirStop.keys())) {
      dirIds.add(k.split('\t')[0] ?? '');
    }

    interface Chain {
      directionId: string;
      stops: string[];
      firstName: string;
    }
    const chains: Chain[] = [];

    for (const dir of Array.from(dirIds.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const medians: { stopId: string; m: number }[] = [];
      for (const [key, seqs] of Array.from(seqByDirStop.entries())) {
        const tab = key.indexOf('\t');
        if (tab < 0) continue;
        const d = key.slice(0, tab);
        if (d !== dir) continue;
        const stopId = key.slice(tab + 1);
        medians.push({ stopId, m: medianOfNumbers(seqs) });
      }
      medians.sort((a, b) => (a.m !== b.m ? a.m - b.m : a.stopId.localeCompare(b.stopId)));
      const stops = medians.map((x) => x.stopId);
      if (stops.length === 0) continue;
      const firstSid = stops[0] ?? '';
      const firstStop = idx.stops.get(firstSid);
      const firstName = (firstStop?.stop_name ?? '').trim();
      chains.push({ directionId: dir, stops, firstName });
    }

    if (!chains.length) return null;

    chains.sort((a, b) => {
      const aR = /Ruggles/i.test(a.firstName) ? 0 : 1;
      const bR = /Ruggles/i.test(b.firstName) ? 0 : 1;
      if (aR !== bR) return aR - bR;
      const aM = /Mattapan/i.test(a.firstName) ? 1 : 0;
      const bM = /Mattapan/i.test(b.firstName) ? 1 : 0;
      if (aM !== bM) return aM - bM;
      return a.directionId.localeCompare(b.directionId, undefined, { numeric: true });
    });

    const rank = new Map<string, number>();
    let r = 0;
    for (const ch of chains) {
      for (const sid of ch.stops) {
        if (!rank.has(sid)) {
          rank.set(sid, r);
          r++;
        }
      }
    }
    return rank.size > 0 ? rank : null;
  } catch {
    return null;
  }
}

// ─── Main loading functions ──────────────────────────────────────

/**
 * Load the heatmap grid: (stop × date) → on_time_rate.
 * Matches the logic of data-analysis.py heatmap_stop_date(), with optional GTFS pattern filter.
 */
export async function loadHeatmapData(routeId: string): Promise<HeatmapPayload> {
  const csvPath = getMbtaBusArrivalCsvPath();
  if (!csvPath) {
    return { routeId, csvPath: null, stops: [], dates: [], cells: [] };
  }

  const rows: RawRow[] = [];

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    const parts = parseCsvLine(line);
    if (parts.length < 13) continue;
    if (normHeatmapStopId(parts[1] ?? '') !== normHeatmapStopId(routeId)) continue;

    const standardType = parts[8];
    if (standardType !== 'Schedule' && standardType !== 'Headway') continue;

    const scheduledSec = parseTimestampSec(parts[9] ?? '');
    const actualSec = parseTimestampSec(parts[10] ?? '');
    if (scheduledSec < 0 || actualSec < 0) continue;

    const serviceDate = serviceDateToIso(parts[0]!);
    const directionId = normHeatmapStopId(parts[2] ?? '');
    const stopId = normHeatmapStopId(parts[4] ?? '');
    const timePointOrder = parseInt(parts[6]!, 10);

    rows.push({
      serviceDate,
      directionId,
      stopId,
      timePointOrder: isNaN(timePointOrder) ? 0 : timePointOrder,
      scheduledSec,
      actualSec,
    });
  }

  if (rows.length === 0) {
    return { routeId, csvPath, stops: [], dates: [], cells: [] };
  }

  // Stop order matches data-analysis.py heatmap_stop_date: group (stop_id, direction_id)
  // → min time_point_order, sort by direction_id then time_point_order, then unique stop_id.
  const pairMinOrder = new Map<string, { stopId: string; directionId: string; minOrder: number }>();
  for (const r of rows) {
    const key = `${r.stopId}\t${r.directionId}`;
    const cur = pairMinOrder.get(key);
    if (!cur || r.timePointOrder < cur.minOrder) {
      pairMinOrder.set(key, { stopId: r.stopId, directionId: r.directionId, minOrder: r.timePointOrder });
    }
  }
  const sortedPairs = Array.from(pairMinOrder.values()).sort((a, b) => {
    if (a.directionId !== b.directionId) return a.directionId.localeCompare(b.directionId);
    return a.minOrder - b.minOrder;
  });
  const seenStop = new Set<string>();
  const stopOrderIds: string[] = [];
  for (const p of sortedPairs) {
    if (seenStop.has(p.stopId)) continue;
    seenStop.add(p.stopId);
    stopOrderIds.push(p.stopId);
  }

  const gtfsOrderRank = await getGtfsStopDisplayOrderRank(routeId);
  if (!usesCanonicalHeatmapRebuild(routeId) && gtfsOrderRank && gtfsOrderRank.size > 0) {
    stopOrderIds.sort((a, b) => {
      const ra = gtfsOrderRank.get(a);
      const rb = gtfsOrderRank.get(b);
      if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
      if (ra !== undefined && rb === undefined) return -1;
      if (ra === undefined && rb !== undefined) return 1;
      const pa = sortedPairs.find((p) => p.stopId === a);
      const pb = sortedPairs.find((p) => p.stopId === b);
      if (pa && pb) {
        if (pa.directionId !== pb.directionId) return pa.directionId.localeCompare(pb.directionId);
        return pa.minOrder - pb.minOrder;
      }
      return a.localeCompare(b);
    });
  }

  const stopNames = await loadGtfsStopIdToNameMap();
  const stops: HeatmapStop[] = stopOrderIds.map((stopId) => {
    const pair = sortedPairs.find((p) => p.stopId === stopId);
    const name = stopNames.get(stopId) ?? stopId;
    return {
      stopId,
      stopName: name,
      directionId: pair?.directionId ?? '',
      timePointOrder: pair?.minOrder ?? 0,
    };
  });

  // Aggregate per (stopId, serviceDate)
  const cellKey = (stopId: string, date: string) => `${stopId}\t${date}`;
  const cellMap = new Map<string, { onTimeCount: number; total: number; stopId: string; date: string }>();

  for (const r of rows) {
    const key = cellKey(r.stopId, r.serviceDate);
    let cell = cellMap.get(key);
    if (!cell) {
      cell = { onTimeCount: 0, total: 0, stopId: r.stopId, date: r.serviceDate };
      cellMap.set(key, cell);
    }
    cell.total++;
    if (isOnTime(r.actualSec, r.scheduledSec)) {
      cell.onTimeCount++;
    }
  }

  const cells: HeatmapCell[] = [];
  for (const c of Array.from(cellMap.values())) {
    if (c.total < MIN_SAMPLES) continue;
    cells.push({
      stopId: c.stopId,
      serviceDate: c.date,
      onTimeRate: c.onTimeCount / c.total,
      onTimeCount: c.onTimeCount,
      totalTrips: c.total,
    });
  }

  // Intersect with GTFS route pattern only when some aggregated cells survive. If CSV stop_ids
  // do not match GTFS (different feed/version), filteredCells is empty while filteredStops could
  // still be non-empty — applying would wipe the whole heatmap.
  const patternStopIds = await getGtfsStopIdsOnRoutePattern(routeId);
  let stopsOut = stops;
  let cellsOut = cells;
  if (patternStopIds) {
    const patternNorm = new Set(Array.from(patternStopIds).map(normHeatmapStopId));
    const filteredCells = cells.filter((c) => patternNorm.has(normHeatmapStopId(c.stopId)));
    if (filteredCells.length > 0) {
      const stopIdsWithCell = new Set(filteredCells.map((c) => normHeatmapStopId(c.stopId)));
      stopsOut = stops.filter((s) => stopIdsWithCell.has(normHeatmapStopId(s.stopId)));
      cellsOut = filteredCells;
    }
  }

  const dates = Array.from(new Set(cellsOut.map((c) => c.serviceDate))).sort();

  // Routes 28 & 1: fixed GTFS-backed Y-axis (same row builder as route 28 corridor heatmap).
  if (usesCanonicalHeatmapRebuild(routeId)) {
    const yAxisStopIds = await getCanonicalHeatmapYAxisStopIds(routeId);
    if (yAxisStopIds?.length) {
      stopsOut = buildCanonicalHeatmapStops(cellsOut, sortedPairs, stopNames, yAxisStopIds);
    }
  }

  return { routeId, csvPath, stops: stopsOut, dates, cells: cellsOut };
}

/**
 * Canonical-route heatmap rows (routes 1 & 28): walk `yAxisStopIds` top-to-bottom in fixed order.
 * Every axis stop is shown (grey cells when no aggregated cell). Extra CSV stop_ids not on this
 * axis are appended at the bottom only.
 */
function buildCanonicalHeatmapStops(
  cellsOut: HeatmapCell[],
  sortedPairs: { stopId: string; directionId: string; minOrder: number }[],
  stopNames: Map<string, string>,
  yAxisStopIds: string[],
): HeatmapStop[] {
  const present = new Set(cellsOut.map((c) => normHeatmapStopId(c.stopId)));
  const canonicalList = yAxisStopIds.map(normHeatmapStopId);
  const canonicalSet = new Set(canonicalList);
  const pairFor = (stopId: string) =>
    sortedPairs.find((p) => normHeatmapStopId(p.stopId) === stopId);

  const ordered: HeatmapStop[] = [];
  for (const stopId of canonicalList) {
    const pair = pairFor(stopId);
    ordered.push({
      stopId,
      stopName: stopNames.get(stopId) ?? stopId,
      directionId: pair?.directionId ?? '',
      timePointOrder: pair?.minOrder ?? 0,
    });
  }

  const minOrderForStop = (stopId: string): number => {
    let m = Number.POSITIVE_INFINITY;
    for (const p of sortedPairs) {
      if (normHeatmapStopId(p.stopId) === stopId) m = Math.min(m, p.minOrder);
    }
    return Number.isFinite(m) ? m : 999999;
  };
  const orphans = Array.from(present)
    .filter((id) => !canonicalSet.has(id))
    .sort((a, b) => {
      const oa = minOrderForStop(a);
      const ob = minOrderForStop(b);
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  for (const stopId of orphans) {
    const pair = pairFor(stopId);
    ordered.push({
      stopId,
      stopName: stopNames.get(stopId) ?? stopId,
      directionId: pair?.directionId ?? '',
      timePointOrder: pair?.minOrder ?? 0,
    });
  }
  return ordered;
}

/**
 * On-time rate per stop for one service date, using the same rules as the interactive heatmap
 * (`loadHeatmapData`): Schedule/Headway rows only, valid scheduled+actual times, on-time
 * window [-60s, +300s], min 5 observations per stop, optional GTFS route
 * pattern filter when it would not wipe all data.
 *
 * Direction is not split (same as heatmap cells: one rate per stop_id for that date).
 * Used by `/api/route-headways` when a calendar date is selected so map "on-time" coloring
 * matches the heatmap for that day.
 */
export async function loadHeatmapAlignedOnTimeByStopForDate(
  routeId: string,
  serviceDateIso: string,
): Promise<Map<string, { onTimeRate: number; nObs: number }>> {
  const csvPath = getMbtaBusArrivalCsvPath();
  const empty = new Map<string, { onTimeRate: number; nObs: number }>();
  if (!csvPath) return empty;

  const normalizedDate = serviceDateToIso(serviceDateIso);
  const counts = new Map<string, { onTime: number; total: number }>();

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const parts = parseCsvLine(line);
    if (parts.length < 13) continue;
    if (normHeatmapStopId(parts[1] ?? '') !== normHeatmapStopId(routeId)) continue;

    const rowDate = serviceDateToIso(parts[0]!);
    if (rowDate !== normalizedDate) continue;

    const standardType = parts[8];
    if (standardType !== 'Schedule' && standardType !== 'Headway') continue;

    const scheduledSec = parseTimestampSec(parts[9] ?? '');
    const actualSec = parseTimestampSec(parts[10] ?? '');
    if (scheduledSec < 0 || actualSec < 0) continue;

    const stopId = normHeatmapStopId(parts[4] ?? '');
    let cell = counts.get(stopId);
    if (!cell) {
      cell = { onTime: 0, total: 0 };
      counts.set(stopId, cell);
    }
    cell.total++;
    if (isOnTime(actualSec, scheduledSec)) cell.onTime++;
  }

  const raw = new Map<string, { onTimeRate: number; nObs: number }>();
  for (const [stopId, { onTime, total }] of Array.from(counts.entries())) {
    if (total < MIN_SAMPLES) continue;
    raw.set(stopId, { onTimeRate: onTime / total, nObs: total });
  }

  const patternStopIds = await getGtfsStopIdsOnRoutePattern(routeId);
  if (patternStopIds && raw.size > 0) {
    const patternNorm = new Set(Array.from(patternStopIds).map(normHeatmapStopId));
    const filtered = new Map<string, { onTimeRate: number; nObs: number }>();
    for (const [stopId, v] of Array.from(raw.entries())) {
      if (patternNorm.has(normHeatmapStopId(stopId))) filtered.set(stopId, v);
    }
    if (filtered.size > 0) return filtered;
  }

  return raw;
}

/**
 * Load trip-level detail for a specific (route, stop, date) combination.
 * Used for the drill-down view when a heatmap cell is clicked.
 */
export async function loadHeatmapDrilldown(
  routeId: string,
  stopId: string,
  serviceDate: string,
): Promise<DrilldownPayload> {
  const csvPath = getMbtaBusArrivalCsvPath();
  const stopNames = await loadGtfsStopIdToNameMap();
  const sid = normHeatmapStopId(stopId);
  const resolvedStopName = stopNames.get(sid) ?? sid;
  if (!csvPath) {
    return { routeId, stopId: sid, stopName: resolvedStopName, serviceDate, trips: [] };
  }

  const trips: DrilldownTrip[] = [];
  const normalizedDate = serviceDateToIso(serviceDate);

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    const parts = parseCsvLine(line);
    if (parts.length < 13) continue;
    if (normHeatmapStopId(parts[1] ?? '') !== normHeatmapStopId(routeId)) continue;

    const rowDate = serviceDateToIso(parts[0]!);
    if (rowDate !== normalizedDate) continue;
    if (normHeatmapStopId(parts[4] ?? '') !== sid) continue;

    const standardType = parts[8] ?? '';
    if (standardType !== 'Schedule' && standardType !== 'Headway') continue;

    const scheduledSec = parseTimestampSec(parts[9] ?? '');
    const actualSec = parseTimestampSec(parts[10] ?? '');

    const schedHw = parts[11] ? parseInt(parts[11], 10) : null;
    const actHw = parts[12] ? parseInt(parts[12], 10) : null;
    const timePointOrder = parseInt(parts[6]!, 10);

    const delaySec = (scheduledSec >= 0 && actualSec >= 0) ? actualSec - scheduledSec : 0;

    trips.push({
      serviceDate: normalizedDate,
      routeId,
      directionId: parts[2]!,
      halfTripId: parts[3]!,
      stopId: sid,
      timePointId: parts[5] ?? '',
      timePointOrder: isNaN(timePointOrder) ? 0 : timePointOrder,
      pointType: parts[7] ?? '',
      standardType,
      scheduledTime: scheduledSec >= 0 ? formatSecondsAsTime(scheduledSec) : '',
      actualTime: actualSec >= 0 ? formatSecondsAsTime(actualSec) : '',
      scheduledSec,
      actualSec,
      delaySec,
      isOnTime: (scheduledSec >= 0 && actualSec >= 0) ? isOnTime(actualSec, scheduledSec) : false,
      scheduledHeadway: (schedHw !== null && !isNaN(schedHw)) ? schedHw : null,
      actualHeadway: (actHw !== null && !isNaN(actHw)) ? actHw : null,
    });
  }

  trips.sort((a, b) => a.scheduledSec - b.scheduledSec);

  return { routeId, stopId: sid, stopName: resolvedStopName, serviceDate, trips };
}

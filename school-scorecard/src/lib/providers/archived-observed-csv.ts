/**
 * MBTA Bus Arrival/Departure CSV provider.
 *
 * Two types of rows in the CSV:
 *
 *  • standard_type = "Schedule"  → scheduled_headway is populated, headway is null
 *    (these are schedule-based routes; scheduled gap comes from the column)
 *
 *  • standard_type = "Headway"   → headway is populated, scheduled_headway is null
 *    (these are headway-based routes; we compute the scheduled gap ourselves from
 *    consecutive scheduled departure times within the same stop+direction+date)
 *
 * CSV columns (0-indexed):
 *   0  service_date
 *   1  route_id
 *   2  direction_id
 *   3  half_trip_id
 *   4  stop_id
 *   5  time_point_id
 *   6  time_point_order
 *   7  point_type
 *   8  standard_type
 *   9  scheduled         (ISO placeholder "1900-01-01T…Z"; only time part matters)
 *  10  actual
 *  11  scheduled_headway (seconds; null for Headway-standard trips)
 *  12  headway           (seconds; null for Schedule-standard or endpoint trips)
 */

import fs from 'fs';
import { createInterface } from 'readline';

import { getMbtaBusArrivalCsvPath } from '@/lib/analysis/mbtaBusCsvPath';
import type { ArchivedObservedProvider, ArchivedObservedOptions } from './archived-observed';
import type { ArchivedObservedResult } from '@/lib/types';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

// ---------------------------------------------------------------------------
// Internal data structures
// ---------------------------------------------------------------------------

interface HeadwayRecord {
  scheduledHeadwaySec: number;  // 0 if not available (first trip of day)
  actualHeadwaySec: number;
  localHour: number;
  scheduledSec: number;
  prevScheduledSec: number; // <=0 means no previous trip in that stop+direction+date sequence
  date: string;
  directionId: string;
  timePointOrder: number;
}

export interface CsvRouteStopData {
  stopId: string;
  directionId: string;
  timePointOrder: number;
  scheduledMedianMin: number;   // 0 if not computable
  actualMedianMin: number;
  ratio: number;
  sampleCount: number;
}

type HeadwayIndex = Map<string, HeadwayRecord[]>;

interface IndexResult {
  index: HeadwayIndex;
  dates: string[];
}

let indexPromise: Promise<IndexResult> | null = null;

// Permanent memo for fetchArchivedMetrics results keyed by
// "routeId:stopId:date:startTime:endTime". Since the CSV is static historical
// data, a computed result for any given (route, stop, date, window) never changes.
const metricsCache = new Map<string, ArchivedObservedResult | null>();

/** Clear cached index and metrics (useful after code changes in dev) */
export function clearArchivedCsvCache(): void {
  indexPromise = null;
  metricsCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLocalHour(ts: string): number {
  const m = ts.match(/T(\d{2}):(\d{2}):/);
  if (!m) return -1;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}

/** Seconds since midnight from a timestamp like "1900-01-01T08:59:00Z". */
function parseScheduledSec(ts: string): number {
  const m = ts.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

/** Parse "HH:MM" to fractional hours (e.g. "07:30" → 7.5). */
function parseHhMm(t: string): number {
  const parts = t.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  return h + m / 60;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function p25(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0]!;
}

function p75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1]!;
}

function dateToNum(d: string): number {
  return parseInt(d.replace(/-/g, ''), 10);
}

// ---------------------------------------------------------------------------
// CSV loading — lazy singleton, two-pass for Headway-standard routes
// ---------------------------------------------------------------------------

/**
 * Raw trip record stored in the first pass.
 */
interface RawTripRecord {
  scheduledSec: number;           // scheduled departure time in seconds since midnight
  actualSec: number;              // actual arrival time in seconds since midnight, or -1 if absent
  actualHeadwaySec: number;       // actual gap (headway column), or -1 if absent
  csvScheduledHeadwaySec: number; // direct from CSV column, or -1 if absent
  localHour: number;
  date: string;
  directionId: string;
  timePointOrder: number;
  standardType: 'Schedule' | 'Headway';
}

function loadIndex(): Promise<IndexResult> {
  if (indexPromise) return indexPromise;
  indexPromise = (async (): Promise<IndexResult> => {
    const csvPath = getMbtaBusArrivalCsvPath();
    if (!csvPath) {
      console.warn('[ArchivedCSV] MBTA bus CSV not found (set MBTA_BUS_ARRIVAL_CSV or place file under data/mbta-bus/)');
      return { index: new Map(), dates: [] };
    }

    // --- First pass: collect raw trip records keyed by "routeId:stopId:directionId:date" ---
    const rawByStopDirDate = new Map<string, RawTripRecord[]>();

    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    let rawCount = 0;

    for await (const line of rl) {
      if (isHeader) { isHeader = false; continue; }
      const parts = line.split(',');
      if (parts.length < 13) continue;

      const standardType = parts[8];
      if (standardType !== 'Schedule' && standardType !== 'Headway') continue;

      const scheduledTs = parts[9]!;
      const scheduledSec = parseScheduledSec(scheduledTs);
      if (scheduledSec < 0) continue;

      const localHour = parseLocalHour(scheduledTs);
      if (localHour < 0) continue;

      const actualTs = parts[10] ?? '';
      const actualSec = actualTs ? parseScheduledSec(actualTs) : -1;

      const actualHeadwayStr = parts[12];
      const actualHeadwaySec = actualHeadwayStr ? parseInt(actualHeadwayStr, 10) : -1;

      const csvSchedHwStr = parts[11];
      const csvScheduledHeadwaySec = csvSchedHwStr ? parseInt(csvSchedHwStr, 10) : -1;

      // For Headway-standard: need the headway column
      // For Schedule-standard: need either headway column or actual arrival time to compute headway
      if (actualHeadwaySec <= 0 && csvScheduledHeadwaySec <= 0 && actualSec <= 0) continue;

      const date = parts[0]!;
      const routeId = parts[1]!;
      const directionId = parts[2]!;
      const stopId = parts[4]!;
      const timePointOrder = parseInt(parts[6]!, 10);

      const rawKey = `${routeId}:${stopId}:${directionId}:${date}`;
      let arr = rawByStopDirDate.get(rawKey);
      if (!arr) { arr = []; rawByStopDirDate.set(rawKey, arr); }
      arr.push({
        scheduledSec,
        actualSec,
        actualHeadwaySec,
        csvScheduledHeadwaySec,
        localHour,
        date,
        directionId,
        timePointOrder: isNaN(timePointOrder) ? 0 : timePointOrder,
        standardType: standardType as 'Schedule' | 'Headway',
      });
      rawCount++;
    }

    // --- Second pass: compute scheduled headways and build the final HeadwayIndex ---
    //
    // Scheduled headway strategy:
    //   • Schedule-standard: use the CSV's scheduled_headway column directly.
    //   • Headway-standard:  compute as next.scheduledSec − this.scheduledSec (forward diff).
    //     - First trip of the day (i=0): no meaningful headway, stored as 0.
    //     - Last trip (no next trip):     stored as 0.
    //     - All records are kept; 0-valued scheduled headways are excluded from median calc.
    const index: HeadwayIndex = new Map();
    const dateSet = new Set<string>();
    let linesIndexed = 0;

    for (const [rawKey, trips] of Array.from(rawByStopDirDate.entries())) {
      // rawKey = "routeId:stopId:directionId:date"
      const colonIdx = rawKey.indexOf(':');
      const routeId = rawKey.slice(0, colonIdx);
      const rest = rawKey.slice(colonIdx + 1);
      const colon2 = rest.indexOf(':');
      const stopId = rest.slice(0, colon2);

      // Sort by scheduled time for computing scheduled headway diffs
      trips.sort((a, b) => a.scheduledSec - b.scheduledSec);

      for (let i = 0; i < trips.length; i++) {
        const trip = trips[i]!;

        // Determine actual headway
        let actualHeadwaySec: number;
        if (trip.actualHeadwaySec > 0) {
          // Headway column populated (Headway-standard routes)
          actualHeadwaySec = trip.actualHeadwaySec;
        } else if (i > 0) {
          // Compute from consecutive actual arrival times
          const prev = trips[i - 1]!;
          if (trip.actualSec > 0 && prev.actualSec > 0) {
            const gap = trip.actualSec - prev.actualSec;
            actualHeadwaySec = gap > 0 ? gap : -1;
          } else {
            actualHeadwaySec = -1;
          }
        } else {
          actualHeadwaySec = -1;
        }

        // Skip if we couldn't determine actual headway
        if (actualHeadwaySec <= 0) continue;

        // Determine scheduled headway:
        // 1. Use CSV scheduled_headway column if available
        // 2. Otherwise compute from consecutive scheduled departure times
        let scheduledHeadwaySec: number;
        if (trip.csvScheduledHeadwaySec > 0) {
          scheduledHeadwaySec = trip.csvScheduledHeadwaySec;
        } else if (i > 0) {
          const prev = trips[i - 1]!;
          const gap = trip.scheduledSec - prev.scheduledSec;
          scheduledHeadwaySec = gap > 0 ? gap : 0;
        } else {
          scheduledHeadwaySec = 0;
        }

        const record: HeadwayRecord = {
          scheduledHeadwaySec,
          actualHeadwaySec,
          localHour: trip.localHour,
          scheduledSec: trip.scheduledSec,
          prevScheduledSec: i > 0 ? trips[i - 1]!.scheduledSec : -1,
          date: trip.date,
          directionId: trip.directionId,
          timePointOrder: trip.timePointOrder,
        };

        dateSet.add(trip.date);

        const stopKey = `${routeId}:${stopId}`;
        let stopArr = index.get(stopKey);
        if (!stopArr) { stopArr = []; index.set(stopKey, stopArr); }
        stopArr.push(record);

        const routeKey = `route:${routeId}`;
        let routeArr = index.get(routeKey);
        if (!routeArr) { routeArr = []; index.set(routeKey, routeArr); }
        routeArr.push(record);

        linesIndexed++;
      }
    }

    const dates = Array.from(dateSet).sort();

    if (DEBUG) {
      console.log(`[ArchivedCSV] Indexed ${linesIndexed} records from ${rawCount} raw rows across ${dates.length} dates`);
    }
    return { index, dates };
  })();
  return indexPromise;
}

/** Returns all service dates available in the CSV, sorted ascending. */
export async function getAvailableDates(): Promise<string[]> {
  const { dates } = await loadIndex();
  return dates;
}

// ---------------------------------------------------------------------------
// ArchivedObservedProvider
// ---------------------------------------------------------------------------

export function createArchivedObservedProviderCSV(): ArchivedObservedProvider {
  return {
    async fetchArchivedMetrics(options: ArchivedObservedOptions): Promise<ArchivedObservedResult | null> {
      const { routeId, stopId } = options;

      // Resolve the effective time bounds first so the cache key is canonical
      const startH = options.startTime ? parseHhMm(options.startTime) : legacyStartH(options.timeWindow);
      const endH = options.endTime ? parseHhMm(options.endTime) : legacyEndH(options.timeWindow);
      const filterDate = options.date ?? null;
      const dirSet = options.directions?.length ? new Set(options.directions) : null;
      const memoKey = `${routeId}:${stopId}:${filterDate ?? ''}:${startH}:${endH}:${dirSet ? Array.from(dirSet).sort().join(',') : 'all'}`;
      if (metricsCache.has(memoKey)) return metricsCache.get(memoKey)!;

      const { index } = await loadIndex();

      // Date filter: prefer explicit date, then startDate/endDate range
      const startNum = filterDate ? dateToNum(filterDate) : (options.startDate ? dateToNum(options.startDate) : 0);
      const endNum = filterDate ? dateToNum(filterDate) : (options.endDate ? dateToNum(options.endDate) : 99999999);

      const inWindow = (r: HeadwayRecord) => {
        const d = dateToNum(r.date);
        if (d < startNum || d > endNum || r.localHour < startH || r.localHour >= endH) return false;
        // Headway is a gap between two consecutive trips. Keep it only when BOTH
        // the current and previous trips are inside the selected window.
        if (r.prevScheduledSec <= 0) return false;
        const prevHour = r.prevScheduledSec / 3600;
        if (prevHour < startH || prevHour >= endH) return false;
        if (dirSet && !dirSet.has(r.directionId)) return false;
        return true;
      };

      function getFiltered(key: string): HeadwayRecord[] | null {
        const records = index.get(key);
        if (!records?.length) return null;
        const result = records.filter(inWindow);
        return result.length > 0 ? result : null;
      }

      let filtered = getFiltered(`${routeId}:${stopId}`);
      let isRouteLevel = false;
      if (!filtered) {
        filtered = getFiltered(`route:${routeId}`);
        if (filtered) isRouteLevel = true;
      }
      if (!filtered) {
        metricsCache.set(memoKey, null);
        return null;
      }

      const scheduledSecs = filtered.map((r) => r.scheduledHeadwaySec).filter((v) => v > 0);
      const actualSecs = filtered.map((r) => r.actualHeadwaySec);

      const medianScheduledSec = scheduledSecs.length > 0 ? median(scheduledSecs) : 0;
      const medianActualSec = median(actualSecs);
      const p25Sec = p25(actualSecs);
      const p75Sec = p75(actualSecs);
      const bunchThreshSec = Math.min(medianScheduledSec > 0 ? medianScheduledSec * 0.5 : 240, 240);
      const bunchedCount = filtered.filter((r) => r.actualHeadwaySec < bunchThreshSec).length;
      const bunchingRate = filtered.length > 0 ? bunchedCount / filtered.length : 0;

      const result: ArchivedObservedResult = {
        routeId,
        stopId,
        observedMedianHeadwayMinutes: medianActualSec / 60,
        headwayP25Minutes: p25Sec / 60,
        headwayP75Minutes: p75Sec / 60,
        bunchingRate,
        isRouteLevel,
        csvScheduledHeadwayMinutes: medianScheduledSec > 0 ? medianScheduledSec / 60 : undefined,
      };
      metricsCache.set(memoKey, result);
      return result;
    },
  };
}

function legacyStartH(tw?: string): number {
  switch ((tw ?? 'AM').toUpperCase()) {
    case 'AM': return 7;
    case 'PM': return 14.5;
    case 'AS': return 16;
    default:   return 6;
  }
}

function legacyEndH(tw?: string): number {
  switch ((tw ?? 'AM').toUpperCase()) {
    case 'AM': return 9;
    case 'PM': return 16.5;
    case 'AS': return 18;
    default:   return 22;
  }
}

// ---------------------------------------------------------------------------
// Route stop headways for map overlay
// ---------------------------------------------------------------------------

export interface RouteHeadwayOptions {
  startTime: string;  // HH:MM
  endTime: string;    // HH:MM
  date?: string;      // YYYY-MM-DD (if omitted, uses all dates)
  directions?: string[];
}

export async function getRouteStopHeadways(
  routeId: string,
  options: RouteHeadwayOptions,
): Promise<CsvRouteStopData[]> {
  const { index } = await loadIndex();
  const startH = parseHhMm(options.startTime);
  const endH = parseHhMm(options.endTime);
  const filterDate = options.date ?? null;
  const startNum = filterDate ? dateToNum(filterDate) : 0;
  const endNum = filterDate ? dateToNum(filterDate) : 99999999;

  const dirSet = options.directions?.length ? new Set(options.directions) : null;

  const inWindow = (r: HeadwayRecord) => {
    const d = dateToNum(r.date);
    if (d < startNum || d > endNum || r.localHour < startH || r.localHour >= endH) return false;
    // Enforce strict window membership for the previous trip too.
    if (r.prevScheduledSec <= 0) return false;
    const prevHour = r.prevScheduledSec / 3600;
    if (prevHour < startH || prevHour >= endH) return false;
    if (dirSet && !dirSet.has(r.directionId)) return false;
    return true;
  };

  const prefix = `${routeId}:`;
  const results: CsvRouteStopData[] = [];

  for (const key of Array.from(index.keys())) {
    if (!key.startsWith(prefix) || key.startsWith('route:')) continue;
    const records = index.get(key)!;
    const stopId = key.slice(prefix.length);

    const filtered = records.filter(inWindow);
    if (filtered.length === 0) continue;

    const scheduledSecs = filtered
      .map((r: HeadwayRecord) => r.scheduledHeadwaySec)
      .filter((v) => v > 0);
    const actualSecs = filtered.map((r: HeadwayRecord) => r.actualHeadwaySec);
    const medianSched = scheduledSecs.length > 0 ? median(scheduledSecs) : 0;
    const medianActual = median(actualSecs);

    const dirCounts = new Map<string, number>();
    filtered.forEach((r: HeadwayRecord) =>
      dirCounts.set(r.directionId, (dirCounts.get(r.directionId) ?? 0) + 1)
    );
    const primaryDir = Array.from(dirCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const minOrder = Math.min(
      ...filtered
        .filter((r: HeadwayRecord) => r.directionId === primaryDir)
        .map((r: HeadwayRecord) => r.timePointOrder)
    );

    const ratio = medianSched > 0
      ? medianActual / medianSched
      : 0;

    results.push({
      stopId,
      directionId: primaryDir,
      timePointOrder: isFinite(minOrder) ? minOrder : 0,
      scheduledMedianMin: medianSched / 60,
      actualMedianMin: medianActual / 60,
      ratio,
      sampleCount: filtered.length,
    });
  }

  results.sort((a, b) => {
    if (a.directionId !== b.directionId) return a.directionId === 'Inbound' ? -1 : 1;
    return a.timePointOrder - b.timePointOrder;
  });

  return results;
}

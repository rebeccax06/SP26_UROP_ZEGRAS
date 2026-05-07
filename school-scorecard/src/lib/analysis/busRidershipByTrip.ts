import fs from 'fs';
import { createInterface } from 'readline';
import type { BusRidershipStopRow, BusRidershipTripOption } from '@/lib/types';
import { getMbtaBusRidershipCsvPath } from '@/lib/analysis/mbtaBusRidershipCsvPath';

/** RFC4180-style: fields may be quoted; doubled quotes inside quoted field. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

const IDX = {
  season: 0,
  routeId: 1,
  routeVariant: 2,
  directionId: 3,
  tripStartTime: 4,
  dayTypeId: 5,
  dayTypeName: 6,
  stopName: 7,
  stopId: 8,
  stopSequence: 9,
  boardings: 10,
  alightings: 11,
  load: 12,
  sampleSize: 13,
} as const;

function tripKey(parts: string[]): string {
  return `${parts[IDX.dayTypeId]}\t${parts[IDX.directionId]}\t${parts[IDX.tripStartTime]}\t${parts[IDX.routeVariant]}`;
}

function dayTypeSortOrder(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('week')) return 0;
  if (n.includes('sat')) return 1;
  if (n.includes('sun')) return 2;
  return 3;
}

function compareTime(a: string, b: string): number {
  const pa = a.split(':').map((x) => parseInt(x, 10));
  const pb = b.split(':').map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const da = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (da !== 0) return da;
  }
  return 0;
}

/**
 * Unique trips for a route (one row per trip bucket in the CSV).
 */
export async function loadBusRidershipTripOptions(routeId: string): Promise<{
  csvPath: string | null;
  seasonLabel: string | null;
  trips: BusRidershipTripOption[];
}> {
  const csvPath = getMbtaBusRidershipCsvPath();
  if (!csvPath) {
    return { csvPath: null, seasonLabel: null, trips: [] };
  }

  const seen = new Map<string, BusRidershipTripOption>();
  let seasonLabel: string | null = null;

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const parts = parseCsvLine(line);
    if (parts.length < 14) continue;
    if (parts[IDX.routeId] !== routeId) continue;

    if (!seasonLabel) seasonLabel = parts[IDX.season] ?? null;

    const key = tripKey(parts);
    if (seen.has(key)) continue;

    seen.set(key, {
      dayTypeId: parts[IDX.dayTypeId] ?? '',
      dayTypeName: parts[IDX.dayTypeName] ?? '',
      directionId: String(parts[IDX.directionId] ?? ''),
      tripStartTime: parts[IDX.tripStartTime] ?? '',
      routeVariant: parts[IDX.routeVariant] ?? '',
    });
  }

  const trips = Array.from(seen.values()).sort((a, b) => {
    const d = dayTypeSortOrder(a.dayTypeName) - dayTypeSortOrder(b.dayTypeName);
    if (d !== 0) return d;
    const dir = a.directionId.localeCompare(b.directionId, undefined, { numeric: true });
    if (dir !== 0) return dir;
    return compareTime(a.tripStartTime, b.tripStartTime);
  });

  return { csvPath, seasonLabel, trips };
}

export async function loadBusRidershipStopsForTrip(
  routeId: string,
  trip: Pick<BusRidershipTripOption, 'dayTypeId' | 'directionId' | 'tripStartTime' | 'routeVariant'>,
): Promise<BusRidershipStopRow[]> {
  const csvPath = getMbtaBusRidershipCsvPath();
  if (!csvPath) return [];

  const rows: BusRidershipStopRow[] = [];

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const parts = parseCsvLine(line);
    if (parts.length < 14) continue;
    if (parts[IDX.routeId] !== routeId) continue;
    if (parts[IDX.dayTypeId] !== trip.dayTypeId) continue;
    if (String(parts[IDX.directionId]) !== trip.directionId) continue;
    if (parts[IDX.tripStartTime] !== trip.tripStartTime) continue;
    if (parts[IDX.routeVariant] !== trip.routeVariant) continue;

    const seq = parseInt(parts[IDX.stopSequence] ?? '', 10);
    rows.push({
      stopSequence: Number.isFinite(seq) ? seq : 0,
      stopId: String(parts[IDX.stopId] ?? ''),
      stopName: parts[IDX.stopName] ?? '',
      boardings: parseFloat(parts[IDX.boardings] ?? 'NaN'),
      alightings: parseFloat(parts[IDX.alightings] ?? 'NaN'),
      load: parseFloat(parts[IDX.load] ?? 'NaN'),
      sampleSize: parseInt(parts[IDX.sampleSize] ?? '0', 10) || 0,
    });
  }

  rows.sort((a, b) => a.stopSequence - b.stopSequence);
  return rows;
}

type LoadAgg = { sum: number; n: number };

/**
 * Mean `load_` from the ridership CSV per (GTFS/MBTA `direction_id` "0"|"1", `stop_id`),
 * averaging every matching row (all trip starts) for **weekday** only — stable map coloring.
 */
export async function loadBusRidershipAvgLoadByStopDirection(routeId: string): Promise<Map<string, number>> {
  const csvPath = getMbtaBusRidershipCsvPath();
  const acc = new Map<string, LoadAgg>();
  if (!csvPath) return new Map();

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const parts = parseCsvLine(line);
    if (parts.length < 14) continue;
    if (parts[IDX.routeId] !== routeId) continue;
    const dayName = (parts[IDX.dayTypeName] ?? '').toLowerCase();
    if (!dayName.includes('week')) continue;

    const dir = String(parts[IDX.directionId] ?? '');
    const sid = String(parts[IDX.stopId] ?? '');
    const loadVal = parseFloat(parts[IDX.load] ?? 'NaN');
    if (!sid || !Number.isFinite(loadVal)) continue;

    const key = `${dir}\t${sid}`;
    let a = acc.get(key);
    if (!a) {
      a = { sum: 0, n: 0 };
      acc.set(key, a);
    }
    a.sum += loadVal;
    a.n += 1;
  }

  const means = new Map<string, number>();
  for (const [key, { sum, n }] of Array.from(acc.entries())) {
    if (n > 0) means.set(key, sum / n);
  }
  return means;
}

/** Resolve mean load for map overlay: match app direction to CSV 0/1, else any direction. */
export function pickRidershipLoadForOverlayStop(
  loads: Map<string, number>,
  stopId: string,
  appDirectionId: string,
): number | null {
  const csvDir = appDirectionId === 'Outbound' ? '0' : appDirectionId === 'Inbound' ? '1' : '';
  if (csvDir) {
    const v = loads.get(`${csvDir}\t${stopId}`);
    if (v !== undefined) return v;
  }
  const d0 = loads.get(`0\t${stopId}`);
  const d1 = loads.get(`1\t${stopId}`);
  if (d0 !== undefined && d1 !== undefined) return (d0 + d1) / 2;
  return d0 ?? d1 ?? null;
}

import fs from 'fs';
import { createInterface } from 'readline';

import { getMbtaBusArrivalCsvPath } from '@/lib/analysis/mbtaBusCsvPath';

/** Same rule as data-analysis.py: delayed if actual trip exceeds scheduled end-to-end by more than this. */
export const TRIP_DELAY_THRESHOLD_SEC = 3 * 60;

export interface RouteTripObservation {
  serviceDate: string;
  dateIso: string;
  directionId: string;
  halfTripId: string;
  /** Observed end-to-end time (minutes): last actual − first actual along time points. */
  observedTripMinutes: number;
  /** Scheduled end-to-end (minutes): for delay classification only, not the primary metric. */
  scheduledTripMinutes: number;
  firstScheduledSec: number;
  delayed: boolean;
}

interface TripRow {
  timePointOrder: number;
  scheduledSec: number;
  actualSec: number;
  standardType: 'Schedule' | 'Headway';
}

function parseScheduledSec(ts: string): number {
  const m = ts.match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10);
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

function finalizeGroup(
  rows: TripRow[],
): Omit<RouteTripObservation, 'serviceDate' | 'dateIso' | 'directionId' | 'halfTripId'> | null {
  rows.sort((a, b) => {
    if (a.timePointOrder !== b.timePointOrder) return a.timePointOrder - b.timePointOrder;
    const oa = a.standardType === 'Schedule' ? 0 : 1;
    const ob = b.standardType === 'Schedule' ? 0 : 1;
    return oa - ob;
  });
  const dedup: TripRow[] = [];
  for (const r of rows) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.timePointOrder === r.timePointOrder) continue;
    dedup.push(r);
  }
  if (dedup.length < 2) return null;
  const first = dedup[0]!;
  const last = dedup[dedup.length - 1]!;
  if (first.actualSec < 0 || last.actualSec < 0) return null;
  if (last.actualSec < first.actualSec || last.scheduledSec <= first.scheduledSec) return null;
  const actSec = last.actualSec - first.actualSec;
  const schedSec = last.scheduledSec - first.scheduledSec;
  return {
    observedTripMinutes: actSec / 60,
    scheduledTripMinutes: schedSec / 60,
    firstScheduledSec: first.scheduledSec,
    delayed: actSec - schedSec > TRIP_DELAY_THRESHOLD_SEC,
  };
}

/**
 * Half-trip observations from the same MBTA CSV used by the archived / scorecard headway pipeline.
 * Y-axis for charts should use observedTripMinutes. scheduledTripMinutes is only for `delayed`.
 */
export async function loadRouteTripSeries(routeId: string): Promise<{
  csvPath: string | null;
  trips: RouteTripObservation[];
}> {
  const csvPath = getMbtaBusArrivalCsvPath();
  if (!csvPath) {
    return { csvPath: null, trips: [] };
  }

  const groups = new Map<string, { meta: { serviceDate: string; directionId: string; halfTripId: string }; rows: TripRow[] }>();

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const parts = line.split(',');
    if (parts.length < 13) continue;
    if (parts[1] !== routeId) continue;

    const standardType = parts[8];
    if (standardType !== 'Schedule' && standardType !== 'Headway') continue;

    const scheduledTs = parts[9]!;
    const scheduledSec = parseScheduledSec(scheduledTs);
    if (scheduledSec < 0) continue;

    const actualTs = parts[10] ?? '';
    const actualSec = actualTs ? parseScheduledSec(actualTs) : -1;

    const serviceDate = parts[0]!;
    const directionId = parts[2]!;
    const halfTripId = parts[3]!;
    const timePointOrder = parseInt(parts[6]!, 10);
    if (Number.isNaN(timePointOrder)) continue;

    const key = `${serviceDate}\t${directionId}\t${halfTripId}`;
    let g = groups.get(key);
    if (!g) {
      g = { meta: { serviceDate, directionId, halfTripId }, rows: [] };
      groups.set(key, g);
    }
    g.rows.push({
      timePointOrder,
      scheduledSec,
      actualSec,
      standardType: standardType as 'Schedule' | 'Headway',
    });
  }

  const trips: RouteTripObservation[] = [];
  for (const { meta, rows } of Array.from(groups.values())) {
    const obs = finalizeGroup(rows);
    if (!obs) continue;
    trips.push({
      ...obs,
      serviceDate: meta.serviceDate,
      directionId: meta.directionId,
      halfTripId: meta.halfTripId,
      dateIso: serviceDateToIso(meta.serviceDate),
    });
  }

  trips.sort((a, b) => {
    const da = a.dateIso.localeCompare(b.dateIso);
    if (da !== 0) return da;
    if (a.firstScheduledSec !== b.firstScheduledSec) return a.firstScheduledSec - b.firstScheduledSec;
    return a.halfTripId.localeCompare(b.halfTripId);
  });

  return { csvPath, trips };
}

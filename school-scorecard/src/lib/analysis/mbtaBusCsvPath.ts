import fs from 'fs';
import path from 'path';

/**
 * Path to MBTA Bus Arrival/Departure CSV (same file the archived scorecard provider reads).
 *
 * Resolution order:
 * 1. MBTA_BUS_ARRIVAL_CSV — absolute or cwd-relative path to a file that exists
 * 2. data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_{MBTA_BUS_ARRIVAL_MONTH}.csv (month default 2026-01)
 * 3. data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_2026-01.csv
 */
export function getMbtaBusArrivalCsvPath(): string | null {
  const envPath = process.env.MBTA_BUS_ARRIVAL_CSV?.trim();
  if (envPath) {
    const resolved = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  const cwd = process.cwd();
  const month = process.env.MBTA_BUS_ARRIVAL_MONTH?.trim() ?? '2026-01';
  const byMonth = path.join(cwd, 'data', 'mbta-bus', `MBTA-Bus-Arrival-Departure-Times_${month}.csv`);
  if (fs.existsSync(byMonth)) return byMonth;
  const fallback = path.join(cwd, 'data', 'mbta-bus', 'MBTA-Bus-Arrival-Departure-Times_2026-01.csv');
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

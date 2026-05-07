import fs from 'fs';
import path from 'path';

/**
 * MBTA bus ridership-by-trip CSV (season / route / stop / load).
 *
 * 1. MBTA_BUS_RIDERSHIP_CSV — absolute or cwd-relative path
 * 2. ../data/... from cwd (Next dev often runs in `school-scorecard/`, data at repo root)
 * 3. data/... under cwd
 *
 * Default file name can be overridden with MBTA_BUS_RIDERSHIP_FILE.
 */
export function getMbtaBusRidershipCsvPath(): string | null {
  const envPath = process.env.MBTA_BUS_RIDERSHIP_CSV?.trim();
  if (envPath) {
    const resolved = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    if (fs.existsSync(resolved)) return resolved;
  }

  const fileName =
    process.env.MBTA_BUS_RIDERSHIP_FILE?.trim() ??
    'MBTA_Bus_Ridership_by_Trip_Season_Route_Line_and_Stop_Spring_2024.csv';
  const subdir = 'MBTA_Bus_Ridership_by_Trip_Season_Route_Line_and_Stop';

  const cwd = process.cwd();
  const parentData = path.join(cwd, '..', 'data', subdir, fileName);
  if (fs.existsSync(parentData)) return parentData;

  const localData = path.join(cwd, 'data', subdir, fileName);
  if (fs.existsSync(localData)) return localData;

  return null;
}

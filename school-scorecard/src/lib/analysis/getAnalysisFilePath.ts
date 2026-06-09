import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolve path to a route's `stop_metrics.json` produced by `../data-analysis.py`.
 *
 * The Python script writes `route{N}_{month}_stop_metrics.json` (e.g.
 * `route28_2026-01_stop_metrics.json`), so the month must match what the
 * caller actually wants. Resolution order, for each candidate directory:
 *   1. `route{N}_{month}_stop_metrics.json` for the resolved month
 *   2. `route{N}_stop_metrics.json` (legacy / month-less filename) as fallback
 *
 * Candidate directories, in priority order:
 *   1. `$ANALYSIS_OUTPUT_DIR`
 *   2. `<cwd>/data/analysis`
 *   3. `<cwd>/../analysis_output` (sibling of the repo's Python pipeline)
 *
 * Month resolution: the explicit `month` arg wins; otherwise
 * `MBTA_BUS_ARRIVAL_MONTH` is used (same env var that picks the CSV in
 * `mbtaBusCsvPath.ts`); otherwise the default `2026-01` matches the rest of
 * the app.
 */
export function getAnalysisFilePath(routeId: string, month?: string): string | null {
  const resolvedMonth = (month ?? process.env.MBTA_BUS_ARRIVAL_MONTH ?? '2026-01').trim();
  const cwd = process.cwd();

  const dirs = [
    process.env.ANALYSIS_OUTPUT_DIR ?? null,
    join(cwd, 'data', 'analysis'),
    join(cwd, '..', 'analysis_output'),
  ].filter((d): d is string => !!d);

  for (const dir of dirs) {
    const monthly = join(dir, `route${routeId}_${resolvedMonth}_stop_metrics.json`);
    if (existsSync(monthly)) return monthly;
    const legacy = join(dir, `route${routeId}_stop_metrics.json`);
    if (existsSync(legacy)) return legacy;
  }

  return null;
}

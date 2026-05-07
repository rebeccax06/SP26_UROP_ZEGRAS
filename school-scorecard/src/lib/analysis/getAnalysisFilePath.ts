import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolve path to route stop metrics JSON (from data-analysis.py export).
 * Checks ANALYSIS_OUTPUT_DIR, then data/analysis, then ../analysis_output.
 */
export function getAnalysisFilePath(routeId: string): string | null {
  const cwd = process.cwd();
  const candidates = [
    process.env.ANALYSIS_OUTPUT_DIR ? join(process.env.ANALYSIS_OUTPUT_DIR, `route${routeId}_stop_metrics.json`) : null,
    join(cwd, 'data', 'analysis', `route${routeId}_stop_metrics.json`),
    join(cwd, '..', 'analysis_output', `route${routeId}_stop_metrics.json`),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

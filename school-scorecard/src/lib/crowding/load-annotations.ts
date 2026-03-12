import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CrowdingAnnotationEntry, CrowdingAnnotationsMap } from '@/lib/types';

const FILENAME = 'crowding-annotations.json';

/**
 * Resolve path to data/crowding-annotations.json (next to school-scorecard or in cwd).
 */
function resolveAnnotationsPath(): string {
  const cwd = process.cwd();
  const dir1 = join(cwd, 'data');
  const dir2 = join(cwd, 'school-scorecard', 'data');
  if (existsSync(join(dir1, FILENAME))) return join(dir1, FILENAME);
  if (existsSync(join(dir2, FILENAME))) return join(dir2, FILENAME);
  return join(dir1, FILENAME);
}

/**
 * Load crowding/denied boardings annotations from data/crowding-annotations.json.
 * Returns a map of "stopId:routeId" -> { hasCrowding, hasDeniedBoardings }.
 * If the file does not exist or is invalid, returns empty sets.
 */
export function loadCrowdingAnnotations(): CrowdingAnnotationsMap {
  const hasCrowding = new Set<string>();
  const hasDeniedBoardings = new Set<string>();
  const path = resolveAnnotationsPath();
  if (!existsSync(path)) return { hasCrowding, hasDeniedBoardings };
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    const entries = Array.isArray(data) ? data : (data as { annotations?: unknown[] }).annotations ?? [];
    if (!Array.isArray(entries)) return { hasCrowding, hasDeniedBoardings };
    for (const e of entries as CrowdingAnnotationEntry[]) {
      if (typeof e?.stopId !== 'string' || typeof e?.routeId !== 'string' || typeof e?.type !== 'string') continue;
      const key = `${e.stopId}:${e.routeId}`;
      if (e.type === 'crowding') hasCrowding.add(key);
      if (e.type === 'denied_boardings') hasDeniedBoardings.add(key);
    }
  } catch {
    // File missing or invalid JSON: return empty
  }
  return { hasCrowding, hasDeniedBoardings };
}

import { existsSync } from 'fs';
import { join } from 'path';
import type { GtfsIndex, GtfsStop, GtfsRoute, GtfsTrip, GtfsStopTime, GtfsCalendar, GtfsCalendarDate, GtfsShapePoint } from './types';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

/**
 * Resolve GTFS directory path. Tries multiple locations:
 * 1. GTFS_DIR env var (if set)
 * 2. process.cwd()/data/gtfs (when running from school-scorecard/)
 * 3. process.cwd()/../data/gtfs (fallback)
 */
function resolveGtfsDir(): string {
  if (process.env.GTFS_DIR) {
    return process.env.GTFS_DIR;
  }
  const cwd = process.cwd();
  const dir1 = join(cwd, 'data', 'gtfs');
  const dir2 = join(cwd, '..', 'data', 'gtfs');
  // Try dir1 first, then dir2
  if (existsSync(dir1)) {
    return dir1;
  }
  if (existsSync(dir2)) {
    return dir2;
  }
  // Default to dir1 even if it doesn't exist yet (will show error when loading)
  return dir1;
}

/**
 * Parse CSV line handling quoted fields with commas inside.
 * Simple implementation: split on commas but respect quoted fields.
 * Used by GTFS loaders and MBTA bus arrival/departure heatmap readers.
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((s) => s.replace(/^"|"$/g, ''));
}

function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0]!, 10) || 0;
  const m = parseInt(parts[1]!, 10) || 0;
  const s = parseInt(parts[2]!, 10) || 0;
  return h * 60 + m + s / 60;
}

async function loadStops(dir: string): Promise<Map<string, GtfsStop>> {
  const path = join(dir, 'stops.txt');
  if (DEBUG) console.log('[GTFS] Loading stops from', path, 'exists:', existsSync(path));
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] stops.txt not found at', path, 'cwd:', process.cwd());
    return new Map();
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const map = new Map<string, GtfsStop>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const stop_id = values[headers.indexOf('stop_id')] ?? '';
    if (!stop_id) continue;
    map.set(stop_id, {
      stop_id,
      stop_name: values[headers.indexOf('stop_name')] ?? '',
      stop_lat: values[headers.indexOf('stop_lat')] ?? '0',
      stop_lon: values[headers.indexOf('stop_lon')] ?? '0',
    });
  }
  if (DEBUG) console.log('[GTFS] Loaded', map.size, 'stops');
  return map;
}

async function loadRoutes(dir: string): Promise<Map<string, GtfsRoute>> {
  const path = join(dir, 'routes.txt');
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] routes.txt not found');
    return new Map();
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const map = new Map<string, GtfsRoute>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const route_id = values[headers.indexOf('route_id')] ?? '';
    if (!route_id) continue;
    map.set(route_id, {
      route_id,
      route_short_name: values[headers.indexOf('route_short_name')] ?? '',
      route_long_name: values[headers.indexOf('route_long_name')] ?? '',
    });
  }
  if (DEBUG) console.log('[GTFS] Loaded', map.size, 'routes');
  return map;
}

async function loadTrips(dir: string): Promise<{ byRoute: Map<string, GtfsTrip[]>; byService: Map<string, GtfsTrip[]> }> {
  const path = join(dir, 'trips.txt');
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] trips.txt not found');
    return { byRoute: new Map(), byService: new Map() };
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const byRoute = new Map<string, GtfsTrip[]>();
  const byService = new Map<string, GtfsTrip[]>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const route_id = values[headers.indexOf('route_id')] ?? '';
    const trip_id = values[headers.indexOf('trip_id')] ?? '';
    const service_id = values[headers.indexOf('service_id')] ?? '';
    const shape_id = headers.includes('shape_id') ? (values[headers.indexOf('shape_id')] ?? '') : '';
    const direction_id = headers.includes('direction_id') ? (values[headers.indexOf('direction_id')] ?? '') : '';
    if (!trip_id || !route_id) continue;
    const trip: GtfsTrip = { route_id, trip_id, service_id };
    if (shape_id) trip.shape_id = shape_id;
    if (direction_id !== undefined && direction_id !== '') trip.direction_id = direction_id;
    if (!byRoute.has(route_id)) byRoute.set(route_id, []);
    byRoute.get(route_id)!.push(trip);
    if (!byService.has(service_id)) byService.set(service_id, []);
    byService.get(service_id)!.push(trip);
  }
  if (DEBUG) console.log('[GTFS] Loaded trips for', byRoute.size, 'routes');
  return { byRoute, byService };
}

async function loadStopTimes(dir: string): Promise<Map<string, GtfsStopTime[]>> {
  const path = join(dir, 'stop_times.txt');
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] stop_times.txt not found');
    return new Map();
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const map = new Map<string, GtfsStopTime[]>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const trip_id = values[headers.indexOf('trip_id')] ?? '';
    const stop_id = values[headers.indexOf('stop_id')] ?? '';
    const arrival_time = values[headers.indexOf('arrival_time')] ?? '';
    const departure_time = values[headers.indexOf('departure_time')] ?? arrival_time;
    const stop_sequence = values[headers.indexOf('stop_sequence')] ?? '0';
    if (!trip_id) continue;
    const st: GtfsStopTime = { trip_id, arrival_time, departure_time, stop_id, stop_sequence };
    if (!map.has(trip_id)) map.set(trip_id, []);
    map.get(trip_id)!.push(st);
  }
  Array.from(map.values()).forEach((arr) => {
    arr.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
  });
  if (DEBUG) console.log('[GTFS] Loaded stop_times for', map.size, 'trips');
  return map;
}

async function loadCalendar(dir: string): Promise<Map<string, GtfsCalendar>> {
  const path = join(dir, 'calendar.txt');
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] calendar.txt not found');
    return new Map();
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const map = new Map<string, GtfsCalendar>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const service_id = values[headers.indexOf('service_id')] ?? '';
    if (!service_id) continue;
    map.set(service_id, {
      service_id,
      monday: values[headers.indexOf('monday')] ?? '0',
      tuesday: values[headers.indexOf('tuesday')] ?? '0',
      wednesday: values[headers.indexOf('wednesday')] ?? '0',
      thursday: values[headers.indexOf('thursday')] ?? '0',
      friday: values[headers.indexOf('friday')] ?? '0',
      saturday: values[headers.indexOf('saturday')] ?? '0',
      sunday: values[headers.indexOf('sunday')] ?? '0',
      start_date: values[headers.indexOf('start_date')] ?? '',
      end_date: values[headers.indexOf('end_date')] ?? '',
    });
  }
  if (DEBUG) console.log('[GTFS] Loaded', map.size, 'calendar services');
  return map;
}

async function loadCalendarDates(dir: string): Promise<Map<string, GtfsCalendarDate[]>> {
  const path = join(dir, 'calendar_dates.txt');
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] calendar_dates.txt not found');
    return new Map();
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const map = new Map<string, GtfsCalendarDate[]>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const date = values[headers.indexOf('date')] ?? '';
    const service_id = values[headers.indexOf('service_id')] ?? '';
    const exception_type = values[headers.indexOf('exception_type')] ?? '1';
    if (!date) continue;
    const cd: GtfsCalendarDate = { service_id, date, exception_type };
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(cd);
  }
  if (DEBUG) console.log('[GTFS] Loaded calendar_dates for', map.size, 'dates');
  return map;
}

async function loadShapes(dir: string): Promise<Map<string, GtfsShapePoint[]>> {
  const path = join(dir, 'shapes.txt');
  if (!existsSync(path)) {
    if (DEBUG) console.warn('[GTFS] shapes.txt not found');
    return new Map();
  }
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const byShapeId = new Map<string, GtfsShapePoint[]>();
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const values = parseCsvLine(line);
    if (first) {
      headers = values;
      first = false;
      continue;
    }
    const shape_id = values[headers.indexOf('shape_id')] ?? '';
    const shape_pt_lat = values[headers.indexOf('shape_pt_lat')] ?? '0';
    const shape_pt_lon = values[headers.indexOf('shape_pt_lon')] ?? '0';
    const shape_pt_sequence = values[headers.indexOf('shape_pt_sequence')] ?? '0';
    if (!shape_id) continue;
    const pt: GtfsShapePoint = { shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence };
    if (!byShapeId.has(shape_id)) byShapeId.set(shape_id, []);
    byShapeId.get(shape_id)!.push(pt);
  }
  // Sort each shape's points by sequence
  Array.from(byShapeId.values()).forEach((pts) => {
    pts.sort((a, b) => parseInt(a.shape_pt_sequence, 10) - parseInt(b.shape_pt_sequence, 10));
  });
  if (DEBUG) console.log('[GTFS] Loaded', byShapeId.size, 'shapes');
  return byShapeId;
}

/**
 * For each (route, direction), pick the shape_id that the most trips use.
 * Many MBTA routes have multiple shape variants per direction (full route,
 * short-turns, garage pull-outs, etc.). Picking "first seen" is a crapshoot
 * — for example route 28 inbound has 5 variants and the first-seen one is a
 * 21-trip short-turn at Nubian Square that misses Ruggles entirely. The
 * majority shape almost always corresponds to the canonical full route.
 */
function buildShapeIdByRouteDirection(tripsByRoute: Map<string, GtfsTrip[]>): Map<string, string> {
  const out = new Map<string, string>();
  Array.from(tripsByRoute.entries()).forEach(([routeId, trips]) => {
    const counts = new Map<string, Map<string, number>>(); // direction → shapeId → count
    for (const t of trips) {
      if (!t.shape_id || t.direction_id === undefined || t.direction_id === '') continue;
      let perDir = counts.get(t.direction_id);
      if (!perDir) { perDir = new Map(); counts.set(t.direction_id, perDir); }
      perDir.set(t.shape_id, (perDir.get(t.shape_id) ?? 0) + 1);
    }
    for (const [dir, perDir] of Array.from(counts.entries())) {
      let bestShape = '';
      let bestCount = -1;
      for (const [sid, n] of Array.from(perDir.entries())) {
        if (n > bestCount) { bestCount = n; bestShape = sid; }
      }
      if (bestShape) out.set(`${routeId}|${dir}`, bestShape);
    }
  });
  return out;
}

/**
 * Weekday 0=Sun … 6=Sat for an ISO calendar date (YYYY-MM-DD).
 * Uses UTC date parts only so it matches GTFS `service_date` / MBTA CSV dates regardless of
 * the runtime timezone (`new Date('2026-01-15').getDay()` is wrong in US zones).
 */
export function getWeekdaySun0ForIsoDate(dateStr: string): number {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const y = parseInt(m[1]!, 10);
  const mo = parseInt(m[2]!, 10) - 1;
  const d = parseInt(m[3]!, 10);
  return new Date(Date.UTC(y, mo, d)).getUTCDay();
}

/** Get service_ids that run on the given date (YYYY-MM-DD). */
function getServiceIdsForDate(
  dateStr: string,
  calendar: Map<string, GtfsCalendar>,
  calendarDates: Map<string, GtfsCalendarDate[]>
): Set<string> {
  try {
    if (!dateStr || typeof dateStr !== 'string') {
      throw new Error(`Invalid date string: ${dateStr}`);
    }
    
    // Convert YYYY-MM-DD to YYYYMMDD format
    const dateStrNormalized = dateStr.replace(/-/g, '');
    if (dateStrNormalized.length !== 8) {
      throw new Error(`Invalid date format: ${dateStr} (expected YYYY-MM-DD, got length ${dateStrNormalized.length})`);
    }
    
    const dayOfWeek = getWeekdaySun0ForIsoDate(dateStr); // 0=Sun, 1=Mon, ...
    const dowKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
    const dow = dowKeys[dayOfWeek]!;
    const result = new Set<string>();

    Array.from(calendar.entries()).forEach(([serviceId, cal]) => {
      const start = cal.start_date.replace(/-/g, '');
      const end = cal.end_date.replace(/-/g, '');
      if (dateStrNormalized >= start && dateStrNormalized <= end && cal[dow] === '1') {
        result.add(serviceId);
      }
    });
    const exceptions = calendarDates.get(dateStrNormalized) ?? [];
    for (const ex of exceptions) {
      if (ex.exception_type === '1') result.add(ex.service_id);
      else result.delete(ex.service_id);
    }
    return result;
  } catch (err) {
    throw new Error(`getServiceIdsForDate error for date "${dateStr}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

let cachedIndex: GtfsIndex | null = null;

/** Lightweight cache for heatmap labels (only stops.txt). */
let cachedStopIdToName: Map<string, string> | null = null;
let cachedStopIdToNameDir: string | null = null;

/**
 * Load stop_id → stop_name from GTFS stops.txt (quoted-field aware).
 * Same paths as loadGtfs: GTFS_DIR, then data/gtfs, then ../data/gtfs.
 * Falls back to stop_id when name is missing.
 */
export async function loadGtfsStopIdToNameMap(gtfsDir?: string): Promise<Map<string, string>> {
  const dir = gtfsDir ?? resolveGtfsDir();
  if (cachedStopIdToName && cachedStopIdToNameDir === dir) {
    return cachedStopIdToName;
  }
  const stops = await loadStops(dir);
  const map = new Map<string, string>();
  for (const [id, s] of Array.from(stops.entries())) {
    map.set(id, (s.stop_name || '').trim() || id);
  }
  cachedStopIdToName = map;
  cachedStopIdToNameDir = dir;
  return map;
}

/**
 * Load GTFS from data/gtfs (or GTFS_DIR). Builds in-memory indexes.
 * Cached after first load.
 */
export async function loadGtfs(gtfsDir?: string): Promise<GtfsIndex> {
  const dir = gtfsDir ?? resolveGtfsDir();
  if (cachedIndex) {
    if (DEBUG) console.log('[GTFS] Using cached index');
    return cachedIndex;
  }
  if (DEBUG) console.log('[GTFS] Loading GTFS from', dir, 'cwd:', process.cwd());
  const [stops, routes, { byRoute: tripsByRoute, byService: tripsByService }, stopTimesByTrip, calendar, calendarDates, shapes] =
    await Promise.all([
      loadStops(dir),
      loadRoutes(dir),
      loadTrips(dir),
      loadStopTimes(dir),
      loadCalendar(dir),
      loadCalendarDates(dir),
      loadShapes(dir),
    ]);
  const shapeIdByRouteDirection = buildShapeIdByRouteDirection(tripsByRoute);
  cachedIndex = {
    stops,
    routes,
    tripsByRoute,
    tripsByService,
    stopTimesByTrip,
    calendar,
    calendarDates,
    shapes,
    shapeIdByRouteDirection,
  };
  return cachedIndex;
}

/**
 * Get service IDs active on a given date (YYYY-MM-DD).
 */
export function getServiceIdsForDateFromIndex(
  index: GtfsIndex,
  dateStr: string
): Set<string> {
  return getServiceIdsForDate(dateStr, index.calendar, index.calendarDates);
}

/**
 * Parse HH:MM or HH:MM:SS to minutes since midnight.
 */
export { parseTimeToMinutes };

export function clearGtfsCache(): void {
  cachedIndex = null;
  cachedStopIdToName = null;
  cachedStopIdToNameDir = null;
}

/**
 * Get shape geometry as [lon, lat][] for a route and GTFS direction_id ("0" or "1").
 * Returns null if shapes.txt is missing or no shape exists for that route/direction.
 */
export function getShapeCoordinatesForRouteDirection(
  index: GtfsIndex,
  routeId: string,
  directionId: string
): [number, number][] | null {
  const key = `${routeId}|${directionId}`;
  const shapeId = index.shapeIdByRouteDirection.get(key);
  if (!shapeId) return null;
  const points = index.shapes.get(shapeId);
  if (!points?.length) return null;
  return points.map((p) => [parseFloat(p.shape_pt_lon), parseFloat(p.shape_pt_lat)]);
}

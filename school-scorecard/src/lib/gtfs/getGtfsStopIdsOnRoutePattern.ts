import { loadGtfs } from '@/lib/gtfs/loadGtfs';

/**
 * All `stop_id`s that appear on any scheduled trip for this route in the loaded GTFS.
 * Used to disambiguate duplicate `stop_name`s and to filter CSV rows to the route pattern.
 */
export async function getGtfsStopIdsOnRoutePattern(routeId: string): Promise<Set<string> | null> {
  try {
    const idx = await loadGtfs();
    const routeIdsToScan = new Set<string>([routeId]);
    for (const r of Array.from(idx.routes.values())) {
      if (r.route_short_name === routeId) routeIdsToScan.add(r.route_id);
    }
    const out = new Set<string>();
    for (const rid of Array.from(routeIdsToScan)) {
      const trips = idx.tripsByRoute.get(rid);
      if (!trips) continue;
      for (const t of trips) {
        const sts = idx.stopTimesByTrip.get(t.trip_id);
        if (!sts) continue;
        for (const st of sts) {
          if (st.stop_id) out.add(st.stop_id);
        }
      }
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

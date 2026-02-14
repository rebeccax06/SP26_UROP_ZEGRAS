import { loadGtfs } from '@/lib/gtfs/loadGtfs';
import type { RoutesProvider } from './routes';
import type { Route } from '@/lib/types';

/**
 * From GTFS: routes that have at least one trip that serves one of the given stop IDs.
 */
export function createRoutesProviderGTFS(gtfsDir?: string): RoutesProvider {
  return {
    async getRoutesServingStops(stopIds: string[]): Promise<Route[]> {
      const index = await loadGtfs(gtfsDir);
      const stopSet = new Set(stopIds);
      const routeIds = new Set<string>();
      for (const [routeId, trips] of index.tripsByRoute) {
        for (const trip of trips) {
          const stopTimes = index.stopTimesByTrip.get(trip.trip_id) ?? [];
          if (stopTimes.some((st) => stopSet.has(st.stop_id))) {
            routeIds.add(routeId);
            break;
          }
        }
      }
      const routes: Route[] = [];
      for (const routeId of routeIds) {
        const r = index.routes.get(routeId);
        if (r) {
          routes.push({
            routeId: r.route_id,
            routeShortName: r.route_short_name,
            routeLongName: r.route_long_name,
          });
        }
      }
      return routes;
    },
  };
}

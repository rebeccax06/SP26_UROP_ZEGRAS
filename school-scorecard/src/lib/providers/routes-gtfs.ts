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
      Array.from(index.tripsByRoute.entries()).forEach(([routeId, trips]) => {
        if (routeId.startsWith('Shuttle')) return;
        for (const trip of trips) {
          const stopTimes = index.stopTimesByTrip.get(trip.trip_id) ?? [];
          if (stopTimes.some((st) => stopSet.has(st.stop_id))) {
            routeIds.add(routeId);
            return;
          }
        }
      });
      const routes: Route[] = [];
      Array.from(routeIds).forEach((routeId) => {
        const r = index.routes.get(routeId);
        if (r) {
          routes.push({
            routeId: r.route_id,
            routeShortName: r.route_short_name,
            routeLongName: r.route_long_name,
          });
        }
      });
      return routes;
    },
  };
}

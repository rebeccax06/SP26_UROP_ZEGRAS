import type { Route } from '@/lib/types';

/**
 * Returns routes that serve the given stop IDs.
 * Can be backed by GTFS (routes -> trips -> stop_times) or API.
 */
export interface RoutesProvider {
  getRoutesServingStops(stopIds: string[]): Promise<Route[]>;
}

import type { Stop } from '@/lib/types';

export interface StopsProviderOptions {
  lat: number;
  lon: number;
  radiusMeters: number;
}

/**
 * Returns stops within walk radius of a point.
 * Can be backed by GTFS stops + distance calc or external API.
 */
export interface StopsProvider {
  getStopsNear(options: StopsProviderOptions): Promise<Stop[]>;
}

import { loadGtfs } from '@/lib/gtfs/loadGtfs';
import type { StopsProvider, StopsProviderOptions } from './stops';
import type { Stop } from '@/lib/types';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function createStopsProviderGTFS(gtfsDir?: string): StopsProvider {
  return {
    async getStopsNear(options: StopsProviderOptions): Promise<Stop[]> {
      const { lat, lon, radiusMeters } = options;
      const index = await loadGtfs(gtfsDir);
      const stops: Stop[] = [];
      Array.from(index.stops.values()).forEach((s) => {
        const stopLat = parseFloat(s.stop_lat);
        const stopLon = parseFloat(s.stop_lon);
        if (isNaN(stopLat) || isNaN(stopLon)) return;
        const dist = haversineMeters(lat, lon, stopLat, stopLon);
        if (dist <= radiusMeters) {
          stops.push({
            stopId: s.stop_id,
            stopName: s.stop_name,
            lat: stopLat,
            lon: stopLon,
            distanceMeters: Math.round(dist),
          });
        }
      });
      stops.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
      return stops;
    },
  };
}

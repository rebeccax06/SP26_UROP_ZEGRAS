import { z } from 'zod';
import type { ArchivedObservedProvider, ArchivedObservedOptions } from './archived-observed';
import type { ArchivedObservedResult } from '@/lib/types';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const baseUrl = process.env.MBTA_ARCHIVE_BASE_URL ?? '';
const dataset = process.env.MBTA_ARCHIVE_DATASET ?? '';

/**
 * TODO: Replace with actual MBTA archive response schema when endpoint/query is known.
 * Possible sources: MBTA Open Data, ArcGIS API, or other published metrics.
 */
const ArchivedResponseSchema = z.object({
  // Example placeholder fields; adjust to real API response
  median_headway_minutes: z.number().optional(),
  p25_headway_minutes: z.number().optional(),
  p75_headway_minutes: z.number().optional(),
  bunching_rate: z.number().optional(),
  route_id: z.string().optional(),
  stop_id: z.string().optional(),
});

type ArchivedResponse = z.infer<typeof ArchivedResponseSchema>;

async function fetchFromArchive(params: {
  routeId: string;
  stopId: string;
  startDate: string;
  endDate: string;
  timeWindow: string;
}): Promise<ArchivedResponse | null> {
  if (!baseUrl) {
    if (DEBUG) console.warn('[ArchivedMBTA] MBTA_ARCHIVE_BASE_URL not set');
    return null;
  }
  // TODO: Build exact query params and path for MBTA archive dataset.
  // Example: ArcGIS might use where=..., outFields=..., etc.
  // const url = `${baseUrl}/${dataset}?route_id=${params.routeId}&stop_id=${params.stopId}&start=${params.startDate}&end=${params.endDate}&time_window=${params.timeWindow}`;
  const url = `${baseUrl}${dataset ? `/${dataset}` : ''}`;
  const searchParams = new URLSearchParams({
    route_id: params.routeId,
    stop_id: params.stopId,
    start_date: params.startDate,
    end_date: params.endDate,
    time_window: params.timeWindow,
  });
  const fullUrl = `${url}?${searchParams.toString()}`;
  try {
    const res = await fetch(fullUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = ArchivedResponseSchema.safeParse(Array.isArray(data) ? data[0] : data);
    if (!parsed.success) return null;
    return parsed.data;
  } catch (e) {
    if (DEBUG) console.warn('[ArchivedMBTA] fetch error', e);
    return null;
  }
}

/**
 * Bunching threshold: % of headways < (threshold * scheduledMedian) or < minHeadwayMin.
 * Configurable via env or constant.
 */
const BUNCHING_THRESHOLD_FRACTION = 0.5;
const BUNCHING_MIN_HEADWAY_MIN = 4;

export function createArchivedObservedProviderMBTA(): ArchivedObservedProvider {
  return {
    async fetchArchivedMetrics(options: ArchivedObservedOptions): Promise<ArchivedObservedResult | null> {
      const { routeId, stopId, startDate, endDate, timeWindow } = options;
      const data = await fetchFromArchive({ routeId, stopId, startDate, endDate, timeWindow });
      if (!data) {
        // Graceful degradation: TODO try route-level only endpoint if stop-level isn't available
        // return fetchRouteLevelArchived(routeId, startDate, endDate, timeWindow);
        return null;
      }
      const observedMedian = data.median_headway_minutes ?? 0;
      const p25 = data.p25_headway_minutes ?? 0;
      const p75 = data.p75_headway_minutes ?? 0;
      const bunchingRate = data.bunching_rate ?? 0;
      return {
        routeId,
        stopId,
        observedMedianHeadwayMinutes: observedMedian,
        headwayP25Minutes: p25,
        headwayP75Minutes: p75,
        bunchingRate,
        isRouteLevel: false,
      };
    },
  };
}

export { BUNCHING_THRESHOLD_FRACTION, BUNCHING_MIN_HEADWAY_MIN };

import type { ArchivedObservedResult } from '@/lib/types';

export interface ArchivedObservedOptions {
  routeId: string;
  stopId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /** Map to hour ranges for query (e.g. AM -> 7-9) */
  timeWindow: string;
}

/**
 * MBTA archived last-week observed metrics.
 * Configurable base URL and dataset; TODO: fill in exact query fields/endpoint.
 */
export interface ArchivedObservedProvider {
  fetchArchivedMetrics(options: ArchivedObservedOptions): Promise<ArchivedObservedResult | null>;
}

import type { ArchivedObservedResult } from '@/lib/types';

export interface ArchivedObservedOptions {
  routeId: string;
  stopId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  /**
   * Legacy time window key (AM|PM|AS). Used only when startTime/endTime are absent.
   * @deprecated prefer startTime + endTime
   */
  timeWindow?: string;
  /** Filter to a single service date (YYYY-MM-DD). Overrides startDate/endDate. */
  date?: string;
  /** Start of time window as HH:MM (24h). Overrides timeWindow. */
  startTime?: string;
  /** End of time window as HH:MM (24h). Overrides timeWindow. */
  endTime?: string;
  /** Filter by direction(s). If omitted or empty, includes both. */
  directions?: string[];
}

export interface ArchivedObservedProvider {
  fetchArchivedMetrics(options: ArchivedObservedOptions): Promise<ArchivedObservedResult | null>;
}

import type { ScheduledHeadwayResult } from '@/lib/types';

export interface ScheduleProviderOptions {
  routeIds: string[];
  stopIds: string[];
  /** Service date YYYY-MM-DD */
  serviceDate: string;
  /** Start time HH:MM (24h) */
  startTime: string;
  /** End time HH:MM (24h) */
  endTime: string;
}

/**
 * Computes scheduled median headway from GTFS static for given routes/stops/time window.
 */
export interface ScheduleProvider {
  getScheduledHeadways(options: ScheduleProviderOptions): Promise<ScheduledHeadwayResult[]>;
}

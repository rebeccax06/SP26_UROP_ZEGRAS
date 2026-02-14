import type { LiveObservedResult } from '@/lib/types';

export interface LiveObservedOptions {
  routeId: string;
  stopId: string;
  /** Lookback window in minutes (e.g. 60) */
  windowMinutes?: number;
}

/**
 * Swiftly (or other) real-time observed headways.
 * TODO: Fill in exact Swiftly endpoint paths when known.
 */
export interface LiveObservedProvider {
  fetchLiveHeadways(options: LiveObservedOptions): Promise<LiveObservedResult | null>;
}

import { z } from 'zod';
import { iqr } from '@/lib/utils/iqr';
import { median } from '@/lib/utils/median';
import type { LiveObservedProvider, LiveObservedOptions } from './live-observed';
import type { LiveObservedResult } from '@/lib/types';

const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

const apiKey = process.env.SWIFTLY_API_KEY ?? '';
const baseUrl = process.env.SWIFTLY_BASE_URL ?? 'https://api.goswift.ly';
const agencyId = process.env.SWIFTLY_AGENCY_ID ?? '';

/**
 * TODO: Replace with actual Swiftly API response schema when endpoint is known.
 * If Swiftly provides direct headway stats, use those; else parse arrival events and compute.
 */
const SwiftlyHeadwaySchema = z.object({
  headway_minutes: z.number().optional(),
  median_headway_minutes: z.number().optional(),
  iqr_minutes: z.number().optional(),
  bunching_rate: z.number().optional(),
});

const SwiftlyArrivalSchema = z.object({
  arrival_time: z.string().optional(),
  departure_time: z.string().optional(),
});

function parseIsoToMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * Compute bunching rate: % of headways < 0.5 * median or < 4 min.
 */
function computeBunchingRate(headwaysMinutes: number[], scheduledMedian?: number): number {
  if (headwaysMinutes.length === 0) return 0;
  const threshold = scheduledMedian
    ? Math.min(scheduledMedian * 0.5, BUNCHING_MIN_HEADWAY_MIN)
    : BUNCHING_MIN_HEADWAY_MIN;
  const bunching = headwaysMinutes.filter((h) => h < threshold).length;
  return bunching / headwaysMinutes.length;
}

const BUNCHING_MIN_HEADWAY_MIN = 4;

export function createLiveObservedProviderSwiftly(): LiveObservedProvider {
  return {
    async fetchLiveHeadways(options: LiveObservedOptions): Promise<LiveObservedResult | null> {
      const { routeId, stopId, windowMinutes = 60 } = options;
      if (!apiKey) {
        if (DEBUG) console.warn('[LiveSwiftly] SWIFTLY_API_KEY not set');
        return null;
      }
      // TODO: Fill in exact Swiftly endpoint path for headways or arrivals.
      // Example: GET /v1/agencies/{agency_id}/routes/{route_id}/stops/{stop_id}/headways?window_minutes=60
      const path = agencyId
        ? `/v1/agencies/${agencyId}/routes/${routeId}/stops/${stopId}/headways`
        : `/v1/routes/${routeId}/stops/${stopId}/headways`;
      const url = `${baseUrl}${path}?window_minutes=${windowMinutes}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          if (DEBUG) console.warn('[LiveSwiftly]', res.status, await res.text());
          return null;
        }
        const data = await res.json();
        const parsed = SwiftlyHeadwaySchema.safeParse(Array.isArray(data) ? data[0] : data);
        if (parsed.success && (parsed.data.median_headway_minutes != null || parsed.data.headway_minutes != null)) {
          const med = parsed.data.median_headway_minutes ?? parsed.data.headway_minutes ?? 0;
          return {
            routeId,
            stopId,
            liveMedianHeadwayMinutes: med,
            liveIQRMinutes: parsed.data.iqr_minutes ?? 0,
            liveBunchingRate: parsed.data.bunching_rate ?? 0,
            windowMinutes,
          };
        }
        // Fallback: if API returns arrival events, compute headways
        const arrivals = Array.isArray(data) ? data : data.arrivals ?? data.events ?? [];
        const times = arrivals
          .map((e: unknown) => {
            const ev = SwiftlyArrivalSchema.safeParse(e);
            const t = ev.success ? (ev.data.arrival_time ?? ev.data.departure_time) : null;
            return t ? parseIsoToMinutes(t) : null;
          })
          .filter((t: number | null): t is number => t != null);
        if (times.length < 2) return null;
        times.sort((a: number, b: number) => a - b);
        const headways: number[] = [];
        for (let i = 1; i < times.length; i++) {
          headways.push(times[i]! - times[i - 1]!);
        }
        const liveMedian = median(headways);
        return {
          routeId,
          stopId,
          liveMedianHeadwayMinutes: liveMedian,
          liveIQRMinutes: iqr(headways),
          liveBunchingRate: computeBunchingRate(headways),
          windowMinutes,
        };
      } catch (e) {
        if (DEBUG) console.warn('[LiveSwiftly] fetch error', e);
        return null;
      }
    },
  };
}

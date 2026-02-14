import { loadGtfs, getServiceIdsForDateFromIndex, parseTimeToMinutes } from '@/lib/gtfs/loadGtfs';
import { median } from '@/lib/utils/median';
import type { ScheduleProvider, ScheduleProviderOptions } from './schedule';
import type { ScheduledHeadwayResult } from '@/lib/types';

export function createScheduleProviderGTFS(gtfsDir?: string): ScheduleProvider {
  return {
    async getScheduledHeadways(options: ScheduleProviderOptions): Promise<ScheduledHeadwayResult[]> {
      let index;
      try {
        index = await loadGtfs(gtfsDir);
      } catch (err) {
        console.error('[ScheduleProviderGTFS] Failed to load GTFS:', err);
        throw new Error(`GTFS loading failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const { routeIds, stopIds, serviceDate, startTime, endTime } = options;
      const startMin = parseTimeToMinutes(startTime);
      const endMin = parseTimeToMinutes(endTime);
      const serviceIds = getServiceIdsForDateFromIndex(index, serviceDate);
      const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
      
      if (DEBUG) {
        console.log(`[ScheduleProviderGTFS] Computing headways for ${routeIds.length} routes, ${stopIds.length} stops`);
        console.log(`[ScheduleProviderGTFS] Service date: ${serviceDate}, Time: ${startTime}-${endTime}`);
        console.log(`[ScheduleProviderGTFS] Active service IDs:`, Array.from(serviceIds).slice(0, 5));
        console.log(`[ScheduleProviderGTFS] Sample route IDs:`, routeIds.slice(0, 5));
        console.log(`[ScheduleProviderGTFS] Routes in GTFS index:`, Array.from(index.tripsByRoute.keys()).slice(0, 10));
      }
      
      const results: ScheduledHeadwayResult[] = [];
      let totalTripsChecked = 0;
      let totalTripsOnDate = 0;

      for (const routeId of routeIds) {
        const routeTrips = index.tripsByRoute.get(routeId) ?? [];
        totalTripsChecked += routeTrips.length;
        const tripsOnDate = routeTrips.filter((t) => serviceIds.has(t.service_id));
        totalTripsOnDate += tripsOnDate.length;
        
        if (DEBUG && routeTrips.length > 0 && tripsOnDate.length === 0) {
          console.warn(`[ScheduleProviderGTFS] Route ${routeId}: ${routeTrips.length} trips total, but 0 on ${serviceDate}. Sample service_ids:`, routeTrips.slice(0, 3).map(t => t.service_id));
        }
        const departureMinutesByStop = new Map<string, number[]>();

        for (const trip of tripsOnDate) {
          const stopTimes = index.stopTimesByTrip.get(trip.trip_id) ?? [];
          for (const st of stopTimes) {
            if (!stopIds.includes(st.stop_id)) continue;
            const depMin = parseTimeToMinutes(st.departure_time);
            if (depMin >= startMin && depMin <= endMin) {
              if (!departureMinutesByStop.has(st.stop_id)) departureMinutesByStop.set(st.stop_id, []);
              departureMinutesByStop.get(st.stop_id)!.push(depMin);
            }
          }
        }

        for (const stopId of stopIds) {
          const mins = departureMinutesByStop.get(stopId);
          if (!mins || mins.length < 2) continue;
          mins.sort((a, b) => a - b);
          const diffs: number[] = [];
          for (let i = 1; i < mins.length; i++) {
            diffs.push(mins[i]! - mins[i - 1]!);
          }
          const scheduledMedianHeadwayMinutes = median(diffs);
          results.push({
            routeId,
            stopId,
            scheduledMedianHeadwayMinutes,
            tripCount: mins.length,
          });
        }
      }

      if (DEBUG) {
        console.log(`[ScheduleProviderGTFS] Checked ${totalTripsChecked} trips, ${totalTripsOnDate} on date, computed ${results.length} headways`);
        if (results.length === 0 && totalTripsChecked > 0) {
          console.warn(`[ScheduleProviderGTFS] No headways computed. Possible issues:`);
          console.warn(`  - Service date ${serviceDate} might not match active service`);
          console.warn(`  - Time window ${startTime}-${endTime} might not have trips`);
          console.warn(`  - Route IDs might not match between routes.txt and trips.txt`);
        }
      }

      return results;
    },
  };
}

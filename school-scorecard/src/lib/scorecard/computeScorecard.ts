import type {
  ScorecardRow,
  Stop,
  Route,
  TimeWindowId,
  ScheduledHeadwayResult,
  ArchivedObservedResult,
  LiveObservedResult,
} from '@/lib/types';
import type { ScheduleProvider } from '@/lib/providers/schedule';
import type { ArchivedObservedProvider } from '@/lib/providers/archived-observed';
import type { LiveObservedProvider } from '@/lib/providers/live-observed';
import { getTimeWindowHourRange } from '@/lib/providers/time-window-mapping';

export interface ComputeScorecardInput {
  schoolId: string;
  stopIds: string[];
  routeIds: string[];
  stops: Stop[];
  routes: Route[];
  timeWindow: TimeWindowId;
  startDate: string;
  endDate: string;
  scheduleProvider: ScheduleProvider;
  archivedProvider: ArchivedObservedProvider;
  liveProvider: LiveObservedProvider;
}

export async function computeScorecard(input: ComputeScorecardInput): Promise<ScorecardRow[]> {
  const {
    schoolId,
    stopIds,
    routeIds,
    stops,
    routes,
    timeWindow,
    startDate,
    endDate,
    scheduleProvider,
    archivedProvider,
    liveProvider,
  } = input;

  const range = getTimeWindowHourRange(schoolId, timeWindow);
  const startTime = range?.startTime ?? '07:00';
  const endTime = range?.endTime ?? '09:00';

  const routeMap = new Map(routes.map((r) => [r.routeId, r]));
  const stopMap = new Map(stops.map((s) => [s.stopId, s]));

  // Early return if no routes or stops
  if (routeIds.length === 0 || stopIds.length === 0) {
    console.warn(
      `[computeScorecard] No routes (${routeIds.length}) or stops (${stopIds.length}) found for school ${schoolId}`
    );
    return [];
  }

  const [scheduledList, archivedMap, liveMap] = await Promise.all([
    scheduleProvider.getScheduledHeadways({
      routeIds,
      stopIds,
      serviceDate: startDate,
      startTime,
      endTime,
    }).catch((err) => {
      console.error('[computeScorecard] Scheduled headways error:', err);
      return [] as ScheduledHeadwayResult[];
    }),
    Promise.all(
      routeIds.flatMap((routeId) =>
        stopIds.map((stopId) =>
          archivedProvider.fetchArchivedMetrics({
            routeId,
            stopId,
            startDate,
            endDate,
            timeWindow,
          }).then((r) => ({ key: `${routeId}:${stopId}`, value: r })).catch((err) => {
            console.warn(`[computeScorecard] Archived metrics error for ${routeId}:${stopId}:`, err);
            return { key: `${routeId}:${stopId}`, value: null };
          })
        )
      )
    ).then((pairs) => {
      const m = new Map<string, ArchivedObservedResult | null>();
      pairs.forEach(({ key, value }) => m.set(key, value));
      return m;
    }),
    Promise.all(
      routeIds.flatMap((routeId) =>
        stopIds.map((stopId) =>
          liveProvider.fetchLiveHeadways({ routeId, stopId, windowMinutes: 60 }).then((r) => ({
            key: `${routeId}:${stopId}`,
            value: r,
          })).catch((err) => {
            console.warn(`[computeScorecard] Live headways error for ${routeId}:${stopId}:`, err);
            return { key: `${routeId}:${stopId}`, value: null };
          })
        )
      )
    ).then((pairs) => {
      const m = new Map<string, LiveObservedResult | null>();
      pairs.forEach(({ key, value }) => m.set(key, value));
      return m;
    }),
  ]);

  const scheduledByRouteStop = new Map<string, ScheduledHeadwayResult>();
  for (const s of scheduledList) {
    scheduledByRouteStop.set(`${s.routeId}:${s.stopId}`, s);
  }

  if (scheduledList.length === 0) {
    console.warn(
      `[computeScorecard] No scheduled headways computed for ${routeIds.length} routes, ${stopIds.length} stops, time window ${startTime}-${endTime}, date ${startDate}`
    );
  } else {
    console.log(`[computeScorecard] Computed ${scheduledList.length} scheduled headways`);
  }

  const rows: ScorecardRow[] = [];
  for (const routeId of routeIds) {
    const route = routeMap.get(routeId);
    const routeName = route ? `${route.routeShortName} - ${route.routeLongName}` : routeId;
    const stopResults = stopIds
      .map((stopId) => {
        const scheduled = scheduledByRouteStop.get(`${routeId}:${stopId}`);
        const archived = archivedMap.get(`${routeId}:${stopId}`);
        const live = liveMap.get(`${routeId}:${stopId}`);
        const scheduledMedian = scheduled?.scheduledMedianHeadwayMinutes ?? 0;
        const flags: string[] = [];
        if (archived?.isRouteLevel) flags.push('archived-route-level');
        if (!archived) flags.push('no-archived');
        if (!live) flags.push('no-live');
        const reliabilityArchived =
          scheduledMedian > 0 && archived
            ? archived.observedMedianHeadwayMinutes / scheduledMedian
            : null;
        const reliabilityLive =
          scheduledMedian > 0 && live ? live.liveMedianHeadwayMinutes / scheduledMedian : null;
        return {
          keyStopId: stopId,
          keyStopName: stopMap.get(stopId)?.stopName,
          scheduledMedianMin: scheduledMedian,
          archivedMedianMin: archived?.observedMedianHeadwayMinutes ?? null,
          archivedP25Min: archived?.headwayP25Minutes ?? null,
          archivedP75Min: archived?.headwayP75Minutes ?? null,
          archivedBunchingRate: archived?.bunchingRate ?? null,
          liveMedianMin: live?.liveMedianHeadwayMinutes ?? null,
          liveIQRMin: live?.liveIQRMinutes ?? null,
          liveBunchingRate: live?.liveBunchingRate ?? null,
          reliabilityRatioArchived: reliabilityArchived,
          reliabilityRatioLive: reliabilityLive,
          dataQualityFlags: flags,
        };
      })
      .filter((r) => r.scheduledMedianMin > 0 || r.archivedMedianMin != null || r.liveMedianMin != null);

    if (stopResults.length === 0) continue;
    const keyStop = stopResults[0]!;
    rows.push({
      routeId,
      routeName,
      keyStopId: keyStop.keyStopId,
      keyStopName: keyStop.keyStopName,
      scheduledMedianMin: keyStop.scheduledMedianMin,
      archivedMedianMin: keyStop.archivedMedianMin,
      archivedP25Min: keyStop.archivedP25Min,
      archivedP75Min: keyStop.archivedP75Min,
      archivedBunchingRate: keyStop.archivedBunchingRate,
      liveMedianMin: keyStop.liveMedianMin,
      liveIQRMin: keyStop.liveIQRMin,
      liveBunchingRate: keyStop.liveBunchingRate,
      reliabilityRatioArchived: keyStop.reliabilityRatioArchived,
      reliabilityRatioLive: keyStop.reliabilityRatioLive,
      dataQualityFlags: keyStop.dataQualityFlags,
    });
  }

  rows.sort((a, b) => {
    const ra = a.reliabilityRatioArchived ?? 999;
    const rb = b.reliabilityRatioArchived ?? 999;
    return ra - rb;
  });

  if (rows.length === 0) {
    console.warn(
      `[computeScorecard] No rows generated. Scheduled headways: ${scheduledList.length}, Routes: ${routeIds.length}, Stops: ${stopIds.length}`
    );
  }

  return rows;
}

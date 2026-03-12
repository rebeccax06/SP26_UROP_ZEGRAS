import type {
  ScorecardRow,
  Stop,
  Route,
  ScheduledHeadwayResult,
  ArchivedObservedResult,
  StopWithHeadways,
  StopRouteHeadway,
} from '@/lib/types';
import type { ScheduleProvider } from '@/lib/providers/schedule';
import type { ArchivedObservedProvider } from '@/lib/providers/archived-observed';

export interface ComputeScorecardInput {
  schoolId: string;
  stopIds: string[];
  routeIds: string[];
  stops: Stop[];
  routes: Route[];
  /** Start of time window as HH:MM (24h), e.g. "07:00" */
  startTime: string;
  /** End of time window as HH:MM (24h), e.g. "09:00" */
  endTime: string;
  /** Single service date for CSV filter (YYYY-MM-DD). If omitted, averages across all available dates. */
  date?: string;
  /** @deprecated kept for cache-key compat; prefer startTime/endTime/date */
  startDate: string;
  endDate: string;
  /** Filter by direction(s). If omitted, includes both Inbound and Outbound. */
  directions?: string[];
  scheduleProvider: ScheduleProvider;
  archivedProvider: ArchivedObservedProvider;
}

const RELIABILITY_DELAY_THRESHOLD = 1.2;

export interface ComputeScorecardOutput {
  rows: ScorecardRow[];
  headwaysByStop: StopWithHeadways[];
}

export async function computeScorecard(input: ComputeScorecardInput): Promise<ComputeScorecardOutput> {
  const {
    schoolId,
    stopIds,
    routeIds,
    stops,
    routes,
    startTime,
    endTime,
    date,
    startDate,
    endDate,
    directions,
    scheduleProvider,
    archivedProvider,
  } = input;

  const routeMap = new Map(routes.map((r) => [r.routeId, r]));
  const stopMap = new Map(stops.map((s) => [s.stopId, s]));

  if (routeIds.length === 0 || stopIds.length === 0) {
    console.warn(
      `[computeScorecard] No routes (${routeIds.length}) or stops (${stopIds.length}) found for school ${schoolId}`
    );
    return { rows: [], headwaysByStop: [] };
  }

  const [scheduledList, archivedMap] = await Promise.all([
    scheduleProvider.getScheduledHeadways({
      routeIds,
      stopIds,
      serviceDate: date ?? startDate,
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
            date,
            startTime,
            endTime,
            directions,
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
  ]);

  const scheduledByRouteStop = new Map<string, ScheduledHeadwayResult>();
  for (const s of scheduledList) {
    scheduledByRouteStop.set(`${s.routeId}:${s.stopId}`, s);
  }

  if (scheduledList.length === 0) {
    console.warn(
      `[computeScorecard] No GTFS scheduled headways for ${routeIds.length} routes, ${stopIds.length} stops, ${startTime}–${endTime}`
    );
  }

  const rows: ScorecardRow[] = [];
  for (const routeId of routeIds) {
    const route = routeMap.get(routeId);
    const routeName = route ? `${route.routeShortName} - ${route.routeLongName}` : routeId;
    const stopResults = stopIds
      .map((stopId) => {
        const scheduled = scheduledByRouteStop.get(`${routeId}:${stopId}`);
        const archived = archivedMap.get(`${routeId}:${stopId}`);

        // Prefer GTFS scheduled headway; fall back to CSV computed from scheduled times
        const gtfsScheduled = scheduled?.scheduledMedianHeadwayMinutes ?? 0;
        const csvScheduled = archived?.csvScheduledHeadwayMinutes ?? null;
        const effectiveScheduled = gtfsScheduled > 0
          ? gtfsScheduled
          : (csvScheduled ?? 0);

        const flags: string[] = [];
        if (gtfsScheduled <= 0 && csvScheduled != null && csvScheduled > 0) flags.push('csv-scheduled');
        if (archived?.isRouteLevel) flags.push('archived-route-level');
        if (!archived) flags.push('no-archived');

        const reliabilityArchived =
          effectiveScheduled > 0 && archived
            ? archived.observedMedianHeadwayMinutes / effectiveScheduled
            : null;

        return {
          keyStopId: stopId,
          keyStopName: stopMap.get(stopId)?.stopName,
          scheduledMedianMin: effectiveScheduled,
          archivedMedianMin: archived?.observedMedianHeadwayMinutes ?? null,
          archivedP25Min: archived?.headwayP25Minutes ?? null,
          archivedP75Min: archived?.headwayP75Minutes ?? null,
          archivedBunchingRate: archived?.bunchingRate ?? null,
          reliabilityRatioArchived: reliabilityArchived,
          dataQualityFlags: flags,
        };
      })
      .filter((r) => r.archivedMedianMin != null);

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
      reliabilityRatioArchived: keyStop.reliabilityRatioArchived,
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
      `[computeScorecard] No rows generated. Routes: ${routeIds.length}, Stops: ${stopIds.length}`
    );
  }

  // Build per-stop headways for map
  const headwaysByStop: StopWithHeadways[] = stops.map((stop) => {
    const routeHeadways: StopRouteHeadway[] = [];
    for (const routeId of routeIds) {
      const scheduled = scheduledByRouteStop.get(`${routeId}:${stop.stopId}`);
      const archived = archivedMap.get(`${routeId}:${stop.stopId}`);

      const gtfsScheduled = scheduled?.scheduledMedianHeadwayMinutes ?? 0;
      const csvScheduled = archived?.csvScheduledHeadwayMinutes ?? null;
      const effectiveScheduled = gtfsScheduled > 0
        ? gtfsScheduled
        : (csvScheduled ?? 0);

      if (!archived) continue;

      const reliabilityArchived = effectiveScheduled > 0 && archived
        ? archived.observedMedianHeadwayMinutes / effectiveScheduled
        : null;
      const route = routeMap.get(routeId);
      routeHeadways.push({
        routeId,
        routeShortName: route?.routeShortName ?? routeId,
        scheduledMedianMin: effectiveScheduled,
        archivedMedianMin: archived?.observedMedianHeadwayMinutes ?? null,
        reliabilityRatioArchived: reliabilityArchived,
        csvScheduledMedianMin: csvScheduled,
        hasDelay:
          reliabilityArchived != null && reliabilityArchived >= RELIABILITY_DELAY_THRESHOLD,
      });
    }
    return {
      ...stop,
      routes: routeHeadways,
    };
  });

  return { rows, headwaysByStop };
}

import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import {
  createStopsProviderGTFS,
  createRoutesProviderGTFS,
  createScheduleProviderGTFS,
  createArchivedObservedProviderCSV,
} from '@/lib/providers';
import { computeScorecard } from '@/lib/scorecard/computeScorecard';
import { loadCrowdingAnnotations } from '@/lib/crowding/load-annotations';
import { cacheGet, cacheSet, CACHE_NAMES, TTL } from '@/lib/cache/server-cache';
import type { StopWithHeadways } from '@/lib/types';

const stopsProvider = createStopsProviderGTFS();
const routesProvider = createRoutesProviderGTFS();
const scheduleProvider = createScheduleProviderGTFS();
const archivedProvider = createArchivedObservedProviderCSV();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schoolId = searchParams.get('schoolId') ?? '';
    const radiusParam = searchParams.get('radiusMeters');
    const radiusMeters = radiusParam ? parseInt(radiusParam, 10) : undefined;

    // New params: explicit date and time range (preferred)
    const date = searchParams.get('date') ?? null;           // YYYY-MM-DD, single day
    const startTime = searchParams.get('startTime') ?? '07:00'; // HH:MM
    const endTime = searchParams.get('endTime') ?? '09:00';     // HH:MM

    // Legacy params kept for backward compat
    const startDate = searchParams.get('startDate') ?? (date ?? formatDate(subDays(new Date(), 7)));
    const endDate = searchParams.get('endDate') ?? (date ?? formatDate(new Date()));

    if (!schoolId) {
      return NextResponse.json({ error: 'schoolId required' }, { status: 400 });
    }

    const school = await getSchool(schoolId);
    if (!school) {
      return NextResponse.json({ error: 'School not found' }, { status: 404 });
    }

    const effectiveRadius = radiusMeters ?? school.radiusMeters;
    const cacheKey = `${schoolId}:${date ?? `${startDate}:${endDate}`}:${startTime}:${endTime}:${effectiveRadius}`;

    interface CachedResponse {
      schoolId: string;
      date: string | null;
      startTime: string;
      endTime: string;
      startDate: string;
      endDate: string;
      rows: Awaited<ReturnType<typeof computeScorecard>>['rows'];
      headwaysByStop: Awaited<ReturnType<typeof computeScorecard>>['headwaysByStop'];
      stops: Awaited<ReturnType<typeof stopsProvider.getStopsNear>>;
      routes: Awaited<ReturnType<typeof routesProvider.getRoutesServingStops>>;
    }
    const cached = cacheGet<CachedResponse>(CACHE_NAMES.SCORECARD, cacheKey);
    if (cached) return NextResponse.json(cached);

    const stops = await stopsProvider.getStopsNear({
      lat: school.lat,
      lon: school.lon,
      radiusMeters: effectiveRadius,
    });
    const stopIds = stops.map((s) => s.stopId);
    const routes = stopIds.length ? await routesProvider.getRoutesServingStops(stopIds) : [];
    const routeIds = routes.map((r) => r.routeId);

    const { rows, headwaysByStop } = await computeScorecard({
      schoolId,
      stopIds,
      routeIds,
      stops,
      routes,
      startTime,
      endTime,
      date: date ?? undefined,
      startDate,
      endDate,
      scheduleProvider,
      archivedProvider,
    });

    const crowding = loadCrowdingAnnotations();
    const headwaysByStopWithCrowding: StopWithHeadways[] = headwaysByStop
      .map((stop) => ({
        ...stop,
        routes: stop.routes.map((r) => ({
          ...r,
          hasCrowdingReport: crowding.hasCrowding.has(`${stop.stopId}:${r.routeId}`),
          hasDeniedBoardingsReport: crowding.hasDeniedBoardings.has(`${stop.stopId}:${r.routeId}`),
        })),
      }))
      .filter((stop) => stop.routes.length > 0);

    // Only include stops served by at least one route with data
    const activeStopIds = new Set(headwaysByStopWithCrowding.map((s) => s.stopId));
    const filteredStops = stops.filter((s) => activeStopIds.has(s.stopId));

    const response: CachedResponse = {
      schoolId,
      date,
      startTime,
      endTime,
      startDate,
      endDate,
      rows,
      headwaysByStop: headwaysByStopWithCrowding,
      stops: filteredStops,
      routes,
    };
    cacheSet(CACHE_NAMES.SCORECARD, cacheKey, response, TTL.SCORECARD_MS);
    return NextResponse.json(response);
  } catch (error) {
    console.error('[Scorecard API] Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: 'Internal server error',
        message,
        ...(process.env.DEBUG === 'true' && stack ? { stack } : {}),
      },
      { status: 500 }
    );
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - days);
  return out;
}

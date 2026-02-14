import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import {
  createStopsProviderGTFS,
  createRoutesProviderGTFS,
  createScheduleProviderGTFS,
  createArchivedObservedProviderMBTA,
  createLiveObservedProviderSwiftly,
} from '@/lib/providers';
import { computeScorecard } from '@/lib/scorecard/computeScorecard';
import { cacheGet, cacheSet, CACHE_NAMES, TTL } from '@/lib/cache/server-cache';

const stopsProvider = createStopsProviderGTFS();
const routesProvider = createRoutesProviderGTFS();
const scheduleProvider = createScheduleProviderGTFS();
const archivedProvider = createArchivedObservedProviderMBTA();
const liveProvider = createLiveObservedProviderSwiftly();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schoolId = searchParams.get('schoolId') ?? '';
    const timeWindow = (searchParams.get('timeWindow') ?? 'AM') as 'AM' | 'PM' | 'AS';
    const startDate = searchParams.get('startDate') ?? '';
    const endDate = searchParams.get('endDate') ?? '';
    const radiusParam = searchParams.get('radiusMeters');
    const radiusMeters = radiusParam ? parseInt(radiusParam, 10) : undefined;

    if (!schoolId) {
      return NextResponse.json({ error: 'schoolId required' }, { status: 400 });
    }

    const school = await getSchool(schoolId);
    if (!school) {
      return NextResponse.json({ error: 'School not found' }, { status: 404 });
    }

    const effectiveRadius = radiusMeters ?? school.radiusMeters;
    const effectiveStart = startDate || formatDate(subDays(new Date(), 7));
    const effectiveEnd = endDate || formatDate(new Date());
    const cacheKey = `${schoolId}:${timeWindow}:${effectiveStart}:${effectiveEnd}:${effectiveRadius}`;
    interface CachedResponse {
      schoolId: string;
      timeWindow: string;
      startDate: string;
      endDate: string;
      rows: Awaited<ReturnType<typeof computeScorecard>>;
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

    const rows = await computeScorecard({
      schoolId,
      stopIds,
      routeIds,
      stops,
      routes,
      timeWindow,
      startDate: effectiveStart,
      endDate: effectiveEnd,
      scheduleProvider,
      archivedProvider,
      liveProvider,
    });

    const response: CachedResponse = {
      schoolId,
      timeWindow,
      startDate: effectiveStart,
      endDate: effectiveEnd,
      rows,
      stops,
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

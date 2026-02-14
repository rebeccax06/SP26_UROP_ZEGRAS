import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import { createStopsProviderGTFS, createRoutesProviderGTFS, createScheduleProviderGTFS } from '@/lib/providers';
import { getTimeWindowHourRange } from '@/lib/providers/time-window-mapping';

const stopsProvider = createStopsProviderGTFS();
const routesProvider = createRoutesProviderGTFS();
const scheduleProvider = createScheduleProviderGTFS();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schoolId = searchParams.get('schoolId') ?? 'demo';
    const timeWindow = (searchParams.get('timeWindow') ?? 'AM') as 'AM' | 'PM' | 'AS';
    const radiusMeters = parseInt(searchParams.get('radiusMeters') ?? '800', 10);
    const serviceDate = searchParams.get('serviceDate') ?? new Date().toISOString().slice(0, 10);

    const school = await getSchool(schoolId);
    if (!school) {
      return NextResponse.json({ error: 'School not found' }, { status: 404 });
    }

    const stops = await stopsProvider.getStopsNear({
      lat: school.lat,
      lon: school.lon,
      radiusMeters,
    });

    const stopIds = stops.map((s) => s.stopId);
    const routes = stopIds.length > 0 ? await routesProvider.getRoutesServingStops(stopIds) : [];
    const routeIds = routes.map((r) => r.routeId);

    const range = getTimeWindowHourRange(schoolId, timeWindow);
    const startTime = range?.startTime ?? '07:00';
    const endTime = range?.endTime ?? '09:00';

    const scheduledHeadways = routeIds.length > 0 && stopIds.length > 0
      ? await scheduleProvider.getScheduledHeadways({
          routeIds,
          stopIds,
          serviceDate,
          startTime,
          endTime,
        })
      : [];

    return NextResponse.json({
      school: {
        id: school.id,
        name: school.name,
      },
      timeWindow: {
        id: timeWindow,
        startTime,
        endTime,
      },
      serviceDate,
      radiusMeters,
      stopsFound: stops.length,
      routesFound: routes.length,
      scheduledHeadwaysFound: scheduledHeadways.length,
      scheduledHeadways: scheduledHeadways.slice(0, 10).map((h) => ({
        routeId: h.routeId,
        stopId: h.stopId,
        scheduledMedianHeadwayMinutes: h.scheduledMedianHeadwayMinutes,
        tripCount: h.tripCount,
      })),
      ...(scheduledHeadways.length > 10 ? { note: `Showing first 10 of ${scheduledHeadways.length} headways` } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: message,
        stack: process.env.DEBUG === 'true' ? stack : undefined,
      },
      { status: 500 }
    );
  }
}

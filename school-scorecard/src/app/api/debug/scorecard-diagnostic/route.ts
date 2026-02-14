import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import {
  createStopsProviderGTFS,
  createRoutesProviderGTFS,
  createScheduleProviderGTFS,
} from '@/lib/providers';
import { getTimeWindowHourRange } from '@/lib/providers/time-window-mapping';
import { loadGtfs, getServiceIdsForDateFromIndex } from '@/lib/gtfs/loadGtfs';

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

    const index = await loadGtfs();
    let serviceIds: Set<string>;
    try {
      // Validate serviceDate format
      if (!serviceDate || typeof serviceDate !== 'string') {
        throw new Error(`Invalid serviceDate: ${serviceDate}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
        throw new Error(`Invalid date format: ${serviceDate}. Expected YYYY-MM-DD`);
      }
      serviceIds = getServiceIdsForDateFromIndex(index, serviceDate);
    } catch (err) {
      return NextResponse.json({
        error: `Failed to get service IDs for date ${serviceDate}: ${err instanceof Error ? err.message : String(err)}`,
        serviceDate,
        serviceDateType: typeof serviceDate,
        hint: 'Date should be in YYYY-MM-DD format (e.g., 2025-02-12)',
        received: serviceDate,
      }, { status: 400 });
    }
    
    // Check if routes have trips
    const routeTripCounts: Record<string, { total: number; onDate: number }> = {};
    for (const routeId of routeIds.slice(0, 5)) {
      const trips = index.tripsByRoute.get(routeId) ?? [];
      const tripsOnDate = trips.filter((t) => serviceIds.has(t.service_id));
      routeTripCounts[routeId] = { total: trips.length, onDate: tripsOnDate.length };
    }

    const scheduledHeadways =
      routeIds.length > 0 && stopIds.length > 0
        ? await scheduleProvider.getScheduledHeadways({
            routeIds,
            stopIds,
            serviceDate,
            startTime,
            endTime,
          })
        : [];

    return NextResponse.json({
      diagnostic: 'Why scorecard might be empty',
      school: {
        id: school.id,
        name: school.name,
        lat: school.lat,
        lon: school.lon,
      },
      timeWindow: {
        id: timeWindow,
        startTime,
        endTime,
      },
      serviceDate,
      radiusMeters,
      step1_stopsFound: stops.length,
      step2_routesFound: routes.length,
      step3_activeServiceIds: Array.from(serviceIds).slice(0, 5),
      step4_routeTripCounts: routeTripCounts,
      step5_scheduledHeadwaysFound: scheduledHeadways.length,
      issues: [
        stops.length === 0 && '❌ No stops found near school (check location/radius)',
        routes.length === 0 && '❌ No routes serve the stops',
        scheduledHeadways.length === 0 && routeIds.length > 0 && stopIds.length > 0
          ? '❌ No scheduled headways computed (check service date and time window)'
          : null,
        scheduledHeadways.length > 0 && '✅ Scheduled headways computed successfully',
      ].filter(Boolean),
      recommendations: [
        stops.length === 0 && 'Try increasing radius or check school coordinates',
        routes.length === 0 && 'This might be normal if stops aren\'t served by routes',
        scheduledHeadways.length === 0 &&
          routeIds.length > 0 &&
          stopIds.length > 0 &&
          'Try a weekday date (Monday-Friday) or different time window',
      ].filter(Boolean),
      sampleRouteIds: routeIds.slice(0, 5),
      sampleStopIds: stopIds.slice(0, 5),
      sampleScheduledHeadways: scheduledHeadways.slice(0, 3),
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

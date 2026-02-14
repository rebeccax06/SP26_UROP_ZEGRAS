import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import { createStopsProviderGTFS, createRoutesProviderGTFS } from '@/lib/providers';
import { loadGtfs } from '@/lib/gtfs/loadGtfs';

const stopsProvider = createStopsProviderGTFS();
const routesProvider = createRoutesProviderGTFS();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const schoolId = searchParams.get('schoolId') ?? 'demo';
    const radiusMeters = parseInt(searchParams.get('radiusMeters') ?? '800', 10);

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

    const index = await loadGtfs();
    const gtfsRouteIds = Array.from(index.routes.keys());
    const gtfsTripRouteIds = Array.from(index.tripsByRoute.keys());

    const matchingRoutes = routeIds.filter((id) => gtfsTripRouteIds.includes(id));
    const missingRoutes = routeIds.filter((id) => !gtfsTripRouteIds.includes(id));

    return NextResponse.json({
      school: {
        id: school.id,
        name: school.name,
      },
      routesFound: routes.length,
      routeIdsFromStops: routeIds.slice(0, 10),
      gtfsRoutesTotal: gtfsRouteIds.length,
      gtfsTripRoutesTotal: gtfsTripRouteIds.length,
      matchingRoutes: matchingRoutes.length,
      missingRoutes: missingRoutes.length,
      sampleMissingRoutes: missingRoutes.slice(0, 5),
      sampleGtfsTripRouteIds: gtfsTripRouteIds.slice(0, 10),
      issue:
        missingRoutes.length > 0
          ? `Route IDs from stops don't match route_ids in trips.txt. This is why no scheduled headways are computed.`
          : 'Route IDs match correctly.',
      recommendation:
        missingRoutes.length > 0
          ? 'Check if routes.txt route_id matches trips.txt route_id. MBTA might use different IDs.'
          : null,
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

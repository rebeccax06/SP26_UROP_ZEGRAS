import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import { createStopsProviderGTFS, createRoutesProviderGTFS } from '@/lib/providers';

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

    return NextResponse.json({
      school: {
        id: school.id,
        name: school.name,
      },
      radiusMeters,
      stopsFound: stops.length,
      routesFound: routes.length,
      routes: routes.map((r) => ({
        routeId: r.routeId,
        routeShortName: r.routeShortName,
        routeLongName: r.routeLongName,
      })),
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

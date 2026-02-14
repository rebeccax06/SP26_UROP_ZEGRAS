import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';
import { createStopsProviderGTFS } from '@/lib/providers';

const stopsProvider = createStopsProviderGTFS();

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

    return NextResponse.json({
      school: {
        id: school.id,
        name: school.name,
        lat: school.lat,
        lon: school.lon,
      },
      radiusMeters,
      stopsFound: stops.length,
      stops: stops.slice(0, 20).map((s) => ({
        stopId: s.stopId,
        stopName: s.stopName,
        lat: s.lat,
        lon: s.lon,
        distanceMeters: s.distanceMeters,
      })),
      ...(stops.length > 20 ? { note: `Showing first 20 of ${stops.length} stops` } : {}),
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

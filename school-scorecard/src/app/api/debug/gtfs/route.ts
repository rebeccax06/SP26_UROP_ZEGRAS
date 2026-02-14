import { NextResponse } from 'next/server';
import { loadGtfs, clearGtfsCache } from '@/lib/gtfs/loadGtfs';

export async function GET() {
  try {
    clearGtfsCache();
    const index = await loadGtfs();
    return NextResponse.json({
      success: true,
      stats: {
        stops: index.stops.size,
        routes: index.routes.size,
        trips: Array.from(index.tripsByRoute.values()).reduce((sum, trips) => sum + trips.length, 0),
        stopTimes: index.stopTimesByTrip.size,
        calendar: index.calendar.size,
        calendarDates: index.calendarDates.size,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        success: false,
        error: message,
        stack: process.env.DEBUG === 'true' ? stack : undefined,
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { getRouteStopHeadways } from '@/lib/providers/archived-observed-csv';
import { loadGtfs } from '@/lib/gtfs/loadGtfs';
import type { RouteStopHeadway } from '@/lib/types';

/**
 * GET /api/route-headways?routeId=28&startTime=07:00&endTime=09:00[&date=2026-01-15]
 *
 * Returns per-timepoint-stop headway stats for the given route, enriched with
 * GTFS stop names and coordinates, for use in the map route overlay.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routeId = searchParams.get('routeId') ?? '';
    const startTime = searchParams.get('startTime') ?? '07:00';
    const endTime = searchParams.get('endTime') ?? '09:00';
    const date = searchParams.get('date') ?? undefined;

    if (!routeId) {
      return NextResponse.json({ error: 'routeId required' }, { status: 400 });
    }

    const [csvStops, gtfs] = await Promise.all([
      getRouteStopHeadways(routeId, { startTime, endTime, date }),
      loadGtfs(),
    ]);

    if (csvStops.length === 0) {
      return NextResponse.json(
        { error: `No headway data found for route ${routeId} (${startTime}–${endTime}${date ? ` on ${date}` : ''})` },
        { status: 404 }
      );
    }

    const result: RouteStopHeadway[] = csvStops.flatMap((s) => {
      const gtfsStop = gtfs.stops.get(s.stopId);
      if (!gtfsStop) return [];
      const lat = parseFloat(gtfsStop.stop_lat);
      const lon = parseFloat(gtfsStop.stop_lon);
      if (isNaN(lat) || isNaN(lon)) return [];
      return [{
        stopId: s.stopId,
        stopName: gtfsStop.stop_name,
        lat,
        lon,
        directionId: s.directionId,
        timePointOrder: s.timePointOrder,
        scheduledMedianMin: s.scheduledMedianMin,
        actualMedianMin: s.actualMedianMin,
        ratio: s.ratio,
        sampleCount: s.sampleCount,
      }];
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[route-headways] Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { loadRouteTripSeries } from '@/lib/analysis/routeTripSeries';

/**
 * GET /api/route-trip-series?routeId=28
 *
 * Observed end-to-end half-trip times from the same MBTA CSV as the archived scorecard provider.
 * Scorecard UI uses per-stop headway medians; this series is for trip-duration spike/calendar charts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const routeId = searchParams.get('routeId')?.trim() ?? '';
  if (!routeId) {
    return NextResponse.json({ error: 'routeId required' }, { status: 400 });
  }

  const { csvPath, trips } = await loadRouteTripSeries(routeId);
  return NextResponse.json({
    routeId,
    sourceCsv: csvPath,
    count: trips.length,
    trips,
  });
}

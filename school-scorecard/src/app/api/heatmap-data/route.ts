import { NextResponse } from 'next/server';
import { loadHeatmapData } from '@/lib/analysis/heatmapData';

export const dynamic = 'force-dynamic';

/**
 * GET /api/heatmap-data?routeId=28
 *
 * Returns the aggregated heatmap grid: stops × dates → on_time_rate.
 * Each cell contains the on-time rate, count of on-time trips, and total trips
 * for a given (stop_id, service_date) pair.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const routeId = searchParams.get('routeId')?.trim() ?? '';
  if (!routeId) {
    return NextResponse.json({ error: 'routeId required' }, { status: 400 });
  }

  const payload = await loadHeatmapData(routeId);
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

import { NextResponse } from 'next/server';
import { loadHeatmapDrilldown } from '@/lib/analysis/heatmapData';

/**
 * GET /api/heatmap-drilldown?routeId=28&stopId=XXX&serviceDate=2026-01-15
 *
 * Returns individual trip-level rows for the selected heatmap cell.
 * Used when a user clicks a cell in the interactive heatmap to drill down.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const routeId = searchParams.get('routeId')?.trim() ?? '';
  const stopId = searchParams.get('stopId')?.trim() ?? '';
  const serviceDate = searchParams.get('serviceDate')?.trim() ?? '';

  if (!routeId || !stopId || !serviceDate) {
    return NextResponse.json(
      { error: 'routeId, stopId, and serviceDate are all required' },
      { status: 400 },
    );
  }

  const payload = await loadHeatmapDrilldown(routeId, stopId, serviceDate);
  return NextResponse.json(payload);
}

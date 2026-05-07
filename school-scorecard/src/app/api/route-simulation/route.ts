import { NextResponse } from 'next/server';

import { buildSimulationDataset } from '@/lib/simulation/buildTripsForDate';

const cache = new Map<string, unknown>();

/**
 * GET /api/route-simulation?routeId=28&date=2026-01-15
 *
 * Returns the per-trip scheduled+actual timelines + shapes needed to animate
 * one historical service day. Cached in-process: historical data is immutable.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routeId = searchParams.get('routeId') ?? '';
    const date = searchParams.get('date') ?? '';
    if (!routeId || !date) {
      return NextResponse.json({ error: 'routeId and date required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    const cacheKey = `${routeId}|${date}`;
    let payload = cache.get(cacheKey);
    if (!payload) {
      payload = await buildSimulationDataset(routeId, date);
      cache.set(cacheKey, payload);
    }
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[route-simulation] error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

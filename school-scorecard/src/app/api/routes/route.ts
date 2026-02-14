import { NextResponse } from 'next/server';
import { createRoutesProviderGTFS } from '@/lib/providers';
import { cacheGet, cacheSet, CACHE_NAMES, TTL } from '@/lib/cache/server-cache';

const routesProvider = createRoutesProviderGTFS();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stopIdsParam = searchParams.get('stopIds');
  const stopIds = stopIdsParam ? stopIdsParam.split(',').filter(Boolean) : [];
  if (stopIds.length === 0) {
    return NextResponse.json({ error: 'stopIds required' }, { status: 400 });
  }
  const cacheKey = stopIds.sort().join(',');
  const cached = cacheGet<Awaited<ReturnType<typeof routesProvider.getRoutesServingStops>>>(CACHE_NAMES.ROUTES, cacheKey);
  if (cached) return NextResponse.json(cached);
  const routes = await routesProvider.getRoutesServingStops(stopIds);
  cacheSet(CACHE_NAMES.ROUTES, cacheKey, routes, TTL.ROUTES_MS);
  return NextResponse.json(routes);
}

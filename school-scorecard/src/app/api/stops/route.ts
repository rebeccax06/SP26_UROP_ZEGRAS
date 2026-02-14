import { NextResponse } from 'next/server';
import { createStopsProviderGTFS } from '@/lib/providers';
import { cacheGet, cacheSet, CACHE_NAMES, TTL } from '@/lib/cache/server-cache';

const stopsProvider = createStopsProviderGTFS();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') ?? '');
  const lon = parseFloat(searchParams.get('lon') ?? '');
  const radiusMeters = parseInt(searchParams.get('radiusMeters') ?? '800', 10);
  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json({ error: 'lat and lon required' }, { status: 400 });
  }
  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusMeters}`;
  const cached = cacheGet<Awaited<ReturnType<typeof stopsProvider.getStopsNear>>>(CACHE_NAMES.STOPS, cacheKey);
  if (cached) return NextResponse.json(cached);
  const stops = await stopsProvider.getStopsNear({ lat, lon, radiusMeters });
  cacheSet(CACHE_NAMES.STOPS, cacheKey, stops, TTL.STOPS_MS);
  return NextResponse.json(stops);
}

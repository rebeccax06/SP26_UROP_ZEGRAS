import { NextResponse } from 'next/server';
import { loadBusRidershipStopsForTrip, loadBusRidershipTripOptions } from '@/lib/analysis/busRidershipByTrip';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const routeId = searchParams.get('routeId')?.trim();
  if (!routeId) {
    return NextResponse.json({ error: 'routeId is required' }, { status: 400 });
  }

  const dayTypeId = searchParams.get('dayTypeId')?.trim();
  const directionId = searchParams.get('directionId')?.trim();
  const tripStartTime = searchParams.get('tripStartTime')?.trim();
  const routeVariant = searchParams.get('routeVariant')?.trim();

  if (dayTypeId && directionId !== undefined && directionId !== '' && tripStartTime && routeVariant) {
    const stops = await loadBusRidershipStopsForTrip(routeId, {
      dayTypeId,
      directionId,
      tripStartTime,
      routeVariant,
    });
    return NextResponse.json({ stops });
  }

  const { csvPath, seasonLabel, trips } = await loadBusRidershipTripOptions(routeId);
  return NextResponse.json({ csvPath, seasonLabel, trips });
}

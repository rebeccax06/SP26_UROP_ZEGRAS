import { readFileSync } from 'fs';
import { NextResponse } from 'next/server';
import { getAnalysisFilePath } from '@/lib/analysis/getAnalysisFilePath';
import { loadBusRidershipAvgLoadByStopDirection, pickRidershipLoadForOverlayStop } from '@/lib/analysis/busRidershipByTrip';
import { loadHeatmapAlignedOnTimeByStopForDate } from '@/lib/analysis/heatmapData';
import { loadGtfs, getShapeCoordinatesForRouteDirection } from '@/lib/gtfs/loadGtfs';
import { getRouteStopHeadways } from '@/lib/providers/archived-observed-csv';
import type { RouteStopHeadway } from '@/lib/types';

/** Map app directionId to analysis direction_id (CSV may use "0"/"1" or "Inbound"/"Outbound") */
function analysisDirectionMatch(appDir: string, analysisDir: string): boolean {
  if (appDir === analysisDir) return true;
  if ((appDir === 'Inbound' && analysisDir === '1') || (appDir === 'Outbound' && analysisDir === '0')) return true;
  if ((appDir === 'Inbound' && analysisDir === '0') || (appDir === 'Outbound' && analysisDir === '1')) return false;
  return false;
}

/**
 * GET /api/route-headways?routeId=28&startTime=07:00&endTime=09:00[&date=2026-01-15][&hour=11]
 *
 * Returns per-timepoint-stop headway stats for the given route, enriched with
 * GTFS stop names and coordinates. When hour is set and analysis JSON exists,
 * merges bunchingRate for map segment coloring.
 *
 * When `date` is set, onTimeRate is taken from the same CSV aggregation as the route
 * on-time heatmap (full service day, per stop_id, min 5 samples), not from analysis JSON,
 * so map coloring matches `/route-heatmap` for that calendar day.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routeId = searchParams.get('routeId') ?? '';
    const startTime = searchParams.get('startTime') ?? '07:00';
    const endTime = searchParams.get('endTime') ?? '09:00';
    const date = searchParams.get('date') ?? undefined;
    const hourParam = searchParams.get('hour');

    if (!routeId) {
      return NextResponse.json({ error: 'routeId required' }, { status: 400 });
    }

    const [csvStops, gtfs, heatmapOnTimeByStop, ridershipLoads] = await Promise.all([
      getRouteStopHeadways(routeId, { startTime, endTime, date }),
      loadGtfs(),
      date ? loadHeatmapAlignedOnTimeByStopForDate(routeId, date) : Promise.resolve(null),
      loadBusRidershipAvgLoadByStopDirection(routeId),
    ]);

    if (csvStops.length === 0) {
      return NextResponse.json(
        { error: `No headway data found for route ${routeId} (${startTime}–${endTime}${date ? ` on ${date}` : ''})` },
        { status: 404 }
      );
    }

    let analysisList: { stop_id: string; direction_id: string; on_time_rate?: number | null; bunching_rate?: number | null }[] = [];
    const analysisPath = getAnalysisFilePath(routeId);
    if (analysisPath) {
      try {
        const raw = readFileSync(analysisPath, 'utf-8');
        const data: { overall?: { stop_id: string; direction_id: string; on_time_rate?: number | null; bunching_rate?: number | null }[]; byHour?: Record<string, { stop_id: string; direction_id: string; on_time_rate?: number | null; bunching_rate?: number | null }[]> } = JSON.parse(raw);
        if (hourParam !== null && hourParam !== undefined && hourParam !== '') {
          const hour = parseInt(hourParam, 10);
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23 && data.byHour?.[String(hour)]) {
            analysisList = data.byHour[String(hour)];
          } else {
            analysisList = data.overall ?? [];
          }
        } else {
          analysisList = data.overall ?? [];
        }
      } catch {
        // ignore
      }
    }

    const result: RouteStopHeadway[] = csvStops.flatMap((s) => {
      const gtfsStop = gtfs.stops.get(s.stopId);
      if (!gtfsStop) return [];
      const lat = parseFloat(gtfsStop.stop_lat);
      const lon = parseFloat(gtfsStop.stop_lon);
      if (isNaN(lat) || isNaN(lon)) return [];
      const analysisRow = analysisList.find(
        (a) => a.stop_id === s.stopId && analysisDirectionMatch(s.directionId, String(a.direction_id))
      );
      const heatCell = heatmapOnTimeByStop?.get(s.stopId);
      const ridershipLoad = pickRidershipLoadForOverlayStop(ridershipLoads, s.stopId, s.directionId);
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
        onTimeRate:
          heatmapOnTimeByStop != null
            ? (heatCell?.onTimeRate ?? null)
            : (analysisRow?.on_time_rate ?? null),
        bunchingRate: analysisRow?.bunching_rate ?? null,
        ridershipLoad,
      }];
    });

    const shapes: Record<string, [number, number][]> = {};
    const dirMap: Record<string, string> = { Inbound: '1', Outbound: '0' };
    for (const [appDir, gtfsDir] of Object.entries(dirMap)) {
      const coords = getShapeCoordinatesForRouteDirection(gtfs, routeId, gtfsDir);
      if (coords) shapes[appDir] = coords;
    }

    return NextResponse.json({ stops: result, shapes });
  } catch (error) {
    console.error('[route-headways] Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

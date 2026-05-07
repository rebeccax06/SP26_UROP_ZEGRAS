/**
 * Route 1 heatmap Y-axis: `stop_id` order from the **longest** GTFS `stop_times` trip on route 1
 * (Massachusetts Ave corridor). Matches how the scorecard picks a stable line order when no
 * hand-maintained corridor list exists (unlike route 28).
 */

import { loadGtfs } from '@/lib/gtfs/loadGtfs';

function normId(id: string): string {
  return String(id ?? '').trim();
}

/**
 * Ordered `stop_id`s along route 1 from one representative trip (most timepoints), or `null`
 * if GTFS is missing or route 1 is not found.
 */
export async function getRoute1HeatmapYAxisStopIdsFromGtfs(): Promise<string[] | null> {
  try {
    const idx = await loadGtfs();
    const routeIdsToScan = new Set<string>(['1']);
    for (const r of Array.from(idx.routes.values())) {
      if (normId(r.route_short_name) === '1') routeIdsToScan.add(r.route_id);
    }

    let bestTripId: string | null = null;
    let bestLen = 0;
    for (const rid of Array.from(routeIdsToScan)) {
      const trips = idx.tripsByRoute.get(rid);
      if (!trips) continue;
      for (const t of trips) {
        const sts = idx.stopTimesByTrip.get(t.trip_id);
        const n = sts?.length ?? 0;
        if (n > bestLen) {
          bestLen = n;
          bestTripId = t.trip_id;
        }
      }
    }
    if (!bestTripId || bestLen === 0) return null;

    const sts = idx.stopTimesByTrip.get(bestTripId)!;
    const sorted = [...sts].sort(
      (a, b) =>
        parseInt(String(a.stop_sequence), 10) - parseInt(String(b.stop_sequence), 10),
    );
    const seen = new Set<string>();
    const out: string[] = [];
    for (const st of sorted) {
      const sid = normId(st.stop_id ?? '');
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      out.push(sid);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function getRoute1HeatmapStopRankResolved(): Promise<Map<string, number>> {
  const axis = await getRoute1HeatmapYAxisStopIdsFromGtfs();
  const rank = new Map<string, number>();
  if (!axis) return rank;
  axis.forEach((id, i) => rank.set(normId(id), i));
  return rank;
}

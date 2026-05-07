/**
 * Split a route shape (or straight stop-to-stop lines) into segments "leading to" each stop,
 * each segment colored by the destination stop's metric (e.g. on-time rate, bunching rate).
 */

export interface StopForSegment {
  stopId: string;
  lat: number;
  lon: number;
  timePointOrder: number;
  /** Hex color for this stop's segment (e.g. from heatmap scale) */
  color: string;
  /** Optional raw value for tooltips/legend */
  metricValue?: number;
}

/**
 * Find the index into the shape array that is closest to the given point (lon, lat).
 */
function closestShapeIndex(shape: [number, number][], lon: number, lat: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const [sLon, sLat] = shape[i]!;
    const d = (sLon - lon) ** 2 + (sLat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Build segments from shape geometry. Each segment runs from the previous stop's
 * position on the shape to the current stop's position; segment color = destination stop's color.
 * Stops must be sorted by timePointOrder.
 */
export function buildSegmentsFromShape(
  stops: StopForSegment[],
  shape: [number, number][]
): { coordinates: [number, number][]; color: string; metricValue?: number }[] {
  if (stops.length === 0) return [];
  if (stops.length === 1) {
    return [{ coordinates: [[stops[0]!.lon, stops[0]!.lat]], color: stops[0]!.color, metricValue: stops[0]!.metricValue }];
  }
  const segments: { coordinates: [number, number][]; color: string; metricValue?: number }[] = [];
  const indices: number[] = [];
  for (const stop of stops) {
    indices.push(closestShapeIndex(shape, stop.lon, stop.lat));
  }
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    const startIdx = i === 0 ? 0 : indices[i - 1]!;
    const endIdx = indices[i]!;
    const coords: [number, number][] = [];
    const step = startIdx <= endIdx ? 1 : -1;
    for (let j = startIdx; step > 0 ? j <= endIdx : j >= endIdx; j += step) {
      const pt = shape[j];
      if (pt) coords.push([...pt]);
    }
    if (coords.length < 2 && i > 0) {
      coords.unshift([stops[i - 1]!.lon, stops[i - 1]!.lat]);
      coords.push([stop.lon, stop.lat]);
    }
    if (coords.length >= 1) {
      segments.push({ coordinates: coords, color: stop.color, metricValue: stop.metricValue });
    }
  }
  return segments;
}

/**
 * Build segments as straight lines between consecutive stops when no shape is available.
 */
export function buildSegmentsStraightLine(
  stops: StopForSegment[]
): { coordinates: [number, number][]; color: string; metricValue?: number }[] {
  const segments: { coordinates: [number, number][]; color: string; metricValue?: number }[] = [];
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    const prev = i > 0 ? stops[i - 1]! : null;
    const coords: [number, number][] = prev
      ? [[prev.lon, prev.lat], [stop.lon, stop.lat]]
      : [[stop.lon, stop.lat], [stop.lon, stop.lat]]; // LineString needs ≥2 points
    segments.push({ coordinates: coords, color: stop.color, metricValue: stop.metricValue });
  }
  return segments;
}

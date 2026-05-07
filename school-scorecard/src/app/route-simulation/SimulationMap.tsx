'use client';

/**
 * Mapbox map dedicated to the bus simulation. Owns its own map instance
 * (not entangled with `SchoolMap.tsx`) and exposes `setSnapshots` so the
 * parent page can pump per-frame positions in via a ref.
 */

import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';

import type { TripSnapshot } from '@/lib/simulation/tripPositions';

export interface SimulationMapHandle {
  /** Replace the dot/leash positions for the current frame. */
  setSnapshots(snapshots: TripSnapshot[]): void;
}

interface Props {
  mapboxToken: string;
  /** [lon, lat][] arrays per GTFS direction_id ("0"|"1"). */
  shapesByDirection: Record<string, [number, number][]>;
  /** Optional initial center; otherwise we fit to the route bounds. */
  initialCenter?: [number, number];
  initialZoom?: number;
}

type MapboxMap = import('mapbox-gl').Map;

const COLOR_SCHEDULED = '#2563eb';     // blue
const COLOR_ACTUAL_KNOWN = '#dc2626';  // red
const COLOR_ROUTE_LINE = '#cbd5e1';    // pale gray
const COLOR_LEASH = '#6b7280';         // gray

const SRC_ROUTE = 'sim-route';
const SRC_SCHED = 'sim-scheduled';
const SRC_ACTUAL = 'sim-actual';
const SRC_LEASH = 'sim-leash';

const LYR_ROUTE = 'sim-route-line';
const LYR_LEASH = 'sim-leash-line';
const LYR_SCHED = 'sim-scheduled-circle';
const LYR_ACTUAL = 'sim-actual-circle';

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function computeRouteBounds(
  shapes: Record<string, [number, number][]>,
): [[number, number], [number, number]] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  let any = false;
  for (const coords of Object.values(shapes)) {
    for (const [lon, lat] of coords) {
      any = true;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!any) return null;
  return [[minLon, minLat], [maxLon, maxLat]];
}

const SimulationMap = forwardRef<SimulationMapHandle, Props>(function SimulationMap(
  { mapboxToken, shapesByDirection, initialCenter, initialZoom },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapLoadedRef = useRef(false);
  // Stash the latest snapshots if they arrive before the map is ready.
  const pendingSnapshotsRef = useRef<TripSnapshot[] | null>(null);
  const shapesRef = useRef(shapesByDirection);

  useEffect(() => { shapesRef.current = shapesByDirection; }, [shapesByDirection]);

  useImperativeHandle(ref, () => ({
    setSnapshots(snapshots: TripSnapshot[]) {
      pendingSnapshotsRef.current = snapshots;
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      applySnapshots(map, snapshots);
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    let cancelled = false;
    let mapInstance: MapboxMap | null = null;

    void import('mapbox-gl').then((mapboxgl) => {
      if (cancelled || !containerRef.current) return;
      mapboxgl.default.accessToken = mapboxToken;
      const bounds = computeRouteBounds(shapesRef.current);
      const center: [number, number] = initialCenter
        ?? (bounds ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2] : [-71.06, 42.36]);
      const map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center,
        zoom: initialZoom ?? 12,
      });
      mapInstance = map;
      map.addControl(new mapboxgl.default.NavigationControl(), 'top-right');

      map.on('load', () => {
        if (cancelled) return;
        mapLoadedRef.current = true;

        // Route line — drawn once (or when shapes prop changes via the effect below).
        map.addSource(SRC_ROUTE, { type: 'geojson', data: shapesToGeoJson(shapesRef.current) });
        map.addLayer({
          id: LYR_ROUTE,
          type: 'line',
          source: SRC_ROUTE,
          paint: {
            'line-color': COLOR_ROUTE_LINE,
            'line-width': 4,
            'line-opacity': 0.9,
          },
        });

        // Leash lines (rendered under dots).
        map.addSource(SRC_LEASH, { type: 'geojson', data: emptyFeatureCollection() });
        map.addLayer({
          id: LYR_LEASH,
          type: 'line',
          source: SRC_LEASH,
          paint: {
            'line-color': COLOR_LEASH,
            'line-width': 1.5,
            'line-opacity': 0.7,
            'line-dasharray': [2, 2],
          },
        });

        // Dots.
        map.addSource(SRC_SCHED, { type: 'geojson', data: emptyFeatureCollection() });
        map.addSource(SRC_ACTUAL, { type: 'geojson', data: emptyFeatureCollection() });
        map.addLayer({
          id: LYR_SCHED,
          type: 'circle',
          source: SRC_SCHED,
          paint: {
            'circle-radius': 6,
            'circle-color': COLOR_SCHEDULED,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
          },
        });
        // Actual: smaller filled circle so it reads as an overlay on the
        // scheduled dot rather than competing with it.
        map.addLayer({
          id: LYR_ACTUAL,
          type: 'circle',
          source: SRC_ACTUAL,
          paint: {
            'circle-radius': 4.5,
            'circle-color': COLOR_ACTUAL_KNOWN,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        });

        // Fit to bounds once everything is set up. Defer one frame so the
        // container has its final laid-out size; otherwise fitBounds computes
        // against an undersized canvas and crops the south end of the route.
        const fit = () => {
          map.resize();
          const b = computeRouteBounds(shapesRef.current);
          if (b) map.fitBounds(b, { padding: 40, animate: false });
        };
        requestAnimationFrame(fit);

        if (pendingSnapshotsRef.current) {
          applySnapshots(map, pendingSnapshotsRef.current);
        }
      });

      // Re-fit on container resize (e.g. window resize, layout settling).
      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        const ro = new ResizeObserver(() => {
          if (!mapLoadedRef.current) return;
          map.resize();
        });
        ro.observe(containerRef.current);
        // Stash on the map instance so we can disconnect on unmount.
        (map as unknown as { __ro?: ResizeObserver }).__ro = ro;
      }

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      mapLoadedRef.current = false;
      if (mapInstance) {
        const ro = (mapInstance as unknown as { __ro?: ResizeObserver }).__ro;
        ro?.disconnect();
        mapInstance.remove();
      }
      mapRef.current = null;
    };
  }, [mapboxToken, initialCenter, initialZoom]);

  // If the route shape changes (different routeId), refresh the route source
  // and re-fit. The dots are fed via the imperative handle so they catch up
  // on the next frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    const src = map.getSource(SRC_ROUTE) as
      | (import('mapbox-gl').GeoJSONSource & { setData: (d: GeoJSON.GeoJSON) => void })
      | undefined;
    src?.setData(shapesToGeoJson(shapesByDirection));
    const b = computeRouteBounds(shapesByDirection);
    if (b) map.fitBounds(b, { padding: 40, animate: false });
  }, [shapesByDirection]);

  if (!mapboxToken) {
    return (
      <div style={{
        width: '100%', height: '100%', minHeight: 480, background: '#f3f4f6',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280',
        fontFamily: 'system-ui, sans-serif',
      }}>
        Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to show the map.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 640, borderRadius: 8 }} />
  );
});

export default SimulationMap;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function shapesToGeoJson(shapes: Record<string, [number, number][]>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [dir, coords] of Object.entries(shapes)) {
    if (coords.length < 2) continue;
    features.push({
      type: 'Feature',
      properties: { directionId: dir },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

function applySnapshots(map: MapboxMap, snapshots: TripSnapshot[]) {
  const schedFeatures: GeoJSON.Feature[] = [];
  const actualFeatures: GeoJSON.Feature[] = [];
  const leashFeatures: GeoJSON.Feature[] = [];
  for (const snap of snapshots) {
    schedFeatures.push({
      type: 'Feature',
      properties: { tripId: snap.tripId, dir: snap.directionId },
      geometry: { type: 'Point', coordinates: snap.scheduled.position },
    });
    // Only render the actual marker (and its leash) when we have observed data
    // for this exact moment. When the actual is "missing", the gray dot would
    // either ride the scheduled (redundant) or be stuck at the last known
    // timepoint (misleading) — easier to read with just the scheduled dot.
    if (snap.actual.kind === 'actualKnown') {
      actualFeatures.push({
        type: 'Feature',
        properties: { tripId: snap.tripId, dir: snap.directionId },
        geometry: { type: 'Point', coordinates: snap.actual.position },
      });
      leashFeatures.push({
        type: 'Feature',
        properties: { tripId: snap.tripId },
        geometry: { type: 'LineString', coordinates: [snap.scheduled.position, snap.actual.position] },
      });
    }
  }
  const schedSrc = map.getSource(SRC_SCHED) as
    | (import('mapbox-gl').GeoJSONSource & { setData: (d: GeoJSON.GeoJSON) => void })
    | undefined;
  const actualSrc = map.getSource(SRC_ACTUAL) as
    | (import('mapbox-gl').GeoJSONSource & { setData: (d: GeoJSON.GeoJSON) => void })
    | undefined;
  const leashSrc = map.getSource(SRC_LEASH) as
    | (import('mapbox-gl').GeoJSONSource & { setData: (d: GeoJSON.GeoJSON) => void })
    | undefined;
  schedSrc?.setData({ type: 'FeatureCollection', features: schedFeatures });
  actualSrc?.setData({ type: 'FeatureCollection', features: actualFeatures });
  leashSrc?.setData({ type: 'FeatureCollection', features: leashFeatures });
}

'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Stop, StopWithHeadways, RouteStopHeadway } from '@/lib/types';
import 'mapbox-gl/dist/mapbox-gl.css';

interface SchoolMapProps {
  schoolLat: number;
  schoolLon: number;
  stops: Stop[] | StopWithHeadways[];
  mapboxToken: string;
  routeIdsWithDelay?: string[];
  /** When set, draws the route on the map with stops color-coded by headway ratio */
  routeOverlay?: RouteStopHeadway[] | null;
  selectedRouteName?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ratioColor(ratio: number): string {
  if (ratio <= 1.0) return '#16a34a'; // green — on time
  if (ratio <= 1.2) return '#ca8a04'; // amber — slightly late
  return '#dc2626';                   // red — delayed
}

function buildStopPopupHtml(stop: Stop | StopWithHeadways): string {
  const withHeadways = stop as StopWithHeadways;
  const routes = withHeadways.routes;
  const dist = stop.distanceMeters != null ? `${stop.distanceMeters} m` : '';
  let html = `<strong>${stop.stopName}</strong>`;
  if (dist) html += `<br/>${dist}`;
  if (routes?.length) {
    html += '<br/><br/><strong>Headways</strong>';
    const hasCsvData = routes.some((r) => r.csvScheduledMedianMin != null && r.archivedMedianMin != null);
    if (hasCsvData) {
      html += '<br/><span style="font-size:11px;color:#6b7280">Route &nbsp;&nbsp; Sched → Actual</span>';
    }
    routes.forEach((r) => {
      const schedMin = r.csvScheduledMedianMin ?? (r.scheduledMedianMin > 0 ? r.scheduledMedianMin : null);
      const actualMin = r.archivedMedianMin;
      let headwayStr: string;
      if (schedMin != null && actualMin != null) {
        const color = r.hasDelay ? '#dc2626' : '#16a34a';
        headwayStr = `${schedMin.toFixed(0)} min → <span style="color:${color};font-weight:600">${actualMin.toFixed(0)} min</span>`;
      } else if (actualMin != null) {
        headwayStr = `${actualMin.toFixed(0)} min (actual)`;
      } else if (schedMin != null) {
        headwayStr = `${schedMin.toFixed(0)} min (sched)`;
      } else {
        headwayStr = '—';
      }
      const delayBadge = r.hasDelay ? ' <span style="color:#dc2626;font-size:11px">▲ delayed</span>' : '';
      const crowdingBadge = r.hasCrowdingReport ? ' <span style="color:#b45309;font-size:11px">(crowding)</span>' : '';
      const deniedBadge = r.hasDeniedBoardingsReport ? ' <span style="color:#b45309;font-size:11px">(denied boardings)</span>' : '';
      html += `<br/>Route ${r.routeShortName}: ${headwayStr}${delayBadge}${crowdingBadge}${deniedBadge}`;
    });
  }
  return html;
}

// ---------------------------------------------------------------------------
// Route overlay — applied/removed on the live map instance
// ---------------------------------------------------------------------------

const ROUTE_LAYERS = ['route-stops-labels', 'route-stops-layer', 'route-line-out', 'route-line-in'];
const ROUTE_SOURCES = ['route-stops', 'route-line-in', 'route-line-out'];

type MapboxMap = import('mapbox-gl').Map;

function applyRouteOverlay(map: MapboxMap, overlay: RouteStopHeadway[] | null | undefined) {
  // Always clean up first
  ROUTE_LAYERS.forEach((id) => { try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ } });
  ROUTE_SOURCES.forEach((id) => { try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ } });

  if (!overlay?.length) return;

  const inbound = overlay
    .filter((s) => s.directionId === 'Inbound')
    .sort((a, b) => a.timePointOrder - b.timePointOrder);
  const outbound = overlay
    .filter((s) => s.directionId === 'Outbound')
    .sort((a, b) => a.timePointOrder - b.timePointOrder);

  // Route lines
  if (inbound.length > 1) {
    map.addSource('route-line-in', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: inbound.map((s) => [s.lon, s.lat]) }, properties: {} },
    });
    map.addLayer({ id: 'route-line-in', type: 'line', source: 'route-line-in',
      paint: { 'line-color': '#6366f1', 'line-width': 3, 'line-opacity': 0.7 } });
  }
  if (outbound.length > 1) {
    map.addSource('route-line-out', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: outbound.map((s) => [s.lon, s.lat]) }, properties: {} },
    });
    map.addLayer({ id: 'route-line-out', type: 'line', source: 'route-line-out',
      paint: { 'line-color': '#818cf8', 'line-width': 3, 'line-opacity': 0.7, 'line-dasharray': [3, 2] } });
  }

  // Stop circles
  map.addSource('route-stops', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: overlay.map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
        properties: {
          stopName: s.stopName,
          direction: s.directionId,
          scheduled: s.scheduledMedianMin.toFixed(1),
          actual: s.actualMedianMin.toFixed(1),
          ratio: s.ratio.toFixed(2),
          color: ratioColor(s.ratio),
        },
      })),
    },
  });

  map.addLayer({
    id: 'route-stops-layer', type: 'circle', source: 'route-stops',
    paint: {
      'circle-radius': 11,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });

  map.addLayer({
    id: 'route-stops-labels', type: 'symbol', source: 'route-stops',
    layout: {
      'text-field': ['concat', ['get', 'actual'], ' min'],
      'text-size': 10,
      'text-offset': [0, 1.6],
      'text-anchor': 'top',
    },
    paint: { 'text-color': '#1f2937', 'text-halo-color': '#fff', 'text-halo-width': 1 },
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SchoolMap({
  schoolLat,
  schoolLon,
  stops,
  mapboxToken,
  routeIdsWithDelay = [],
  routeOverlay,
  selectedRouteName,
}: SchoolMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapLoadedRef = useRef(false);
  const stopMarkersRef = useRef<import('mapbox-gl').Marker[]>([]);
  // Keep latest routeOverlay in a ref so the load callback can access it
  const routeOverlayRef = useRef(routeOverlay);
  useEffect(() => { routeOverlayRef.current = routeOverlay; }, [routeOverlay]);

  const initMap = useCallback(() => {
    if (!containerRef.current || !mapboxToken) return;
    import('mapbox-gl').then((mapboxgl) => {
      mapboxgl.default.accessToken = mapboxToken;
      const map = new mapboxgl.default.Map({
        container: containerRef.current!,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [schoolLon, schoolLat],
        zoom: 14,
      });
      map.addControl(new mapboxgl.default.NavigationControl(), 'top-right');

      new mapboxgl.default.Marker({ color: '#2563eb' })
        .setLngLat([schoolLon, schoolLat])
        .setPopup(new mapboxgl.default.Popup().setHTML('<strong>School</strong>'))
        .addTo(map);

      stopMarkersRef.current = [];
      stops.forEach((stop) => {
        const marker = new mapboxgl.default.Marker({ color: '#16a34a' })
          .setLngLat([stop.lon, stop.lat])
          .setPopup(new mapboxgl.default.Popup().setHTML(buildStopPopupHtml(stop)))
          .addTo(map);
        stopMarkersRef.current.push(marker);
      });

      map.on('load', () => {
        mapLoadedRef.current = true;
        // Apply any overlay that arrived before the map finished loading
        if (routeOverlayRef.current?.length) {
          applyRouteOverlay(map, routeOverlayRef.current);
        }

        // Click popup for route stop circles
        map.on('click', 'route-stops-layer', (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const props = feature.properties as Record<string, string>;
          const html = `
            <strong>${props.stopName}</strong><br/>
            <span style="font-size:11px;color:#6b7280">${props.direction}</span><br/><br/>
            <span style="font-size:12px">
              Sched: <b>${props.scheduled} min</b><br/>
              Actual: <b style="color:${ratioColor(parseFloat(props.ratio))}">${props.actual} min</b><br/>
              Ratio: <b style="color:${ratioColor(parseFloat(props.ratio))}">${props.ratio}</b>
            </span>
          `;
          new mapboxgl.default.Popup({ offset: 14 })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map);
        });
        map.on('mouseenter', 'route-stops-layer', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'route-stops-layer', () => {
          map.getCanvas().style.cursor = '';
        });
      });

      mapRef.current = map;
    });
  }, [schoolLat, schoolLon, mapboxToken, stops]);

  useEffect(() => {
    mapLoadedRef.current = false;
    initMap();
    return () => {
      mapLoadedRef.current = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  // Update route overlay whenever it changes (without re-initializing the map)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyRouteOverlay(map, routeOverlay);
  }, [routeOverlay]);

  // Hide/show the green stop markers when a route overlay is active
  useEffect(() => {
    const hasOverlay = routeOverlay != null && routeOverlay.length > 0;
    stopMarkersRef.current.forEach((marker) => {
      marker.getElement().style.display = hasOverlay ? 'none' : '';
    });
  }, [routeOverlay]);

  if (!mapboxToken) {
    return (
      <div className="map-container" style={{ background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p>Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to show the map.</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} className="map-container" style={{ width: '100%', height: '100%', minHeight: 400 }} />
      {selectedRouteName && (
        <div style={{
          position: 'absolute', bottom: 32, left: 12, background: 'rgba(255,255,255,0.95)',
          borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          pointerEvents: 'none', display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <strong style={{ fontSize: 13 }}>{selectedRouteName}</strong>
          <span style={{ display: 'flex', gap: 8 }}>
            <span><span style={{ color: '#16a34a', fontSize: 16 }}>●</span> ≤ sched</span>
            <span><span style={{ color: '#ca8a04', fontSize: 16 }}>●</span> +20%</span>
            <span><span style={{ color: '#dc2626', fontSize: 16 }}>●</span> delayed</span>
          </span>
          <span style={{ color: '#6b7280' }}>— inbound &nbsp; ‐ ‐ outbound</span>
        </div>
      )}
    </div>
  );
}

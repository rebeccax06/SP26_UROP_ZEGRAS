'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Stop, StopWithHeadways, RouteStopHeadway } from '@/lib/types';
import { buildSegmentsStraightLine, buildSegmentsFromShape, type StopForSegment } from '@/lib/map/routeSegments';
import 'mapbox-gl/dist/mapbox-gl.css';

export type RouteOverlayColorBy = 'headway' | 'onTimeRate' | 'bunchingRate' | 'load';

/** Ridership load map scale: 0 → green, this value → red (values above clamp). */
export const RIDERSHIP_LOAD_COLOR_CAP = 30;

interface SchoolMapProps {
  schoolLat: number;
  schoolLon: number;
  stops: Stop[] | StopWithHeadways[];
  mapboxToken: string;
  /** When set, draws the route on the map with stops color-coded by headway or analysis metric */
  routeOverlay?: RouteStopHeadway[] | null;
  /** GTFS shape coordinates per direction (Inbound/Outbound) for road-following geometry */
  routeShapes?: Record<string, [number, number][]> | null;
  selectedRouteName?: string | null;
  /** Which metric to use for segment/stop color when overlay has analysis data */
  colorBy?: RouteOverlayColorBy;
  /** When colorBy is onTimeRate/bunchingRate, optional hour label for legend (e.g. "11 AM" or "Overall") */
  analysisTimeLabel?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ratioColor(ratio: number): string {
  if (ratio <= 1.0) return '#16a34a'; // green — on time
  if (ratio <= 1.2) return '#ca8a04'; // amber — slightly late
  return '#dc2626';                   // red — delayed
}

/** On-time rate 0–1: green good, red bad */
function onTimeRateColor(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return '#9ca3af';
  if (rate >= 0.8) return '#16a34a';
  if (rate >= 0.6) return '#ca8a04';
  return '#dc2626';
}

/** Bunching rate: lower better; green good, red bad */
function bunchingRateColor(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return '#9ca3af';
  if (rate <= 0.1) return '#16a34a';
  if (rate <= 0.25) return '#ca8a04';
  return '#dc2626';
}

/** Mean weekday ridership load: lower greener, higher redder (capped for scale). */
function loadColor(load: number | null | undefined, cap = RIDERSHIP_LOAD_COLOR_CAP): string {
  if (load == null || Number.isNaN(load)) return '#9ca3af';
  const t = Math.max(0, Math.min(1, load / cap));
  const r = Math.round(22 + (220 - 22) * t);
  const g = Math.round(163 + (38 - 163) * t);
  const b = Math.round(74 + (38 - 74) * t);
  return `rgb(${r},${g},${b})`;
}

function routeStopCircleLabel(s: RouteStopHeadway, colorBy: RouteOverlayColorBy): string {
  if (colorBy === 'load') {
    return s.ridershipLoad != null && Number.isFinite(s.ridershipLoad) ? String(Math.round(s.ridershipLoad)) : '—';
  }
  return s.actualMedianMin.toFixed(1);
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

const ROUTE_LAYERS = [
  'route-stops-labels', 'route-stops-layer',
  'route-line-out', 'route-line-in',
  'route-segments-out', 'route-segments-in',
];
const ROUTE_SOURCES = [
  'route-stops', 'route-line-in', 'route-line-out',
  'route-segments-in', 'route-segments-out',
];

type MapboxMap = import('mapbox-gl').Map;

function stopColor(s: RouteStopHeadway, colorBy: RouteOverlayColorBy): string {
  if (colorBy === 'onTimeRate') return onTimeRateColor(s.onTimeRate);
  if (colorBy === 'bunchingRate') return bunchingRateColor(s.bunchingRate);
  if (colorBy === 'load') return loadColor(s.ridershipLoad);
  return ratioColor(s.ratio);
}

function applyRouteOverlay(
  map: MapboxMap,
  overlay: RouteStopHeadway[] | null | undefined,
  colorBy: RouteOverlayColorBy = 'headway',
  shapes?: Record<string, [number, number][]> | null,
) {
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

  const toStops = (dir: RouteStopHeadway[]): StopForSegment[] =>
    dir.map((s) => ({
      stopId: s.stopId,
      lat: s.lat,
      lon: s.lon,
      timePointOrder: s.timePointOrder,
      color: stopColor(s, colorBy),
      metricValue:
        colorBy === 'onTimeRate'
          ? (s.onTimeRate ?? undefined)
          : colorBy === 'bunchingRate'
            ? (s.bunchingRate ?? undefined)
            : colorBy === 'load'
              ? (s.ridershipLoad ?? undefined)
              : s.ratio,
    }));

  if (inbound.length > 0) {
    const inShape = shapes?.['Inbound'] ?? null;
    const segments = inShape
      ? buildSegmentsFromShape(toStops(inbound), inShape)
      : buildSegmentsStraightLine(toStops(inbound));
    map.addSource('route-segments-in', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: segments.filter((seg) => seg.coordinates.length >= 2).map((seg) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: seg.coordinates },
          properties: { color: seg.color },
        })),
      },
    });
    map.addLayer({
      id: 'route-segments-in',
      type: 'line',
      source: 'route-segments-in',
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8 },
    });
  }
  if (outbound.length > 0) {
    const outShape = shapes?.['Outbound'] ?? null;
    const segments = outShape
      ? buildSegmentsFromShape(toStops(outbound), outShape)
      : buildSegmentsStraightLine(toStops(outbound));
    map.addSource('route-segments-out', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: segments.filter((seg) => seg.coordinates.length >= 2).map((seg) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: seg.coordinates },
          properties: { color: seg.color },
        })),
      },
    });
    map.addLayer({
      id: 'route-segments-out',
      type: 'line',
      source: 'route-segments-out',
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.8, 'line-dasharray': [3, 2] },
    });
  }

  const circleColor = (s: RouteStopHeadway) => stopColor(s, colorBy);
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
          ridershipLoad: s.ridershipLoad != null && Number.isFinite(s.ridershipLoad) ? s.ridershipLoad.toFixed(1) : '',
          mapLabel: routeStopCircleLabel(s, colorBy),
          color: circleColor(s),
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
      'text-field':
        colorBy === 'load'
          ? ['get', 'mapLabel']
          : ['concat', ['get', 'actual'], ' min'],
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
  routeOverlay,
  routeShapes,
  selectedRouteName,
  colorBy = 'headway',
  analysisTimeLabel,
}: SchoolMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const mapLoadedRef = useRef(false);
  const stopMarkersRef = useRef<import('mapbox-gl').Marker[]>([]);
  const routeOverlayRef = useRef(routeOverlay);
  const colorByRef = useRef(colorBy);
  const routeShapesRef = useRef(routeShapes);
  useEffect(() => { routeOverlayRef.current = routeOverlay; colorByRef.current = colorBy; routeShapesRef.current = routeShapes; }, [routeOverlay, colorBy, routeShapes]);

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
        if (routeOverlayRef.current?.length) {
          applyRouteOverlay(map, routeOverlayRef.current, colorByRef.current, routeShapesRef.current);
        }

        // Click popup for route stop circles
        map.on('click', 'route-stops-layer', (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const props = feature.properties as Record<string, string>;
          const mode = colorByRef.current;
          let html: string;
          if (mode === 'load') {
            const raw = props.ridershipLoad ? parseFloat(props.ridershipLoad) : NaN;
            const loadStr = Number.isFinite(raw) ? raw.toFixed(1) : '—';
            const c = Number.isFinite(raw) ? loadColor(raw) : '#6b7280';
            html = `
            <strong>${props.stopName}</strong><br/>
            <span style="font-size:11px;color:#6b7280">${props.direction}</span><br/><br/>
            <span style="font-size:12px">
              Mean load (ridership): <b style="color:${c}">${loadStr}</b><br/>
              <span style="font-size:10px;color:#6b7280">Scale 0–${RIDERSHIP_LOAD_COLOR_CAP} pax · weekday avg</span>
            </span>
          `;
          } else {
            html = `
            <strong>${props.stopName}</strong><br/>
            <span style="font-size:11px;color:#6b7280">${props.direction}</span><br/><br/>
            <span style="font-size:12px">
              Sched: <b>${props.scheduled} min</b><br/>
              Actual: <b style="color:${ratioColor(parseFloat(props.ratio))}">${props.actual} min</b><br/>
              Ratio: <b style="color:${ratioColor(parseFloat(props.ratio))}">${props.ratio}</b>
            </span>
          `;
          }
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    applyRouteOverlay(map, routeOverlay, colorBy, routeShapes);
  }, [routeOverlay, colorBy, routeShapes]);

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
          pointerEvents: 'none', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <strong style={{ fontSize: 13 }}>{selectedRouteName}</strong>
          {colorBy === 'headway' && (
            <span style={{ display: 'flex', gap: 8 }}>
              <span><span style={{ color: '#16a34a', fontSize: 16 }}>●</span> ≤ sched</span>
              <span><span style={{ color: '#ca8a04', fontSize: 16 }}>●</span> +20%</span>
              <span><span style={{ color: '#dc2626', fontSize: 16 }}>●</span> delayed</span>
            </span>
          )}
          {colorBy === 'onTimeRate' && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', gap: 8 }}>
                <span><span style={{ color: '#16a34a', fontSize: 16 }}>●</span> ≥80%</span>
                <span><span style={{ color: '#ca8a04', fontSize: 16 }}>●</span> 60–80%</span>
                <span><span style={{ color: '#dc2626', fontSize: 16 }}>●</span> &lt;60%</span>
                {analysisTimeLabel && <span style={{ color: '#6b7280' }}>({analysisTimeLabel})</span>}
              </span>
              <span style={{ fontSize: 10, color: '#6b7280', maxWidth: 260 }}>
                On time = arrival in [sched−1 min, sched+5 min]. Rate = fraction of arrivals at that stop{analysisTimeLabel ? ` in that hour` : ''} meeting that (median over days).
              </span>
            </span>
          )}
          {colorBy === 'bunchingRate' && (
            <span style={{ display: 'flex', gap: 8 }}>
              <span><span style={{ color: '#16a34a', fontSize: 16 }}>●</span> low</span>
              <span><span style={{ color: '#ca8a04', fontSize: 16 }}>●</span> med</span>
              <span><span style={{ color: '#dc2626', fontSize: 16 }}>●</span> high</span>
              {analysisTimeLabel && <span style={{ color: '#6b7280' }}>({analysisTimeLabel})</span>}
            </span>
          )}
          {colorBy === 'load' && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span><span style={{ color: loadColor(0), fontSize: 16 }}>●</span> 0</span>
                <span><span style={{ color: loadColor(RIDERSHIP_LOAD_COLOR_CAP / 2), fontSize: 16 }}>●</span> ~15</span>
                <span><span style={{ color: loadColor(RIDERSHIP_LOAD_COLOR_CAP), fontSize: 16 }}>●</span> ≥{RIDERSHIP_LOAD_COLOR_CAP}</span>
              </span>
              <span style={{ fontSize: 10, color: '#6b7280', maxWidth: 280 }}>
                Mean passengers on board (weekday ridership CSV). Gray = no match for this stop/direction.
              </span>
            </span>
          )}
          <span style={{ color: '#6b7280' }}>— inbound &nbsp; ‐ ‐ outbound</span>
        </div>
      )}
    </div>
  );
}

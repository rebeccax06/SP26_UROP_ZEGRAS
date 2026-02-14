'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Stop } from '@/lib/types';
import 'mapbox-gl/dist/mapbox-gl.css';

interface SchoolMapProps {
  schoolLat: number;
  schoolLon: number;
  stops: Stop[];
  mapboxToken: string;
}

export default function SchoolMap({ schoolLat, schoolLon, stops, mapboxToken }: SchoolMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

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

      const schoolMarker = new mapboxgl.default.Marker({ color: '#2563eb' })
        .setLngLat([schoolLon, schoolLat])
        .setPopup(new mapboxgl.default.Popup().setHTML('<strong>School</strong>'))
        .addTo(map);

      stops.forEach((stop) => {
        new mapboxgl.default.Marker({ color: '#16a34a' })
          .setLngLat([stop.lon, stop.lat])
          .setPopup(
            new mapboxgl.default.Popup().setHTML(
              `<strong>${stop.stopName}</strong><br/>${stop.distanceMeters ?? ''} m`
            )
          )
          .addTo(map);
      });

      mapRef.current = map;
    });
  }, [schoolLat, schoolLon, mapboxToken, stops]);

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  if (!mapboxToken) {
    return (
      <div className="map-container" style={{ background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p>Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to show the map.</p>
      </div>
    );
  }

  return <div ref={containerRef} className="map-container" style={{ width: '100%', height: '100%', minHeight: 400 }} />;
}

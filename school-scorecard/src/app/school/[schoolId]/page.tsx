'use client';

import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useCallback, useMemo, useState, useEffect } from 'react';
import SchoolMap from '@/components/SchoolMap';
import ScorecardTable from '@/components/ScorecardTable';
import type { SchoolConfig } from '@/lib/types';
import type { TimeWindowId } from '@/lib/types';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.message || error.error || `HTTP ${res.status}`);
  }
  return res.json();
};

export default function SchoolPage() {
  const params = useParams();
  const router = useRouter();
  const schoolId = typeof params.schoolId === 'string' ? params.schoolId : 'demo';
  const [timeWindow, setTimeWindow] = useState<TimeWindowId>('AM');
  const [radiusMeters, setRadiusMeters] = useState<number>(800);

  const { data: school, error: schoolError, isLoading: schoolLoading } = useSWR<SchoolConfig>(
    `/api/schools/${schoolId}`,
    fetcher
  );
  const scorecardUrl = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const u = new URL('/api/scorecard', window.location.origin);
    u.searchParams.set('schoolId', schoolId);
    u.searchParams.set('timeWindow', timeWindow);
    u.searchParams.set('radiusMeters', String(radiusMeters));
    return u.toString();
  }, [schoolId, timeWindow, radiusMeters]);

  const { data: scorecardData, error: scorecardError, mutate: mutateScorecard, isLoading: scorecardLoading } = useSWR(
    scorecardUrl,
    scorecardUrl ? fetcher : null
  );

  // Debug logging
  useEffect(() => {
    if (scorecardError) {
      console.error('[SchoolPage] Scorecard error:', scorecardError);
    }
  }, [scorecardError]);

  const stops = scorecardData?.stops ?? [];
  const routes = scorecardData?.routes ?? [];
  const rows = scorecardData?.rows ?? [];
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

  const handleSchoolChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (id) router.push(`/school/${id}`);
    },
    [router]
  );

  if (schoolError) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Error Loading School</h1>
        <p style={{ color: '#dc2626' }}>{schoolError.message || String(schoolError)}</p>
        <p>
          <a href="/debug">Go to Debug Dashboard</a>
        </p>
      </main>
    );
  }

  if (schoolLoading) {
    return (
      <main style={{ padding: 24 }}>
        <p>Loading school data…</p>
      </main>
    );
  }

  if (!school) {
    return (
      <main style={{ padding: 24 }}>
        <h1>School Not Found</h1>
        <p>School ID "{schoolId}" not found.</p>
        <p>
          <a href="/school/demo">Go to Demo School</a> | <a href="/debug">Debug Dashboard</a>
        </p>
      </main>
    );
  }

  const lat = school.lat;
  const lon = school.lon;

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>School Reliability Scorecard</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          School
          <select
            value={schoolId}
            onChange={handleSchoolChange}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            <option value="demo">Demo School</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Radius (m)
          <input
            type="range"
            min={400}
            max={1200}
            step={100}
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
          />
          <span>{radiusMeters}m</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Time window
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value as TimeWindowId)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            <option value="AM">Morning Arrival</option>
            <option value="PM">Afternoon Dismissal</option>
            <option value="AS">After School</option>
          </select>
        </label>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <aside style={{ width: 280, flexShrink: 0, background: '#fff', borderRight: '1px solid #e5e7eb', padding: 16, overflowY: 'auto' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>School</h2>
          <p style={{ margin: 0, fontSize: 13 }}>{school.name}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>
            {lat.toFixed(4)}, {lon.toFixed(4)}
          </p>
          <h2 style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 600 }}>Nearby stops</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>{stops.length} within {radiusMeters}m</p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
            {stops.slice(0, 10).map((s: { stopId: string; stopName: string }) => (
              <li key={s.stopId}>{s.stopName}</li>
            ))}
            {stops.length > 10 && <li>…and {stops.length - 10} more</li>}
          </ul>
        </aside>

        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <SchoolMap
            schoolLat={lat}
            schoolLon={lon}
            stops={stops}
            mapboxToken={mapboxToken}
          />
        </div>

        <aside style={{ width: 520, flexShrink: 0, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h2 style={{ margin: 0, padding: 16, borderBottom: '1px solid #e5e7eb', fontSize: 14, fontWeight: 600 }}>
            Scorecard
          </h2>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {scorecardError && (
              <div style={{ padding: 16, background: '#fee', borderRadius: 4, marginBottom: 16 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#dc2626' }}>Failed to load scorecard</p>
                <p style={{ margin: 0, fontSize: 13, color: '#991b1b' }}>
                  {scorecardError.message || String(scorecardError)}
                </p>
                <p style={{ margin: '8px 0 0', fontSize: 12 }}>
                  <a href="/debug" style={{ color: '#2563eb' }}>
                    Check debug dashboard for details
                  </a>
                </p>
              </div>
            )}
            {scorecardLoading && <p>Loading scorecard data…</p>}
            {!scorecardLoading && !scorecardError && scorecardData && <ScorecardTable rows={rows} />}
          </div>
        </aside>
      </div>
    </main>
  );
}

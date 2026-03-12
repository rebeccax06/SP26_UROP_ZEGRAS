'use client';

import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useCallback, useMemo, useState, useEffect } from 'react';
import SchoolMap from '@/components/SchoolMap';
import ScorecardTable from '@/components/ScorecardTable';
import type { SchoolConfig, Route, RouteStopHeadway } from '@/lib/types';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.message || error.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// January 2026 is the available data range in the CSV
const DATA_YEAR = 2026;
const DATA_MONTH = 1; // January
const DATA_MONTH_LABEL = 'Jan 2026';
const DATA_DAYS = 31; // Jan has 31 days

/** Format a day-of-month (1-31) into a YYYY-MM-DD string for January 2026 */
function dayToDate(day: number): string {
  return `${DATA_YEAR}-${String(DATA_MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Format a day-of-month as "Jan 1", "Jan 15", etc. */
function dayToLabel(day: number): string {
  return `${DATA_MONTH_LABEL.split(' ')[0]} ${day}`;
}

/** Convert fractional hours to HH:MM string (e.g. 7.5 → "07:30") */
function hoursToHhMm(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Format fractional hours to readable label (e.g. 7.5 → "7:30 AM") */
function hoursToLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const period = hh < 12 ? 'AM' : 'PM';
  const displayH = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${displayH}:${String(mm).padStart(2, '0')} ${period}`;
}

export default function SchoolPage() {
  const params = useParams();
  const router = useRouter();
  const schoolId = typeof params.schoolId === 'string' ? params.schoolId : 'madison-park';

  // Date slider: day 1-31 for January 2026
  const [selectedDay, setSelectedDay] = useState(15);
  // Time range sliders: fractional hours, step 0.5
  const [startHour, setStartHour] = useState(7);   // 7:00 AM
  const [endHour, setEndHour] = useState(9);        // 9:00 AM

  const [radiusMeters, setRadiusMeters] = useState<number>(800);
  const [radiusInitialized, setRadiusInitialized] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showInbound, setShowInbound] = useState(true);
  const [showOutbound, setShowOutbound] = useState(true);

  // Debounced values — API only fires 400 ms after the user stops sliding
  const [debouncedDay, setDebouncedDay] = useState(selectedDay);
  const [debouncedStartHour, setDebouncedStartHour] = useState(startHour);
  const [debouncedEndHour, setDebouncedEndHour] = useState(endHour);
  const [debouncedRadius, setDebouncedRadius] = useState(radiusMeters);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedDay(selectedDay), 400);
    return () => clearTimeout(t);
  }, [selectedDay]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedStartHour(startHour);
      setDebouncedEndHour(endHour);
    }, 400);
    return () => clearTimeout(t);
  }, [startHour, endHour]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRadius(radiusMeters), 400);
    return () => clearTimeout(t);
  }, [radiusMeters]);

  const selectedDate = dayToDate(debouncedDay);
  const startTime = hoursToHhMm(debouncedStartHour);
  const endTime = hoursToHhMm(debouncedEndHour);
  const { data: school, error: schoolError, isLoading: schoolLoading } = useSWR<SchoolConfig>(
    `/api/schools/${schoolId}`,
    fetcher
  );

  useEffect(() => {
    if (school && !radiusInitialized) {
      setRadiusMeters(school.radiusMeters);
      setRadiusInitialized(true);
    }
  }, [school, radiusInitialized]);

  useEffect(() => {
    setRadiusInitialized(false);
    setSelectedRouteId(null);
  }, [schoolId]);

  // Clear selected route when the debounced date/time changes (i.e. after the user stops sliding)
  useEffect(() => {
    setSelectedRouteId(null);
  }, [debouncedDay, debouncedStartHour, debouncedEndHour]);

  const scorecardUrl = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const u = new URL('/api/scorecard', window.location.origin);
    u.searchParams.set('schoolId', schoolId);
    u.searchParams.set('date', selectedDate);
    u.searchParams.set('startTime', startTime);
    u.searchParams.set('endTime', endTime);
    u.searchParams.set('radiusMeters', String(debouncedRadius));
    return u.toString();
  }, [schoolId, selectedDate, startTime, endTime, debouncedRadius]);

  const { data: scorecardData, error: scorecardError, isLoading: scorecardLoading } = useSWR(
    scorecardUrl,
    scorecardUrl ? fetcher : null
  );

  const routeHeadwaysUrl = useMemo(() => {
    if (!selectedRouteId || typeof window === 'undefined') return null;
    const u = new URL('/api/route-headways', window.location.origin);
    u.searchParams.set('routeId', selectedRouteId);
    u.searchParams.set('startTime', startTime);
    u.searchParams.set('endTime', endTime);
    u.searchParams.set('date', selectedDate);
    return u.toString();
  }, [selectedRouteId, startTime, endTime, selectedDate]);

  const { data: routeOverlayData, isLoading: routeOverlayLoading } = useSWR<RouteStopHeadway[]>(
    routeHeadwaysUrl,
    routeHeadwaysUrl ? fetcher : null
  );

  useEffect(() => {
    if (scorecardError) console.error('[SchoolPage] Scorecard error:', scorecardError);
  }, [scorecardError]);

  const stops = scorecardData?.stops ?? [];
  const routes: Route[] = scorecardData?.routes ?? [];
  const rows = scorecardData?.rows ?? [];
  const headwaysByStop = scorecardData?.headwaysByStop ?? [];
  const mapStops = headwaysByStop.length > 0 ? headwaysByStop : stops;

  const filteredRouteOverlay = useMemo(() => {
    if (!routeOverlayData) return null;
    if (showInbound && showOutbound) return routeOverlayData;
    if (!showInbound && !showOutbound) return routeOverlayData;
    return routeOverlayData.filter(
      (s) =>
        (showInbound && s.directionId === 'Inbound') ||
        (showOutbound && s.directionId === 'Outbound')
    );
  }, [routeOverlayData, showInbound, showOutbound]);

  const routeIdsWithDelay: string[] =
    rows
      .filter((r: { reliabilityRatioArchived?: number | null }) =>
        r.reliabilityRatioArchived != null && r.reliabilityRatioArchived >= 1.2
      )
      .map((r: { routeId: string }) => r.routeId);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

  const selectedRoute = routes.find((r) => r.routeId === selectedRouteId);
  const selectedRouteName = selectedRoute
    ? `Route ${selectedRoute.routeShortName} — ${selectedRoute.routeLongName}`
    : null;

  const handleSchoolChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (id) router.push(`/school/${id}`);
    },
    [router]
  );

  const handleRouteClick = useCallback((routeId: string | null) => {
    setSelectedRouteId(routeId);
  }, []);

  if (schoolError) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Error Loading School</h1>
        <p style={{ color: '#dc2626' }}>{schoolError.message || String(schoolError)}</p>
        <p><a href="/debug">Go to Debug Dashboard</a></p>
      </main>
    );
  }

  if (schoolLoading) {
    return <main style={{ padding: 24 }}><p>Loading school data…</p></main>;
  }

  if (!school) {
    return (
      <main style={{ padding: 24 }}>
        <h1>School Not Found</h1>
        <p>School ID "{schoolId}" not found.</p>
        <p>
          <a href="/school/madison-park">Go to Madison Park HS</a> | <a href="/debug">Debug Dashboard</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <header style={{
        padding: '10px 16px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
      }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap' }}>
          School Reliability Scorecard
        </h1>

        {/* School selector */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>School</span>
          <select
            value={schoolId}
            onChange={handleSchoolChange}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          >
            <option value="madison-park">Madison Park High School</option>
            <option value="demo">Demo School</option>
          </select>
        </label>

        {/* Radius slider */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>Radius</span>
          <input
            type="range" min={400} max={1200} step={100}
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ minWidth: 42 }}>{radiusMeters}m</span>
        </label>

        {/* Date slider */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>Date</span>
          <input
            type="range"
            min={1} max={DATA_DAYS} step={1}
            value={selectedDay}
            onChange={(e) => setSelectedDay(Number(e.target.value))}
            style={{ width: 100 }}
          />
          <span style={{
            minWidth: 50,
            padding: '3px 8px',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 5,
            fontSize: 12,
            fontWeight: 600,
            color: '#0369a1',
          }}>
            {dayToLabel(selectedDay)}
          </span>
        </label>

        {/* Time window sliders */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>Time</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="range"
              min={4} max={22} step={0.5}
              value={startHour}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStartHour(v);
                if (v >= endHour) setEndHour(Math.min(v + 0.5, 22));
              }}
              style={{ width: 80 }}
            />
            <span style={{
              minWidth: 64,
              padding: '3px 7px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              color: '#15803d',
            }}>
              {hoursToLabel(startHour)}
            </span>
          </div>
          <span style={{ color: '#9ca3af', fontSize: 11 }}>→</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="range"
              min={4} max={22} step={0.5}
              value={endHour}
              onChange={(e) => {
                const v = Number(e.target.value);
                setEndHour(v);
                if (v <= startHour) setStartHour(Math.max(v - 0.5, 4));
              }}
              style={{ width: 80 }}
            />
            <span style={{
              minWidth: 64,
              padding: '3px 7px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              color: '#15803d',
            }}>
              {hoursToLabel(endHour)}
            </span>
          </div>
        </div>

        {/* Direction filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>Direction</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInbound}
              onChange={(e) => setShowInbound(e.target.checked)}
            />
            <span>Inbound</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showOutbound}
              onChange={(e) => setShowOutbound(e.target.checked)}
            />
            <span>Outbound</span>
          </label>
        </div>

        {/* Active route badge */}
        {selectedRouteName && (
          <span style={{
            padding: '4px 10px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 6,
            fontSize: 13,
            color: '#1d4ed8',
          }}>
            {routeOverlayLoading ? 'Loading route…' : selectedRouteName}
            <button
              onClick={() => setSelectedRouteId(null)}
              style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14 }}
              aria-label="Clear route"
            >✕</button>
          </span>
        )}
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left sidebar */}
        <aside style={{ width: 260, flexShrink: 0, background: '#fff', borderRight: '1px solid #e5e7eb', padding: 14, overflowY: 'auto' }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600 }}>School</h2>
          <p style={{ margin: 0, fontSize: 13 }}>{school.name}</p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: '#6b7280' }}>
            {school.lat.toFixed(4)}, {school.lon.toFixed(4)}
          </p>
          <div style={{ margin: '12px 0 8px', padding: '8px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
            <div style={{ color: '#374151', fontWeight: 600 }}>{dayToLabel(selectedDay)}</div>
            <div style={{ color: '#6b7280', marginTop: 2 }}>{hoursToLabel(startHour)} – {hoursToLabel(endHour)}</div>
          </div>
          <h2 style={{ margin: '12px 0 6px', fontSize: 13, fontWeight: 600 }}>Nearby stops</h2>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{stops.length} within {radiusMeters}m</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.6 }}>
            {stops.slice(0, 10).map((s: { stopId: string; stopName: string }) => (
              <li key={s.stopId}>{s.stopName}</li>
            ))}
            {stops.length > 10 && <li style={{ color: '#9ca3af' }}>…and {stops.length - 10} more</li>}
          </ul>
        </aside>

        {/* Map */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <SchoolMap
            schoolLat={school.lat}
            schoolLon={school.lon}
            stops={mapStops}
            mapboxToken={mapboxToken}
            routeIdsWithDelay={routeIdsWithDelay}
            routeOverlay={filteredRouteOverlay}
            selectedRouteName={selectedRouteName}
          />
        </div>

        {/* Right sidebar — scorecard */}
        <aside style={{ width: 480, flexShrink: 0, background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {routeIdsWithDelay.length > 0 && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', borderBottom: '1px solid #fecaca', fontSize: 12 }}>
              <strong style={{ color: '#dc2626' }}>Delayed routes:</strong>{' '}
              {routeIdsWithDelay.map((id) => routes.find((r) => r.routeId === id)?.routeShortName ?? id).join(', ')}
            </div>
          )}
          <h2 style={{ margin: 0, padding: '12px 14px', borderBottom: '1px solid #e5e7eb', fontSize: 13, fontWeight: 600 }}>
            Scorecard — {dayToLabel(selectedDay)}, {hoursToLabel(startHour)}–{hoursToLabel(endHour)}
          </h2>
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
            {scorecardError && (
              <div style={{ padding: 14, background: '#fee', borderRadius: 4, marginBottom: 14 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#dc2626' }}>Failed to load scorecard</p>
                <p style={{ margin: 0, fontSize: 12, color: '#991b1b' }}>{scorecardError.message || String(scorecardError)}</p>
                <p style={{ margin: '6px 0 0', fontSize: 11 }}>
                  <a href="/debug" style={{ color: '#2563eb' }}>Check debug dashboard</a>
                </p>
              </div>
            )}
            {scorecardLoading && <p style={{ color: '#6b7280', fontSize: 13 }}>Loading scorecard…</p>}
            {!scorecardLoading && !scorecardError && scorecardData && (
              <ScorecardTable
                rows={rows}
                selectedRouteId={selectedRouteId}
                onRouteClick={handleRouteClick}
              />
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useCallback, useMemo, useState, useEffect } from 'react';
import SchoolMap from '@/components/SchoolMap';
import type { RouteOverlayColorBy } from '@/components/SchoolMap';
import ScorecardTable from '@/components/ScorecardTable';
import type {
  SchoolConfig,
  Route,
  RouteStopHeadway,
  BusRidershipTripOption,
  BusRidershipStopRow,
} from '@/lib/types';

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

function formatRidershipTripStart(t: string): string {
  const parts = t.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]?.padStart(2, '0')}`;
  return t;
}

function formatRidershipTripLabel(t: BusRidershipTripOption): string {
  return `${t.dayTypeName} · dir ${t.directionId} · ${formatRidershipTripStart(t.tripStartTime)}`;
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
  const [colorBy, setColorBy] = useState<RouteOverlayColorBy>('headway');
  /** When colorBy is onTimeRate/bunchingRate: null = Overall, 0-23 = hour of day */
  const [analysisHour, setAnalysisHour] = useState<number | null>(null);
  /** Ridership CSV: index into `trips` from /api/bus-ridership */
  const [ridershipTripIdx, setRidershipTripIdx] = useState<number | null>(null);
  /** '' = all stops; otherwise stop_id from ridership CSV */
  const [ridershipStopId, setRidershipStopId] = useState<string>('');

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

  useEffect(() => {
    setRidershipTripIdx(null);
    setRidershipStopId('');
  }, [selectedRouteId]);

  useEffect(() => {
    setRidershipStopId('');
  }, [ridershipTripIdx]);

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
    if ((colorBy === 'onTimeRate' || colorBy === 'bunchingRate') && analysisHour !== null) {
      u.searchParams.set('hour', String(analysisHour));
    }
    return u.toString();
  }, [selectedRouteId, startTime, endTime, selectedDate, colorBy, analysisHour]);

  const { data: routeOverlayRaw, isLoading: routeOverlayLoading } = useSWR<{
    stops: RouteStopHeadway[];
    shapes?: Record<string, [number, number][]>;
  }>(
    routeHeadwaysUrl,
    routeHeadwaysUrl ? fetcher : null
  );

  const ridershipTripsUrl = useMemo(() => {
    if (!selectedRouteId || typeof window === 'undefined') return null;
    const u = new URL('/api/bus-ridership', window.location.origin);
    u.searchParams.set('routeId', selectedRouteId);
    return u.toString();
  }, [selectedRouteId]);

  const { data: ridershipMeta, isLoading: ridershipMetaLoading } = useSWR<{
    csvPath: string | null;
    seasonLabel: string | null;
    trips: BusRidershipTripOption[];
  }>(ridershipTripsUrl, ridershipTripsUrl ? fetcher : null);

  const selectedRidershipTrip: BusRidershipTripOption | null =
    ridershipMeta?.trips &&
    ridershipTripIdx != null &&
    ridershipTripIdx >= 0 &&
    ridershipTripIdx < ridershipMeta.trips.length
      ? ridershipMeta.trips[ridershipTripIdx]!
      : null;

  const ridershipStopsUrl = useMemo(() => {
    if (!selectedRouteId || !selectedRidershipTrip || typeof window === 'undefined') return null;
    const u = new URL('/api/bus-ridership', window.location.origin);
    u.searchParams.set('routeId', selectedRouteId);
    u.searchParams.set('dayTypeId', selectedRidershipTrip.dayTypeId);
    u.searchParams.set('directionId', selectedRidershipTrip.directionId);
    u.searchParams.set('tripStartTime', selectedRidershipTrip.tripStartTime);
    u.searchParams.set('routeVariant', selectedRidershipTrip.routeVariant);
    return u.toString();
  }, [selectedRouteId, selectedRidershipTrip]);

  const { data: ridershipStopsPayload, isLoading: ridershipStopsLoading } = useSWR<{
    stops: BusRidershipStopRow[];
  }>(ridershipStopsUrl, ridershipStopsUrl ? fetcher : null);

  const ridershipStopsFiltered = useMemo(() => {
    const list = ridershipStopsPayload?.stops ?? [];
    if (!ridershipStopId) return list;
    return list.filter((s) => s.stopId === ridershipStopId);
  }, [ridershipStopsPayload?.stops, ridershipStopId]);

  const routeOverlayData = routeOverlayRaw?.stops ?? null;
  const routeShapes = routeOverlayRaw?.shapes ?? null;

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

  const analysisTimeLabel = (colorBy === 'onTimeRate' || colorBy === 'bunchingRate')
    ? (analysisHour === null ? 'Overall' : analysisHour < 12 ? `${analysisHour} AM` : analysisHour === 12 ? '12 PM' : `${analysisHour - 12} PM`)
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

        {/* Color by + time of day (when a route is selected) */}
        {selectedRouteName && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ color: '#6b7280' }}>Color by</span>
              <select
                value={colorBy}
                onChange={(e) => setColorBy(e.target.value as RouteOverlayColorBy)}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
              >
                <option value="headway">Headway (actual/scheduled)</option>
                <option value="onTimeRate">On-time rate</option>
                <option value="bunchingRate">Bunching rate</option>
                <option value="load">Load (ridership, 0–30)</option>
              </select>
            </div>
            {(colorBy === 'onTimeRate' || colorBy === 'bunchingRate') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <span style={{ color: '#6b7280' }}>Time</span>
                <select
                  value={analysisHour === null ? 'overall' : analysisHour}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAnalysisHour(v === 'overall' ? null : parseInt(v, 10));
                  }}
                  style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
                >
                  <option value="overall">Overall</option>
                  {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => (
                    <option key={h} value={h}>
                      {h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

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

        {/* On-time heatmap link */}
        <a
          href={`/route-heatmap?routeId=${encodeURIComponent(selectedRouteId ?? '28')}`}
          style={{
            padding: '5px 12px',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            color: '#15803d',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          On-time heatmap{selectedRouteId ? ` (Route ${selectedRouteId})` : ''}
        </a>
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
            routeOverlay={filteredRouteOverlay}
            routeShapes={routeShapes}
            selectedRouteName={selectedRouteName}
            colorBy={colorBy}
            analysisTimeLabel={analysisTimeLabel}
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

            {selectedRouteId && (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>
                  Trip load (ridership CSV)
                </h3>
                <p style={{ margin: '0 0 10px', fontSize: 11, color: '#6b7280', lineHeight: 1.45 }}>
                  Average passengers after boarding/alighting by trip start time and stop (MBTA
                  ridership-by-trip file; not tied to the January 2026 reliability date above).
                </p>
                {ridershipMetaLoading && (
                  <p style={{ fontSize: 12, color: '#6b7280' }}>Loading trip list…</p>
                )}
                {!ridershipMetaLoading && ridershipMeta && !ridershipMeta.csvPath && (
                  <p style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', padding: 8, borderRadius: 6 }}>
                    Ridership file not found. Set <code style={{ fontSize: 11 }}>MBTA_BUS_RIDERSHIP_CSV</code> in{' '}
                    <code style={{ fontSize: 11 }}>.env.local</code>, or place the CSV under{' '}
                    <code style={{ fontSize: 11 }}>../data/MBTA_Bus_Ridership_by_Trip_Season_Route_Line_and_Stop/</code>{' '}
                    next to this app.
                  </p>
                )}
                {!ridershipMetaLoading && ridershipMeta?.csvPath && (
                  <>
                    {ridershipMeta.seasonLabel && (
                      <p style={{ margin: '0 0 8px', fontSize: 11, color: '#374151' }}>
                        Season: <strong>{ridershipMeta.seasonLabel}</strong> ·{' '}
                        {ridershipMeta.trips.length} distinct trips
                      </p>
                    )}
                    <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 8 }}>
                      <span style={{ display: 'block', marginBottom: 4, color: '#6b7280' }}>Trip</span>
                      <select
                        value={ridershipTripIdx === null ? '' : String(ridershipTripIdx)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRidershipTripIdx(v === '' ? null : parseInt(v, 10));
                        }}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: 6,
                          border: '1px solid #d1d5db',
                          fontSize: 12,
                        }}
                      >
                        <option value="">Choose trip start…</option>
                        {ridershipMeta.trips.map((t, i) => (
                          <option key={`${t.dayTypeId}-${t.directionId}-${t.tripStartTime}-${t.routeVariant}-${i}`} value={i}>
                            {formatRidershipTripLabel(t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedRidershipTrip && (
                      <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 8 }}>
                        <span style={{ display: 'block', marginBottom: 4, color: '#6b7280' }}>Stop</span>
                        <select
                          value={ridershipStopId}
                          onChange={(e) => setRidershipStopId(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: 6,
                            border: '1px solid #d1d5db',
                            fontSize: 12,
                          }}
                        >
                          <option value="">All stops on trip</option>
                          {(ridershipStopsPayload?.stops ?? []).map((s) => (
                            <option key={s.stopId} value={s.stopId}>
                              #{s.stopSequence} — {s.stopName}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {ridershipStopsLoading && selectedRidershipTrip && (
                      <p style={{ fontSize: 12, color: '#6b7280' }}>Loading stop-level load…</p>
                    )}
                    {!ridershipStopsLoading && selectedRidershipTrip && ridershipStopsPayload && (
                      <div style={{ overflowX: 'auto', maxHeight: 280, overflowY: 'auto', marginTop: 6 }}>
                        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#f9fafb', position: 'sticky', top: 0 }}>
                              <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #e5e7eb' }}>#</th>
                              <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid #e5e7eb' }}>Stop</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #e5e7eb' }}>Load</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #e5e7eb' }}>On</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #e5e7eb' }}>Off</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid #e5e7eb' }}>n</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ridershipStopsFiltered.map((s) => (
                              <tr key={`${s.stopId}-${s.stopSequence}`}>
                                <td style={{ padding: '5px 4px', borderBottom: '1px solid #f3f4f6', color: '#6b7280' }}>
                                  {s.stopSequence}
                                </td>
                                <td style={{ padding: '5px 4px', borderBottom: '1px solid #f3f4f6' }}>{s.stopName}</td>
                                <td style={{ padding: '5px 4px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', fontWeight: 600 }}>
                                  {Number.isFinite(s.load) ? s.load.toFixed(1) : '—'}
                                </td>
                                <td style={{ padding: '5px 4px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                                  {Number.isFinite(s.boardings) ? s.boardings.toFixed(1) : '—'}
                                </td>
                                <td style={{ padding: '5px 4px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                                  {Number.isFinite(s.alightings) ? s.alightings.toFixed(1) : '—'}
                                </td>
                                <td style={{ padding: '5px 4px', borderBottom: '1px solid #f3f4f6', textAlign: 'right', color: '#6b7280' }}>
                                  {s.sampleSize || '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {ridershipStopsFiltered.length === 0 && (
                          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>No rows for this trip.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

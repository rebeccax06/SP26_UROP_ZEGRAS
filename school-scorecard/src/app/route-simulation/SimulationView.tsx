'use client';

/**
 * Client-side controller for /route-simulation.
 *
 * Owns the rAF loop, the time scrubber state, and the SimulationMap ref. The
 * server only provides the dataset (sparse timelines + shape coords); all
 * per-frame math runs here.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildShapeProjection,
  formatSecToHms,
  locateTripAt,
  type ShapeProjection,
  type SimulationTrip,
  type TripSnapshot,
} from '@/lib/simulation/tripPositions';
import SimulationMap, { type SimulationMapHandle } from './SimulationMap';

interface SimulationDatasetWire {
  routeId: string;
  date: string;
  shapesByDirection: Record<string, [number, number][]>;
  trips: SimulationTrip[];
  minSchedSec: number;
  maxSchedSec: number;
  observedHalfTripCount: number;
  matchedTripCount: number;
}

const SPEED_OPTIONS: { label: string; mult: number }[] = [
  { label: '1×', mult: 1 },
  { label: '30×', mult: 30 },
  { label: '60×', mult: 60 },
  { label: '300×', mult: 300 },
];

type ViewMode = 'all' | 'single';
type DirectionFilter = 'all' | '0' | '1'; // GTFS dirs: 0=Outbound, 1=Inbound

const DIR_LABEL: Record<string, string> = { '0': 'Outbound', '1': 'Inbound' };

export default function SimulationView({
  mapboxToken,
  initialRouteId,
  initialDate,
}: {
  mapboxToken: string;
  initialRouteId: string;
  initialDate: string;
}) {
  const [routeId, setRouteId] = useState(initialRouteId);
  const [date, setDate] = useState(initialDate);
  const [routeInput, setRouteInput] = useState(initialRouteId);
  const [dateInput, setDateInput] = useState(initialDate);

  const [data, setData] = useState<SimulationDatasetWire | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [currentSec, setCurrentSec] = useState(8 * 3600);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2); // default 60×

  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const mapRef = useRef<SimulationMapHandle>(null);

  // ---- Fetch dataset -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setData(null);
    setSelectedTripId(null);
    fetch(`/api/route-simulation?routeId=${encodeURIComponent(routeId)}&date=${encodeURIComponent(date)}`)
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
        return JSON.parse(text) as SimulationDatasetWire;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setCurrentSec(Math.max(payload.minSchedSec, Math.min(payload.maxSchedSec, 8 * 3600)));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [routeId, date]);

  // ---- Pre-compute shape projections + trip group by direction -----------
  const shapeProjByDir = useMemo(() => {
    const out: Record<string, ShapeProjection> = {};
    if (!data) return out;
    for (const [dir, coords] of Object.entries(data.shapesByDirection)) {
      out[dir] = buildShapeProjection(coords);
    }
    return out;
  }, [data]);

  // ---- Filtering & navigation -------------------------------------------
  /**
   * Trips for the single-trip prev/next dropdown. Always includes every trip
   * (both directions); the dropdown row labels each entry as Inbound/Outbound,
   * so a separate filter would just be hidden state. Matched trips first so
   * prev/next lands on something with observed data.
   */
  const navTrips = useMemo(() => {
    if (!data) return [] as SimulationTrip[];
    return data.trips
      .slice()
      .sort((a, b) => {
        const am = a.firstActualSec != null ? 0 : 1;
        const bm = b.firstActualSec != null ? 0 : 1;
        if (am !== bm) return am - bm;
        return a.firstSchedSec - b.firstSchedSec;
      });
  }, [data]);

  // The trips that the simulation should *render* this frame. In single mode
  // it's just the selected trip; in all mode it's everything matching the
  // direction filter.
  const visibleTrips = useMemo(() => {
    if (!data) return [] as SimulationTrip[];
    if (viewMode === 'single') {
      const t = data.trips.find((x) => x.tripId === selectedTripId);
      return t ? [t] : [];
    }
    return data.trips.filter((t) => directionFilter === 'all' || t.directionId === directionFilter);
  }, [data, viewMode, selectedTripId, directionFilter]);

  // Auto-select the first nav trip when entering single mode or after data
  // changes / direction filter changes leaves the selection invalid.
  useEffect(() => {
    if (viewMode !== 'single' || !data) return;
    const stillValid = navTrips.some((t) => t.tripId === selectedTripId);
    if (!stillValid) {
      const first = navTrips[0];
      setSelectedTripId(first?.tripId ?? null);
    }
  }, [viewMode, data, navTrips, selectedTripId]);

  const selectedTrip = useMemo(
    () => (selectedTripId ? data?.trips.find((t) => t.tripId === selectedTripId) ?? null : null),
    [selectedTripId, data],
  );

  // When entering single mode (or switching trip), jump the scrubber to the
  // trip's scheduled start.
  useEffect(() => {
    if (viewMode !== 'single' || !selectedTrip) return;
    setCurrentSec(selectedTrip.firstSchedSec);
    currentSecRef.current = selectedTrip.firstSchedSec;
  }, [viewMode, selectedTrip]);

  function gotoNeighborTrip(dir: 1 | -1) {
    if (!selectedTrip || navTrips.length === 0) return;
    const idx = navTrips.findIndex((t) => t.tripId === selectedTrip.tripId);
    const next = navTrips[(idx + dir + navTrips.length) % navTrips.length];
    if (next) setSelectedTripId(next.tripId);
  }

  // Stash refs so the rAF loop can read latest state without restarting.
  const dataRef = useRef(data);
  const visibleTripsRef = useRef(visibleTrips);
  const shapeProjRef = useRef(shapeProjByDir);
  const playingRef = useRef(playing);
  const speedRef = useRef(SPEED_OPTIONS[speedIdx]!.mult);
  const currentSecRef = useRef(currentSec);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { visibleTripsRef.current = visibleTrips; }, [visibleTrips]);
  useEffect(() => { shapeProjRef.current = shapeProjByDir; }, [shapeProjByDir]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = SPEED_OPTIONS[speedIdx]!.mult; }, [speedIdx]);
  useEffect(() => { currentSecRef.current = currentSec; }, [currentSec]);

  // ---- Frame loop --------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let lastTs = performance.now();
    let lastFrameTs = 0;

    const tick = (ts: number) => {
      const elapsedMs = ts - lastTs;
      lastTs = ts;
      if (playingRef.current && dataRef.current) {
        const advance = (elapsedMs / 1000) * speedRef.current;
        let next = currentSecRef.current + advance;
        const max = dataRef.current.maxSchedSec;
        if (next >= max) {
          next = max;
          playingRef.current = false;
          setPlaying(false);
        }
        currentSecRef.current = next;
        if (ts - lastFrameTs > 100) {
          setCurrentSec(next);
          lastFrameTs = ts;
        }
      }

      const trips = visibleTripsRef.current;
      const projByDir = shapeProjRef.current;
      const map = mapRef.current;
      if (trips.length > 0 && map) {
        const t = currentSecRef.current;
        const snapshots: TripSnapshot[] = [];
        for (const trip of trips) {
          const proj = projByDir[trip.directionId];
          if (!proj) continue;
          const snap = locateTripAt(trip, proj, t);
          if (snap) snapshots.push(snap);
        }
        map.setSnapshots(snapshots);
      } else if (map) {
        map.setSnapshots([]);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Stats / live readouts --------------------------------------------
  const stats = useMemo(() => {
    if (!data) return null;
    return { total: data.trips.length, matched: data.matchedTripCount, observed: data.observedHalfTripCount };
  }, [data]);

  const liveStats = useMemo(() => {
    if (!data) return { active: 0, withActual: 0 };
    let active = 0;
    let withActual = 0;
    const t = currentSec;
    const trips = viewMode === 'single' ? (selectedTrip ? [selectedTrip] : []) : visibleTrips;
    for (const trip of trips) {
      if (t < trip.firstSchedSec || t > trip.lastSchedSec) continue;
      active++;
      if (
        trip.firstActualSec != null && trip.lastActualSec != null &&
        t >= trip.firstActualSec && t <= trip.lastActualSec
      ) withActual++;
    }
    return { active, withActual };
  }, [data, currentSec, viewMode, selectedTrip, visibleTrips]);

  /** Schedule deviation (actual − scheduled) at the current moment for the selected trip. */
  const selectedDeviationSec = useMemo(() => {
    if (viewMode !== 'single' || !selectedTrip) return null;
    if (selectedTrip.firstActualSec == null || selectedTrip.lastActualSec == null) return null;
    if (currentSec < selectedTrip.firstActualSec || currentSec > selectedTrip.lastActualSec) return null;
    // Lateness ≈ scheduled time − actual time at the same distance along route.
    // Quickest proxy: compare each known timepoint pair, pick the median lateness.
    const dts: number[] = [];
    for (const s of selectedTrip.stops) {
      if (s.actualSec != null) dts.push(s.actualSec - s.scheduledSec);
    }
    if (dts.length === 0) return null;
    dts.sort((a, b) => a - b);
    return dts[Math.floor(dts.length / 2)] ?? null;
  }, [viewMode, selectedTrip, currentSec]);

  const minSec = data?.minSchedSec ?? 5 * 3600;
  const maxSec = data?.maxSchedSec ?? 26 * 3600;

  const selectedNavIndex = selectedTrip ? navTrips.findIndex((t) => t.tripId === selectedTrip.tripId) : -1;

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto auto auto minmax(720px, 1fr)', gap: 10, minHeight: 'calc(100vh - 80px)' }}>
      {/* Row 1 — route/date/play/speed/data status */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRouteId(routeInput.trim() || '28');
            setDate(dateInput.trim() || initialDate);
          }}
          style={{ display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <label style={labelStyle}>Route&nbsp;
            <input value={routeInput} onChange={(e) => setRouteInput(e.target.value)} style={{ ...inputStyle, width: 64 }} />
          </label>
          <label style={labelStyle}>Date&nbsp;
            <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </label>
          <button type="submit" style={buttonStyle}>Load</button>
        </form>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => setPlaying((p) => !p)} style={{ ...buttonStyle, minWidth: 70 }}>
            {playing ? 'Pause' : 'Play'}
          </button>
          {SPEED_OPTIONS.map((opt, i) => (
            <button
              key={opt.label}
              onClick={() => setSpeedIdx(i)}
              style={{
                ...buttonStyle,
                background: i === speedIdx ? '#1f2937' : '#fff',
                color: i === speedIdx ? '#fff' : '#1f2937',
              }}
            >{opt.label}</button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#374151' }}>
          {loading && 'Loading…'}
          {loadError && <span style={{ color: '#dc2626' }}>Error: {loadError}</span>}
          {stats && data && !loading && !loadError && (
            <>
              <strong>{routeId}</strong> · {date} · {stats.total} trips · {stats.matched} with actual ({stats.observed} observed)
            </>
          )}
        </div>
      </div>

      {/* Row 2 — view mode + (per-mode) direction filter / trip nav */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 10px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
        <SegmentedToggle
          options={[{ id: 'single', label: 'Single trip' }, { id: 'all', label: 'All trips' }]}
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
        />

        {viewMode === 'all' && (
          <>
            <span style={{ width: 1, height: 18, background: '#d1d5db', margin: '0 4px' }} />
            <SegmentedToggle
              options={[{ id: 'all', label: 'Both dirs' }, { id: '1', label: 'Inbound' }, { id: '0', label: 'Outbound' }]}
              value={directionFilter}
              onChange={(v) => setDirectionFilter(v as DirectionFilter)}
            />
          </>
        )}

        {viewMode === 'single' && (
          <>
            <span style={{ width: 1, height: 18, background: '#d1d5db', margin: '0 4px' }} />
            <button onClick={() => gotoNeighborTrip(-1)} style={buttonStyle} disabled={navTrips.length === 0}>‹ Prev</button>
            <select
              value={selectedTripId ?? ''}
              onChange={(e) => setSelectedTripId(e.target.value || null)}
              style={{ ...inputStyle, marginLeft: 0, minWidth: 220 }}
            >
              {navTrips.length === 0 && <option value="">(no trips for this filter)</option>}
              {navTrips.map((t, i) => (
                <option key={t.tripId} value={t.tripId}>
                  {`${i + 1}. ${formatSecToHms(t.firstSchedSec)} ${DIR_LABEL[t.directionId] ?? t.directionId}${t.firstActualSec != null ? '' : ' · no actual'}`}
                </option>
              ))}
            </select>
            <button onClick={() => gotoNeighborTrip(1)} style={buttonStyle} disabled={navTrips.length === 0}>Next ›</button>
            {selectedTrip && (
              <span style={{ fontSize: 12, color: '#4b5563', marginLeft: 8 }}>
                trip {selectedNavIndex + 1}/{navTrips.length} · sched {formatSecToHms(selectedTrip.firstSchedSec)}–{formatSecToHms(selectedTrip.lastSchedSec)}
                {selectedTrip.firstActualSec != null && (
                  <> · actual {formatSecToHms(selectedTrip.firstActualSec)}–{formatSecToHms(selectedTrip.lastActualSec ?? selectedTrip.firstActualSec)}</>
                )}
                {selectedDeviationSec != null && (
                  <> · {selectedDeviationSec >= 0 ? 'late' : 'early'} by <strong style={{ color: selectedDeviationSec >= 60 ? '#dc2626' : selectedDeviationSec <= -60 ? '#2563eb' : '#16a34a' }}>{Math.abs(Math.round(selectedDeviationSec))}s</strong></>
                )}
              </span>
            )}
          </>
        )}
      </div>

      {/* Row 3 — scrubber + legend */}
      <div>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center',
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13,
          padding: '6px 10px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb',
        }}>
          <span style={{ minWidth: 90 }}>{formatSecToHms(currentSec)}</span>
          <input
            type="range"
            min={Math.floor(minSec)}
            max={Math.ceil(maxSec)}
            step={5}
            value={Math.round(currentSec)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCurrentSec(v);
              currentSecRef.current = v;
            }}
            style={{ flex: 1 }}
          />
          <span style={{ color: '#6b7280' }}>
            active: <strong style={{ color: '#1f2937' }}>{liveStats.active}</strong> ·
            with actual: <strong style={{ color: '#1f2937' }}>{liveStats.withActual}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 6, fontSize: 12, color: '#374151' }}>
          <LegendDot color="#2563eb" label="Scheduled" />
          <LegendDot color="#dc2626" label="Actual (observed)" small />
          <LegendLine label="Deviation leash (sched ↔ actual)" />
          <span style={{ color: '#9ca3af' }}>(no marker shown when there's no observed data for this moment)</span>
        </div>
      </div>

      {/* Row 4 — map. The parent grid row reserves at least 720px so long
          routes (e.g. 28 to Mattapan) fit fully without cropping the south end. */}
      <div style={{ height: '100%', minHeight: 720 }}>
        {data && (
          <SimulationMap
            ref={mapRef}
            mapboxToken={mapboxToken}
            shapesByDirection={data.shapesByDirection}
          />
        )}
        {!data && !loading && !loadError && (
          <div style={placeholderStyle}>Pick a route and date, then press Load.</div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: '#374151', display: 'inline-flex', alignItems: 'center' };
const inputStyle: React.CSSProperties = { padding: '4px 6px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, marginLeft: 4 };
const buttonStyle: React.CSSProperties = { padding: '4px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' };
const placeholderStyle: React.CSSProperties = {
  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#f3f4f6', color: '#6b7280', borderRadius: 8, fontFamily: 'system-ui, sans-serif',
};

function SegmentedToggle<T extends string>({
  options, value, onChange,
}: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 4, overflow: 'hidden' }}>
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          style={{
            padding: '4px 10px',
            fontSize: 13,
            background: opt.id === value ? '#1f2937' : '#fff',
            color: opt.id === value ? '#fff' : '#1f2937',
            border: 'none',
            cursor: 'pointer',
          }}
        >{opt.label}</button>
      ))}
    </div>
  );
}

function LegendDot({ color, label, small }: { color: string; label: string; small?: boolean }) {
  const size = small ? 9 : 12;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: size, height: size, borderRadius: '50%', background: color, border: '1.5px solid #fff', boxShadow: '0 0 0 1px #d1d5db' }} />
      {label}
    </span>
  );
}

function LegendLine({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 24, borderTop: '2px dashed #6b7280' }} />
      {label}
    </span>
  );
}

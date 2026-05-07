'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ─── API types (mirror server payloads) ──────────────────────────

interface HeatmapCell {
  stopId: string;
  serviceDate: string;
  onTimeRate: number;
  onTimeCount: number;
  totalTrips: number;
}

interface HeatmapStop {
  stopId: string;
  stopName: string;
  directionId: string;
  timePointOrder: number;
}

interface HeatmapPayload {
  routeId: string;
  csvPath: string | null;
  stops: HeatmapStop[];
  dates: string[];
  cells: HeatmapCell[];
}

interface DrilldownTrip {
  serviceDate: string;
  routeId: string;
  directionId: string;
  halfTripId: string;
  stopId: string;
  timePointId: string;
  timePointOrder: number;
  pointType: string;
  standardType: string;
  scheduledTime: string;
  actualTime: string;
  scheduledSec: number;
  actualSec: number;
  delaySec: number;
  isOnTime: boolean;
  scheduledHeadway: number | null;
  actualHeadway: number | null;
}

interface DrilldownPayload {
  routeId: string;
  stopId: string;
  stopName: string;
  serviceDate: string;
  trips: DrilldownTrip[];
}

// ─── Color scale (RdYlGn, matching the Python heatmap) ──────────

function onTimeRateColor(rate: number): string {
  // 0 → red, 0.5 → yellow, 1.0 → green
  const clamped = Math.max(0, Math.min(1, rate));
  if (clamped <= 0.5) {
    const t = clamped / 0.5;
    const r = Math.round(215 + (240 - 215) * t);
    const g = Math.round(48 + (228 - 48) * t);
    const b = Math.round(39 + (66 - 39) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = (clamped - 0.5) / 0.5;
  const r = Math.round(240 + (34 - 240) * t);
  const g = Math.round(228 + (139 - 228) * t);
  const b = Math.round(66 + (34 - 66) * t);
  return `rgb(${r},${g},${b})`;
}

function noDataColor(): string {
  return '#e0e0e0';
}

// ─── Sort controls ───────────────────────────────────────────────

type SortField = 'scheduledTime' | 'actualTime' | 'delaySec' | 'halfTripId' | 'directionId';
type SortDir = 'asc' | 'desc';

// ─── Component ───────────────────────────────────────────────────

export function InteractiveHeatmap({ routeId }: { routeId: string }) {
  const [payload, setPayload] = useState<HeatmapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    cell: HeatmapCell;
    stopId: string;
    stopName: string;
    date: string;
  } | null>(null);

  // Drill-down state
  const [selectedCell, setSelectedCell] = useState<{ stopId: string; date: string } | null>(null);
  const [drilldown, setDrilldown] = useState<DrilldownPayload | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Table sort
  const [sortField, setSortField] = useState<SortField>('scheduledTime');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const containerRef = useRef<HTMLDivElement>(null);

  // ─── Load heatmap data ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);

    fetch(`/api/heatmap-data?routeId=${encodeURIComponent(routeId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<HeatmapPayload>;
      })
      .then((d) => {
        if (!cancelled) {
          setPayload(d);
          setLoading(false);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [routeId]);

  // ─── Load drilldown on cell select ─────────────────────────

  useEffect(() => {
    if (!selectedCell) {
      setDrilldown(null);
      return;
    }

    let cancelled = false;
    setDrilldownLoading(true);

    const params = new URLSearchParams({
      routeId,
      stopId: selectedCell.stopId,
      serviceDate: selectedCell.date,
    });

    fetch(`/api/heatmap-drilldown?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<DrilldownPayload>;
      })
      .then((d) => {
        if (!cancelled) {
          setDrilldown(d);
          setDrilldownLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setDrilldownLoading(false);
      });

    return () => { cancelled = true; };
  }, [routeId, selectedCell]);

  // ─── Build lookup for cells ────────────────────────────────

  const cellLookup = useMemo(() => {
    if (!payload) return new Map<string, HeatmapCell>();
    const map = new Map<string, HeatmapCell>();
    for (const c of payload.cells) {
      map.set(`${c.stopId}\t${c.serviceDate}`, c);
    }
    return map;
  }, [payload]);

  // ─── Sorted drilldown trips ────────────────────────────────

  const sortedTrips = useMemo(() => {
    if (!drilldown?.trips.length) return [];
    const trips = [...drilldown.trips];
    trips.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'scheduledTime': cmp = a.scheduledSec - b.scheduledSec; break;
        case 'actualTime': cmp = a.actualSec - b.actualSec; break;
        case 'delaySec': cmp = a.delaySec - b.delaySec; break;
        case 'halfTripId': cmp = a.halfTripId.localeCompare(b.halfTripId); break;
        case 'directionId': cmp = a.directionId.localeCompare(b.directionId); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return trips;
  }, [drilldown, sortField, sortDir]);

  // ─── Event handlers ────────────────────────────────────────

  const handleCellHover = useCallback(
    (e: React.MouseEvent, stopId: string, date: string, stopName: string) => {
      const cell = cellLookup.get(`${stopId}\t${date}`);
      if (!cell) {
        setTooltip(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      const x = e.clientX - (rect?.left ?? 0) + 12;
      const y = e.clientY - (rect?.top ?? 0) - 8;
      setTooltip({ x, y, cell, stopId, stopName, date });
    },
    [cellLookup],
  );

  const handleCellLeave = useCallback(() => setTooltip(null), []);

  const handleCellClick = useCallback((stopId: string, date: string) => {
    setSelectedCell((prev) =>
      prev?.stopId === stopId && prev?.date === date ? null : { stopId, date },
    );
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  // ─── Render states ─────────────────────────────────────────

  if (loading) {
    return <p style={{ color: '#666', padding: '1rem' }}>Loading heatmap data…</p>;
  }
  if (error) {
    return <p style={{ color: 'coral', padding: '1rem' }}>Error: {error}</p>;
  }
  if (!payload?.csvPath) {
    return (
      <p style={{ color: '#666', padding: '1rem' }}>
        No MBTA CSV found. Set <code>MBTA_BUS_ARRIVAL_CSV</code> or add{' '}
        <code>data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv</code>.
      </p>
    );
  }
  if (payload.cells.length === 0) {
    return <p style={{ color: '#666', padding: '1rem' }}>No data for route {routeId}.</p>;
  }

  const { stops, dates } = payload;
  const CELL_W = 28;
  const CELL_H = 22;
  const LABEL_W = 280;

  // ─── Main render ───────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, fontSize: '0.8rem', color: '#555' }}>
        <span>On-time rate:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ width: 16, height: 12, background: onTimeRateColor(0), borderRadius: 2 }} />
          <span>0%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ width: 16, height: 12, background: onTimeRateColor(0.5), borderRadius: 2 }} />
          <span>50%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <div style={{ width: 16, height: 12, background: onTimeRateColor(1), borderRadius: 2 }} />
          <span>100%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 8 }}>
          <div style={{ width: 16, height: 12, background: noDataColor(), borderRadius: 2 }} />
          <span>No data</span>
        </div>
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
          Click a cell to drill down into individual trips
        </span>
      </div>

      {/* Heatmap grid */}
      <div style={{ overflowX: 'auto', border: '1px solid #d0d0d0', borderRadius: 8, background: '#fff' }}>
        <div style={{ display: 'inline-block', minWidth: 'fit-content' }}>
          {/* Date header row */}
          <div style={{ display: 'flex', paddingLeft: LABEL_W }}>
            {dates.map((d) => (
              <div
                key={d}
                style={{
                  width: CELL_W,
                  minWidth: CELL_W,
                  textAlign: 'center',
                  fontSize: 7,
                  color: '#666',
                  transform: 'rotate(-50deg)',
                  transformOrigin: 'center bottom',
                  whiteSpace: 'nowrap',
                  height: 48,
                  display: 'flex',
                  alignItems: 'flex-end',
                  justifyContent: 'center',
                }}
              >
                {d.slice(5)}
              </div>
            ))}
          </div>

          {/* Stop rows */}
          {stops.map((stop, rowIndex) => {
            // Same Y labels as data-analysis.py heatmap_stop_date: stop_name only (no direction prefix).
            const prevName = rowIndex > 0 ? (stops[rowIndex - 1]!.stopName ?? stops[rowIndex - 1]!.stopId) : '';
            const thisName = stop.stopName ?? stop.stopId;
            const labelText =
              prevName && prevName === thisName
                ? `${thisName} (${stop.stopId})`
                : thisName;
            return (
              <div key={`r${rowIndex}-${stop.stopId}`} style={{ display: 'flex', alignItems: 'center' }}>
                {/* Stop label from GTFS stops.txt (fallback stop_id), like static PNG */}
                <div
                  style={{
                    width: LABEL_W,
                    minWidth: LABEL_W,
                    fontSize: 9,
                    color: '#333',
                    paddingRight: 6,
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    height: CELL_H,
                    lineHeight: `${CELL_H}px`,
                  }}
                  title={`${stop.stopName ?? stop.stopId} · ${stop.stopId} · ${directionLongLabel(stop.directionId)} · order ${stop.timePointOrder}`}
                >
                  {labelText}
                </div>

                {/* Cells */}
                {dates.map((date) => {
                  const cell = cellLookup.get(`${stop.stopId}\t${date}`);
                  const isSelected =
                    selectedCell?.stopId === stop.stopId && selectedCell?.date === date;

                  return (
                    <div
                      key={date}
                      style={{
                        width: CELL_W,
                        minWidth: CELL_W,
                        height: CELL_H,
                        background: cell ? onTimeRateColor(cell.onTimeRate) : noDataColor(),
                        cursor: cell ? 'pointer' : 'default',
                        outline: isSelected ? '2px solid #1a1a1a' : 'none',
                        outlineOffset: -1,
                        transition: 'outline 0.1s',
                      }}
                      onMouseMove={(e) => handleCellHover(e, stop.stopId, date, stop.stopName ?? stop.stopId)}
                      onMouseLeave={handleCellLeave}
                      onClick={() => cell && handleCellClick(stop.stopId, date)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.75rem', color: '#888' }}>
        <span style={{ paddingLeft: LABEL_W / 2 }}>← Stop (route order)</span>
        <span>Service date →</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            left: tooltip.x,
            top: tooltip.y,
            background: '#fff',
            border: '1px solid #aaa',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: '0.8rem',
            lineHeight: 1.6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            pointerEvents: 'none',
            zIndex: 100,
            maxWidth: 280,
          }}
        >
          <div><strong>Stop:</strong> {tooltip.stopName}</div>
          <div style={{ fontSize: '0.75rem', color: '#666' }}>ID: {tooltip.stopId}</div>
          <div><strong>Date:</strong> {tooltip.date}</div>
          <div>
            <strong>On-time rate:</strong>{' '}
            <span style={{ color: onTimeRateColor(tooltip.cell.onTimeRate), fontWeight: 600 }}>
              {(tooltip.cell.onTimeRate * 100).toFixed(1)}%
            </span>
          </div>
          <div>
            <strong>Trips:</strong> {tooltip.cell.totalTrips} ({tooltip.cell.onTimeCount} on time)
          </div>
        </div>
      )}

      {/* Drill-down panel */}
      {selectedCell && (
        <div
          style={{
            marginTop: 16,
            border: '1px solid #bbb',
            borderRadius: 8,
            background: '#fafafa',
            overflow: 'hidden',
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              background: '#f0f0f0',
              borderBottom: '1px solid #ddd',
            }}
          >
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              Trip details —{' '}
              {drilldown && !drilldownLoading
                ? `${drilldown.stopName} (${drilldown.stopId})`
                : `Stop ${selectedCell.stopId}`}{' '}
              on {selectedCell.date}
            </div>
            <button
              onClick={() => setSelectedCell(null)}
              style={{
                background: 'none',
                border: '1px solid #aaa',
                borderRadius: 4,
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              ✕ Close
            </button>
          </div>

          {/* Panel body */}
          <div style={{ padding: '12px 16px', maxHeight: 720, overflowY: 'auto' }}>
            {drilldownLoading ? (
              <p style={{ color: '#666' }}>Loading trip details…</p>
            ) : !drilldown?.trips.length ? (
              <p style={{ color: '#666' }}>No trip-level records found.</p>
            ) : (
              <>
                <p style={{ fontSize: '0.8rem', color: '#555', marginBottom: 8 }}>
                  {drilldown.trips.length} trip observation{drilldown.trips.length !== 1 ? 's' : ''}
                  {' — '}
                  on-time = within [−1 min early, +5 min late] of schedule
                </p>

                <DrilldownDelayOverTimeChart trips={drilldown.trips} />

                <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.78rem',
                  }}
                >
                  <thead>
                    <tr style={{ background: '#e8e8e8', textAlign: 'left' }}>
                      <SortableHeader field="halfTripId" label="Trip ID" current={sortField} dir={sortDir} onSort={handleSort} />
                      <SortableHeader field="directionId" label="Dir" current={sortField} dir={sortDir} onSort={handleSort} />
                      <SortableHeader field="scheduledTime" label="Scheduled" current={sortField} dir={sortDir} onSort={handleSort} />
                      <SortableHeader field="actualTime" label="Actual" current={sortField} dir={sortDir} onSort={handleSort} />
                      <SortableHeader field="delaySec" label="Delay" current={sortField} dir={sortDir} onSort={handleSort} />
                      <th style={thStyle}>On time</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Sched HW</th>
                      <th style={thStyle}>Act HW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTrips.map((t, i) => (
                      <tr
                        key={`${t.halfTripId}-${t.scheduledSec}-${i}`}
                        style={{
                          background: i % 2 === 0 ? '#fff' : '#f7f7f7',
                          borderBottom: '1px solid #eee',
                        }}
                      >
                        <td style={tdStyle}>
                          <code style={{ fontSize: '0.72rem' }}>{t.halfTripId}</code>
                        </td>
                        <td style={tdStyle}>
                          {t.directionId === '1' ? 'Inbound' : 'Outbound'}
                        </td>
                        <td style={tdStyle}>{t.scheduledTime}</td>
                        <td style={tdStyle}>{t.actualTime || '—'}</td>
                        <td
                          style={{
                            ...tdStyle,
                            color: t.delaySec > 300 ? '#c0392b' : t.delaySec < -60 ? '#2980b9' : '#333',
                            fontWeight: Math.abs(t.delaySec) > 300 ? 600 : 400,
                          }}
                        >
                          {formatDelay(t.delaySec)}
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: t.isOnTime ? '#27ae60' : '#c0392b',
                              marginRight: 4,
                            }}
                          />
                          {t.isOnTime ? 'Yes' : 'No'}
                        </td>
                        <td style={tdStyle}>{t.standardType}</td>
                        <td style={tdStyle}>
                          {t.scheduledHeadway != null ? `${t.scheduledHeadway}s` : '—'}
                        </td>
                        <td style={tdStyle}>
                          {t.actualHeadway != null ? `${t.actualHeadway}s` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** On-time band in seconds (matches scorecard): −60 … +300. */
const ON_TIME_BAND_LOW_SEC = -60;
const ON_TIME_BAND_HIGH_SEC = 300;

/**
 * X = time of day at scheduled arrival (seconds since midnight).
 * Y = delay (actual − scheduled), seconds; positive = late. Points sorted by scheduled time and connected.
 */
function DrilldownDelayOverTimeChart({ trips }: { trips: DrilldownTrip[] }) {
  const chart = useMemo(() => {
    const valid = trips.filter((t) => t.scheduledSec >= 0 && t.actualSec >= 0);
    if (valid.length === 0) return null;

    const sorted = [...valid].sort((a, b) => a.scheduledSec - b.scheduledSec);
    const PAD_L = 52;
    const PAD_R = 24;
    const PAD_T = 20;
    const PAD_B = 46;
    const W = 720;
    const H = 300;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const xs = sorted.map((t) => t.scheduledSec);
    const xMinRaw = Math.min(...xs);
    const xMaxRaw = Math.max(...xs);
    const padX = Math.max(30, (xMaxRaw - xMinRaw) * 0.03 || 30);
    const xMin = xMinRaw - padX;
    const xMax = xMaxRaw + padX;
    const xSpan = xMax - xMin || 1;

    const delays = sorted.map((t) => t.delaySec);
    const dMin = Math.min(...delays);
    const dMax = Math.max(...delays);
    const padY = Math.max(45, (dMax - dMin) * 0.12 || 90);
    const yMin = Math.min(dMin - padY, ON_TIME_BAND_LOW_SEC - 30);
    const yMax = Math.max(dMax + padY, ON_TIME_BAND_HIGH_SEC + 30);
    const ySpan = yMax - yMin || 1;

    const sx = (x: number) => PAD_L + ((x - xMin) / xSpan) * plotW;
    const sy = (delaySec: number) => PAD_T + plotH - ((delaySec - yMin) / ySpan) * plotH;

    const dLine = sorted
      .map((t, i) => `${i === 0 ? 'M' : 'L'} ${sx(t.scheduledSec)} ${sy(t.delaySec)}`)
      .join(' ');

    const xTicks = linspace(xMin, xMax, 5);
    const yTicks = linspace(yMin, yMax, 6);

    const y0 = sy(0);
    const bandTop = sy(ON_TIME_BAND_HIGH_SEC);
    const bandBot = sy(ON_TIME_BAND_LOW_SEC);
    const bandY = Math.min(bandTop, bandBot);
    const bandH = Math.abs(bandBot - bandTop);

    return (
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <p style={{ fontSize: '0.78rem', color: '#555', margin: '0 0 6px' }}>
          Each point is one observation at this stop: <strong>x</strong> = scheduled time of day,{' '}
          <strong>y</strong> = delay (actual − scheduled). Shaded band = on-time window (−1 to +5 min).
        </p>
        <svg width={W} height={H} style={{ display: 'block', maxWidth: '100%', height: 'auto' }}>
          <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="#fafafa" stroke="#e5e7eb" />
          {/* On-time band (behind grid) */}
          {yMax >= ON_TIME_BAND_LOW_SEC && yMin <= ON_TIME_BAND_HIGH_SEC && (
            <rect
              x={PAD_L}
              y={bandY}
              width={plotW}
              height={Math.max(bandH, 1)}
              fill="#dcfce7"
              opacity={0.55}
            />
          )}
          {yTicks.map((yt) => (
            <g key={`gy-${yt}`}>
              <line
                x1={PAD_L}
                x2={PAD_L + plotW}
                y1={sy(yt)}
                y2={sy(yt)}
                stroke={Math.abs(yt) < 1e-6 ? '#94a3b8' : '#eee'}
                strokeWidth={Math.abs(yt) < 1e-6 ? 1.5 : 1}
              />
              <text x={PAD_L - 6} y={sy(yt) + 4} textAnchor="end" fontSize={9} fill="#64748b">
                {formatDelayAxis(yt)}
              </text>
            </g>
          ))}
          {xTicks.map((xt) => (
            <text
              key={`gx-${xt}`}
              x={sx(xt)}
              y={H - 12}
              textAnchor="middle"
              fontSize={9}
              fill="#64748b"
            >
              {formatClock(xt)}
            </text>
          ))}
          <text x={PAD_L + plotW / 2} y={H - 2} textAnchor="middle" fontSize={10} fill="#334155">
            Time of day (scheduled at stop)
          </text>
          <text
            x={12}
            y={PAD_T + plotH / 2}
            textAnchor="middle"
            fontSize={10}
            fill="#334155"
            transform={`rotate(-90 12 ${PAD_T + plotH / 2})`}
          >
            Delay (actual − scheduled)
          </text>
          {/* y = 0 on schedule (delay 0) */}
          {y0 >= PAD_T && y0 <= PAD_T + plotH && (
            <line
              x1={PAD_L}
              x2={PAD_L + plotW}
              y1={y0}
              y2={y0}
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
          <path d={dLine} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
          {sorted.map((t, idx) => (
            <circle
              key={`d-${idx}-${t.halfTripId}-${t.scheduledSec}`}
              cx={sx(t.scheduledSec)}
              cy={sy(t.delaySec)}
              r={3.5}
              fill={t.isOnTime ? '#15803d' : '#ea580c'}
              stroke="#fff"
              strokeWidth={1}
            />
          ))}
        </svg>
        <div style={{ display: 'flex', gap: 20, fontSize: '0.75rem', color: '#475569', marginTop: 4 }}>
          <span>
            <span style={{ color: '#2563eb', fontWeight: 700 }}>━</span> Delay trace (by scheduled time)
          </span>
          <span>
            <span style={{ color: '#15803d', fontWeight: 700 }}>●</span> On time &nbsp;
            <span style={{ color: '#ea580c', fontWeight: 700 }}>●</span> Not on time
          </span>
        </div>
      </div>
    );
  }, [trips]);

  if (!chart) return null;
  return chart;
}

/** Compact delay label for Y axis (seconds). */
function formatDelayAxis(sec: number): string {
  if (Math.abs(sec) < 1) return '0';
  const sign = sec > 0 ? '+' : '−';
  const abs = Math.abs(sec);
  if (abs < 120) return `${sign}${Math.round(abs)}s`;
  const m = abs / 60;
  return `${sign}${m.toFixed(m >= 10 ? 0 : 1)}m`;
}

function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(a + ((b - a) * i) / (n - 1));
  }
  return out;
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec % 86400);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Matches data-analysis.py heatmap labels: Inbound for direction_id 1. */
function directionLongLabel(directionId: string): string {
  return directionId === '1' || directionId === 'Inbound' ? 'Inbound' : 'Outbound';
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatDelay(sec: number): string {
  if (sec === 0) return '0s';
  const abs = Math.abs(sec);
  const min = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  const sign = sec > 0 ? '+' : '−';
  if (min === 0) return `${sign}${s}s`;
  return `${sign}${min}m ${s}s`;
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  borderBottom: '2px solid #ccc',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 8px',
  whiteSpace: 'nowrap',
};

function SortableHeader({
  field,
  label,
  current,
  dir,
  onSort,
}: {
  field: SortField;
  label: string;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const arrow = current === field ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(field)}
    >
      {label}{arrow}
    </th>
  );
}

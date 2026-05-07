'use client';

import React, { useEffect, useMemo, useState } from 'react';

type ApiTrip = {
  dateIso: string;
  directionId: string;
  halfTripId: string;
  firstScheduledSec: number;
  observedTripMinutes: number;
  delayed: boolean;
};

type ApiPayload = {
  routeId: string;
  sourceCsv: string | null;
  count: number;
  trips: ApiTrip[];
};

const PAD_L = 48;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 40;
const COL_W = 28;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function TripSpikeCharts({ routeId }: { routeId: string }) {
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setPayload(null);
    fetch(`/api/route-trip-series?routeId=${encodeURIComponent(routeId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<ApiPayload>;
      })
      .then((d) => {
        if (!cancelled) setPayload(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const spikeSvg = useMemo(() => {
    if (!payload?.trips.length) return null;
    const trips = payload.trips;
    const days = Array.from(new Set(trips.map((t) => t.dateIso))).sort();
    const maxObs = Math.max(...trips.map((t) => t.observedTripMinutes), 1);
    const plotW = days.length * COL_W;
    const plotH = 260;
    const W = PAD_L + plotW + PAD_R;
    const H = PAD_T + plotH + PAD_B;
    const rng = mulberry32(42);

    const lines: React.ReactElement[] = [];
    for (const t of trips) {
      const di = days.indexOf(t.dateIso);
      if (di < 0) continue;
      const frac = Math.min(0.999, Math.max(0, t.firstScheduledSec / 86400));
      const jitter = (rng() - 0.5) * COL_W * 0.04;
      const x = PAD_L + di * COL_W + 0.06 * COL_W + frac * COL_W * 0.88 + jitter;
      const y0 = PAD_T + plotH;
      const y1 = PAD_T + plotH - (t.observedTripMinutes / maxObs) * plotH;
      lines.push(
        <line
          key={`${t.dateIso}-${t.directionId}-${t.halfTripId}-${t.firstScheduledSec}`}
          x1={x}
          x2={x}
          y1={y0}
          y2={y1}
          stroke={t.delayed ? '#c0392b' : '#2c3e50'}
          strokeWidth={1.1}
          opacity={0.88}
        />,
      );
    }

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: PAD_T + plotH - f * plotH,
      label: `${(f * maxObs).toFixed(0)}`,
    }));

    return (
      <svg width={W} height={H} style={{ maxWidth: '100%', height: 'auto' }}>
        {yTicks.map((tk) => (
          <g key={tk.label}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={tk.y} y2={tk.y} stroke="#eee" strokeWidth={1} />
            <text x={PAD_L - 6} y={tk.y + 4} textAnchor="end" fontSize={10} fill="#666">
              {tk.label}
            </text>
          </g>
        ))}
        {lines}
        <text x={PAD_L + plotW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#333">
          Day (position within column ≈ first scheduled time)
        </text>
        <text
          x={12}
          y={PAD_T + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#333"
          transform={`rotate(-90 12 ${PAD_T + plotH / 2})`}
        >
          Observed trip time (min)
        </text>
        {days.map((d, i) => (
          <text
            key={d}
            x={PAD_L + i * COL_W + COL_W / 2}
            y={PAD_T + plotH + 22}
            textAnchor="middle"
            fontSize={8}
            fill="#555"
          >
            {d.slice(5)}
          </text>
        ))}
      </svg>
    );
  }, [payload]);

  if (err) {
    return <p style={{ color: 'coral' }}>Could not load: {err}</p>;
  }
  if (!payload) {
    return <p style={{ color: '#666' }}>Loading…</p>;
  }
  if (!payload.sourceCsv) {
    return (
      <p style={{ color: '#666' }}>
        No MBTA CSV found. Set <code>MBTA_BUS_ARRIVAL_CSV</code> or add{' '}
        <code>data/mbta-bus/MBTA-Bus-Arrival-Departure-Times_YYYY-MM.csv</code>.
      </p>
    );
  }
  if (payload.count === 0) {
    return <p style={{ color: '#666' }}>No half-trips for route {routeId} in this file.</p>;
  }

  return (
    <div>
      <p style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.75rem' }}>
        <code>{payload.count}</code> half-trips from <code style={{ wordBreak: 'break-all' }}>{payload.sourceCsv}</code>
      </p>
      <div style={{ overflowX: 'auto', border: '1px solid #e0e0e0', borderRadius: 8, padding: 12 }}>
        {spikeSvg}
      </div>
      <p style={{ fontSize: '0.8rem', color: '#777', marginTop: '0.75rem' }}>
        <span style={{ color: '#2c3e50' }}>■</span> on time vs scheduled trip length &nbsp;
        <span style={{ color: '#c0392b' }}>■</span> &gt;3 min slower than scheduled end-to-end
      </p>
    </div>
  );
}

'use client';

import type { ScorecardRow } from '@/lib/types';

interface ScorecardTableProps {
  rows: ScorecardRow[];
}

function fmt(n: number | null): string {
  if (n == null) return '—';
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
}

function ratioClass(r: number | null): string {
  if (r == null) return '';
  if (r <= 0.8) return 'bad';
  if (r >= 1.2) return 'high';
  return 'ok';
}

export default function ScorecardTable({ rows }: ScorecardTableProps) {
  if (rows.length === 0) {
    return <p style={{ padding: 16, color: '#666' }}>No route data for this time window. Ensure GTFS data is in place.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '8px 10px' }}>Route</th>
            <th style={{ padding: '8px 10px' }}>Stop</th>
            <th style={{ padding: '8px 10px' }}>Sched (min)</th>
            <th style={{ padding: '8px 10px' }}>Archived (min)</th>
            <th style={{ padding: '8px 10px' }}>Archived IQR</th>
            <th style={{ padding: '8px 10px' }}>Bunch %</th>
            <th style={{ padding: '8px 10px' }}>Live (min)</th>
            <th style={{ padding: '8px 10px' }}>Live IQR</th>
            <th style={{ padding: '8px 10px' }}>Rel. (arch)</th>
            <th style={{ padding: '8px 10px' }}>Rel. (live)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.routeId}-${row.keyStopId}-${i}`} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px 10px' }}>{row.routeName}</td>
              <td style={{ padding: '8px 10px' }}>{row.keyStopName ?? row.keyStopId}</td>
              <td style={{ padding: '8px 10px' }}>{fmt(row.scheduledMedianMin)}</td>
              <td style={{ padding: '8px 10px' }}>{fmt(row.archivedMedianMin)}</td>
              <td style={{ padding: '8px 10px' }}>
                {row.archivedP25Min != null && row.archivedP75Min != null
                  ? `${fmt(row.archivedP25Min)}–${fmt(row.archivedP75Min)}`
                  : '—'}
              </td>
              <td style={{ padding: '8px 10px' }}>{row.archivedBunchingRate != null ? `${(row.archivedBunchingRate * 100).toFixed(0)}%` : '—'}</td>
              <td style={{ padding: '8px 10px' }}>{fmt(row.liveMedianMin)}</td>
              <td style={{ padding: '8px 10px' }}>{fmt(row.liveIQRMin)}</td>
              <td style={{ padding: '8px 10px', color: row.reliabilityRatioArchived != null ? (ratioClass(row.reliabilityRatioArchived) === 'bad' ? '#dc2626' : ratioClass(row.reliabilityRatioArchived) === 'high' ? '#2563eb' : '#16a34a') : undefined }}>
                {row.reliabilityRatioArchived != null ? row.reliabilityRatioArchived.toFixed(2) : '—'}
              </td>
              <td style={{ padding: '8px 10px', color: row.reliabilityRatioLive != null ? (ratioClass(row.reliabilityRatioLive) === 'bad' ? '#dc2626' : ratioClass(row.reliabilityRatioLive) === 'high' ? '#2563eb' : '#16a34a') : undefined }}>
                {row.reliabilityRatioLive != null ? row.reliabilityRatioLive.toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

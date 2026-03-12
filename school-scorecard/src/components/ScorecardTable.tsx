'use client';

import type { ScorecardRow } from '@/lib/types';

interface ScorecardTableProps {
  rows: ScorecardRow[];
  selectedRouteId?: string | null;
  onRouteClick?: (routeId: string | null) => void;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—';
}

function ratioColor(r: number | null): string {
  if (r == null) return '#6b7280';
  if (r <= 1.0) return '#16a34a';
  if (r <= 1.2) return '#ca8a04';
  return '#dc2626';
}

function ratioLabel(r: number | null): string {
  if (r == null) return '—';
  return r.toFixed(2);
}

export default function ScorecardTable({ rows, selectedRouteId, onRouteClick }: ScorecardTableProps) {
  if (rows.length === 0) {
    return <p style={{ padding: 16, color: '#666' }}>No route data for this time window. Ensure GTFS data is in place.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      {onRouteClick && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#6b7280', padding: '0 2px' }}>
          Click a route to map its headway performance
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left', background: '#f9fafb' }}>
            <th style={{ padding: '8px 10px' }}>Route</th>
            <th style={{ padding: '8px 10px' }}>Stop</th>
            <th style={{ padding: '8px 10px' }}>Sched (min)</th>
            <th style={{ padding: '8px 10px' }}>Actual (min)</th>
            <th style={{ padding: '8px 10px' }}>IQR</th>
            <th style={{ padding: '8px 10px' }}>Bunch %</th>
            <th style={{ padding: '8px 10px' }}>Ratio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isSelected = selectedRouteId === row.routeId;
            const ratio = row.reliabilityRatioArchived;
            return (
              <tr
                key={`${row.routeId}-${row.keyStopId}-${i}`}
                onClick={() => onRouteClick?.(isSelected ? null : row.routeId)}
                style={{
                  borderBottom: '1px solid #eee',
                  cursor: onRouteClick ? 'pointer' : 'default',
                  background: isSelected ? '#eff6ff' : undefined,
                  borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f9fafb';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = isSelected ? '#eff6ff' : '';
                }}
              >
                <td style={{ padding: '8px 10px', fontWeight: isSelected ? 600 : undefined }}>
                  {row.routeName}
                </td>
                <td style={{ padding: '8px 10px', color: '#6b7280', fontSize: 12 }}>
                  {row.keyStopName ?? row.keyStopId}
                </td>
                <td style={{ padding: '8px 10px' }}>{fmt(row.scheduledMedianMin)}</td>
                <td style={{ padding: '8px 10px' }}>
                  {row.archivedMedianMin != null ? (
                    <span style={{ color: ratioColor(ratio), fontWeight: 500 }}>
                      {fmt(row.archivedMedianMin)}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ padding: '8px 10px', fontSize: 12, color: '#6b7280' }}>
                  {row.archivedP25Min != null && row.archivedP75Min != null
                    ? `${fmt(row.archivedP25Min)}–${fmt(row.archivedP75Min)}`
                    : '—'}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {row.archivedBunchingRate != null ? `${(row.archivedBunchingRate * 100).toFixed(0)}%` : '—'}
                </td>
                <td style={{ padding: '8px 10px', color: ratioColor(ratio), fontWeight: 600 }}>
                  {ratioLabel(ratio)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: '8px 10px', fontSize: 11, color: '#9ca3af', display: 'flex', gap: 12 }}>
        <span><span style={{ color: '#16a34a' }}>●</span> ≤ 1.0 on time</span>
        <span><span style={{ color: '#ca8a04' }}>●</span> 1.0–1.2 slightly late</span>
        <span><span style={{ color: '#dc2626' }}>●</span> &gt; 1.2 delayed</span>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { InteractiveHeatmap } from './InteractiveHeatmap';

export const metadata = {
  title: 'Route on-time heatmap',
  description: 'Interactive stop × date on-time rate heatmap with trip drill-down',
};

/**
 * /route-heatmap?routeId=28 | ?routeId=1
 *
 * Replaces the static PNG heatmap from data-analysis.py with an interactive
 * web-based version. Hover cells for summary; click to drill into individual trips.
 */
export default function RouteHeatmapPage({
  searchParams,
}: {
  searchParams: { routeId?: string };
}) {
  const routeId = searchParams.routeId?.trim() || '28';

  return (
    <main
      style={{
        padding: '1.5rem',
        maxWidth: 1400,
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ marginBottom: '0.75rem' }}>
        <Link
          href="/school/madison-park"
          style={{
            display: 'inline-block',
            padding: '6px 14px',
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            fontSize: '0.85rem',
            fontWeight: 600,
            color: '#1d4ed8',
            textDecoration: 'none',
          }}
        >
          ← School scorecard (home)
        </Link>
      </div>
      <h1 style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>
        Route {routeId} — On-time performance heatmap
      </h1>
      <p
        style={{
          fontSize: '0.85rem',
          color: '#555',
          marginBottom: '1rem',
          lineHeight: 1.5,
          maxWidth: 800,
        }}
      >
        Each cell shows the <strong>on-time rate</strong> for a stop on a given service date.
        On-time = actual arrival within [scheduled − 1 min, scheduled + 5 min].
        Green is better (higher on-time rate). Hover for details; <strong>click a cell</strong>{' '}
        to see the individual trips that contributed to it.{' '}
        Use <code>?routeId=1</code> for the route&nbsp;1 (Mass Ave) heatmap with the same on-time rules.
      </p>

      <InteractiveHeatmap routeId={routeId} />

      <div
        style={{
          marginTop: '1.5rem',
          padding: '12px 16px',
          background: '#f9f9f9',
          border: '1px solid #e0e0e0',
          borderRadius: 6,
          fontSize: '0.78rem',
          color: '#777',
          lineHeight: 1.6,
        }}
      >
        <strong>Data source:</strong> MBTA Bus Arrival/Departure Times CSV.{' '}
        <strong>PNG heatmaps</strong> from <code>python data-analysis.py</code>: route&nbsp;28 uses{' '}
        <code>route28HeatmapStopOrder.ts</code>; route&nbsp;1 uses the longest GTFS trip when{' '}
        <code>trips.txt</code> / <code>stop_times.txt</code> sit next to <code>stops.txt</code>.{' '}
        Stop <strong>row order</strong> (this page): route&nbsp;28 — inbound Mattapan → Ruggles follows{' '}
        <code>ROUTE_28_MATTAPAN_TO_RUGGLES_CORRIDOR</code> (<code>route28HeatmapCorridorStopNames.ts</code>) in array order;{' '}
        <code>route28HeatmapStopOrder.ts</code> appends the Longwood / post-Ruggles tails.{' '}
        Route&nbsp;1 — longest route&nbsp;1 trip in GTFS{' '}
        (<code>route1HeatmapStopOrder.ts</code>). Other routes use GTFS <code>stop_times</code> median order.
        When GTFS stop_ids match the CSV, rows are limited to that pattern; if none match, the full CSV
        grid is shown. Labels use <code>stop_name</code> from <code>stops.txt</code>. Columns = service dates.{' '}
        Cells with fewer than 5 observations are hidden. The color scale (red → yellow → green)
        maps 0% → 50% → 100% on-time rate, matching the static PNG heatmap.
      </div>
    </main>
  );
}

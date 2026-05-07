import { TripSpikeCharts } from './TripSpikeCharts';

export const metadata = {
  title: 'Route trip times (observed)',
  description: 'Observed end-to-end bus trip times from MBTA arrival/departure CSV',
};

export default function RouteTripChartsPage({
  searchParams,
}: {
  searchParams: { routeId?: string };
}) {
  const routeId = searchParams.routeId?.trim() || '28';
  return (
    <main style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Observed trip times — route {routeId}</h1>
      <p style={{ fontSize: '0.9rem', color: '#444', marginBottom: '1rem', lineHeight: 1.5 }}>
        Each line is one half-trip: <strong>height = observed minutes</strong> (actual time from first to last time
        point). Blue vs red uses scheduled end-to-end only to flag delays (&gt;3 min longer than scheduled). Same CSV
        as the school scorecard archived layer; the map/scorecard still shows <em>stop headway</em> medians, not this
        trip length.
      </p>
      <TripSpikeCharts routeId={routeId} />
    </main>
  );
}

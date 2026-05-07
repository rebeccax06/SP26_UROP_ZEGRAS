import SimulationView from './SimulationView';

export const metadata = {
  title: 'Route simulation — scheduled vs actual',
  description: 'Animate scheduled and observed bus positions for one historical day.',
};

const DEFAULT_ROUTE = '28';
// Default to a date that exists in the bundled MBTA-Bus-Arrival-Departure-Times_2026-01.csv.
const DEFAULT_DATE = '2026-01-15';

export default function RouteSimulationPage({
  searchParams,
}: {
  searchParams: { routeId?: string; date?: string };
}) {
  const routeId = searchParams.routeId?.trim() || DEFAULT_ROUTE;
  const date = searchParams.date?.trim() || DEFAULT_DATE;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

  return (
    <main style={{ padding: '1.25rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>
        Route simulation — scheduled vs actual
      </h1>
      <p style={{ fontSize: '0.85rem', color: '#4b5563', margin: '0 0 0.75rem 0' }}>
        Blue dot = scheduled position interpolated from GTFS stop_times. Red dot = actual position interpolated by time
        between observed timepoints from the MBTA arrival/departure CSV. Gray = no observed data yet (or after the last
        observed timepoint). Each dashed leash shows live schedule deviation for one trip.
      </p>
      <SimulationView mapboxToken={mapboxToken} initialRouteId={routeId} initialDate={date} />
    </main>
  );
}

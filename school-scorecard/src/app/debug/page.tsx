'use client';

import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DebugStop {
  stopId: string;
  stopName: string;
  distanceMeters: number;
  lat: number;
  lon: number;
}

interface DebugRoute {
  routeId: string;
  routeShortName: string;
  routeLongName: string;
}

interface DebugScheduledHeadway {
  routeId: string;
  stopId: string;
  scheduledMedianHeadwayMinutes: number;
  tripCount: number;
}

export default function DebugPage() {
  const [schoolId, setSchoolId] = useState('demo');
  const [radiusMeters, setRadiusMeters] = useState(800);
  const [timeWindow, setTimeWindow] = useState<'AM' | 'PM' | 'AS'>('AM');

  const { data: gtfsData, error: gtfsError } = useSWR('/api/debug/gtfs', fetcher);
  const { data: stopsData, error: stopsError } = useSWR(
    `/api/debug/stops?schoolId=${schoolId}&radiusMeters=${radiusMeters}`,
    fetcher
  );
  const { data: routesData, error: routesError } = useSWR(
    `/api/debug/routes?schoolId=${schoolId}&radiusMeters=${radiusMeters}`,
    fetcher
  );
  const { data: scheduleData, error: scheduleError } = useSWR(
    `/api/debug/schedule?schoolId=${schoolId}&radiusMeters=${radiusMeters}&timeWindow=${timeWindow}`,
    fetcher
  );

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1>Data Diagnostic Dashboard</h1>
      <p>Use this page to verify your GTFS data is loading correctly.</p>

      <div style={{ marginBottom: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          School ID:{' '}
          <input
            type="text"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            style={{ padding: '4px 8px', marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Radius (meters):{' '}
          <input
            type="number"
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
            style={{ padding: '4px 8px', marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block' }}>
          Time Window:{' '}
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value as 'AM' | 'PM' | 'AS')}
            style={{ padding: '4px 8px', marginLeft: 8 }}
          >
            <option value="AM">Morning Arrival</option>
            <option value="PM">Afternoon Dismissal</option>
            <option value="AS">After School</option>
          </select>
        </label>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2>1. GTFS Loading Status</h2>
        {gtfsError ? (
          <div style={{ padding: 16, background: '#fee', borderRadius: 4 }}>
            <strong>Error:</strong> {String(gtfsError)}
          </div>
        ) : gtfsData ? (
          <div style={{ padding: 16, background: '#efe', borderRadius: 4 }}>
            <p>
              <strong>✓ GTFS loaded successfully</strong>
            </p>
            <ul>
              <li>Stops: {gtfsData.stats?.stops ?? 0}</li>
              <li>Routes: {gtfsData.stats?.routes ?? 0}</li>
              <li>Trips: {gtfsData.stats?.trips ?? 0}</li>
              <li>Stop Times: {gtfsData.stats?.stopTimes ?? 0}</li>
              <li>Calendar Services: {gtfsData.stats?.calendar ?? 0}</li>
              <li>Calendar Dates: {gtfsData.stats?.calendarDates ?? 0}</li>
            </ul>
          </div>
        ) : (
          <p>Loading...</p>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>2. Stops Near School</h2>
        {stopsError ? (
          <div style={{ padding: 16, background: '#fee', borderRadius: 4 }}>
            <strong>Error:</strong> {String(stopsError)}
          </div>
        ) : stopsData ? (
          <div style={{ padding: 16, background: '#fff', border: '1px solid #ddd', borderRadius: 4 }}>
            <p>
              <strong>Found {stopsData.stopsFound ?? 0} stops</strong> within {stopsData.radiusMeters}m of{' '}
              {stopsData.school?.name}
            </p>
            {stopsData.stops && stopsData.stops.length > 0 ? (
              <table style={{ width: '100%', marginTop: 12, fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: 8 }}>Stop ID</th>
                    <th style={{ padding: 8 }}>Name</th>
                    <th style={{ padding: 8 }}>Distance (m)</th>
                    <th style={{ padding: 8 }}>Lat/Lon</th>
                  </tr>
                </thead>
                <tbody>
                  {stopsData.stops.map((s: DebugStop) => (
                    <tr key={s.stopId} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8 }}>{s.stopId}</td>
                      <td style={{ padding: 8 }}>{s.stopName}</td>
                      <td style={{ padding: 8 }}>{s.distanceMeters}</td>
                      <td style={{ padding: 8, fontSize: 11 }}>
                        {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#666' }}>No stops found. Check school location and radius.</p>
            )}
          </div>
        ) : (
          <p>Loading...</p>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>3. Routes Serving Stops</h2>
        {routesError ? (
          <div style={{ padding: 16, background: '#fee', borderRadius: 4 }}>
            <strong>Error:</strong> {String(routesError)}
          </div>
        ) : routesData ? (
          <div style={{ padding: 16, background: '#fff', border: '1px solid #ddd', borderRadius: 4 }}>
            <p>
              <strong>Found {routesData.routesFound ?? 0} routes</strong> serving the stops
            </p>
            {routesData.routes && routesData.routes.length > 0 ? (
              <table style={{ width: '100%', marginTop: 12, fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: 8 }}>Route ID</th>
                    <th style={{ padding: 8 }}>Short Name</th>
                    <th style={{ padding: 8 }}>Long Name</th>
                  </tr>
                </thead>
                <tbody>
                  {routesData.routes.map((r: DebugRoute) => (
                    <tr key={r.routeId} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8 }}>{r.routeId}</td>
                      <td style={{ padding: 8 }}>{r.routeShortName}</td>
                      <td style={{ padding: 8 }}>{r.routeLongName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#666' }}>No routes found. This might be normal if stops aren't served by any routes.</p>
            )}
          </div>
        ) : (
          <p>Loading...</p>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>4. Scheduled Headways</h2>
        {scheduleError ? (
          <div style={{ padding: 16, background: '#fee', borderRadius: 4 }}>
            <strong>Error:</strong> {String(scheduleError)}
          </div>
        ) : scheduleData ? (
          <div style={{ padding: 16, background: '#fff', border: '1px solid #ddd', borderRadius: 4 }}>
            <p>
              <strong>Found {scheduleData.scheduledHeadwaysFound ?? 0} scheduled headways</strong> for{' '}
              {scheduleData.timeWindow?.id} window ({scheduleData.timeWindow?.startTime} -{' '}
              {scheduleData.timeWindow?.endTime}) on {scheduleData.serviceDate}
            </p>
            {scheduleData.scheduledHeadways && scheduleData.scheduledHeadways.length > 0 ? (
              <table style={{ width: '100%', marginTop: 12, fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: 8 }}>Route ID</th>
                    <th style={{ padding: 8 }}>Stop ID</th>
                    <th style={{ padding: 8 }}>Median Headway (min)</th>
                    <th style={{ padding: 8 }}>Trip Count</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleData.scheduledHeadways.map((h: DebugScheduledHeadway, i: number) => (
                    <tr key={`${h.routeId}-${h.stopId}-${i}`} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8 }}>{h.routeId}</td>
                      <td style={{ padding: 8 }}>{h.stopId}</td>
                      <td style={{ padding: 8 }}>{h.scheduledMedianHeadwayMinutes.toFixed(1)}</td>
                      <td style={{ padding: 8 }}>{h.tripCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: '#666' }}>
                No scheduled headways found. This could mean:
                <ul style={{ marginTop: 8, paddingLeft: 24 }}>
                  <li>No routes serve the stops</li>
                  <li>No trips run during the time window</li>
                  <li>The service date doesn't match any active service</li>
                </ul>
              </p>
            )}
          </div>
        ) : (
          <p>Loading...</p>
        )}
      </section>
    </main>
  );
}

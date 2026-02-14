import path from 'path';
import { clearGtfsCache } from '@/lib/gtfs/loadGtfs';
import { createScheduleProviderGTFS } from '@/lib/providers/schedule-gtfs';

const FIXTURE_GTFS = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'gtfs');

describe('scheduled headway from GTFS', () => {
  beforeEach(() => {
    clearGtfsCache();
  });

  it('computes scheduled median headway for route and stop in time window', async () => {
    const provider = createScheduleProviderGTFS(FIXTURE_GTFS);
    const results = await provider.getScheduledHeadways({
      routeIds: ['r1'],
      stopIds: ['s1', 's2'],
      serviceDate: '2025-02-12',
      startTime: '07:00',
      endTime: '09:00',
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const s1 = results.find((r) => r.stopId === 's1');
    expect(s1).toBeDefined();
    expect(s1!.routeId).toBe('r1');
    expect(s1!.scheduledMedianHeadwayMinutes).toBe(20);
    expect(s1!.tripCount).toBe(2);
  });
});

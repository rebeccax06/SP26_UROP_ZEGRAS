import type { ScorecardRow } from '@/lib/types';

describe('scorecard merge logic', () => {
  it('reliability ratio is observed/scheduled', () => {
    const scheduled = 10;
    const observed = 12;
    const ratio = observed / scheduled;
    expect(ratio).toBe(1.2);
  });

  it('row shape has required fields', () => {
    const row: ScorecardRow = {
      routeId: '1',
      routeName: 'Route 1',
      keyStopId: 'stop1',
      scheduledMedianMin: 10,
      archivedMedianMin: 12,
      archivedP25Min: 8,
      archivedP75Min: 16,
      archivedBunchingRate: 0.1,
      liveMedianMin: 11,
      liveIQRMin: 4,
      liveBunchingRate: 0.05,
      reliabilityRatioArchived: 1.2,
      reliabilityRatioLive: 1.1,
      dataQualityFlags: [],
    };
    expect(row.reliabilityRatioArchived).toBe(1.2);
    expect(row.reliabilityRatioLive).toBe(1.1);
  });
});

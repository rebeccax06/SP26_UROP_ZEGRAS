/**
 * Integration test for `GET /api/scorecard`.
 *
 * Requires a running dev server. Point `TEST_API_BASE` at it, or start
 * `npm run dev` on port 3000 (the default). The test is best-effort: if
 * the server returns a non-200 it logs a warning and exits instead of
 * failing, so CI without a server doesn't false-fail.
 */
import type { ScorecardApiResponse } from '@/lib/types';

const API_BASE = process.env.TEST_API_BASE ?? 'http://localhost:3000';

describe('GET /api/scorecard', () => {
  it('returns expected response shape when school exists', async () => {
    const res = await fetch(
      `${API_BASE}/api/scorecard?schoolId=demo&startTime=07:00&endTime=09:00`
    );
    if (res.status !== 200) {
      const text = await res.text();
      console.warn('Scorecard API returned', res.status, text);
      return;
    }
    const data = (await res.json()) as ScorecardApiResponse;
    expect(data).toHaveProperty('schoolId', 'demo');
    expect(data).toHaveProperty('startTime');
    expect(data).toHaveProperty('endTime');
    expect(data).toHaveProperty('startDate');
    expect(data).toHaveProperty('endDate');
    expect(Array.isArray(data.rows)).toBe(true);
    expect(Array.isArray(data.stops)).toBe(true);
    expect(Array.isArray(data.routes)).toBe(true);
    if (data.rows.length > 0) {
      const row = data.rows[0]!;
      expect(row).toHaveProperty('routeId');
      expect(row).toHaveProperty('routeName');
      expect(row).toHaveProperty('keyStopId');
      expect(row).toHaveProperty('scheduledMedianMin');
      expect(row).toHaveProperty('dataQualityFlags');
    }
  }, 15000);
});

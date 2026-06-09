import { join } from 'path';

jest.mock('fs', () => ({ existsSync: jest.fn() }));

import { existsSync } from 'fs';
import { getAnalysisFilePath } from '@/lib/analysis/getAnalysisFilePath';

const mockExists = existsSync as jest.MockedFunction<typeof existsSync>;

describe('getAnalysisFilePath', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ANALYSIS_OUTPUT_DIR;
    delete process.env.MBTA_BUS_ARRIVAL_MONTH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('prefers the month-suffixed file from ANALYSIS_OUTPUT_DIR', () => {
    process.env.ANALYSIS_OUTPUT_DIR = '/out';
    process.env.MBTA_BUS_ARRIVAL_MONTH = '2026-04';
    mockExists.mockImplementation((p) => p === '/out/route28_2026-04_stop_metrics.json');

    expect(getAnalysisFilePath('28')).toBe('/out/route28_2026-04_stop_metrics.json');
  });

  it('falls back to the legacy month-less filename in the same directory', () => {
    process.env.ANALYSIS_OUTPUT_DIR = '/out';
    process.env.MBTA_BUS_ARRIVAL_MONTH = '2026-04';
    mockExists.mockImplementation((p) => p === '/out/route28_stop_metrics.json');

    expect(getAnalysisFilePath('28')).toBe('/out/route28_stop_metrics.json');
  });

  it('lets the explicit month argument override the env var', () => {
    process.env.ANALYSIS_OUTPUT_DIR = '/out';
    process.env.MBTA_BUS_ARRIVAL_MONTH = '2026-04';
    mockExists.mockImplementation((p) => p === '/out/route28_2026-01_stop_metrics.json');

    expect(getAnalysisFilePath('28', '2026-01')).toBe('/out/route28_2026-01_stop_metrics.json');
  });

  it('defaults to 2026-01 when no month is configured', () => {
    process.env.ANALYSIS_OUTPUT_DIR = '/out';
    mockExists.mockImplementation((p) => p === '/out/route28_2026-01_stop_metrics.json');

    expect(getAnalysisFilePath('28')).toBe('/out/route28_2026-01_stop_metrics.json');
  });

  it('walks fallback directories in order (cwd/data/analysis, then ../analysis_output)', () => {
    process.env.MBTA_BUS_ARRIVAL_MONTH = '2026-04';
    const expected = join(process.cwd(), '..', 'analysis_output', 'route28_2026-04_stop_metrics.json');
    mockExists.mockImplementation((p) => p === expected);

    expect(getAnalysisFilePath('28')).toBe(expected);
  });

  it('returns null when no candidate exists', () => {
    process.env.ANALYSIS_OUTPUT_DIR = '/out';
    process.env.MBTA_BUS_ARRIVAL_MONTH = '2026-04';
    mockExists.mockReturnValue(false);

    expect(getAnalysisFilePath('28')).toBeNull();
  });
});

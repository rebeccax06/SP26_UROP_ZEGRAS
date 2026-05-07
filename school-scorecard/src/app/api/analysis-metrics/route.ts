import { readFileSync } from 'fs';
import { NextResponse } from 'next/server';
import { getAnalysisFilePath } from '@/lib/analysis/getAnalysisFilePath';

export interface AnalysisStopMetric {
  stop_id: string;
  direction_id: string;
  time_point_order?: number;
  on_time_rate?: number | null;
  bunching_rate?: number | null;
  n_obs?: number;
}

/**
 * GET /api/analysis-metrics?routeId=28[&hour=11]
 *
 * Returns stop-level analysis metrics (on_time_rate, bunching_rate) for the given route.
 * When hour is present (0-23), returns byHour[hour]; when absent, returns overall.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const routeId = searchParams.get('routeId') ?? '';
    const hourParam = searchParams.get('hour');

    if (!routeId) {
      return NextResponse.json({ error: 'routeId required' }, { status: 400 });
    }

    const filePath = getAnalysisFilePath(routeId);
    if (!filePath) {
      return NextResponse.json([], { status: 200 });
    }

    const raw = readFileSync(filePath, 'utf-8');
    const data: { overall?: AnalysisStopMetric[]; byHour?: Record<string, AnalysisStopMetric[]> } = JSON.parse(raw);

    let list: AnalysisStopMetric[];
    if (hourParam !== null && hourParam !== undefined && hourParam !== '') {
      const hour = parseInt(hourParam, 10);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ error: 'hour must be 0-23' }, { status: 400 });
      }
      list = (data.byHour?.[String(hour)] ?? data.overall ?? []) as AnalysisStopMetric[];
    } else {
      list = (data.overall ?? []) as AnalysisStopMetric[];
    }

    return NextResponse.json(list);
  } catch (error) {
    console.error('[analysis-metrics] Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

/**
 * Single place to map timeWindow (AM|PM|AS) -> hour ranges and query params.
 * Used by ArchivedObservedProvider and scorecard assembly.
 */

import type { TimeWindowId } from '@/lib/types';
import { getSchoolById } from '@/config/schools';

export interface TimeWindowHourRange {
  startHour: number;
  endHour: number;
  startTime: string;
  endTime: string;
}

export function getTimeWindowHourRange(schoolId: string, timeWindow: TimeWindowId): TimeWindowHourRange | null {
  const school = getSchoolById(schoolId);
  const win = school?.bellWindows[timeWindow];
  if (!win) return null;
  const [startH, startM] = win.startTime.split(':').map(Number);
  const [endH, endM] = win.endTime.split(':').map(Number);
  return {
    startHour: startH + startM / 60,
    endHour: endH + endM / 60,
    startTime: win.startTime,
    endTime: win.endTime,
  };
}

import type { SchoolConfig } from '@/lib/types';
import { getSchoolById } from '@/config/schools';
/**
 * Provides school location and bell/time windows.
 * Default implementation uses config/schools.ts.
 */
export interface SchoolProvider {
  getSchool(schoolId: string): Promise<SchoolConfig | null>;
}

export async function getSchool(schoolId: string): Promise<SchoolConfig | null> {
  return getSchoolById(schoolId) ?? null;
}

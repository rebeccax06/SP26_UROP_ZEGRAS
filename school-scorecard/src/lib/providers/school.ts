import type { SchoolConfig } from '@/lib/types';

/**
 * Provides school location and bell/time windows.
 * Default implementation uses config/schools.ts.
 */
export interface SchoolProvider {
  getSchool(schoolId: string): Promise<SchoolConfig | null>;
  listSchools(): Promise<SchoolConfig[]>;
}

export { getSchoolById, getAllSchools } from '@/config/schools';
// Default implementation: use config
export async function getSchool(schoolId: string): Promise<SchoolConfig | null> {
  const { getSchoolById } = await import('@/config/schools');
  return getSchoolById(schoolId) ?? null;
}

export async function listSchools(): Promise<SchoolConfig[]> {
  const { getAllSchools } = await import('@/config/schools');
  return getAllSchools();
}

import type { SchoolConfig } from '@/lib/types';

/**
 * School configurations: id, location, default radius, bell windows.
 * Add new schools as additional entries in the array below.
 */
export const schools: SchoolConfig[] = [
  {
    id: 'madison-park',
    name: 'Madison Park High School',
    // 85 St Cypress St, Roxbury, MA 02119
    lat: 42.3226,
    lon: -71.0894,
    radiusMeters: 1200,
    bellWindows: {
      AM: { id: 'AM', label: 'Morning Arrival', startTime: '07:00', endTime: '09:00' },
      PM: { id: 'PM', label: 'Afternoon Dismissal', startTime: '14:00', endTime: '16:00' },
      AS: { id: 'AS', label: 'After School', startTime: '16:00', endTime: '18:00' },
    },
  },
];

const schoolById = new Map(schools.map((s) => [s.id, s]));

export function getSchoolById(id: string): SchoolConfig | undefined {
  return schoolById.get(id);
}

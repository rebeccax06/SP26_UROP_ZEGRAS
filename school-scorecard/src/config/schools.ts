import type { SchoolConfig, TimeWindowId } from '@/lib/types';

const defaultBellWindows: Record<TimeWindowId, { id: TimeWindowId; label: string; startTime: string; endTime: string }> = {
  AM: { id: 'AM', label: 'Morning Arrival', startTime: '07:00', endTime: '09:00' },
  PM: { id: 'PM', label: 'Afternoon Dismissal', startTime: '14:30', endTime: '16:30' },
  AS: { id: 'AS', label: 'After School', startTime: '16:00', endTime: '18:00' },
};

/**
 * School configurations: id, location, default radius, bell windows.
 * Default: "Demo School" placeholder. Add real schools here.
 */
export const schools: SchoolConfig[] = [
  {
    id: 'demo',
    name: 'Demo School',
    lat: 42.3551,
    lon: -71.0655,
    radiusMeters: 800,
    bellWindows: defaultBellWindows,
  },
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

export function getAllSchools(): SchoolConfig[] {
  return [...schools];
}

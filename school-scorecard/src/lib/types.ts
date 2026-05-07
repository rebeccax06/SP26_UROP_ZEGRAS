/**
 * Shared types for School Reliability Scorecard.
 * Strict typing; avoid `any`.
 */

// --- Time windows (configurable bell windows) ---
export type TimeWindowId = 'AM' | 'PM' | 'AS';

export interface TimeWindowRange {
  id: TimeWindowId;
  label: string;
  /** Start time as HH:MM (24h) */
  startTime: string;
  /** End time as HH:MM (24h) */
  endTime: string;
}

// --- School ---
export interface SchoolConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Default walk radius in meters (e.g. 800 ≈ 10 min) */
  radiusMeters: number;
  /** Bell/time windows for AM arrival, PM dismissal, after school */
  bellWindows: Record<TimeWindowId, TimeWindowRange>;
}

// --- Stops & routes ---
export interface Stop {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  /** Distance from school in meters */
  distanceMeters?: number;
}

export interface Route {
  routeId: string;
  routeShortName: string;
  routeLongName: string;
}

// --- Scheduled (GTFS) ---
export interface ScheduledHeadwayResult {
  routeId: string;
  stopId: string;
  scheduledMedianHeadwayMinutes: number;
  tripCount: number;
}

// --- Archived observed (MBTA last week) ---
export interface ArchivedObservedResult {
  routeId: string;
  stopId: string;
  observedMedianHeadwayMinutes: number;
  headwayP25Minutes: number;
  headwayP75Minutes: number;
  bunchingRate: number;
  /** If true, data is route-level only (stop-level not available) */
  isRouteLevel?: boolean;
  /** Median scheduled headway from MBTA CSV data (seconds→minutes), when available */
  csvScheduledHeadwayMinutes?: number;
}

// --- Scorecard row (assembled) ---
export interface ScorecardRow {
  routeId: string;
  routeName: string;
  keyStopId: string;
  keyStopName?: string;
  scheduledMedianMin: number;
  archivedMedianMin: number | null;
  archivedP25Min: number | null;
  archivedP75Min: number | null;
  archivedBunchingRate: number | null;
  /** observed/scheduled for archived */
  reliabilityRatioArchived: number | null;
  dataQualityFlags: string[];
}

// --- API request/response shapes ---
export interface ScorecardQueryParams {
  schoolId: string;
  timeWindow: TimeWindowId;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

/** Per-route headway summary at a stop (for map popups) */
export interface StopRouteHeadway {
  routeId: string;
  routeShortName: string;
  scheduledMedianMin: number;
  archivedMedianMin: number | null;
  reliabilityRatioArchived: number | null;
  /** Median scheduled headway from MBTA CSV data (minutes), shown alongside actual in popups */
  csvScheduledMedianMin?: number | null;
  /** True if this route has worse-than-scheduled headway (e.g. ratio >= 1.2) */
  hasDelay?: boolean;
  /** True if crowding has been reported at this stop×route */
  hasCrowdingReport?: boolean;
  /** True if denied boardings have been reported at this stop×route */
  hasDeniedBoardingsReport?: boolean;
}

/** Single entry in data/crowding-annotations.json */
export interface CrowdingAnnotationEntry {
  stopId: string;
  routeId: string;
  type: 'crowding' | 'denied_boardings';
  note?: string;
}

/** Key = `${stopId}:${routeId}`, value = flags for that stop×route */
export interface CrowdingAnnotationsMap {
  hasCrowding: Set<string>;
  hasDeniedBoardings: Set<string>;
}

/** Stop with headways per route (for map). routes may be empty if no data. */
export interface StopWithHeadways extends Stop {
  routes: StopRouteHeadway[];
}

/** Per-timepoint-stop headway data for route map overlay */
export interface RouteStopHeadway {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  directionId: string;
  timePointOrder: number;
  scheduledMedianMin: number;
  actualMedianMin: number;
  /** actualMedianMin / scheduledMedianMin */
  ratio: number;
  sampleCount: number;
  /** From data-analysis export; for segment coloring by on-time rate */
  onTimeRate?: number | null;
  /** From data-analysis export; for segment coloring by bunching rate */
  bunchingRate?: number | null;
  /** Mean Spring ridership CSV load at this stop×direction (weekday rows); map “Load” coloring */
  ridershipLoad?: number | null;
}

export interface ScorecardApiResponse {
  schoolId: string;
  timeWindow: TimeWindowId;
  startDate: string;
  endDate: string;
  rows: ScorecardRow[];
  stops: Stop[];
  routes: Route[];
  /** Per-stop headways by route (for map popups). Only present when scorecard has data. */
  headwaysByStop?: StopWithHeadways[];
}

/** MBTA ridership-by-trip CSV: one bucket per distinct trip in the file. */
export interface BusRidershipTripOption {
  dayTypeId: string;
  dayTypeName: string;
  directionId: string;
  tripStartTime: string;
  routeVariant: string;
}

export interface BusRidershipStopRow {
  stopSequence: number;
  stopId: string;
  stopName: string;
  boardings: number;
  alightings: number;
  load: number;
  sampleSize: number;
}

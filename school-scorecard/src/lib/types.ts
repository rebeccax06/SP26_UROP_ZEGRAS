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
}

// --- Live observed (Swiftly) ---
export interface LiveObservedResult {
  routeId: string;
  stopId: string;
  liveMedianHeadwayMinutes: number;
  liveIQRMinutes: number;
  liveBunchingRate: number;
  /** Window used in minutes */
  windowMinutes: number;
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
  liveMedianMin: number | null;
  liveIQRMin: number | null;
  liveBunchingRate: number | null;
  /** observed/scheduled for archived */
  reliabilityRatioArchived: number | null;
  /** observed/scheduled for live */
  reliabilityRatioLive: number | null;
  dataQualityFlags: string[];
}

// --- API request/response shapes ---
export interface ScorecardQueryParams {
  schoolId: string;
  timeWindow: TimeWindowId;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface ScorecardApiResponse {
  schoolId: string;
  timeWindow: TimeWindowId;
  startDate: string;
  endDate: string;
  rows: ScorecardRow[];
  stops: Stop[];
  routes: Route[];
}

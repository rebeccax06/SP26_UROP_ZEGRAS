/**
 * GTFS static data structures used for loading and querying.
 */

export interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
}

export interface GtfsRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
}

export interface GtfsTrip {
  route_id: string;
  trip_id: string;
  service_id: string;
  /** Optional; present when shapes.txt is used */
  shape_id?: string;
  /** Optional; GTFS direction_id as string ("0" or "1") */
  direction_id?: string;
}

export interface GtfsShapePoint {
  shape_id: string;
  shape_pt_lat: string;
  shape_pt_lon: string;
  shape_pt_sequence: string;
}

export interface GtfsStopTime {
  trip_id: string;
  arrival_time: string; // HH:MM:SS or H:MM:SS
  departure_time: string;
  stop_id: string;
  stop_sequence: string;
}

export interface GtfsCalendar {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  start_date: string; // YYYYMMDD
  end_date: string;
}

export interface GtfsCalendarDate {
  service_id: string;
  date: string; // YYYYMMDD
  exception_type: string; // 1=added, 2=removed
}

export interface GtfsIndex {
  stops: Map<string, GtfsStop>;
  routes: Map<string, GtfsRoute>;
  tripsByRoute: Map<string, GtfsTrip[]>;
  tripsByService: Map<string, GtfsTrip[]>;
  stopTimesByTrip: Map<string, GtfsStopTime[]>;
  calendar: Map<string, GtfsCalendar>;
  calendarDates: Map<string, GtfsCalendarDate[]>; // key: date (YYYYMMDD)
  /** shape_id -> ordered array of shape points (when shapes.txt exists) */
  shapes: Map<string, GtfsShapePoint[]>;
  /** key "routeId|directionId" (directionId GTFS "0"/"1") -> shape_id for route overlay */
  shapeIdByRouteDirection: Map<string, string>;
}

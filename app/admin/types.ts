/**
 * Shared domain types for the Admin Geodata tool.
 *
 * Imported by all admin layers: geometry utilities, data loaders,
 * sub-components, and the main AdminMap coordinator. No React or
 * Leaflet imports here — this file is safe to import anywhere.
 */

import type { LatLng } from '../../lib/geo'

// ─── OSM / Overpass ───────────────────────────────────────────────────────────

/** A single OpenStreetMap way with its node geometry. */
export interface OsmWay {
  id: number
  coords: LatLng[]
}

/** An OSM tram route relation with its member way IDs. */
export interface OsmRelation {
  id: number
  name: string   // human-readable label (e.g. "Tramway A - direction Grenoble")
  ref: string    // route ref tag (e.g. "A", "B")
  wayIds: number[]
}

/** Combined result from one Overpass fetch. */
export interface OverpassData {
  ways: OsmWay[]
  relations: OsmRelation[]
}

// ─── GTFS / Trips ─────────────────────────────────────────────────────────────

/**
 * One deduplicated trip entry per (route_id, direction_id, trip_headsign).
 * Used in the Step 1 selector to let the operator pick a direction.
 */
export interface TripEntry {
  key: string            // "routeId|directionId|headsign" — stable React key
  route_id: string
  direction_id: number
  trip_headsign: string
  trip_id: string        // a representative trip_id for stop-time lookup
  route_short_name: string
  route_color: string    // hex without leading #, e.g. "0074d9"
}

/** Simplified stop shape used throughout the admin tool. */
export interface TripStop {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
}

// ─── Segment editing ──────────────────────────────────────────────────────────

/**
 * A point snapped to the assembled polyline, associated with a GTFS stop.
 * Cut points divide the assembled polyline into stop-to-stop segments.
 */
export interface CutPoint {
  latlng: LatLng
  stopId: string
  indexOnPolyline: number  // index of the segment-start vertex nearest to this point
  tOnSegment: number       // interpolation t ∈ [0,1] within that segment
}

/**
 * A pending snap result before the operator assigns a stop ID.
 * Created on mousemove, committed to CutPoint on map click + stop confirm.
 */
export interface PendingCut {
  point: LatLng
  segIdx: number
  t: number
}

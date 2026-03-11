export interface Stop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  parent_station: string;
}

export interface Route {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_color: string;
  route_text_color: string;
}

export interface Trip {
  trip_id: string;
  route_id: string;
  shape_id: string;
  service_id: string;
  direction_id: number;
}

export interface StopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time: string;
  departure_time: string;
}

export interface ShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

async function loadJson<T>(filename: string): Promise<T> {
  if (typeof window === 'undefined') {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const content = await readFile(join(process.cwd(), 'public', 'gtfs', filename), 'utf-8');
    return JSON.parse(content);
  }
  const res = await fetch(`/gtfs/${filename}`);
  return res.json();
}

let routesCache: Route[] | null = null;
let stopsCache: Stop[] | null = null;
let tripsCache: Trip[] | null = null;
let stopTimesCache: StopTime[] | null = null;
let shapesCache: ShapePoint[] | null = null;

export async function loadRoutes(): Promise<Route[]> {
  if (routesCache) return routesCache;
  routesCache = await loadJson<Route[]>('routes.json');
  return routesCache;
}

export async function loadStops(): Promise<Stop[]> {
  if (stopsCache) return stopsCache;
  const raw = await loadJson<Record<string, string>[]>('stops.json');
  stopsCache = raw.map((s) => ({
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_lat: parseFloat(s.stop_lat),
    stop_lon: parseFloat(s.stop_lon),
    parent_station: s.parent_station ?? '',
  }));
  return stopsCache;
}

export async function loadTrips(): Promise<Trip[]> {
  if (tripsCache) return tripsCache;
  const raw = await loadJson<Record<string, string>[]>('trips.json');
  tripsCache = raw.map((t) => ({
    trip_id: t.trip_id,
    route_id: t.route_id,
    shape_id: t.shape_id,
    service_id: t.service_id,
    direction_id: parseInt(t.direction_id, 10),
  }));
  return tripsCache;
}

export async function loadStopTimes(): Promise<StopTime[]> {
  if (stopTimesCache) return stopTimesCache;
  const raw = await loadJson<Record<string, string>[]>('stop_times.json');
  stopTimesCache = raw.map((st) => ({
    trip_id: st.trip_id,
    stop_id: st.stop_id,
    stop_sequence: parseInt(st.stop_sequence, 10),
    arrival_time: st.arrival_time,
    departure_time: st.departure_time,
  }));
  return stopTimesCache;
}

export async function loadShapes(): Promise<ShapePoint[]> {
  if (shapesCache) return shapesCache;
  const raw = await loadJson<Record<string, { lat: string; lon: string; sequence: number }[]>>('shapes.json');
  shapesCache = Object.entries(raw).flatMap(([shape_id, points]) =>
    points.map((p) => ({
      shape_id,
      shape_pt_lat: parseFloat(p.lat),
      shape_pt_lon: parseFloat(p.lon),
      shape_pt_sequence: p.sequence,
    }))
  );
  return shapesCache;
}

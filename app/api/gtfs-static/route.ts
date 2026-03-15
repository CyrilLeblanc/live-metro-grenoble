import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import type { GtfsStaticBundle, Route, Stop, ShapePoint } from '../../../lib/gtfs'

async function loadJson<T>(filename: string): Promise<T> {
  const content = await readFile(join(process.cwd(), 'public', 'gtfs', filename), 'utf-8')
  return JSON.parse(content)
}

let bundleCache: GtfsStaticBundle | null = null
let bundleEtag: string | null = null

export function invalidateGtfsCache(): void {
  bundleCache = null
  bundleEtag = null
}

export async function GET(request: NextRequest) {
  if (bundleCache && bundleEtag) {
    if (request.headers.get('If-None-Match') === bundleEtag) {
      return new Response(null, {
        status: 304,
        headers: { 'Cache-Control': 'public, max-age=2592000, immutable', 'ETag': bundleEtag },
      })
    }
    return NextResponse.json(bundleCache, {
      headers: { 'Cache-Control': 'public, max-age=2592000, immutable', 'ETag': bundleEtag },
    })
  }

  const [rawRoutes, rawStops, rawTrips, rawStopTimes, rawShapes, rawSegmentPaths] = await Promise.all([
    loadJson<Route[]>('routes.json'),
    loadJson<Record<string, string>[]>('stops.json'),
    loadJson<Record<string, string>[]>('trips.json'),
    loadJson<Record<string, string>[]>('stop_times.json'),
    loadJson<Record<string, { lat: string; lon: string; sequence: number }[]>>('shapes.json'),
    loadJson<Record<string, { lat: number; lng: number }[]>>('segment-paths.json'),
  ])

  const stops: Stop[] = rawStops.map((s) => ({
    stop_id: s.stop_id,
    stop_name: s.stop_name,
    stop_lat: parseFloat(s.stop_lat),
    stop_lon: parseFloat(s.stop_lon),
    parent_station: s.parent_station ?? '',
  }))

  const trips = rawTrips.map((t) => ({
    trip_id: t.trip_id,
    route_id: t.route_id,
    shape_id: t.shape_id,
  }))

  const stopTimes = rawStopTimes.map((st) => ({
    trip_id: st.trip_id,
    stop_id: st.stop_id,
    stop_sequence: parseInt(st.stop_sequence, 10),
  }))

  const shapes: ShapePoint[] = Object.entries(rawShapes).flatMap(([shape_id, points]) =>
    points.map((p) => ({
      shape_id,
      shape_pt_lat: parseFloat(p.lat),
      shape_pt_lon: parseFloat(p.lon),
      shape_pt_sequence: p.sequence,
    }))
  )

  bundleCache = {
    routes: rawRoutes,
    stops,
    trips,
    stopTimes,
    shapes,
    segmentPaths: rawSegmentPaths,
  }

  bundleEtag = `"${createHash('sha1').update(JSON.stringify(bundleCache)).digest('hex').slice(0, 16)}"`

  return NextResponse.json(bundleCache, {
    headers: { 'Cache-Control': 'public, max-age=2592000, immutable', 'ETag': bundleEtag },
  })
}

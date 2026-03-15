import type { GtfsStaticBundle } from './gtfs'

const GTFS_CACHE = 'gtfs-static-v1'

let gtfsStaticPromise: Promise<GtfsStaticBundle> | null = null

export function fetchGtfsStatic(): Promise<GtfsStaticBundle> {
  if (!gtfsStaticPromise) {
    gtfsStaticPromise = (async () => {
      // Check Cache API for a previously stored response + ETag
      let etag: string | null = null
      let cachedData: GtfsStaticBundle | null = null
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(GTFS_CACHE)
        const cached = await cache.match('/api/gtfs-static')
        if (cached) {
          etag = cached.headers.get('ETag')
          cachedData = await cached.json()
        }
      }

      const res = await fetch('/api/gtfs-static', {
        headers: etag ? { 'If-None-Match': etag } : {},
        cache: 'no-store',
      })

      if (res.status === 304 && cachedData) return cachedData
      if (!res.ok) throw new Error(`gtfs-static fetch failed: ${res.status}`)

      if (typeof caches !== 'undefined') {
        const cache = await caches.open(GTFS_CACHE)
        await cache.put('/api/gtfs-static', res.clone())
      }

      return res.json() as Promise<GtfsStaticBundle>
    })().catch((err) => {
      gtfsStaticPromise = null
      throw err
    })
  }
  return gtfsStaticPromise
}

interface StopTimeEntry {
  stopId: string
  tripId: string
  scheduledDeparture: number  // seconds from midnight
  realtimeDeparture: number   // seconds from midnight
  serviceDay: number          // Unix seconds for midnight of service day
  realtime: boolean
}

interface PatternGroup {
  pattern: { id: string; desc: string }
  times: StopTimeEntry[]
}

export async function fetchStopTimes(stopId: string): Promise<PatternGroup[]> {
  const qualified = stopId.includes(':') ? stopId : `SEM:GEN${stopId}`
  const res = await fetch(`/api/stoptimes?stopId=${encodeURIComponent(qualified)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

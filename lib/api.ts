import type { GtfsStaticBundle } from './gtfs'

let gtfsStaticPromise: Promise<GtfsStaticBundle> | null = null

export function fetchGtfsStatic(): Promise<GtfsStaticBundle> {
  if (!gtfsStaticPromise) {
    gtfsStaticPromise = fetch('/api/gtfs-static')
      .then((res) => {
        if (!res.ok) throw new Error(`gtfs-static fetch failed: ${res.status}`)
        return res.json() as Promise<GtfsStaticBundle>
      })
      .catch((err) => {
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

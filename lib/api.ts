export interface StopTimeEntry {
  stopId: string
  tripId: string
  scheduledDeparture: number  // seconds from midnight
  realtimeDeparture: number   // seconds from midnight
  serviceDay: number          // Unix seconds for midnight of service day
  realtime: boolean
}

export interface PatternGroup {
  pattern: { id: string; desc: string }
  times: StopTimeEntry[]
}

export async function fetchStopTimes(stopId: string): Promise<PatternGroup[]> {
  const qualified = stopId.includes(':') ? stopId : `SEM:GEN${stopId}`
  const res = await fetch(`/api/stoptimes?stopId=${encodeURIComponent(qualified)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

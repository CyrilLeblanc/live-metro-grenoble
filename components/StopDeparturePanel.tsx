'use client'
import { useEffect, useState } from 'react'
import { Stop } from '../lib/gtfs'
import { fetchStopTimes, PatternGroup, StopTimeEntry } from '../lib/api'

interface Props {
  stop: Stop
  color: string
  tramRouteIds: Set<string>
  onClose: () => void
}

interface Departure {
  time: number // Unix seconds
  realtime: boolean
  headsign: string
  routeShortName: string
}

function formatHHMM(unixSecs: number): string {
  const d = new Date(unixSecs * 1000)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatRelative(unixSecs: number): string {
  const diffSecs = unixSecs - Date.now() / 1000
  if (diffSecs <= 0) return 'now'
  const mins = Math.round(diffSecs / 60)
  return mins < 1 ? '< 1 min' : `in ${mins} min`
}

function getRouteShortName(patternId: string, tramRouteIds: Set<string>): string {
  // Pattern IDs are like "SEM:GEN:A:1:..." — extract route short name from tramRouteIds match
  for (const id of tramRouteIds) {
    if (patternId.includes(id)) {
      // route_id is like "SEM:A", short name is last segment
      return id.split(':').pop() ?? id
    }
  }
  // Fallback: extract from pattern id
  const parts = patternId.split(':')
  return parts[2] ?? patternId
}

export default function StopDeparturePanel({ stop, color, tramRouteIds, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [departures, setDepartures] = useState<Departure[]>([])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const groups = await fetchStopTimes(stop.stop_id)
      let filtered = groups.filter(g =>
        [...tramRouteIds].some(id => g.pattern.id.includes(id))
      )
      if (filtered.length === 0) filtered = groups

      const all: Departure[] = []
      for (const g of filtered) {
        const routeShortName = getRouteShortName(g.pattern.id, tramRouteIds)
        for (const t of g.times) {
          const depSecs = t.realtime ? t.realtimeDeparture : t.scheduledDeparture
          all.push({
            time: t.serviceDay + depSecs,
            realtime: t.realtime,
            headsign: g.pattern.desc,
            routeShortName,
          })
        }
      }

      all.sort((a, b) => a.time - b.time)
      setDepartures(all.slice(0, 5))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load departures')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [stop.stop_id])

  const badgeColor = color && color !== 'aaaaaa' ? `#${color}` : '#7C3AED'

  return (
    <div className="
      fixed top-0 right-0 h-full w-80 z-[1100] bg-white shadow-xl flex flex-col
      max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:w-full max-sm:h-auto max-sm:max-h-64 max-sm:rounded-t-xl
    ">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <div className="font-semibold text-gray-900">{stop.stop_name}</div>
          <div className="text-xs text-gray-500">{stop.stop_id}</div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-24 text-gray-500 text-sm">
            Loading…
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-sm">
            <span className="text-red-500">{error}</span>
            <button
              onClick={load}
              className="text-blue-600 hover:underline"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && departures.length === 0 && (
          <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
            No upcoming departures
          </div>
        )}
        {!loading && !error && departures.map((dep, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
            <span
              className="shrink-0 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[2rem] text-center"
              style={{ backgroundColor: badgeColor }}
            >
              {dep.routeShortName}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-800 truncate">{dep.headsign}</div>
              <div className="text-xs text-gray-500">{formatRelative(dep.time)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium text-gray-900">{formatHHMM(dep.time)}</div>
              <div className={`text-xs ${dep.realtime ? 'text-green-600' : 'text-gray-400'}`}>
                {dep.realtime ? 'live' : 'scheduled'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

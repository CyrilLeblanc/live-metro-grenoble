'use client'
import { useEffect, useState } from 'react'
import { Stop } from '../lib/gtfs'
import { fetchStopTimes } from '../lib/api'
import { PANEL_BG, PANEL_BORDER, ACCENT_BLUE } from '../lib/config'

interface Props {
  stop: Stop
  color: string
  tramRouteIds: Set<string>
  routeColorMap: Map<string, string>
  onClose: () => void
  onHover: (tripId: string | null) => void
  onClick: (tripId: string) => void
}

interface Departure {
  time: number // Unix seconds
  realtime: boolean
  headsign: string
  routeShortName: string
  color: string
  tripId: string
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

export default function StopDeparturePanel({ stop, color, tramRouteIds, routeColorMap, onClose, onHover, onClick }: Props) {
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
        let depColor = '#b49bda'
        for (const [routeId, c] of routeColorMap) {
          if (g.pattern.id.includes(routeId)) { depColor = `#${c}`; break }
        }
        for (const t of g.times) {
          const depSecs = t.realtime ? t.realtimeDeparture : t.scheduledDeparture
          const tripId = t.tripId.includes(':') ? t.tripId.split(':').slice(1).join(':') : t.tripId
          all.push({
            time: t.serviceDay + depSecs,
            realtime: t.realtime,
            headsign: g.pattern.desc,
            routeShortName,
            color: depColor,
            tripId,
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

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-[1100] shadow-xl flex flex-col max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:w-full max-sm:h-auto max-sm:max-h-64 max-sm:rounded-t-xl"
      style={{ background: PANEL_BG, color: '#ffffff', borderLeft: `1px solid ${PANEL_BORDER}` }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}>
        <div>
          <div className="font-semibold">{stop.stop_name}</div>
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{stop.stop_id}</div>
        </div>
        <button
          onClick={onClose}
          className="text-xl leading-none px-1"
          style={{ color: 'rgba(255,255,255,0.5)' }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-24 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Loading…
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-sm">
            <span style={{ color: '#f87171' }}>{error}</span>
            <button
              onClick={load}
              className="hover:underline"
              style={{ color: ACCENT_BLUE }}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && departures.length === 0 && (
          <div className="flex items-center justify-center h-24 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            No upcoming departures
          </div>
        )}
        {!loading && !error && departures.map((dep, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 cursor-pointer"
            style={{ borderBottom: `1px solid ${PANEL_BORDER}` }}
            onMouseEnter={() => onHover(dep.tripId)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onClick(dep.tripId)}
          >
            <span
              className="shrink-0 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[2rem] text-center"
              style={{ backgroundColor: dep.color }}
            >
              {dep.routeShortName}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{dep.headsign}</div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{formatRelative(dep.time)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium" style={{ color: ACCENT_BLUE }}>{formatHHMM(dep.time)}</div>
              <div className="text-xs" style={{ color: dep.realtime ? '#4ade80' : 'rgba(255,255,255,0.4)' }}>
                {dep.realtime ? 'live' : 'scheduled'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

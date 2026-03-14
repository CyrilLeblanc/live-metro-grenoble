/**
 * usePolling — manages the 10-second real-time tram position polling cycle.
 *
 * - Fires an immediate fetch on mount, then repeats every POLLING_INTERVAL_MS.
 * - A countdown timer (COUNTDOWN_START_S → 0) drives the UI refresh indicator.
 * - An in-flight guard prevents overlapping requests if a fetch takes > 10 seconds.
 * - `refresh` lets the user trigger an immediate re-fetch from the UI.
 *
 * Only starts polling once `dataLoaded` is true (GTFS data must be ready first).
 */

import { useEffect, useRef, useState } from 'react'
import { POLLING_INTERVAL_MS, COUNTDOWN_START_S } from '../lib/config'
import { TramApiItem } from './useAnimatedTrams'
import { TramMarkerData } from '../components/CanvasTramLayer'

/** Formats an ETA in seconds into a human-readable string. */
function formatEta(secs: number): string {
  if (secs <= 0) return 'arriving'
  const mins = Math.round(secs / 60)
  return mins < 1 ? '< 1 min' : `in ${mins} min`
}

export interface PollingData {
  apiTrams: TramApiItem[]
  tramMarkers: TramMarkerData[]
  secondsLeft: number
  /** Call to immediately trigger a re-fetch and reset the countdown. */
  refresh: () => void
}

export function usePolling(dataLoaded: boolean, paused = false): PollingData {
  const [apiTrams, setApiTrams] = useState<TramApiItem[]>([])
  const [tramMarkers, setTramMarkers] = useState<TramMarkerData[]>([])
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_START_S)

  const pollingInFlightRef = useRef(false)
  const tickRef = useRef<(() => Promise<void>) | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pausedRef = useRef(paused)

  useEffect(() => { pausedRef.current = paused }, [paused])

  function clearTimers() {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    pollIntervalRef.current = null
    countdownIntervalRef.current = null
  }

  function resetTimers() {
    clearTimers()
    setSecondsLeft(COUNTDOWN_START_S)
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft(s => Math.max(0, s - 1))
    }, 1_000)
    pollIntervalRef.current = setInterval(() => {
      tickRef.current?.()
    }, POLLING_INTERVAL_MS)
  }

  useEffect(() => {
    if (!dataLoaded) return

    async function tick() {
      if (pausedRef.current) return
      // Guard against overlapping in-flight requests
      if (pollingInFlightRef.current) return
      pollingInFlightRef.current = true
      try {
        const res = await fetch('/api/trams')
        if (!res.ok) return
        const data: TramApiItem[] = await res.json()
        setApiTrams(data)
        setTramMarkers(data.map(item => ({
          id: item.id,
          position: [item.lat, item.lng] as [number, number],
          line: item.line,
          direction: item.direction,
          nextStop: item.nextStop,
          eta: formatEta(item.eta),
          isRealtime: item.isRealtime,
          color: item.lineColor.replace('#', ''),
        })))
      } finally {
        pollingInFlightRef.current = false
      }
      resetTimers()
    }

    tickRef.current = tick
    tick()

    return () => {
      clearTimers()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded])

  // Pause/resume effect: clear timers when paused, restart + immediate fetch when unpaused
  useEffect(() => {
    if (!dataLoaded) return
    if (paused) {
      clearTimers()
    } else {
      tickRef.current?.()
    }
  }, [paused, dataLoaded])

  function refresh() {
    tickRef.current?.()
  }

  return { apiTrams, tramMarkers, secondsLeft, refresh }
}

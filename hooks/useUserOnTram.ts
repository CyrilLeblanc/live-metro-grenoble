'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import React from 'react'
import { haversineDistance, makeSegmentKey } from '../lib/geo'
import { TramApiItem, TramPosition } from './useAnimatedTrams'
import {
  NEARBY_THRESHOLD_M,
  AUTODECONFIRM_THRESHOLD_M,
  AUTODECONFIRM_FIXES,
  MAX_ACCURACY_M,
  MAX_SPEED_MS,
  GPS_HISTORY,
  SPEED_WINDOW_SEC,
} from '../lib/config'

interface GpsPoint {
  lat: number
  lng: number
  timestamp: number
}

interface SegmentBuffer {
  stopAId: string
  stopBId: string
  startTime: number
  points: Array<{ tSec: number; speedMs: number }>
}

export interface NearbyTram {
  tramId: string
  line: string
  lineColor: string
  direction: string
  distanceMeters: number
}

export function useUserOnTram(
  apiTrams: TramApiItem[],
  positionsRef: React.RefObject<Map<string, TramPosition>>,
) {
  const [isTracking, setIsTracking] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [userTramId, setUserTramId] = useState<string | null>(null)
  const [nearbyTrams, setNearbyTrams] = useState<NearbyTram[]>([])
  const [currentSpeedMs, setCurrentSpeedMs] = useState<number | null>(null)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)

  const watchIdRef = useRef<number | null>(null)
  const gpsHistoryRef = useRef<GpsPoint[]>([])
  const ewmaSpeedRef = useRef<number | null>(null)
  const segmentBufferRef = useRef<SegmentBuffer | null>(null)
  const userTramIdRef = useRef<string | null>(null)
  const isConfirmedRef = useRef(false)
  const consecutiveFarFixesRef = useRef(0)
  const apiTramsRef = useRef<TramApiItem[]>(apiTrams)

  useEffect(() => {
    userTramIdRef.current = userTramId
  }, [userTramId])

  useEffect(() => {
    isConfirmedRef.current = isConfirmed
  }, [isConfirmed])

  useEffect(() => {
    apiTramsRef.current = apiTrams
  }, [apiTrams])

  // Handle API trams update: detect segment crossing (tram ID change)
  useEffect(() => {
    if (!isConfirmedRef.current || !userTramIdRef.current) return
    const tramStillExists = apiTrams.some(t => t.id === userTramIdRef.current)
    if (tramStillExists) return

    // Tram ID changed → finalize current buffer and re-match
    finalizeBuffer()

    // Re-match by proximity to find the new tram ID
    const userLat = gpsHistoryRef.current[gpsHistoryRef.current.length - 1]?.lat
    const userLng = gpsHistoryRef.current[gpsHistoryRef.current.length - 1]?.lng
    if (userLat == null) return

    const candidates = findNearbyTrams(userLat, userLng, apiTrams, positionsRef)
    if (candidates.length > 0) {
      const best = candidates[0]
      setUserTramId(best.tramId)
      userTramIdRef.current = best.tramId
      const tram = apiTrams.find(t => t.id === best.tramId)
      if (tram) {
        segmentBufferRef.current = {
          stopAId: tram.stopAId,
          stopBId: tram.stopBId,
          startTime: Date.now(),
          points: [],
        }
      }
    } else {
      // No nearby tram found — deconfirm
      setIsConfirmed(false)
      isConfirmedRef.current = false
      setUserTramId(null)
      userTramIdRef.current = null
      segmentBufferRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiTrams])

  function findNearbyTrams(
    userLat: number,
    userLng: number,
    trams: TramApiItem[],
    pRef: React.RefObject<Map<string, TramPosition>>,
  ): NearbyTram[] {
    const results: NearbyTram[] = []
    for (const tram of trams) {
      const pos = pRef.current?.get(tram.id)
      const tLat = pos?.lat ?? tram.lat
      const tLng = pos?.lng ?? tram.lng
      const dist = haversineDistance(userLat, userLng, tLat, tLng)
      if (dist <= NEARBY_THRESHOLD_M) {
        results.push({ tramId: tram.id, line: tram.line, lineColor: tram.lineColor, direction: tram.direction, distanceMeters: dist })
      }
    }
    return results.sort((a, b) => a.distanceMeters - b.distanceMeters)
  }

  function finalizeBuffer() {
    const buf = segmentBufferRef.current
    if (!buf || buf.points.length < 3) {
      segmentBufferRef.current = null
      return
    }
    const payload = {
      stopAId: buf.stopAId,
      stopBId: buf.stopBId,
      totalDurationSec: buf.points[buf.points.length - 1].tSec,
      points: buf.points,
    }
    segmentBufferRef.current = null
    fetch('/api/segment-speeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* fire-and-forget */ })
  }

  function onGpsPosition(pos: GeolocationPosition) {
    const { latitude, longitude, accuracy } = pos.coords
    setGpsAccuracy(accuracy)

    if (accuracy > MAX_ACCURACY_M) return

    const now = pos.timestamp
    const history = gpsHistoryRef.current
    history.push({ lat: latitude, lng: longitude, timestamp: now })
    if (history.length > GPS_HISTORY) history.splice(0, history.length - GPS_HISTORY)

    // Compute speed over 10s window
    const windowStart = now - SPEED_WINDOW_SEC * 1000
    const windowPts = history.filter(p => p.timestamp >= windowStart)
    let rawSpeed: number | null = null
    if (windowPts.length >= 2) {
      let totalDist = 0
      for (let i = 1; i < windowPts.length; i++) {
        totalDist += haversineDistance(windowPts[i - 1].lat, windowPts[i - 1].lng, windowPts[i].lat, windowPts[i].lng)
      }
      const elapsed = (windowPts[windowPts.length - 1].timestamp - windowPts[0].timestamp) / 1000
      if (elapsed > 0) rawSpeed = totalDist / elapsed
    }

    if (rawSpeed !== null && rawSpeed <= MAX_SPEED_MS) {
      // Exponentially-weighted moving average: 40% new reading, 60% history.
      // Smooths out GPS jitter while still responding to genuine speed changes.
      const prev = ewmaSpeedRef.current ?? rawSpeed
      const smoothed = 0.4 * rawSpeed + 0.6 * prev
      ewmaSpeedRef.current = smoothed
      setCurrentSpeedMs(smoothed)
    }

    // Update nearby trams for searching state
    if (!isConfirmedRef.current) {
      const nearby = findNearbyTrams(latitude, longitude, apiTramsRef.current, positionsRef)
      setNearbyTrams(nearby)
    }

    // Auto-deconfirm: if the user is consistently far from their tram for
    // AUTODECONFIRM_FIXES consecutive fixes, they've likely left the tram.
    if (isConfirmedRef.current && userTramIdRef.current) {
      const tram = apiTramsRef.current.find(t => t.id === userTramIdRef.current)
      if (tram) {
        const pos2 = positionsRef.current?.get(tram.id)
        const tLat = pos2?.lat ?? tram.lat
        const tLng = pos2?.lng ?? tram.lng
        const dist = haversineDistance(latitude, longitude, tLat, tLng)
        if (dist > AUTODECONFIRM_THRESHOLD_M) {
          consecutiveFarFixesRef.current++
          if (consecutiveFarFixesRef.current >= AUTODECONFIRM_FIXES) {
            finalizeBuffer()
            setIsConfirmed(false)
            isConfirmedRef.current = false
            setUserTramId(null)
            userTramIdRef.current = null
            consecutiveFarFixesRef.current = 0
          }
        } else {
          consecutiveFarFixesRef.current = 0
        }
      }
    }

    // Append to segment buffer
    if (isConfirmedRef.current && segmentBufferRef.current && ewmaSpeedRef.current !== null) {
      const tSec = (Date.now() - segmentBufferRef.current.startTime) / 1000
      segmentBufferRef.current.points.push({ tSec, speedMs: ewmaSpeedRef.current })
    }
  }

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) return
    setIsTracking(true)
    ewmaSpeedRef.current = null
    gpsHistoryRef.current = []
    watchIdRef.current = navigator.geolocation.watchPosition(
      onGpsPosition,
      () => { /* ignore errors silently */ },
      { enableHighAccuracy: true, maximumAge: 1000 },
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    finalizeBuffer()
    setIsTracking(false)
    setIsConfirmed(false)
    isConfirmedRef.current = false
    setUserTramId(null)
    userTramIdRef.current = null
    setCurrentSpeedMs(null)
    setGpsAccuracy(null)
    setNearbyTrams([])
    ewmaSpeedRef.current = null
    consecutiveFarFixesRef.current = 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmTram = useCallback((tramId: string) => {
    const tram = apiTramsRef.current.find(t => t.id === tramId)
    if (!tram) return
    setUserTramId(tramId)
    userTramIdRef.current = tramId
    setIsConfirmed(true)
    isConfirmedRef.current = true
    consecutiveFarFixesRef.current = 0
    segmentBufferRef.current = {
      stopAId: tram.stopAId,
      stopBId: tram.stopBId,
      startTime: Date.now(),
      points: [],
    }
  }, [])

  const cancelConfirmation = useCallback(() => {
    finalizeBuffer()
    setIsConfirmed(false)
    isConfirmedRef.current = false
    setUserTramId(null)
    userTramIdRef.current = null
    consecutiveFarFixesRef.current = 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    isTracking,
    isConfirmed,
    userTramId,
    nearbyTrams,
    currentSpeedMs,
    gpsAccuracy,
    startTracking,
    stopTracking,
    confirmTram,
    cancelConfirmation,
  }
}

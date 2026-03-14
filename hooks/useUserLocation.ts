'use client'

import { useEffect, useRef, useState } from 'react'

const PENDING_ACCURACY_THRESHOLD_M = 100

export interface UserLocationPosition {
  lat: number
  lng: number
  accuracy: number
}

export function useUserLocation(): {
  position: UserLocationPosition | null
  isPending: boolean
} {
  const [position, setPosition] = useState<UserLocationPosition | null>(null)
  const watchIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      () => { /* permission denied or unavailable — stay silent */ },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  const isPending = position === null || position.accuracy > PENDING_ACCURACY_THRESHOLD_M

  return { position, isPending }
}

'use client'

import { Circle, CircleMarker } from 'react-leaflet'
import { UserLocationPosition } from '../hooks/useUserLocation'

interface UserLocationMarkerProps {
  position: UserLocationPosition
  isPending: boolean
}

export default function UserLocationMarker({ position, isPending }: UserLocationMarkerProps) {
  const center: [number, number] = [position.lat, position.lng]

  return (
    <>
      <Circle
        center={center}
        radius={position.accuracy}
        pathOptions={{
          fillColor: '#4a90e2',
          fillOpacity: isPending ? 0.06 : 0.12,
          color: '#4a90e2',
          opacity: isPending ? 0.2 : 0.35,
          weight: 1,
        }}
      />
      <CircleMarker
        center={center}
        radius={7}
        pathOptions={{
          fillColor: '#4a90e2',
          fillOpacity: isPending ? 0.35 : 1,
          color: '#ffffff',
          opacity: isPending ? 0.35 : 1,
          weight: 2,
        }}
      />
    </>
  )
}

'use client'
import L from 'leaflet'
import { Marker } from 'react-leaflet'

interface Props {
  position: [number, number] | null
  line: string
  direction: string
  isRealtime: boolean
  color: string
}

export default function TramMarker({ position, line, isRealtime, color }: Props) {
  if (!position) return null

  const icon = L.divIcon({
    html: `<div class="tram-marker ${isRealtime ? '' : 'theoretical'}" style="background:#${color}">${line}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })

  return <Marker position={position} icon={icon} />
}

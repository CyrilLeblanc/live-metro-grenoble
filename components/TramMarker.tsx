'use client'
import L from 'leaflet'
import { Marker, Popup } from 'react-leaflet'

interface Props {
  position: [number, number] | null
  line: string
  direction: string
  nextStop: string
  eta: string
  isRealtime: boolean
  color: string
}

export default function TramMarker({ position, line, direction, nextStop, eta, isRealtime, color }: Props) {
  if (!position) return null

  const icon = L.divIcon({
    html: `<div class="tram-marker ${isRealtime ? '' : 'theoretical'}" style="background:#${color}">${line}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })

  return (
    <Marker position={position} icon={icon}>
      <Popup>
        <strong>Line {line}</strong><br />
        Direction: {direction}<br />
        Next stop: {nextStop}<br />
        ETA: {eta}<br />
        <span style={{ color: isRealtime ? 'green' : 'grey' }}>
          {isRealtime ? 'Live' : 'Theoretical'}
        </span>
      </Popup>
    </Marker>
  )
}

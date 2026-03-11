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
  bearing: number
}

export default function TramMarker({ position, line, direction, nextStop, eta, isRealtime, color, bearing }: Props) {
  if (!position) return null

  const fill = `#${color || '888888'}`
  const opacity = isRealtime ? 1 : 0.5
  const icon = L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
      style="transform:rotate(${bearing}deg);display:block;opacity:${opacity}">
      <polygon points="12,2 22,22 12,17 2,22" fill="${fill}" stroke="white" stroke-width="1.5"/>
    </svg>`,
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

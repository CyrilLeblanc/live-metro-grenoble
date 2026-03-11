'use client'
import { CircleMarker } from 'react-leaflet'
import { Stop } from '../lib/gtfs'

interface Props {
  stop: Stop
  color: string
  onClick: () => void
}

export default function StopMarker({ stop, color, onClick }: Props) {
  const fillColor = color === 'aaaaaa' ? '#7C3AED' : `#${color}`
  return (
    <CircleMarker
      center={[stop.stop_lat, stop.stop_lon]}
      radius={5}
      pathOptions={{ color: '#333', fillColor, fillOpacity: 1, weight: 1 }}
      eventHandlers={{ click: onClick }}
    />
  )
}

'use client'
import { CircleMarker, Popup } from 'react-leaflet'
import { Stop } from '../lib/gtfs'

interface Props {
  stop: Stop
  color: string
}

export default function StopMarker({ stop, color }: Props) {
  return (
    <CircleMarker
      center={[stop.stop_lat, stop.stop_lon]}
      radius={5}
      pathOptions={{ color: '#333', fillColor: `#${color}`, fillOpacity: 1, weight: 1 }}
    >
      <Popup>{stop.stop_name}</Popup>
    </CircleMarker>
  )
}

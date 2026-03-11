'use client'
import { CircleMarker, Popup } from 'react-leaflet'
import { Stop } from '../lib/gtfs'

const STOP_COLOR = '#7C3AED'

interface Props {
  stop: Stop
}

export default function StopMarker({ stop }: Props) {
  return (
    <CircleMarker
      center={[stop.stop_lat, stop.stop_lon]}
      radius={5}
      pathOptions={{ color: '#333', fillColor: STOP_COLOR, fillOpacity: 1, weight: 1 }}
    >
      <Popup>{stop.stop_name}</Popup>
    </CircleMarker>
  )
}

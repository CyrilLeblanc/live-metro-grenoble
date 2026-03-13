'use client'
import { CircleMarker, Marker } from 'react-leaflet'
import L from 'leaflet'
import { Stop } from '../lib/gtfs'
import { SVG_THRESHOLD } from '../lib/config'

interface Props {
  stop: Stop
  color: string
  zoom: number
  isSelected?: boolean
  onClick: () => void
}

export default function StopMarker({ stop, color, zoom, onClick, isSelected = false }: Props) {
  if (zoom < SVG_THRESHOLD) {
    const fillColor = '#b49bda'
    return (
      <CircleMarker
        center={[stop.stop_lat, stop.stop_lon]}
        radius={3}
        pathOptions={{ color: fillColor, fillColor, fillOpacity: 1, weight: 0 }}
        eventHandlers={{ click: onClick }}
      />
    )
  }

  const iconUrl = isSelected ? '/p_selected_dark.svg' : '/p_clusters_dark.svg'
  const baseSize = (zoom - SVG_THRESHOLD) * 8 + 24
  const size = isSelected ? Math.round(baseSize * 1.4) : baseSize
  const icon = L.icon({
    iconUrl,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
  return (
    <Marker
      position={[stop.stop_lat, stop.stop_lon]}
      icon={icon}
      eventHandlers={{ click: onClick }}
    />
  )
}

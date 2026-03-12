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
      <Popup className="tram-popup">
        <div style={{ padding: '10px 12px', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, background: '#343139', color: '#ffffff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              background: `#${color || '888888'}`,
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 13,
              padding: '2px 8px',
              borderRadius: 4,
              minWidth: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {line}
            </span>
            <span style={{ fontWeight: 600, color: '#ffffff', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
              {direction}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Next stop</span>
            <span style={{ fontWeight: 500, color: '#ffffff', fontSize: 12, textAlign: 'right' }}>{nextStop}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>ETA</span>
            <span style={{ fontWeight: 500, color: '#96dbeb', fontSize: 12, textAlign: 'right' }}>{eta}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: isRealtime ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.08)',
              color: isRealtime ? '#4ade80' : 'rgba(255,255,255,0.5)',
              border: `1px solid ${isRealtime ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.15)'}`,
            }}>
              {isRealtime ? 'Live' : 'Theoretical'}
            </span>
          </div>
        </div>
      </Popup>
    </Marker>
  )
}

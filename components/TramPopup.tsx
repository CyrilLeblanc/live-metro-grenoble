'use client'

import { TramMarkerData } from '../lib/geo'
import { PANEL_BG, ACCENT_BLUE } from '../lib/config'

export interface PopupTram {
  id: string
  x: number
  y: number
  data: TramMarkerData
}

interface TramPopupProps {
  popupTram: PopupTram
  onClose: () => void
}

export default function TramPopup({ popupTram, onClose }: TramPopupProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: popupTram.x + 16,
        top: popupTram.y - 16,
        zIndex: 1000,
        padding: '10px 12px',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 13,
        background: PANEL_BG,
        color: '#ffffff',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        minWidth: 180,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          background: `#${popupTram.data.color}`,
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
          {popupTram.data.line}
        </span>
        <span style={{ fontWeight: 600, color: '#ffffff', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
          {popupTram.data.direction}
        </span>
        <button
          onClick={onClose}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
          aria-label="Close"
        >×</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>Next stop</span>
        <span style={{ fontWeight: 500, color: '#ffffff', fontSize: 12, textAlign: 'right' }}>{popupTram.data.nextStop}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>ETA</span>
        <span style={{ fontWeight: 500, color: ACCENT_BLUE, fontSize: 12, textAlign: 'right' }}>{popupTram.data.eta}</span>
      </div>
      <div style={{ marginTop: 8 }}>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          background: popupTram.data.isRealtime ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.08)',
          color: popupTram.data.isRealtime ? '#4ade80' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${popupTram.data.isRealtime ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.15)'}`,
        }}>
          {popupTram.data.isRealtime ? 'Live' : 'Theoretical'}
        </span>
      </div>
    </div>
  )
}

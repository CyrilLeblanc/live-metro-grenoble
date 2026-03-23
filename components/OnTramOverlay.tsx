'use client'

import { NearbyTram } from '../hooks/useUserOnTram'
import { PANEL_BG, msToKmh } from '../lib/config'

interface OnTramOverlayProps {
  isTracking: boolean
  isConfirmed: boolean
  nearbyTrams: NearbyTram[]
  currentSpeedMs: number | null
  gpsAccuracy: number | null
  onStart(): void
  onStop(): void
  onConfirm(tramId: string): void
  onCancel(): void
}

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: 16,
  zIndex: 1000,
  background: PANEL_BG,
  color: '#ffffff',
  borderRadius: 8,
  boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
  padding: '10px 14px',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 13,
  minWidth: 180,
  maxWidth: 280,
  border: '1px solid rgba(255,255,255,0.12)',
}

function LineBadge({ line, color }: { line: string; color: string }) {
  const bg = color.startsWith('#') ? color : `#${color}`
  return (
    <span style={{
      background: bg,
      color: '#fff',
      fontWeight: 700,
      fontSize: 12,
      padding: '2px 7px',
      borderRadius: 4,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 22,
    }}>
      {line}
    </span>
  )
}

export default function OnTramOverlay({
  isTracking,
  isConfirmed,
  nearbyTrams,
  currentSpeedMs,
  gpsAccuracy,
  onStart,
  onStop,
  onConfirm,
  onCancel,
}: OnTramOverlayProps) {
  // temporary: hide the whole feature until it's more polished and we have better confidence in the underlying logic
  return <></>
  
  // if (!isTracking) {
  //   // State 1: Idle
  //   return (
  //     <div style={OVERLAY_STYLE}>
  //       <button
  //         onClick={onStart}
  //         style={{
  //           background: 'none',
  //           border: '1px solid rgba(255,255,255,0.25)',
  //           color: '#ffffff',
  //           borderRadius: 6,
  //           padding: '6px 14px',
  //           cursor: 'pointer',
  //           fontSize: 13,
  //           fontWeight: 500,
  //           width: '100%',
  //         }}
  //       >
  //         I&apos;m on a tram
  //       </button>
  //     </div>
  //   )
  // }

  // if (!isConfirmed) {
  //   const hasNearby = nearbyTrams.length > 0
  //   const weakGps = gpsAccuracy !== null && gpsAccuracy > 50

  //   // State 2: Searching OR State 3: Confirmation list
  //   return (
  //     <div style={OVERLAY_STYLE}>
  //       <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hasNearby ? 10 : 0 }}>
  //         {/* Pulsing dot */}
  //         <span style={{
  //           display: 'inline-block',
  //           width: 8,
  //           height: 8,
  //           borderRadius: '50%',
  //           background: weakGps ? '#f59e0b' : '#96dbeb',
  //           boxShadow: `0 0 0 2px ${weakGps ? 'rgba(245,158,11,0.3)' : 'rgba(150,219,235,0.3)'}`,
  //           animation: 'pulse 1.4s ease-in-out infinite',
  //         }} />
  //         <span style={{ color: 'rgba(255,255,255,0.7)', flex: 1 }}>
  //           {weakGps
  //             ? 'Weak GPS'
  //             : gpsAccuracy !== null
  //               ? `GPS ±${Math.round(gpsAccuracy)}m`
  //               : 'Searching GPS…'}
  //         </span>
  //         <button
  //           onClick={onStop}
  //           style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
  //           aria-label="Cancel"
  //         >×</button>
  //       </div>

  //       {hasNearby && (
  //         <>
  //           <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 6 }}>
  //             Select your tram:
  //           </div>
  //           {nearbyTrams.map(t => (
  //             <button
  //               key={t.tramId}
  //               onClick={() => onConfirm(t.tramId)}
  //               style={{
  //                 display: 'flex',
  //                 alignItems: 'center',
  //                 gap: 8,
  //                 width: '100%',
  //                 background: 'rgba(255,255,255,0.06)',
  //                 border: '1px solid rgba(255,255,255,0.1)',
  //                 borderRadius: 6,
  //                 color: '#fff',
  //                 padding: '6px 8px',
  //                 cursor: 'pointer',
  //                 marginBottom: 4,
  //                 textAlign: 'left',
  //               }}
  //             >
  //               <LineBadge line={t.line} color={t.lineColor} />
  //               <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
  //                 {t.direction}
  //               </span>
  //               <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, whiteSpace: 'nowrap' }}>
  //                 {Math.round(t.distanceMeters)}m
  //               </span>
  //             </button>
  //           ))}
  //         </>
  //       )}

  //       {!hasNearby && gpsAccuracy !== null && !weakGps && (
  //         <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 6 }}>
  //           No trams nearby
  //         </div>
  //       )}

  //       <style>{`
  //         @keyframes pulse {
  //           0%, 100% { opacity: 1; }
  //           50% { opacity: 0.4; }
  //         }
  //       `}</style>
  //     </div>
  //   )
  // }

  // // State 4: Active — confirmed on a tram
  // const speedKmh = currentSpeedMs !== null ? msToKmh(currentSpeedMs).toFixed(1) : null

  // return (
  //   <div style={OVERLAY_STYLE}>
  //     <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  //       <span style={{ fontWeight: 700, color: '#96dbeb', fontSize: 14, minWidth: 60 }}>
  //         {speedKmh !== null ? `${speedKmh} km/h` : '— km/h'}
  //       </span>
  //       <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
  //         {gpsAccuracy !== null ? `GPS ±${Math.round(gpsAccuracy)}m` : ''}
  //       </span>
  //       <span style={{
  //         display: 'inline-flex',
  //         alignItems: 'center',
  //         gap: 4,
  //         color: '#4ade80',
  //         fontSize: 11,
  //         marginLeft: 'auto',
  //       }}>
  //         <span style={{
  //           display: 'inline-block',
  //           width: 6,
  //           height: 6,
  //           borderRadius: '50%',
  //           background: '#4ade80',
  //           animation: 'pulse 1.4s ease-in-out infinite',
  //         }} />
  //         live
  //       </span>
  //       <button
  //         onClick={onStop}
  //         style={{
  //           background: 'rgba(255,255,255,0.08)',
  //           border: '1px solid rgba(255,255,255,0.15)',
  //           color: 'rgba(255,255,255,0.7)',
  //           borderRadius: 5,
  //           padding: '3px 8px',
  //           cursor: 'pointer',
  //           fontSize: 11,
  //           marginLeft: 4,
  //           whiteSpace: 'nowrap',
  //         }}
  //       >
  //         Exit tram
  //       </button>
  //     </div>
  //     <style>{`
  //       @keyframes pulse {
  //         0%, 100% { opacity: 1; }
  //         50% { opacity: 0.4; }
  //       }
  //     `}</style>
  //   </div>
  // )
}

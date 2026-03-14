'use client'

import { useDebugContext } from '../contexts/DebugContext'

export default function DebugBadge() {
  const { isDebug } = useDebugContext()
  if (!isDebug) return null
  return (
    <div style={{
      position: 'fixed',
      top: 12,
      left: 12,
      zIndex: 2000,
      background: '#fbbf24',
      color: '#000',
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: '0.08em',
      padding: '3px 10px',
      borderRadius: 999,
      fontFamily: 'monospace',
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      DEBUG
    </div>
  )
}

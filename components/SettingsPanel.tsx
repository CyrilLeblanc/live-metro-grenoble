'use client'

import { useEffect, useRef, useState } from 'react'
import { PANEL_BG, PANEL_BORDER, ACCENT_BLUE } from '../lib/config'

interface SettingsPanelProps {
  enabled: boolean
  setEnabled: (v: boolean) => void
  lastContributedCount: number
  clearContributedCount: () => void
}

export default function SettingsPanel({
  enabled,
  setEnabled,
  lastContributedCount,
  clearContributedCount,
}: SettingsPanelProps) {
  const [open, setOpen] = useState(false)
  const [motionWarning, setMotionWarning] = useState(false)
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Show toast when a new contribution is recorded and the app is in the foreground
  useEffect(() => {
    if (lastContributedCount === 0) return
    if (document.visibilityState !== 'visible') return
    setToastVisible(true)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false)
      clearContributedCount()
    }, 3000)
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [lastContributedCount, clearContributedCount])

  async function requestDeviceMotionPermission(): Promise<boolean> {
    // Only needed on iOS 13+
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
    ) {
      const perm = await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission()
      return perm === 'granted'
    }
    // Android / desktop: no permission required
    return true
  }

  async function handleToggle() {
    const next = !enabled
    if (next) {
      // Must request DeviceMotion permission from within a user gesture
      const granted = await requestDeviceMotionPermission()
      if (!granted) setMotionWarning(true)
    } else {
      setMotionWarning(false)
    }
    setEnabled(next)
  }

  const panelStyle: React.CSSProperties = {
    background: PANEL_BG,
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: 8,
    padding: '12px 16px',
    color: '#ffffff',
    minWidth: 260,
  }

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  }

  const toggleTrackStyle: React.CSSProperties = {
    width: 36,
    height: 20,
    borderRadius: 10,
    background: enabled ? ACCENT_BLUE : '#555',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.2s',
  }

  const toggleThumbStyle: React.CSSProperties = {
    position: 'absolute',
    top: 2,
    left: enabled ? 18 : 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'left 0.2s',
  }

  return (
    <>
      {/* Gear button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Paramètres"
        aria-label="Paramètres"
        style={{
          position: 'absolute',
          bottom: 20,
          left: 12,
          zIndex: 1000,
          background: PANEL_BG,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 8,
          width: 36,
          height: 36,
          color: '#ffffff',
          fontSize: 18,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ⚙
      </button>

      {/* Settings panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 64,
            left: 12,
            zIndex: 1000,
            ...panelStyle,
          }}
        >
          <label style={labelStyle}>
            <span>Contribuer des données de vitesse</span>
            {/* Toggle switch — click handled on the label */}
            <div
              role="switch"
              aria-checked={enabled}
              onClick={handleToggle}
              style={toggleTrackStyle}
            >
              <div style={toggleThumbStyle} />
            </div>
          </label>
          {motionWarning && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
              Précision réduite sans accéléromètre
            </p>
          )}
        </div>
      )}

      {/* Contribution toast */}
      {toastVisible && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1100,
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 8,
            padding: '8px 16px',
            color: '#ffffff',
            fontSize: 13,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          1 trajet contribué ✓
        </div>
      )}
    </>
  )
}

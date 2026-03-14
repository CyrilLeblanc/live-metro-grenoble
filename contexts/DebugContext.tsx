'use client'

import React, { createContext, useContext, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

interface LatLng { lat: number; lng: number }

export interface SegmentInfo {
  segmentKey: string
  shapePath: LatLng[]
  stopAId: string
  stopBId: string
}

interface DebugContextValue {
  isDebug: boolean
  isPanelOpen: boolean
  /** Alias for isPanelOpen — used to freeze trams while panel is open */
  frozenByPanel: boolean
  selectedSegmentKey: string | null
  selectedSegment: SegmentInfo | null
  playbackPositionRef: React.RefObject<{ lat: number; lng: number } | null>
  openPanel: (seg: SegmentInfo) => void
  closePanel: () => void
}

const DebugContext = createContext<DebugContextValue | null>(null)

export function useDebugContext(): DebugContextValue {
  const ctx = useContext(DebugContext)
  if (!ctx) throw new Error('useDebugContext must be used inside DebugProvider')
  return ctx
}

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const isDebug = searchParams.get('debug') === 'true'

  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [selectedSegment, setSelectedSegment] = useState<SegmentInfo | null>(null)
  const playbackPositionRef = useRef<{ lat: number; lng: number } | null>(null)

  const openPanel = useCallback((seg: SegmentInfo) => {
    setSelectedSegment(seg)
    setIsPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setIsPanelOpen(false)
    setSelectedSegment(null)
    playbackPositionRef.current = null
  }, [])

  return (
    <DebugContext.Provider value={{
      isDebug,
      isPanelOpen,
      frozenByPanel: isPanelOpen,
      selectedSegmentKey: selectedSegment?.segmentKey ?? null,
      selectedSegment,
      playbackPositionRef,
      openPanel,
      closePanel,
    }}>
      {children}
    </DebugContext.Provider>
  )
}

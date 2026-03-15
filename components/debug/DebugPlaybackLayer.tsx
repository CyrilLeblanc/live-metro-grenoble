'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { useDebugContext } from '../../contexts/DebugContext'
import { createMapCanvas } from '../../lib/canvasLayer'

export default function DebugPlaybackLayer() {
  const map = useMap()
  const { playbackPositionRef } = useDebugContext()

  useEffect(() => {
    const { canvas, cleanup: cleanupCanvas } = createMapCanvas(map, { zIndex: '660' })

    let rafId: number

    function draw() {
      const ctx = canvas.getContext('2d')
      if (!ctx) { rafId = requestAnimationFrame(draw); return }

      const size = map.getSize()
      ctx.clearRect(0, 0, size.x, size.y)

      const pos = playbackPositionRef.current
      if (pos) {
        const pt = map.latLngToContainerPoint([pos.lat, pos.lng])
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2)
        ctx.fillStyle = '#fbbf24'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafId)
      cleanupCanvas()
    }
  }, [map]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

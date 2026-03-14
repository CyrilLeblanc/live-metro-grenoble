'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { useDebugContext } from '../../contexts/DebugContext'

export default function DebugPlaybackLayer() {
  const map = useMap()
  const { playbackPositionRef } = useDebugContext()

  useEffect(() => {
    const container = map.getContainer()
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '660'
    container.appendChild(canvas)

    function resize() {
      const size = map.getSize()
      canvas.width = size.x
      canvas.height = size.y
    }
    resize()
    map.on('resize', resize)
    map.on('zoomend', resize)
    map.on('moveend', resize)

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
      map.off('resize', resize)
      map.off('zoomend', resize)
      map.off('moveend', resize)
      container.removeChild(canvas)
    }
  }, [map]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

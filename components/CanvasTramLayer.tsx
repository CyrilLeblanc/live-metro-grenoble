'use client'
import React, { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type { AnimatedPosition } from '../hooks/useAnimatedTrams'
import { TramMarkerData } from '../lib/geo'
import { createMapCanvas } from '../lib/canvasLayer'

interface Props {
  tramMarkers: TramMarkerData[]
  positionsRef: React.RefObject<Map<string, AnimatedPosition>>
  highlightedTripId: string | null
  onTramClick: (id: string, x: number, y: number) => void
  onTramHover: (id: string | null) => void
  opacity?: number
}

function buildSprite(color: string, highlighted: boolean): OffscreenCanvas {
  const size = highlighted ? 32 : 24
  const oc = new OffscreenCanvas(size, size)
  const ctx = oc.getContext('2d')!
  const cx = size / 2
  const cy = size / 2
  const scale = size / 24

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  if (highlighted) {
    ctx.shadowColor = 'white'
    ctx.shadowBlur = 4
  }
  ctx.beginPath()
  ctx.moveTo(0, -10)
  ctx.lineTo(10, 10)
  ctx.lineTo(0, 5)
  ctx.lineTo(-10, 10)
  ctx.closePath()
  ctx.fillStyle = `#${color}`
  ctx.fill()
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  return oc
}

export default function CanvasTramLayer({ tramMarkers, positionsRef, highlightedTripId, onTramClick, onTramHover, opacity = 1 }: Props) {
  const map = useMap()
  const tramMarkersRef = useRef(tramMarkers)
  const highlightedRef = useRef(highlightedTripId)
  const onTramClickRef = useRef(onTramClick)
  const onTramHoverRef = useRef(onTramHover)
  const opacityRef = useRef(opacity)

  useEffect(() => { tramMarkersRef.current = tramMarkers }, [tramMarkers])
  useEffect(() => { highlightedRef.current = highlightedTripId }, [highlightedTripId])
  useEffect(() => { onTramClickRef.current = onTramClick }, [onTramClick])
  useEffect(() => { onTramHoverRef.current = onTramHover }, [onTramHover])
  useEffect(() => { opacityRef.current = opacity }, [opacity])

  useEffect(() => {
    const { canvas, cleanup: cleanupCanvas } = createMapCanvas(map, { zIndex: '650', pointerEvents: true })

    const spriteCache = new Map<string, OffscreenCanvas>()

    function getSprite(color: string, highlighted: boolean): OffscreenCanvas {
      const key = `${color}:${highlighted ? 'h' : 'n'}`
      if (!spriteCache.has(key)) spriteCache.set(key, buildSprite(color, highlighted))
      return spriteCache.get(key)!
    }

    let rafId: number

    function draw() {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const size = map.getSize()
      ctx.clearRect(0, 0, size.x, size.y)

      const positions = positionsRef.current
      if (!positions) return

      const highlighted = highlightedRef.current
      const markers = tramMarkersRef.current

      for (const marker of markers) {
        const pos = positions.get(marker.id)
        if (!pos) continue
        const pt = map.latLngToContainerPoint([pos.lat, pos.lng])
        const isHighlighted = highlighted !== null && marker.id.startsWith(highlighted + '-')
        const sprite = getSprite(marker.color, isHighlighted)

        ctx.save()
        ctx.globalAlpha = (marker.isRealtime ? 1 : 0.5) * opacityRef.current
        ctx.translate(pt.x, pt.y)
        ctx.rotate((pos.bearing * Math.PI) / 180)
        ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2)
        ctx.restore()
      }

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)

    function hitTest(x: number, y: number): string | null {
      const positions = positionsRef.current
      if (!positions) return null
      let bestId: string | null = null
      let bestDist = 16 * 16
      for (const [id, pos] of positions) {
        const pt = map.latLngToContainerPoint([pos.lat, pos.lng])
        const dx = pt.x - x
        const dy = pt.y - y
        const dist2 = dx * dx + dy * dy
        if (dist2 < bestDist) {
          bestDist = dist2
          bestId = id
        }
      }
      return bestId
    }

    function passThrough(e: MouseEvent) {
      canvas.style.pointerEvents = 'none'
      const el = document.elementFromPoint(e.clientX, e.clientY)
      canvas.style.pointerEvents = 'auto'
      if (el) {
        el.dispatchEvent(new MouseEvent(e.type, { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }))
      }
    }

    function onClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const id = hitTest(x, y)
      if (id) {
        e.stopPropagation()
        onTramClickRef.current(id, x, y)
      } else {
        passThrough(e)
      }
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const id = hitTest(x, y)
      canvas.style.cursor = id ? 'pointer' : ''
      onTramHoverRef.current(id)
      if (!id) passThrough(e)
    }

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mousemove', onMouseMove)

    return () => {
      cancelAnimationFrame(rafId)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mousemove', onMouseMove)
      cleanupCanvas()
    }
  }, [map]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

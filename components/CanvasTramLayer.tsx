'use client'
import React, { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import type { AnimatedPosition } from '../hooks/useAnimatedTrams'
import { TramMarkerData } from '../lib/geo'
import { createMapCanvas } from '../lib/canvasLayer'
import { TRAM_SPRITE_SIZE, TRAM_SPRITE_SIZE_HIGHLIGHTED, TRAM_HIT_TEST_RADIUS_SQ } from '../lib/config'

interface Props {
  tramMarkers: TramMarkerData[]
  positionsRef: React.RefObject<Map<string, AnimatedPosition>>
  highlightedTripId: string | null
  onTramClick: (id: string, x: number, y: number) => void
  onTramHover: (id: string | null) => void
  opacity?: number
}

/**
 * Lighten a 6-char hex color (without '#') by blending it toward white.
 * `amount` is in [0, 1]: 0 = unchanged, 1 = pure white.
 */
function lightenHex(hex: string, amount: number): string {
  const num = parseInt(hex, 16)
  const r = Math.min(255, (num >> 16) + Math.round(255 * amount))
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount))
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amount))
  return `rgb(${r},${g},${b})`
}

/**
 * Build a tram-wagon sprite on an OffscreenCanvas at physical resolution.
 *
 * The canvas is allocated at `logicalSize × dpr` so that drawing is crisp on
 * high-DPI displays. All draw calls use logical coordinates after ctx.scale(dpr, dpr).
 *
 * @param color      6-char hex line color (no '#')
 * @param wagonIndex 0 = head wagon, 1/2 = body wagons
 * @param highlighted Whether the tram is hovered/selected
 * @param dpr        window.devicePixelRatio (included in cache key)
 * @param line       Route short name shown on head wagon (e.g. "A", "B")
 */
function buildSprite(
  color: string,
  wagonIndex: number,
  highlighted: boolean,
  dpr: number,
  line: string,
): OffscreenCanvas {
  const logicalSize = highlighted ? TRAM_SPRITE_SIZE_HIGHLIGHTED : TRAM_SPRITE_SIZE
  const physicalSize = Math.round(logicalSize * dpr)
  const oc = new OffscreenCanvas(physicalSize, physicalSize)
  const ctx = oc.getContext('2d')!

  // Scale once so all coordinates below are in logical pixels
  ctx.scale(dpr, dpr)

  const cx = logicalSize / 2
  const cy = logicalSize / 2
  const w = logicalSize * 0.50   // wagon width
  const h = logicalSize * 0.74   // wagon height (taller than wide — points in travel direction)
  const r = Math.max(2, logicalSize * 0.12) // corner radius

  // --- Drop shadow ---
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 1.5

  // --- Wagon body ---
  const fillColor = wagonIndex === 0 ? lightenHex(color, 0.22) : `#${color}`
  ctx.beginPath()
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r)
  ctx.fillStyle = fillColor
  ctx.fill()

  // Clear shadow before stroke so it doesn't affect the outline
  ctx.shadowColor = 'transparent'
  ctx.strokeStyle = 'rgba(255,255,255,0.88)'
  ctx.lineWidth = highlighted ? 1.5 : 1
  ctx.stroke()

  if (wagonIndex === 0) {
    // --- Front band: semi-transparent white strip at the top (direction of travel) ---
    const bandH = Math.max(3, Math.round(h * 0.18))
    ctx.beginPath()
    ctx.roundRect(cx - w / 2, cy - h / 2, w, bandH, [r, r, 0, 0])
    ctx.fillStyle = 'rgba(255,255,255,0.42)'
    ctx.fill()

    // --- Highlighted glow ---
    if (highlighted) {
      ctx.shadowColor = 'white'
      ctx.shadowBlur = 5
      ctx.beginPath()
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r)
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.shadowColor = 'transparent'
    }

    // --- Route label (e.g. "A", "B", "C") ---
    const fontSize = Math.max(8, Math.round(logicalSize * 0.38))
    ctx.fillStyle = 'white'
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Shift text slightly below center to clear the front band
    ctx.fillText(line, cx, cy + h * 0.08)
  }

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

    function getSprite(color: string, line: string, wagonIndex: number, highlighted: boolean): OffscreenCanvas {
      const dpr = window.devicePixelRatio || 1
      const key = `${color}:${wagonIndex}:${highlighted ? 'h' : 'n'}:${dpr}:${line}`
      if (!spriteCache.has(key)) {
        spriteCache.set(key, buildSprite(color, wagonIndex, highlighted, dpr, line))
      }
      return spriteCache.get(key)!
    }

    let rafId: number
    let lastFrame = 0

    function draw(timestamp: number) {
      // Throttle draw calls to ~10 fps — tram positions update every ~10 s and
      // interpolation changes are subtle; 60 fps brings no visible benefit here.
      if (timestamp - lastFrame < 100) {
        rafId = requestAnimationFrame(draw)
        return
      }
      lastFrame = timestamp

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const size = map.getSize()
      // clearRect operates in logical space (ctx.scale(dpr,dpr) applied by canvasLayer)
      ctx.clearRect(0, 0, size.x, size.y)

      const positions = positionsRef.current
      if (!positions) return

      const highlighted = highlightedRef.current
      const markers = tramMarkersRef.current

      for (const marker of markers) {
        const pos = positions.get(marker.id)
        if (!pos) continue

        const isHighlighted = highlighted !== null && marker.id.startsWith(highlighted + '-')
        const logicalSize = isHighlighted ? TRAM_SPRITE_SIZE_HIGHLIGHTED : TRAM_SPRITE_SIZE
        const alpha = (marker.isRealtime ? 1 : 0.5) * opacityRef.current

        // Draw body wagons first (behind the head) — furthest first so head is on top
        if (pos.wagons) {
          for (let wi = pos.wagons.length - 1; wi >= 0; wi--) {
            const wagon = pos.wagons[wi]
            const wagonPt = map.latLngToContainerPoint([wagon.lat, wagon.lng])
            const sprite = getSprite(marker.color, marker.line, wi + 1, isHighlighted)
            ctx.save()
            ctx.globalAlpha = alpha
            ctx.translate(wagonPt.x, wagonPt.y)
            ctx.rotate((wagon.bearing * Math.PI) / 180)
            // Always pass logical size as destination dimensions, never the physical sprite size
            ctx.drawImage(sprite, -logicalSize / 2, -logicalSize / 2, logicalSize, logicalSize)
            ctx.restore()
          }
        }

        // Draw head wagon last so it renders on top of the body wagons
        const pt = map.latLngToContainerPoint([pos.lat, pos.lng])
        const headSprite = getSprite(marker.color, marker.line, 0, isHighlighted)
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(pt.x, pt.y)
        ctx.rotate((pos.bearing * Math.PI) / 180)
        ctx.drawImage(headSprite, -logicalSize / 2, -logicalSize / 2, logicalSize, logicalSize)
        ctx.restore()
      }

      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)

    function hitTest(x: number, y: number): string | null {
      const positions = positionsRef.current
      if (!positions) return null
      let bestId: string | null = null
      let bestDist = TRAM_HIT_TEST_RADIUS_SQ
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

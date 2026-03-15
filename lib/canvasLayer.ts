/**
 * Shared utility for creating a canvas overlay on a Leaflet map.
 *
 * Both CanvasTramLayer and DebugPlaybackLayer need the same boilerplate:
 * create a canvas, position it over the map, resize on map events, and
 * run a requestAnimationFrame loop. This module extracts that setup.
 */
import type L from 'leaflet'

interface MapCanvasOptions {
  /** CSS z-index for the canvas (e.g. '650' for tram layer, '660' for debug). */
  zIndex: string
  /** Whether the canvas should capture pointer events (default: false). */
  pointerEvents?: boolean
}

/**
 * Creates a canvas overlay attached to a Leaflet map container.
 *
 * The canvas buffer is allocated at physical resolution (logical size × devicePixelRatio)
 * and a matching ctx.scale(dpr, dpr) transform is applied after every resize so that
 * all draw calls can use logical pixel coordinates. Resizing resets the context transform,
 * so the scale is reapplied on every resize event.
 *
 * The canvas auto-resizes on map resize/zoom/move events. Call `cleanup()`
 * on unmount to remove the canvas and all event listeners.
 *
 * @param map  The Leaflet map instance
 * @param opts Canvas positioning options
 * @returns `{ canvas, cleanup }` — the HTML canvas element and a teardown function
 */
export function createMapCanvas(
  map: L.Map,
  opts: MapCanvasOptions,
): { canvas: HTMLCanvasElement; cleanup: () => void } {
  const container = map.getContainer()
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.pointerEvents = opts.pointerEvents ? 'auto' : 'none'
  canvas.style.zIndex = opts.zIndex
  container.appendChild(canvas)

  function resize() {
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    // Allocate buffer at physical pixels so sprites aren't up-scaled by the browser
    canvas.width = Math.round(size.x * dpr)
    canvas.height = Math.round(size.y * dpr)
    // CSS size stays at logical pixels so the canvas fits the map container exactly
    canvas.style.width = size.x + 'px'
    canvas.style.height = size.y + 'px'
    // Reapply the DPR scale — resizing always resets the context transform
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)
  }
  resize()
  map.on('resize', resize)
  map.on('zoomend', resize)
  map.on('moveend', resize)

  function cleanup() {
    map.off('resize', resize)
    map.off('zoomend', resize)
    map.off('moveend', resize)
    container.removeChild(canvas)
  }

  return { canvas, cleanup }
}

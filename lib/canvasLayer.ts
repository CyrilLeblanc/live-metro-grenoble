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
    canvas.width = size.x
    canvas.height = size.y
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

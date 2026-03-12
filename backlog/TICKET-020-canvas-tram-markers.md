# TICKET-020 — Replace DivIcon tram markers with canvas-rendered layer

**Status**: Open
**Depends on**: TICKET-019 (imperative marker animation)

## Goal

Replace individual Leaflet `DivIcon` markers (one DOM node per tram) with a single `L.Canvas`-backed layer that draws all tram icons in one pass. This eliminates per-tram DOM nodes and drastically reduces layout/paint cost when many trams are on screen.

## Acceptance Criteria

- [ ] All tram positions are drawn on a single `<canvas>` element overlaid on the map
- [ ] Each tram is drawn as a directional arrow (or equivalent icon) matching the current visual design
- [ ] Canvas redraws only the dirty region (or full canvas) each animation frame — no per-tram DOM manipulation
- [ ] Tram tooltip / click interaction is preserved (hit-test canvas coordinates against tram positions)
- [ ] Highlighted tram (hovered / selected) is visually distinct on the canvas
- [ ] Performance: CPU time per frame is measurably lower than the DivIcon baseline at 20+ simultaneous trams

## Technical Notes

- Use a Leaflet custom layer (`L.Layer` subclass or `L.GridLayer`) with a `<canvas>` sized to the map pane
- On each animation frame: clear canvas, iterate tram positions, call `ctx.drawImage()` or `ctx.fill()` for each tram
- Convert geographic coordinates to pixel coordinates with `map.latLngToContainerPoint()`
- Re-project on map `move` / `zoom` events (positions in pixels shift even if lat/lng is static)
- Pre-render each line-color arrow to an `OffscreenCanvas` sprite on startup to avoid repeated path construction
- Hit-testing: on `mousemove` / `click`, find the nearest tram within a radius threshold (e.g. 16px) using Euclidean distance in pixel space
- Consider `leaflet-canvas-layer` or `L.CanvasIconLayer` as a starting point rather than building from scratch

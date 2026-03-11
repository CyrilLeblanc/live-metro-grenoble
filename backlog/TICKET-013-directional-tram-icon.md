# TICKET-013 — Directional tram icon: arrow SVG, no letter, line color

**Status**: Open
**Depends on**: TICKET-009

## Goal

Replace the lettered circle tram marker with a directional arrow/chevron SVG icon that conveys the tram's heading. The icon color matches the line color from GTFS routes data, and the rotation reflects the bearing from the current interpolated position to the next stop.

## Acceptance Criteria

- [ ] Tram marker renders as an arrow or chevron SVG (no letter/text inside)
- [ ] Icon color matches the line's `route_color` from GTFS routes.json
- [ ] Icon rotates to reflect the bearing to the next stop
- [ ] Bearing is computed from current position → next stop coordinates
- [ ] Marker still clickable and triggers popup (TICKET-011)
- [ ] No regression on tram marker visibility at all zoom levels

## Technical Notes

- Bearing computation: `Math.atan2(Δlon, Δlat)` converted to degrees, then applied as CSS `transform: rotate(Xdeg)` on the SVG or via Leaflet `DivIcon` with inline style
- Bearing can be computed in the interpolator (already has current + next stop coords) or in `TramMarker.tsx`
- Use a Leaflet `DivIcon` wrapping an inline SVG for full color + rotation control
- SVG shape suggestion: a simple upward-pointing chevron or arrowhead; keep it readable at small sizes (24×24px)
- Line color lookup: `routes[routeId].route_color` — remember to prepend `#` if not already present; fall back to `#888888` if missing

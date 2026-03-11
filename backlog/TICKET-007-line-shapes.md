# TICKET-007 — Display tram line shapes (A–E) in distinct colors on the map

**Status**: Open
**Depends on**: TICKET-004, TICKET-006

## Goal

Load GTFS shape and route data and render each tram line as a colored polyline on the Leaflet map, using the official line colors from the GTFS `route_color` field.

## Acceptance Criteria

- [ ] Each tram line (A, B, C, D, E) rendered as a polyline on the map
- [ ] Colors match GTFS `route_color` values (hex)
- [ ] Polylines follow the actual geographic path of each line (from `shapes.json`)
- [ ] Lines are visually distinct (different colors, sufficient stroke weight ~4px)
- [ ] Shapes load on map mount without blocking the UI
- [ ] No duplicate polylines if a route has multiple shape variants (use the most representative shape or deduplicate)

## Technical Notes

- Load `shapes.json` and `trips.json` via `lib/gtfs.ts` loaders
- Group shape points by `shape_id`, sort by `shape_pt_sequence`
- To map a route to its shape: `route → trips (filtered by route_id) → shape_id`
- Each route may have multiple `shape_id`s (one per direction or variant) — render all, or pick the longest
- Leaflet polyline:
  ```ts
  <Polyline
    positions={points.map(p => [p.shape_pt_lat, p.shape_pt_lon])}
    pathOptions={{ color: `#${route.route_color}`, weight: 4 }}
  />
  ```
- Line colors for TAG tram network (fallback if GTFS color is missing):
  - A: `#E2001A` (red), B: `#0070B8` (blue), C: `#008D36` (green), D: `#8B008B` (purple), E: `#F5A623` (orange)

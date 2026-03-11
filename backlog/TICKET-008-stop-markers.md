# TICKET-008 — Build `StopMarker.tsx` — small dot markers for each stop

**Status**: Open
**Depends on**: TICKET-004, TICKET-006

## Goal

Render a small circular marker for each tram stop on the map, using stop coordinates from the static GTFS data.

## Acceptance Criteria

- [ ] Component at `components/StopMarker.tsx`
- [ ] One marker rendered per stop in `stops.json`
- [ ] Markers are visually small (dot style, ~6–8px diameter)
- [ ] Marker color matches the line color of the stop's associated route (or white/grey if multi-line)
- [ ] Stops are only shown for tram lines (not other route types)
- [ ] Clicking a stop marker shows a popup with the stop name

## Technical Notes

- Use Leaflet `CircleMarker` for dot-style stops (no PNG icon needed):
  ```ts
  <CircleMarker
    center={[stop.stop_lat, stop.stop_lon]}
    radius={5}
    pathOptions={{ color: '#333', fillColor: lineColor, fillOpacity: 1, weight: 1 }}
  >
    <Popup>{stop.stop_name}</Popup>
  </CircleMarker>
  ```
- To determine which line a stop belongs to: `stop_id → stop_times → trip_id → route_id → route_color`
  - This join can be expensive for all stops; consider pre-computing a `stopId → routeColor` map at load time
- Stops on multiple lines can default to the first matching line's color, or use a neutral color
- Render all `StopMarker` components inside `TramMap.tsx` after data loads

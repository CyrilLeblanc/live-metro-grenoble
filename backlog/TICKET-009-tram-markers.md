# TICKET-009 — Build `TramMarker.tsx` — interpolated position, realtime vs theoretical style

**Status**: Open
**Depends on**: TICKET-003, TICKET-005, TICKET-006

## Goal

Create a tram marker component that displays a tram's interpolated position on the map, with a visual distinction between real-time and theoretical schedule data.

## Acceptance Criteria

- [ ] Component at `components/TramMarker.tsx`
- [ ] Accepts props: `position: [number, number]`, `line: string`, `direction: string`, `isRealtime: boolean`
- [ ] Renders a custom icon (colored circle or tram icon) at the given position
- [ ] Real-time trams: solid fill with the line color
- [ ] Theoretical trams: same icon but with reduced opacity or dashed border to indicate uncertainty
- [ ] Line letter (A/B/C/D/E) visible on or near the marker
- [ ] Component handles `null` position gracefully (renders nothing)

## Technical Notes

- Use Leaflet `DivIcon` for custom HTML/CSS markers:
  ```ts
  const icon = L.divIcon({
    html: `<div class="tram-marker ${isRealtime ? '' : 'theoretical'}" style="background:${lineColor}">${line}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
  ```
- CSS for `.tram-marker`: rounded, centered text, border
- CSS for `.theoretical`: `opacity: 0.6` or `border-style: dashed`
- The marker data structure fed into this component comes from the polling loop in TICKET-010
- The `line` prop maps to the `route_short_name` from GTFS (e.g. `"A"`, `"B"`)
- This component is rendered for each active tram detected by the interpolator

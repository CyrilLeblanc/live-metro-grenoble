# TICKET-018 — Stop click panel: next tram departures

**Status**: Open
**Depends on**: TICKET-008, TICKET-003

## Goal

Clicking a stop marker opens a side or bottom panel (not a Leaflet popup) that fetches and displays the next tram departures for that stop on demand.

## Acceptance Criteria

- [ ] Clicking a stop marker opens a panel anchored to the side (desktop) or bottom (mobile)
- [ ] Panel fetches `/api/stoptimes?stopId=<id>` when opened (not preloaded)
- [ ] Results are filtered to tram lines only (exclude bus routes if present)
- [ ] Panel displays next N departures (suggest N=5), each showing: line badge, direction/headsign, departure time, live/theoretical indicator
- [ ] Panel closes when clicking outside it or pressing a close button
- [ ] Only one panel open at a time; clicking a different stop replaces the current panel
- [ ] Loading and error states handled gracefully

## Technical Notes

- Manage panel state in a parent component (e.g. `TramMap.tsx`): `selectedStop: Stop | null`
- Stop marker `onClick` sets `selectedStop`; clicking the map background or the close button clears it
- Panel is a regular React component rendered outside the Leaflet map container (avoids z-index conflicts with Leaflet controls)
- Filtering tram lines: check `route_type === 0` (tram) in GTFS routes data, or filter by known tram route IDs
- Line badge color: look up `route_color` from GTFS routes by `route_id`
- Consider debouncing rapid stop clicks to avoid firing redundant fetches

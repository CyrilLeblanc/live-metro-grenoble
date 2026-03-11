# TICKET-011 — Click tooltip on tram: line, direction, next stop, ETA, realtime indicator

**Status**: Open
**Depends on**: TICKET-009

## Goal

Add a click-triggered popup/tooltip on each tram marker that displays key information: the line, direction, next stop, estimated arrival time, and whether the data is real-time or theoretical.

## Acceptance Criteria

- [ ] Clicking a tram marker opens a Leaflet `Popup`
- [ ] Popup displays:
  - Line identifier (e.g. "Line A")
  - Direction / headsign (e.g. "Direction: Grenoble Presqu'île")
  - Next stop name
  - Estimated time to next stop (e.g. "in 2 min" or "at 14:32")
  - Real-time indicator: "Live" (green) or "Theoretical" (grey/orange)
- [ ] Popup closes when clicking elsewhere on the map
- [ ] Popup content updates if the marker's data changes while the popup is open

## Technical Notes

- Use react-leaflet `<Popup>` as a child of `<Marker>`:
  ```tsx
  <Marker position={position} icon={icon}>
    <Popup>
      <strong>Line {line}</strong><br />
      Direction: {direction}<br />
      Next stop: {nextStop}<br />
      ETA: {eta}<br />
      <span style={{ color: isRealtime ? 'green' : 'grey' }}>
        {isRealtime ? 'Live' : 'Theoretical'}
      </span>
    </Popup>
  </Marker>
  ```
- `TramMarker.tsx` needs additional props: `nextStop: string`, `eta: string`, updated from polling state
- ETA can be computed as the difference between `stopB.time` and current time, formatted as "in X min"
- The headsign / direction string comes from the GTFS `trip_headsign` field in `trips.json` — add it to the `Trip` type in TICKET-004 if not already present

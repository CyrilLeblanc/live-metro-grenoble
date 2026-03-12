# TICKET-021 — Isolate zoom state inside StopMarker to prevent full list re-render

**Status**: Open
**Depends on**: —

## Goal

Currently, the map zoom level is held in a parent component and passed as a prop to every `StopMarker`. A zoom change re-renders the entire list of stop markers. Move zoom subscription inside `StopMarker` so each marker re-renders independently, and the parent list is unaffected by zoom events.

## Acceptance Criteria

- [ ] Changing the map zoom level does not cause the parent stop-marker list component to re-render
- [ ] Each `StopMarker` subscribes to zoom changes individually and updates its own appearance (size, visibility threshold) without involving the parent
- [ ] Zoom prop is removed from `StopMarker`'s public interface (no `zoom` prop drilled from parent)
- [ ] Stop markers still appear / disappear at the correct zoom thresholds
- [ ] Verified with React DevTools Profiler: stop list re-render on zoom is eliminated

## Technical Notes

- Inside `StopMarker`, use `useMap()` from `react-leaflet` to get the map instance, then subscribe to the `zoomend` event via `useEffect` and store zoom in local `useState`
- Alternatively, create a `useMapZoom()` custom hook that encapsulates this pattern and can be reused
- Remove the `zoom` prop from `StopMarker` and update all call sites
- Wrap the stop-marker list in `React.memo` so it only re-renders when the stops array reference changes, not on every parent render
- If the stops array is derived/filtered in the parent, memoize it with `useMemo` to keep the reference stable

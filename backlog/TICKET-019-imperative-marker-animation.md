# TICKET-019 — Bypass React state in animation loop — drive Leaflet markers imperatively

**Status**: Open
**Depends on**: TICKET-009 (tram markers), current animation work (`hooks/useAnimatedTrams.ts`)

## Goal

Remove React state from the per-frame animation loop. Instead of calling `setState` on every `requestAnimationFrame` tick (which triggers a full React reconciliation), hold marker refs and call `marker.setLatLng()` directly on the Leaflet layer objects.

## Acceptance Criteria

- [ ] Tram positions update smoothly on screen without any React re-render per frame
- [ ] `useAnimatedTrams` (or equivalent) does not call `setState` inside the `requestAnimationFrame` callback
- [ ] Marker layer refs are stored via `useRef` and mutated imperatively each tick
- [ ] React state is only updated when the set of active trams changes (add/remove), not for position updates
- [ ] Animation is visually equivalent to the current behaviour
- [ ] No memory leaks: `cancelAnimationFrame` is called on unmount / trip change

## Technical Notes

- Replace the `useState<TramPosition[]>` that drives marker rendering with a `useRef<Map<tripId, L.Marker>>` that holds live Leaflet marker instances
- The `requestAnimationFrame` callback reads the ref map and calls `marker.setLatLng([lat, lng])` and `marker.setRotationAngle(bearing)` (via `leaflet-rotatedmarker` or equivalent)
- React renders the marker once (on mount / trip list change); subsequent position updates bypass React entirely
- Icon rotation can also be applied imperatively via `marker.setIcon()` only when the bearing changes significantly (threshold ~1°) to avoid redundant DOM updates
- This ticket is a prerequisite for TICKET-020 (canvas layer) because canvas rendering also requires an imperative draw loop

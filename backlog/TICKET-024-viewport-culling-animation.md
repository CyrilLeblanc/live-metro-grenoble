# TICKET-024 — Skip animation updates for out-of-viewport trams

**Status**: Open
**Depends on**: TICKET-019 (imperative marker animation)

## Goal

In the `requestAnimationFrame` loop, skip `setLatLng` / rotation updates for trams that are outside the current map bounds. Because interpolation is time-based (not frame-accumulated), trams re-entering the viewport will snap to the correct position on the next frame with no drift.

## Acceptance Criteria

- [ ] Trams outside `map.getBounds()` are skipped in the animation loop each frame
- [ ] A tram re-entering the viewport appears at its correct interpolated position within one frame (~16 ms)
- [ ] API polling data is still processed for all trams regardless of visibility
- [ ] Markers are not removed when off-screen — only position updates are skipped
- [ ] No visible glitch or jump when panning or zooming to reveal previously off-screen trams

## Technical Notes

- In the rAF callback, call `map.getBounds().contains(latLng)` before `marker.setLatLng()` — this is O(1) and negligible cost:
  ```ts
  const bounds = map.getBounds();
  for (const [tripId, marker] of markerRefs) {
    const pos = interpolate(tripId, Date.now());
    if (!bounds.contains(pos.latLng)) continue;
    marker.setLatLng(pos.latLng);
    marker.setRotationAngle(pos.bearing);
  }
  ```
- Safe because `interpolate(tripId, t)` is a pure function of current time — skipping frames does not accumulate error
- Do NOT skip API data ingestion (`useAnimatedTrams` data processing) — all trams must stay up to date so re-entry position is correct
- Composable with TICKET-020 (canvas layer): same `bounds.contains()` guard applies before `ctx.drawImage()`; off-screen trams are simply not drawn

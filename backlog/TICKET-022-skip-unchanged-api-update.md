# TICKET-022 — Skip animation hook update when API data is unchanged

**Status**: Open
**Depends on**: current animation work (`hooks/useAnimatedTrams.ts`)

## Goal

The polling loop fetches new data every 30 seconds and unconditionally updates the animation hook, even when the API response is identical to the previous one. Add a shallow-equality check so that if the new payload matches the previous one, the hook skips the update entirely and the animation continues uninterrupted.

## Acceptance Criteria

- [ ] When the API returns data identical to the previous poll, no state update is triggered in `useAnimatedTrams`
- [ ] Tram animation continues smoothly through a "no-change" poll cycle without any visual glitch or restart
- [ ] When the API returns genuinely new data, the hook updates normally
- [ ] The equality check does not introduce noticeable latency on the hot path

## Technical Notes

- Store the previous raw API response in a `useRef` (not `useState`) to avoid triggering re-renders on comparison
- Equality check strategy: compare a lightweight fingerprint (e.g. JSON of `tripId + lastStopSequence` for each active trip) rather than deep-comparing the full payload
- If trips are identified by `tripId`, a Set comparison of active trip IDs plus a checksum of their latest `stopSequence` is sufficient for most cases
- Avoid `JSON.stringify` on the full response object as it is O(n) in payload size; prefer iterating only the fields that change when a tram moves
- Place the check at the top of the effect / callback that processes new API data, before any interpolation work begins

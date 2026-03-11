# TICKET-010 — Implement 30s polling loop: fetch stoptimes → run interpolator → update markers

**Status**: Open
**Depends on**: TICKET-009

## Goal

Wire up the real-time update cycle: every 30 seconds, fetch stop time data for all tram stops, run the interpolator, and update the tram marker positions on the map.

## Acceptance Criteria

- [ ] Polling starts automatically when `TramMap` mounts
- [ ] Polling interval is 30 seconds
- [ ] On each tick: fetches `/api/stoptimes?stopId=...` for all relevant stops
- [ ] Calls `interpolatePosition()` for each active tram segment
- [ ] Updates React state with new tram positions, triggering a map re-render
- [ ] Polling stops when the component unmounts (no memory leaks)
- [ ] Failed fetch for a single stop does not crash the whole update cycle
- [ ] Tram markers from the previous cycle are replaced (not accumulated)

## Technical Notes

- Use `useEffect` with `setInterval` in `TramMap.tsx` (or a custom `usePolling` hook)
- Cleanup: `return () => clearInterval(intervalId)` in the `useEffect` cleanup
- To avoid fetching every stop on every tick (could be 100s of requests), only fetch stops on active tram lines; batch or parallelize with `Promise.allSettled`
- Algorithm per tick:
  1. Get current time T (Unix seconds)
  2. For each tram line, for each stop: fetch upcoming departures
  3. For each departure: find the two consecutive stops bracketing T in the stop_times schedule
  4. Call `interpolatePosition({ currentTime: T, stopA, stopB, shape })`
  5. Collect all `{ position, line, direction, isRealtime }` objects into state
- The `lib/api.ts` file should export a `fetchStopTimes(stopId: string)` helper wrapping the fetch call
- Consider debouncing or skipping a tick if the previous one is still in flight

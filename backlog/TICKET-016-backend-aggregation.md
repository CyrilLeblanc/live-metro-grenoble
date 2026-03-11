# TICKET-016 — Backend aggregation: single /api/trams endpoint

**Status**: Open
**Depends on**: TICKET-010, TICKET-005

## Goal

Introduce a `/api/trams` route that aggregates all tram positions server-side. The frontend replaces N per-line fetches with a single request per poll cycle, and the interpolation logic runs on the server.

## Acceptance Criteria

- [ ] `GET /api/trams` returns an array of tram position objects with no query params required
- [ ] Server fans out to all relevant Métromobilité stoptimes endpoints in parallel (`Promise.allSettled`)
- [ ] Interpolation runs server-side; client receives ready-to-render positions
- [ ] Each item in the response includes: `line`, `direction`, `nextStop`, `eta` (seconds), `isRealtime` (bool), `bearing` (degrees), `lat`, `lng`
- [ ] Failed per-line fetches are skipped gracefully (allSettled, not allResolved)
- [ ] Frontend poll loop calls `/api/trams` once per cycle instead of N times
- [ ] No regression in displayed tram data

## Technical Notes

- Move (or re-export) `interpolator.ts` so it can be imported in a Next.js API route / Route Handler without browser-only dependencies
- Fan-out: iterate over known line IDs (from GTFS routes), fire all stoptimes requests simultaneously
- Response shape example:
  ```ts
  {
    lat: number;
    lng: number;
    bearing: number;
    line: string;          // route_short_name
    lineColor: string;     // '#RRGGBB'
    direction: string;     // trip_headsign
    nextStop: string;      // stop_name
    eta: number;           // seconds to next stop
    isRealtime: boolean;
  }[]
  ```
- Consider caching the last successful response in-memory on the server to serve as fallback if a refresh partially fails

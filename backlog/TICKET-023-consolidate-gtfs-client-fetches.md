# TICKET-023 — Consolidate 5 GTFS client fetches into a single static API endpoint

**Status**: Open
**Depends on**: —

## Goal

On startup the client fires 5 separate fetch requests to load GTFS static data (routes, stops, shapes, trips, stop_times or similar). Replace these with a single `/api/gtfs-static` endpoint that aggregates and returns all required static data in one response, reducing waterfall latency and server-side file I/O on every page load.

## Acceptance Criteria

- [ ] Client makes exactly one fetch call to load all GTFS static data on startup
- [ ] The new endpoint returns a single JSON object containing all data previously spread across 5 calls
- [ ] Response is cached at the HTTP layer (`Cache-Control: public, max-age=3600` or equivalent) since GTFS static data changes infrequently
- [ ] Total payload size is not larger than the sum of the 5 previous responses (apply server-side filtering to include only fields the client uses)
- [ ] All existing features (line shapes, stop markers, departure lookups) work correctly with the consolidated response

## Technical Notes

- Create `app/api/gtfs-static/route.ts` (Next.js App Router) that reads and merges the relevant GTFS tables server-side
- Define a `GtfsStaticBundle` TypeScript type for the response shape; update client-side consumers to destructure from it
- Server-side: load data once at module level (or use Next.js `unstable_cache`) so repeated requests within the cache window do not re-parse CSV/JSON files
- Client-side: replace the 5 individual fetch helpers in `lib/api.ts` with a single `fetchGtfsStatic(): Promise<GtfsStaticBundle>` function
- Strip unused GTFS fields on the server (e.g. `agency`, `feed_info`, rarely-used `stop` columns) to keep the bundle lean
- Consider gzip compression for the response if the bundle exceeds ~100 KB

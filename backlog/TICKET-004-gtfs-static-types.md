# TICKET-004 — Create `lib/gtfs.ts` — types + loaders for static GTFS JSON

**Status**: Open
**Depends on**: TICKET-001, TICKET-002

## Goal

Define TypeScript types for all static GTFS entities and provide async loader functions that fetch the pre-parsed JSON files from `public/gtfs/`, giving the rest of the app a typed interface to the static transit data.

## Acceptance Criteria

- [ ] File at `lib/gtfs.ts`
- [ ] TypeScript interfaces defined for: `Route`, `Stop`, `Trip`, `StopTime`, `ShapePoint`
- [ ] Loader functions exported: `loadRoutes()`, `loadStops()`, `loadTrips()`, `loadStopTimes()`, `loadShapes()`
- [ ] Each loader fetches from `/gtfs/<file>.json` and returns a typed array
- [ ] Loaders usable both from client components and server components
- [ ] TypeScript compiles without errors (`npm run build`)

## Technical Notes

- Types should match the JSON shape produced by TICKET-002's parser:
  ```ts
  interface Stop { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }
  interface Route { route_id: string; route_short_name: string; route_long_name: string; route_color: string; route_text_color: string }
  interface Trip { trip_id: string; route_id: string; shape_id: string; service_id: string; direction_id: number }
  interface StopTime { trip_id: string; stop_id: string; stop_sequence: number; arrival_time: string; departure_time: string }
  interface ShapePoint { shape_id: string; shape_pt_lat: number; shape_pt_lon: number; shape_pt_sequence: number }
  ```
- Loaders should use `fetch('/gtfs/...')` — works on client; on server in Next.js use an absolute URL or `fs.readFile` alternative
- Consider a simple in-memory cache (module-level `let` variable) to avoid re-fetching on each render

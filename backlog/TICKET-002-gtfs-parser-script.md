# TICKET-002 — Write `scripts/parse-gtfs.js` (download + parse GTFS zip → JSON)

**Status**: Open
**Depends on**: TICKET-001

## Goal

Create a standalone Node.js script that downloads the Métromobilité GTFS zip, extracts and parses the relevant text files, filters to tram lines only, and writes clean JSON files into `public/gtfs/` for use by the front-end.

## Acceptance Criteria

- [ ] Script located at `scripts/parse-gtfs.js`
- [ ] Downloads `https://data.mobilites-m.fr/api/gtfs/TPV` without requiring manual download
- [ ] Parses and outputs the following files to `public/gtfs/`:
  - `routes.json` — tram routes only (`route_type = 0`)
  - `stops.json` — all stops with `stop_id`, `stop_name`, `stop_lat`, `stop_lon`
  - `trips.json` — `trip_id`, `route_id`, `shape_id`, `service_id`, `direction_id`
  - `stop_times.json` — `trip_id`, `stop_id`, `stop_sequence`, `arrival_time`, `departure_time`
  - `shapes.json` — `shape_id`, ordered array of `{ lat, lon, sequence }`
- [ ] Script can be run with `node scripts/parse-gtfs.js`
- [ ] Logs progress to console (download, extraction, each file written)
- [ ] Handles errors gracefully (network failure, malformed zip)

## Technical Notes

- Use Node.js built-ins only where possible (`https`, `fs`, `zlib`, `stream`) or allow a single well-known dependency (e.g. `adm-zip` or `yauzl`) for zip extraction
- GTFS files are CSV with a header row; parse manually or use a lightweight CSV parser
- Filter `routes.txt` on `route_type === "0"` (tram) before writing `routes.json`
- `stop_times.txt` is large; consider streaming line-by-line to avoid memory issues
- Times in GTFS may exceed `24:00:00` (next-day service) — preserve as strings or normalize carefully
- Add a `npm run parse-gtfs` script entry in `package.json` for convenience

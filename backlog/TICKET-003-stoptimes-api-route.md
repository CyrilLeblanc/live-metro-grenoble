# TICKET-003 — Create `app/api/stoptimes/route.ts` (CORS proxy to Métromobilité)

**Status**: Open
**Depends on**: TICKET-001

## Goal

Implement a Next.js Route Handler that acts as a server-side proxy to the Métromobilité real-time API, eliminating the CORS issue that would arise from calling the external API directly from the browser.

## Acceptance Criteria

- [ ] Route Handler at `app/api/stoptimes/route.ts`
- [ ] Accepts `GET /api/stoptimes?stopId=<id>`
- [ ] Fetches `http://data.mobilites-m.fr/api/routers/default/index/clusters/{stopId}/stoptimes` server-side
- [ ] Returns the upstream JSON response to the client unchanged
- [ ] Returns `400` with an error message if `stopId` query param is missing
- [ ] Returns `502` (or upstream status) if the Métromobilité API call fails
- [ ] Response includes `Content-Type: application/json`

## Technical Notes

- Use the Next.js App Router Route Handler pattern: `export async function GET(request: Request)`
- Extract `stopId` from `new URL(request.url).searchParams`
- Use native `fetch()` (available in Next.js / Node 18+) for the upstream call
- Do NOT add authentication or rate limiting at MVP stage
- The upstream API returns an array of pattern objects, each with a `times` array containing `{ realtimeArrival, scheduledArrival, realtime, ... }` fields
- Document the expected response shape in a comment for consumers (used in TICKET-009/010)

# TICKET-006 — Build `TramMap.tsx` — Leaflet map centered on Grenoble (SSR-safe)

**Status**: Open
**Depends on**: TICKET-001

## Goal

Create the main map component using Leaflet and react-leaflet, dynamically imported to avoid SSR issues, centered on Grenoble with OpenStreetMap tiles.

## Acceptance Criteria

- [ ] Component at `components/TramMap.tsx`
- [ ] Dynamically imported in `app/page.tsx` with `ssr: false`
- [ ] Map renders centered on Grenoble (lat: 45.1885, lng: 5.7245, zoom: 13)
- [ ] OpenStreetMap tiles displayed (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
- [ ] Attribution shown as required by OSM license
- [ ] No SSR errors (`window is not defined`)
- [ ] `npm run build` passes

## Technical Notes

- Install: `npm install leaflet react-leaflet` and `npm install -D @types/leaflet`
- Leaflet's default marker icons break in webpack — fix by importing marker icons explicitly or using a CSS workaround:
  ```ts
  import L from 'leaflet'
  import 'leaflet/dist/leaflet.css'
  delete (L.Icon.Default.prototype as any)._getIconUrl
  L.Icon.Default.mergeOptions({ iconRetinaUrl: ..., iconUrl: ..., shadowUrl: ... })
  ```
- Wrap the map in a `div` with an explicit height (e.g. `height: 100vh`) — Leaflet requires the container to have a defined size
- In `app/page.tsx`:
  ```ts
  const TramMap = dynamic(() => import('@/components/TramMap'), { ssr: false })
  ```
- Leaflet CSS must be imported inside the component (or in a client-only context) to avoid Next.js CSS import issues

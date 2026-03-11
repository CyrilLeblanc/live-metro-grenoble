# TICKET-012 — Write README with setup instructions

**Status**: Open
**Depends on**: TICKET-001, TICKET-002, TICKET-003, TICKET-004, TICKET-005, TICKET-006, TICKET-007, TICKET-008, TICKET-009, TICKET-010, TICKET-011

## Goal

Write a clear README that lets a new developer get the project running from scratch, covering prerequisites, the mandatory GTFS data step, and how to start the development server.

## Acceptance Criteria

- [ ] `README.md` at the project root
- [ ] Covers: prerequisites, installation, GTFS data generation, dev server, production build
- [ ] Documents the "run GTFS script first" requirement prominently
- [ ] Explains the interpolation approach and its limitations
- [ ] Lists the known constraints from the spec
- [ ] Includes a project structure overview
- [ ] No broken links or placeholder text

## Technical Notes

Suggested README sections:

1. **Overview** — what the app does and why position data is interpolated
2. **Prerequisites** — Node.js 18+, npm
3. **Installation** — `git clone`, `npm install`
4. **Step 1 — Generate static GTFS data** (required before first run):
   ```bash
   node scripts/parse-gtfs.js
   # Downloads and parses GTFS from data.mobilites-m.fr
   # Writes JSON files to public/gtfs/
   ```
5. **Step 2 — Start the dev server**:
   ```bash
   npm run dev
   # Open http://localhost:3000
   ```
6. **Production build**: `npm run build && npm start`
7. **Updating GTFS data** — re-run the parse script periodically when the transit plan changes
8. **Known limitations**:
   - Tram positions are estimated, not GPS-tracked
   - The official GTFS-RT feed was discontinued by Metropole; positions may be theoretical
   - Schedules marked `realtime: false` are shown with reduced confidence styling
9. **Project structure** — brief file tree with one-line descriptions

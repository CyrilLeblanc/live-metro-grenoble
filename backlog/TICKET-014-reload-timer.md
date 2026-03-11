# TICKET-014 — Reload timer countdown + force reload button

**Status**: Open
**Depends on**: TICKET-010

## Goal

Add a UI overlay in the top-right corner showing a live countdown from 30 to 0 seconds until the next auto-refresh, along with a force reload button that triggers the poll immediately and resets the countdown.

## Acceptance Criteria

- [ ] Countdown display shows seconds remaining until next auto-poll (30 → 0)
- [ ] Timer resets to 30 on each successful poll
- [ ] Force reload button triggers the poll function immediately
- [ ] Force reload resets the countdown timer
- [ ] Overlay is positioned top-right, non-intrusive, does not obscure map controls
- [ ] Visible on both desktop and mobile viewports

## Technical Notes

- Maintain a `secondsLeft` state initialized to 30; decrement via `setInterval` every 1 second
- On successful poll completion, clear and restart both the poll interval and the countdown interval
- Force reload button calls the same polling function used by the auto-refresh (avoid duplicating fetch logic)
- Use a Leaflet `Control` or a plain absolutely-positioned React div — either works, but a plain div is simpler if the polling state already lives in a React component
- Style suggestion: small semi-transparent pill (e.g. `bg-white/80 rounded px-2 py-1 text-sm`) with a refresh icon alongside the countdown

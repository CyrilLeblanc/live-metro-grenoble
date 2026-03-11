# TICKET-015 — Stop markers: uniform purple color

**Status**: Open
**Depends on**: TICKET-008

## Goal

Change all stop marker dots to a single purple color, removing any per-line color variation so stops are visually distinct from tram icons.

## Acceptance Criteria

- [ ] All stop markers render in the same purple color regardless of which line(s) serve the stop
- [ ] Purple value is defined as a single constant (easy to change later)
- [ ] No other stop marker behavior is affected (click, tooltip, visibility)

## Technical Notes

- Change is isolated to `StopMarker.tsx` (or wherever the circle color is currently set)
- Suggested color: `#7C3AED` (Tailwind `violet-600`) or `#9333EA` (Tailwind `purple-600`)
- If stop markers currently derive color from route data, remove that lookup for the fill/stroke; keep any other route data used for popups or filtering

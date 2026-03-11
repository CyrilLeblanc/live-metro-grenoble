# TICKET-017 — Improved tram popup styling

**Status**: Open
**Depends on**: TICKET-011

## Goal

Restyle the Leaflet popup shown when clicking a tram marker. Replace the default plain-text tooltip with a structured, visually polished layout that clearly communicates line, direction, next stop, ETA, and live/theoretical status.

## Acceptance Criteria

- [ ] Popup shows a colored line badge (background = line color, white text)
- [ ] Direction/headsign displayed clearly
- [ ] Next stop name displayed
- [ ] ETA shown in a human-readable format (e.g. "in 2 min" or "42 s")
- [ ] Live/theoretical indicator rendered as a colored pill ("Live" green / "Theoretical" amber)
- [ ] Default Leaflet popup chrome (white border, drop shadow, padding) is overridden with custom CSS
- [ ] Popup remains accessible and readable on mobile

## Technical Notes

- Use `L.popup({ className: 'tram-popup' })` (or equivalent in React-Leaflet) to attach a custom CSS class
- Override styles in a global CSS file (e.g. `app/globals.css`) targeting `.tram-popup .leaflet-popup-content-wrapper`
- Popup content can be rendered as an HTML string via `DivIcon`/`bindPopup` or as a React portal — choose whichever is consistent with the existing tooltip approach from TICKET-011
- ETA formatting: `eta < 60 ? \`${eta}s\` : \`${Math.round(eta/60)} min\``

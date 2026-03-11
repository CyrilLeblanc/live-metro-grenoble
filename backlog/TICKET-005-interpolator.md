# TICKET-005 — Implement `lib/interpolator.ts` — ratio-based + shape projection logic

**Status**: Open
**Depends on**: TICKET-004

## Goal

Implement the position interpolation logic that estimates a tram's current coordinates based on its scheduled stop times and, when available, the shape polyline geometry.

## Acceptance Criteria

- [ ] File at `lib/interpolator.ts`
- [ ] Exports a function `interpolatePosition(params): LatLng | null`
- [ ] Implements linear interpolation between two stops when no shape data is available
- [ ] Implements shape-projected interpolation when a shape polyline is provided
- [ ] Returns `null` if the current time is outside the `[T_A, T_B]` window
- [ ] Handles GTFS times > `24:00:00` correctly (next-day service)
- [ ] Unit-testable with pure inputs (no side effects, no API calls)

## Technical Notes

Linear interpolation (fallback):
```
ratio = (T - T_A) / (T_B - T_A)   // 0..1
lat   = A.lat + ratio * (B.lat - A.lat)
lng   = A.lng + ratio * (B.lng - A.lng)
```

Shape projection (preferred):
- Given the shape polyline for the trip, find the sub-segment between the shape points nearest to stop A and stop B
- Compute cumulative arc length along that sub-segment
- Walk `ratio * totalLength` along the polyline to get the interpolated point

Function signature suggestion:
```ts
interface InterpolateParams {
  currentTime: number        // Unix timestamp (seconds)
  stopA: { lat: number; lng: number; time: number }  // time = Unix seconds
  stopB: { lat: number; lng: number; time: number }
  shape?: Array<{ lat: number; lon: number }>         // ordered shape points between A and B
}
```

- GTFS `arrival_time` strings like `"07:32:00"` or `"25:15:00"` must be converted to seconds-since-midnight, then offset by the service day's midnight timestamp
- The shape sub-segment between two stops can be approximated by finding the closest shape point to each stop's coordinates

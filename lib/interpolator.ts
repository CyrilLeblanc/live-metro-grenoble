/**
 * Position interpolation along a GTFS shape polyline.
 *
 * Given two consecutive stops (A → B) with their scheduled times, and the
 * vehicle's shape geometry, this module computes where the vehicle should be
 * at any given moment between those stops.
 *
 * Algorithm:
 *  1. Compute a time-based progress ratio (0 at A, 1 at B).
 *  2. Slice the shape polyline between the nearest shape points to A and B.
 *  3. Build cumulative arc lengths along that slice.
 *  4. Interpolate a position at `ratio * totalLength` along the slice.
 *  5. Fall back to linear interpolation between A and B if no shape is available.
 */

export interface LatLng { lat: number; lng: number }

interface ShapePoint { lat: number; lon: number }

interface InterpolateParams {
  currentTime: number   // Unix seconds
  stopA: { lat: number; lng: number; time: number }
  stopB: { lat: number; lng: number; time: number }
  shape?: ShapePoint[]  // ordered shape points between A and B
}

/**
 * Simple Euclidean distance in degrees — intentionally not Haversine.
 *
 * Used only for finding the nearest shape point to a stop coordinate.
 * Degree-based distance is sufficient here because we only need a relative
 * nearest-neighbour comparison, not an accurate distance in metres.
 */
function dist(a: { lat: number; lng: number } | { lat: number; lon: number }, b: { lat: number; lng: number } | { lat: number; lon: number }): number {
  const aLng = 'lng' in a ? a.lng : a.lon;
  const bLng = 'lng' in b ? b.lng : b.lon;
  const dLat = b.lat - a.lat;
  const dLng = bLng - aLng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function nearestIndex(shape: ShapePoint[], target: { lat: number; lng: number }): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < shape.length; i++) {
    const d = dist(shape[i], target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function interpolatePosition(params: InterpolateParams): LatLng | null {
  const { currentTime, stopA, stopB, shape } = params;

  if (currentTime < stopA.time || currentTime > stopB.time) return null;

  const span = stopB.time - stopA.time;
  const ratio = span === 0 ? 0 : Math.min(1, Math.max(0, (currentTime - stopA.time) / span));

  if (shape && shape.length >= 2) {
    const iA = nearestIndex(shape, stopA);
    const iB = nearestIndex(shape, stopB);

    const start = Math.min(iA, iB);
    const end = Math.max(iA, iB);
    const slice = shape.slice(start, end + 1);

    if (slice.length >= 2) {
      // Build path: stopA anchor, shape slice, stopB anchor
      type Point = { lat: number; lng: number };
      const path: Point[] = [
        { lat: stopA.lat, lng: stopA.lng },
        ...slice.map(p => ({ lat: p.lat, lng: p.lon })),
        { lat: stopB.lat, lng: stopB.lng },
      ];

      // Cumulative arc lengths (degree-based, consistent with dist() above)
      const lengths: number[] = [0];
      for (let i = 1; i < path.length; i++) {
        lengths.push(lengths[i - 1] + dist(path[i - 1], path[i]));
      }
      const totalLength = lengths[lengths.length - 1];

      if (totalLength > 0) {
        const target = ratio * totalLength;
        for (let i = 1; i < path.length; i++) {
          if (lengths[i] >= target || i === path.length - 1) {
            const segLen = lengths[i] - lengths[i - 1];
            const t = segLen === 0 ? 0 : (target - lengths[i - 1]) / segLen;
            return {
              lat: path[i - 1].lat + t * (path[i].lat - path[i - 1].lat),
              lng: path[i - 1].lng + t * (path[i].lng - path[i - 1].lng),
            };
          }
        }
      }
    }
  }

  // Linear fallback when no shape data is available
  return {
    lat: stopA.lat + ratio * (stopB.lat - stopA.lat),
    lng: stopA.lng + ratio * (stopB.lng - stopA.lng),
  };
}

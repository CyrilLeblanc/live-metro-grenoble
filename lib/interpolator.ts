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
 * Degree-based distance with latitude correction — intentionally not Haversine.
 *
 * Used only for finding the nearest shape point to a stop coordinate and for
 * accumulating path lengths. The longitude delta is weighted by cos(lat) so
 * both axes are in comparable units before squaring.
 */
function dist(a: { lat: number; lng: number } | { lat: number; lon: number }, b: { lat: number; lng: number } | { lat: number; lon: number }): number {
  const aLng = 'lng' in a ? a.lng : a.lon;
  const bLng = 'lng' in b ? b.lng : b.lon;
  const dLat = b.lat - a.lat;
  const dLng = bLng - aLng;
  // Fix 1: weight longitude delta by cos(lat) to correct for latitude distortion
  // (~45°N: 1° lng ≈ 79 km vs 1° lat ≈ 111 km, ratio ≈ cos(45°) ≈ 0.707)
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + (cosLat * dLng) * (cosLat * dLng));
}

function nearestIndex(shape: ShapePoint[], target: { lat: number; lng: number }, startFrom = 0, maxDistDeg = 0.01): number {
  let best = startFrom;
  let bestDist = Infinity;
  for (let i = startFrom; i < shape.length; i++) {
    const d = dist(shape[i], target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  // Fix 3: if the best match exceeds maxDistDeg (~1 km at 45°N), fall back to
  // startFrom to avoid snapping to a wrong distant point on looping/crossing lines
  if (bestDist > maxDistDeg) return startFrom;
  return best;
}

export function interpolatePosition(params: InterpolateParams): LatLng | null {
  const { currentTime, stopA, stopB, shape } = params;

  if (currentTime < stopA.time || currentTime > stopB.time) return null;

  const span = stopB.time - stopA.time;
  const ratio = span === 0 ? 0 : Math.min(1, Math.max(0, (currentTime - stopA.time) / span));
  // Fix 2: apply ease-in-out (smoothstep) so the tram accelerates out of a stop
  // and decelerates into the next one, replacing the unrealistic constant-speed motion
  const easedRatio = ratio < 0.5 ? 2 * ratio * ratio : -1 + (4 - 2 * ratio) * ratio;

  if (shape && shape.length >= 2) {
    const iA = nearestIndex(shape, stopA);
    const iB = nearestIndex(shape, stopB, iA);

    const slice = shape.slice(iA, iB + 1);

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
        const target = easedRatio * totalLength;
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

  // Linear fallback when no shape data is available (uses easedRatio for consistent motion)
  return {
    lat: stopA.lat + easedRatio * (stopB.lat - stopA.lat),
    lng: stopA.lng + easedRatio * (stopB.lng - stopA.lng),
  };
}

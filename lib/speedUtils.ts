/**
 * Linear interpolation of speed at time `t` from an ordered time-series of
 * (tSec, speedMs) points.
 *
 * - If `t` is before the first point, returns the first point's speed (clamp).
 * - If `t` is after the last point, returns the last point's speed (clamp).
 * - Otherwise, linearly interpolates between the two surrounding points.
 */
export function interpolateSpeed(
  points: Array<{ tSec: number; speedMs: number }>,
  t: number,
): number {
  if (points.length === 0) return 0
  if (t <= points[0].tSec) return points[0].speedMs
  if (t >= points[points.length - 1].tSec) return points[points.length - 1].speedMs
  for (let i = 1; i < points.length; i++) {
    if (points[i].tSec >= t) {
      const prev = points[i - 1]
      const next = points[i]
      const span = next.tSec - prev.tSec
      const frac = span === 0 ? 0 : (t - prev.tSec) / span
      return prev.speedMs + frac * (next.speedMs - prev.speedMs)
    }
  }
  return points[points.length - 1].speedMs
}

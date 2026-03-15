/**
 * Shared formatting utilities for time and ETA display.
 */

/**
 * Formats an ETA (in seconds from now) into a human-readable string.
 *
 * - ≤ 0 seconds → "arriving"
 * - < 1 minute  → "< 1 min"
 * - otherwise   → "in N min"
 */
export function formatEta(secs: number): string {
  if (secs <= 0) return 'arriving'
  const mins = Math.round(secs / 60)
  return mins < 1 ? '< 1 min' : `in ${mins} min`
}

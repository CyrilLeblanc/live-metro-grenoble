export const RAD = Math.PI / 180

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * RAD
  const dLng = (lng2 - lng1) * RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function makeSegmentKey(stopAId: string, stopBId: string): string {
  return [stopAId, stopBId].sort().join('__').replace(/[^a-zA-Z0-9]/g, '-')
}

export interface AveragedGraph {
  segmentKey: string
  totalDurationSec: number
  points: Array<{ tSec: number; speedMs: number }>
  sampleCount: number
}

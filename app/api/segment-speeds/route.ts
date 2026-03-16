import { NextRequest } from 'next/server'
import { appendSpeedGraph, getAveragedGraphs, makeSegmentKey, readRecords } from '../../../lib/segmentSpeeds'
import {
  MAX_SEGMENT_SPEED_MS,
  PASSIVE_MAX_SEGMENT_DURATION_S,
  PASSIVE_MIN_POINTS_PER_SEGMENT,
  PASSIVE_MIN_SPEED_MS,
} from '../../../lib/config'

export async function POST(req: NextRequest) {
  let body: { stopAId: string; stopBId: string; totalDurationSec: number; points: Array<{ tSec: number; speedMs: number }> }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { stopAId, stopBId, totalDurationSec, points } = body
  if (!stopAId || !stopBId || !Array.isArray(points) || points.length < 3) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const invalidSpeed = points.some(p => typeof p.speedMs !== 'number' || p.speedMs < 0 || p.speedMs > MAX_SEGMENT_SPEED_MS)
  if (invalidSpeed) {
    return Response.json({ error: 'speed out of range' }, { status: 400 })
  }

  // Coherence checks
  if (totalDurationSec > PASSIVE_MAX_SEGMENT_DURATION_S) {
    return Response.json({ error: 'duration too long' }, { status: 400 })
  }
  if (points.length < PASSIVE_MIN_POINTS_PER_SEGMENT) {
    return Response.json({ error: 'too few points' }, { status: 400 })
  }
  const movingPoints = points.filter(p => p.speedMs > PASSIVE_MIN_SPEED_MS)
  if (movingPoints.length < 2) {
    return Response.json({ error: 'no movement detected' }, { status: 400 })
  }

  const key = makeSegmentKey(stopAId, stopBId)

  // Outlier z-score check: reject if new recording's mean speed is > 2.5 std devs from existing
  const existing = await readRecords(key)
  if (existing.length >= 3) {
    const newMean = points.reduce((s, p) => s + p.speedMs, 0) / points.length
    const existingMeans = existing.map(r => r.points.reduce((s, p) => s + p.speedMs, 0) / r.points.length)
    const mu = existingMeans.reduce((s, v) => s + v, 0) / existingMeans.length
    const sigma = Math.sqrt(existingMeans.reduce((s, v) => s + (v - mu) ** 2, 0) / existingMeans.length)
    if (sigma > 0 && Math.abs((newMean - mu) / sigma) > 2.5) {
      return Response.json({ error: 'outlier' }, { status: 422 })
    }
  }

  await appendSpeedGraph(key, { totalDurationSec, points })
  return Response.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('keys') ?? ''
  const keys = raw.split(',').map(k => k.trim()).filter(Boolean).slice(0, 50)
  if (keys.length === 0) {
    return Response.json({})
  }
  const map = await getAveragedGraphs(keys)
  const result: Record<string, unknown> = {}
  for (const [k, v] of map) result[k] = v
  return Response.json(result)
}

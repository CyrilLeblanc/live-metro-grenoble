import { NextRequest } from 'next/server'
import { /* appendSpeedGraph, */ getAveragedGraphs /*, makeSegmentKey */ } from '../../../lib/segmentSpeeds'
// import { MAX_SEGMENT_SPEED_MS } from '../../../lib/config'

// Contributions disabled — POST endpoint commented out
// export async function POST(req: NextRequest) {
//   let body: { stopAId: string; stopBId: string; totalDurationSec: number; points: Array<{ tSec: number; speedMs: number }> }
//   try {
//     body = await req.json()
//   } catch {
//     return Response.json({ error: 'invalid JSON' }, { status: 400 })
//   }
//
//   const { stopAId, stopBId, totalDurationSec, points } = body
//   if (!stopAId || !stopBId || !Array.isArray(points) || points.length < 3) {
//     return Response.json({ error: 'invalid body' }, { status: 400 })
//   }
//
//   const invalidSpeed = points.some(p => typeof p.speedMs !== 'number' || p.speedMs < 0 || p.speedMs > MAX_SEGMENT_SPEED_MS)
//   if (invalidSpeed) {
//     return Response.json({ error: 'speed out of range' }, { status: 400 })
//   }
//
//   const key = makeSegmentKey(stopAId, stopBId)
//   await appendSpeedGraph(key, { totalDurationSec, points })
//   return Response.json({ ok: true })
// }

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

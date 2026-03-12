import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { makeSegmentKey, AveragedGraph } from './geo'

export { makeSegmentKey }

interface SpeedGraphRecord {
  id: string
  recordedAt: number
  totalDurationSec: number
  points: Array<{ tSec: number; speedMs: number }>
}

const DATA_DIR = join(process.cwd(), 'data', 'segment-speeds')

function filePath(key: string): string {
  return join(DATA_DIR, `${key}.json`)
}

function interpolateAt(points: Array<{ tSec: number; speedMs: number }>, t: number): number {
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

async function readRecords(key: string): Promise<SpeedGraphRecord[]> {
  try {
    const raw = await readFile(filePath(key), 'utf-8')
    return JSON.parse(raw) as SpeedGraphRecord[]
  } catch {
    return []
  }
}

export async function appendSpeedGraph(
  key: string,
  data: { totalDurationSec: number; points: Array<{ tSec: number; speedMs: number }> }
): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  const records = await readRecords(key)
  records.push({
    id: randomUUID(),
    recordedAt: Date.now(),
    totalDurationSec: data.totalDurationSec,
    points: data.points,
  })
  const kept = records.slice(-10)
  await writeFile(filePath(key), JSON.stringify(kept), 'utf-8')
}

export async function getAveragedGraph(key: string): Promise<AveragedGraph | null> {
  const records = await readRecords(key)
  if (records.length === 0) return null

  const meanDuration = records.reduce((s, r) => s + r.totalDurationSec, 0) / records.length
  const gridCount = Math.max(1, Math.floor(meanDuration / 2))
  const points: Array<{ tSec: number; speedMs: number }> = []

  for (let i = 0; i <= gridCount; i++) {
    const t = i * 2
    const avgSpeed = records.reduce((s, r) => s + interpolateAt(r.points, t), 0) / records.length
    points.push({ tSec: t, speedMs: avgSpeed })
  }

  return {
    segmentKey: key,
    totalDurationSec: meanDuration,
    points,
    sampleCount: records.length,
  }
}

export async function getAveragedGraphs(keys: string[]): Promise<Map<string, AveragedGraph>> {
  const results = await Promise.all(keys.map(async k => ({ key: k, graph: await getAveragedGraph(k) })))
  const map = new Map<string, AveragedGraph>()
  for (const { key, graph } of results) {
    if (graph) map.set(key, graph)
  }
  return map
}

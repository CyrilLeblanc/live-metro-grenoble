import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { makeSegmentKey, AveragedGraph } from './geo'
import { interpolateSpeed } from './speedUtils'
import { SEGMENT_SPEEDS_MAX_RECORDS, SEGMENT_SPEEDS_GRID_STEP_SEC } from './config'

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
  // Retain only the most recent recordings to keep file size bounded
  const kept = records.slice(-SEGMENT_SPEEDS_MAX_RECORDS)
  await writeFile(filePath(key), JSON.stringify(kept), 'utf-8')
}

export async function getAveragedGraph(key: string): Promise<AveragedGraph | null> {
  const records = await readRecords(key)
  if (records.length === 0) return null

  const meanDuration = records.reduce((s, r) => s + r.totalDurationSec, 0) / records.length
  // Build a uniform time grid at SEGMENT_SPEEDS_GRID_STEP_SEC resolution
  const gridCount = Math.max(1, Math.floor(meanDuration / SEGMENT_SPEEDS_GRID_STEP_SEC))
  const points: Array<{ tSec: number; speedMs: number }> = []

  for (let i = 0; i <= gridCount; i++) {
    const t = i * SEGMENT_SPEEDS_GRID_STEP_SEC
    // Average the interpolated speed across all recordings at this time offset
    const avgSpeed = records.reduce((s, r) => s + interpolateSpeed(r.points, t), 0) / records.length
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

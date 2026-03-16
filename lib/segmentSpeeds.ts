import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { makeSegmentKey, AveragedGraph } from './geo'
import { interpolateSpeed } from './speedUtils'
import { SEGMENT_SPEEDS_MAX_RECORDS, SEGMENT_SPEEDS_GRID_STEP_SEC } from './config'

export { makeSegmentKey }

export interface SpeedGraphRecord {
  id: string
  recordedAt: number
  totalDurationSec: number
  points: Array<{ tSec: number; speedMs: number }>
}

const DATA_DIR = join(process.cwd(), 'data', 'segment-speeds')

function filePath(key: string): string {
  return join(DATA_DIR, `${key}.json`)
}

export async function readRecords(key: string): Promise<SpeedGraphRecord[]> {
  try {
    const raw = await readFile(filePath(key), 'utf-8')
    return JSON.parse(raw) as SpeedGraphRecord[]
  } catch {
    return []
  }
}

export async function deleteRecord(key: string, id: string): Promise<void> {
  const records = await readRecords(key)
  const filtered = records.filter(r => r.id !== id)
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(filePath(key), JSON.stringify(filtered), 'utf-8')
}

export async function updateRecord(
  key: string,
  id: string,
  patch: { totalDurationSec?: number; points?: Array<{ tSec: number; speedMs: number }> }
): Promise<boolean> {
  const records = await readRecords(key)
  const idx = records.findIndex(r => r.id === id)
  if (idx === -1) return false
  records[idx] = { ...records[idx], ...patch }
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(filePath(key), JSON.stringify(records), 'utf-8')
  return true
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

  const now = Date.now()
  // Compute per-record temporal decay weight: w = e^(-0.01 * age_days), half-life ≈ 70 days
  const weights = records.map(r => Math.exp(-0.01 * (now - r.recordedAt) / 86_400_000))
  const totalWeight = weights.reduce((s, w) => s + w, 0)

  const meanDuration = records.reduce((s, r, i) => s + r.totalDurationSec * weights[i], 0) / totalWeight
  // Build a uniform time grid at SEGMENT_SPEEDS_GRID_STEP_SEC resolution
  const gridCount = Math.max(1, Math.floor(meanDuration / SEGMENT_SPEEDS_GRID_STEP_SEC))
  const points: Array<{ tSec: number; speedMs: number }> = []

  for (let i = 0; i <= gridCount; i++) {
    const t = i * SEGMENT_SPEEDS_GRID_STEP_SEC
    // Weighted average of interpolated speed across all recordings at this time offset
    const avgSpeed = records.reduce((s, r, idx) => s + interpolateSpeed(r.points, t) * weights[idx], 0) / totalWeight
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

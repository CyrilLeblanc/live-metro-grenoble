import { NextRequest, NextResponse } from 'next/server'
import { readRecords, deleteRecord, updateRecord } from '../../../../lib/segmentSpeeds'
import { MAX_SEGMENT_SPEED_MS } from '../../../../lib/config'

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
  const records = await readRecords(key)
  return NextResponse.json(records)
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  const id = req.nextUrl.searchParams.get('id')
  if (!key || !id) return NextResponse.json({ error: 'key and id required' }, { status: 400 })
  await deleteRecord(key, id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  const id = req.nextUrl.searchParams.get('id')
  if (!key || !id) return NextResponse.json({ error: 'key and id required' }, { status: 400 })

  let body: { totalDurationSec?: number; points?: Array<{ tSec: number; speedMs: number }> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (body.points) {
    const invalid = body.points.some(p => p.speedMs < 0 || p.speedMs > MAX_SEGMENT_SPEED_MS)
    if (invalid) {
      return NextResponse.json({ error: `speedMs must be between 0 and ${MAX_SEGMENT_SPEED_MS}` }, { status: 400 })
    }
  }

  const ok = await updateRecord(key, id, body)
  if (!ok) return NextResponse.json({ error: 'record not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

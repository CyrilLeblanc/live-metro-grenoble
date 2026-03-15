import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { invalidateGtfsCache } from '../../gtfs-static/route'

const ALLOWED_FILES = ['clusters', 'segment-paths'] as const
type AllowedFile = typeof ALLOWED_FILES[number]

function filePath(file: AllowedFile): string {
  return join(process.cwd(), 'public', 'gtfs', `${file}.json`)
}

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file') as AllowedFile | null
  if (!file || !ALLOWED_FILES.includes(file)) {
    return NextResponse.json({ error: 'Invalid file parameter. Use: clusters or segment-paths' }, { status: 400 })
  }

  try {
    const content = await readFile(filePath(file), 'utf-8')
    return new NextResponse(content, {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file') as AllowedFile | null
  if (!file || !ALLOWED_FILES.includes(file)) {
    return NextResponse.json({ error: 'Invalid file parameter. Use: clusters or segment-paths' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    await writeFile(filePath(file), JSON.stringify(body, null, 2), 'utf-8')
    invalidateGtfsCache()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to write file' }, { status: 500 })
  }
}

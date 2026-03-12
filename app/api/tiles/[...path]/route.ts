import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const CACHE_DIR = path.join(process.cwd(), '.cache', 'tiles')
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function isValidTilePath(z: string, x: string, yWithExt: string): boolean {
  const y = yWithExt.replace(/\.png$/, '')
  return /^\d+$/.test(z) && /^\d+$/.test(x) && /^\d+$/.test(y)
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params

  if (segments.length !== 3) {
    return new Response('Invalid tile path', { status: 400 })
  }

  const [z, x, yWithExt] = segments

  if (!isValidTilePath(z, x, yWithExt)) {
    return new Response('Invalid tile coordinates', { status: 400 })
  }

  const y = yWithExt.replace(/\.png$/, '')
  const cacheFile = path.join(CACHE_DIR, z, x, `${y}.png`)

  // Serve from cache if fresh
  try {
    const stat = await fs.stat(cacheFile)
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      const data = await fs.readFile(cacheFile)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=2592000',
        },
      })
    }
  } catch {
    // Cache miss — fall through to upstream fetch
  }

  // Fetch from OSM
  let tileBuffer: Buffer
  try {
    const upstream = await fetch(
      `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
      { headers: { 'User-Agent': 'grenoble-tram-viewer/1.0 (tile proxy cache)' } }
    )
    if (!upstream.ok) throw new Error(`OSM responded ${upstream.status}`)
    tileBuffer = Buffer.from(await upstream.arrayBuffer())
  } catch {
    // Stale-cache fallback
    try {
      const data = await fs.readFile(cacheFile)
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=2592000' },
      })
    } catch {
      return new Response('Tile unavailable', { status: 502 })
    }
  }

  // Write to cache (fire-and-forget)
  fs.mkdir(path.dirname(cacheFile), { recursive: true })
    .then(() => fs.writeFile(cacheFile, tileBuffer))
    .catch(() => {})

  return new Response(tileBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=2592000',
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')
  if (!q) {
    return NextResponse.json({ error: 'Missing query parameter: q' }, { status: 400 })
  }

  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'live-metro-grenoble-admin/1.0' },
  })

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Overpass returned ${upstream.status}` },
      { status: upstream.status }
    )
  }

  const data = await upstream.json()
  return NextResponse.json(data)
}

import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch?.startsWith('W/')) {
    const headers = new Headers(request.headers)
    headers.set('If-None-Match', ifNoneMatch.slice(2))
    return NextResponse.next({ request: { headers } })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/tiles/:path*', '/api/gtfs-static'],
}

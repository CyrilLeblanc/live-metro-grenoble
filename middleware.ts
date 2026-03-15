import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Basic Auth protection for admin routes
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const adminPassword = process.env.ADMIN_PASSWORD
    const auth = request.headers.get('Authorization')

    if (!auth?.startsWith('Basic ')) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Admin"' },
      })
    }

    const credentials = Buffer.from(auth.slice(6), 'base64').toString('utf-8')
    const colonIdx = credentials.indexOf(':')
    const inputPassword = colonIdx >= 0 ? credentials.slice(colonIdx + 1) : credentials

    if (!adminPassword || inputPassword !== adminPassword) {
      return new Response('Forbidden', { status: 403 })
    }

    return NextResponse.next()
  }

  // Normalize weak ETags (W/ prefix) for cache validation
  const ifNoneMatch = request.headers.get('If-None-Match')
  if (ifNoneMatch?.startsWith('W/')) {
    const headers = new Headers(request.headers)
    headers.set('If-None-Match', ifNoneMatch.slice(2))
    return NextResponse.next({ request: { headers } })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/tiles/:path*', '/api/gtfs-static', '/admin/:path*', '/admin', '/api/admin/:path*'],
}

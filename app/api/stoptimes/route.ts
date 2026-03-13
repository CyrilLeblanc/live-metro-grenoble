import { UPSTREAM_API_BASE } from '../../../lib/config'

const CACHE_TTL_MS = 10_000
const stopTimesCache = new Map<string, { body: string; fetchedAt: number }>()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stopId = searchParams.get('stopId');

  if (!stopId) {
    return Response.json({ error: 'Missing stopId query parameter' }, { status: 400 });
  }

  const cached = stopTimesCache.get(stopId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return new Response(cached.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const origin = request.headers.get('origin') ?? 'http://localhost:3000';

  let upstream: Response;
  try {
    upstream = await fetch(
      `${UPSTREAM_API_BASE}/routers/default/index/clusters/${stopId}/stoptimes`,
      { headers: { Origin: origin } }
    );
  } catch {
    return Response.json({ error: 'Failed to reach upstream API' }, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await upstream.text();
  stopTimesCache.set(stopId, { body, fetchedAt: Date.now() });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

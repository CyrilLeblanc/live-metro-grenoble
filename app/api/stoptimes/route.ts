import { UPSTREAM_API_BASE } from '../../../lib/config'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stopId = searchParams.get('stopId');

  if (!stopId) {
    return Response.json({ error: 'Missing stopId query parameter' }, { status: 400 });
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

  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

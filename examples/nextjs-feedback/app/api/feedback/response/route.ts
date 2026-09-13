import { assertLocalRequest, findResponse } from '../../../../lib/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { assertLocalRequest(request); }
  catch { return Response.json({ error: 'Local example access only.' }, { status: 403 }); }
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id)) return Response.json({ error: 'Receipt ID required.' }, { status: 400 });
  try {
    const response = await findResponse(id);
    return Response.json(response ? { response } : { error: 'Response not found in the first 100 collection records.' },
      { status: response ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Response retrieval is unavailable.' }, { status: 502 }); }
}

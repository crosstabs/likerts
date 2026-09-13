import { assertLocalRequest, collectionConfig } from '../../../../lib/server';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { assertLocalRequest(request); }
  catch { return Response.json({ error: 'Local example access only.' }, { status: 403 }); }
  try {
    return Response.json(collectionConfig(), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Configure the local collection first.' }, { status: 503 }); }
}

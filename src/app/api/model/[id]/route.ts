// === GET /api/model/[id] ===
// Returns the geometry of a single OSRS model by id as JSON. Server-side
// only — the OSRS cache lives on the server. Browser fetches just the small
// geometry payload it needs.
//
// Response shape (FlatGeometry): { positions: number[], indices: number[] }
// 404 if the model id doesn't resolve.

import { NextResponse } from 'next/server';
import { IndexType } from 'osrscachereader';
import { getCache } from '@/viewer/cache';
import { toFlatGeometry } from '@/viewer/modelGeometry';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id) || id < 0) {
    return NextResponse.json({ error: `invalid model id: ${params.id}` }, { status: 400 });
  }

  const cache = await getCache();
  const model = await cache.getDef(IndexType.MODELS, id);
  if (!model) {
    return NextResponse.json({ error: `model ${id} not found` }, { status: 404 });
  }

  return NextResponse.json(toFlatGeometry(model));
}

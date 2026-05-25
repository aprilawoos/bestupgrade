// === GET /api/model/[id] ===
// Returns the composed geometry of a single OSRS model id. Always wraps
// the single model in the same ComposedResponse shape used by the player
// endpoint so the client viewer has one code path.
//
// This endpoint has no NPC or item context to look up an animation, so
// `animations` is always {} and parts have no sourceModelKey — the model
// renders statically. Use /api/npc/[id] or /api/player/base for animated
// versions.

import { NextResponse } from 'next/server';
import { IndexType } from 'osrscachereader';
import { getCache } from '@/viewer/cache';
import { toSubGeometries, mergeParts } from '@/viewer/modelGeometry';
import { extractTexture, type TextureData } from '@/viewer/textureExtractor';

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

  const parts = mergeParts(toSubGeometries(model));

  const textures: Record<string, TextureData> = {};
  for (const p of parts) {
    if (typeof p.textureId !== 'number') continue;
    const tex = await extractTexture(cache, p.textureId);
    if (tex) textures[String(p.textureId)] = tex;
  }

  return NextResponse.json({ parts, textures, animations: {} });
}

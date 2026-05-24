// === GET /api/npc/[id] ===
// Returns the composed geometry of an NPC by id, wrapped in the same
// ComposedResponse shape as other endpoints. Currently uses only the
// NPC's first model — multi-model merging is a later enhancement.

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
    return NextResponse.json({ error: `invalid npc id: ${params.id}` }, { status: 400 });
  }

  const cache = await getCache();
  const npc = await cache.getNPC(id);
  if (!npc) {
    return NextResponse.json({ error: `npc ${id} not found` }, { status: 404 });
  }

  const modelIds: number[] = npc.models ?? [];
  if (modelIds.length === 0) {
    return NextResponse.json({ error: `npc ${id} has no models` }, { status: 404 });
  }

  const modelId = modelIds[0];
  const model = await cache.getDef(IndexType.MODELS, modelId);
  if (!model) {
    return NextResponse.json({ error: `model ${modelId} not found` }, { status: 404 });
  }

  const parts = mergeParts(toSubGeometries(model));

  const textures: Record<string, TextureData> = {};
  for (const p of parts) {
    if (typeof p.textureId !== 'number') continue;
    const tex = await extractTexture(cache, p.textureId);
    if (tex) textures[String(p.textureId)] = tex;
  }

  return NextResponse.json({ parts, textures });
}

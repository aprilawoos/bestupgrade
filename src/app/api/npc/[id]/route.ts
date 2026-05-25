// === GET /api/npc/[id] ===
// Returns the composed geometry of an NPC by id, wrapped in the same
// ComposedResponse shape as other endpoints. Currently uses only the
// NPC's first model — multi-model merging is a later enhancement.
//
// Phase 8: now also returns `animations` keyed by source-model id (string),
// using the NPC's `standingAnimation` sequence if > 0. The client plays it
// on a loop. NPCs without an idle (standingAnimation <= 0) just render static.

import { NextResponse } from 'next/server';
import { IndexType } from 'osrscachereader';
import { getCache } from '@/viewer/cache';
import { toSubGeometries, mergeParts } from '@/viewer/modelGeometry';
import { extractTexture, type TextureData } from '@/viewer/textureExtractor';
import { getAnimationData, type AnimationData } from '@/viewer/animationExtractor';

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

  // === Tag this model's parts with a sourceModelKey so the client knows
  // which animation track applies. Convention: "npc:<modelId>" for NPC
  // models, "player:<modelId>" for player models. Stable + unique.
  const modelKey = `npc:${modelId}`;
  const parts = mergeParts(toSubGeometries(model, undefined, undefined, modelKey));

  const textures: Record<string, TextureData> = {};
  for (const p of parts) {
    if (typeof p.textureId !== 'number') continue;
    const tex = await extractTexture(cache, p.textureId);
    if (tex) textures[String(p.textureId)] = tex;
  }

  // === Animation lookup ===
  // npc.standingAnimation: -1 or 0 means "no idle" (static NPC); positive
  // value is the SequenceDefinition id to play on loop.
  const animations: Record<string, AnimationData> = {};
  const standingAnim = npc.standingAnimation ?? -1;
  if (standingAnim > 0) {
    const data = await getAnimationData(cache, modelId, standingAnim);
    if (data) animations[modelKey] = data;
  }

  return NextResponse.json({ parts, textures, animations });
}

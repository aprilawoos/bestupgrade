// =============================================================================
// animationExtractor.ts — load a SequenceDefinition into per-vertex frames
// =============================================================================
//
// Wraps osrscachereader's `ModelLoader.loadAnimation`, which is the heavy
// lifter: it walks the SequenceDefinition's frame IDs, loads each frame's
// FramesDefinition + FramemapDefinition, applies the per-bone-group
// transform stack (translate / rotate / scale) on top of the model's base
// vertex positions, and returns one [x,y,z] tuple per vertex per frame.
//
// Output shape (AnimationData):
//   - frames: Float32Array,  stride = vertexCount * 3, length = vertexCount * 3 * numFrames
//   - vertexCount: number,   the original-model vertex count
//   - numFrames: number,     one entry per "playback step"
//   - frameDurations: number[], length = numFrames, units = OSRS ticks (1 tick = 20ms in client / 600ms in game — but for client-side anim playback it's 20ms-ish, see note below)
//
// **Coordinate frame**: `loadAnimation(invertZ=false)` so the per-frame
// output is `[rawX, -rawY, -rawZ]` — matches the static path in
// modelGeometry.ts (X-axis 180° rotation, weapon in correct hand).
//
// **Caching**: SequenceDefinition decode + per-frame transform stack is
// non-trivial. Key by `${modelId}:${animId}` in a module-level Map; the
// Next dev server keeps the module alive across requests so the cache
// outlives a single API call. Players generating ~5 animated models per
// loadout would otherwise pay the full decode every reroll.
// =============================================================================

import { ConfigType, IndexType } from 'osrscachereader';

export interface AnimationData {
  frames: number[];          // flat strided buffer; sent over JSON so plain array, not Float32Array
  vertexCount: number;
  numFrames: number;
  frameDurations: number[];  // length = numFrames, OSRS client ticks (~20ms each)
  animId: number;
  modelId: number;
}

// Module-level cache: key = `${modelId}:${animId}`.
// Lives as long as the Node process. Cleared on dev-server restart.
const animCache = new Map<string, AnimationData | null>();

// === Per-model animation loader (cache-by-id wrapper) ======================
//
// Loads the model from the cache by id, then delegates to
// getAnimationDataForModel. Caches successful (and failed) results by
// `${modelId}:${animId}` so repeat requests for the same NPC idle don't
// rerun loadAnimation.
//
// Returns null if:
//   - animId <= 0 (no animation)
//   - model can't be loaded or has no vertexGroups (not skinnable)
//   - the SequenceDefinition has no frames or fails to load
export async function getAnimationData(
  cache: any,
  modelId: number,
  animId: number,
): Promise<AnimationData | null> {
  if (!Number.isFinite(animId) || animId <= 0) return null;

  const cacheKey = `${modelId}:${animId}`;
  if (animCache.has(cacheKey)) return animCache.get(cacheKey) ?? null;

  const model = await cache.getDef(IndexType.MODELS, modelId).catch(() => null);
  if (!model) { animCache.set(cacheKey, null); return null; }

  const data = await getAnimationDataForModel(cache, model, animId, modelId);
  animCache.set(cacheKey, data);
  return data;
}

// === Per-model animation loader (works on a model instance) ================
//
// Use this for composite models that aren't in the cache (e.g. the merged
// player avatar). Doesn't cache by id — the caller is responsible for any
// caching (since composites are typically request-specific anyway).
//
// `idHint` is only used as a `modelId` field in the returned AnimationData
// for client-side debug/diagnostics; pass -1 if no meaningful id exists.
export async function getAnimationDataForModel(
  cache: any,
  model: any,
  animId: number,
  idHint: number = -1,
): Promise<AnimationData | null> {
  if (!Number.isFinite(animId) || animId <= 0) return null;
  if (!model) return null;
  if (!Array.isArray(model.vertexGroups) || model.vertexGroups.length === 0) {
    // No skinning info — the model can still be rendered statically but
    // can't be animated. Common for inanimate items (rings, etc.).
    return null;
  }

  // Verify the SequenceDefinition is loadable before invoking loadAnimation
  // (which throws on missing seq). Defer to loadAnimation for the heavy work.
  const seqFile = await cache
    .getFile(IndexType.CONFIGS, ConfigType.SEQUENCE, animId)
    .catch(() => null);
  const seq = seqFile?.def;
  if (!seq) return null;

  // Animaya animations are a separate path (matrix-based skeleton). For
  // phase 8 we only support the classic frame-list animation pathway —
  // animMayaID !== -1 indicates Animaya, which we skip for now.
  if (seq.animMayaID != null && seq.animMayaID !== -1) return null;
  if (!Array.isArray(seq.frameIDs) || seq.frameIDs.length === 0) return null;

  // === The actual heavy lift ===
  // loadAnimation(cache, animId, invertZ=false, compress=false)
  // Returns { vertexData: [frame][vertex] = [x,y,z], lengths: number[] }
  //
  // invertZ=false: keep the cache's raw Z. Combined with our static path's
  // X-axis 180° rotation (negate Y and Z post-extraction), the per-frame
  // [rawX, -rawY, -rawZ] output matches our static geometry exactly. The
  // alternative invertZ=true would put vertices in a mirrored frame and
  // weapons would end up in the wrong hand for animated frames.
  let anim: { vertexData: number[][][]; lengths: number[] };
  try {
    anim = await model.loadAnimation(cache, animId, /*invertZ=*/false, /*compress=*/false);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`animationExtractor: loadAnimation(idHint=${idHint},${animId}) threw`, e);
    return null;
  }

  if (!anim?.vertexData?.length) return null;

  const numFrames = anim.vertexData.length;
  const vertexCount = model.vertexCount;
  // Flat stride: [f0v0x,f0v0y,f0v0z, f0v1x,..., f1v0x,...]
  // Length: numFrames * vertexCount * 3
  const frames: number[] = new Array(numFrames * vertexCount * 3);
  for (let f = 0; f < numFrames; f += 1) {
    const frameVerts = anim.vertexData[f];
    const base = f * vertexCount * 3;
    for (let v = 0; v < vertexCount; v += 1) {
      const xyz = frameVerts[v];
      // Defensive: some animations may not touch every vertex; in that case
      // loadFrame uses the rest-pose value (already accounted for inside
      // ModelLoader.loadFrame), so we just trust the output.
      frames[base + v * 3 + 0] = xyz?.[0] ?? 0;
      frames[base + v * 3 + 1] = xyz?.[1] ?? 0;
      frames[base + v * 3 + 2] = xyz?.[2] ?? 0;
    }
  }

  // Frame durations: anim.lengths matches numFrames length. Units are OSRS
  // animation ticks. The client renders one tick per 20ms (50 FPS), though
  // real in-game pacing depends on `stretches` flag etc. — for an idle
  // loop, the simple tick-based playback at 20ms/tick is close enough.
  const frameDurations = Array.isArray(anim.lengths) && anim.lengths.length === numFrames
    ? [...anim.lengths]
    : new Array(numFrames).fill(1);

  return {
    frames,
    vertexCount,
    numFrames,
    frameDurations,
    animId,
    modelId: idHint,
  };
}

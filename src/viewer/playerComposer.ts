// =============================================================================
// playerComposer.ts — phases 3-8: kits + items + recolor + textures + animation
// =============================================================================
//
// Builds the player avatar by:
//   1. Picking default kits per body part (phase 3)
//   2. Layering items via wearPos1/2/3 slot rules (phase 4)
//   3. Applying per-slot recolors (phase 5)
//   4. Applying per-slot retextures (phase 6)
//   5. (phase 8) MERGING all per-slot models into one composite, then
//      animating that composite as a single skinned skeleton.
//
// Why merge before animating (phase 8): OSRS animation uses GLOBAL bone-
// group ids (e.g. id 5 = right shoulder). Each individual model only owns
// vertexGroups for the body parts it covers — the hands model has no
// shoulder vertices. Animating per-model means the hands' rotation-pivot
// computation for "rotate around shoulder" collapses to (0,0,0) because
// the hands' vertexGroups[5] is empty, so wrists rotate around the world
// origin and visually detach from the body. The OSRS client avoids this
// by `mergeWith()`-ing all equipment models into one composite before
// animating; we now do the same.
//
// Output shape (ComposedResponse):
//   { parts: SubGeometry[], textures: ..., animations: ... }
//
// Each item / kit can recolor (HSL find→replace) and retexture (textureId
// find→replace) the models it contributes. Both are non-destructive —
// recolors are applied to clones; the cached models are left untouched.
// =============================================================================

import { IndexType, ConfigType } from 'osrscachereader';
import type { SubGeometry, ColorPair } from './modelGeometry';
import { toSubGeometries, mergeParts } from './modelGeometry';
import { extractTexture, type TextureData } from './textureExtractor';
import { getAnimationDataForModel, type AnimationData } from './animationExtractor';

export type Gender = 'male' | 'female';

export interface ComposedResponse {
  parts: SubGeometry[];
  textures: Record<string, TextureData>; // keyed by textureId (string for JSON friendliness)
  animations: Record<string, AnimationData>; // keyed by sourceModelKey
}

// === Default player idle ===
// Sequence 808 is the canonical OSRS player default idle (unarmed slack-arms
// stance). Verified present in our cache rev. Used for EVERY player loadout
// regardless of equipped weapon — per-weapon idle resolution is deferred
// (see memory/project_phase8_deferred_per_weapon_idle.md).
//
// TODO(per-weapon): resolve via EnumID.WEAPON_STYLES (3908) → struct → param
// to get the equipped weapon's idle anim, fall back to 808 when missing.
const PLAYER_DEFAULT_IDLE_ANIM_ID = 808;

const MALE_BODY_PARTS = [0, 1, 2, 3, 4, 5, 6];
const FEMALE_BODY_PARTS = [7, 8, 9, 10, 11, 12, 13];

// KitType slot ordinals: 0 HEAD 1 CAPE 2 AMULET 3 WEAPON 4 TORSO 5 SHIELD
//                       6 ARMS 7 LEGS 8 HAIR    9 HANDS 10 BOOTS 11 JAW
const NUM_SLOTS = 12;
const BODYPART_TO_SLOT = [8, 11, 4, 6, 9, 7, 10]; // HAIR JAW TORSO ARMS HANDS LEGS BOOTS

interface RemapPairs {
  recolors: ColorPair[];
  retextures: ColorPair[];
}

interface KitDef {
  id: number;
  bodyPartId: number;
  nonSelectable?: boolean;
  models?: number[];
  recolorToFind?: number[];
  recolorToReplace?: number[];
  retextureToFind?: number[];
  retextureToReplace?: number[];
}

interface ItemDef {
  id: number;
  wearPos1?: number;
  wearPos2?: number;
  wearPos3?: number;
  maleModel0?: number;
  maleModel1?: number;
  maleModel2?: number;
  femaleModel0?: number;
  femaleModel1?: number;
  femaleModel2?: number;
  recolorToFind?: number[];
  recolorToReplace?: number[];
  retextureToFind?: number[];
  retextureToReplace?: number[];
}

type SlotEntry =
  | { kind: 'kit' | 'item'; modelIds: number[]; remap: RemapPairs }
  | null;

function extractPairs(findArr?: number[], replaceArr?: number[]): ColorPair[] {
  const finds = findArr ?? [];
  const replaces = replaceArr ?? [];
  const n = Math.min(finds.length, replaces.length);
  const out: ColorPair[] = [];
  for (let i = 0; i < n; i += 1) out.push({ find: finds[i], replace: replaces[i] });
  return out;
}

function extractRemap(def: KitDef | ItemDef): RemapPairs {
  return {
    recolors: extractPairs(def.recolorToFind, def.recolorToReplace),
    retextures: extractPairs(def.retextureToFind, def.retextureToReplace),
  };
}

// Convenience for the base-body endpoint — same composer, no items.
export async function composeBaseBody(cache: any, gender: Gender): Promise<ComposedResponse> {
  return composePlayer(cache, gender, []);
}

export async function composePlayer(
  cache: any,
  gender: Gender,
  itemIds: number[],
  kitOverrideIds: number[] = [],
): Promise<ComposedResponse> {
  // === Step 1: pick default kits per body part ===
  // Lowest cache ID wins for each bodyPartId among `nonSelectable === false`.
  const allKits: KitDef[] = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.IDENTKIT);
  const kitByPart = new Map<number, KitDef>();
  for (const kit of allKits) {
    if (!kit) continue;
    if (kit.nonSelectable) continue;
    if (typeof kit.bodyPartId !== 'number' || kit.bodyPartId < 0) continue;
    if (!kitByPart.has(kit.bodyPartId)) kitByPart.set(kit.bodyPartId, kit);
  }

  // === Step 1b: apply kit overrides ===
  // Each override is a kit id; we replace the default for its bodyPartId.
  // Same pattern as items: just pass IDs, the kit's own bodyPartId tells
  // the composer which slot it belongs in.
  for (const kitId of kitOverrideIds) {
    if (typeof kitId !== 'number' || kitId < 0) continue;
    const kit: KitDef | undefined = allKits[kitId];
    if (!kit) continue;
    if (typeof kit.bodyPartId !== 'number' || kit.bodyPartId < 0) continue;
    kitByPart.set(kit.bodyPartId, kit);
  }

  // === Step 2: seed the 12-slot equipment array with default kits ===
  const slots: SlotEntry[] = Array.from({ length: NUM_SLOTS }, () => null);
  const partIds = gender === 'male' ? MALE_BODY_PARTS : FEMALE_BODY_PARTS;
  for (const partId of partIds) {
    const kit = kitByPart.get(partId);
    if (!kit) continue;
    const slotIdx = BODYPART_TO_SLOT[partId % 7];
    const modelIds = (kit.models ?? []).filter((m): m is number => typeof m === 'number' && m >= 0);
    slots[slotIdx] = { kind: 'kit', modelIds, remap: extractRemap(kit) };
  }

  // === Step 3: apply items ===
  // Each item: place at wearPos1 (overwriting any kit), clear wearPos2 and
  // wearPos3 (their kits become hidden). Ring (wearPos1=13) and ammo
  // (wearPos1=14) are >= NUM_SLOTS; silently skipped — they're invisible.
  const items: ItemDef[] = await Promise.all(itemIds.map((id) => cache.getItem(id)));
  for (const item of items) {
    if (!item || typeof item.wearPos1 !== 'number') continue;
    if (item.wearPos1 < 0 || item.wearPos1 >= NUM_SLOTS) continue;

    const modelIds: number[] = [];
    const m0 = gender === 'male' ? item.maleModel0 : item.femaleModel0;
    const m1 = gender === 'male' ? item.maleModel1 : item.femaleModel1;
    const m2 = gender === 'male' ? item.maleModel2 : item.femaleModel2;
    if (typeof m0 === 'number' && m0 >= 0) modelIds.push(m0);
    if (typeof m1 === 'number' && m1 >= 0) modelIds.push(m1);
    if (typeof m2 === 'number' && m2 >= 0) modelIds.push(m2);

    slots[item.wearPos1] = { kind: 'item', modelIds, remap: extractRemap(item) };

    if (typeof item.wearPos2 === 'number' && item.wearPos2 >= 0 && item.wearPos2 < NUM_SLOTS) {
      slots[item.wearPos2] = null;
    }
    if (typeof item.wearPos3 === 'number' && item.wearPos3 >= 0 && item.wearPos3 < NUM_SLOTS) {
      slots[item.wearPos3] = null;
    }
  }

  // === Step 4: load all source models, clone them, apply per-slot recolors,
  // and merge into a single composite ModelDefinition ===
  //
  // Order matters for `mergeWith`: it concatenates vertex/face arrays in
  // sequence and offsets indices appropriately. The order we use here
  // (slot order) doesn't affect rendering or animation correctness — only
  // the order vertices appear in the final buffer.
  const sourceModels: Array<{ def: any; remap: RemapPairs }> = [];
  for (const slot of slots) {
    if (!slot) continue;
    const models = await Promise.all(
      slot.modelIds.map((id) => cache.getDef(IndexType.MODELS, id)),
    );
    for (const def of models) {
      if (def == null) continue;
      sourceModels.push({ def, remap: slot.remap });
    }
  }

  if (sourceModels.length === 0) {
    return { parts: [], textures: {}, animations: {} };
  }

  // Clone each cached model + apply recolors in place on the clone. The
  // cache returns shared instances, so without cloning the recolors would
  // bleed into subsequent requests. Clone the arrays mergeWith mutates
  // (vertex positions, face indices, vertexGroups) AND the arrays we
  // mutate during recolor (faceColors, faceTextures).
  const clones = sourceModels.map(({ def, remap }) => {
    const c = cloneModelForCompose(def);
    applyRecolorInPlace(c, remap.recolors);
    applyRetextureInPlace(c, remap.retextures);
    return c;
  });

  // Merge: pick the first clone as the running composite, fold the rest in.
  // `mergeWith` mutates `this` and returns it. Each call offsets the
  // otherModel's vertex indices and concatenates everything (including
  // vertexGroups — bone-id N gets vertices from both models, exactly what
  // the multi-model skinning needs).
  const composite = clones[0];
  for (let i = 1; i < clones.length; i += 1) {
    composite.mergeWith(clones[i]);
  }

  // === Step 5: extract sub-geometries from the composite ===
  // Single sourceModelKey for the whole avatar — animation is one track now.
  // Recolors/retextures already applied to the composite's faceColors /
  // faceTextures, so pass empty arrays here.
  const COMPOSITE_KEY = 'player:composite';
  const parts = mergeParts(toSubGeometries(composite, [], [], COMPOSITE_KEY));

  // === Step 6: extract textures for every referenced textureId ===
  const textureIds = new Set<number>();
  for (const p of parts) {
    if (typeof p.textureId === 'number') textureIds.add(p.textureId);
  }
  const textures: Record<string, TextureData> = {};
  for (const tid of textureIds) {
    const tex = await extractTexture(cache, tid);
    if (tex) textures[String(tid)] = tex;
  }

  // === Step 7: animate the composite ===
  // ONE animation track for the entire merged player. Bone-group transforms
  // now have access to every body part's vertices, so origins/rotations
  // line up across slots (hands stay attached to wrists, etc.).
  const animations: Record<string, AnimationData> = {};
  const animData = await getAnimationDataForModel(
    cache,
    composite,
    PLAYER_DEFAULT_IDLE_ANIM_ID,
    -1,
  );
  if (animData) animations[COMPOSITE_KEY] = animData;

  return { parts, textures, animations };
}

// === Composite helpers =====================================================
// Shallow-clone a ModelDefinition + deep-copy the arrays that the merge or
// recolor steps mutate. Preserves prototype so methods like `mergeWith` and
// `loadAnimation` remain callable on the clone.
function cloneModelForCompose(m: any): any {
  const c = Object.create(Object.getPrototypeOf(m));
  Object.assign(c, m);
  // Arrays mutated by applyRecolor / applyRetexture.
  if (m.faceColors) c.faceColors = [...m.faceColors];
  if (m.faceTextures) c.faceTextures = [...m.faceTextures];
  // Arrays mutated by mergeWith (it does `this.X = [...this.X, ...other.X]`,
  // so the first model's arrays are read-replaced, not mutated — but we
  // still clone to avoid edge cases like later faceColor recompute touching
  // the original).
  if (m.vertexPositionsX) c.vertexPositionsX = [...m.vertexPositionsX];
  if (m.vertexPositionsY) c.vertexPositionsY = [...m.vertexPositionsY];
  if (m.vertexPositionsZ) c.vertexPositionsZ = [...m.vertexPositionsZ];
  if (m.faceVertexIndices1) c.faceVertexIndices1 = [...m.faceVertexIndices1];
  if (m.faceVertexIndices2) c.faceVertexIndices2 = [...m.faceVertexIndices2];
  if (m.faceVertexIndices3) c.faceVertexIndices3 = [...m.faceVertexIndices3];
  if (m.faceRenderTypes) c.faceRenderTypes = [...m.faceRenderTypes];
  if (m.faceTextureUCoordinates) {
    c.faceTextureUCoordinates = m.faceTextureUCoordinates.map((arr: number[]) =>
      arr ? [...arr] : arr,
    );
  }
  if (m.faceTextureVCoordinates) {
    c.faceTextureVCoordinates = m.faceTextureVCoordinates.map((arr: number[]) =>
      arr ? [...arr] : arr,
    );
  }
  // vertexGroups: 2-D array of bone-group → vertex-index lists. mergeWith
  // builds a new outer array but uses Array.concat on the inner arrays —
  // safer to clone deep so we don't share references with the cache.
  if (m.vertexGroups) {
    c.vertexGroups = m.vertexGroups.map((g: number[]) => (g ? [...g] : g));
  }
  return c;
}

function applyRecolorInPlace(m: any, recolors: ColorPair[]): void {
  if (!recolors.length || !m.faceColors) return;
  const map = new Map<number, number>();
  for (const { find, replace } of recolors) map.set(find, replace);
  for (let i = 0; i < m.faceColors.length; i += 1) {
    const r = map.get(m.faceColors[i]);
    if (r != null) m.faceColors[i] = r;
  }
}

function applyRetextureInPlace(m: any, retextures: ColorPair[]): void {
  if (!retextures.length || !m.faceTextures) return;
  const map = new Map<number, number>();
  for (const { find, replace } of retextures) map.set(find, replace);
  for (let i = 0; i < m.faceTextures.length; i += 1) {
    const r = map.get(m.faceTextures[i]);
    if (r != null) m.faceTextures[i] = r;
  }
}

// =============================================================================
// playerComposer.ts — phases 3 + 4 + 5 + 6: kits + items + recolor + textures
// =============================================================================
//
// Builds the player avatar by:
//   1. Picking default kits per body part (phase 3)
//   2. Layering items via wearPos1/2/3 slot rules (phase 4)
//   3. Applying per-slot recolors (phase 5)
//   4. Applying per-slot retextures (phase 6)
//
// Output shape (ComposedResponse):
//   { parts: SubGeometry[], textures: Record<textureId, TextureData> }
//
// Each item / kit can recolor (HSL find→replace) and retexture (textureId
// find→replace) the models it contributes. Both are non-destructive — the
// cached model is left untouched.
// =============================================================================

import { IndexType, ConfigType } from 'osrscachereader';
import type { SubGeometry, ColorPair } from './modelGeometry';
import { toSubGeometries, mergeParts } from './modelGeometry';
import { extractTexture, type TextureData } from './textureExtractor';

export type Gender = 'male' | 'female';

export interface ComposedResponse {
  parts: SubGeometry[];
  textures: Record<string, TextureData>; // keyed by textureId (string for JSON friendliness)
}

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
): Promise<ComposedResponse> {
  // === Step 1: pick default kits per body part ===
  const allKits: KitDef[] = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.IDENTKIT);
  const kitByPart = new Map<number, KitDef>();
  for (const kit of allKits) {
    if (!kit) continue;
    if (kit.nonSelectable) continue;
    if (typeof kit.bodyPartId !== 'number' || kit.bodyPartId < 0) continue;
    if (!kitByPart.has(kit.bodyPartId)) kitByPart.set(kit.bodyPartId, kit);
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

  // === Step 4: load each model, extract sub-geometries with the slot's
  // recolors/retextures, accumulate parts ===
  const allParts: SubGeometry[] = [];
  for (const slot of slots) {
    if (!slot) continue;
    const models = await Promise.all(
      slot.modelIds.map((id) => cache.getDef(IndexType.MODELS, id)),
    );
    for (const m of models) {
      if (m == null) continue;
      const parts = toSubGeometries(m, slot.remap.recolors, slot.remap.retextures);
      for (const p of parts) allParts.push(p);
    }
  }

  // === Step 5: merge parts by texture id (one render call per material) ===
  const mergedParts = mergeParts(allParts);

  // === Step 6: extract textures for every referenced textureId ===
  const textureIds = new Set<number>();
  for (const p of mergedParts) {
    if (typeof p.textureId === 'number') textureIds.add(p.textureId);
  }
  const textures: Record<string, TextureData> = {};
  for (const tid of textureIds) {
    const tex = await extractTexture(cache, tid);
    if (tex) textures[String(tid)] = tex;
  }

  return { parts: mergedParts, textures };
}

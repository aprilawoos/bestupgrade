// =============================================================================
// weaponIdleAnims.ts — equipped weapon → idle SequenceDefinition id
// =============================================================================
//
// === Why this exists ===
// The OSRS engine sets each player's idle pose animation SERVER-SIDE, per
// the equipped weapon — it's pushed to the client via the player-update
// packet. There is no offline `ItemDefinition → idle anim` field in the
// cache (we verified this by probing item params on 10 representative
// weapons; the only populated keys are the equipment stat block, not anim
// IDs). RuneLite has no offline resolver either — its `Actor.getIdlePose-
// Animation()` is read-only.
//
// To render the correct idle pose offline, we need a hand-curated mapping.
// We get one for free from the geheur/weapon-animation-replacer RuneLite
// plugin (BSD-2 licensed), which is purpose-built for swapping weapon
// animations and maintains exactly this table. See
//   vendor/weapon-animation-replacer/README.md
// for vendor details, commit pin, and license.
//
// === Data shape ===
// data.json (from the plugin):
//   - `poseanims: Record<setName, itemId[]>` — set name → item ids that use it
//   - `animationSets: { name, animations: number[] }[]` — set name → 19 anim
//     IDs indexed by the plugin's AnimationType enum. We care only about
//     index 0 (STAND / idle).
//
// === Resolution ===
// resolveIdleAnimId(itemId) walks: itemId → set name → animations[0].
// Returns PLAYER_DEFAULT_IDLE_ANIM_ID (808 = HUMAN_READY, the unarmed
// idle) for any item not in the plugin's table — that's what a live
// OSRS server does for unmapped weapons too.
// =============================================================================

import rawData from '../../vendor/weapon-animation-replacer/data.json';

// === Default fallback ===
// Sequence 808 (HUMAN_READY) — the canonical OSRS player default idle
// (unarmed slack-arms pose). Used when the equipped weapon isn't in the
// vendored table.
export const PLAYER_DEFAULT_IDLE_ANIM_ID = 808;

// === AnimationType ordinals (from weapon-animation-replacer's Swap.java) ===
// We only consume STAND for now; the rest are here so future code (walk,
// attack, defend animations) can index into the same `animations` array
// without re-deriving the ordering. If you add new types, append — never
// reorder — to match the plugin's data layout.
export const ANIM_INDEX = {
  STAND: 0,
  WALK: 1,
  RUN: 2,
  WALK_BACKWARD: 3,
  SHUFFLE_LEFT: 4,
  SHUFFLE_RIGHT: 5,
  ROTATE: 6,
  ATTACK_STAB: 7,
  ATTACK_SLASH: 8,
  ATTACK_CRUSH: 9,
  ATTACK_SPEC: 10,
  DEFEND: 11,
  // 12..18 reserved (ATTACK_SLASH2 / CRUSH2 / ATTACK / etc.) — see Swap.java
} as const;

interface AnimationSet {
  name: string;
  animations: number[];
  doNotReplace?: boolean;
  custom?: boolean;
}

interface PluginData {
  version: number;
  poseanims: Record<string, number[]>;
  animationSets: AnimationSet[];
  // Other fields (slotOverrides, projectiles, descriptions, etc.) are in
  // the vendored file but not consumed yet — see README.md.
}

const data = rawData as unknown as PluginData;

// === Build lookups once at module load ===
// itemId → set name (reverse of poseanims)
const itemToSetName = new Map<number, string>();
for (const [setName, itemIds] of Object.entries(data.poseanims)) {
  for (const id of itemIds) itemToSetName.set(id, setName);
}

// set name → STAND anim id (animations[0]). Skip sets with no STAND entry
// or a sentinel -1; those don't override the default.
const setNameToIdleAnim = new Map<string, number>();
for (const set of data.animationSets) {
  const stand = set.animations?.[ANIM_INDEX.STAND];
  if (typeof stand === 'number' && stand > 0) {
    setNameToIdleAnim.set(set.name, stand);
  }
}

// === Public resolver ===
/**
 * Look up the idle pose SequenceDefinition id for an equipped weapon.
 * Returns the plugin's curated answer if known, otherwise the default
 * unarmed idle (808). Pass null/undefined for "no weapon equipped".
 */
export function resolveIdleAnimId(itemId: number | null | undefined): number {
  if (itemId == null) return PLAYER_DEFAULT_IDLE_ANIM_ID;
  const setName = itemToSetName.get(itemId);
  if (!setName) return PLAYER_DEFAULT_IDLE_ANIM_ID;
  return setNameToIdleAnim.get(setName) ?? PLAYER_DEFAULT_IDLE_ANIM_ID;
}

// ============================================================================
// Misc-pool access helpers — parallel to src/lib/bossAccess.ts.
//
// Given a player's progression (skills + quests) and a set of misc sources
// the player has access to (typically the user-curated "Acquired" set),
// return the subset of misc-drop items they can:
//   1. ACCESS the source for (canAccessSource — quest + slayer + skill gates).
//   2. WIELD the dropped item (requirements + questReqs).
//   3. ASSEMBLE the final form when components are needed
//      (prerequisiteDrops + buildRequirements). Components can come from
//      EITHER the misc or boss pool — resolution goes through the shared
//      cross-pool resolver in src/lib/itemSourceIndex.ts.
//
// Skill storage is long-form (attack/strength/.../slayer/...) + the
// `combatTotal` meta-key honoured by vendorAccess.
// ============================================================================

import type { EquipmentPiece } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import { miscDrops, MiscDropItem, MiscSourceAccess } from '@/upgrade/lib/miscDrops';
import {
  Progression,
  buildCombinedItemSourceIndex,
  isItemUnlocked,
} from '@/upgrade/lib/itemSourceIndex';

/** Alias kept for ergonomic symmetry with BossProgression. */
export type MiscProgression = Progression;

function skillLevel(skills: Record<string, number>, key: string): number {
  return skills[key] ?? 1;
}

// =====
// Source-level access check — used by sourcesAccessibleByProgression and
// any caller that wants to pre-filter the misc list. Once a source is in
// the user's "acquired" set, the pool builder trusts that set as the
// access decision (and doesn't re-call this).
//
// `combatTotal` is honoured here using the same Warriors' Guild rule as
// vendorAccess: pass either combatTotal sum OR 99 in attack/strength alone.
// =====
export function canAccessSource(
  progression: MiscProgression,
  sourceName: string,
  access: MiscSourceAccess,
): boolean {
  for (const q of access.questsCompleted) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of access.questsStarted) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  if (access.slayerLevel !== null && skillLevel(progression.skills, 'slayer') < access.slayerLevel) return false;
  if (access.onSlayerTask && !progression.isOnTaskFor(sourceName)) return false;
  for (const [k, lvl] of Object.entries(access.skills ?? {})) {
    if (k === 'combatTotal') {
      const sum = skillLevel(progression.skills, 'attack') + skillLevel(progression.skills, 'strength');
      if (sum < lvl && skillLevel(progression.skills, 'attack') < 99 && skillLevel(progression.skills, 'strength') < 99) {
        return false;
      }
      continue;
    }
    if (skillLevel(progression.skills, k) < (lvl as number)) return false;
  }
  return true;
}

// =====
// Per-drop wield check (used by callers that want a quick wield-only test
// without going through the full pool resolver).
// =====
export function canWieldDrop(progression: MiscProgression, drop: MiscDropItem): boolean {
  for (const [k, lvl] of Object.entries(drop.requirements)) {
    if (k === 'combatTotal') {
      const sum = skillLevel(progression.skills, 'attack') + skillLevel(progression.skills, 'strength');
      if (sum < lvl) return false;
      continue;
    }
    if (skillLevel(progression.skills, k) < lvl) return false;
  }
  for (const q of drop.questReqs.completed) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of drop.questReqs.started) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  return true;
}

// =====
// Top-level pool builder
// =====

/**
 * Given a player's progression and the boss + misc source sets they can
 * access, returns the flat EquipmentPiece pool of every MISC drop the
 * player can both unlock and wield. Cross-pool prereqs resolve through
 * the shared resolver — e.g. NMZ Berserker ring (i) requires the base
 * Berserker ring from Dagannoth Rex; Bonecrusher necklace's salve-amulet
 * chain reaches into Haunted Mine's misc-pool quest reward.
 *
 * `accessibleBossSet` is required for any drop whose prereq lives in the
 * boss pool. Pass an empty set to disable cross-pool resolution.
 */
export function getPlayerMiscDropPool(
  progression: MiscProgression,
  accessibleMiscSet: ReadonlySet<string>,
  accessibleBossSet: ReadonlySet<string> = new Set(),
): EquipmentPiece[] {
  const byId = new Map(availableEquipment.map((e) => [e.id, e]));
  const index = buildCombinedItemSourceIndex();
  const memo = new Map<string, boolean>();
  const seen = new Set<number>();
  const out: EquipmentPiece[] = [];

  for (const src of miscDrops) {
    if (!accessibleMiscSet.has(src.source)) continue;
    for (const drop of src.drops) {
      if (seen.has(drop.itemId)) continue;
      if (!isItemUnlocked(progression, drop.name, accessibleBossSet, accessibleMiscSet, index, memo)) continue;
      const piece = byId.get(drop.itemId);
      if (!piece) continue;
      out.push(piece);
      seen.add(drop.itemId);
    }
  }
  return out;
}

/**
 * Convenience: filter miscDrops to the set of sources the player can
 * access (ignoring item-side unlocks). Caller can pass the result into
 * getPlayerMiscDropPool.
 */
export function sourcesAccessibleByProgression(progression: MiscProgression): Set<string> {
  const out = new Set<string>();
  for (const src of miscDrops) {
    if (canAccessSource(progression, src.source, src.access)) out.add(src.source);
  }
  return out;
}

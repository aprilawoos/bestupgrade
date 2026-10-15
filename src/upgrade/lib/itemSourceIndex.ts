// ============================================================================
// Cross-pool item-source resolver.
//
// Both the boss-drop pool (src/lib/bossDrops.ts) and the misc-drop pool
// (src/lib/miscDrops.ts) can list components in their prerequisiteDrops
// graphs that come from the OTHER pool (e.g. NMZ-imbued Berserker ring (i)
// requires a Berserker ring from Dagannoth Rex; Bonecrusher necklace from
// Hydra requires a Dragonbone necklace from Vorkath; Salve amulet(ei)
// requires the Lair-of-Tarn-Razorlor (e) form which itself requires the
// Haunted Mine base form).
//
// This module:
//   1. Builds a unified item-name -> source[] index across both pools.
//   2. Provides a single `isItemUnlocked` walker that resolves a drop's
//      prerequisiteDrops transitively against the combined index, honouring
//      each source's access reqs + each drop's wield + build reqs.
//   3. Falls back to "externally satisfied" for items in neither pool
//      (clue-scroll-only items, raw skilling outputs, etc.) — same
//      behaviour as the legacy bossAccess.isDropUnlocked.
//
// Cycle safety: memoised by item key; if a cycle is encountered (shouldn't
// happen in OSRS combine recipes, but defensive) the in-flight entry is
// treated as unsatisfied.
// ============================================================================

import { bossDrops, BossDropEntry, BossDropItem } from '@/upgrade/lib/bossDrops';
import { miscDrops, MiscDropEntry, MiscDropItem } from '@/upgrade/lib/miscDrops';
import type { AllSkills } from '@/upgrade/lib/vendorAccess';

// =====
// Shared progression shape — bossAccess.BossProgression aliases this so
// existing callers don't need to change.
// =====
export interface Progression {
  /** Long-form skill dict (attack/strength/.../slayer/...). Same shape as
   *  the hiscores response, vendorAccess, questRequirements. */
  skills: AllSkills;
  questsStarted: ReadonlySet<string>;
  questsCompleted: ReadonlySet<string>;
  /** Per-source slayer-task callback. Used for `onSlayerTask` gating on
   *  boss-pool entries (Thermy, Smoke Devils, etc.) and for any
   *  task-locked misc slayer monsters. */
  isOnTaskFor: (sourceName: string) => boolean;
}

// =====
// Unified source reference
// =====
export type ItemSourceRef =
  | { type: 'boss'; sourceName: string; entry: BossDropEntry; drop: BossDropItem }
  | { type: 'misc'; sourceName: string; entry: MiscDropEntry; drop: MiscDropItem };

/**
 * Build a combined item-name -> source[] index across both pools. Multiple
 * sources per item is normal — e.g. Mystic gloves drop from several slayer
 * monsters; Berserker ring (i) can be imbued at both NMZ and Soul Wars.
 */
export function buildCombinedItemSourceIndex(): Map<string, ItemSourceRef[]> {
  const out = new Map<string, ItemSourceRef[]>();
  for (const entry of bossDrops) {
    for (const drop of entry.drops) {
      const list = out.get(drop.name) ?? [];
      list.push({ type: 'boss', sourceName: entry.boss, entry, drop });
      out.set(drop.name, list);
    }
  }
  for (const entry of miscDrops) {
    for (const drop of entry.drops) {
      const list = out.get(drop.name) ?? [];
      list.push({ type: 'misc', sourceName: entry.source, entry, drop });
      out.set(drop.name, list);
    }
  }
  return out;
}

// =====
// Shared skill / quest predicates
// =====
function skillLevel(skills: AllSkills, key: string): number {
  return skills[key] ?? 1;
}

function meetsSkillReqs(progression: Progression, reqs: Record<string, number>): boolean {
  for (const [k, lvl] of Object.entries(reqs)) {
    if (k === 'combatTotal') {
      const sum = skillLevel(progression.skills, 'attack') + skillLevel(progression.skills, 'strength');
      if (sum < lvl && skillLevel(progression.skills, 'attack') < 99 && skillLevel(progression.skills, 'strength') < 99) {
        return false;
      }
      continue;
    }
    if (skillLevel(progression.skills, k) < lvl) return false;
  }
  return true;
}

function meetsQuestReqs(
  progression: Progression,
  reqs: { completed: string[]; started: string[] },
): boolean {
  for (const q of reqs.completed) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of reqs.started) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  return true;
}

// =====
// Source-side access checks
// =====
function isBossSourceAccessible(
  progression: Progression,
  entry: BossDropEntry,
  accessibleBossSet: ReadonlySet<string>,
): boolean {
  if (!accessibleBossSet.has(entry.boss)) return false;
  // accessibleBossSet is the caller's authority on which bosses are "killed";
  // we trust it and don't re-check bossAccess here. (bossAccess gate-checking
  // happens via bossesAccessibleByProgression at the caller's side.)
  return true;
}

function isMiscSourceAccessible(
  progression: Progression,
  entry: MiscDropEntry,
  accessibleMiscSet: ReadonlySet<string>,
): boolean {
  if (!accessibleMiscSet.has(entry.source)) return false;
  return true;
}

// =====
// Per-drop wield + assemble checks (boss + misc share the same shape, but
// nominally typed differently — switch on union)
// =====
function canWieldBossDrop(progression: Progression, drop: BossDropItem): boolean {
  if (!meetsSkillReqs(progression, drop.requirements)) return false;
  if (!meetsQuestReqs(progression, drop.questReqs)) return false;
  return true;
}

function canWieldMiscDrop(progression: Progression, drop: MiscDropItem): boolean {
  if (!meetsSkillReqs(progression, drop.requirements)) return false;
  if (!meetsQuestReqs(progression, drop.questReqs)) return false;
  return true;
}

function meetsBuildReqs(
  progression: Progression,
  build: { skills: Record<string, number>; questsCompleted: string[]; questsStarted: string[] },
): boolean {
  if (!meetsSkillReqs(progression, build.skills)) return false;
  for (const q of build.questsCompleted) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of build.questsStarted) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  return true;
}

// =====
// Unified prerequisite resolver
// =====

/**
 * Returns true iff the player can both source AND build the item under
 * this specific source reference. Walks prerequisiteDrops transitively.
 *
 * Memoised by `${type}|${sourceName}|${itemName}|${version}` to avoid
 * re-walking shared sub-graphs (godsword shards, ring imbues, etc.).
 */
function isSourceRefUnlocked(
  progression: Progression,
  ref: ItemSourceRef,
  accessibleBossSet: ReadonlySet<string>,
  accessibleMiscSet: ReadonlySet<string>,
  index: Map<string, ItemSourceRef[]>,
  memo: Map<string, boolean>,
): boolean {
  const key = `${ref.type}|${ref.sourceName}|${ref.drop.name}|${ref.drop.version}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  // Cycle guard: assume false in-flight.
  memo.set(key, false);

  if (ref.type === 'boss') {
    if (!isBossSourceAccessible(progression, ref.entry, accessibleBossSet)) return false;
    if (!canWieldBossDrop(progression, ref.drop)) return false;
    if (!meetsBuildReqs(progression, ref.drop.buildRequirements)) return false;
    for (const pre of ref.drop.prerequisiteDrops) {
      if (!isItemUnlocked(progression, pre.item, accessibleBossSet, accessibleMiscSet, index, memo)) {
        return false;
      }
    }
  } else {
    if (!isMiscSourceAccessible(progression, ref.entry, accessibleMiscSet)) return false;
    if (!canWieldMiscDrop(progression, ref.drop)) return false;
    if (!meetsBuildReqs(progression, ref.drop.buildRequirements)) return false;
    for (const pre of ref.drop.prerequisiteDrops) {
      if (!isItemUnlocked(progression, pre.item, accessibleBossSet, accessibleMiscSet, index, memo)) {
        return false;
      }
    }
  }

  memo.set(key, true);
  return true;
}

/**
 * Returns true iff at least one source for `itemName` is accessible AND
 * its drop is wieldable + all transitive prerequisites resolve. Items
 * with no source in either pool are treated as externally satisfied
 * (clue scrolls, skilling outputs, etc.).
 */
export function isItemUnlocked(
  progression: Progression,
  itemName: string,
  accessibleBossSet: ReadonlySet<string>,
  accessibleMiscSet: ReadonlySet<string>,
  index: Map<string, ItemSourceRef[]> = buildCombinedItemSourceIndex(),
  memo: Map<string, boolean> = new Map(),
): boolean {
  const sources = index.get(itemName);
  if (!sources || sources.length === 0) {
    // Not produced by any catalogued source — externally sourced
    // (clue-scroll-only, skilling output, vendor-only, etc.). Assumed
    // satisfied so the resolver doesn't false-negative on unknowns.
    return true;
  }
  for (const ref of sources) {
    if (isSourceRefUnlocked(progression, ref, accessibleBossSet, accessibleMiscSet, index, memo)) {
      return true;
    }
  }
  return false;
}

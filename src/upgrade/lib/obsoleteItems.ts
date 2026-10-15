// ============================================================================
// Obsolete items — gear that is never the best option at any point on the
// path from "only what's always available" to "everything obtainable".
//
// Progression model (the ASSUMPTIONS are a parameter — MAX_ACCOUNT is the
// starting point; expanding backwards means passing earlier states):
//   - ALWAYS AVAILABLE (the base table): every shop the state can access,
//     plus every drop of the bosses and misc sources listed as always
//     available (defaults: no bosses; accessible quest rewards).
//   - ONE AT A TIME: every other boss / misc drop. Drops arrive individually,
//     so each competes only with the always-available pool plus the
//     components it's built from (prerequisiteDrops, transitively) — its most
//     favourable moment; any later acquisition only adds competition.
//   - BATCH: crafted sources (Smithing / Fletching / Crafting). Crafting is a
//     choice, not a drop: an item obtainable only by crafting also competes
//     with everything else its crafting source makes.
//
// An item is OBSOLETE iff, under every attack type it can contribute to
// (itemDominance.keysForItem), something in its competitor set dominates it
// (itemDominance.dominates — rules derived from the calc engine).
//
// Growing the base table (moving a boss or source from one-at-a-time into
// always available) only ever ENLARGES each item's competitor set, so the
// obsolete set can only grow: nothing obsolete comes back. Bosses can be
// added to the base table one by one and earlier verdicts stay valid.
//
// Safety: dominance is transitive and every dominator is always available,
// one of X's own components, or in X's crafting batch — all present whenever
// X is. So removing obsolete items from a pool built with the SAME source
// sets can't change the brute-force sim's result. /crabsim relies on this.
// ============================================================================

import type { EquipmentPiece } from '@/types/Player';
import { AllSkills, allVendorQuestNames, getPlayerAccessiblePool } from '@/upgrade/lib/vendorAccess';
import { getPlayerBossDropPool } from '@/upgrade/lib/bossAccess';
import { getPlayerMiscDropPool } from '@/upgrade/lib/miscAccess';
import { BOSS_REQS, allBossQuestNames, killableBosses } from '@/upgrade/lib/bossRequirements';
import { MISC_REQS, accessibleMiscSources, allMiscQuestNames } from '@/upgrade/lib/miscRequirements';
import { bossDrops } from '@/upgrade/lib/bossDrops';
import { miscDrops } from '@/upgrade/lib/miscDrops';
import type { Progression } from '@/upgrade/lib/itemSourceIndex';
import {
  DominanceContext,
  DominanceKey,
  canonical,
  dominates,
  isLauncher,
  keysForItem,
} from '@/upgrade/lib/itemDominance';

// =====
// Assumptions
// =====

export interface ProgressionAssumptions {
  /** Long-form skill levels (attack/strength/.../slayer/...). */
  skills: AllSkills;
  questsStarted: ReadonlySet<string>;
  questsCompleted: ReadonlySet<string>;
  questPoints: number;
  /** Bosses whose drops are all in the base table (already obtained).
   *  Default: none. */
  alwaysAvailableBosses?: ReadonlySet<string>;
  /** Misc sources whose items are always on hand. Default: every quest-reward
   *  source accessible under these assumptions. */
  alwaysAvailableMiscSources?: ReadonlySet<string>;
  /** Bosses whose drops arrive one at a time. Default: every boss killable
   *  under these assumptions that isn't already always available. */
  obtainableBosses?: ReadonlySet<string>;
  /** Non-always-available misc sources whose items are obtainable. Default:
   *  every other accessible misc source. */
  obtainableMiscSources?: ReadonlySet<string>;
}

/** Every OSRS skill the hiscores track (long-form keys). */
export const ALL_OSRS_SKILLS = [
  'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
  'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking',
  'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving',
  'slayer', 'farming', 'runecraft', 'hunter', 'construction',
] as const;

/** Every quest / unlock name referenced by the shop, boss and misc data. */
export function allReferencedQuestNames(): Set<string> {
  const v = allVendorQuestNames();
  const b = allBossQuestNames();
  const m = allMiscQuestNames();
  return new Set([...v.started, ...v.completed, ...b.started, ...b.completed, ...m.started, ...m.completed]);
}

/** Every skill 99, every referenced quest done, unlimited quest points. */
export const MAX_ACCOUNT: ProgressionAssumptions = (() => {
  const skills: AllSkills = {};
  for (const s of ALL_OSRS_SKILLS) skills[s] = 99;
  const quests = allReferencedQuestNames();
  return {
    skills,
    questsStarted: quests,
    questsCompleted: quests,
    questPoints: Number.POSITIVE_INFINITY,
  };
})();

// =====
// Result types
// =====

export const ALWAYS_AVAILABLE = 'always available';

export type ItemVerdict =
  | {
    item: EquipmentPiece;
    obsolete: false;
    /** ALWAYS_AVAILABLE, or the source(s) whose drop first makes it useful. */
    firstUseful: string;
  }
  | {
    item: EquipmentPiece;
    obsolete: true;
    /** For each attack type the item could contribute to, an item present
     *  whenever it is that dominates it there. Different types can name
     *  different items. Empty when the sim never evaluates the item at all
     *  (a weapon no sim style accepts). */
    beatenBy: Partial<Record<DominanceKey, EquipmentPiece>>;
  };

export interface ObsolescenceResult {
  /** One verdict per item obtainable under the assumptions, keyed by id. */
  verdicts: Map<number, ItemVerdict>;
  obsoleteIds: Set<number>;
}

// =====
// Helpers
// =====

function mergeById(...pools: EquipmentPiece[][]): EquipmentPiece[] {
  const seen = new Set<number>();
  const out: EquipmentPiece[] = [];
  for (const pool of pools) {
    for (const p of pool) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

interface SourceRef {
  kind: string; // 'boss' or a MiscSourceKind
  name: string;
}

// =====
// Public entry point
// =====

export function findObsoleteItems(a: ProgressionAssumptions): ObsolescenceResult {
  const progression: Progression = {
    skills: a.skills,
    questsStarted: a.questsStarted,
    questsCompleted: a.questsCompleted,
    // Task-gated sources count as obtainable — the player can get the task.
    isOnTaskFor: () => true,
  };

  // ----- Which sources count -----
  const accessibleMisc = accessibleMiscSources(Object.keys(MISC_REQS), a.skills, a.questsCompleted, a.questsStarted);
  const alwaysMisc = a.alwaysAvailableMiscSources
    ?? new Set(accessibleMisc.filter((s) => MISC_REQS[s]?.kind === 'quest_reward'));
  const otherMisc = a.obtainableMiscSources
    ?? new Set(accessibleMisc.filter((s) => !alwaysMisc.has(s)));
  const alwaysBosses = a.alwaysAvailableBosses ?? new Set<string>();
  const otherBosses = a.obtainableBosses
    ?? new Set(killableBosses(Object.keys(BOSS_REQS), a.skills, a.questsCompleted, a.questsStarted)
      .filter((b) => !alwaysBosses.has(b)));
  const bosses = new Set([...alwaysBosses, ...otherBosses]);
  const allMisc = new Set([...alwaysMisc, ...otherMisc]);

  // ----- Pools: always-available (base table), and everything obtainable -----
  // Base-table drops may need components from each other (cross-pool
  // prerequisites), so both builders get both base-table source sets.
  const vendor = getPlayerAccessiblePool({
    skills: a.skills,
    questPoints: a.questPoints,
    questsStarted: a.questsStarted,
    questsCompleted: a.questsCompleted,
  });
  const baselinePool = mergeById(
    vendor,
    getPlayerBossDropPool(progression, alwaysBosses, alwaysMisc),
    getPlayerMiscDropPool(progression, alwaysMisc, alwaysBosses),
  );
  const fullPool = mergeById(
    vendor,
    getPlayerBossDropPool(progression, bosses, allMisc),
    getPlayerMiscDropPool(progression, allMisc, bosses),
  );
  const baselineIds = new Set(baselinePool.map((p) => p.id));

  // ----- Sources per item id (labels + crafted batches) -----
  const sourcesById = new Map<number, SourceRef[]>();
  const addSource = (id: number, s: SourceRef) => {
    const list = sourcesById.get(id) ?? [];
    list.push(s);
    sourcesById.set(id, list);
  };
  for (const e of bossDrops) {
    if (!bosses.has(e.boss)) continue;
    for (const d of e.drops) addSource(d.itemId, { kind: 'boss', name: e.boss });
  }
  for (const e of miscDrops) {
    if (!allMisc.has(e.source)) continue;
    for (const d of e.drops) addSource(d.itemId, { kind: e.kind, name: e.source });
  }

  const craftedBatch = new Map<string, EquipmentPiece[]>();
  for (const p of fullPool) {
    for (const s of sourcesById.get(p.id) ?? []) {
      if (s.kind !== 'crafted') continue;
      const list = craftedBatch.get(s.name) ?? [];
      list.push(p);
      craftedBatch.set(s.name, list);
    }
  }

  // ----- Components: prerequisiteDrops by item name, transitively -----
  const prereqNames = new Map<string, string[]>();
  for (const e of bossDrops) for (const d of e.drops) {
    prereqNames.set(d.name, [...(prereqNames.get(d.name) ?? []), ...d.prerequisiteDrops.map((x) => x.item)]);
  }
  for (const e of miscDrops) for (const d of e.drops) {
    prereqNames.set(d.name, [...(prereqNames.get(d.name) ?? []), ...d.prerequisiteDrops.map((x) => x.item)]);
  }
  const presentByName = new Map<string, EquipmentPiece[]>();
  for (const p of fullPool) presentByName.set(p.name, [...(presentByName.get(p.name) ?? []), p]);
  const componentsOf = (name: string): EquipmentPiece[] => {
    const out: EquipmentPiece[] = [];
    const seen = new Set<string>([name]);
    const queue = [...(prereqNames.get(name) ?? [])];
    while (queue.length > 0) {
      const n = queue.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(...(presentByName.get(n) ?? []));
      queue.push(...(prereqNames.get(n) ?? []));
    }
    return out;
  };

  // ----- Competitor set per item -----
  const competitorsFor = (p: EquipmentPiece): EquipmentPiece[] => {
    if (baselineIds.has(p.id)) return baselinePool;
    const sources = sourcesById.get(p.id) ?? [];
    const craftedOnly = sources.length > 0 && sources.every((s) => s.kind === 'crafted');
    const batch = craftedOnly ? sources.flatMap((s) => craftedBatch.get(s.name) ?? []) : [];
    return mergeById(baselinePool, componentsOf(p.name), batch, [p]);
  };

  const firstUsefulFor = (p: EquipmentPiece): string => {
    if (baselineIds.has(p.id)) return ALWAYS_AVAILABLE;
    const names = [...new Set((sourcesById.get(p.id) ?? []).map((s) => s.name))];
    return names.join(' / ') || 'unknown source';
  };

  // ----- Verdicts -----
  // Non-ammo first: ammo is judged only against launchers that survive, so
  // an obsolete bow can't keep its arrow tier alive.
  const ctx: DominanceContext = {
    ammoIds: fullPool.filter((p) => p.slot === 'ammo').map((p) => canonical(p).id),
    launcherIds: fullPool.filter(isLauncher).map((p) => canonical(p).id),
  };
  const verdicts = new Map<number, ItemVerdict>();
  const obsoleteIds = new Set<number>();

  // Kept iff undominated under at least one key. A weapon with no keys is
  // never evaluated by the sim, so it's obsolete with no dominator.
  const judge = (p: EquipmentPiece) => {
    const peers = competitorsFor(p).filter((y) => y.slot === p.slot && y.id !== p.id);
    const beatenBy: Partial<Record<DominanceKey, EquipmentPiece>> = {};
    for (const key of keysForItem(p)) {
      const dominator = peers.find((y) => dominates(y, p, key, ctx));
      if (!dominator) {
        verdicts.set(p.id, { item: p, obsolete: false, firstUseful: firstUsefulFor(p) });
        return;
      }
      beatenBy[key] = dominator;
    }
    verdicts.set(p.id, { item: p, obsolete: true, beatenBy });
    obsoleteIds.add(p.id);
  };

  for (const p of fullPool) if (p.slot !== 'ammo') judge(p);
  ctx.launcherIds = fullPool.filter((p) => isLauncher(p) && !obsoleteIds.has(p.id)).map((p) => canonical(p).id);
  for (const p of fullPool) if (p.slot === 'ammo') judge(p);

  return { verdicts, obsoleteIds };
}

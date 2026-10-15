// ============================================================================
// Boss-pool access helpers — parallel to src/lib/vendorAccess.ts.
//
// Given a player's progression (skills + quests) and a set of bosses the
// player has access to (typically the user-curated "Killed" set), return
// the subset of boss-drop items they can:
//   1. KILL the source boss for (bossAccess gates, via canKillBoss).
//   2. WIELD the dropped item (requirements + questReqs).
//   3. ASSEMBLE the final form when components are needed
//      (prerequisiteDrops + buildRequirements).
//
// Prerequisite resolution is delegated to src/lib/itemSourceIndex.ts, which
// walks the COMBINED boss + misc source index. A boss drop whose prereq
// item only exists in the misc pool (or vice versa) now resolves cleanly;
// previously bossAccess treated unknown prereqs as "always satisfied" and
// silently leaked false positives. The cross-pool resolver fixes that.
//
// Skill storage is long-form (attack/strength/.../slayer/...) — same
// convention as vendorAccess, questRequirements, bossRequirements, and
// the hiscores response.
// ============================================================================

import type { EquipmentPiece } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import { bossDrops, BossDropItem, BossAccess } from '@/upgrade/lib/bossDrops';
import type { AllSkills } from '@/upgrade/lib/vendorAccess';
import {
  Progression,
  buildCombinedItemSourceIndex,
  isItemUnlocked,
} from '@/upgrade/lib/itemSourceIndex';

/** Alias kept for back-compat with /crabsim and any future callers — the
 *  shared shape lives in itemSourceIndex.ts. */
export type BossProgression = Progression;

function skillLevel(skills: AllSkills, key: string): number {
  return skills[key] ?? 1;
}

// =====
// Boss-level access check — used by bossesAccessibleByProgression and any
// caller that wants to pre-filter the boss list (e.g. /crabsim's killable
// chip). Once a boss is in the user's "killed" set, the pool builder
// trusts that set as the access decision (and doesn't re-call this).
// =====
export function canKillBoss(progression: BossProgression, bossName: string, access: BossAccess): boolean {
  for (const q of access.questsCompleted) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of access.questsStarted) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  if (access.slayerLevel !== null && skillLevel(progression.skills, 'slayer') < access.slayerLevel) return false;
  if (access.onSlayerTask && !progression.isOnTaskFor(bossName)) return false;
  for (const [k, lvl] of Object.entries(access.skills ?? {})) {
    if (skillLevel(progression.skills, k) < (lvl as number)) return false;
  }
  return true;
}

// =====
// Per-drop wield check (used by callers that want a quick wield-only test
// without going through the full pool resolver).
// =====
export function canWieldDrop(progression: BossProgression, drop: BossDropItem): boolean {
  for (const [k, lvl] of Object.entries(drop.requirements)) {
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
 * access, returns the flat EquipmentPiece pool of every BOSS drop the
 * player can both unlock and wield. Cross-pool prereqs (boss drops with
 * misc-pool components, e.g. Bonecrusher necklace needing Dragonbone
 * necklace) resolve through the shared resolver.
 *
 * `accessibleMiscSet` is optional for back-compat; defaults to empty
 * which makes any misc-pool prereq fail. Callers that want cross-pool
 * resolution must pass the player's curated misc-source set.
 */
export function getPlayerBossDropPool(
  progression: BossProgression,
  accessibleBossSet: ReadonlySet<string>,
  accessibleMiscSet: ReadonlySet<string> = new Set(),
): EquipmentPiece[] {
  const byId = new Map(availableEquipment.map((e) => [e.id, e]));
  const index = buildCombinedItemSourceIndex();
  const memo = new Map<string, boolean>();
  const seen = new Set<number>();
  const out: EquipmentPiece[] = [];

  for (const boss of bossDrops) {
    if (!accessibleBossSet.has(boss.boss)) continue;
    for (const drop of boss.drops) {
      if (seen.has(drop.itemId)) continue;
      // The shared resolver looks up the item by name in the combined
      // index — every accessible source is tried in turn. For boss drops
      // we know there's at least one boss-pool source (this one) so a true
      // result means it's reachable.
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
 * Convenience: filter bossDrops to the set of bosses the player can KILL
 * (ignoring item-side unlocks). Caller can pass the result into
 * getPlayerBossDropPool.
 */
export function bossesAccessibleByProgression(progression: BossProgression): Set<string> {
  const out = new Set<string>();
  for (const boss of bossDrops) {
    if (canKillBoss(progression, boss.boss, boss.bossAccess)) out.add(boss.boss);
  }
  return out;
}

/**
 * Collects every quest name referenced anywhere in bossDrops — for "auto-
 * complete all relevant quests" presets analogous to allVendorQuestNames.
 */
export function allBossQuestNames(): { started: string[]; completed: string[] } {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const boss of bossDrops) {
    for (const q of boss.bossAccess.questsCompleted) completed.add(q);
    for (const q of boss.bossAccess.questsStarted) started.add(q);
    for (const drop of boss.drops) {
      for (const q of drop.questReqs.completed) completed.add(q);
      for (const q of drop.questReqs.started) started.add(q);
      for (const q of drop.buildRequirements.questsCompleted) completed.add(q);
      for (const q of drop.buildRequirements.questsStarted) started.add(q);
    }
  }
  for (const q of completed) started.add(q);
  return { started: [...started], completed: [...completed] };
}

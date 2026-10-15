// ============================================================================
// Vendor-pool access helpers.
//
// Given a player's progression (skills + quest state), returns the subset of
// vendor-stock items the player can both ACCESS (clear at least one shop's
// entry req) and WIELD (clear the item's own skill req).
//
// Skill storage is long-form (attack/strength/defence/hitpoints/ranged/
// magic/prayer/slayer/mining/herblore/...) — same convention as the
// hiscores response, questRequirements.ts, bossRequirements.ts. The
// vendor data generator translates short-form combat keys to long-form
// at emit time, so the entries we consume here use long names.
//
// shopAccess fields supported:
//   - Skill thresholds keyed by long-form OSRS name (attack/strength/...)
//   - combatTotal — attack + strength sum (Warriors' Guild simplification —
//     the real rule also accepts 99 in either alone, which this simplified
//     model doesn't precisely capture).
//   - questPoints — total QP threshold (Champions' Guild = 32).
//   - questsStarted — every named quest must be at least started.
//   - questsCompleted — every named quest must be completed.
//
// Item.requirements: skill-level reqs only (long-form). Items with quest
// reqs to WIELD are excluded at generator time.
// ============================================================================

import type { EquipmentPiece } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import { vendorStarterItems, VendorItem, VendorShopAccess } from '@/upgrade/lib/vendorStarter';

/** Long-form skill dict: { attack: 99, slayer: 85, ... }. Same shape as
 *  the hiscores `allSkills` response and questRequirements.AllSkills. */
export type AllSkills = Record<string, number>;

export interface PlayerProgression {
  skills: AllSkills;
  questPoints: number;
  questsStarted: ReadonlySet<string>;
  questsCompleted: ReadonlySet<string>;
}

// Keys on a shop-access object that aren't skill thresholds. Everything
// else is treated as a long-form skill name and looked up directly.
const META_KEYS = new Set(['combatTotal', 'questPoints', 'questsStarted', 'questsCompleted']);

function skillLevel(skills: AllSkills, key: string): number {
  return skills[key] ?? 1;
}

export function meetsShopAccess(progression: PlayerProgression, access: VendorShopAccess): boolean {
  const { skills, questPoints, questsStarted, questsCompleted } = progression;

  for (const [key, raw] of Object.entries(access)) {
    if (raw === undefined) continue;

    if (key === 'combatTotal') {
      const need = raw as number;
      const sum = skillLevel(skills, 'attack') + skillLevel(skills, 'strength');
      // Warriors' Guild also allows entry with 99 in either Attack or
      // Strength alone. Honour that fallback so a player at e.g. (99,1)
      // isn't locked out.
      if (sum < need && skillLevel(skills, 'attack') < 99 && skillLevel(skills, 'strength') < 99) return false;
      continue;
    }
    if (key === 'questPoints') {
      if (questPoints < (raw as number)) return false;
      continue;
    }
    if (key === 'questsStarted') {
      const list = raw as string[];
      for (const q of list) {
        // Completed implies started.
        if (!questsStarted.has(q) && !questsCompleted.has(q)) return false;
      }
      continue;
    }
    if (key === 'questsCompleted') {
      const list = raw as string[];
      for (const q of list) {
        if (!questsCompleted.has(q)) return false;
      }
      continue;
    }
    if (META_KEYS.has(key)) continue;
    // Any other key is a long-form skill threshold.
    if (skillLevel(skills, key) < (raw as number)) return false;
  }
  return true;
}

export function meetsItemRequirements(progression: PlayerProgression, reqs: Record<string, number>): boolean {
  for (const [key, level] of Object.entries(reqs)) {
    if (key === 'combatTotal') {
      const sum = skillLevel(progression.skills, 'attack') + skillLevel(progression.skills, 'strength');
      if (sum < level) return false;
      continue;
    }
    if (skillLevel(progression.skills, key) < level) return false;
  }
  return true;
}

export function isItemAccessibleAndUsable(item: VendorItem, progression: PlayerProgression): boolean {
  if (!meetsItemRequirements(progression, item.requirements)) return false;
  return item.shops.some((s) => meetsShopAccess(progression, s.shopAccess));
}

/**
 * Returns the EquipmentPiece subset of `vendorStarterItems` reachable by a
 * player at the given progression.
 */
export function getPlayerAccessiblePool(progression: PlayerProgression): EquipmentPiece[] {
  const byId = new Map(availableEquipment.map((e) => [e.id, e]));
  const out: EquipmentPiece[] = [];
  for (const v of vendorStarterItems) {
    if (!isItemAccessibleAndUsable(v, progression)) continue;
    const e = byId.get(v.itemId);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Collect every quest name referenced by any shop's access requirements —
 * the "all relevant quests done" set used by the L99 preset.
 */
export function allVendorQuestNames(): { started: string[]; completed: string[] } {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const v of vendorStarterItems) {
    for (const s of v.shops) {
      for (const q of s.shopAccess.questsStarted ?? []) started.add(q);
      for (const q of s.shopAccess.questsCompleted ?? []) completed.add(q);
    }
  }
  // Completed quests are also "started"
  for (const q of completed) started.add(q);
  return { started: [...started], completed: [...completed] };
}

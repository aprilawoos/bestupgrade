// ============================================================================
// Vendor-pool access helpers.
//
// Given a player's progression (skills + quest state), returns the subset of
// vendor-stock items the player can both ACCESS (clear at least one shop's
// entry req) and WIELD (clear the item's own skill req).
//
// shopAccess fields supported:
//   - Skill levels (atk, str, def, ranged, magic, prayer, hp, mining,
//     herblore, etc.) — player.skills[key] must reach the value.
//   - combatTotal — atk + str sum (Warriors' Guild simplification — note
//     the real rule also accepts 99 in either alone, which this simplified
//     model doesn't precisely capture).
//   - questPoints — total QP threshold (Champions' Guild = 32).
//   - questsStarted — every named quest must be at least started.
//   - questsCompleted — every named quest must be completed.
//
// Item.requirements: skill-level reqs only (atk/def/ranged/etc.). Items
// with quest reqs to WIELD are excluded at generator time.
// ============================================================================

import type { EquipmentPiece, PlayerSkills } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import { vendorStarterItems, VendorItem, VendorShopAccess } from '@/lib/vendorStarter';

export interface PlayerProgression {
  skills: Partial<PlayerSkills>;
  questPoints: number;
  questsStarted: ReadonlySet<string>;
  questsCompleted: ReadonlySet<string>;
}

function skillValue(skills: Partial<PlayerSkills>, key: string): number {
  const v = (skills as Record<string, number | undefined>)[key];
  return v ?? 1;
}

const SKILL_KEYS = new Set(['atk', 'str', 'def', 'ranged', 'magic', 'prayer', 'hp', 'mining', 'herblore', 'runecraft']);

export function meetsShopAccess(progression: PlayerProgression, access: VendorShopAccess): boolean {
  const { skills, questPoints, questsStarted, questsCompleted } = progression;

  // Iterate every key on the access object — handle skills, combatTotal,
  // questPoints, questsStarted, questsCompleted.
  for (const [key, raw] of Object.entries(access)) {
    if (raw === undefined) continue;

    if (key === 'combatTotal') {
      const need = raw as number;
      const sum = skillValue(skills, 'atk') + skillValue(skills, 'str');
      // Warriors' Guild also allows entry with 99 in either Atk or Str alone.
      // Honour that fallback so a player at e.g. (99,1) isn't locked out.
      if (sum < need && skillValue(skills, 'atk') < 99 && skillValue(skills, 'str') < 99) return false;
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
    if (SKILL_KEYS.has(key)) {
      if (skillValue(skills, key) < (raw as number)) return false;
      continue;
    }
    // Unknown key — fail closed.
    return false;
  }
  return true;
}

export function meetsItemRequirements(progression: PlayerProgression, reqs: Record<string, number>): boolean {
  // Items only carry skill reqs (combat or otherwise — never quest).
  for (const [key, level] of Object.entries(reqs)) {
    if (key === 'combatTotal') {
      const sum = skillValue(progression.skills, 'atk') + skillValue(progression.skills, 'str');
      if (sum < level) return false;
      continue;
    }
    if (skillValue(progression.skills, key) < level) return false;
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

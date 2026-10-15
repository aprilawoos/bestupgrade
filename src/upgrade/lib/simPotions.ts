// ============================================================================
// Sim-side potion auto-apply.
//
// Per user direction: potions are always net buffs, so the loadout sim should
// not brute-force over potion choices. Instead, given the player's Herblore
// level + sim style, pick the highest-tier boost the player CAN drink for
// each relevant stat and apply once via `player.boosts`.
//
// Scope is intentionally restricted to herblore-craftable potions present in
// the existing `PotionMap` (src/utils.ts). Boss-drop drinks (Overload from
// NMZ, Smelling salts from ToA, Imbued/Saturated heart from slayer/Phantom
// Muspah) are unlocked via separate access — they would need an extra access
// dimension to gate properly and are deferred. Same for the magic/ranged
// brews that exist on the wiki but aren't yet in the Potion enum
// (Zamorak/Saradomin/Armadyl/Bastion/Battlemage).
//
// Stat-cross overestimate: taking per-stat max across all eligible potions
// can pick boosts from potions that wouldn't realistically stack in a single
// inventory (e.g. Super combat for str + Zamorak brew for atk). This is a
// known simplification — the user explicitly asked for the simplest possible
// "highest available auto-apply" treatment.
// ============================================================================

import Potion from '@/enums/Potion';
import { PotionMap } from '@/utils';
import type { Player } from '@/types/Player';
import type { SimStyle } from '@/upgrade/lib/loadoutSim';

interface PotionEntry {
  potion: Potion;
  herbloreReq: number;
  /** Which sim styles benefit (drives the per-style filter). */
  styles: SimStyle[];
}

// Herblore reqs per https://oldschool.runescape.wiki/w/Potion (fetched
// 2026-05-27; cached in .scratch/combat_potions.json).
const HERBLORE_POTIONS: PotionEntry[] = [
  { potion: Potion.ATTACK,         herbloreReq: 3,  styles: ['melee'] },
  { potion: Potion.STRENGTH,       herbloreReq: 12, styles: ['melee'] },
  { potion: Potion.DEFENCE,        herbloreReq: 30, styles: ['melee', 'ranged', 'magic'] },
  { potion: Potion.SUPER_ATTACK,   herbloreReq: 45, styles: ['melee'] },
  { potion: Potion.SUPER_STRENGTH, herbloreReq: 55, styles: ['melee'] },
  { potion: Potion.SUPER_DEFENCE,  herbloreReq: 66, styles: ['melee', 'ranged', 'magic'] },
  { potion: Potion.SUPER_COMBAT,   herbloreReq: 90, styles: ['melee'] },
  { potion: Potion.RANGING,        herbloreReq: 72, styles: ['ranged'] },
  { potion: Potion.MAGIC,          herbloreReq: 76, styles: ['magic'] },
  { potion: Potion.ANCIENT,        herbloreReq: 85, styles: ['magic'] },
  { potion: Potion.FORGOTTEN_BREW, herbloreReq: 91, styles: ['magic'] },
];

/**
 * Mutates `player.boosts` to the per-stat max boost achievable from all
 * herblore potions the player can drink given their Herblore level + the
 * sim style. Negative entries (drain side-effects on brews) are ignored —
 * boosts only increase.
 */
export function applyBestPotionsForStyle(player: Player, style: SimStyle): void {
  const herblore = player.skills.herblore ?? 1;
  const boosts = { atk: 0, str: 0, def: 0, magic: 0, ranged: 0 };

  for (const entry of HERBLORE_POTIONS) {
    if (entry.herbloreReq > herblore) continue;
    if (!entry.styles.includes(style)) continue;
    const result = PotionMap[entry.potion].calculateFn(player.skills);
    for (const k of Object.keys(boosts) as Array<keyof typeof boosts>) {
      const v = result[k] as number | undefined;
      if (v !== undefined && v > boosts[k]) boosts[k] = v;
    }
  }

  player.boosts.atk = boosts.atk;
  player.boosts.str = boosts.str;
  player.boosts.def = boosts.def;
  player.boosts.magic = boosts.magic;
  player.boosts.ranged = boosts.ranged;
}

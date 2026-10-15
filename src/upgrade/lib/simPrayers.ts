// ============================================================================
// Sim-side prayer auto-apply.
//
// Mirrors src/upgrade/lib/simPotions.ts: rather than brute-forcing prayer
// choices, we deterministically pick the best prayer(s) for the requested
// sim style and assign to `player.prayers`. The vendored PlayerVsNPCCalc
// engine already consumes that array and applies the multiplicative factors
// from PrayerMap (Piety = 1.20 acc / 1.23 str / 1.25 def, etc.).
//
// Prayer access has three gates:
//   1. Prayer skill level — every prayer has a level req in PrayerMap.
//   2. Quest unlock — Chivalry & Piety require Knight Waves miniquest,
//      which itself requires King's Ransom completion. We gate on KR as
//      the practical proxy.
//   3. Boss-scroll unlock — Rigour / Augury (CoX scrolls), Deadeye /
//      Mystic Vigour (Royal Titans scrolls). The boss must be in the
//      player's "killed" set for the scroll to count as accessible.
//
// Style-aware picker:
//   - Melee: Piety > Chivalry > best (arm + brain) pair. Pairing matters
//     because the low-tier melee prayers only boost one stat each, so you
//     need ARM (strength: Burst→Superhuman→Ultimate) + BRAIN (attack:
//     Clarity→Improved→Incredible). Piety / Chivalry are combined-form.
//   - Ranged: single-prayer ladder. Rigour > Deadeye > Eagle Eye > Hawk
//     Eye > Sharp Eye.
//   - Magic: single-prayer ladder. Augury > Mystic Vigour > Mystic Might
//     > Mystic Lore > Mystic Will.
// ============================================================================

import { Prayer } from '@/enums/Prayer';
import type { Player } from '@/types/Player';
import type { SimStyle } from '@/upgrade/lib/loadoutSim';

// =====
// Prayer access entry — what to gate on per prayer.
// =====
interface PrayerAccess {
  prayer: Prayer;
  /** Prayer skill level required. */
  prayerLevel: number;
  /** Quest that must be completed (proxy for Knight Waves miniquest). */
  questCompleted?: string;
  /** Boss whose drop unlocks the prayer scroll. Player must have it
   *  in their accessibleBossSet (i.e. killed) for the scroll to count. */
  bossScroll?: string;
}

// =====
// Per-style prayer catalogues, in unlock-level order.
// =====
const MELEE_ARM: PrayerAccess[] = [
  { prayer: Prayer.BURST_OF_STRENGTH,   prayerLevel: 4 },
  { prayer: Prayer.SUPERHUMAN_STRENGTH, prayerLevel: 13 },
  { prayer: Prayer.ULTIMATE_STRENGTH,   prayerLevel: 31 },
];

const MELEE_BRAIN: PrayerAccess[] = [
  { prayer: Prayer.CLARITY_OF_THOUGHT,  prayerLevel: 7 },
  { prayer: Prayer.IMPROVED_REFLEXES,   prayerLevel: 16 },
  { prayer: Prayer.INCREDIBLE_REFLEXES, prayerLevel: 34 },
];

const MELEE_COMBINED: PrayerAccess[] = [
  { prayer: Prayer.CHIVALRY, prayerLevel: 60, questCompleted: "King's Ransom" },
  { prayer: Prayer.PIETY,    prayerLevel: 70, questCompleted: "King's Ransom" },
];

const RANGED: PrayerAccess[] = [
  { prayer: Prayer.SHARP_EYE,  prayerLevel: 8  },
  { prayer: Prayer.HAWK_EYE,   prayerLevel: 26 },
  { prayer: Prayer.EAGLE_EYE,  prayerLevel: 44 },
  { prayer: Prayer.DEADEYE,    prayerLevel: 62, bossScroll: 'The Royal Titans' },
  { prayer: Prayer.RIGOUR,     prayerLevel: 74, bossScroll: 'Chambers of Xeric' },
];

const MAGIC: PrayerAccess[] = [
  { prayer: Prayer.MYSTIC_WILL,  prayerLevel: 9  },
  { prayer: Prayer.MYSTIC_LORE,  prayerLevel: 27 },
  { prayer: Prayer.MYSTIC_MIGHT, prayerLevel: 45 },
  { prayer: Prayer.MYSTIC_VIGOUR, prayerLevel: 63, bossScroll: 'The Royal Titans' },
  { prayer: Prayer.AUGURY,        prayerLevel: 77, bossScroll: 'Chambers of Xeric' },
];

// =====
// Gating predicate
// =====
function isAccessible(
  entry: PrayerAccess,
  prayerLvl: number,
  questsCompleted: ReadonlySet<string>,
  accessibleBossSet: ReadonlySet<string>,
): boolean {
  if (prayerLvl < entry.prayerLevel) return false;
  if (entry.questCompleted && !questsCompleted.has(entry.questCompleted)) return false;
  if (entry.bossScroll && !accessibleBossSet.has(entry.bossScroll)) return false;
  return true;
}

// Pick the highest-level entry in a list that's accessible. Lists are
// authored in ascending unlock order, so we scan back-to-front.
function pickHighest(
  list: PrayerAccess[],
  prayerLvl: number,
  questsCompleted: ReadonlySet<string>,
  accessibleBossSet: ReadonlySet<string>,
): Prayer | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isAccessible(list[i], prayerLvl, questsCompleted, accessibleBossSet)) {
      return list[i].prayer;
    }
  }
  return null;
}

// =====
// Public: pick + apply
// =====

/**
 * Mutates `player.prayers` to the best prayer(s) the player can use for the
 * requested sim style, given their prayer level + completed quests + which
 * bosses they have access to (for scroll-unlock prayers).
 */
export function applyBestPrayersForStyle(
  player: Player,
  style: SimStyle,
  questsCompleted: ReadonlySet<string>,
  accessibleBossSet: ReadonlySet<string>,
): void {
  const prayerLvl = player.skills.prayer ?? 1;
  const picked: Prayer[] = [];

  if (style === 'melee') {
    // Prefer the strongest single combined-form prayer (Piety > Chivalry).
    // Otherwise pair the best arm + best brain.
    const combined = pickHighest(MELEE_COMBINED, prayerLvl, questsCompleted, accessibleBossSet);
    if (combined !== null) {
      picked.push(combined);
    } else {
      const arm = pickHighest(MELEE_ARM, prayerLvl, questsCompleted, accessibleBossSet);
      const brain = pickHighest(MELEE_BRAIN, prayerLvl, questsCompleted, accessibleBossSet);
      if (arm !== null) picked.push(arm);
      if (brain !== null) picked.push(brain);
    }
  } else if (style === 'ranged') {
    const best = pickHighest(RANGED, prayerLvl, questsCompleted, accessibleBossSet);
    if (best !== null) picked.push(best);
  } else if (style === 'magic') {
    const best = pickHighest(MAGIC, prayerLvl, questsCompleted, accessibleBossSet);
    if (best !== null) picked.push(best);
  }

  player.prayers = picked;
}

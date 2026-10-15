// ============================================================================
// Combat-viability filter for OSRS equipment.
//
// Goal: produce a reusable subset of `availableEquipment` that excludes purely
// cosmetic items (holiday gear, joke weapons, costume armour, banners, etc.)
// while keeping every item a real player might equip for combat — including
// low-tier gear like bronze/iron/steel that serves as a valid baseline to
// upgrade from.
//
// Rule: an item is combat-viable iff at least one of its 14 combat stat fields
// is strictly POSITIVE, OR it appears in `noStatExceptions` (zero-stat items
// that still grant meaningful combat utility, e.g. Lightbearer for spec regen,
// Ring of recoil for damage reflection, Atlatl dart as required ammo).
//
// Why "positive" and not "nonzero": ~82 joke weapons ('24-carat' sword, 10th
// birthday balloons, Archibald skins, Assorted flowers) carry only negative
// stats (e.g. str: -10, slash: -100) with no positive contribution. Nonzero
// would keep them; positive cuts them, which matches the cosmetic-elimination
// intent.
//
// Holiday items (h'ween mask, partyhats, Santa hat, Easter ring, Reindeer hat,
// 10th/20th anniversary sets, etc.) all carry zero stats in the underlying
// data, so the stats rule cuts them naturally without any name-pattern match.
//
// Counts at time of writing: 5306 total items → 3165 kept / 2141 cut.
// ============================================================================

import { EquipmentPiece } from '@/types/Player';
import { availableEquipment, noStatExceptions } from '@/lib/Equipment';

// =====
// Predicate
// =====

/**
 * Returns true if `item` carries at least one strictly positive combat-relevant
 * stat, or is in the curated `noStatExceptions` list of zero-stat-but-still-
 * combat-utility items. See file header for full rationale.
 */
export const isCombatViable = (item: EquipmentPiece): boolean => {
  if (noStatExceptions.includes(item.name)) return true;

  const stats = [
    item.bonuses.str,
    item.bonuses.ranged_str,
    item.bonuses.magic_str,
    item.bonuses.prayer,
    item.offensive.stab,
    item.offensive.slash,
    item.offensive.crush,
    item.offensive.magic,
    item.offensive.ranged,
    item.defensive.stab,
    item.defensive.slash,
    item.defensive.crush,
    item.defensive.magic,
    item.defensive.ranged,
  ];

  return stats.some((v) => v > 0);
};

// =====
// Pre-filtered dataset
// =====

/**
 * `availableEquipment` reduced to items a real player might equip for combat.
 * Use this as the source list for future features (gear search, upgrade-path
 * recommendations, random rolls, etc.) so that cosmetic-only items (banners,
 * joke weapons, holiday gear, costume sets, etc.) don't pollute results.
 */
export const combatViableEquipment: EquipmentPiece[] = availableEquipment.filter(isCombatViable);

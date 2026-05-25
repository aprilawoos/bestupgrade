// ============================================================================
// Loadout simulation engine — true brute force across all slot combinations.
//
// Given a pool, monster, skills, and target style, returns the best loadout
// by lexicographic ranking:
//   1. Max DPS
//   2. Max total defensive stats (sum across stab/slash/crush/magic/ranged)
//   3. Max prayer bonus
//
// Approach: Pareto-frontier-prune each armour slot first (eliminate items
// strictly dominated by another in (offensive-relevant + sum-defence +
// prayer)) — this is a PROVABLY equivalent reduction, not a heuristic.
// Then iterate the Cartesian product of frontiers × weapons × stances and
// compute DPS via the canonical calc engine for every combination.
//
// Stances iterated:
//   - Melee: every stance from the weapon's category (TODO: prune Defensive
//     and other clearly-suboptimal stances; for now we keep brute-force
//     honest and run all of them).
//   - Ranged: Rapid only.
//   - Magic: Autocast only.
//
// Slot pool details:
//   - `null` is a valid candidate for every armour slot (and is included
//     in the Pareto frontier on its own merits — items with negative
//     offensive bonuses don't dominate it).
//   - Ammo is auto-paired by weapon category (bow→arrow, crossbow→bolt),
//     not brute-forced — there's only one valid pairing per weapon and an
//     invalid pair zeroes ranged accuracy in the calc.
//   - 2H weapons force shield = null.
// ============================================================================

import { EquipmentPiece, Player, PlayerEquipment, PlayerSkills } from '@/types/Player';
import { Monster } from '@/types/Monster';
import { calculateAttackSpeed, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory, MAGIC_WEAPONS } from '@/enums/EquipmentCategory';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { generateEmptyPlayer } from '@/state';
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { Spell, spellByName } from '@/types/Spell';

// =====
// Public types
// =====

export type SimStyle = 'melee' | 'ranged' | 'magic';

export interface SimLoadout {
  head: EquipmentPiece | null;
  cape: EquipmentPiece | null;
  neck: EquipmentPiece | null;
  ammo: EquipmentPiece | null;
  weapon: EquipmentPiece | null;
  body: EquipmentPiece | null;
  shield: EquipmentPiece | null;
  legs: EquipmentPiece | null;
  hands: EquipmentPiece | null;
  feet: EquipmentPiece | null;
  ring: EquipmentPiece | null;
}

export interface SimResult {
  style: SimStyle;
  loadout: SimLoadout;
  stance: PlayerCombatStyle;
  spell: Spell | null;
  dps: number;
  maxHit: number;
  accuracy: number;
  attackSpeed: number;
  defSum: number;          // sum of all defensive stats across the loadout
  prayerBonus: number;     // sum of bonuses.prayer
  combosEvaluated: number;
  frontierSizes: Record<string, number>; // for diagnostics
  elapsedMs: number;
}

export interface SimOptions {
  pool: EquipmentPiece[];
  monster: Monster;
  skills: Partial<PlayerSkills>;
  style: SimStyle;
}

// =====
// Style → weapon-category gating
// =====
const RANGED_WEAPON_CATS = new Set<EquipmentCategory>([
  EquipmentCategory.BOW,
  EquipmentCategory.CROSSBOW,
  EquipmentCategory.THROWN,
  EquipmentCategory.CHINCHOMPA,
  EquipmentCategory.GUN,
]);

const MAGIC_WEAPON_CATS = new Set<EquipmentCategory>(MAGIC_WEAPONS);

function styleAllowsWeapon(item: EquipmentPiece, style: SimStyle): boolean {
  const cat = item.category as EquipmentCategory;
  if (style === 'ranged') return RANGED_WEAPON_CATS.has(cat);
  if (style === 'magic') return MAGIC_WEAPON_CATS.has(cat);
  if (cat === EquipmentCategory.NONE) return false;
  return !RANGED_WEAPON_CATS.has(cat) && !MAGIC_WEAPON_CATS.has(cat);
}

// =====
// Ammo pairing — single valid pair per weapon (or null)
// =====
function pairAmmoForWeapon(weapon: EquipmentPiece, ammoPool: EquipmentPiece[]): EquipmentPiece | null {
  if (weapon.category === EquipmentCategory.BOW) {
    return ammoPool.find((a) => /arrow/i.test(a.name)) ?? null;
  }
  if (weapon.category === EquipmentCategory.CROSSBOW) {
    return ammoPool.find((a) => /bolt/i.test(a.name)) ?? null;
  }
  return null;
}

// =====
// Spell selection — at level-1 magic, only the four element Strikes are
// usable. Element staves supply their element rune; non-element staves
// default to Wind Strike (the calc trusts rune availability).
// =====
function autocastSpellForWeapon(weapon: EquipmentPiece): Spell | null {
  if (weapon.name === 'Staff of air') return spellByName('Wind Strike');
  if (weapon.name === 'Staff of water') return spellByName('Water Strike');
  if (weapon.name === 'Staff of earth') return spellByName('Earth Strike');
  if (weapon.name === 'Staff of fire') return spellByName('Fire Strike');
  if (weapon.category === EquipmentCategory.STAFF) return spellByName('Wind Strike');
  return null;
}

// =====
// Stance candidates per weapon and target style
// =====
function stancesForStyle(weapon: EquipmentPiece, style: SimStyle): PlayerCombatStyle[] {
  const cat = (weapon.category ?? EquipmentCategory.NONE) as EquipmentCategory;
  const all = getCombatStylesForCategory(cat);
  if (style === 'ranged') {
    const rapid = all.find((s) => s.stance === 'Rapid');
    return rapid ? [rapid] : all.filter((s) => s.type === 'ranged');
  }
  if (style === 'magic') {
    // Plain Autocast (not Defensive Autocast) for max offensive.
    const auto = all.find((s) => s.stance === 'Autocast');
    return auto ? [auto] : all.filter((s) => s.type === 'magic' && s.stance !== 'Defensive Autocast');
  }
  // melee: brute-force every stance the category exposes.
  // TODO: future optimisation — drop Defensive stance + stances whose type
  // gives no positive offensive bonus on this weapon. For now we honour
  // the user's "do all stances" instruction.
  return all.filter((s) => s.type !== 'magic' && s.type !== 'ranged');
}

// =====
// Pareto frontier per armour slot.
//
// An item A dominates B if it's >= on every stat in the relevance vector
// AND > on at least one. Items in the frontier are mutually non-dominated.
//
// Relevance vector (per style):
//   - DPS-relevant offensive stats for that style
//   - Sum of defensive stats (one number — matches the tie-break definition)
//   - Prayer bonus
// =====
function offensiveStatVec(style: SimStyle, item: EquipmentPiece | null): number[] {
  if (!item) {
    return style === 'melee' ? [0, 0, 0, 0] : [0, 0];
  }
  if (style === 'melee') {
    return [
      item.bonuses.str,
      item.offensive.stab,
      item.offensive.slash,
      item.offensive.crush,
    ];
  }
  if (style === 'ranged') {
    return [item.bonuses.ranged_str, item.offensive.ranged];
  }
  return [item.bonuses.magic_str, item.offensive.magic];
}

function defSum(item: EquipmentPiece | null): number {
  if (!item) return 0;
  const d = item.defensive;
  return d.stab + d.slash + d.crush + d.magic + d.ranged;
}

function relevanceVec(style: SimStyle, item: EquipmentPiece | null): number[] {
  const off = offensiveStatVec(style, item);
  return [...off, defSum(item), item ? item.bonuses.prayer : 0];
}

function dominates(a: number[], b: number[]): boolean {
  let strictAnywhere = false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return false;
    if (a[i] > b[i]) strictAnywhere = true;
  }
  return strictAnywhere;
}

function paretoFrontier(items: (EquipmentPiece | null)[], style: SimStyle): (EquipmentPiece | null)[] {
  const vecs = items.map((it) => relevanceVec(style, it));
  const keep = items.map(() => true);
  for (let i = 0; i < items.length; i += 1) {
    if (!keep[i]) continue;
    for (let j = 0; j < items.length; j += 1) {
      if (i === j || !keep[j]) continue;
      if (dominates(vecs[j], vecs[i])) {
        keep[i] = false;
        break;
      }
    }
  }
  return items.filter((_, i) => keep[i]);
}

// =====
// Calc fast-path. Reuses a single Player object across iterations by
// mutating equipment/style/spell/skills and recomputing summed bonuses.
// Skips lodash.merge in favour of direct field assignment.
// =====
function makeBasePlayer(skills: Partial<PlayerSkills>): Player {
  const p = generateEmptyPlayer();
  Object.assign(p.skills, skills);
  return p;
}

interface CalcOutput {
  dps: number;
  maxHit: number;
  accuracy: number;
  attackSpeed: number;
}

function runCalc(
  player: Player,
  monster: Monster,
  loadout: SimLoadout,
  stance: PlayerCombatStyle,
  spell: Spell | null,
): CalcOutput {
  player.equipment = loadout as unknown as PlayerEquipment;
  player.spell = spell;
  player.style = stance;
  const derived = calculateEquipmentBonusesFromGear(player, monster);
  player.bonuses = derived.bonuses;
  player.offensive = derived.offensive;
  player.defensive = derived.defensive;
  player.attackSpeed = calculateAttackSpeed(player, monster);

  const calc = new PlayerVsNPCCalc(player, monster, { loadoutName: 'sim' });
  return {
    dps: calc.getDps(),
    maxHit: calc.getDistribution().getMax(),
    accuracy: calc.getHitChance(),
    attackSpeed: player.attackSpeed,
  };
}

// =====
// Tie-break score for a loadout (sum-of-defence first, then prayer)
// =====
function loadoutScore(loadout: SimLoadout): { defSum: number; prayerBonus: number } {
  let dSum = 0;
  let prayer = 0;
  for (const piece of Object.values(loadout)) {
    if (!piece) continue;
    dSum += defSum(piece);
    prayer += piece.bonuses.prayer;
  }
  return { defSum: dSum, prayerBonus: prayer };
}

// Strict lexicographic comparator: returns true if candidate is strictly
// better than best on (DPS desc, defSum desc, prayer desc).
function isStrictlyBetter(
  cand: { dps: number; defSum: number; prayerBonus: number },
  best: { dps: number; defSum: number; prayerBonus: number } | null,
): boolean {
  if (!best) return true;
  if (cand.dps !== best.dps) return cand.dps > best.dps;
  if (cand.defSum !== best.defSum) return cand.defSum > best.defSum;
  return cand.prayerBonus > best.prayerBonus;
}

// =====
// Public entry point
// =====
export function simulateBestLoadout(opts: SimOptions): SimResult | null {
  const t0 = performance.now();
  const { pool, monster, skills, style } = opts;

  // ----- Weapons (brute-forced, no Pareto) -----
  const weapons = pool
    .filter((p) => p.slot === 'weapon')
    .filter((w) => styleAllowsWeapon(w, style));
  if (weapons.length === 0) return null;

  const ammoPool = pool.filter((p) => p.slot === 'ammo');

  // ----- Armour Pareto frontiers per slot -----
  const armorSlots = ['head', 'cape', 'neck', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;
  const frontiers: Record<typeof armorSlots[number], (EquipmentPiece | null)[]> = {} as any;
  const frontierSizes: Record<string, number> = {};
  for (const slot of armorSlots) {
    const items = pool.filter((p) => p.slot === slot) as (EquipmentPiece | null)[];
    frontiers[slot] = paretoFrontier([null, ...items], style);
    frontierSizes[slot] = frontiers[slot].length;
  }

  // ----- Brute force the Cartesian product -----
  const player = makeBasePlayer(skills);
  let combos = 0;
  let best: SimResult | null = null;
  let bestKey: { dps: number; defSum: number; prayerBonus: number } | null = null;

  for (const weapon of weapons) {
    const ammo = pairAmmoForWeapon(weapon, ammoPool);
    const spell = style === 'magic' ? autocastSpellForWeapon(weapon) : null;
    const shieldOptions = weapon.isTwoHanded ? [null] : frontiers.shield;
    const stances = stancesForStyle(weapon, style);

    for (const stance of stances) {
      for (const head of frontiers.head) {
        for (const cape of frontiers.cape) {
          for (const neck of frontiers.neck) {
            for (const body of frontiers.body) {
              for (const shield of shieldOptions) {
                for (const legs of frontiers.legs) {
                  for (const hands of frontiers.hands) {
                    for (const feet of frontiers.feet) {
                      for (const ring of frontiers.ring) {
                        const loadout: SimLoadout = {
                          head, cape, neck, ammo, weapon,
                          body, shield, legs, hands, feet, ring,
                        };
                        const r = runCalc(player, monster, loadout, stance, spell);
                        combos += 1;
                        const score = loadoutScore(loadout);
                        const key = { dps: r.dps, defSum: score.defSum, prayerBonus: score.prayerBonus };
                        if (isStrictlyBetter(key, bestKey)) {
                          best = {
                            style,
                            loadout,
                            stance,
                            spell,
                            dps: r.dps,
                            maxHit: r.maxHit,
                            accuracy: r.accuracy,
                            attackSpeed: r.attackSpeed,
                            defSum: score.defSum,
                            prayerBonus: score.prayerBonus,
                            combosEvaluated: 0,
                            frontierSizes: { ...frontierSizes },
                            elapsedMs: 0,
                          };
                          bestKey = key;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (best) {
    best.combosEvaluated = combos;
    best.elapsedMs = performance.now() - t0;
  }
  return best;
}

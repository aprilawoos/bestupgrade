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
import { AmmoApplicability, ammoApplicability, calculateAttackSpeed, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory, MAGIC_WEAPONS } from '@/enums/EquipmentCategory';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { generateEmptyPlayer } from '@/state';
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { Spell, spellByName } from '@/types/Spell';
import { SET_BONUSES, setsActivatedByWeapon } from '@/lib/setBonuses';

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
// Ammo pairing — pick the highest ranged_str ammo that the calc engine
// considers VALID for this weapon. Uses ammoApplicability from
// src/lib/Equipment.ts which knows the wiki ammo-tier rules per weapon id
// (Shortbow only fires Bronze/Iron arrows, Maple shortbow fires up to
// Adamant arrows, Rune crossbow fires up to Runite bolts, etc.). Pairing
// a higher-tier arrow than a bow accepts wouldn't yield the ranged_str
// bonus at calc time, so picking by-name without the validity check
// produces a worse loadout than the bow allows.
//
// Thrown weapons (THROWN / CHINCHOMPA) and powered ranged (GUN, Blowpipe
// handled elsewhere) have no separate ammo — return null and let the
// weapon supply its own attack.
// =====
function pairAmmoForWeapon(weapon: EquipmentPiece, ammoPool: EquipmentPiece[]): EquipmentPiece | null {
  if (weapon.category !== EquipmentCategory.BOW && weapon.category !== EquipmentCategory.CROSSBOW) {
    return null;
  }
  const valid = ammoPool.filter((a) => ammoApplicability(weapon.id, a.id) === AmmoApplicability.INCLUDED);
  if (valid.length === 0) return null;
  return valid.reduce((best, cur) => {
    if (cur.bonuses.ranged_str > best.bonuses.ranged_str) return cur;
    if (cur.bonuses.ranged_str === best.bonuses.ranged_str
        && cur.offensive.ranged > best.offensive.ranged) return cur;
    return best;
  }, valid[0]);
}

// =====
// Castable spell pool for magic style — minimal set that covers all DPS
// optima at the player's magic level.
//
// Why only 2 (or fewer) spells need testing:
//   - The calc's `getSpellMaxHit` auto-upgrades max-hit to the highest
//     castable element WITHIN A TIER (Wind Bolt at L29 produces Earth
//     Bolt's max-hit of 11 — see src/types/Spell.ts:32). So within a tier,
//     the cast spell's element doesn't change the max-hit.
//   - Elemental weakness IS applied separately based on the cast spell's
//     element (calc lines 949, 1107). So matching the monster's weakness
//     gives a bonus on top of the auto-upgraded max-hit.
//
// Therefore for any (magicLevel, monsterWeakness) pair we test:
//   1. Highest castable Wind-column spell — the baseline, gets the
//      tier-auto-upgrade but no weakness bonus.
//   2. Highest castable matching-element spell — only added when the
//      monster has an elemental weakness AND the matching column has a
//      castable spell. Skipped when matching column == wind column.
//
// Rune availability constrains the tier ceiling:
//   - Aubury's Rune Shop (Varrock, F2P, no req): Mind/Chaos/Death + every
//     elemental → Strikes / Bolts / Blasts in scope.
//   - Regath's Wares (Arceuus, members, no req post-Jan-2024 favour rework):
//     Blood runes → Waves in scope (members only, 560 gp/cast).
//   - No no-req shop sells Wrath runes → Surges remain out.
// =====
const SPELL_LEVELS: Record<string, number> = {
  'Wind Strike': 1, 'Water Strike': 5, 'Earth Strike': 9, 'Fire Strike': 13,
  'Wind Bolt': 17, 'Water Bolt': 23, 'Earth Bolt': 29, 'Fire Bolt': 35,
  'Wind Blast': 41, 'Water Blast': 47, 'Earth Blast': 53, 'Fire Blast': 59,
  'Wind Wave': 62, 'Water Wave': 65, 'Earth Wave': 70, 'Fire Wave': 75,
};

type ElementCol = 'Wind' | 'Water' | 'Earth' | 'Fire';

function highestCastableInColumn(magicLevel: number, column: ElementCol): Spell | null {
  // Try Wave first, then Blast, Bolt, Strike — descending tier order.
  for (const tier of ['Wave', 'Blast', 'Bolt', 'Strike'] as const) {
    const name = `${column} ${tier}`;
    if (magicLevel >= SPELL_LEVELS[name]) {
      return spellByName(name);
    }
  }
  return null;
}

// Map calc-engine's `Spellement` ('air'|'water'|'earth'|'fire') to the spell
// name column ('Wind'|'Water'|'Earth'|'Fire'). Air-element spells use the
// "Wind" prefix in their canonical names.
function elementToColumn(element: string | undefined): ElementCol | null {
  if (element === 'air') return 'Wind';
  if (element === 'water') return 'Water';
  if (element === 'earth') return 'Earth';
  if (element === 'fire') return 'Fire';
  return null;
}

function spellsToTryForMagic(magicLevel: number, monsterWeakness: Monster['weakness']): Spell[] {
  const out: Spell[] = [];
  const baseline = highestCastableInColumn(magicLevel, 'Wind');
  if (baseline) out.push(baseline);

  const matchCol = elementToColumn(monsterWeakness?.element);
  if (matchCol && matchCol !== 'Wind') {
    const match = highestCastableInColumn(magicLevel, matchCol);
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
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

// =====
// Strict lexicographic dominance — matches the user-specified ranking
// (DPS first, then total defence, then prayer).
//
// B lex-dominates A iff:
//   1. B's offensive vector ≥ A's componentwise, AND
//   2. Either (strict > somewhere on offensive — B contributes strictly
//      more to DPS than A and can never be tied on DPS), or
//      (offensive vectors are exactly equal — DPS contribution tied —
//      AND B's (defSum, prayer) beats A's lexicographically).
//
// This is stricter than multi-objective Pareto: items with lower offensive
// but higher defSum are correctly DROPPED here (they can never win the
// lex tie-break because DPS dominates defSum). Multi-objective Pareto
// would have kept them.
//
// Validity for stance brute-force (melee): the offensive vector for melee
// is [str, off.stab, off.slash, off.crush]. An item that's ≥ on ALL four
// components is at least as good as the dominated item for ANY stance.
// So stance-induced offensive variation is already covered.
//
// Validity for future pools with positive str/rstr/mstr items: those
// bonuses are already in offensiveStatVec, so they're part of the DPS-
// relevant section. Adding new items with positive strength bonuses
// reshapes the offensive frontier but the rule itself remains correct.
// =====
function isLexDominated(a: EquipmentPiece | null, b: EquipmentPiece | null, style: SimStyle): boolean {
  const offA = offensiveStatVec(style, a);
  const offB = offensiveStatVec(style, b);

  let strictOff = false;
  for (let i = 0; i < offA.length; i += 1) {
    if (offB[i] < offA[i]) return false; // B is worse on some offensive → can't dominate A
    if (offB[i] > offA[i]) strictOff = true;
  }
  if (strictOff) return true; // B strictly DPS-dominates A

  // Offensive vectors are identical — fall through to tie-break.
  const defA = defSum(a);
  const defB = defSum(b);
  if (defB > defA) return true;
  if (defB < defA) return false;
  const prayerA = a ? a.bonuses.prayer : 0;
  const prayerB = b ? b.bonuses.prayer : 0;
  return prayerB > prayerA;
}

// Collapse items whose (offensive, defSum, prayer) tuple is identical down
// to a single representative — Red cape / Yellow cape kind of pairs that
// are stat-equivalent and would otherwise both survive Pareto since
// neither strictly dominates the other. First encountered wins.
function dedupeByRelevantStats(items: (EquipmentPiece | null)[], style: SimStyle): (EquipmentPiece | null)[] {
  const seen = new Map<string, EquipmentPiece | null>();
  for (const item of items) {
    const key = [
      ...offensiveStatVec(style, item),
      defSum(item),
      item ? item.bonuses.prayer : 0,
    ].join(',');
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function paretoFrontier(items: (EquipmentPiece | null)[], style: SimStyle): (EquipmentPiece | null)[] {
  const deduped = dedupeByRelevantStats(items, style);
  const keep = deduped.map(() => true);
  for (let i = 0; i < deduped.length; i += 1) {
    if (!keep[i]) continue;
    for (let j = 0; j < deduped.length; j += 1) {
      if (i === j || !keep[j]) continue;
      if (isLexDominated(deduped[i], deduped[j], style)) {
        keep[i] = false;
        break;
      }
    }
  }
  return deduped.filter((_, i) => keep[i]);
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
// Diagnostic: describe what the brute force would iterate over without
// actually running the calc. Useful for verifying which items + spells
// + stances are in the candidate space for a given (pool, monster, style)
// combination.
// =====
export interface SimSpace {
  weapons: { weapon: EquipmentPiece; ammo: EquipmentPiece | null; stances: PlayerCombatStyle[] }[];
  spells: Spell[];          // empty for melee/ranged
  armourFrontiers: Record<string, (EquipmentPiece | null)[]>;
}

const ARMOUR_SLOTS = ['head', 'cape', 'neck', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;

export function describeSimSpace(opts: SimOptions): SimSpace {
  const { pool, monster, skills, style } = opts;
  const weaponsRaw = pool.filter((p) => p.slot === 'weapon').filter((w) => styleAllowsWeapon(w, style));
  const ammoPool = pool.filter((p) => p.slot === 'ammo');
  const weapons = weaponsRaw.map((w) => ({
    weapon: w,
    ammo: pairAmmoForWeapon(w, ammoPool),
    stances: stancesForStyle(w, style),
  }));
  const magicLevel = skills.magic ?? 99;
  const spells: Spell[] = style === 'magic' ? spellsToTryForMagic(magicLevel, monster.weakness) : [];
  const armourFrontiers: Record<string, (EquipmentPiece | null)[]> = {};
  for (const slot of ARMOUR_SLOTS) {
    const items = pool.filter((p) => p.slot === slot) as (EquipmentPiece | null)[];
    armourFrontiers[slot] = paretoFrontier([null, ...items], style);
  }
  return { weapons, spells, armourFrontiers };
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
  const baseFrontiers: Record<typeof armorSlots[number], (EquipmentPiece | null)[]> = {} as any;
  const frontierSizes: Record<string, number> = {};
  for (const slot of armorSlots) {
    const items = pool.filter((p) => p.slot === slot) as (EquipmentPiece | null)[];
    baseFrontiers[slot] = paretoFrontier([null, ...items], style);
    frontierSizes[slot] = baseFrontiers[slot].length;
  }

  // ----- Brute force the Cartesian product -----
  // For magic, we also brute force every castable elemental spell at the
  // player's magic level + monster weakness. See `spellsToTryForMagic`.
  // For melee/ranged, spell stays null and the inner loop runs once.
  const player = makeBasePlayer(skills);
  const magicLevel = skills.magic ?? 99;
  const spellOptions: (Spell | null)[] = style === 'magic'
    ? spellsToTryForMagic(magicLevel, monster.weakness)
    : [null];
  if (style === 'magic' && spellOptions.length === 0) return null;

  // Wrapped in an object so TypeScript doesn't narrow `best` to `never`
  // through the iterateOverArmour closure that mutates it.
  const state: {
    combos: number;
    best: SimResult | null;
    bestKey: { dps: number; defSum: number; prayerBonus: number } | null;
  } = { combos: 0, best: null, bestKey: null };

  // Inner Cartesian product over a given armour-frontier set. Pulled into a
  // helper so the outer weapon loop can call it once with the normal
  // Pareto-pruned frontiers AND once per applicable set-bonus with the
  // set's slots pinned (per SET_BONUSES). Without this, single-slot Pareto
  // would drop set pieces that are stat-tied with a non-set alternative
  // (e.g. Obsidian helmet vs Berserker helm — both str=3, Berserker has
  // higher defSum so Pareto picks it; the calc never sees a complete
  // obsidian set and never applies the +10% bonus).
  const iterateOverArmour = (
    weapon: EquipmentPiece,
    ammo: EquipmentPiece | null,
    stance: PlayerCombatStyle,
    spell: Spell | null,
    frontiers: Record<string, (EquipmentPiece | null)[]>,
  ): void => {
    const shieldOptions = weapon.isTwoHanded ? [null] : frontiers.shield;
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
                      state.combos += 1;
                      const score = loadoutScore(loadout);
                      const key = { dps: r.dps, defSum: score.defSum, prayerBonus: score.prayerBonus };
                      if (isStrictlyBetter(key, state.bestKey)) {
                        state.best = {
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
                        state.bestKey = key;
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
  };

  // For a given set, build a frontier map that pins each set-piece slot to
  // the single set item. Other slots keep their normal Pareto frontier.
  // Returns null if any required piece isn't accessible in the current pool
  // (meaning the set can't be assembled).
  const pinSetFrontiers = (
    setName: string,
  ): Record<string, (EquipmentPiece | null)[]> | null => {
    const set = SET_BONUSES.find((s) => s.name === setName);
    if (!set) return null;
    const pinned: Record<string, (EquipmentPiece | null)[]> = { ...baseFrontiers };
    for (const piece of set.pieces) {
      const item = pool.find((p) => p.slot === piece.slot && p.name === piece.itemName);
      if (!item) return null;
      pinned[piece.slot] = [item];
    }
    return pinned;
  };

  for (const weapon of weapons) {
    const ammo = pairAmmoForWeapon(weapon, ammoPool);
    const stances = stancesForStyle(weapon, style);
    const triggeredSets = setsActivatedByWeapon(weapon.name);

    for (const stance of stances) {
      for (const spell of spellOptions) {
        // Normal pass — Pareto-pruned frontiers. Covers loadouts where no
        // set bonus is involved.
        iterateOverArmour(weapon, ammo, stance, spell, baseFrontiers);

        // Set-pinned passes — one per set the current weapon can trigger.
        // Forces the set's armour pieces into their slots so the calc
        // actually sees a complete set and applies its bonus.
        for (const set of triggeredSets) {
          const pinned = pinSetFrontiers(set.name);
          if (pinned) iterateOverArmour(weapon, ammo, stance, spell, pinned);
        }
      }
    }
  }

  if (state.best) {
    state.best.combosEvaluated = state.combos;
    state.best.elapsedMs = performance.now() - t0;
  }
  return state.best;
}

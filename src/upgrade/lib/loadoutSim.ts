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
// Melee frontiers are built per attack type (stab / slash / crush) since a
// stance only reads strength + its own type's accuracy. Then iterate the
// Cartesian product of frontiers × weapons × stances and compute DPS via
// the canonical calc engine for every combination.
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
import { CombatStyleType, PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { Spell, spellByName } from '@/types/Spell';
import {
  IMMUNE_TO_MAGIC_DAMAGE_NPC_IDS,
  IMMUNE_TO_MELEE_DAMAGE_NPC_IDS,
  IMMUNE_TO_RANGED_DAMAGE_NPC_IDS,
  ZULRAH_IDS,
} from '@/lib/constants';
import { SET_BONUSES, setsActivatedByWeapon } from '@/upgrade/lib/setBonuses';
import { applyBestPotionsForStyle } from '@/upgrade/lib/simPotions';
import { applyBestPrayersForStyle } from '@/upgrade/lib/simPrayers';

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
  /** Quests completed — used by simPrayers to gate Chivalry/Piety (King's
   *  Ransom). Optional: defaults to empty set, which disables those prayers. */
  questsCompleted?: ReadonlySet<string>;
  /** Bosses the player has access to (typically the user's "killed" set).
   *  Used by simPrayers to gate scroll-unlock prayers (Rigour/Augury from
   *  CoX; Deadeye/Mystic Vigour from Royal Titans). Optional: defaults to
   *  empty set, which disables those prayers. */
  accessibleBossSet?: ReadonlySet<string>;
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
// Style immunity — styles the target can't be damaged by REGARDLESS of
// gear. Mirrors the gear-independent branches of PlayerVsNPCCalc.isImmune:
// the three per-NPC immunity lists. Zulrah is excluded from the melee check
// because the calc lets polearms hit it. Gear-dependent immunity
// (flying, vampyres, leafy, ...) is left to the calc — those loadouts just
// score 0 DPS.
//
// Without this, an immune style brute-forces its whole candidate space
// only to rank loadouts that all deal 0 DPS (melee vs TzKal-Zuk was ~1M
// combos of pure noise).
// =====
export function isMonsterImmuneToStyle(monster: Monster, style: SimStyle): boolean {
  if (style === 'melee') {
    return IMMUNE_TO_MELEE_DAMAGE_NPC_IDS.includes(monster.id) && !ZULRAH_IDS.includes(monster.id);
  }
  if (style === 'ranged') return IMMUNE_TO_RANGED_DAMAGE_NPC_IDS.includes(monster.id);
  return IMMUNE_TO_MAGIC_DAMAGE_NPC_IDS.includes(monster.id);
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
// Attack types the sim evaluates for a weapon — the types of every stance
// it would try (stancesForStyle) under the one style the weapon belongs to.
// Exported for itemDominance so obsolescence is judged over exactly this
// search space. Empty for weapons no sim style accepts.
// =====
export function simAttackTypesForWeapon(weapon: EquipmentPiece): CombatStyleType[] {
  const style = (['melee', 'ranged', 'magic'] as SimStyle[]).find((s) => styleAllowsWeapon(weapon, s));
  if (!style) return [];
  const types = new Set<CombatStyleType>();
  for (const s of stancesForStyle(weapon, style)) {
    if (s.type !== null) types.add(s.type);
  }
  return [...types];
}

// =====
// Armour slots — every slot except weapon + ammo (weapons are iterated
// directly; ammo is auto-paired per weapon).
// =====
const ARMOUR_SLOTS = ['head', 'cape', 'neck', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;

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
//
// Frontier keys — melee frontiers are built PER ATTACK TYPE. A stance's
// DPS reads only melee strength plus the accuracy bonus for its own attack
// type (stab / slash / crush), so a crush stance gains nothing from an
// item's stab or slash accuracy. Pruning on the 2-stat [str, off[type]]
// vector instead of the 4-stat [str, stab, slash, crush] vector is the
// same dominance argument applied to the stats that actually matter, and
// collapses frontiers where items trade off across attack types (Torva vs
// Inquisitor's vs Oathplate). Melee stances with a non-melee type fall
// back to the 4-stat 'all' key. Ranged and magic always use 'all' — their
// vectors are already 2-stat.
// =====
type MeleeAttackType = 'stab' | 'slash' | 'crush';
type FrontierKey = MeleeAttackType | 'all';

function frontierKeyForStance(style: SimStyle, stance: PlayerCombatStyle): FrontierKey {
  if (style !== 'melee') return 'all';
  if (stance.type === 'stab' || stance.type === 'slash' || stance.type === 'crush') return stance.type;
  return 'all';
}

function offensiveStatVec(style: SimStyle, item: EquipmentPiece | null, key: FrontierKey): number[] {
  if (style === 'melee' && key !== 'all') {
    return item ? [item.bonuses.str, item.offensive[key]] : [0, 0];
  }
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
// Validity for stance brute-force (melee): each melee stance is iterated
// against the frontier for its own attack type, whose offensive vector is
// [str, off[type]]. An item that's ≥ on both components is at least as
// good as the dominated item for every stance of that type. The 'all' key
// ([str, stab, slash, crush]) covers any stance without a melee type.
//
// Validity for future pools with positive str/rstr/mstr items: those
// bonuses are already in offensiveStatVec, so they're part of the DPS-
// relevant section. Adding new items with positive strength bonuses
// reshapes the offensive frontier but the rule itself remains correct.
// =====
function isLexDominated(
  a: EquipmentPiece | null,
  b: EquipmentPiece | null,
  style: SimStyle,
  key: FrontierKey,
): boolean {
  const offA = offensiveStatVec(style, a, key);
  const offB = offensiveStatVec(style, b, key);

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
function dedupeByRelevantStats(
  items: (EquipmentPiece | null)[],
  style: SimStyle,
  key: FrontierKey,
): (EquipmentPiece | null)[] {
  const seen = new Map<string, EquipmentPiece | null>();
  for (const item of items) {
    const statKey = [
      ...offensiveStatVec(style, item, key),
      defSum(item),
      item ? item.bonuses.prayer : 0,
    ].join(',');
    if (!seen.has(statKey)) seen.set(statKey, item);
  }
  return [...seen.values()];
}

function paretoFrontier(
  items: (EquipmentPiece | null)[],
  style: SimStyle,
  key: FrontierKey,
): (EquipmentPiece | null)[] {
  const deduped = dedupeByRelevantStats(items, style, key);
  const keep = deduped.map(() => true);
  for (let i = 0; i < deduped.length; i += 1) {
    if (!keep[i]) continue;
    for (let j = 0; j < deduped.length; j += 1) {
      if (i === j || !keep[j]) continue;
      if (isLexDominated(deduped[i], deduped[j], style, key)) {
        keep[i] = false;
        break;
      }
    }
  }
  return deduped.filter((_, i) => keep[i]);
}

// Build the per-slot frontier map for one frontier key. `null` (empty
// slot) is always a candidate and competes on its own merits.
type ArmourFrontiers = Record<typeof ARMOUR_SLOTS[number], (EquipmentPiece | null)[]>;

function buildArmourFrontiers(pool: EquipmentPiece[], style: SimStyle, key: FrontierKey): ArmourFrontiers {
  const out = {} as ArmourFrontiers;
  for (const slot of ARMOUR_SLOTS) {
    const items = pool.filter((p) => p.slot === slot) as (EquipmentPiece | null)[];
    out[slot] = paretoFrontier([null, ...items], style, key);
  }
  return out;
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
  /** Armour frontiers keyed first by frontier key — 'stab' / 'slash' /
   *  'crush' for melee stance types, 'all' otherwise — then by slot. Only
   *  keys some candidate stance actually uses are present. */
  armourFrontiers: Record<string, Record<string, (EquipmentPiece | null)[]>>;
}

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
  const armourFrontiers: Record<string, Record<string, (EquipmentPiece | null)[]>> = {};
  for (const w of weapons) {
    for (const stance of w.stances) {
      const key = frontierKeyForStance(style, stance);
      if (!armourFrontiers[key]) armourFrontiers[key] = buildArmourFrontiers(pool, style, key);
    }
  }
  return { weapons, spells, armourFrontiers };
}

// =====
// Public entry point
//
// Returns null when the target is immune to the style (see
// isMonsterImmuneToStyle) or when the pool has no usable weapon for it.
// =====
export function simulateBestLoadout(opts: SimOptions): SimResult | null {
  const t0 = performance.now();
  const { pool, monster, skills, style } = opts;
  if (isMonsterImmuneToStyle(monster, style)) return null;
  const questsCompleted = opts.questsCompleted ?? new Set<string>();
  const accessibleBossSet = opts.accessibleBossSet ?? new Set<string>();

  // ----- Weapons (brute-forced, no Pareto) -----
  const weapons = pool
    .filter((p) => p.slot === 'weapon')
    .filter((w) => styleAllowsWeapon(w, style));
  if (weapons.length === 0) return null;

  const ammoPool = pool.filter((p) => p.slot === 'ammo');

  // ----- Armour Pareto frontiers per slot, built lazily per frontier key -----
  // Melee builds up to three (stab / slash / crush); ranged + magic build
  // one ('all'). See frontierKeyForStance.
  const frontiersByKey = new Map<FrontierKey, ArmourFrontiers>();
  const frontiersFor = (key: FrontierKey): ArmourFrontiers => {
    let f = frontiersByKey.get(key);
    if (!f) {
      f = buildArmourFrontiers(pool, style, key);
      frontiersByKey.set(key, f);
    }
    return f;
  };
  const frontierSizesOf = (f: ArmourFrontiers): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const slot of ARMOUR_SLOTS) out[slot] = f[slot].length;
    return out;
  };

  // ----- Brute force the Cartesian product -----
  // For magic, we also brute force every castable elemental spell at the
  // player's magic level + monster weakness. See `spellsToTryForMagic`.
  // For melee/ranged, spell stays null and the inner loop runs once.
  const player = makeBasePlayer(skills);
  applyBestPotionsForStyle(player, style);
  applyBestPrayersForStyle(player, style, questsCompleted, accessibleBossSet);
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
    frontiers: ArmourFrontiers,
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
                          frontierSizes: frontierSizesOf(frontiers),
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
    base: ArmourFrontiers,
  ): ArmourFrontiers | null => {
    const set = SET_BONUSES.find((s) => s.name === setName);
    if (!set) return null;
    const pinned: ArmourFrontiers = { ...base };
    for (const piece of set.pieces) {
      const item = pool.find((p) => p.slot === piece.slot && p.name === piece.itemName);
      if (!item) return null;
      // Ammo isn't an iterated slot (it's auto-paired per weapon), so an
      // ammo set piece only needs to be present in the pool.
      if (piece.slot === 'ammo') continue;
      pinned[piece.slot] = [item];
    }
    return pinned;
  };

  for (const weapon of weapons) {
    const ammo = pairAmmoForWeapon(weapon, ammoPool);
    const stances = stancesForStyle(weapon, style);
    const triggeredSets = setsActivatedByWeapon(weapon.name);

    for (const stance of stances) {
      // Frontier set for this stance's attack type (melee) or 'all'.
      const baseFrontiers = frontiersFor(frontierKeyForStance(style, stance));

      for (const spell of spellOptions) {
        // Normal pass — Pareto-pruned frontiers. Covers loadouts where no
        // set bonus is involved.
        iterateOverArmour(weapon, ammo, stance, spell, baseFrontiers);

        // Set-pinned passes — one per set the current weapon can trigger.
        // Forces the set's armour pieces into their slots so the calc
        // actually sees a complete set and applies its bonus.
        for (const set of triggeredSets) {
          const pinned = pinSetFrontiers(set.name, baseFrontiers);
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

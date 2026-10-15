// ============================================================================
// Item dominance — when can the calc engine NEVER rate item X above item Y?
//
// `dominates(y, x, key)` returns true only when, for every monster and every
// loadout the sim evaluates under attack type `key`, swapping X for Y can't
// make the sim's ranking worse: DPS can't drop, and the sim's tie-breaks
// (defence total, then prayer — loadoutSim.ts) can't drop on a DPS tie.
// Every rule below is derived from what the vendored calc engine actually
// reads; the line references are to the audit of src/lib that produced
// them (upstream 89c3e25, 2026-09-02). Nothing here samples monsters.
//
// "Y is at least as good as X under `key`" (atLeastAsGood) iff ALL hold:
//   1. Same slot.
//   2. Y and X have IDENTICAL effect signatures (effectSignature): for every
//      calc name literal (itemEffectTags.ts) the name contains, whether it
//      equals / starts with / ends with it; plus set-bonus membership
//      (setBonuses.ts) and item-ID lists (BLOWPIPE_IDS, Equipment.ts:333).
//      Identical signatures => every name / ID check in the calc takes the
//      same branch for both, whatever operator it uses. A superset would NOT
//      be enough: 'Salve amulet (e)' contains 'Salve amulet' but fails the
//      exact check `wearing('Salve amulet')`, and extra effects can be
//      penalties (Keris partisan of amascut outside ToA, Equipment.ts:348).
//   3. Weapons: same category (=> same stances, attack types and the calc's
//      category rules — POLEARM vs flying, PICKAXE vs Guardians, ...), Y
//      not slower, Y one-handed if X is, and Y fires every ammo X fires.
//   4. Ammo, ranged key only: every launcher that fires X also fires Y —
//      ammo ranged stats only apply when the launcher accepts it
//      (Equipment.ts:314), and invalid ammo zeroes ranged output.
//   5. Y >= X on every stat the calc reads for `key` (statVector):
//        every key: PRAYER bonus — Glyphic Attenuation monster versions
//          scale melee, ranged and magic max hits with it
//          (PlayerVsNPCCalc.ts:518/799/1078, factor at :2529).
//        stab/slash/crush: melee strength + that type's accuracy; plus the
//          stab+slash+crush+ranged DEFENCE total for the bulwark's attack
//          types, which Dinh's bulwark converts into strength
//          (Equipment.ts:353) — armour and bulwarks only.
//        ranged: ranged strength + ranged accuracy + MELEE strength (Eclipse
//          atlatl and Hunter's spear take max hit from melee strength,
//          PlayerVsNPCCalc.ts:637/699).
//        magic: magic damage + magic accuracy.
//   6. Crush key: Y's crush gain over X is at least its stab and slash gain.
//      The Hueycoatl tail gives crush a better damage limiter only while
//      crush accuracy is the loadout's highest (PlayerVsNPCCalc.ts:2003), so
//      a "better" item that raised stab past crush could lower DPS there.
//   7. Defence total of Y >= X's. DPS can tie even when Y's offence is
//      higher (max hits are floored), and on a DPS tie the sim prefers the
//      loadout with more defence (prayer, its next tie-break, is already
//      covered by rule 5).
//
// Y DOMINATES X iff Y is at least as good as X, and either X is NOT at
// least as good as Y, or the two are interchangeable (each at least as good
// as the other) and Y has the lower id — so exactly one of a duplicate pair
// is dominated, and a tie on one stat never protects the less capable item
// (a Yew shortbow ties a Shortbow on every stat it reads but fires more
// ammo, so it dominates).
//
// Keys: weapons are judged under the attack types the sim actually tries
// for them (loadoutSim.simAttackTypesForWeapon — e.g. never manual casting
// with a bow, because the sim doesn't); armour and ammo under every key.
//
// Items are compared as the calc sees them: getCanonicalItem() first (the
// calc replaces cosmetic / locked / degraded variants with their base item
// before any check, Equipment.ts:212 + BaseCalc.ts:141).
//
// ASSUMPTIONS — re-audit if any change:
//   - Special attacks aren't simulated (loadoutSim never sets
//     usingSpecialAttack) — spec-only behaviour (e.g. ogre-bow-style
//     "ignore other gear" specs) is out of scope.
//   - The calc audit above is current. After every `npm run sync-upstream`:
//     re-run `npx jest ItemEffectTagsGen`, and re-check every read of
//     player bonuses / offensive / defensive stats, item-ID lists and
//     per-item stat reads in src/lib for rules this file doesn't cover.
// ============================================================================

import type { EquipmentPiece } from '@/types/Player';
import { AmmoApplicability, ammoApplicability, getCanonicalItem } from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { getCombatStylesForCategory } from '@/utils';
import { SET_BONUSES } from '@/upgrade/lib/setBonuses';
import { CALC_ITEM_NAME_LITERALS } from '@/upgrade/lib/itemEffectTags';
import { simAttackTypesForWeapon } from '@/upgrade/lib/loadoutSim';

// =====
// Public types
// =====

/** The attack types an item can contribute DPS under. */
export type DominanceKey = 'stab' | 'slash' | 'crush' | 'ranged' | 'magic';

export const ALL_DOMINANCE_KEYS: readonly DominanceKey[] = ['stab', 'slash', 'crush', 'ranged', 'magic'];

export interface DominanceContext {
  /** Every ammo id in play — a launcher must fire everything X fires. */
  ammoIds: readonly number[];
  /** Every launcher id in play — ammo is judged only against these. */
  launcherIds: readonly number[];
}

// =====
// Canonical view — memoised because getCanonicalItemId scans the whole
// alias table on every call.
// =====
const canonicalCache = new Map<number, EquipmentPiece>();

export function canonical(item: EquipmentPiece): EquipmentPiece {
  let c = canonicalCache.get(item.id);
  if (!c) {
    c = getCanonicalItem(item);
    canonicalCache.set(item.id, c);
  }
  return c;
}

// =====
// Effect signature (rule 2) — one string per item; equal strings mean every
// name / ID check in the calc treats the two items the same way.
// =====
const signatureCache = new Map<number, string>();

export function effectSignature(item: EquipmentPiece): string {
  const cached = signatureCache.get(item.id);
  if (cached !== undefined) return cached;
  const c = canonical(item);
  const parts: string[] = [];
  for (const lit of CALC_ITEM_NAME_LITERALS) {
    if (!c.name.includes(lit)) continue;
    // = equals, ^ starts with, $ ends with (contains is implied).
    const flags = `${c.name === lit ? '=' : ''}${c.name.startsWith(lit) ? '^' : ''}${c.name.endsWith(lit) ? '$' : ''}`;
    parts.push(`name:${lit}:${flags}`);
  }
  for (const set of SET_BONUSES) {
    if (set.pieces.some((p) => p.itemName === c.name)) parts.push(`set:${set.name}`);
    if (set.triggerWeapons.includes(c.name)) parts.push(`set-trigger:${set.name}`);
  }
  if (BLOWPIPE_IDS.includes(c.id)) parts.push('id:blowpipe');
  const sig = parts.join('|');
  signatureCache.set(item.id, sig);
  return sig;
}

// =====
// Attack types per item
// =====

/**
 * The keys under which an item can affect the sim's result. Weapons: the
 * attack types of the stances the sim tries for them (empty if no sim style
 * accepts the weapon). Armour and ammo: every key — ammo's non-ranged stats
 * apply with any weapon (Equipment.ts:350).
 */
export function keysForItem(item: EquipmentPiece): readonly DominanceKey[] {
  const c = canonical(item);
  if (c.slot !== 'weapon') return ALL_DOMINANCE_KEYS;
  return simAttackTypesForWeapon(c).filter((t): t is DominanceKey => t !== null);
}

// =====
// Launchers — weapons whose ammo slot must hold matching ammo
// (ammoApplicability returns INVALID when given no ammo at all).
// =====
export function isLauncher(item: EquipmentPiece): boolean {
  const c = canonical(item);
  return c.slot === 'weapon' && ammoApplicability(c.id, undefined) === AmmoApplicability.INVALID;
}

function fires(launcherId: number, ammoId: number): boolean {
  return ammoApplicability(launcherId, ammoId) === AmmoApplicability.INCLUDED;
}

// =====
// Stat vectors (rule 5)
// =====
const BULWARK_TYPES: ReadonlySet<DominanceKey> = new Set(
  getCombatStylesForCategory(EquipmentCategory.BULWARK)
    .map((s) => s.type)
    .filter((t): t is DominanceKey => t !== null),
);

function bulwarkDefenceTotal(p: EquipmentPiece): number {
  return p.defensive.stab + p.defensive.slash + p.defensive.crush + p.defensive.ranged;
}

function statVector(p: EquipmentPiece, key: DominanceKey): number[] {
  // Prayer leads every vector: Glyphic Attenuation scales all three styles.
  if (key === 'ranged') return [p.bonuses.prayer, p.bonuses.ranged_str, p.offensive.ranged, p.bonuses.str];
  if (key === 'magic') return [p.bonuses.prayer, p.bonuses.magic_str, p.offensive.magic];
  const v = [p.bonuses.prayer, p.bonuses.str, p.offensive[key]];
  if (BULWARK_TYPES.has(key) && (p.slot !== 'weapon' || p.category === EquipmentCategory.BULWARK)) {
    v.push(bulwarkDefenceTotal(p));
  }
  return v;
}

function defenceTotal(p: EquipmentPiece): number {
  const d = p.defensive;
  return d.stab + d.slash + d.crush + d.magic + d.ranged;
}

// =====
// Dominance
// =====

/**
 * True iff swapping `xIn` for `yIn` can never make the sim's ranking worse
 * under attack type `key` (rules 1-7 in the file header).
 */
function atLeastAsGood(
  yIn: EquipmentPiece,
  xIn: EquipmentPiece,
  key: DominanceKey,
  ctx: DominanceContext,
): boolean {
  const y = canonical(yIn);
  const x = canonical(xIn);

  // ----- Rules 1-2: slot + effects -----
  if (y.slot !== x.slot) return false;
  if (effectSignature(yIn) !== effectSignature(xIn)) return false;

  // ----- Rule 3: weapon mechanics -----
  if (x.slot === 'weapon') {
    if (y.category !== x.category) return false;
    if (y.speed > x.speed) return false;
    if (y.isTwoHanded && !x.isTwoHanded) return false;
    for (const a of ctx.ammoIds) if (fires(x.id, a) && !fires(y.id, a)) return false;
  }

  // ----- Rule 4: ammo acceptance -----
  if (x.slot === 'ammo' && key === 'ranged') {
    for (const l of ctx.launcherIds) if (fires(l, x.id) && !fires(l, y.id)) return false;
  }

  // ----- Rule 5: every stat the calc reads for this key -----
  const vy = statVector(y, key);
  const vx = statVector(x, key);
  for (let i = 0; i < vy.length; i += 1) if (vy[i] < vx[i]) return false;

  // ----- Rule 6: Hueycoatl tail crush-highest guard -----
  if (key === 'crush') {
    const crushGain = y.offensive.crush - x.offensive.crush;
    if (y.offensive.stab - x.offensive.stab > crushGain) return false;
    if (y.offensive.slash - x.offensive.slash > crushGain) return false;
  }

  // ----- Rule 7: the sim's defence tie-break (prayer is in rule 5) -----
  return defenceTotal(y) >= defenceTotal(x);
}

/**
 * True iff `yIn` dominates `xIn` under attack type `key`: Y is at least as
 * good, and X is not — or they're interchangeable and Y has the lower id.
 */
export function dominates(
  yIn: EquipmentPiece,
  xIn: EquipmentPiece,
  key: DominanceKey,
  ctx: DominanceContext,
): boolean {
  if (yIn.id === xIn.id) return false;
  if (!atLeastAsGood(yIn, xIn, key, ctx)) return false;
  if (atLeastAsGood(xIn, yIn, key, ctx)) return yIn.id < xIn.id;
  return true;
}

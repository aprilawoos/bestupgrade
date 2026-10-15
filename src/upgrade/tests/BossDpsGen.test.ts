// ============================================================================
// Generator: reads `.scratch/bis.json` (wiki BIS per boss) + temple IMEHB rates,
// runs the calc engine, and emits `src/upgrade/lib/bosses.ts` with the typed
// dataset.
//
// This test is NOT a unit test — it's a one-off codegen step that runs through
// Jest because Jest is the path that resolves `@/...` aliases + TypeScript +
// the calc engine without extra tooling. Re-run when wiki BIS or temple rates
// change.
//
// A kill is modelled as one of (bis.json fields):
//   - single form: `wikiVersion` (required whenever the monster has several
//     forms in monsters.json — the generator refuses to guess);
//   - `segments`: damage-gated phases (forms that swap on HP / damage), each
//     with its own HP and optional setup; fight time = sum of hp / dps;
//   - `timeWeighted`: time-gated forms (Zulrah's rotation); the fight runs at
//     the weight-averaged DPS;
//   - `shield`: an extra phase timed by attacks needed to drain a shield.
// Everything the calc can't model (healing, immunity windows, minions,
// banking) is left to the overhead = 3600 / kph - fight time.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { describe, test } from '@jest/globals';
import {
  calculatePlayerVsNpc,
  getTestMonster,
  getTestPlayer,
} from '@/tests/utils/TestUtils';
import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { EquipmentPiece, Player, PlayerSkills } from '@/types/Player';
import { Monster } from '@/types/Monster';
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { getCombatStylesForCategory, PotionMap } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { PartialDeep } from 'type-fest';
import eqJson from '../../../cdn/json/equipment.json';
import monstersJson from '../../../cdn/json/monsters.json';
import { resolveEquipmentName } from '@/upgrade/tests/equipmentNames';

const equipment = eqJson as EquipmentPiece[];
const monsterRows = monstersJson as unknown as { name: string; version: string }[];

// =====
// Item lookup that prefers the canonical (empty-version) variant — needed
// because findEquipment from TestUtils with version='' returns first match,
// which for items like "Salve amulet(ei)" can be a minigame variant.
// =====
// When no version is named and the item has no empty-version entry, take the
// usable variant — the first-match fallback used to land on 'Broken' /
// 'Uncharged' / 'Empty' forms (Fighter torso, Ava's assembler, ...).
const USABLE_VARIANTS = ['Charged', 'Normal', 'New', 'Undamaged', 'Full', 'Active'];

function findEq(rawName: string, version: string = ''): EquipmentPiece {
  // BIS gear names are wiki spellings; resolve to equipment.json's current one.
  const name = resolveEquipmentName(rawName);
  if (version) {
    const hit = equipment.find((e) => e.name === name && e.version === version);
    if (!hit) throw new Error(`Equipment not found: ${name} [version=${version}]`);
    return hit;
  }
  const variants = equipment.filter((e) => e.name === name);
  if (variants.length === 0) throw new Error(`Equipment not found: ${name}`);
  const canonical = variants.find((e) => e.version === '');
  if (canonical) return canonical;
  for (const v of USABLE_VARIANTS) {
    const hit = variants.find((e) => e.version === v);
    if (hit) return hit;
  }
  return variants[0];
}

// =====
// Style picker: from a weapon's category + a target stance + an optional damage
// type, returns the in-game combat style object. Falls back to first-match if
// the exact (stance + type) pair doesn't exist for that category.
// =====
function pickStyle(weapon: EquipmentPiece, stance: string, typeHint?: string): PlayerCombatStyle {
  const styles = getCombatStylesForCategory(weapon.category || EquipmentCategory.NONE);
  if (typeHint) {
    const exact = styles.find((s) => s.stance === stance && s.type === typeHint);
    if (exact) return exact;
  }
  const stanceMatch = styles.find((s) => s.stance === stance);
  if (stanceMatch) return stanceMatch;
  return styles[0];
}

// =====
// Temple IMEHB rates — manually inlined from /api/rates/ehb_rates.php?rate=im
// snapshot of 2026-02-25. Re-fetch to refresh.
// =====
const TEMPLE_IMEHB: Record<string, number> = {
  'Abyssal Sire': 44, 'Alchemical Hydra': 29, 'Amoxliatl': 71, 'Araxxor': 38,
  'Artio': 50, 'Barrows Chests': 22, 'Bryophyta': 9, 'Brutus': 250,
  'Callisto': 142, "Calvar'ion": 45, 'Cerberus': 54, 'Chambers of Xeric': 3.5,
  'Chambers of Xeric Challenge Mode': 3, 'Chaos Elemental': 48, 'Chaos Fanatic': 80,
  'Commander Zilyana': 30, 'Corporeal Beast': 10, 'Crazy Archaeologist': 95,
  'Dagannoth Prime': 100, 'Dagannoth Rex': 100, 'Dagannoth Supreme': 100,
  'Deranged Archaeologist': 95, 'Doom of Mokhaiotl': 18, 'Duke Sucellus': 37,
  'General Graardor': 31, 'Giant Mole': 97, 'Grotesque Guardians': 34,
  'Hespori': 50, 'Hueycoatl': 9, 'Kalphite Queen': 37, 'King Black Dragon': 75,
  'Kraken': 90, "Kree'arra": 30, "K'ril Tsutsaroth": 32, 'Lunar Chests': 18,
  'Mimic': 50, 'Nex': 15, 'Obor': 12, 'Phantom Muspah': 27,
  "Phosani's Nightmare": 9.3, 'Sarachnis': 67, 'Scorpia': 80, 'Scurrius': 60,
  'Shellbane Gryphon': 95, 'Skotizo': 38, 'Sol Heredit': 2.8, 'Spindel': 50,
  'The Corrupted Gauntlet': 7.2, 'The Gauntlet': 10, 'The Leviathan': 27,
  'The Nightmare': 11, 'The Royal Titans': 55, 'The Whisperer': 21,
  'Theatre of Blood': 3.2, 'Theatre of Blood Challenge Mode': 3,
  'Thermonuclear Smoke Devil': 100, 'Tombs of Amascut': 3.7,
  'Tombs of Amascut Expert': 3, 'TzKal-Zuk': 1, 'TzTok-Jad': 2.2,
  'Vardorvis': 37, 'Venenatis': 80, "Vet'ion": 39, 'Vorkath': 34,
  'Yama': 18, 'Zulrah': 42,
};

// =====
// Damage-type override per boss for weapons that support multiple types
// (Scythe slash vs crush, Keris partisan stab vs crush, etc.). Used by
// pickStyle when the wiki recommends a specific type.
// =====
const DAMAGE_TYPE: Record<string, 'slash' | 'stab' | 'crush'> = {
  Amoxliatl: 'crush',
  Araxxor: 'crush',
  Cerberus: 'crush',
  'Phosani\'s Nightmare': 'crush',
  Sarachnis: 'crush',
  'The Nightmare': 'crush',
  Hueycoatl: 'slash', // DHL polearm has no crush option; slash via Swipe
  'Corporeal Beast': 'stab',
  'General Graardor': 'stab',
  'Kalphite Queen': 'stab',
  'King Black Dragon': 'stab',
  Vorkath: 'stab',
  Nex: 'stab',
  "K'ril Tsutsaroth": 'slash', // Emberlight slash
  Yama: 'slash',
  Skotizo: 'slash',
  'Abyssal Sire': 'slash',
  Vardorvis: 'slash',
  'Duke Sucellus': 'slash',
  Venenatis: 'crush', // Ursine chainmace crush
  "Vet'ion": 'crush',
  "Calvar'ion": 'crush',
  Spindel: 'crush',
  'Chaos Elemental': 'crush',
};

// =====
// Special-case entries (raids + wave-based + multi-encounter) — kph + note,
// no DPS computed.
// =====
interface SpecialEntry { name: string; kph: number; note: string; }
const SPECIAL: SpecialEntry[] = [
  { name: 'Barrows Chests', kph: 22, note: '6 brothers, 4 styles required — no single-loadout DPS' },
  { name: 'Chambers of Xeric', kph: 3.5, note: 'raid: multi-room, style switches per encounter' },
  { name: 'Chambers of Xeric Challenge Mode', kph: 3, note: 'raid CM: multi-room, style switches per encounter' },
  { name: 'Theatre of Blood', kph: 3.2, note: 'raid: 6 rooms, melee/ranged/magic across encounters' },
  { name: 'Theatre of Blood Challenge Mode', kph: 3, note: 'raid HM: 6 rooms, melee/ranged/magic across encounters' },
  { name: 'Tombs of Amascut', kph: 3.7, note: 'raid: scalable invocations, all 3 styles used' },
  { name: 'Tombs of Amascut Expert', kph: 3, note: 'raid expert: scalable invocations, all 3 styles used' },
  { name: 'The Gauntlet', kph: 10, note: 'minigame: crystal-prep gauntlet, custom gear inside' },
  { name: 'The Corrupted Gauntlet', kph: 7.2, note: 'minigame: corrupted variant, custom crystal gear inside' },
  { name: 'TzKal-Zuk', kph: 1, note: 'wave-based (Inferno): full completion incl 60+ waves' },
  { name: 'TzTok-Jad', kph: 2.2, note: 'wave-based (Fight Caves): full completion incl 63 waves' },
  { name: 'Sol Heredit', kph: 2.8, note: 'wave-based (Colosseum): full 12-wave completion' },
  { name: 'Lunar Chests', kph: 18, note: 'rotating 3-boss minigame, mixed styles' },
];

// =====
// Solo kill-rate overrides — where Temple's ironman rate is a GROUP method
// (its main-account method note), use the wiki's solo money-making-guide rate
// instead. Where both are solo but disagree, Temple stands (user decision
// 2026-10-15).
// =====
const SOLO_RATE_OVERRIDE: Record<string, { kph: number; source: string }> = {
  Yama: { kph: 10, source: 'wiki Money_making_guide/Killing_Yama_(solo) "kph = 10" (magic only); Temple 18/h is a duo method' },
};

// Bosses fought in the Wilderness — wilderness weapons (Ursine chainmace,
// Webweaver bow, Accursed sceptre) only get their bonus with
// buffs.inWilderness set (BaseCalc.isRevWeaponBuffApplicable).
const WILDERNESS = new Set([
  'Artio', 'Callisto', "Calvar'ion", "Vet'ion", 'Spindel', 'Venenatis',
  'Chaos Elemental', 'Chaos Fanatic', 'Crazy Archaeologist', 'Scorpia',
]);

// =====
// bis.json schema
// =====
type BossStyle = 'melee' | 'ranged' | 'magic';
type MeleeType = 'slash' | 'stab' | 'crush';

interface SetupSpec {
  style: BossStyle;
  styleStance: string;
  prayer: string;
  potion: string;
  onSlayerTask: boolean;
  /** Overrides DAMAGE_TYPE for weapons with several melee types. */
  damageType?: MeleeType;
  /** Slot -> item name, plus optional `${slot}Version` keys. Replaced wholesale by a phase setup. */
  gear: Record<string, string | null>;
}

interface SegmentSpec {
  label: string;
  /** Monster name when the segment fights something else (e.g. hellhounds). */
  monster?: string;
  version: string;
  /** Damage dealt in this segment. */
  hp: number;
  setup?: Partial<SetupSpec>;
}

interface TimeWeightSpec {
  label: string;
  version: string;
  /** Relative share of fight time spent against this form. */
  weight: number;
  setup?: Partial<SetupSpec>;
}

interface ShieldSpec {
  label: string;
  version: string;
  shieldHp: number;
  drainPerAttack: number;
  procChance: number;
  procDrain: number;
  setup?: Partial<SetupSpec>;
}

interface BisJsonEntry extends SetupSpec {
  name: string;
  wikiVersion: string;
  note: string;
  monsterInputs?: Record<string, unknown>;
  segments?: SegmentSpec[];
  timeWeighted?: TimeWeightSpec[];
  shield?: ShieldSpec;
  /** Gear patches tried in turn (wiki "check the DPS for each"); the fastest kill is kept. */
  gearAlternatives?: Record<string, string | null>[];
  /** Set for group content: the kill rate isn't a solo rate. */
  groupContent?: string;
}

// =====
// Emitted schema (mirrors the header written by emit())
// =====
interface PhaseResult {
  label: string;
  monster: string;
  version: string;
  style: BossStyle;
  hp?: number;
  weight?: number;
  dps?: number;
  attacks?: number;
  seconds?: number;
}

interface BossBaseline {
  name: string;
  kph: number;
  rateSource: 'temple-im' | 'wiki-solo';
  rateNote?: string;
  groupContent?: string;
  bis?: {
    style: BossStyle;
    stance: string;
    prayer: string;
    potion: string;
    onSlayerTask: boolean;
    monsterVersion: string;
    gear: Record<string, string | null>;
  };
  dps?: number;
  maxHit?: number;
  accuracy?: number;
  monsterHp?: number;
  ttkSec?: number;
  overheadSec?: number;
  phases?: PhaseResult[];
  note?: string;
}

const PRAYER_MAP: Record<string, Prayer> = {
  PIETY: Prayer.PIETY,
  RIGOUR: Prayer.RIGOUR,
  AUGURY: Prayer.AUGURY,
  CHIVALRY: Prayer.CHIVALRY,
  EAGLE_EYE: Prayer.EAGLE_EYE,
  MYSTIC_MIGHT: Prayer.MYSTIC_MIGHT,
};

const POTION_MAP: Record<string, Potion> = {
  SUPER_COMBAT: Potion.SUPER_COMBAT,
  OVERLOAD: Potion.OVERLOAD,
  RANGING: Potion.RANGING,
  SUPER_RANGING: Potion.SUPER_RANGING,
  MAGIC: Potion.MAGIC,
  SATURATED_HEART: Potion.SATURATED_HEART,
  IMBUED_HEART: Potion.IMBUED_HEART,
};

// Manual fixups for item-name discrepancies between wiki naming and equipment.json
function fixupGearName(slot: string, name: string): { name: string; version?: string } {
  if (name === 'Ring of suffering (ri)') return { name: 'Ring of suffering (i)', version: 'Recoil' };
  if (name === 'Blessed boots') return { name: 'Mixed hide boots' };
  return { name };
}

function buildEquipmentLoadout(gear: SetupSpec['gear']): Partial<Player['equipment']> {
  const slots: (keyof Player['equipment'])[] = [
    'head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring',
  ];
  const out: Partial<Player['equipment']> = {};
  for (const slot of slots) {
    const rawName = gear[slot];
    if (!rawName) { out[slot] = null; continue; }
    const fixed = fixupGearName(slot, rawName);
    const versionKey = `${slot}Version`;
    const version = fixed.version ?? (gear[versionKey] as string | undefined) ?? '';
    out[slot] = findEq(fixed.name, version);
  }
  // Blowpipe needs a loaded dart via itemVars. The Dragon dart canonical entry
  // uses version='Unpoisoned' (no empty-version variant exists in the data).
  if (out.weapon?.name === 'Toxic blowpipe') {
    const dart = findEq('Dragon dart', 'Unpoisoned');
    out.weapon = {
      ...out.weapon,
      itemVars: { blowpipeDartId: dart.id, blowpipeDartName: dart.name },
    };
  }
  // The calc counts a shield's bonuses even under a two-handed weapon (only
  // the UI's state store strips it), so drop it here.
  if (out.weapon?.isTwoHanded) out.shield = null;
  return out;
}

// Monster-name fixups: maps boss display name → (canonical monster name, version)
// for cases where temple/wiki naming doesn't match the equipment-data dump.
const MONSTER_FIX: Record<string, { name: string; version: string }> = {
  'Crazy Archaeologist': { name: 'Crazy archaeologist', version: '' },
  'Deranged Archaeologist': { name: 'Deranged archaeologist', version: '' },
  'Duke Sucellus': { name: 'Duke Sucellus', version: 'Post-quest, Awake' },
  'Grotesque Guardians': { name: 'Dusk', version: 'Second form' }, // Dusk is the harder twin; calc against final form
  'Hueycoatl': { name: 'The Hueycoatl', version: 'Normal' },
  'Mimic': { name: 'The Mimic', version: '' },
  'Shellbane Gryphon': { name: 'Shellbane gryphon', version: '' },
  'The Leviathan': { name: 'The Leviathan', version: 'Post-quest' },
  'The Royal Titans': { name: 'Fire elemental (Royal Titans)', version: '' }, // pair-fight; pick one as representative
  'The Whisperer': { name: 'The Whisperer', version: 'Post-quest' },
  'Thermonuclear Smoke Devil': { name: 'Thermonuclear smoke devil', version: '' },
  'Vardorvis': { name: 'Vardorvis', version: 'Post-quest' },
};

// =====
// Monster resolution — refuses to guess a form. getTestMonster with an empty
// version silently takes the first monsters.json row, which is how Muspah
// ended up computed against its Melee form and Scurrius against Group.
// =====
function resolveMonster(name: string, version: string, inputs?: Record<string, unknown>): Monster {
  if (!version) {
    const forms = monsterRows.filter((m) => m.name === name).map((m) => m.version);
    if (forms.length > 1) {
      throw new Error(`'${name}' has ${forms.length} forms (${forms.join(' / ')}); bis.json must name one`);
    }
  }
  const monster = getTestMonster(name, version);
  if (inputs) monster.inputs = { ...monster.inputs, ...inputs };
  return monster;
}

// Mirrors the UI's potion handling (state.tsx recomputeBoosts): per stat, the
// highest boost any active potion gives. getTestPlayer stores buffs.potions
// but never turns them into boosts, and the calc only reads player.boosts.
function applyPotionBoosts(player: Player): void {
  const boosts: Partial<PlayerSkills> = {
    atk: 0, def: 0, magic: 0, prayer: 0, ranged: 0, str: 0, mining: 0, herblore: 0,
  };
  for (const p of player.buffs.potions) {
    const result = PotionMap[p].calculateFn(player.skills);
    for (const k of Object.keys(result) as (keyof PlayerSkills)[]) {
      const r = result[k] as number;
      if (r > (boosts[k] ?? 0)) boosts[k] = r;
    }
  }
  player.boosts = { ...player.boosts, ...boosts };
}

// =====
// One setup vs one monster form
// =====
interface SetupResult { dps: number; maxHit: number; accuracy: number; attackSpeed: number; hp: number }

function computeSetup(bossName: string, monster: Monster, setup: SetupSpec): SetupResult {
  const equipmentLoadout = buildEquipmentLoadout(setup.gear);
  const weapon = equipmentLoadout.weapon;
  if (!weapon) throw new Error('setup has no weapon');
  const style: PlayerCombatStyle = pickStyle(weapon, setup.styleStance, setup.damageType ?? DAMAGE_TYPE[bossName]);

  const overrides: PartialDeep<Player> = {
    skills: {
      atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99,
    },
    equipment: equipmentLoadout as any,
    prayers: [PRAYER_MAP[setup.prayer]],
    buffs: {
      potions: [POTION_MAP[setup.potion]],
      onSlayerTask: setup.onSlayerTask,
      inWilderness: WILDERNESS.has(bossName),
    },
    style: style as any,
  };
  const player = getTestPlayer(monster, overrides);
  applyPotionBoosts(player);
  const r = calculatePlayerVsNpc(monster, player);
  return {
    dps: r.dps,
    maxHit: r.maxHit,
    accuracy: r.accuracy,
    attackSpeed: player.attackSpeed,
    hp: monster.skills.hp,
  };
}

function mergeSetup(base: SetupSpec, override?: Partial<SetupSpec>): SetupSpec {
  if (!override) return base;
  return { ...base, ...override, gear: override.gear ?? base.gear };
}

// =====
// A whole kill
// =====
interface FightResult {
  fightSec: number;
  damagePerKill: number;
  primary: SetupResult & { version: string };
  phases: PhaseResult[];
}

function computeFight(entry: BisJsonEntry, gearPatch?: Record<string, string | null>): FightResult {
  const base: SetupSpec = {
    style: entry.style,
    styleStance: entry.styleStance,
    prayer: entry.prayer,
    potion: entry.potion,
    onSlayerTask: entry.onSlayerTask,
    damageType: entry.damageType,
    gear: gearPatch ? { ...entry.gear, ...gearPatch } : entry.gear,
  };
  const fix = MONSTER_FIX[entry.name];
  const baseMonster = fix?.name ?? entry.name;
  const baseVersion = fix?.version ?? entry.wikiVersion ?? '';
  const phases: PhaseResult[] = [];

  // ----- Time-gated forms: the fight runs at the weight-averaged DPS -----
  if (entry.timeWeighted) {
    const totalWeight = entry.timeWeighted.reduce((n, f) => n + f.weight, 0);
    let weightedDps = 0;
    let primary: FightResult['primary'] | null = null;
    let hp = 0;
    for (const form of entry.timeWeighted) {
      const setup = mergeSetup(base, form.setup);
      const r = computeSetup(entry.name, resolveMonster(baseMonster, form.version, entry.monsterInputs), setup);
      weightedDps += (form.weight / totalWeight) * r.dps;
      primary ??= { ...r, version: form.version };
      hp = r.hp;
      phases.push({ label: form.label, monster: baseMonster, version: form.version, style: setup.style,
        weight: Number((form.weight / totalWeight).toFixed(3)), dps: Number(r.dps.toFixed(4)) });
    }
    return { fightSec: hp / weightedDps, damagePerKill: hp, primary: primary!, phases };
  }

  // ----- Damage-gated segments (single form = one segment of full HP) -----
  const segments: SegmentSpec[] = entry.segments ?? [{ label: baseVersion || baseMonster, version: baseVersion, hp: NaN }];
  let fightSec = 0;
  let damagePerKill = 0;
  let primary: FightResult['primary'] | null = null;
  for (const seg of segments) {
    const setup = mergeSetup(base, seg.setup);
    const monsterName = seg.monster ?? baseMonster;
    const r = computeSetup(entry.name, resolveMonster(monsterName, seg.version, entry.monsterInputs), setup);
    const hp = Number.isNaN(seg.hp) ? r.hp : seg.hp;
    const seconds = hp / r.dps;
    fightSec += seconds;
    damagePerKill += hp;
    primary ??= { ...r, version: seg.version };
    phases.push({ label: seg.label, monster: monsterName, version: seg.version, style: setup.style,
      hp, dps: Number(r.dps.toFixed(4)), seconds: Number(seconds.toFixed(2)) });
  }

  // ----- Shield phase: attacks needed to drain it, at the setup's speed -----
  if (entry.shield) {
    const sh = entry.shield;
    const setup = mergeSetup(base, sh.setup);
    const r = computeSetup(entry.name, resolveMonster(baseMonster, sh.version, entry.monsterInputs), setup);
    const attacks = Math.ceil(sh.shieldHp / (sh.drainPerAttack + sh.procChance * sh.procDrain));
    const seconds = attacks * r.attackSpeed * 0.6;
    fightSec += seconds;
    phases.push({ label: sh.label, monster: baseMonster, version: sh.version, style: setup.style,
      attacks, seconds: Number(seconds.toFixed(2)) });
  }

  return { fightSec, damagePerKill, primary: primary!, phases };
}

// =====
// Codegen
// =====
function emit(baselines: BossBaseline[]): string {
  const header = `// AUTO-GENERATED by src/upgrade/tests/BossDpsGen.test.ts — do not edit by hand.
// Source data:
//   - Wiki BIS: oldschool.runescape.wiki strategy pages (snapshot 2026-05;
//     19 bosses re-checked against the wiki 2026-10-15)
//   - Temple IMEHB rates: /api/rates/ehb_rates.php?rate=im snapshot 2026-02-25,
//     except where Temple's method is a group one (rateSource 'wiki-solo')
//   - DPS computed via the vendored weirdgloop calc engine (PlayerVsNPCCalc)
// To regenerate: \`npx jest BossDpsGen\`.
//
// Per-boss assumptions:
//   - All combat skills at 99; prayer + potion from the BIS entry (potion
//     boosts applied the way the UI applies them)
//   - Slayer helm (i) only equipped for slayer-locked bosses (on-task)
//   - Steady-state DPS per form: no spec attacks; multi-form kills are summed
//     per phase (see \`phases\`); healing / immunity windows / minions /
//     banking are left in overheadSec
//   - Raid + wave-based + multi-encounter entries omit DPS — see note

export type BossStyle = 'melee' | 'ranged' | 'magic';

export interface BossBis {
  style: BossStyle;
  stance: string;
  prayer: string;
  potion: string;
  onSlayerTask: boolean;
  monsterVersion: string; // form of the first phase
  gear: {
    head: string | null;
    cape: string | null;
    neck: string | null;
    ammo: string | null;
    weapon: string | null;
    body: string | null;
    shield: string | null;
    legs: string | null;
    hands: string | null;
    feet: string | null;
    ring: string | null;
  };
}

export interface BossPhase {
  label: string;
  monster: string;
  version: string;
  style: BossStyle;
  hp?: number;            // damage dealt in this phase (damage-gated phases)
  weight?: number;        // share of fight time (time-gated forms)
  dps?: number;
  attacks?: number;       // shield phases: attacks needed
  seconds?: number;
}

export interface BossBaseline {
  name: string;
  kph: number;            // kills/hour — see rateSource
  rateSource: 'temple-im' | 'wiki-solo';
  rateNote?: string;
  groupContent?: string;  // set when the boss is group content (kph isn't a solo rate)
  bis?: BossBis;          // first phase's setup; omitted for raid / multi-encounter / wave-based entries
  dps?: number;           // effective DPS over the whole kill (damage per kill / fight time)
  maxHit?: number;        // first phase
  accuracy?: number;      // first phase, 0..1
  monsterHp?: number;     // damage dealt per kill (sum over phases)
  ttkSec?: number;        // fight time per kill (phases summed, no overkill)
  overheadSec?: number;   // 3600 / kph - ttkSec; negative => rate and model disagree
  phases?: BossPhase[];   // per-phase breakdown when the kill has several
  note?: string;
}
`;

  const sorted = [...baselines].sort((a, b) => a.name.localeCompare(b.name));
  const body = `\nexport const bossBaselines: BossBaseline[] = ${JSON.stringify(sorted, null, 2)};\n`;
  return header + body;
}

describe('BossDpsGen', () => {
  test('compute + emit src/upgrade/lib/bosses.ts', () => {
    const bisRaw = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../.scratch/bis.json'),
        'utf8',
      ),
    ) as BisJsonEntry[];

    const baselines: BossBaseline[] = [];
    const slots = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;

    for (const entry of bisRaw) {
      const temple = TEMPLE_IMEHB[entry.name];
      if (temple === undefined) {
        throw new Error(`No temple KPH found for boss: ${entry.name}`);
      }
      const override = SOLO_RATE_OVERRIDE[entry.name];
      const rate = {
        kph: override?.kph ?? temple,
        rateSource: override ? 'wiki-solo' as const : 'temple-im' as const,
        rateNote: override?.source,
        groupContent: entry.groupContent,
      };
      try {
        // Try each gear alternative; keep the fastest kill.
        const patches = entry.gearAlternatives ?? [undefined];
        let best: { fight: FightResult; patch?: Record<string, string | null> } | null = null;
        for (const patch of patches) {
          const fight = computeFight(entry, patch);
          if (!best || fight.fightSec < best.fight.fightSec) best = { fight, patch };
        }
        const { fight, patch } = best!;
        const gear = patch ? { ...entry.gear, ...patch } : entry.gear;
        const gearOut = Object.fromEntries(slots.map((s) => [s, gear[s] ?? null])) as Record<typeof slots[number], string | null>;
        const ttkSec = Number(fight.fightSec.toFixed(2));
        baselines.push({
          name: entry.name,
          ...rate,
          bis: {
            style: entry.style,
            stance: entry.styleStance,
            prayer: entry.prayer,
            potion: entry.potion,
            onSlayerTask: entry.onSlayerTask,
            monsterVersion: fight.primary.version,
            gear: gearOut,
          },
          dps: Number((fight.damagePerKill / fight.fightSec).toFixed(4)),
          maxHit: fight.primary.maxHit,
          accuracy: Number(fight.primary.accuracy.toFixed(4)),
          monsterHp: fight.damagePerKill,
          ttkSec,
          overheadSec: Number((3600 / rate.kph - ttkSec).toFixed(2)),
          phases: fight.phases.length > 1 ? fight.phases : undefined,
          note: entry.note || undefined,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[FAIL] ${entry.name}: ${(err as Error).message}`);
        baselines.push({
          name: entry.name,
          ...rate,
          note: `calc failed: ${(err as Error).message}`,
        });
      }
    }

    // Append special-case entries (no DPS, just KPH + note)
    for (const sp of SPECIAL) {
      baselines.push({ name: sp.name, kph: sp.kph, rateSource: 'temple-im', note: sp.note });
    }

    const ts = emit(baselines);
    const outPath = path.resolve(__dirname, '../lib/bosses.ts');
    fs.writeFileSync(outPath, ts, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\nWrote ${outPath} — ${baselines.length} entries (${baselines.filter((b) => b.dps !== undefined).length} with DPS)`);
  });
});

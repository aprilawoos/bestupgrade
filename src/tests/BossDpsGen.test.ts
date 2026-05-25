// ============================================================================
// Generator: reads `.scratch/bis.json` (wiki BIS per boss) + temple IMEHB rates,
// runs the calc engine, and emits `src/lib/bosses.ts` with the typed dataset.
//
// This test is NOT a unit test — it's a one-off codegen step that runs through
// Jest because Jest is the path that resolves `@/...` aliases + TypeScript +
// the calc engine without extra tooling. Re-run when wiki BIS or temple rates
// change.
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
import { EquipmentPiece, Player } from '@/types/Player';
import { PlayerCombatStyle, CombatStyleStance, CombatStyleType } from '@/types/PlayerCombatStyle';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { PartialDeep } from 'type-fest';
import eqJson from '../../cdn/json/equipment.json';

const equipment = eqJson as EquipmentPiece[];

// =====
// Item lookup that prefers the canonical (empty-version) variant — needed
// because findEquipment from TestUtils with version='' returns first match,
// which for items like "Salve amulet(ei)" can be a minigame variant.
// =====
function findEq(name: string, version: string = ''): EquipmentPiece {
  if (version) {
    const hit = equipment.find((e) => e.name === name && e.version === version);
    if (!hit) throw new Error(`Equipment not found: ${name} [version=${version}]`);
    return hit;
  }
  const canonical = equipment.find((e) => e.name === name && e.version === '');
  if (canonical) return canonical;
  const any = equipment.find((e) => e.name === name);
  if (!any) throw new Error(`Equipment not found: ${name}`);
  return any;
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
// Boss DPS computation
// =====
interface BisJsonEntry {
  name: string;
  wikiVersion: string;
  style: 'melee' | 'ranged' | 'magic';
  styleStance: string;
  prayer: string;
  potion: string;
  onSlayerTask: boolean;
  gear: Record<string, string | null>;
  note: string;
}

interface BossBaseline {
  name: string;
  kph: number;
  bis?: {
    style: 'melee' | 'ranged' | 'magic';
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

function buildEquipmentLoadout(gear: BisJsonEntry['gear']): Partial<Player['equipment']> {
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

function computeBossDps(entry: BisJsonEntry): { dps: number; maxHit: number; accuracy: number; hp: number } {
  const fix = MONSTER_FIX[entry.name];
  const monsterName = fix?.name ?? entry.name;
  const monsterVersion = fix?.version ?? entry.wikiVersion ?? '';
  const monster = getTestMonster(monsterName, monsterVersion);
  const weaponName = entry.gear.weapon!;
  const weaponFixed = fixupGearName('weapon', weaponName);
  const weaponVersion = (entry.gear as any).weaponVersion ?? weaponFixed.version ?? '';
  const weapon = findEq(weaponFixed.name, weaponVersion);
  const style = pickStyle(weapon, entry.styleStance, DAMAGE_TYPE[entry.name]);

  const overrides: PartialDeep<Player> = {
    skills: {
      atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99,
    },
    equipment: buildEquipmentLoadout(entry.gear) as any,
    prayers: [PRAYER_MAP[entry.prayer]],
    buffs: {
      potions: [POTION_MAP[entry.potion]],
      onSlayerTask: entry.onSlayerTask,
    },
    style: style as any,
  };
  const player = getTestPlayer(monster, overrides);
  const r = calculatePlayerVsNpc(monster, player);
  return {
    dps: r.dps,
    maxHit: r.maxHit,
    accuracy: r.accuracy,
    hp: monster.skills.hp,
  };
}

// =====
// Codegen
// =====
function emit(baselines: BossBaseline[]): string {
  const header = `// AUTO-GENERATED by src/tests/BossDpsGen.test.ts — do not edit by hand.
// Source data:
//   - Wiki BIS: oldschool.runescape.wiki strategy pages (snapshot 2026-05)
//   - Temple IMEHB rates: /api/rates/ehb_rates.php?rate=im snapshot 2026-02-25
//   - DPS computed via the vendored weirdgloop calc engine (PlayerVsNPCCalc)
// To regenerate: \`npx jest BossDpsGen\`.
//
// Per-boss assumptions:
//   - All combat skills at 99
//   - Highest applicable offensive prayer + style potion buff
//   - Slayer helm (i) only equipped for slayer-locked bosses (on-task)
//   - Steady-state DPS only: no spec attacks, no gear swaps, no phase changes
//   - Raid + wave-based + multi-encounter entries omit DPS — see note

export type BossStyle = 'melee' | 'ranged' | 'magic';

export interface BossBis {
  style: BossStyle;
  stance: string;
  prayer: string;
  potion: string;
  onSlayerTask: boolean;
  monsterVersion: string;
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

export interface BossBaseline {
  name: string;
  kph: number;            // Temple IMEHB ironman rate
  bis?: BossBis;          // omitted for raid / multi-encounter / wave-based entries
  dps?: number;           // steady-state DPS against the named monster
  maxHit?: number;
  accuracy?: number;      // 0..1
  monsterHp?: number;
  ttkSec?: number;        // hp / dps (theoretical perfect TTK, no overkill)
  note?: string;
}
`;

  const sorted = [...baselines].sort((a, b) => a.name.localeCompare(b.name));
  const body = `\nexport const bossBaselines: BossBaseline[] = ${JSON.stringify(sorted, null, 2)};\n`;
  return header + body;
}

describe('BossDpsGen', () => {
  test('compute + emit src/lib/bosses.ts', () => {
    const bisRaw = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../.scratch/bis.json'),
        'utf8',
      ),
    ) as BisJsonEntry[];

    const baselines: BossBaseline[] = [];

    for (const entry of bisRaw) {
      const kph = TEMPLE_IMEHB[entry.name];
      if (kph === undefined) {
        throw new Error(`No temple KPH found for boss: ${entry.name}`);
      }
      try {
        const r = computeBossDps(entry);
        const slotGear = (slot: string): string | null => entry.gear[slot] ?? null;
        const slots = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;
        const gearOut = Object.fromEntries(slots.map((s) => [s, slotGear(s)])) as Record<typeof slots[number], string | null>;
        baselines.push({
          name: entry.name,
          kph,
          bis: {
            style: entry.style,
            stance: entry.styleStance,
            prayer: entry.prayer,
            potion: entry.potion,
            onSlayerTask: entry.onSlayerTask,
            monsterVersion: entry.wikiVersion || '',
            gear: gearOut,
          },
          dps: Number(r.dps.toFixed(4)),
          maxHit: r.maxHit,
          accuracy: Number(r.accuracy.toFixed(4)),
          monsterHp: r.hp,
          ttkSec: Number((r.hp / r.dps).toFixed(2)),
          note: entry.note || undefined,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[FAIL] ${entry.name}: ${(err as Error).message}`);
        baselines.push({
          name: entry.name,
          kph,
          note: `calc failed: ${(err as Error).message}`,
        });
      }
    }

    // Append special-case entries (no DPS, just KPH + note)
    for (const sp of SPECIAL) {
      baselines.push({ name: sp.name, kph: sp.kph, note: sp.note });
    }

    const ts = emit(baselines);
    const outPath = path.resolve(__dirname, '../lib/bosses.ts');
    fs.writeFileSync(outPath, ts, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\nWrote ${outPath} — ${baselines.length} entries (${baselines.filter((b) => b.dps !== undefined).length} with DPS)`);
  });
});

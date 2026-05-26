// ============================================================================
// Generator: reads .scratch/boss_drops.json (wiki-researched per-boss unique
// equipment pool with access requirements and combine-prerequisite chains)
// and emits src/lib/bossDrops.ts with item id, slot, rarity, wield reqs, and
// the cross-boss component graph used by the kill-order analyser.
//
// Re-run: `npx jest BossDropsGen`.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { describe, test } from '@jest/globals';
import { EquipmentPiece } from '@/types/Player';
import { isCombatViable } from '@/lib/equipmentFilter';
import eqJson from '../../cdn/json/equipment.json';

const equipment = eqJson as EquipmentPiece[];

// =====
// Wiki-name -> equipment.json (name, version) fixups for cases where the
// wiki uses a different display string than the canonical entry.
// =====
const NAME_FIX: Record<string, { name: string; version: string }> = {
  // No active fixups — boss_drops.json lists final-form item names that
  // already match equipment.json entries. Add entries here only when a wiki
  // display name diverges from equipment.json (none currently known).
};

// Items whose canonical entry uses a non-empty version when wikiVersion is
// blank. Mirrors VendorStarterGen's PREFERRED_VERSION map.
const PREFERRED_VERSION: Record<string, string> = {
  'Trident of the seas': 'Full',
  "Tumeken's shadow": 'Uncharged',
  'Scythe of vitur': 'Uncharged',
  'Sanguinesti staff': 'Uncharged',
  'Tonalztics of ralos': 'Uncharged',
  "Dizana's quiver": 'Uncharged',
  'Eye of ayak': 'Uncharged',
  // Crystal weapons in equipment.json have Inactive (stat-less) and Charged
  // forms. Use Charged so the loadout sim sees usable stats.
  'Blade of saeldor': 'Charged',
  'Bow of faerdhinen': 'Charged',
  // Moon armours have Broken / New / Used. Drop form is New.
  'Blood moon helm': 'New',
  'Blood moon chestplate': 'New',
  'Blood moon tassets': 'New',
  'Blue moon helm': 'New',
  'Blue moon chestplate': 'New',
  'Blue moon tassets': 'New',
  'Eclipse moon helm': 'New',
  'Eclipse moon chestplate': 'New',
  'Eclipse moon tassets': 'New',
  // Charged/Uncharged variants
  'Dragonfire ward': 'Charged',
  'Dragonfire shield': 'Charged',
  "Bryophyta's staff": 'Charged',
  'Pendant of ates': 'Inert',
};

// Barrows charge-tier defaults — drops in "Undamaged" form which has full
// stats; "0/25/50/75/100" are partial-charge variants and "0" is stat-less.
for (const brother of ['Ahrim', 'Dharok', 'Guthan', 'Karil', 'Torag', 'Verac']) {
  const pieces: Record<string, string[]> = {
    Ahrim: ['hood', 'robetop', 'robeskirt', 'staff'],
    Dharok: ['helm', 'platebody', 'platelegs', 'greataxe'],
    Guthan: ['helm', 'platebody', 'chainskirt', 'warspear'],
    Karil: ['coif', 'leathertop', 'leatherskirt', 'crossbow'],
    Torag: ['helm', 'platebody', 'platelegs', 'hammers'],
    Verac: ['helm', 'brassard', 'plateskirt', 'flail'],
  };
  for (const p of pieces[brother]) {
    PREFERRED_VERSION[`${brother}'s ${p}`] = 'Undamaged';
  }
}

function findEq(name: string, version: string): EquipmentPiece | null {
  const fixed = NAME_FIX[`${name}|${version}`];
  if (fixed) {
    return equipment.find((e) => e.name === fixed.name && e.version === fixed.version) ?? null;
  }
  if (version) {
    const hit = equipment.find((e) => e.name === name && e.version === version);
    if (hit) return hit;
  }
  const preferred = PREFERRED_VERSION[name];
  if (preferred) {
    const hit = equipment.find((e) => e.name === name && e.version === preferred);
    if (hit) return hit;
  }
  const canonical = equipment.find((e) => e.name === name && e.version === '');
  if (canonical) return canonical;
  return equipment.find((e) => e.name === name) ?? null;
}

// =====
// Input shape from .scratch/boss_drops.json
// =====
interface RawBossAccess {
  questsCompleted: string[];
  questsStarted: string[];
  slayerLevel: number | null;
  onSlayerTask: boolean;
  skills: Record<string, number>;
}

interface RawPrerequisite {
  boss: string;
  item: string;
}

interface RawBuildReq {
  skills: Record<string, number>;
  questsCompleted: string[];
  questsStarted: string[];
}

interface RawDrop {
  name: string;
  wikiVersion: string;
  slot: string;
  rarity: string;
  rarityDenominator: number | null;
  isUnique: boolean;
  requirements?: Record<string, number>;
  questReqs?: { completed: string[]; started: string[] };
  buildRequirements?: RawBuildReq;
  prerequisiteDrops?: RawPrerequisite[];
  notes?: string;
}

interface RawBoss {
  boss: string;
  wikiUrl: string;
  templeKey: string;
  monsterIds: number[];
  bossAccess: RawBossAccess;
  drops: RawDrop[];
  notes?: string;
}

// =====
// Output shape (mirrored in src/lib/bossDrops.ts header below)
// =====
interface BossDropItem {
  itemId: number;
  name: string;
  version: string;
  slot: EquipmentPiece['slot'];
  rarity: string;
  rarityDenominator: number | null;
  isUnique: boolean;
  requirements: Record<string, number>;
  questReqs: { completed: string[]; started: string[] };
  buildRequirements: RawBuildReq;
  prerequisiteDrops: RawPrerequisite[];
  notes: string;
}

interface BossEntry {
  boss: string;
  wikiUrl: string;
  templeKey: string;
  monsterIds: number[];
  bossAccess: RawBossAccess;
  drops: BossDropItem[];
  notes: string;
}

function emit(bosses: BossEntry[]): string {
  const header = `// AUTO-GENERATED by src/tests/BossDropsGen.test.ts -- do not edit by hand.
// Source data:
//   - .scratch/boss_drops.json (wiki-researched per-boss unique equipment
//     pool with access requirements and combine-prerequisite chains)
//   - Validated against cdn/json/equipment.json (item IDs canonical)
//   - Filtered through isCombatViable (src/lib/equipmentFilter.ts)
//
// Inclusion criteria:
//   - Drop is on the boss's unique table (skips RDT/clue/generic mats).
//   - Item is equippable with a positive combat-relevant stat (or in the
//     noStatExceptions allowlist).
//   - Final-equipped-item form is listed; raw components are captured via
//     prerequisiteDrops (other-boss drops) and buildRequirements (skills/
//     quests needed to combine).
//
// Quest gates are RECORDED, not excluded — the kill-order sim handles them.

export interface BossAccess {
  /** Quests that must be COMPLETED to attempt this boss. */
  questsCompleted: string[];
  /** Quests that must be at least STARTED. */
  questsStarted: string[];
  /** Slayer level threshold, or null if not slayer-gated. */
  slayerLevel: number | null;
  /** True when the boss can only be killed while assigned that slayer task. */
  onSlayerTask: boolean;
  /** Any additional skill thresholds gating access (agility shortcuts, etc.). */
  skills: Record<string, number>;
}

export interface BossDropPrerequisite {
  /** Name of the OTHER boss whose drop is needed. */
  boss: string;
  /** Item name from that boss. */
  item: string;
}

export interface BossDropBuildReq {
  /** Skill thresholds needed to ASSEMBLE the final item from components. */
  skills: Record<string, number>;
  /** Quests/miniquests that must be completed to combine. */
  questsCompleted: string[];
  /** Quests that must be started to combine. */
  questsStarted: string[];
}

export interface BossDropItem {
  itemId: number;
  name: string;
  version: string;
  slot: 'head' | 'cape' | 'neck' | 'ammo' | 'weapon' | 'body' | 'shield' | 'legs' | 'hands' | 'feet' | 'ring';
  /** Wiki rarity expression verbatim (e.g. "1/512", "3/69 (purple)"). */
  rarity: string;
  /** Parsed denominator for kill-order expected-value math. null if unparseable. */
  rarityDenominator: number | null;
  /** True if from this boss's unique table (false reserved for future shared drops). */
  isUnique: boolean;
  /** Skill levels needed to WIELD/WEAR. */
  requirements: Record<string, number>;
  /** Quests needed to wield. */
  questReqs: { completed: string[]; started: string[] };
  /** Skills/quests needed to ASSEMBLE the final form from components. */
  buildRequirements: BossDropBuildReq;
  /** Other-boss drops needed to assemble the final form. */
  prerequisiteDrops: BossDropPrerequisite[];
  /** Caveats: shared-drop rules, awakened-mode rate diffs, etc. */
  notes: string;
}

export interface BossDropEntry {
  /** Temple IM-EHB display name; joins src/lib/bosses.ts. */
  boss: string;
  /** URL fetched during research. */
  wikiUrl: string;
  /** Temple's IM-EHB rate-table key (= boss in practice). */
  templeKey: string;
  /** cdn/json/monsters.json ids if known (multiple for boss variants). */
  monsterIds: number[];
  /** Boss-level access requirements. */
  bossAccess: BossAccess;
  /** Per-drop entries — only items that join equipment.json + pass isCombatViable. */
  drops: BossDropItem[];
  /** Boss-level note (e.g. "same pool as raid normal mode"). */
  notes: string;
}
`;

  return `${header}\nexport const bossDrops: BossDropEntry[] = ${JSON.stringify(bosses, null, 2)};\n`;
}

describe('BossDropsGen', () => {
  test('compute + emit src/lib/bossDrops.ts', () => {
    const raw = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../.scratch/boss_drops.json'),
        'utf8',
      ),
    ) as RawBoss[];

    const out: BossEntry[] = [];
    const dropped: { boss: string; name: string; version: string; reason: string }[] = [];

    for (const boss of raw) {
      const entry: BossEntry = {
        boss: boss.boss,
        wikiUrl: boss.wikiUrl,
        templeKey: boss.templeKey,
        monsterIds: boss.monsterIds ?? [],
        bossAccess: boss.bossAccess,
        drops: [],
        notes: boss.notes ?? '',
      };

      for (const d of boss.drops) {
        const piece = findEq(d.name, d.wikiVersion);
        if (!piece) {
          dropped.push({ boss: boss.boss, name: d.name, version: d.wikiVersion, reason: 'no equipment.json match' });
          continue;
        }
        if (!isCombatViable(piece)) {
          dropped.push({ boss: boss.boss, name: piece.name, version: piece.version, reason: 'fails isCombatViable' });
          continue;
        }
        entry.drops.push({
          itemId: piece.id,
          name: piece.name,
          version: piece.version,
          slot: piece.slot,
          rarity: d.rarity,
          rarityDenominator: d.rarityDenominator,
          isUnique: d.isUnique,
          requirements: d.requirements ?? {},
          questReqs: d.questReqs ?? { completed: [], started: [] },
          buildRequirements: d.buildRequirements ?? { skills: {}, questsCompleted: [], questsStarted: [] },
          prerequisiteDrops: d.prerequisiteDrops ?? [],
          notes: d.notes ?? '',
        });
      }

      out.push(entry);
    }

    const ts = emit(out);
    const outPath = path.resolve(__dirname, '../lib/bossDrops.ts');
    fs.writeFileSync(outPath, ts, 'utf8');
    /* eslint-disable no-console */
    const totalDrops = out.reduce((sum, b) => sum + b.drops.length, 0);
    console.log(`\nWrote ${outPath} -- ${out.length} bosses, ${totalDrops} unique items`);
    if (dropped.length) {
      const lines: string[] = [];
      for (const d of dropped) {
        lines.push(`  - [${d.boss}] ${d.name}${d.version ? ' (' + d.version + ')' : ''}: ${d.reason}`);
      }
      console.log(`Dropped ${dropped.length} entries:`);
      lines.forEach((l) => console.log(l));
    }
    /* eslint-enable no-console */
  });
});

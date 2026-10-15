// ============================================================================
// Generator: reads .scratch/misc_drops.json (wiki-researched non-boss / non-
// vendor equipment sources: quest rewards, slayer-monster unique drops,
// minigame shops, and skill-unlock items) and emits src/lib/miscDrops.ts
// with item id, slot, rarity, wield reqs, and the cross-source component
// graph used by the unified access resolver.
//
// Mirrors src/upgrade/tests/BossDropsGen.test.ts. Cross-pool prerequisites — a misc
// drop pointing at a boss-pool item, or vice versa — are resolved at runtime
// by src/lib/itemSourceIndex.ts; the generator only normalises and emits.
//
// Re-run: `npx jest MiscDropsGen`.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { describe, test } from '@jest/globals';
import { EquipmentPiece } from '@/types/Player';
import { isCombatViable } from '@/upgrade/lib/equipmentFilter';
import { resolveEquipmentName } from '@/upgrade/tests/equipmentNames';
import eqJson from '../../../cdn/json/equipment.json';

const equipment = eqJson as EquipmentPiece[];

// =====
// Wiki-name -> equipment.json (name, version) fixups for cases where the
// wiki uses a different display string than the canonical entry.
// =====
const NAME_FIX: Record<string, { name: string; version: string }> = {
  // No active fixups yet — the .scratch authors are expected to use the
  // canonical equipment.json names directly. Add entries here when a wiki
  // display name diverges (e.g. punctuation differences).
};

// Items whose canonical entry uses a non-empty version when wikiVersion is
// blank, OR whose default-resolved entry is the wrong combat form. Mirrors
// VendorStarterGen / BossDropsGen.
const PREFERRED_VERSION: Record<string, string> = {
  // Pyramid Plunder sceptre drops in Charged form (Uncharged is stat-less).
  "Pharaoh's sceptre": 'Charged',

  // Warriors' Guild defender ladder. Equipment.json has Broken / Locked /
  // Normal variants — Normal is the wieldable form. (Avernic defender is
  // boss-pool only and uses its own PREFERRED in BossDropsGen.)
  'Bronze defender': 'Normal',
  'Iron defender': 'Normal',
  'Steel defender': 'Normal',
  'Black defender': 'Normal',
  'Mithril defender': 'Normal',
  'Adamant defender': 'Normal',
  'Rune defender': 'Normal',
  'Dragon defender': 'Normal',

  // BA equipment — same Broken/Locked/Normal split. Normal is the form
  // freshly purchased / earned.
  'Fighter torso': 'Normal',
  'Fighter hat': 'Normal',
  'Healer hat': 'Normal',
  // Penance gloves' canonical version is "Worn".
  'Penance gloves': 'Worn',

  // Black mask charge variants — drops at full charge (10).
  'Black mask': '(10)',
  'Black mask (i)': '(10)',

  // Soul cape: identical-stat Red/Blue toggle. Pick one for stability.
  'Soul cape': 'Red',
};

// =====
// Skill-key translation: misc_drops.json authors use long-form skill names
// directly (attack/strength/defence/hitpoints/...) so no translation is
// needed. The helper below is a safety net mirroring BossDropsGen — should
// any short-form keys slip in, they're normalised at emit time.
// =====
const SHORT_TO_LONG_SKILL_KEY: Record<string, string> = {
  atk: 'attack',
  str: 'strength',
  def: 'defence',
  hp: 'hitpoints',
};

function toLongFormSkills(obj: Record<string, number> | undefined): Record<string, number> {
  if (!obj) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[SHORT_TO_LONG_SKILL_KEY[k] ?? k] = v;
  }
  return out;
}

function findEq(rawName: string, version: string): EquipmentPiece | null {
  // NAME_FIX / PREFERRED_VERSION are keyed by the wiki spelling; equipment.json
  // lookups use the current spelling (see equipmentNames.ts).
  const fixed = NAME_FIX[`${rawName}|${version}`];
  if (fixed) {
    const fixedName = resolveEquipmentName(fixed.name);
    return equipment.find((e) => e.name === fixedName && e.version === fixed.version) ?? null;
  }
  const name = resolveEquipmentName(rawName);
  if (version) {
    const hit = equipment.find((e) => e.name === name && e.version === version);
    if (hit) return hit;
  }
  const preferred = PREFERRED_VERSION[rawName] ?? PREFERRED_VERSION[name];
  if (preferred) {
    const hit = equipment.find((e) => e.name === name && e.version === preferred);
    if (hit) return hit;
  }
  const canonical = equipment.find((e) => e.name === name && e.version === '');
  if (canonical) return canonical;
  return equipment.find((e) => e.name === name) ?? null;
}

// =====
// Input shape from .scratch/misc_drops.json
// =====
type SourceKind = 'minigame' | 'slayer_monster' | 'skill_unlock' | 'quest_reward' | 'crafted';

interface RawSourceAccess {
  questsCompleted: string[];
  questsStarted: string[];
  slayerLevel: number | null;
  onSlayerTask: boolean;
  /** Long-form skill thresholds + optional `combatTotal` (Warriors' Guild). */
  skills: Record<string, number>;
}

interface RawPrerequisite {
  /** Cross-pool source name (boss or misc). The resolver does name-only
   *  lookup in the combined index, so this field is documentation. */
  source: string;
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
  requirements?: Record<string, number>;
  questReqs?: { completed: string[]; started: string[] };
  buildRequirements?: RawBuildReq;
  prerequisiteDrops?: RawPrerequisite[];
  notes?: string;
}

interface RawMisc {
  source: string;
  wikiUrl: string;
  kind: SourceKind;
  monsterIds: number[];
  access: RawSourceAccess;
  drops: RawDrop[];
  notes?: string;
}

// =====
// Output shape (mirrored in src/lib/miscDrops.ts header below)
// =====
interface MiscDropItem {
  itemId: number;
  name: string;
  version: string;
  slot: EquipmentPiece['slot'];
  rarity: string;
  rarityDenominator: number | null;
  requirements: Record<string, number>;
  questReqs: { completed: string[]; started: string[] };
  buildRequirements: RawBuildReq;
  prerequisiteDrops: RawPrerequisite[];
  notes: string;
}

interface MiscEntry {
  source: string;
  wikiUrl: string;
  kind: SourceKind;
  monsterIds: number[];
  access: RawSourceAccess;
  drops: MiscDropItem[];
  notes: string;
}

function emit(entries: MiscEntry[]): string {
  const header = `// AUTO-GENERATED by src/upgrade/tests/MiscDropsGen.test.ts -- do not edit by hand.
// Source data:
//   - .scratch/misc_drops.json (wiki-researched non-boss / non-vendor
//     equipment sources: quest rewards, slayer-monster unique drops,
//     minigame shops, skill-unlock items)
//   - Validated against cdn/json/equipment.json (item IDs canonical)
//   - Filtered through isCombatViable (src/lib/equipmentFilter.ts)
//
// Inclusion criteria:
//   - Source is not in src/lib/bossDrops.ts and not in src/lib/vendorStarter.ts.
//   - Item is equippable with a positive combat-relevant stat (or in the
//     noStatExceptions allowlist).
//   - Final-equipped-item form is listed; components are captured via
//     prerequisiteDrops (cross-pool — points at any boss/misc source by item
//     name) and buildRequirements (skills/quests needed to combine).
//
// Cross-pool prereq resolution: at runtime, src/lib/itemSourceIndex.ts
// builds a combined name -> sources map across boss + misc pools, and
// walks prerequisiteDrops transitively. A prereq item with no source in
// either pool is treated as externally satisfied (clue scroll drops,
// skilling outputs, etc.).

export type MiscSourceKind = 'minigame' | 'slayer_monster' | 'skill_unlock' | 'quest_reward' | 'crafted';

export interface MiscSourceAccess {
  /** Quests that must be COMPLETED to access this source. */
  questsCompleted: string[];
  /** Quests that must be at least STARTED. */
  questsStarted: string[];
  /** Slayer level threshold (e.g. for slayer monsters), or null. */
  slayerLevel: number | null;
  /** True when the source is locked to a specific slayer task. */
  onSlayerTask: boolean;
  /** Skill thresholds (long-form OSRS names + optional combatTotal). */
  skills: Record<string, number>;
}

export interface MiscDropPrerequisite {
  /** Source name (boss or misc) where the prereq item drops. Documentation
   *  only — the resolver does item-name lookup in the combined index. */
  source: string;
  item: string;
}

export interface MiscDropBuildReq {
  /** Skill thresholds needed to ASSEMBLE the final item from components. */
  skills: Record<string, number>;
  /** Quests/miniquests that must be completed to combine. */
  questsCompleted: string[];
  /** Quests that must be started to combine. */
  questsStarted: string[];
}

export interface MiscDropItem {
  itemId: number;
  name: string;
  version: string;
  slot: 'head' | 'cape' | 'neck' | 'ammo' | 'weapon' | 'body' | 'shield' | 'legs' | 'hands' | 'feet' | 'ring';
  /** Wiki rarity expression verbatim (e.g. "1/512", "guaranteed on quest completion"). */
  rarity: string;
  /** Parsed denominator for expected-value math. null if unparseable. */
  rarityDenominator: number | null;
  /** Skill levels needed to WIELD/WEAR. */
  requirements: Record<string, number>;
  /** Quests needed to wield. */
  questReqs: { completed: string[]; started: string[] };
  /** Skills/quests needed to ASSEMBLE the final form from components. */
  buildRequirements: MiscDropBuildReq;
  /** Component items needed to assemble the final form. */
  prerequisiteDrops: MiscDropPrerequisite[];
  /** Caveats / wiki notes. */
  notes: string;
}

export interface MiscDropEntry {
  /** Source display name — joined into the /crabsim misc-source picker. */
  source: string;
  /** URL fetched during research. */
  wikiUrl: string;
  /** Source category (drives any future per-kind UI). */
  kind: MiscSourceKind;
  /** cdn/json/monsters.json ids if known (slayer monsters mostly). */
  monsterIds: number[];
  /** Source-level access requirements. */
  access: MiscSourceAccess;
  /** Per-drop entries — only items that join equipment.json + pass isCombatViable. */
  drops: MiscDropItem[];
  /** Source-level note (e.g. "task-only", "Warriors' Guild gate"). */
  notes: string;
}
`;

  return `${header}\nexport const miscDrops: MiscDropEntry[] = ${JSON.stringify(entries, null, 2)};\n`;
}

// =====
// Companion emit: miscRequirements.ts — a flat registry shaped like
// src/lib/bossRequirements.ts (Record<sourceName, { skills, quests, kind }>)
// plus an accessibleMiscSources() helper paralleling killableBosses(). Used
// by /crabsim to grey out misc sources the player can't yet access based
// on their current progression.
// =====
interface MiscReqEntry {
  kind: SourceKind;
  skills?: Record<string, number>;
  questsCompleted?: string[];
  questsStarted?: string[];
  onSlayerTask?: boolean;
}

function buildMiscReqs(entries: MiscEntry[]): Record<string, MiscReqEntry> {
  const out: Record<string, MiscReqEntry> = {};
  for (const e of entries) {
    const a = e.access;
    const entry: MiscReqEntry = { kind: e.kind };

    const skills = toLongFormSkills(a.skills);
    if (a.slayerLevel != null) skills.slayer = a.slayerLevel;
    if (Object.keys(skills).length > 0) entry.skills = skills;

    if (a.questsCompleted?.length) entry.questsCompleted = a.questsCompleted;
    if (a.questsStarted?.length) entry.questsStarted = a.questsStarted;
    if (a.onSlayerTask) entry.onSlayerTask = true;

    out[e.source] = entry;
  }
  return out;
}

function emitMiscRequirements(reqs: Record<string, MiscReqEntry>): string {
  const header = `// AUTO-GENERATED by src/upgrade/tests/MiscDropsGen.test.ts -- do not edit by hand.
// Source: access fields from .scratch/misc_drops.json, extracted into a
// flat registry parallel to src/lib/bossRequirements.ts.
//
// Skill keys use long-form OSRS names (attack/strength/defence/hitpoints/
// ranged/magic/prayer/slayer/...) plus the optional 'combatTotal' meta-key
// that vendorAccess already handles (Warriors' Guild entry).
//
// slayerLevel from access is folded into skills.slayer. onSlayerTask is
// kept as a separate informational field — it doesn't block
// accessibleMiscSources() since the player can always go get a task; it
// just tells the UI that the source is task-gated.

export type AllSkills = Record<string, number>;

export type MiscSourceKind = 'minigame' | 'slayer_monster' | 'skill_unlock' | 'quest_reward' | 'crafted';

export interface MiscReq {
  /** Source category — drives per-kind UI labelling if needed. */
  kind: MiscSourceKind;
  /** Skill thresholds (long-form OSRS names, incl. 'slayer' and 'combatTotal'). */
  skills?: AllSkills;
  /** Quests that must be COMPLETED to access this source. */
  questsCompleted?: string[];
  /** Quests that must be at least STARTED. */
  questsStarted?: string[];
  /**
   * True when the source is task-gated (e.g. Choke devil, Nuclear smoke
   * devil). Does NOT block accessibleMiscSources() since the player can
   * always go get a task; kept here so the UI can label task-gated sources.
   */
  onSlayerTask?: boolean;
}

export const MISC_REQS: Record<string, MiscReq> = ${JSON.stringify(reqs, null, 2)};

/**
 * Returns the subset of \`sourceList\` the player can access given their
 * current skills + quest state. Mirrors killableBosses() from
 * bossRequirements.ts.
 *
 * Excludes sources where any of the following fails:
 *   - Any required skill threshold (incl. slayer, combatTotal) not met.
 *   - Any required completed quest not in questsCompleted.
 *   - Any required started quest not in questsStarted union questsCompleted.
 *
 * Does NOT exclude based on onSlayerTask — the player can always go get
 * the task. Missing-from-registry sources are treated as accessible.
 */
export function accessibleMiscSources(
  sourceList: readonly string[],
  skills: AllSkills,
  questsCompleted: ReadonlySet<string>,
  questsStarted: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const source of sourceList) {
    const req = MISC_REQS[source];
    if (!req) { out.push(source); continue; }

    let ok = true;
    for (const [skill, lvl] of Object.entries(req.skills ?? {})) {
      if (skill === 'combatTotal') {
        const sum = (skills.attack ?? 1) + (skills.strength ?? 1);
        // Warriors' Guild rule: combat total OR 99 in attack/strength alone.
        if (sum < lvl && (skills.attack ?? 1) < 99 && (skills.strength ?? 1) < 99) { ok = false; break; }
        continue;
      }
      if ((skills[skill] ?? 1) < lvl) { ok = false; break; }
    }
    if (!ok) continue;

    for (const q of req.questsCompleted ?? []) {
      if (!questsCompleted.has(q)) { ok = false; break; }
    }
    if (!ok) continue;

    for (const q of req.questsStarted ?? []) {
      if (!questsStarted.has(q) && !questsCompleted.has(q)) { ok = false; break; }
    }
    if (!ok) continue;

    out.push(source);
  }
  return out;
}

/**
 * Collect every quest name referenced by any misc source's access reqs —
 * for the /crabsim "auto-complete all relevant quests" preset, analogous
 * to allBossQuestNames() / allVendorQuestNames().
 */
export function allMiscQuestNames(): { started: string[]; completed: string[] } {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const req of Object.values(MISC_REQS)) {
    for (const q of req.questsCompleted ?? []) completed.add(q);
    for (const q of req.questsStarted ?? []) started.add(q);
  }
  // Completed implies started.
  for (const q of completed) started.add(q);
  return { started: [...started], completed: [...completed] };
}
`;
  return header;
}

describe('MiscDropsGen', () => {
  test('compute + emit src/lib/miscDrops.ts', () => {
    const raw = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../.scratch/misc_drops.json'),
        'utf8',
      ),
    ) as RawMisc[];

    const out: MiscEntry[] = [];
    const dropped: { source: string; name: string; version: string; reason: string }[] = [];

    for (const src of raw) {
      const accessSkills = toLongFormSkills(src.access.skills);
      if (src.access.slayerLevel != null) accessSkills.slayer = src.access.slayerLevel;

      const entry: MiscEntry = {
        source: src.source,
        wikiUrl: src.wikiUrl,
        kind: src.kind,
        monsterIds: src.monsterIds ?? [],
        access: { ...src.access, skills: accessSkills },
        drops: [],
        notes: src.notes ?? '',
      };

      for (const d of src.drops) {
        const piece = findEq(d.name, d.wikiVersion);
        if (!piece) {
          dropped.push({ source: src.source, name: d.name, version: d.wikiVersion, reason: 'no equipment.json match' });
          continue;
        }
        if (!isCombatViable(piece)) {
          dropped.push({ source: src.source, name: piece.name, version: piece.version, reason: 'fails isCombatViable' });
          continue;
        }
        const rawBuild = d.buildRequirements ?? { skills: {}, questsCompleted: [], questsStarted: [] };
        entry.drops.push({
          itemId: piece.id,
          name: piece.name,
          version: piece.version,
          slot: piece.slot,
          rarity: d.rarity,
          rarityDenominator: d.rarityDenominator,
          requirements: toLongFormSkills(d.requirements),
          questReqs: d.questReqs ?? { completed: [], started: [] },
          buildRequirements: {
            skills: toLongFormSkills(rawBuild.skills),
            questsCompleted: rawBuild.questsCompleted ?? [],
            questsStarted: rawBuild.questsStarted ?? [],
          },
          // Component names must match the drop names emitted above (current
          // equipment.json spelling) — itemSourceIndex joins on them.
          prerequisiteDrops: (d.prerequisiteDrops ?? []).map((p) => ({ ...p, item: resolveEquipmentName(p.item) })),
          notes: d.notes ?? '',
        });
      }

      out.push(entry);
    }

    const ts = emit(out);
    const outPath = path.resolve(__dirname, '../lib/miscDrops.ts');
    fs.writeFileSync(outPath, ts, 'utf8');

    // Companion: miscRequirements.ts (flat registry + accessibleMiscSources helper).
    const reqs = buildMiscReqs(out);
    const reqsTs = emitMiscRequirements(reqs);
    const reqsPath = path.resolve(__dirname, '../lib/miscRequirements.ts');
    fs.writeFileSync(reqsPath, reqsTs, 'utf8');

    /* eslint-disable no-console */
    const totalDrops = out.reduce((sum, b) => sum + b.drops.length, 0);
    console.log(`\nWrote ${outPath} -- ${out.length} sources, ${totalDrops} unique items`);
    console.log(`Wrote ${reqsPath} -- ${Object.keys(reqs).length} source entries`);
    if (dropped.length) {
      const lines: string[] = [];
      for (const d of dropped) {
        lines.push(`  - [${d.source}] ${d.name}${d.version ? ' (' + d.version + ')' : ''}: ${d.reason}`);
      }
      console.log(`Dropped ${dropped.length} entries:`);
      lines.forEach((l) => console.log(l));
    }
    /* eslint-enable no-console */
  });
});

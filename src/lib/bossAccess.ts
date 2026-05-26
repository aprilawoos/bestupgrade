// ============================================================================
// Boss-pool access helpers — parallel to src/lib/vendorAccess.ts.
//
// Given a player's progression (skills, quests, slayer state) and a set of
// bosses the player has access to, return the subset of boss-drop items they
// can:
//   1. KILL the source boss for (bossAccess gates).
//   2. WIELD the dropped item (requirements + questReqs).
//   3. ASSEMBLE the final form when components from OTHER bosses are needed
//      (prerequisiteDrops + buildRequirements).
//
// Component graph resolution: a drop's prerequisiteDrops list references
// other-boss drops by name. We resolve those transitively — a drop is
// available iff every prerequisite drop is itself available (and so on).
// Cycles are not expected (combine recipes are acyclic) but the resolver
// is safe-by-memoization.
//
// Open issue: prerequisite-component ITEMS not produced by any boss in the
// dataset (e.g. Dragon defender from Warriors' Guild, Ranger boots from
// clue scrolls, Master wand from Mage Arena II) are not modelled. The
// caller is expected to layer external item-source tracking on top — the
// boss-access layer just answers "given these bosses unlocked + these
// components from outside, what can I assemble?". For now we treat unknown
// prerequisites as ALWAYS satisfied; tighten when the external-sources
// model lands.
// ============================================================================

import type { EquipmentPiece, PlayerSkills } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import { bossDrops, BossDropEntry, BossDropItem, BossAccess } from '@/lib/bossDrops';

export interface BossProgression {
  skills: Partial<PlayerSkills>;
  questsStarted: ReadonlySet<string>;
  questsCompleted: ReadonlySet<string>;
  /** Current slayer level (separate from skills.slayer since some callers track it independently). */
  slayerLevel: number;
  /**
   * True when the player is currently on a slayer task that assigns the
   * given boss. Used for `onSlayerTask` gating (Thermy, Smoke Devils, etc.).
   * Pass a function so the caller can answer per-boss without having to
   * pre-compute every possible assignment.
   */
  isOnTaskFor: (bossName: string) => boolean;
}

const SKILL_KEYS = new Set(['atk', 'str', 'def', 'ranged', 'magic', 'prayer', 'hp', 'mining', 'herblore', 'runecraft', 'agility', 'thieving', 'farming', 'fletching', 'crafting', 'smithing', 'fishing', 'cooking', 'woodcutting', 'firemaking', 'construction', 'hunter', 'slayer']);

function skillValue(skills: Partial<PlayerSkills>, key: string): number {
  const v = (skills as Record<string, number | undefined>)[key];
  return v ?? 1;
}

// =====
// Boss-level access check
// =====
export function canKillBoss(progression: BossProgression, bossName: string, access: BossAccess): boolean {
  // Quest gates.
  for (const q of access.questsCompleted) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of access.questsStarted) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  // Slayer level (separate field — slayer assignment is checked below).
  if (access.slayerLevel !== null && progression.slayerLevel < access.slayerLevel) return false;
  // On-task requirement (Thermy, Smoke Devils, etc.).
  if (access.onSlayerTask && !progression.isOnTaskFor(bossName)) return false;
  // Other skill thresholds (e.g. agility 70 for Zilyana shortcut).
  for (const [k, lvl] of Object.entries(access.skills ?? {})) {
    if (!SKILL_KEYS.has(k)) {
      // Unknown skill key — fail closed.
      return false;
    }
    if (skillValue(progression.skills, k) < (lvl as number)) return false;
  }
  return true;
}

// =====
// Per-drop wield + assemble checks
// =====
function meetsSkillReqs(progression: BossProgression, reqs: Record<string, number>): boolean {
  for (const [k, lvl] of Object.entries(reqs)) {
    if (skillValue(progression.skills, k) < lvl) return false;
  }
  return true;
}

function meetsQuestReqs(progression: BossProgression, reqs: { completed: string[]; started: string[] }): boolean {
  for (const q of reqs.completed) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of reqs.started) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  return true;
}

export function canWieldDrop(progression: BossProgression, drop: BossDropItem): boolean {
  if (!meetsSkillReqs(progression, drop.requirements)) return false;
  if (!meetsQuestReqs(progression, drop.questReqs)) return false;
  return true;
}

/**
 * Checks whether the player can assemble this drop's final form, assuming
 * every required source boss is in `accessibleBossSet`. Does NOT recurse
 * into transitive prerequisites — use isDropUnlocked for that.
 */
export function meetsBuildRequirements(
  progression: BossProgression,
  drop: BossDropItem,
  accessibleBossSet: ReadonlySet<string>,
): boolean {
  const b = drop.buildRequirements;
  if (!meetsSkillReqs(progression, b.skills)) return false;
  for (const q of b.questsCompleted) {
    if (!progression.questsCompleted.has(q)) return false;
  }
  for (const q of b.questsStarted) {
    if (!progression.questsStarted.has(q) && !progression.questsCompleted.has(q)) return false;
  }
  // Every prerequisite drop must come from a boss the player can access.
  // Item-level transitive checks happen in isDropUnlocked.
  for (const pre of drop.prerequisiteDrops) {
    if (!accessibleBossSet.has(pre.boss)) return false;
  }
  return true;
}

// =====
// Build a name -> drop lookup keyed by item-name for prerequisite resolution.
// Multiple bosses can drop the same item-name (e.g. Voidwaker shows up under
// Callisto/Artio for hilt, Vet'ion/Calvar'ion for blade, etc.) — we accept
// any matching source.
// =====
function buildItemSourceIndex(): Map<string, BossDropEntry[]> {
  const out = new Map<string, BossDropEntry[]>();
  for (const boss of bossDrops) {
    for (const drop of boss.drops) {
      const key = drop.name;
      const list = out.get(key) ?? [];
      list.push(boss);
      out.set(key, list);
    }
  }
  return out;
}

/**
 * Walks the prerequisiteDrops graph rooted at `drop`. Returns true iff every
 * required component item is sourceable from a boss in `accessibleBossSet`
 * AND every transitive build-step's skills/quests are met.
 *
 * Memoised by drop name to avoid re-walking shared subgraphs (godsword
 * shards in particular form a dense subgraph).
 */
export function isDropUnlocked(
  progression: BossProgression,
  drop: BossDropItem,
  accessibleBossSet: ReadonlySet<string>,
  sourceIndex: Map<string, BossDropEntry[]> = buildItemSourceIndex(),
  memo: Map<string, boolean> = new Map(),
): boolean {
  const cacheKey = `${drop.name}|${drop.version}`;
  const cached = memo.get(cacheKey);
  if (cached !== undefined) return cached;

  // Guard against cycles (shouldn't happen but be defensive).
  memo.set(cacheKey, false);

  if (!canWieldDrop(progression, drop)) return false;
  if (!meetsBuildRequirements(progression, drop, accessibleBossSet)) return false;

  // Every prerequisite drop must itself be unlockable.
  for (const pre of drop.prerequisiteDrops) {
    const sources = sourceIndex.get(pre.item);
    if (!sources || sources.length === 0) {
      // Not produced by any catalogued boss — treated as externally sourced
      // and assumed satisfied. See module header.
      continue;
    }
    // At least one source must be accessible AND that source's drop entry
    // must itself be unlocked transitively.
    let anyAvailable = false;
    for (const sourceBoss of sources) {
      if (!accessibleBossSet.has(sourceBoss.boss)) continue;
      const preDrop = sourceBoss.drops.find((d) => d.name === pre.item);
      if (!preDrop) continue;
      if (isDropUnlocked(progression, preDrop, accessibleBossSet, sourceIndex, memo)) {
        anyAvailable = true;
        break;
      }
    }
    if (!anyAvailable) return false;
  }

  memo.set(cacheKey, true);
  return true;
}

// =====
// Top-level pool builder
// =====

/**
 * Given a player's progression and the set of bosses they can access (the
 * caller decides this — typically by filtering bossDrops via canKillBoss),
 * returns the flat EquipmentPiece pool of every drop the player can
 * actually unlock and wield.
 */
export function getPlayerBossDropPool(
  progression: BossProgression,
  accessibleBossSet: ReadonlySet<string>,
): EquipmentPiece[] {
  const byId = new Map(availableEquipment.map((e) => [e.id, e]));
  const sourceIndex = buildItemSourceIndex();
  const memo = new Map<string, boolean>();
  const seen = new Set<number>();
  const out: EquipmentPiece[] = [];

  for (const boss of bossDrops) {
    if (!accessibleBossSet.has(boss.boss)) continue;
    for (const drop of boss.drops) {
      if (seen.has(drop.itemId)) continue;
      if (!isDropUnlocked(progression, drop, accessibleBossSet, sourceIndex, memo)) continue;
      const piece = byId.get(drop.itemId);
      if (!piece) continue;
      out.push(piece);
      seen.add(drop.itemId);
    }
  }
  return out;
}

/**
 * Convenience: filter bossDrops to the set of bosses the player can KILL
 * (ignoring item-side unlocks). Caller can pass the result into
 * getPlayerBossDropPool.
 */
export function bossesAccessibleByProgression(progression: BossProgression): Set<string> {
  const out = new Set<string>();
  for (const boss of bossDrops) {
    if (canKillBoss(progression, boss.boss, boss.bossAccess)) out.add(boss.boss);
  }
  return out;
}

/**
 * Collects every quest name referenced anywhere in bossDrops — for "auto-
 * complete all relevant quests" presets analogous to allVendorQuestNames.
 */
export function allBossQuestNames(): { started: string[]; completed: string[] } {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const boss of bossDrops) {
    for (const q of boss.bossAccess.questsCompleted) completed.add(q);
    for (const q of boss.bossAccess.questsStarted) started.add(q);
    for (const drop of boss.drops) {
      for (const q of drop.questReqs.completed) completed.add(q);
      for (const q of drop.questReqs.started) started.add(q);
      for (const q of drop.buildRequirements.questsCompleted) completed.add(q);
      for (const q of drop.buildRequirements.questsStarted) started.add(q);
    }
  }
  // Completed implies started.
  for (const q of completed) started.add(q);
  return { started: [...started], completed: [...completed] };
}

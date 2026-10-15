// === /crabsim ===
// Brute-forces the player's accessible item pool (vendor + killed-boss
// drops) to find the best loadout per combat style vs TzKal-Zuk (id 7706
// version "Normal" — 1200 HP, 350 magic def, 0 stab/slash/crush def,
// 100 standard ranged def, 40% water-elemental weakness). Stat presets:
// L1 / hiscores lookup / L99.
//
// Iteration uses `simulateBestLoadout` from src/upgrade/lib/loadoutSim.ts,
// over the pool minus obsolete items (src/upgrade/lib/obsoleteItems.ts).
// The route name is still /crabsim for back-compat with bookmarks.
'use client';

import { useCallback, useMemo, useState } from 'react';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { isMonsterImmuneToStyle, simulateBestLoadout, SimResult, SimStyle } from '@/upgrade/lib/loadoutSim';
import { allVendorQuestNames, getPlayerAccessiblePool, PlayerProgression } from '@/upgrade/lib/vendorAccess';
import { AllSkills, autocompletableQuests } from '@/upgrade/lib/questRequirements';
import { BOSS_REQS, killableBosses, allBossQuestNames } from '@/upgrade/lib/bossRequirements';
import { BossProgression, getPlayerBossDropPool } from '@/upgrade/lib/bossAccess';
import { MISC_REQS, accessibleMiscSources, allMiscQuestNames } from '@/upgrade/lib/miscRequirements';
import { getPlayerMiscDropPool } from '@/upgrade/lib/miscAccess';
import { ALL_OSRS_SKILLS, findObsoleteItems } from '@/upgrade/lib/obsoleteItems';
import type { EquipmentPiece, PlayerSkills } from '@/types/Player';
import { ModelViewer } from '@/viewer/ModelViewer';
import type { Monster } from '@/types/Monster';

// === Targets ===
// TzKal-Zuk has two monsters.json entries sharing id 7706 — "Normal"
// (steady-state fight) and "Enraged" (final-phase enrage). We sim the
// Normal phase since the calc engine doesn't model phase transitions.
const ZUK_NPC_ID = 7706;
const ZUK_VERSION = 'Normal';

function getZuk(): Monster {
  const base = getMonsters().find((m) => m.id === ZUK_NPC_ID && m.version === ZUK_VERSION);
  if (!base) throw new Error(`TzKal-Zuk (${ZUK_VERSION}) not in monsters.json`);
  return { ...base, inputs: { ...INITIAL_MONSTER_INPUTS } };
}

// === Progression presets ===
// All player skill state is stored in ONE long-form dict (AllSkills) that
// matches the hiscores response + questRequirements + vendorRequirements
// + bossRequirements convention. L1 / L99 are derived by stamping every
// known skill to the preset level; lookup uses the hiscores `allSkills`
// payload as-is.

// The L1/L99 presets stamp every OSRS skill (ALL_OSRS_SKILLS) so any
// vendor/boss/quest req lookup finds a defined level.
function makePresetSkills(level: number): AllSkills {
  const out: AllSkills = {};
  for (const s of ALL_OSRS_SKILLS) out[s] = level;
  // Hitpoints starts at 10 on a fresh account regardless of preset.
  if (level < 10) out.hitpoints = 10;
  return out;
}

// Long-form → short-form translation at the calc-engine boundary.
// simulateBestLoadout / the calc engine consume Partial<PlayerSkills>
// (atk/str/def/...) so we narrow at the call site and keep all other
// player state long-form.
function toCalcSkills(all: AllSkills): Partial<PlayerSkills> {
  return {
    atk: all.attack,
    str: all.strength,
    def: all.defence,
    hp: all.hitpoints,
    ranged: all.ranged,
    magic: all.magic,
    prayer: all.prayer,
    mining: all.mining,
    herblore: all.herblore,
  };
}


// === Slot order for display ===
const SLOTS = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;

type ResultsByStyle = Record<SimStyle, SimResult | null>;
const EMPTY_RESULTS: ResultsByStyle = { melee: null, ranged: null, magic: null };

// === Card ===
function StyleCard({ result }: { result: SimResult }) {
  const playerItemIds = SLOTS
    .map((s) => result.loadout[s]?.id)
    .filter((id): id is number => typeof id === 'number');
  const playerSrc = `/api/player/base?gender=female&items=${playerItemIds.join(',')}&kits=296`;

  const styleLabel = result.style[0].toUpperCase() + result.style.slice(1);

  return (
    <article
      style={{
        border: '1px solid #2c2c2c',
        borderRadius: 8,
        padding: '1rem',
        background: '#141414',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{styleLabel}</h2>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          {result.combosEvaluated} combos in {result.elapsedMs.toFixed(0)}ms
        </span>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.85rem', color: '#aaa' }}>Player</h3>
          <ModelViewer src={playerSrc} height={300} />
        </div>
        <div>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.85rem', color: '#aaa' }}>TzKal-Zuk</h3>
          <ModelViewer modelId={ZUK_NPC_ID} kind="npc" height={300} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
        <section>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>
            Calc outputs
          </h3>
          <dl style={{ margin: 0, fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem' }}>
            <dt style={{ color: '#888' }}>DPS:</dt><dd style={{ margin: 0, fontWeight: 600 }}>{result.dps.toFixed(4)}</dd>
            <dt style={{ color: '#888' }}>Max hit:</dt><dd style={{ margin: 0 }}>{result.maxHit}</dd>
            <dt style={{ color: '#888' }}>Accuracy:</dt><dd style={{ margin: 0 }}>{(result.accuracy * 100).toFixed(2)}%</dd>
            <dt style={{ color: '#888' }}>Attack speed:</dt><dd style={{ margin: 0 }}>{result.attackSpeed} ticks</dd>
            <dt style={{ color: '#888' }}>Stance:</dt><dd style={{ margin: 0 }}>{result.stance.name} / {result.stance.stance}</dd>
            <dt style={{ color: '#888' }}>Attack type:</dt><dd style={{ margin: 0 }}>{result.stance.type}</dd>
            {result.spell && (<>
              <dt style={{ color: '#888' }}>Spell:</dt><dd style={{ margin: 0 }}>{result.spell.name}</dd>
            </>)}
          </dl>
        </section>
        <section>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>
            Tie-breaker
          </h3>
          <dl style={{ margin: 0, fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem' }}>
            <dt style={{ color: '#888' }}>Def sum:</dt><dd style={{ margin: 0 }}>{result.defSum}</dd>
            <dt style={{ color: '#888' }}>Prayer:</dt><dd style={{ margin: 0 }}>+{result.prayerBonus}</dd>
          </dl>
        </section>
      </div>

      <section style={{ marginTop: '0.75rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>
          Loadout
        </h3>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', columns: 2, columnGap: '1rem', fontSize: '0.8rem' }}>
          {SLOTS.map((slot) => {
            const piece = result.loadout[slot];
            return (
              <li key={slot} style={{ breakInside: 'avoid' }}>
                <span style={{ color: '#888' }}>{slot}:</span> {piece?.name ?? '—'}
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}

// === Page ===
// Stats: binary L1/L99 toggle. Quests: a drag-drop unlock picker — every
// quest referenced by any shopAccess entry in the dataset is listed in the
// left "Available" panel; the user drags entries into the right "Unlocked"
// panel to mark them as completed. The sim re-runs on every change.
//
// QP gate (Champions' Guild = 32 QP) is modelled as a single pseudo-unlock
// entry rather than per-quest QP totals — accurate per-quest QP values are
// outside the dataset and would over-constrain a UX that's just trying to
// answer "what does unlocking this quest do".
type StatsPreset = 'L1' | 'L99' | 'lookup';
const QP_PSEUDO_UNLOCK = '32+ Quest Points (Champions’ Guild)';

// Short human-readable summary of a boss's access reqs (used in the
// "locked" chip tooltip). Returns e.g. "slayer 85, on slayer task" or
// "Dragon Slayer II completed".
function describeBossReqs(boss: string): string {
  const req = BOSS_REQS[boss];
  if (!req) return 'no reqs';
  const parts: string[] = [];
  if (req.skills) {
    for (const [s, lvl] of Object.entries(req.skills)) parts.push(`${s} ${lvl}`);
  }
  if (req.questsCompleted?.length) parts.push(`needs ${req.questsCompleted.join(', ')}`);
  if (req.questsStarted?.length) parts.push(`needs started ${req.questsStarted.join(', ')}`);
  return parts.join(', ') || 'no reqs';
}

function buildProgression(
  completed: ReadonlySet<string>,
  skills: AllSkills,
): PlayerProgression {
  const realQuests = new Set([...completed].filter((q) => q !== QP_PSEUDO_UNLOCK));
  return {
    skills,
    questPoints: completed.has(QP_PSEUDO_UNLOCK) ? 32 : 0,
    questsStarted: realQuests,
    questsCompleted: realQuests,
  };
}

export default function CrabSim() {
  const monster = useMemo(() => getZuk(), []);

  // The full unlock catalogue — every quest referenced by any shop's
  // shopAccess OR any boss's bossAccess OR any misc source + the QP
  // pseudo-unlock. Sources from all three pools share the quest panel.
  const allUnlocks = useMemo(() => {
    const v = allVendorQuestNames();
    const b = allBossQuestNames();
    const m = allMiscQuestNames();
    const set = new Set<string>([
      ...v.started, ...v.completed,
      ...b.started, ...b.completed,
      ...m.started, ...m.completed,
    ]);
    return [...set, QP_PSEUDO_UNLOCK].sort((a, b) => a.localeCompare(b));
  }, []);

  const [stats, setStats] = useState<StatsPreset>('L1');
  const [completedQuests, setCompletedQuests] = useState<Set<string>>(new Set());
  const [killedBosses, setKilledBosses] = useState<Set<string>>(new Set());
  const [acquiredSources, setAcquiredSources] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ResultsByStyle>(EMPTY_RESULTS);
  const [poolSize, setPoolSize] = useState<number>(0);
  const [obsoleteCount, setObsoleteCount] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookup state — username buffer, the verified display name, and the FULL
  // long-form skill table (drives sim + quest-req autocomplete + boss-req
  // filter, all from one dict).
  const [lookupName, setLookupName] = useState('');
  const [lookupAllSkills, setLookupAllSkills] = useState<AllSkills | null>(null);
  const [lookupDisplay, setLookupDisplay] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  // Long-form skills for the current preset. Single source of truth used
  // by the sim, the vendor/boss access checks, the quest-completable
  // filter, and the killable-bosses filter.
  const currentAllSkills = useMemo<AllSkills>(() => {
    if (stats === 'lookup' && lookupAllSkills) return lookupAllSkills;
    return makePresetSkills(stats === 'L99' ? 99 : 1);
  }, [stats, lookupAllSkills]);

  const runSim = useCallback((
    nextQuests: ReadonlySet<string>,
    nextSkills: AllSkills,
    nextKilled: ReadonlySet<string>,
    nextAcquired: ReadonlySet<string>,
  ) => {
    setRunning(true);
    setError(null);
    setTimeout(() => {
      try {
        const progression = buildProgression(nextQuests, nextSkills);
        const vendorPool = getPlayerAccessiblePool(progression);

        // Boss + misc pools both go through the shared cross-pool resolver
        // (src/lib/itemSourceIndex.ts), so a drop whose prereq lives in
        // the OTHER pool resolves cleanly. Each pool builder gets both
        // accessible sets — boss builder needs the misc set for cross-pool
        // prereqs that point at misc items, and vice versa.
        //
        // isOnTaskFor is unused by either pool builder (the curated
        // killed/acquired sets are the authority); stub returns true.
        const bossProgression: BossProgression = {
          skills: progression.skills,
          questsStarted: progression.questsStarted,
          questsCompleted: progression.questsCompleted,
          isOnTaskFor: () => true,
        };
        const bossPool = getPlayerBossDropPool(bossProgression, nextKilled, nextAcquired);
        const miscPool = getPlayerMiscDropPool(bossProgression, nextAcquired, nextKilled);

        // Merge vendor + boss + misc pools, dedupe by item id (overlap is
        // common — e.g. dragon dagger / NMZ ring imbues / Granite shield).
        const seen = new Set<number>(vendorPool.map((p) => p.id));
        const merged: EquipmentPiece[] = [...vendorPool];
        for (const item of bossPool) {
          if (!seen.has(item.id)) { merged.push(item); seen.add(item.id); }
        }
        for (const item of miscPool) {
          if (!seen.has(item.id)) { merged.push(item); seen.add(item.id); }
        }

        // Drop obsolete items (src/upgrade/lib/obsoleteItems.ts) — gear that
        // something always present alongside it beats in every situation.
        // Killed bosses and acquired sources are the base table: the pool
        // holds all their drops at once, so they're passed as always
        // available. The filter gets the SAME source sets the pool was built
        // from, so every dominator is in the pool and the sim's result can't
        // change.
        const none = new Set<string>();
        const { obsoleteIds } = findObsoleteItems({
          skills: progression.skills,
          questsStarted: progression.questsStarted,
          questsCompleted: progression.questsCompleted,
          questPoints: progression.questPoints,
          alwaysAvailableBosses: nextKilled,
          alwaysAvailableMiscSources: nextAcquired,
          obtainableBosses: none,
          obtainableMiscSources: none,
        });
        const pool = merged.filter((p) => !obsoleteIds.has(p.id));

        // Calc engine consumes the short-form combat-only subset.
        const calcSkills = toCalcSkills(progression.skills);
        setPoolSize(pool.length);
        setObsoleteCount(merged.length - pool.length);
        const next: ResultsByStyle = { melee: null, ranged: null, magic: null };
        for (const style of ['melee', 'ranged', 'magic'] as SimStyle[]) {
          next[style] = simulateBestLoadout({
            pool,
            monster,
            skills: calcSkills,
            style,
            // Passed through to simPrayers: gates Chivalry/Piety on King's
            // Ransom completion, and Rigour/Augury/Deadeye/Mystic Vigour
            // on the relevant boss being in the killed set.
            questsCompleted: progression.questsCompleted,
            accessibleBossSet: nextKilled,
          });
        }
        setResults(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    }, 0);
  }, [monster]);

  // Run the sim with the current state. Single entry point — every other
  // handler just mutates state silently and the user clicks Run when ready.
  const runWithCurrent = useCallback(() => {
    runSim(completedQuests, currentAllSkills, killedBosses, acquiredSources);
  }, [runSim, completedQuests, currentAllSkills, killedBosses, acquiredSources]);

  // Fetch a player's hiscores via the proxy and, on success, switch to the
  // 'lookup' stats preset using the returned skill levels.
  const lookupPlayer = useCallback(async () => {
    const name = lookupName.trim();
    if (!name) return;
    setLookupBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/lookup-player/${encodeURIComponent(name)}`);
      const body = (await resp.json()) as {
        name?: string;
        skills?: Partial<PlayerSkills>;
        allSkills?: AllSkills;
        error?: string;
      };
      if (!resp.ok) {
        setError(body.error ?? `hiscores lookup failed (${resp.status})`);
        return;
      }
      setLookupAllSkills(body.allSkills ?? null);
      setLookupDisplay(body.name ?? name);
      setStats('lookup');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLookupBusy(false);
    }
  }, [lookupName]);

  const autocompleteCompletable = () => {
    const completable = autocompletableQuests(allUnlocks, currentAllSkills);
    // Preserve any unlocks the user already enabled (e.g. Fight Caves
    // dragged in manually, or the QP pseudo-unlock).
    const merged = new Set([...completedQuests, ...completable]);
    setCompletedQuests(merged);
  };

  // Toggle one quest in/out of the completed set; also accepts a direct
  // dropTo argument when the user drags between panels.
  const moveQuest = (quest: string, dropTo: 'available' | 'unlocked') => {
    setCompletedQuests((prev) => {
      const next = new Set(prev);
      if (dropTo === 'unlocked') next.add(quest);
      else next.delete(quest);
      return next;
    });
  };

  const lookupSummary = lookupDisplay && lookupAllSkills
    ? `${lookupDisplay} — atk ${lookupAllSkills.attack} · str ${lookupAllSkills.strength} · def ${lookupAllSkills.defence} · ranged ${lookupAllSkills.ranged} · magic ${lookupAllSkills.magic} · prayer ${lookupAllSkills.prayer} · hp ${lookupAllSkills.hitpoints}`
    : null;

  // HTML5 drag-drop wiring. Plain native API — no library dep.
  const onDragStartItem = (quest: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', quest);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOverPanel = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDropToPanel = (target: 'available' | 'unlocked') => (e: React.DragEvent) => {
    e.preventDefault();
    const quest = e.dataTransfer.getData('text/plain');
    if (quest) moveQuest(quest, target);
  };

  const available = allUnlocks.filter((q) => !completedQuests.has(q));
  const unlocked = allUnlocks.filter((q) => completedQuests.has(q));

  // Bosses the player can kill given current stats + completed quests.
  // completedQuests is treated as both 'started' and 'completed' since the
  // page only tracks one set (completion implies start).
  const killable = useMemo<string[]>(() => {
    return killableBosses(
      Object.keys(BOSS_REQS),
      currentAllSkills,
      completedQuests,
      completedQuests,
    );
  }, [currentAllSkills, completedQuests]);
  const killableSet = useMemo(() => new Set(killable), [killable]);
  const allBossNames = useMemo(
    () => Object.keys(BOSS_REQS).sort((a, b) => a.localeCompare(b)),
    [],
  );

  // Boss-panel handlers — mirror the quest panel (drag-drop, click-toggle,
  // auto-mark, clear). Silent state updates; the user clicks Run to apply.
  const moveBoss = (boss: string, dropTo: 'available' | 'killed') => {
    setKilledBosses((prev) => {
      const next = new Set(prev);
      if (dropTo === 'killed') next.add(boss);
      else next.delete(boss);
      return next;
    });
  };

  const autoMarkKillable = () => {
    setKilledBosses((prev) => new Set([...prev, ...killable]));
  };

  const clearKilled = () => {
    setKilledBosses(new Set());
  };

  const onDragStartBoss = (boss: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', boss);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropToBossPanel = (target: 'available' | 'killed') => (e: React.DragEvent) => {
    e.preventDefault();
    const boss = e.dataTransfer.getData('text/plain');
    // Only allow killable bosses to be moved into Killed; any drag back to
    // Available is fine (manual unmark).
    if (!boss) return;
    if (target === 'killed' && !killableSet.has(boss)) return;
    moveBoss(boss, target);
  };

  const bossAvailable = allBossNames.filter((b) => !killedBosses.has(b));
  const bossKilled = [...killedBosses].sort((a, b) => a.localeCompare(b));

  // === Misc-source picker ===
  // Mirrors the boss panel exactly. The misc registry covers minigame
  // shops, quest rewards, slayer-monster unique drops, and skill-unlock
  // items. Sources whose access reqs aren't met are red-chipped.
  const accessibleMisc = useMemo<string[]>(() => {
    return accessibleMiscSources(
      Object.keys(MISC_REQS),
      currentAllSkills,
      completedQuests,
      completedQuests,
    );
  }, [currentAllSkills, completedQuests]);
  const accessibleMiscSet = useMemo(() => new Set(accessibleMisc), [accessibleMisc]);
  const allMiscNames = useMemo(
    () => Object.keys(MISC_REQS).sort((a, b) => a.localeCompare(b)),
    [],
  );

  function describeMiscReqs(source: string): string {
    const req = MISC_REQS[source];
    if (!req) return 'no reqs';
    const parts: string[] = [];
    if (req.skills) {
      for (const [s, lvl] of Object.entries(req.skills)) parts.push(`${s} ${lvl}`);
    }
    if (req.questsCompleted?.length) parts.push(`needs ${req.questsCompleted.join(', ')}`);
    if (req.questsStarted?.length) parts.push(`needs started ${req.questsStarted.join(', ')}`);
    return parts.join(', ') || 'no reqs';
  }

  const moveSource = (source: string, dropTo: 'available' | 'acquired') => {
    setAcquiredSources((prev) => {
      const next = new Set(prev);
      if (dropTo === 'acquired') next.add(source);
      else next.delete(source);
      return next;
    });
  };

  const autoMarkAccessibleSources = () => {
    setAcquiredSources((prev) => new Set([...prev, ...accessibleMisc]));
  };

  const clearAcquiredSources = () => {
    setAcquiredSources(new Set());
  };

  const onDragStartSource = (source: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', source);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDropToSourcePanel = (target: 'available' | 'acquired') => (e: React.DragEvent) => {
    e.preventDefault();
    const source = e.dataTransfer.getData('text/plain');
    if (!source) return;
    if (target === 'acquired' && !accessibleMiscSet.has(source)) return;
    moveSource(source, target);
  };

  const sourceAvailable = allMiscNames.filter((s) => !acquiredSources.has(s));
  const sourceAcquired = [...acquiredSources].sort((a, b) => a.localeCompare(b));

  const sourceChip = (source: string, panelSide: 'available' | 'acquired') => {
    const req = MISC_REQS[source];
    const onTask = req?.onSlayerTask;
    const isAccessible = accessibleMiscSet.has(source);
    const locked = panelSide === 'available' && !isAccessible;
    const kindLabel = req?.kind ? ` [${req.kind.replace('_', ' ')}]` : '';
    return (
      <div
        key={source}
        draggable={!locked}
        onDragStart={locked ? undefined : onDragStartSource(source)}
        onClick={locked ? undefined : () => moveSource(source, panelSide === 'available' ? 'acquired' : 'available')}
        style={{
          padding: '0.35rem 0.6rem',
          marginBottom: '0.25rem',
          border: '1px solid ' + (locked ? '#7a2a2a' : (panelSide === 'acquired' ? '#5a8fc5' : '#444')),
          background: locked ? '#3a1a1a' : (panelSide === 'acquired' ? '#1f3a5a' : '#1a1a1a'),
          color: locked ? '#e6a0a0' : (panelSide === 'acquired' ? '#cce0f5' : '#bbb'),
          borderRadius: 4,
          fontSize: '0.8rem',
          cursor: locked ? 'not-allowed' : 'grab',
          userSelect: 'none',
          opacity: locked ? 0.7 : 1,
        }}
        title={
          locked
            ? `Locked — does not meet reqs (${describeMiscReqs(source)})`
            : (onTask ? 'Slayer-task locked but reachable — drag or click to toggle' : 'Drag between panels, or click to toggle')
        }
      >{source}{onTask ? ' (task)' : ''}<span style={{ color: '#666' }}>{kindLabel}</span></div>
    );
  };

  const sourcePanel = (title: string, items: string[], target: 'available' | 'acquired') => (
    <div
      onDragOver={onDragOverPanel}
      onDrop={onDropToSourcePanel(target)}
      style={{
        flex: 1,
        minWidth: 220,
        border: '1px dashed #333',
        borderRadius: 6,
        padding: '0.6rem',
        background: '#101010',
      }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: '#aaa' }}>
        {title} <span style={{ color: '#666' }}>({items.length})</span>
      </h3>
      {items.length === 0
        ? <p style={{ color: '#555', fontSize: '0.75rem', fontStyle: 'italic', margin: 0 }}>drop sources here</p>
        : items.map((s) => sourceChip(s, target))}
    </div>
  );

  const bossChip = (boss: string, source: 'available' | 'killed') => {
    const onTask = BOSS_REQS[boss]?.onSlayerTask;
    const isKillable = killableSet.has(boss);
    // In Available, unkillable bosses are red + undraggable + unclickable.
    // In Killed, every chip is draggable/clickable back to Available.
    const locked = source === 'available' && !isKillable;
    return (
      <div
        key={boss}
        draggable={!locked}
        onDragStart={locked ? undefined : onDragStartBoss(boss)}
        onClick={locked ? undefined : () => moveBoss(boss, source === 'available' ? 'killed' : 'available')}
        style={{
          padding: '0.35rem 0.6rem',
          marginBottom: '0.25rem',
          border: '1px solid ' + (locked ? '#7a2a2a' : (source === 'killed' ? '#5a8fc5' : '#444')),
          background: locked ? '#3a1a1a' : (source === 'killed' ? '#1f3a5a' : '#1a1a1a'),
          color: locked ? '#e6a0a0' : (source === 'killed' ? '#cce0f5' : '#bbb'),
          borderRadius: 4,
          fontSize: '0.8rem',
          cursor: locked ? 'not-allowed' : 'grab',
          userSelect: 'none',
          opacity: locked ? 0.7 : 1,
        }}
        title={
          locked
            ? `Locked — does not meet reqs (${describeBossReqs(boss)})`
            : (onTask ? 'Slayer-task locked but reachable — drag or click to toggle' : 'Drag between panels, or click to toggle')
        }
      >{boss}{onTask ? ' (task)' : ''}</div>
    );
  };

  const bossPanel = (title: string, items: string[], target: 'available' | 'killed') => (
    <div
      onDragOver={onDragOverPanel}
      onDrop={onDropToBossPanel(target)}
      style={{
        flex: 1,
        minWidth: 220,
        border: '1px dashed #333',
        borderRadius: 6,
        padding: '0.6rem',
        background: '#101010',
      }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: '#aaa' }}>
        {title} <span style={{ color: '#666' }}>({items.length})</span>
      </h3>
      {items.length === 0
        ? <p style={{ color: '#555', fontSize: '0.75rem', fontStyle: 'italic', margin: 0 }}>drop bosses here</p>
        : items.map((b) => bossChip(b, target))}
    </div>
  );

  const totalCombos = (results.melee?.combosEvaluated ?? 0)
    + (results.ranged?.combosEvaluated ?? 0)
    + (results.magic?.combosEvaluated ?? 0);

  const statsButton = (active: boolean, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={running}
      style={{
        padding: '0.4rem 0.9rem',
        fontSize: '0.9rem',
        cursor: running ? 'default' : 'pointer',
        background: active ? '#3a6ea5' : '#222',
        color: active ? '#fff' : '#ccc',
        border: '1px solid ' + (active ? '#5a8fc5' : '#333'),
        borderRadius: 4,
      }}
    >{label}</button>
  );

  const unlockChip = (quest: string, source: 'available' | 'unlocked') => (
    <div
      key={quest}
      draggable
      onDragStart={onDragStartItem(quest)}
      onClick={() => moveQuest(quest, source === 'available' ? 'unlocked' : 'available')}
      style={{
        padding: '0.35rem 0.6rem',
        marginBottom: '0.25rem',
        border: '1px solid ' + (source === 'unlocked' ? '#5a8fc5' : '#444'),
        background: source === 'unlocked' ? '#1f3a5a' : '#1a1a1a',
        color: source === 'unlocked' ? '#cce0f5' : '#bbb',
        borderRadius: 4,
        fontSize: '0.8rem',
        cursor: 'grab',
        userSelect: 'none',
      }}
      title="Drag between panels, or click to toggle"
    >{quest}</div>
  );

  const panel = (title: string, items: string[], target: 'available' | 'unlocked') => (
    <div
      onDragOver={onDragOverPanel}
      onDrop={onDropToPanel(target)}
      style={{
        flex: 1,
        minWidth: 220,
        border: '1px dashed #333',
        borderRadius: 6,
        padding: '0.6rem',
        background: '#101010',
      }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: '#aaa' }}>
        {title} <span style={{ color: '#666' }}>({items.length})</span>
      </h3>
      {items.length === 0
        ? <p style={{ color: '#555', fontSize: '0.75rem', fontStyle: 'italic', margin: 0 }}>drop unlocks here</p>
        : items.map((q) => unlockChip(q, target))}
    </div>
  );

  return (
    <main style={{ maxWidth: 1600, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ margin: '0 0 0.5rem' }}>TzKal-Zuk simulation</h1>
      <p style={{ color: '#888', marginTop: 0 }}>
        Brute-forces the player&apos;s accessible pool (vendor shops + drops
        from killed bosses) to find the best loadout per combat style vs
        TzKal-Zuk Normal phase (1200 HP, 0 stab/slash/crush def, 350 magic
        def, 100 standard ranged def, weak to water 40%). Configure stats /
        quests / bosses and click Run. Ties on DPS are broken by total
        defensive stat, then prayer bonus.
      </p>

      {error && <p style={{ color: '#f55', marginTop: '0.75rem' }}>Error: {error}</p>}

      <section style={{ marginTop: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Stats:</span>
          {statsButton(stats === 'L1', 'Level 1', () => setStats('L1'))}
          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
            <input
              type="text"
              value={lookupName}
              onChange={(e) => setLookupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') lookupPlayer(); }}
              placeholder="OSRS player name"
              disabled={lookupBusy || running}
              style={{
                padding: '0.35rem 0.5rem',
                fontSize: '0.85rem',
                width: 160,
                border: '1px solid #444',
                background: '#1a1a1a',
                color: '#ddd',
                borderRadius: 4,
              }}
            />
            <button
              onClick={lookupPlayer}
              disabled={lookupBusy || running || !lookupName.trim()}
              style={{
                padding: '0.4rem 0.8rem',
                fontSize: '0.9rem',
                cursor: (lookupBusy || running || !lookupName.trim()) ? 'default' : 'pointer',
                background: stats === 'lookup' ? '#3a6ea5' : '#222',
                color: stats === 'lookup' ? '#fff' : '#ccc',
                border: '1px solid ' + (stats === 'lookup' ? '#5a8fc5' : '#333'),
                borderRadius: 4,
              }}
              title="Fetch this account's hiscores stats"
            >
              {lookupBusy ? 'Looking up…' : 'Lookup player'}
            </button>
          </div>
          {statsButton(stats === 'L99', 'Level 99', () => setStats('L99'))}
        </div>
        <button
          onClick={runWithCurrent}
          disabled={running}
          style={{
            padding: '0.5rem 1.2rem',
            fontSize: '0.95rem',
            fontWeight: 600,
            cursor: running ? 'default' : 'pointer',
            background: running ? '#222' : '#3a6ea5',
            color: running ? '#666' : '#fff',
            border: '1px solid ' + (running ? '#333' : '#5a8fc5'),
            borderRadius: 4,
          }}
          title="Run the brute-force sim with the current stats, completed quests, and killed bosses."
        >
          {running ? 'Running…' : 'Run simulation'}
        </button>
        <div style={{ color: '#888', fontSize: '0.85rem' }}>
          {totalCombos > 0
            ? `pool: ${poolSize} items (${obsoleteCount} obsolete removed) · ${totalCombos.toLocaleString()} combinations evaluated`
            : 'configure stats / quests / bosses, then click Run'}
        </div>
      </section>

      {lookupSummary && (
        <p style={{ color: stats === 'lookup' ? '#cce0f5' : '#666', marginTop: '0.5rem', fontSize: '0.8rem' }}>
          Hiscores: {lookupSummary}
        </p>
      )}

      <section style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={autocompleteCompletable}
          disabled={running}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            cursor: running ? 'default' : 'pointer',
            background: '#2a4a3a',
            color: '#cce6d4',
            border: '1px solid #3a6a4a',
            borderRadius: 4,
          }}
          title="Mark every quest as completed whose stat requirements the current preset meets. Skips Fight Caves (boss unlock) and the QP pseudo-entry."
        >
          Auto-complete completable quests
        </button>
        <button
          onClick={() => setCompletedQuests(new Set())}
          disabled={running}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            cursor: running ? 'default' : 'pointer',
            background: '#3a2a2a',
            color: '#e6cccc',
            border: '1px solid #6a3a3a',
            borderRadius: 4,
          }}
          title="Move every unlocked entry back to Available"
        >
          Clear unlocks
        </button>
      </section>

      <section style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {panel('Available unlocks', available, 'available')}
        {panel('Unlocked', unlocked, 'unlocked')}
      </section>

      <section style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={autoMarkKillable}
          disabled={running}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            cursor: running ? 'default' : 'pointer',
            background: '#2a4a3a',
            color: '#cce6d4',
            border: '1px solid #3a6a4a',
            borderRadius: 4,
          }}
          title="Mark every currently-killable boss as Killed. Locked bosses (red) are skipped."
        >
          Auto-mark killable bosses
        </button>
        <button
          onClick={clearKilled}
          disabled={running}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            cursor: running ? 'default' : 'pointer',
            background: '#3a2a2a',
            color: '#e6cccc',
            border: '1px solid #6a3a3a',
            borderRadius: 4,
          }}
          title="Move every killed boss back to Available"
        >
          Clear killed
        </button>
        <span style={{ color: '#666', fontSize: '0.8rem' }}>
          ({killable.length} killable · {Object.keys(BOSS_REQS).length - killable.length} locked by reqs)
        </span>
      </section>

      <section style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {bossPanel('Available bosses', bossAvailable, 'available')}
        {bossPanel('Killed', bossKilled, 'killed')}
      </section>

      <section style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={autoMarkAccessibleSources}
          disabled={running}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            cursor: running ? 'default' : 'pointer',
            background: '#2a4a3a',
            color: '#cce6d4',
            border: '1px solid #3a6a4a',
            borderRadius: 4,
          }}
          title="Mark every currently-accessible misc source as Acquired. Locked sources (red) are skipped."
        >
          Auto-mark accessible sources
        </button>
        <button
          onClick={clearAcquiredSources}
          disabled={running}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: '0.85rem',
            cursor: running ? 'default' : 'pointer',
            background: '#3a2a2a',
            color: '#e6cccc',
            border: '1px solid #6a3a3a',
            borderRadius: 4,
          }}
          title="Move every acquired source back to Available"
        >
          Clear acquired
        </button>
        <span style={{ color: '#666', fontSize: '0.8rem' }}>
          ({accessibleMisc.length} accessible · {allMiscNames.length - accessibleMisc.length} locked by reqs)
        </span>
      </section>

      <section style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {sourcePanel('Available equipment sources', sourceAvailable, 'available')}
        {sourcePanel('Acquired', sourceAcquired, 'acquired')}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.25rem' }}>
        {(['melee', 'ranged', 'magic'] as SimStyle[]).map((s) => (
          <div key={s}>
            {results[s]
              ? <StyleCard result={results[s]!} />
              : (
                <article style={{ border: '1px dashed #2c2c2c', borderRadius: 8, padding: '2rem 1rem', textAlign: 'center', color: '#666' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{s[0].toUpperCase() + s.slice(1)}</h2>
                  {/* Immune styles are skipped by the sim — say so instead of prompting a Run. */}
                  <p style={{ margin: '0.5rem 0 0' }}>
                    {isMonsterImmuneToStyle(monster, s)
                      ? `TzKal-Zuk is immune to ${s} — skipped.`
                      : 'Click Run to simulate.'}
                  </p>
                </article>
              )}
          </div>
        ))}
      </section>
    </main>
  );
}

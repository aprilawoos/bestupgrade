// === /crabsim ===
// Brute-forces the no-req vendor item pool to find the best loadout per
// combat style vs the Gemstone Crab (id 14779, 50 000 HP, 0 defence on
// every style, no elemental weakness). Two stat presets — Level 1 (fresh
// account) and all-99s (post-grind) — so the upgrade gap is visible.
//
// Iteration uses `simulateBestLoadout` from src/lib/loadoutSim.ts.
'use client';

import { useCallback, useMemo, useState } from 'react';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { simulateBestLoadout, SimResult, SimStyle } from '@/lib/loadoutSim';
import { allVendorQuestNames, getPlayerAccessiblePool, PlayerProgression } from '@/lib/vendorAccess';
import { AllSkills, autocompletableQuests } from '@/lib/questRequirements';
import { BOSS_REQS, killableBosses } from '@/lib/bossRequirements';
import { BossProgression, getPlayerBossDropPool } from '@/lib/bossAccess';
import type { EquipmentPiece } from '@/types/Player';
import { ModelViewer } from '@/viewer/ModelViewer';
import type { Monster } from '@/types/Monster';
import type { PlayerSkills } from '@/types/Player';

// === Targets ===
const CRAB_NPC_ID = 14779;

function getCrab(): Monster {
  const base = getMonsters().find((m) => m.id === CRAB_NPC_ID);
  if (!base) throw new Error('Gemstone Crab not in monsters.json');
  return { ...base, inputs: { ...INITIAL_MONSTER_INPUTS } };
}

// === Progression presets ===
// L1 = fresh ironman: lvl 1 everywhere, hp 10, 0 quest points, no quests
// started or completed. Pool collapses to walk-up shop items only.
// L99 = maxed: every combat + relevant non-combat skill at 99, all
// quest-gated vendor shops unlocked (every quest referenced by any shop
// access req in the dataset is marked Completed, which implies Started),
// and 290 quest points to clear Champions' Guild and similar QP gates.
const L1_SKILLS: Partial<PlayerSkills> = {
  atk: 1, str: 1, def: 1,
  ranged: 1, magic: 1, prayer: 1,
  hp: 10, mining: 1, herblore: 1,
};

const L99_SKILLS: Partial<PlayerSkills> = {
  atk: 99, str: 99, def: 99,
  ranged: 99, magic: 99, prayer: 99,
  hp: 99, mining: 99, herblore: 99,
};


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
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.85rem', color: '#aaa' }}>Gemstone Crab</h3>
          <ModelViewer modelId={CRAB_NPC_ID} kind="npc" height={300} />
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

function buildProgressionFromQuests(
  stats: StatsPreset,
  completed: ReadonlySet<string>,
  lookedUpSkills: Partial<PlayerSkills> | null,
): PlayerProgression {
  const realQuests = new Set([...completed].filter((q) => q !== QP_PSEUDO_UNLOCK));
  let skills: Partial<PlayerSkills>;
  if (stats === 'L1') skills = L1_SKILLS;
  else if (stats === 'L99') skills = L99_SKILLS;
  else skills = lookedUpSkills ?? L1_SKILLS; // fall back to L1 if lookup hasn't loaded yet
  return {
    skills,
    questPoints: completed.has(QP_PSEUDO_UNLOCK) ? 32 : 0,
    questsStarted: realQuests,
    questsCompleted: realQuests,
  };
}

export default function CrabSim() {
  const monster = useMemo(() => getCrab(), []);

  // The full unlock catalogue — every quest mentioned in any shop's
  // shopAccess + the QP pseudo-unlock. Sorted for stable display.
  const allUnlocks = useMemo(() => {
    const { started, completed } = allVendorQuestNames();
    const set = new Set<string>([...started, ...completed]);
    return [...set, QP_PSEUDO_UNLOCK].sort((a, b) => a.localeCompare(b));
  }, []);

  const [stats, setStats] = useState<StatsPreset>('L1');
  const [completedQuests, setCompletedQuests] = useState<Set<string>>(new Set());
  const [killedBosses, setKilledBosses] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ResultsByStyle>(EMPTY_RESULTS);
  const [poolSize, setPoolSize] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookup state — username buffer, last successfully-fetched skill set,
  // the verified display name from the hiscores response, and the FULL
  // skill table (for quest-req auto-completion).
  const [lookupName, setLookupName] = useState('');
  const [lookupSkills, setLookupSkills] = useState<Partial<PlayerSkills> | null>(null);
  const [lookupAllSkills, setLookupAllSkills] = useState<AllSkills | null>(null);
  const [lookupDisplay, setLookupDisplay] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  const runSim = useCallback((
    nextStats: StatsPreset,
    nextQuests: ReadonlySet<string>,
    skillsOverride?: Partial<PlayerSkills> | null,
    nextKilled?: ReadonlySet<string>,
  ) => {
    setRunning(true);
    setError(null);
    setTimeout(() => {
      try {
        const progression = buildProgressionFromQuests(
          nextStats,
          nextQuests,
          skillsOverride !== undefined ? skillsOverride : lookupSkills,
        );
        const vendorPool = getPlayerAccessiblePool(progression);

        // Boss-drop pool from killed bosses. getPlayerBossDropPool walks the
        // boss-drop graph transitively (Brimstone ring requires all 3 Hydra
        // components, Voidwaker requires hilt+blade+gem, etc.) — so a drop
        // only enters the pool if the player can both wield it AND obtain
        // every required component from a boss they've killed.
        //
        // BossProgression's slayerLevel and isOnTaskFor are only consumed by
        // canKillBoss() which getPlayerBossDropPool does NOT call (it
        // already trusts the killedBosses set as the access decision). Stub
        // values are safe here.
        const killed = nextKilled ?? killedBosses;
        const bossProgression: BossProgression = {
          skills: progression.skills,
          questsStarted: progression.questsStarted,
          questsCompleted: progression.questsCompleted,
          slayerLevel: (progression.skills as { slayer?: number }).slayer ?? 1,
          isOnTaskFor: () => true,
        };
        const bossPool = getPlayerBossDropPool(bossProgression, killed);

        // Merge vendor + boss pools, dedupe by item id (boss drops sometimes
        // overlap shop items — e.g. dragon dagger, dragon pickaxe).
        const seen = new Set<number>(vendorPool.map((p) => p.id));
        const pool: EquipmentPiece[] = [...vendorPool];
        for (const item of bossPool) {
          if (!seen.has(item.id)) { pool.push(item); seen.add(item.id); }
        }

        setPoolSize(pool.length);
        const next: ResultsByStyle = { melee: null, ranged: null, magic: null };
        for (const style of ['melee', 'ranged', 'magic'] as SimStyle[]) {
          next[style] = simulateBestLoadout({ pool, monster, skills: progression.skills, style });
        }
        setResults(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    }, 0);
  }, [monster, lookupSkills, killedBosses]);

  // Run the sim with the current state. Single entry point — every other
  // handler just mutates state silently and the user clicks Run when ready.
  const runWithCurrent = useCallback(() => {
    runSim(stats, completedQuests, undefined, killedBosses);
  }, [runSim, stats, completedQuests, killedBosses]);

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
      const skills = body.skills ?? {};
      setLookupSkills(skills);
      setLookupAllSkills(body.allSkills ?? null);
      setLookupDisplay(body.name ?? name);
      setStats('lookup');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLookupBusy(false);
    }
  }, [lookupName]);

  // Build an AllSkills view for the current stats preset — used by the
  // "auto-complete completable" button to check quest stat requirements.
  // L1 = all-1s, L99 = all-99s, lookup = actual hiscores skills.
  const currentAllSkills = useMemo<AllSkills>(() => {
    if (stats === 'lookup' && lookupAllSkills) return lookupAllSkills;
    const level = stats === 'L99' ? 99 : 1;
    const out: AllSkills = {};
    for (const s of ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
      'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing',
      'mining', 'herblore', 'agility', 'thieving', 'slayer', 'farming', 'runecraft', 'hunter',
      'construction']) out[s] = level;
    return out;
  }, [stats, lookupAllSkills]);

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

  const lookupSummary = lookupDisplay && lookupSkills
    ? `${lookupDisplay} — atk ${lookupSkills.atk} · str ${lookupSkills.str} · def ${lookupSkills.def} · ranged ${lookupSkills.ranged} · magic ${lookupSkills.magic} · prayer ${lookupSkills.prayer} · hp ${lookupSkills.hp}`
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
      <h1 style={{ margin: '0 0 0.5rem' }}>Crab simulation — vendor starter pool</h1>
      <p style={{ color: '#888', marginTop: 0 }}>
        Brute-forces the vendor shop pool vs the Gemstone Crab (50 000 HP,
        0 defence, no elemental weakness). Pick a stat preset and drag quest
        unlocks between the two panels — the 3 style cards re-run on every
        change. Ties on DPS are broken by total defensive stat, then prayer
        bonus.
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
            ? `pool: ${poolSize} items · ${totalCombos.toLocaleString()} combinations evaluated`
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

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.25rem' }}>
        {(['melee', 'ranged', 'magic'] as SimStyle[]).map((s) => (
          <div key={s}>
            {results[s]
              ? <StyleCard result={results[s]!} />
              : (
                <article style={{ border: '1px dashed #2c2c2c', borderRadius: 8, padding: '2rem 1rem', textAlign: 'center', color: '#666' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{s[0].toUpperCase() + s.slice(1)}</h2>
                  <p style={{ margin: '0.5rem 0 0' }}>Click Run to simulate.</p>
                </article>
              )}
          </div>
        ))}
      </section>
    </main>
  );
}

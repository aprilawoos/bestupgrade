// === /crabsim ===
// Brute-forces the no-req vendor item pool to find the best loadout per
// combat style at LEVEL 1 stats vs the Gemstone Crab (id 14779, 50 000 HP,
// 0 defence on every style — so accuracy lands at 100% and the winner is
// purely max-hit × attack-speed).
//
// Iteration uses `simulateBestLoadout` from src/lib/loadoutSim.ts — the same
// engine will be reused to find worthwhile upgrades as the player's pool
// grows.
'use client';

import { useCallback, useMemo, useState } from 'react';
import { availableEquipment } from '@/lib/Equipment';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { vendorStarterItems } from '@/lib/vendorStarter';
import { simulateBestLoadout, SimResult, SimStyle } from '@/lib/loadoutSim';
import { ModelViewer } from '@/viewer/ModelViewer';
import type { Monster } from '@/types/Monster';
import type { EquipmentPiece } from '@/types/Player';

// === Targets ===
const CRAB_NPC_ID = 14779;

function getCrab(): Monster {
  const base = getMonsters().find((m) => m.id === CRAB_NPC_ID);
  if (!base) throw new Error('Gemstone Crab not in monsters.json');
  return { ...base, inputs: { ...INITIAL_MONSTER_INPUTS } };
}

// === Item pool ===
// Resolve the vendor starter list (ids) to full EquipmentPiece objects from
// the equipment dump, since the sim engine works with the full shape.
function buildPool(): EquipmentPiece[] {
  const byId = new Map(availableEquipment.map((e) => [e.id, e]));
  const out: EquipmentPiece[] = [];
  for (const v of vendorStarterItems) {
    const e = byId.get(v.itemId);
    if (e) out.push(e);
  }
  return out;
}

// === Level 1 stats ===
const L1_SKILLS = {
  atk: 1, str: 1, def: 1,
  ranged: 1, magic: 1, prayer: 1,
  hp: 10,
};

// === Slot order for display ===
const SLOTS = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'] as const;

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
export default function CrabSim() {
  const pool = useMemo(() => buildPool(), []);
  const monster = useMemo(() => getCrab(), []);
  const [results, setResults] = useState<Record<SimStyle, SimResult | null>>({ melee: null, ranged: null, magic: null });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSim = useCallback(() => {
    setRunning(true);
    setError(null);
    // Let the button paint the "Running..." state before kicking off the
    // synchronous simulation work.
    setTimeout(() => {
      try {
        const styles: SimStyle[] = ['melee', 'ranged', 'magic'];
        const next: Record<SimStyle, SimResult | null> = { melee: null, ranged: null, magic: null };
        for (const style of styles) {
          next[style] = simulateBestLoadout({ pool, monster, skills: L1_SKILLS, style });
        }
        setResults(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    }, 0);
  }, [pool, monster]);

  const totalCombos = (results.melee?.combosEvaluated ?? 0)
    + (results.ranged?.combosEvaluated ?? 0)
    + (results.magic?.combosEvaluated ?? 0);

  return (
    <main style={{ maxWidth: 1600, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ margin: '0 0 0.5rem' }}>Crab simulation — level 1 starter</h1>
      <p style={{ color: '#888', marginTop: 0 }}>
        Brute-forces the no-req vendor starter pool ({pool.length} items) at
        level 1 stats vs the Gemstone Crab (50 000 HP, 0 defence). Returns
        the highest-DPS loadout for each of melee, ranged, and magic. Ties
        on DPS are broken by total defensive stat + prayer bonus.
      </p>

      <div style={{ marginTop: '1rem' }}>
        <button
          onClick={runSim}
          disabled={running}
          style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: running ? 'default' : 'pointer' }}
        >
          {running ? 'Running…' : (totalCombos > 0 ? 'Re-run simulation' : 'Run simulation')}
        </button>
        {totalCombos > 0 && (
          <span style={{ marginLeft: '1rem', color: '#888' }}>
            {totalCombos} combinations evaluated
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: '#f55', marginTop: '0.75rem' }}>Error: {error}</p>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.25rem' }}>
        {(['melee', 'ranged', 'magic'] as SimStyle[]).map((s) => (
          <div key={s}>
            {results[s]
              ? <StyleCard result={results[s]!} />
              : (
                <article style={{ border: '1px dashed #2c2c2c', borderRadius: 8, padding: '2rem 1rem', textAlign: 'center', color: '#666' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{s[0].toUpperCase() + s.slice(1)}</h2>
                  <p style={{ margin: '0.5rem 0 0' }}>Click <em>Run simulation</em> to find best loadout.</p>
                </article>
              )}
          </div>
        ))}
      </section>
    </main>
  );
}

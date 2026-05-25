// === /bossexample ===
// Six cards, one per cross-check boss, each showing:
//   - The boss 3D model (ModelViewer kind="npc")
//   - The BIS player loadout 3D model
//   - The calc INPUTS (skills, prayer, potion, stance, onSlayerTask, monster)
//   - The calc OUTPUTS (DPS, max hit, accuracy, TTK, monster HP, temple KPH)
//   - The gear breakdown by slot
//
// All DPS/accuracy/maxHit values come from the pre-computed dataset in
// `src/lib/bosses.ts` — re-run `npx jest BossDpsGen` to refresh.
'use client';

import { ModelViewer } from '@/viewer/ModelViewer';
import { bossBaselines, BossBaseline } from '@/lib/bosses';

// === Card config ===
// Hardcoded NPC IDs (cdn/json/monsters.json id field) + gear item IDs
// (cdn/json/equipment.json id field). Stable identifiers — won't shift if
// the wiki BIS or temple KPH changes.
interface CardConfig {
  bossName: string;     // must match a `name` in bossBaselines
  npcId: number;
  gearItemIds: number[]; // for the player-viewer src URL
}

const CARDS: CardConfig[] = [
  {
    bossName: 'Vorkath',
    npcId: 8059, // Vorkath (Post-quest)
    gearItemIds: [26382, 21287, 12018, 22947, 22978, 26384, 22441, 26386, 22981, 31097, 28307],
  },
  {
    bossName: 'Araxxor',
    npcId: 13668,
    gearItemIds: [11865, 21287, 29801, 22947, 22325, 24420, 22441, 24421, 22981, 31097, 28307],
  },
  {
    bossName: 'Cerberus',
    npcId: 5862,
    gearItemIds: [11865, 21287, 29801, 22947, 22325, 24420, 22441, 24421, 22981, 31097, 28307],
  },
  {
    bossName: 'Corporeal Beast',
    npcId: 319,
    gearItemIds: [26382, 21287, 29801, 22947, 26219, 27238, 22441, 27241, 22981, 31097, 28307],
  },
  {
    bossName: 'Hueycoatl',
    npcId: 14009, // The Hueycoatl (Normal)
    gearItemIds: [24419, 21287, 29801, 27544, 22978, 24420, 22441, 24421, 22981, 31097, 28307],
  },
  {
    bossName: "Phosani's Nightmare",
    npcId: 9416,
    gearItemIds: [24419, 21287, 29801, 22947, 22325, 24420, 22441, 24421, 22981, 31097, 28307],
  },
];

// === Card ===
function BossCard({ cfg, baseline }: { cfg: CardConfig; baseline: BossBaseline }) {
  const { bis, dps, maxHit, accuracy, monsterHp, ttkSec, kph, note } = baseline;
  const theoryKph = ttkSec ? Math.round(3600 / ttkSec) : null;
  const playerSrc = `/api/player/base?gender=female&items=${cfg.gearItemIds.join(',')}&kits=296`;

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
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{baseline.name}</h2>
        <span style={{ color: '#888', fontSize: '0.85rem' }}>
          HP {monsterHp} · Temple {kph} kph
        </span>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.85rem', color: '#aaa' }}>Player BIS</h3>
          <ModelViewer src={playerSrc} height={300} />
        </div>
        <div>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.85rem', color: '#aaa' }}>Boss</h3>
          <ModelViewer modelId={cfg.npcId} kind="npc" height={300} />
        </div>
      </div>

      {bis && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
          <section>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>
              Calc inputs
            </h3>
            <dl style={{ margin: 0, fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem' }}>
              <dt style={{ color: '#888' }}>Skills:</dt><dd style={{ margin: 0 }}>all 99</dd>
              <dt style={{ color: '#888' }}>Style:</dt><dd style={{ margin: 0 }}>{bis.style}</dd>
              <dt style={{ color: '#888' }}>Stance:</dt><dd style={{ margin: 0 }}>{bis.stance}</dd>
              <dt style={{ color: '#888' }}>Prayer:</dt><dd style={{ margin: 0 }}>{bis.prayer}</dd>
              <dt style={{ color: '#888' }}>Potion:</dt><dd style={{ margin: 0 }}>{bis.potion}</dd>
              <dt style={{ color: '#888' }}>On task:</dt><dd style={{ margin: 0 }}>{bis.onSlayerTask ? 'yes' : 'no'}</dd>
              <dt style={{ color: '#888' }}>Monster:</dt>
              <dd style={{ margin: 0 }}>{baseline.name}{bis.monsterVersion ? ` (${bis.monsterVersion})` : ''}</dd>
            </dl>
          </section>

          <section>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>
              Calc outputs
            </h3>
            <dl style={{ margin: 0, fontSize: '0.85rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.15rem 0.5rem' }}>
              <dt style={{ color: '#888' }}>DPS:</dt><dd style={{ margin: 0, fontWeight: 600 }}>{dps?.toFixed(3)}</dd>
              <dt style={{ color: '#888' }}>Max hit:</dt><dd style={{ margin: 0 }}>{maxHit}</dd>
              <dt style={{ color: '#888' }}>Accuracy:</dt><dd style={{ margin: 0 }}>{accuracy !== undefined ? (accuracy * 100).toFixed(1) + '%' : '—'}</dd>
              <dt style={{ color: '#888' }}>TTK:</dt><dd style={{ margin: 0 }}>{ttkSec?.toFixed(1)}s</dd>
              <dt style={{ color: '#888' }}>Theory kph:</dt><dd style={{ margin: 0 }}>{theoryKph}</dd>
              <dt style={{ color: '#888' }}>Temple kph:</dt><dd style={{ margin: 0 }}>{kph}</dd>
            </dl>
          </section>
        </div>
      )}

      {bis && (
        <section style={{ marginTop: '0.75rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem' }}>
            Gear
          </h3>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', columns: 2, columnGap: '1rem', fontSize: '0.8rem' }}>
            {(['head','cape','neck','ammo','weapon','body','shield','legs','hands','feet','ring'] as const).map((slot) => (
              <li key={slot} style={{ breakInside: 'avoid' }}>
                <span style={{ color: '#888' }}>{slot}:</span> {bis.gear[slot] ?? '—'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {note && (
        <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>{note}</p>
      )}
    </article>
  );
}

// === Page ===
export default function BossExample() {
  const cards = CARDS.map((cfg) => {
    const baseline = bossBaselines.find((b) => b.name === cfg.bossName);
    if (!baseline) throw new Error(`No baseline for ${cfg.bossName} — did src/lib/bosses.ts regenerate?`);
    return { cfg, baseline };
  });

  return (
    <main style={{ maxWidth: 1600, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ margin: '0 0 0.5rem' }}>Boss BIS baselines — example set</h1>
      <p style={{ color: '#888', marginTop: 0 }}>
        Six bosses where the calc's theoretical KPH lands within ±35% of
        temple's IM-EHB. Each card shows the wiki BIS loadout, the calc inputs,
        the resulting DPS/max-hit/accuracy/TTK, and 3D models of both player
        and boss. First model load triggers the cache parse (~30s).
      </p>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '1.25rem' }}>
        {cards.map(({ cfg, baseline }) => (
          <BossCard key={cfg.bossName} cfg={cfg} baseline={baseline} />
        ))}
      </section>
    </main>
  );
}

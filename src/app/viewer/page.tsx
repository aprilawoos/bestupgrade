// === /viewer — phases 1, 2, 3, 4 demo ===
// Phase 1: item model        (Abyssal whip, model id 5409)
// Phase 2: NPC model         (Abyssal demon, npc id 415)
// Phase 3: base player body  (kits only)
// Phase 4: equipped player   (kits + items merged via wearPos rules)
//
// Item ids for the phase-4 demo (a recognisable dragon set):
//   Dragon scimitar 4587, Dragon med helm 1149, Dragon chainbody 3140,
//   Dragon platelegs 4087, Dragon boots 11840, Dragon gloves 7459,
//   Dragon kiteshield 1187, Fire cape 6570, Amulet of fury 6585.

import { ModelViewer } from '@/viewer/ModelViewer';

const DRAGON_LOADOUT = [
  4587,  // Dragon scimitar
  1149,  // Dragon med helm
  3140,  // Dragon chainbody
  4087,  // Dragon platelegs
  11840, // Dragon boots
  7459,  // Dragon gloves
  1187,  // Dragon kiteshield
  6570,  // Fire cape
  6585,  // Amulet of fury
].join(',');

export default function ViewerPage() {
  return (
    <main style={{ maxWidth: 1280 }}>
      <h1>3D viewer — phases 1–4</h1>
      <p>
        Drag to rotate, scroll to zoom. No colours/textures yet — just
        geometry. First load triggers the cache parse (~30s).
      </p>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Abyssal whip</h2>
          <p style={{ marginTop: 0, color: '#888' }}>item 4151 · model 5409</p>
          <ModelViewer modelId={5409} kind="model" />
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Abyssal demon</h2>
          <p style={{ marginTop: 0, color: '#888' }}>npc 415 · first model only</p>
          <ModelViewer modelId={415} kind="npc" />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Base player (male)</h2>
          <p style={{ marginTop: 0, color: '#888' }}>default kits · no items</p>
          <ModelViewer src="/api/player/base?gender=male" />
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Base player (female)</h2>
          <p style={{ marginTop: 0, color: '#888' }}>default kits · no items</p>
          <ModelViewer src="/api/player/base?gender=female" />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Dragon set (male)</h2>
          <p style={{ marginTop: 0, color: '#888' }}>kits + items composed via wearPos rules</p>
          <ModelViewer src={`/api/player/base?gender=male&items=${DRAGON_LOADOUT}`} />
        </div>
        <div>
          <h2 style={{ marginTop: 0 }}>Dragon set (female)</h2>
          <p style={{ marginTop: 0, color: '#888' }}>kits + items composed via wearPos rules</p>
          <ModelViewer src={`/api/player/base?gender=female&items=${DRAGON_LOADOUT}`} />
        </div>
      </section>
    </main>
  );
}

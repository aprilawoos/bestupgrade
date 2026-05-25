// === /viewer — phases 1, 2, 3, 4 demo ===
// Phase 1: item model        (Abyssal whip, model id 5409)
// Phase 2: NPC model         (Abyssal demon, npc id 415)
// Phase 3: base player body  (kits only)
// Phase 4: equipped player   (kits + items merged via wearPos rules)
// Phase 8: per-weapon idle-pose visual sanity check (the page's
//          ad-hoc test bed for skeletal anim across weapon shapes)
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

// === Phase 8 weapon-shape spot checks ===
// Each entry is a single weapon equipped on the default female kit set.
// Used to eyeball that the default idle (sequence 808) doesn't break in
// odd ways for unusual weapon meshes — until per-weapon idle resolution
// (project_phase8_deferred_per_weapon_idle.md memory) is wired up, all
// of these will use the unarmed slack-arm pose, which is the known
// limitation we're verifying.
const WEAPON_CHECKS: { name: string; id: number }[] = [
  { name: 'Armadyl godsword', id: 11802 },
  { name: 'Scythe of vitur',  id: 22325 },
  { name: 'Noxious halberd',  id: 29796 },
  { name: 'Heavy ballista',   id: 19481 },
  { name: 'Venator bow',      id: 27610 },
];

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

      <h2 style={{ marginTop: '2rem' }}>Phase 8 — weapon idle spot checks (female)</h2>
      <p style={{ color: '#888' }}>
        Single-weapon female loadouts. All play sequence 808 (default
        unarmed idle) regardless of weapon — per-weapon idle resolution
        is a known follow-on; the point of this section is to verify the
        unarmed pose doesn't render incorrectly for unusual weapon meshes.
      </p>
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        {WEAPON_CHECKS.map((w) => (
          <div key={w.id}>
            <h3 style={{ marginTop: 0 }}>{w.name}</h3>
            <p style={{ marginTop: 0, color: '#888' }}>item {w.id}</p>
            {/* kits=296 matches the home page — overrides the default jaw
                so the female doesn't pick up a male-style jaw kit. */}
            <ModelViewer src={`/api/player/base?gender=female&items=${w.id}&kits=296`} />
          </div>
        ))}
      </section>
    </main>
  );
}

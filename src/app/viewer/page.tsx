// === /viewer — phase 1 demo ===
// Renders the Abyssal whip's equip model (id 5409). Visiting this page on
// a fresh dev server triggers the first cache load (~30s); subsequent loads
// are instant thanks to the module-level singleton.

import { ModelViewer } from '@/viewer/ModelViewer';

export default function ViewerPage() {
  return (
    <main>
      <h1>Phase 1 — single model</h1>
      <p>
        Abyssal whip equip model (id <strong>5409</strong>). Drag to rotate,
        scroll to zoom. No colours/textures yet — just geometry from the cache.
      </p>
      <ModelViewer modelId={5409} />
    </main>
  );
}

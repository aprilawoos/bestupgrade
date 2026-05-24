#!/usr/bin/env node
// Quick diagnostic: load cache, inspect kit defs, attempt composeBaseBody.

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSCache, IndexType, ConfigType } from 'osrscachereader';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'cache', 'cache');

const log = (m = '') => process.stdout.write(`${m}\n`);

log('> loading cache...');
const cache = new RSCache(CACHE_DIR);
await cache.onload;
log('  loaded');

// Step 1: enumerate all kits, show shape of first non-null one
const allKits = await cache.getAllDefs(IndexType.CONFIGS, ConfigType.IDENTKIT);
log(`\n  total kits: ${allKits.length}`);
log(`  first non-null kit keys: ${Object.keys(allKits.find(k => k != null) || {}).join(', ')}`);
log(`  sample kit (first 5 non-null):`);
let shown = 0;
for (const kit of allKits) {
  if (!kit || shown >= 5) continue;
  log(`    id=${kit.id} bodyPartId=${kit.bodyPartId} nonSelectable=${kit.nonSelectable} models=${JSON.stringify(kit.models)}`);
  shown += 1;
}

// Step 2: try composing (inline, can't import .ts from .mjs)
log('\n> attempting base-body composition (male)...');
try {
  const kitByPart = new Map();
  for (const kit of allKits) {
    if (!kit || kit.nonSelectable) continue;
    if (typeof kit.bodyPartId !== 'number' || kit.bodyPartId < 0) continue;
    if (!kitByPart.has(kit.bodyPartId)) kitByPart.set(kit.bodyPartId, kit);
  }
  log(`  selected kits per body part: ${[...kitByPart.entries()].map(([p, k]) => `${p}=>${k.id}`).join(', ')}`);

  const modelIds = [];
  for (const partId of [0, 1, 2, 3, 4, 5, 6]) {
    const kit = kitByPart.get(partId);
    if (!kit) continue;
    for (const m of kit.models ?? []) if (typeof m === 'number' && m >= 0) modelIds.push(m);
  }
  log(`  model ids to load: ${modelIds.join(', ')}`);

  const models = await Promise.all(modelIds.map((id) => cache.getDef(IndexType.MODELS, id)));
  let verts = 0, faces = 0;
  for (const m of models) {
    if (!m) { log(`  WARN: a model failed to load`); continue; }
    verts += m.vertexCount;
    faces += m.faceCount;
  }
  log(`  total geometry: ${verts} verts, ${faces} faces across ${models.length} models`);
} catch (e) {
  log(`  FAIL: ${e.stack || e.message}`);
}

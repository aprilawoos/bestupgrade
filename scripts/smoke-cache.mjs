#!/usr/bin/env node
// =============================================================================
// scripts/smoke-cache.mjs — verify osrscachereader can load our local cache
// =============================================================================
//
// Phase-0 sanity check. Loads the cache from ./cache/, then looks up:
//   - Abyssal whip      (item id 4151) — confirms item loader works
//   - Abyssal demon     (npc id 415)   — confirms npc loader works
//   - The whip's model  (from item def) — confirms model loader works
//
// If all three succeed, the cache + loader pipeline is wired and we can start
// building the avatar composer on top.
// =============================================================================

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSCache, IndexType } from 'osrscachereader';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The path passed to RSCache is the directory that DIRECTLY contains the
// main_file_cache.dat2 / .idx files. The openrs2 disk.zip unpacks into a
// `cache/` subdir under our top-level `cache/`, so the real path is
// `./cache/cache/`. (The README's "must contain a folder named cache" is
// misleading — confirmed by reading CacheLoader.js.)
const CACHE_DIR = join(ROOT, 'cache', 'cache');

const log = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`x ${m}\n`); process.exit(1); };

if (!existsSync(join(CACHE_DIR, 'main_file_cache.dat2'))) {
  die(`cache not found at ${CACHE_DIR}/ — run \`npm run fetch-cache\` first`);
}

log(`> loading cache from ${CACHE_DIR}...`);
const cache = new RSCache(CACHE_DIR);
await cache.onload;
log('  loaded');

// === Known references ===
// Abyssal whip = item 4151, Abyssal demon = npc 415. Both stable for years.
const whip = await cache.getItem(4151);
if (!whip || !whip.name) die('failed to load item 4151 (expected Abyssal whip)');
log(`\n  item 4151:  ${whip.name}`);
log(`    equip male model id: ${whip.maleModel0 ?? 'none'}`);
log(`    wearPos1/2/3:        ${whip.wearPos1}/${whip.wearPos2 ?? '-'}/${whip.wearPos3 ?? '-'}`);

const demon = await cache.getNPC(415);
if (!demon || !demon.name) die('failed to load npc 415 (expected Abyssal demon)');
log(`\n  npc  415:   ${demon.name}`);
log(`    models: ${(demon.models || []).join(', ') || 'none'}`);

// === Model loader works? ===
if (whip.maleModel0 != null && whip.maleModel0 !== -1) {
  const model = await cache.getDef(IndexType.MODELS, whip.maleModel0);
  if (!model) die(`failed to load model id ${whip.maleModel0}`);
  // ModelDefinition exposes vertexCount / faceCount.
  log(`\n  model ${whip.maleModel0}: ${model.vertexCount ?? '?'} verts, ${model.faceCount ?? '?'} faces`);
}

log('\nok cache + loader pipeline verified.');

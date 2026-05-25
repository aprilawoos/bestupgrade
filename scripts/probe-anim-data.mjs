#!/usr/bin/env node
// =============================================================================
// scripts/probe-anim-data.mjs — discover where weapon idle/attack anim IDs live
// =============================================================================
//
// Phase 8 planning probe. Investigates two questions:
//
//   1. Does ItemDefinition.params carry per-weapon stand/walk/attack anim
//      sequence IDs? If yes, which keys? If not, we'll need a category lookup
//      table (Option B) or external data (Option C).
//
//   2. Does NpcDefinition.standingAnimation actually point at a valid
//      SequenceDefinition for our test target (abyssal demon, 415)?
//
// We probe a diverse sample of weapons:
//   - 4151  abyssal whip      (slash, melee 1h)
//   - 11802 armadyl godsword  (slash, 2h)
//   - 11785 armadyl crossbow  (ranged 1h)
//   - 4675  ancient staff     (magic 2h)
//   - 22325 scythe of vitur   (slash 2h, novel anims)
//   - 28997 osmumten's fang   (stab 1h, recent item)
//
// For each we dump: category, all params keys+values, equip male model.
// Then look up any params value in the SEQUENCE config — if a value
// resolves to a SequenceDefinition, we've found our mapping path.
// =============================================================================

import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSCache, IndexType, ConfigType } from 'osrscachereader';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'cache', 'cache');

const log = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`x ${m}\n`); process.exit(1); };

if (!existsSync(join(CACHE_DIR, 'main_file_cache.dat2'))) {
  die(`cache not found at ${CACHE_DIR}/ — run \`npm run fetch-cache\` first`);
}

log(`> loading cache from ${CACHE_DIR}...`);
const cache = new RSCache(CACHE_DIR);
await cache.onload;
log('  loaded\n');

const WEAPONS = [
  { id: 4151,  name: 'abyssal whip' },
  // === Godswords — all four should share the same idle/walk/attack anims
  // (they're the same weapon shape, only colours differ), so they're a good
  // test of whether the per-weapon anim ID is consistent within a category.
  { id: 11802, name: 'armadyl godsword' },
  { id: 11804, name: 'saradomin godsword' },
  { id: 11806, name: 'bandos godsword' },
  { id: 11808, name: 'zamorak godsword' },
  // === Other 2H melee for cross-category sanity
  { id: 7158,  name: 'dragon 2h sword' },
  // === Ranged + magic representatives
  { id: 11785, name: 'armadyl crossbow' },
  { id: 4675,  name: 'ancient staff' },
  // === Recent items with novel anims
  { id: 22325, name: 'scythe of vitur' },
  { id: 28997, name: "osmumten's fang" },
];

// Track which param keys appear across many weapons — those are the
// stable convention keys we'd read from.
const keyOccurrences = new Map(); // key -> [{id, value}, ...]

for (const w of WEAPONS) {
  const item = await cache.getItem(w.id);
  if (!item) { log(`  item ${w.id} (${w.name}): NOT FOUND`); continue; }
  log(`item ${w.id}: ${item.name} (expected ${w.name})`);
  log(`  category: ${item.category ?? '(unset)'}`);
  if (!item.params || Object.keys(item.params).length === 0) {
    log(`  params: (none)`);
  } else {
    log(`  params:`);
    for (const [k, v] of Object.entries(item.params)) {
      log(`    ${k} = ${typeof v === 'string' ? `"${v}"` : v}`);
      if (typeof v === 'number') {
        if (!keyOccurrences.has(k)) keyOccurrences.set(k, []);
        keyOccurrences.get(k).push({ id: w.id, value: v });
      }
    }
  }
  log('');
}

// === Documented anim-related param keys (per OSRSBox / community lookup) ===
// These are the keys we EXPECT to find populated on equipable weapons in
// modern OSRS. If 644 is populated and resolves to a SequenceDefinition with
// frames, our phase-8 plan is unblocked: read it at runtime, no external
// data files needed.
const DOCUMENTED_KEYS = {
  643: 'attack-anim',     // (sometimes; varies)
  644: 'stand (idle)',
  645: 'stand-turn',
  646: 'walk',
  647: 'run',
  648: 'walk-back',
  649: 'walk-left',
  650: 'walk-right',
  651: 'idle-turn-180',
};

log('--- documented param-key verification (per weapon) ---');
for (const w of WEAPONS) {
  const item = await cache.getItem(w.id);
  if (!item) continue;
  const params = item.params ?? {};
  log(`  ${item.name}:`);
  for (const [keyStr, label] of Object.entries(DOCUMENTED_KEYS)) {
    const v = params[keyStr];
    if (v == null) {
      log(`    ${keyStr} (${label}): -`);
      continue;
    }
    // Try to resolve as a SequenceDefinition.
    const seq = await cache
      .getFile(IndexType.CONFIGS, ConfigType.SEQUENCE, v)
      .catch(() => null);
    const def = seq?.def;
    const ok = !!def?.frameIDs?.length || (def?.animMayaID ?? -1) !== -1;
    const detail = def
      ? `${def.frameIDs?.length ?? 0}f, maya=${def.animMayaID ?? -1}`
      : 'UNRESOLVED';
    log(`    ${keyStr} (${label}): ${v}  [${detail}]${ok ? '' : '  !!'}`);
  }
}

// === Any OTHER keys that look like anim ids? ===
// For every numeric param key not in the documented list, if it appears in
// multiple weapons and all its values resolve to SequenceDefinitions, it's
// a candidate we should know about (in case a new convention emerged).
log('\n--- other candidate anim-id keys (multi-weapon + all resolve as SEQUENCE) ---');
for (const [key, entries] of keyOccurrences) {
  if (entries.length < 2) continue;
  if (DOCUMENTED_KEYS[key]) continue;
  const results = await Promise.all(entries.map(async (e) => {
    const seq = await cache
      .getFile(IndexType.CONFIGS, ConfigType.SEQUENCE, e.value)
      .catch(() => null);
    const def = seq?.def;
    return {
      ...e,
      hasFrames: !!def?.frameIDs?.length,
      frameCount: def?.frameIDs?.length ?? 0,
      animMayaID: def?.animMayaID ?? -1,
    };
  }));
  const allResolve = results.every((r) => r.hasFrames || r.animMayaID !== -1);
  if (allResolve) {
    log(`  param ${key}: ${results.map((r) => `${r.value}(${r.frameCount}f)`).join(', ')}  <-- candidate`);
  }
}

// === NPC anim sanity ===
log('\n--- npc 415 (Abyssal demon) animation IDs ---');
const npc = await cache.getNPC(415);
log(`  standingAnimation: ${npc.standingAnimation}`);
log(`  walkingAnimation:  ${npc.walkingAnimation}`);
if (npc.standingAnimation > 0) {
  const seq = await cache
    .getFile(IndexType.CONFIGS, ConfigType.SEQUENCE, npc.standingAnimation)
    .catch(() => null);
  const def = seq?.def;
  log(`  standing seq: ${def?.frameIDs?.length ?? 0} frames, mayaID=${def?.animMayaID ?? -1}`);
}

// === Player idle 808 still exist? ===
log('\n--- sequence 808 (historical player idle) ---');
const seq808 = await cache
  .getFile(IndexType.CONFIGS, ConfigType.SEQUENCE, 808)
  .catch(() => null);
const def808 = seq808?.def;
if (def808) {
  log(`  exists, ${def808.frameIDs?.length ?? 0} frames, mayaID=${def808.animMayaID ?? -1}`);
} else {
  log(`  NOT FOUND in this cache rev`);
}

log('\nok done.');

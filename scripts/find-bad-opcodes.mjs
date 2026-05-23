#!/usr/bin/env node
// =============================================================================
// scripts/find-bad-opcodes.mjs — find which items hit unhandled opcodes
// =============================================================================
//
// osrscachereader's ItemLoader logs `UNHANDLED OPCODE [ItemLoader]: N last: M`
// to console.error when it sees an opcode it doesn't have a handler for. This
// script wraps console.error to attribute each warning to the item being
// loaded at the time, then reports a summary.
//
// Useful for: (a) deciding which items might have wrong fields parsed,
// (b) figuring out which opcodes are most common and worth implementing.
// =============================================================================

import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSCache, IndexType, ConfigType } from 'osrscachereader';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'cache', 'cache');

// Force unbuffered output so progress shows immediately when stdout is piped.
const log = (m = '') => { process.stdout.write(`${m}\n`); };
if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true);

// === Capture warnings per item ===
// We patched ItemLoader.js (via scripts/postinstall.mjs) to include the item id
// in its UNHANDLED-OPCODE message. The warnings fire during cache.onload, so
// hooking console.error before constructing RSCache catches them all.
const warnings = new Map(); // opcode -> { items: Set<number>, total: number }
let totalErrors = 0;
let matchedErrors = 0;

const origErr = console.error;
console.error = (msg) => {
  totalErrors += 1;
  if (totalErrors <= 3) origErr(`[debug] console.error sample: ${String(msg).slice(0, 120)}`);
  const m = /UNHANDLED OPCODE \[ItemLoader\]:\s*(\d+)\s*last:\s*(\d+)\s*item:\s*(\d+)/.exec(String(msg));
  if (!m) { origErr(msg); return; }
  matchedErrors += 1;
  const opcode = Number(m[1]);
  const itemId = Number(m[3]);
  const entry = warnings.get(opcode) || { items: new Set(), total: 0 };
  entry.items.add(itemId);
  entry.total += 1;
  warnings.set(opcode, entry);
};

log('> loading cache...');
const cache = new RSCache(CACHE_DIR);
await cache.onload;

// === Enumerate every item ===
// Iterating archive.files gives us the ids. We then load each via getItem.
const itemArchive = cache.indicies[IndexType.CONFIGS.id].archives[ConfigType.ITEM.id];
const fileIds = itemArchive.files.map((f) => f.id);
log(`  ${fileIds.length} items to scan`);

let loaded = 0;
let nullCount = 0;
for (const id of fileIds) {
  const def = await cache.getItem(id);
  if (def == null) nullCount += 1;
  loaded += 1;
  if (loaded % 5000 === 0) log(`  ...${loaded}/${fileIds.length}`);
}

// === Report ===
log(`\n  loaded:    ${loaded}`);
log(`  null defs: ${nullCount}`);
log(`  console.error fires: total=${totalErrors}, matched-regex=${matchedErrors}`);
log('\nopcodes hit by unhandled-opcode warnings (sorted by item count):');
log('  opcode | items affected | total warnings | sample item ids');
const rows = [...warnings.entries()].sort((a, b) => b[1].items.size - a[1].items.size);
for (const [opcode, info] of rows) {
  const sample = [...info.items].slice(0, 5).join(', ');
  log(`  ${String(opcode).padStart(6)} | ${String(info.items.size).padStart(14)} | ${String(info.total).padStart(14)} | ${sample}`);
}

// === Name samples ===
// For the top-affected opcode, dump a few item names so we know the flavour
if (rows.length > 0) {
  const [topOpcode, topInfo] = rows[0];
  log(`\nsample item names for opcode ${topOpcode}:`);
  const ids = [...topInfo.items].slice(0, 8);
  for (const id of ids) {
    const def = await cache.getItem(id);
    log(`  ${String(id).padStart(6)}  ${def?.name ?? '(no name)'}`);
  }
}

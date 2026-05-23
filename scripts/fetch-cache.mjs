#!/usr/bin/env node
// =============================================================================
// scripts/fetch-cache.mjs — download the latest live OSRS cache from openrs2.org
// =============================================================================
//
// Usage:
//   node scripts/fetch-cache.mjs            # download latest if newer
//   node scripts/fetch-cache.mjs --force    # always re-download
//
// Result: ./cache/cache/main_file_cache.{dat2,idx0,...,idx255}
// which is the layout osrscachereader expects (pass "./cache/" to RSCache).
//
// The cache is large (~300-500 MB) and not redistributable — it's Jagex's
// content, served by the openrs2.org archive for research/preservation. The
// `cache/` directory is gitignored.
//
// API used:
//   - Index: GET https://archive.openrs2.org/caches.json
//   - Download: GET https://archive.openrs2.org/caches/<scope>/<id>/disk.zip
//
// Etiquette: sends a descriptive User-Agent identifying this tool. openrs2
// doesn't publish a rate limit but it's polite to not be anonymous.
// =============================================================================

import { mkdirSync, createWriteStream, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, 'cache');
const META_FILE = join(CACHE_DIR, 'cache-meta.json');
const TMP_ZIP = join(CACHE_DIR, '.disk.zip');

const ARCHIVE_BASE = 'https://archive.openrs2.org';
const USER_AGENT = 'bestupgrade-dev (github.com/aprilawoos/bestupgrade)';

const FORCE = process.argv.includes('--force');

const log = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`x ${m}\n`); process.exit(1); };

// === 1. Pick the latest live OSRS cache from the index ======================

async function pickLatestOSRSCache() {
  log('> fetching cache index from openrs2.org...');
  const res = await fetch(`${ARCHIVE_BASE}/caches.json`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) die(`caches.json fetch failed: HTTP ${res.status}`);
  const caches = await res.json();

  // Filter to live OSRS caches that the archive considers fully valid.
  // `disk_store_valid: true` means all indices/groups were captured cleanly.
  const candidates = caches
    .filter((c) => c.game === 'oldschool' && c.environment === 'live')
    .filter((c) => c.disk_store_valid === true)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (candidates.length === 0) die('no live OSRS caches with disk_store_valid=true in the index');
  return candidates[0];
}

// === 2. Download the disk.zip ===============================================

async function downloadDiskZip(cache) {
  const url = `${ARCHIVE_BASE}/caches/${cache.scope}/${cache.id}/disk.zip`;
  log(`> downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) die(`disk.zip fetch failed: HTTP ${res.status}`);

  const size = res.headers.get('content-length');
  if (size) log(`  size: ${(Number(size) / 1024 / 1024).toFixed(1)} MB`);

  await pipeline(Readable.fromWeb(res.body), createWriteStream(TMP_ZIP));
  log('  download complete');
}

// === 3. Extract ==============================================================

function extractZip() {
  log('> extracting...');
  // `unzip` ships with Git Bash on Windows and with most Linux/macOS distros.
  // -q quiet, -o overwrite existing files without prompting.
  execSync(`unzip -q -o "${TMP_ZIP}" -d "${CACHE_DIR}"`, { stdio: 'inherit' });
  rmSync(TMP_ZIP);
  log('  extraction complete');
}

// === 4. Main =================================================================

async function main() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const latest = await pickLatestOSRSCache();
  log(`  latest: id=${latest.id}, build=${latest.builds?.[0]?.major}, timestamp=${latest.timestamp}`);

  if (!FORCE && existsSync(META_FILE)) {
    const existing = JSON.parse(readFileSync(META_FILE, 'utf8'));
    if (existing.id === latest.id) {
      log(`\nok already at cache id=${latest.id}, nothing to do (use --force to re-download)`);
      return;
    }
    log(`  local cache is id=${existing.id}, upgrading to ${latest.id}`);
  }

  await downloadDiskZip(latest);
  extractZip();
  writeFileSync(META_FILE, JSON.stringify(latest, null, 2));

  log(`\nok cache fetched into ${CACHE_DIR}/cache/`);
  log('  next: pass "./cache/" to osrscachereader\'s RSCache constructor');
}

main().catch((e) => die(e.stack || e.message));

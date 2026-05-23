#!/usr/bin/env node
// =============================================================================
// scripts/sync-upstream.mjs — re-sync vendored code from weirdgloop/osrs-dps-calc
// =============================================================================
//
// Usage:
//   node scripts/sync-upstream.mjs              # diff + copy + verify
//   node scripts/sync-upstream.mjs --dry-run    # diff only, no copy
//   node scripts/sync-upstream.mjs --no-test    # copy + tsc, skip jest
//
// All vendored paths are copied byte-for-byte. The vendored code is identical
// to upstream by design — there are zero local modifications to re-apply.
// Anything in src/app/, src/prices/, src/upgrade/, package.json, tsconfig.json,
// next.config.js, etc. is OUR code and is never touched by this script.
//
// After copy, `tsc --noEmit` and (unless --no-test) `npm test` run to surface
// breakage from upstream changes — most commonly a new import that pulls a
// new npm package we don't have yet, which the typecheck error message will
// name explicitly.
//
// One coupled-but-not-vendored file: next.config.js's `transpilePackages` list
// must mirror upstream's, or next/jest will fail to transform ESM packages.
// The script reads upstream's next.config.js and warns if the list drifts.
// =============================================================================

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// === Configuration ===========================================================

const REPO = 'https://github.com/weirdgloop/osrs-dps-calc.git';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Paths to copy from upstream into our repo. Each path is identical between
// the two trees by design — we mirror upstream's layout so re-sync is `cp -r`.
const VENDORED = [
  'src/lib',
  'src/enums',
  'src/types',
  'src/utils.ts',
  'src/state.tsx',
  'src/worker',
  'src/tests',
  'src/public',
  'src/app/components/player/demonicPactsLeague',
  'cdn/json',
  'jest.config.ts',
];

// === Flag parsing ============================================================

const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry-run');
const SKIP_TEST = flags.has('--no-test');

// === Tiny logging helpers ====================================================

const log = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`x ${m}\n`); process.exit(1); };

// === 1. Clone upstream into a temp dir =======================================

const tmp = mkdtempSync(join(tmpdir(), 'osrs-dps-sync-'));
const upstreamRoot = join(tmp, 'osrs-dps-calc');
log(`> cloning ${REPO} (shallow) into ${tmp}...`);
try {
  execSync(`git clone --depth 1 "${REPO}" "${upstreamRoot}"`, { stdio: 'inherit' });
} catch (e) {
  rmSync(tmp, { recursive: true, force: true });
  die(`git clone failed: ${e.message}`);
}

// === 2. Diff summary =========================================================

log('\n> diff summary (local vs upstream):');
let totalDiffering = 0;
for (const rel of VENDORED) {
  const upstreamPath = join(upstreamRoot, rel);
  const localPath = join(ROOT, rel);

  if (!existsSync(upstreamPath)) {
    log(`  ! ${rel} — missing in upstream (upstream may have removed/renamed it)`);
    continue;
  }
  if (!existsSync(localPath)) {
    log(`  + ${rel} — not present locally (will be created on copy)`);
    totalDiffering += 1;
    continue;
  }

  // `diff -rq` exits 0 if identical, 1 if different, >1 on error.
  const r = spawnSync('diff', ['-rq', localPath, upstreamPath], { encoding: 'utf8' });
  if (r.status === 0) {
    log(`  . ${rel} — identical`);
  } else if (r.status === 1) {
    const diffLines = (r.stdout + r.stderr).split('\n').filter(Boolean);
    log(`  ~ ${rel} — ${diffLines.length} file(s) differ`);
    totalDiffering += diffLines.length;
  } else {
    log(`  ? ${rel} — diff command errored: ${r.stderr.trim() || 'unknown'}`);
  }
}
log(`\n  total: ${totalDiffering} file(s) would change`);

// === 3. Check transpilePackages coupling =====================================

const extractTranspilePackages = (src) => {
  const m = src.match(/transpilePackages\s*:\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean).sort();
};

const upstreamNextCfg = readFileSync(join(upstreamRoot, 'next.config.js'), 'utf8');
const ourNextCfg = readFileSync(join(ROOT, 'next.config.js'), 'utf8');
const upstreamTP = extractTranspilePackages(upstreamNextCfg);
const ourTP = extractTranspilePackages(ourNextCfg);

if (JSON.stringify(upstreamTP) !== JSON.stringify(ourTP)) {
  log('\n  ! next.config.js transpilePackages differs from upstream:');
  log(`      upstream: ${JSON.stringify(upstreamTP)}`);
  log(`      ours:     ${JSON.stringify(ourTP)}`);
  log('    Update next.config.js manually if upstream added a package we now need.');
}

// === 4. Dry-run exit =========================================================

if (DRY_RUN) {
  log('\n--dry-run set, not copying. Re-run without --dry-run to apply changes.');
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

// === 5. Copy =================================================================

log('\n> copying vendored paths...');
for (const rel of VENDORED) {
  const upstreamPath = join(upstreamRoot, rel);
  const localPath = join(ROOT, rel);

  if (!existsSync(upstreamPath)) {
    log(`  ! ${rel} — skipped (missing in upstream)`);
    continue;
  }
  // Wipe local first so upstream deletions propagate correctly.
  if (existsSync(localPath)) {
    rmSync(localPath, { recursive: true, force: true });
  }
  cpSync(upstreamPath, localPath, { recursive: true });
  log(`  ok ${rel}`);
}

// === 6. Cleanup temp clone ===================================================

rmSync(tmp, { recursive: true, force: true });

// === 7. Verify: typecheck ====================================================

log('\n> typechecking with tsc...');
const tscResult = spawnSync('npx', ['tsc', '--noEmit'], {
  stdio: 'inherit', cwd: ROOT, shell: true,
});
if (tscResult.status !== 0) {
  log('\nx typecheck failed.');
  log('  Likely cause: upstream added an import for a new package or a new');
  log('  internal file. The error above names what is missing. Install the');
  log('  package (npm install <name>) or vendor the new file, then re-run.');
  process.exit(1);
}

// === 8. Verify: tests ========================================================

if (SKIP_TEST) {
  log('\n--no-test set, skipping jest. Run `npm test` manually when ready.');
  process.exit(0);
}

log('\n> running jest...');
const testResult = spawnSync('npm', ['test', '--', '--silent'], {
  stdio: 'inherit', cwd: ROOT, shell: true,
});
if (testResult.status !== 0) {
  log('\n! tests failed.');
  log('  Could be a real calc regression in upstream, OR the known-broken');
  log('  Leagues tests that fail upstream too. Inspect output above to');
  log('  decide whether to investigate or accept.');
  process.exit(1);
}

log('\nok sync complete. Vendored code now matches upstream HEAD.');

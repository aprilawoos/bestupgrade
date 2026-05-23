// === Server-side RSCache singleton ===
// The OSRS cache is ~160 MiB and takes ~30s to fully load. We construct it
// once per Node process (Next dev server keeps the module alive across
// requests so the load only happens on the first call). Concurrent first
// calls all await the same promise.
//
// Path resolution: process.cwd() is the project root when Next runs API
// routes, so ./cache/cache/ resolves correctly. If you move the cache
// directory, update CACHE_DIR.

import { resolve } from 'node:path';
import { RSCache } from 'osrscachereader';

const CACHE_DIR = resolve(process.cwd(), 'cache', 'cache');

// RSCache has no .d.ts (see osrscachereader.d.ts), so the promise is `any`
// for now. Refine when we write proper types for the loaders we care about.
let cachePromise: Promise<any> | null = null;

export function getCache(): Promise<any> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const c = new RSCache(CACHE_DIR);
    await c.onload;
    return c;
  })();
  return cachePromise;
}

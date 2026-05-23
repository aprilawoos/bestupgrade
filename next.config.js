// === Next.js configuration ===
// Minimal. The vendored calc runs on the client, but a Next API route under
// src/app/api/ is the planned home for the wiki realtime-prices proxy when we
// add it (lets us set a proper User-Agent server-side and cache responses).

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Matches upstream weirdgloop/osrs-dps-calc next.config.js. d3-array and
  // internmap publish ESM only; transpilePackages tells Next to compile them
  // to CJS for both the app bundle AND next/jest tests (which is what makes
  // upstream's Jest setup work without any transformIgnorePatterns tweaks).
  transpilePackages: [
    // ESM-only deps that Next/Jest need to transpile to CJS for tests + bundles.
    // Mirrors upstream's next.config.js so vendored code parses identically.
    'd3',
    'd3-array',
    'internmap',
  ],

  // osrscachereader is server-only and pulls native deps (canvas, wasm-bz2)
  // that webpack cannot bundle. Marking it external tells Next to leave the
  // import as a runtime `require()` in Node — which works because the API
  // route runs in Node and the package sits in node_modules. Do NOT also
  // put this in transpilePackages — the two settings contradict.
  //
  // Next 14.x uses experimental.serverComponentsExternalPackages (the
  // top-level serverExternalPackages key only landed in Next 15).
  experimental: {
    serverComponentsExternalPackages: ['osrscachereader'],
  },
};

module.exports = nextConfig;

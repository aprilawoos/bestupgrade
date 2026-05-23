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
  transpilePackages: ['d3', 'd3-array', 'internmap'],
};

module.exports = nextConfig;

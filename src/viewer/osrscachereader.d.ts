// === osrscachereader type shim ===
// The package ships no .d.ts files, so we declare it as a loose module here.
// All osrscachereader imports get `any` typing — not ideal, but the alternative
// is writing full TypeScript declarations for someone else's API. Revisit if
// the looseness causes real bugs.

declare module 'osrscachereader';

# weapon-animation-replacer (vendored data)

This directory vendors a single data file from the
**[geheur/weapon-animation-replacer](https://github.com/geheur/weapon-animation-replacer)**
RuneLite plugin, used as a source-of-truth for the per-weapon idle/walk/attack
animation IDs in OSRS.

## Why we vendor this

The OSRS engine sets each player's idle pose animation **server-side**, per
the equipped weapon — there is no offline `ItemDefinition → idle anim`
field in the cache. Our 3D player viewer needs that mapping to render the
correct idle pose for each weapon. The `weapon-animation-replacer` plugin
is purpose-built for swapping weapon animations and maintains a curated
table of 131 weapon groups covering hundreds of items.

We only consume the `poseanims` and `animationSets` fields of `data.json`
right now (see `src/viewer/weaponIdleAnims.ts`). The full file is vendored
verbatim to (a) preserve the upstream license cleanly and (b) keep walk /
run / attack anims available for future use without re-fetching.

## Source

- Upstream repo: <https://github.com/geheur/weapon-animation-replacer>
- File: `src/main/resources/com/weaponanimationreplacer/data.json`
- Pinned commit: `0a0f2f371c165547e51aab645df153a0ea277321`
  (commit message "Add thamarrons sceptre and update to rev 237 april 1.")
- Vendored: 2026-05-25
- Vendored size: 90 041 bytes

## License

BSD-2-Clause. Full text is in `LICENSE` in this directory, copyright
**(c) 2021, geheur**. Per the BSD-2-Clause source-redistribution clause,
the copyright notice + license + disclaimer must travel with the file —
that's what this `LICENSE` next to `data.json` satisfies.

## Updating

When the upstream data refreshes (new weapons released after April 2026, etc.):

1. Fetch the new `data.json` from the upstream commit you want to track.
2. Replace `data.json` here.
3. Update the **Pinned commit** and **Vendored** date above.
4. Re-run the typecheck (`npx tsc --noEmit`) to make sure the structural
   assumptions in `src/viewer/weaponIdleAnims.ts` still hold (`poseanims`
   shape, `animationSets[i].animations[0]` = STAND idle, etc.).

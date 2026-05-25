// =============================================================================
// modelGeometry.ts — ModelDefinition → multi-part geometry payload
// =============================================================================
//
// Output shape (ComposedGeometry): { parts: SubGeometry[], textureIds: number[] }
//
// Each SubGeometry is one chunk of triangles sharing a single rendering mode:
// either "untextured, use vertex colors" or "textured with texture id N".
// The viewer creates one <mesh> per part with the appropriate material.
//
// A single OSRS model may be split into multiple parts because faces can
// have different textures (or none). The composer merges parts across many
// models, combining those that share the same textureId.
//
// Each face contributes 3 UNIQUE output vertices (no sharing across faces),
// which keeps per-face colors and per-face UVs trivial to assign.
//
// All transformations applied here:
//   - Y-flip (OSRS is Y-down, three.js is Y-up)
//   - Triangle winding swap (compensates for the Y-flip; otherwise faces
//     render inside-out under default back-face culling)
//   - HSL → sRGB conversion for face colors
//   - Optional recolor (HSL find→replace pairs) and retexture (textureId
//     find→replace pairs) applied during extraction without mutating the
//     cached model
// =============================================================================

export interface SubGeometry {
  positions: number[];     // [x,y,z, ...] in three.js Y-up space
  colors: number[];        // [r,g,b, ...] in [0,1] — only meaningful for untextured parts
  uvs?: number[];          // [u,v, ...] — present iff textureId is set
  indices: number[];       // sequential 0..N-1 because vertices aren't shared
  textureId?: number;      // undefined = untextured, render with vertexColors

  // === Skinning back-reference (phase 8) ===
  // Each output vertex (3 per face) was fanned out from an original-model
  // vertex. `sourceVertexIndices[i]` is the original-model vertex index for
  // output vertex i. The client uses this to splat per-frame animated
  // positions (which are indexed by original-model vertex) into the buffer.
  // Parallel to `positions` (same length / 3).
  sourceVertexIndices: number[];

  // === Animation source key (phase 8) ===
  // Identifies which source model contributed this part. Animation runs per
  // model (vertexGroups are model-local), so the client needs to know which
  // animation track to apply. Same value for all output vertices in the part
  // (merging only combines parts from the SAME model when texture-bucketed).
  // undefined for static / unanimated parts.
  sourceModelKey?: string;
}

export interface ComposedGeometry {
  parts: SubGeometry[];
}

export interface ColorPair {
  find: number;
  replace: number;
}

interface OsrsModelDef {
  vertexCount: number;
  vertexPositionsX: number[];
  vertexPositionsY: number[];
  vertexPositionsZ: number[];
  faceCount: number;
  faceVertexIndices1: number[];
  faceVertexIndices2: number[];
  faceVertexIndices3: number[];
  faceColors?: number[];
  faceTextures?: number[];
  faceTextureUCoordinates?: number[][];
  faceTextureVCoordinates?: number[][];
  faceRenderTypes?: number[];
  computeTextureUVCoordinates?: (def: any) => void;
}

// === HSL → RGB (packed-uint16 OSRS format → three RGB floats) ==============
const HUE_OFFSET = 0.5 / 64;
const SATURATION_OFFSET = 0.5 / 8;

function hslToRgb(hsl: number): [number, number, number] {
  const hue = ((hsl >> 10) & 63) / 64 + HUE_OFFSET;
  const saturation = ((hsl >> 7) & 7) / 8 + SATURATION_OFFSET;
  const luminance = (hsl & 127) / 128;

  const chroma = (1 - Math.abs(2 * luminance - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue * 6) % 2) - 1));
  const lightness = luminance - chroma / 2;

  let r = lightness;
  let g = lightness;
  let b = lightness;
  switch (Math.floor(hue * 6)) {
    case 0: r += chroma; g += x; break;
    case 1: g += chroma; r += x; break;
    case 2: g += chroma; b += x; break;
    case 3: b += chroma; g += x; break;
    case 4: b += chroma; r += x; break;
    default: r += chroma; b += x; break;
  }
  return [r, g, b];
}

// Non-destructive lookup: original packed value → substituted value.
function makeRemapLookup(pairs?: ColorPair[]): (v: number) => number {
  if (!pairs || pairs.length === 0) return (v) => v;
  const m = new Map<number, number>();
  for (const { find, replace } of pairs) m.set(find, replace);
  return (v) => m.get(v) ?? v;
}

// === Extract one model into one or more SubGeometries ======================
// `sourceModelKey` (phase 8) tags every produced part so animation playback
// on the client knows which per-model animation track applies. If omitted,
// the part is treated as static / unanimated by the client.
export function toSubGeometries(
  model: OsrsModelDef,
  recolors?: ColorPair[],
  retextures?: ColorPair[],
  sourceModelKey?: string,
): SubGeometry[] {
  const recolor = makeRemapLookup(recolors);
  const retexture = makeRemapLookup(retextures);

  // Ensure per-face UVs are computed once. osrscachereader's helper writes
  // faceTextureUCoordinates/faceTextureVCoordinates onto the model in place.
  // Re-computation is cheap and only happens if the model has textures.
  if (
    model.faceTextures &&
    model.computeTextureUVCoordinates &&
    !model.faceTextureUCoordinates
  ) {
    model.computeTextureUVCoordinates(model);
  }

  // Group face indices by (remapped) texture id. -1 = untextured bucket.
  // Skip faces with faceRenderType >= 2 — OSRS marks non-rendered faces
  // (the equivalent of "invisible" / collision-only / special) with these
  // values. They aren't drawn by the game client and surface as stray
  // triangles in a naive renderer. Type 0 = standard gouraud, type 1 =
  // alternate lighting code path; both are rendered normally.
  const buckets = new Map<number, number[]>();
  for (let f = 0; f < model.faceCount; f += 1) {
    const rt = model.faceRenderTypes?.[f] ?? 0;
    if (rt >= 2) continue;
    const rawTex = model.faceTextures ? model.faceTextures[f] : -1;
    const remappedTex = rawTex >= 0 ? retexture(rawTex) : -1;
    let arr = buckets.get(remappedTex);
    if (!arr) { arr = []; buckets.set(remappedTex, arr); }
    arr.push(f);
  }

  // OSRS triangle winding survives our X-axis 180° rotation: a proper
  // rotation preserves the visible CCW/CW order from the camera, so we
  // don't reverse the index order. (Adding a swap here would invert
  // front/back and render the model inside-out.)
  const swappedIdx = [0, 1, 2];

  const out: SubGeometry[] = [];
  for (const [texId, faceList] of buckets) {
    const isTextured = texId !== -1;
    const n = faceList.length;
    const positions: number[] = new Array(n * 9);
    const indices: number[] = new Array(n * 3);
    const colors: number[] = new Array(n * 9);
    const sourceVertexIndices: number[] = new Array(n * 3);
    const uvs: number[] | undefined = isTextured ? new Array(n * 6) : undefined;

    for (let i = 0; i < n; i += 1) {
      const f = faceList[i];
      const osrsVerts = [
        model.faceVertexIndices1[f],
        model.faceVertexIndices2[f],
        model.faceVertexIndices3[f],
      ];

      const faceColor = recolor(model.faceColors?.[f] ?? 0);
      const [r, g, b] = hslToRgb(faceColor);

      const uTri = model.faceTextureUCoordinates?.[f];
      const vTri = model.faceTextureVCoordinates?.[f];

      for (let k = 0; k < 3; k += 1) {
        const src = osrsVerts[swappedIdx[k]];
        const pBase = i * 9 + k * 3;
        // X-axis 180° rotation: OSRS is Y-down right-handed and the player
        // faces +Z (north). three.js is Y-up right-handed. Negating Y AND Z
        // is X-rot 180° — a PROPER rotation (det = +1) that simultaneously
        // (a) flips Y down→up and (b) flips the player's facing direction
        // so their back is toward the +X+Y+Z camera (we see the cape /
        // weapon-in-right-hand as in-game). Y-flip alone is improper and
        // mirrors the model — weapon ends up in the wrong hand.
        positions[pBase + 0] = model.vertexPositionsX[src];
        positions[pBase + 1] = -model.vertexPositionsY[src];
        positions[pBase + 2] = -model.vertexPositionsZ[src];
        colors[pBase + 0] = r;
        colors[pBase + 1] = g;
        colors[pBase + 2] = b;
        if (uvs && uTri && vTri) {
          const uvBase = i * 6 + k * 2;
          uvs[uvBase + 0] = uTri[swappedIdx[k]] ?? 0;
          // three.js textures have V=0 at top, OSRS V=0 at bottom — flip V.
          uvs[uvBase + 1] = 1 - (vTri[swappedIdx[k]] ?? 0);
        }
        sourceVertexIndices[i * 3 + k] = src;
        indices[i * 3 + k] = i * 3 + k;
      }
    }

    const part: SubGeometry = { positions, colors, indices, sourceVertexIndices };
    if (uvs) part.uvs = uvs;
    if (isTextured) part.textureId = texId;
    if (sourceModelKey != null) part.sourceModelKey = sourceModelKey;
    out.push(part);
  }

  return out;
}

// === Merge: concatenate parts, combining like-textured ones ================
// Parts are bucketed by (textureId, sourceModelKey) — same texture AND same
// source model. This keeps draw-call savings for the common case (one
// source model contributes many faces with one texture) without merging
// vertices from different models into one part. The per-source-model
// constraint matters for animation (phase 8): each animated part has a
// single anim track, so all its vertices must come from one model.
export function mergeParts(allParts: SubGeometry[]): SubGeometry[] {
  const bucketed = new Map<string, SubGeometry>(); // "texId|modelKey" → merged part

  for (const p of allParts) {
    const texPart = p.textureId ?? -1;
    const modelPart = p.sourceModelKey ?? '';
    const key = `${texPart}|${modelPart}`;
    let acc = bucketed.get(key);
    if (!acc) {
      acc = {
        positions: [],
        colors: [],
        indices: [],
        sourceVertexIndices: [],
        ...(p.uvs ? { uvs: [] } : {}),
        ...(p.textureId != null ? { textureId: p.textureId } : {}),
        ...(p.sourceModelKey != null ? { sourceModelKey: p.sourceModelKey } : {}),
      };
      bucketed.set(key, acc);
    }
    const vertexOffset = acc.positions.length / 3;
    for (let i = 0; i < p.positions.length; i += 1) acc.positions.push(p.positions[i]);
    for (let i = 0; i < p.colors.length; i += 1) acc.colors.push(p.colors[i]);
    for (let i = 0; i < p.sourceVertexIndices.length; i += 1) {
      acc.sourceVertexIndices.push(p.sourceVertexIndices[i]);
    }
    if (acc.uvs && p.uvs) {
      for (let i = 0; i < p.uvs.length; i += 1) acc.uvs.push(p.uvs[i]);
    }
    for (let i = 0; i < p.indices.length; i += 1) acc.indices.push(p.indices[i] + vertexOffset);
  }

  return [...bucketed.values()];
}

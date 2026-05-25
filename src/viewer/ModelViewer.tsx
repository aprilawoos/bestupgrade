// === <ModelViewer ... /> ===
// Client component. Fetches a ComposedResponse from the given URL, builds
// one three.js BufferGeometry per part, applies either vertex colours
// (untextured parts) or an extracted texture (textured parts), and
// renders inside an r3f Canvas with OrbitControls.
//
// Texture handling: rgbaBase64 → Uint8Array → DataTexture. Filtering uses
// nearest-neighbour (`THREE.NearestFilter`) which matches the in-game look
// (OSRS textures are tiny + pixel-art-y; bilinear filtering would smear).
//
// === Phase 8: skeletal animation ===
// For each part that has a `sourceModelKey` and the response has a matching
// entry in `animations`, we run a per-frame loop:
//   - Maintain a playback clock (seconds elapsed).
//   - Convert to OSRS ticks (≈20ms each) and walk `frameDurations`.
//   - At each tick boundary, splat per-source-vertex animated positions
//     from the strided `frames` buffer into the part's position attribute
//     via the part's `sourceVertexIndices` lookup.
//   - Mark the position attribute dirty + recompute normals.
//   - Loop on reaching the end.
// Static (un-animated) parts skip the per-frame work entirely.

'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SubGeometry } from './modelGeometry';
import type { AnimationData } from './animationExtractor';

interface TextureData {
  width: number;
  height: number;
  rgbaBase64: string;
  animationSpeed?: number;     // 0 / absent = static
  animationDirection?: number; // 0-15
}

interface ComposedResponse {
  parts: SubGeometry[];
  textures: Record<string, TextureData>;
  animations?: Record<string, AnimationData>; // optional for backward compat
}

interface ModelViewerProps {
  modelId?: number;
  kind?: 'model' | 'npc';
  src?: string;
  height?: number;
}

// === OSRS animation tick rate ===
// One client tick ≈ 20ms (50 FPS). `frameDurations` values are in these
// ticks. A value of 1 = the frame is held for 20ms before advancing.
const OSRS_TICK_SECONDS = 0.02;

// === UV-scroll constants (from RuneLite GpuPlugin + vert.glsl) ===
// RuneLite's GPU plugin scrolls textures by:
//   fUv += tick * (direction_vec * speed) * (1/128)
// where 1/128 = one pixel on a 128x128 texture (vert.glsl line 33-34),
// `tick` is set from `client.getGameCycle() & 127` (GpuPlugin.java line 964),
// and direction_vec is an axis-aligned unit vector from TextureManager.java
// line 243. `getGameCycle()` is the 20ms CLIENT tick (50 Hz), NOT the 600ms
// game tick.
//
// Direction → vector mapping (RuneLite's GL convention, V=0 at bottom):
//   1 → (0, -1)   2 → (-1, 0)   3 → (0, +1)   4 → (+1, 0)
//   anything else → no scroll
//
// In OUR pipeline modelGeometry.ts flips V (V=0 at top, matching three.js
// default), so the V signs need to be negated to produce the same visual
// scroll direction RuneLite shows. U is unaffected by that flip.
//
// Sources:
//   https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/gpu/TextureManager.java#L243
//   https://github.com/runelite/runelite/blob/master/runelite-client/src/main/resources/net/runelite/client/plugins/gpu/vert.glsl#L107
//   https://github.com/runelite/runelite/blob/master/runelite-client/src/main/java/net/runelite/client/plugins/gpu/GpuPlugin.java#L964
const TEXTURE_ANIM_UNIT = 1 / 128;
const OSRS_CLIENT_TICK_SECONDS = 0.02;

// === base64 → Uint8Array (no Node Buffer in the browser) ===
function decodeBase64Rgba(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// === DataTexture from our { width, height, rgba } payload ===
function makeTexture(data: TextureData): THREE.DataTexture {
  const rgba = decodeBase64Rgba(data.rgbaBase64);
  const t = new THREE.DataTexture(rgba, data.width, data.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  // Pixel-art look. Wrap is "repeat" because OSRS textures tile across UV>1.
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.flipY = false; // our extractor already produces top-left-origin pixels
  t.needsUpdate = true;
  return t;
}

// === BufferGeometry from one SubGeometry ===
function makeGeometry(part: SubGeometry): THREE.BufferGeometry {
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(part.colors, 3));
  if (part.uvs) bg.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
  bg.setIndex(part.indices);
  bg.computeVertexNormals();
  bg.computeBoundingSphere();
  return bg;
}

// === Per-part animation playback state ===
// Built once per part-with-animation. Holds the precomputed total cycle
// duration and indexes into the strided frames buffer; the useFrame loop
// reads these and writes new positions.
interface PlaybackTrack {
  geometry: THREE.BufferGeometry;
  positionAttr: THREE.BufferAttribute;
  anim: AnimationData;
  sourceVertexIndices: number[];
  cycleSeconds: number;     // total length of one anim loop
  frameStarts: number[];    // length = numFrames; frameStarts[i] = seconds at which frame i begins
  lastFrameIdx: number;     // memoised so we don't recompute identical frames every render
}

function buildPlaybackTrack(
  geometry: THREE.BufferGeometry,
  part: SubGeometry,
  anim: AnimationData,
): PlaybackTrack {
  // Compute cumulative frame start times in seconds.
  const frameStarts: number[] = new Array(anim.numFrames);
  let cum = 0;
  for (let i = 0; i < anim.numFrames; i += 1) {
    frameStarts[i] = cum;
    cum += (anim.frameDurations[i] ?? 1) * OSRS_TICK_SECONDS;
  }
  // Guard against degenerate zero-length animations — produces NaN otherwise.
  const cycleSeconds = cum > 0 ? cum : OSRS_TICK_SECONDS;
  return {
    geometry,
    positionAttr: geometry.getAttribute('position') as THREE.BufferAttribute,
    anim,
    sourceVertexIndices: part.sourceVertexIndices,
    cycleSeconds,
    frameStarts,
    lastFrameIdx: -1,
  };
}

// Splat animated vertices (indexed by source-model vertex idx) into the
// output position buffer (indexed sequentially). Uses the part's
// sourceVertexIndices array to find the right source for each output vertex.
function applyAnimFrame(track: PlaybackTrack, frameIdx: number): void {
  if (frameIdx === track.lastFrameIdx) return;
  track.lastFrameIdx = frameIdx;

  const { anim, sourceVertexIndices, positionAttr } = track;
  const stride = anim.vertexCount * 3;
  const base = frameIdx * stride;
  const arr = positionAttr.array as Float32Array;

  for (let i = 0; i < sourceVertexIndices.length; i += 1) {
    const src = sourceVertexIndices[i];
    const srcBase = base + src * 3;
    const outBase = i * 3;
    arr[outBase + 0] = anim.frames[srcBase + 0];
    arr[outBase + 1] = anim.frames[srcBase + 1];
    arr[outBase + 2] = anim.frames[srcBase + 2];
  }
  positionAttr.needsUpdate = true;
  // Recompute normals so lighting stays correct as the surface deforms.
  // For ~thousands of verts per part this is cheap (~ms) at 20Hz.
  track.geometry.computeVertexNormals();
}

// === Per-texture UV-scroll state ===
// Built once per textured part whose texture has animationSpeed > 0.
// useFrame walks these and updates texture.offset based on elapsed time.
interface ScrollTrack {
  texture: THREE.DataTexture;
  dx: number; // UV units per second along U
  dy: number; // UV units per second along V
}

function buildScrollTrack(texture: THREE.DataTexture, data: TextureData): ScrollTrack | null {
  const speed = data.animationSpeed ?? 0;
  if (speed <= 0) return null;
  // Direction is a switch (RuneLite's TextureManager.java): only values 1-4
  // are meaningful — anything else means no scroll. V signs are negated
  // versus RuneLite to account for our V-flipped UV pipeline.
  let uVec = 0;
  let vVec = 0;
  switch (data.animationDirection ?? 0) {
    case 1: vVec =  1; break; // RuneLite: -1
    case 2: uVec = -1; break;
    case 3: vVec = -1; break; // RuneLite: +1
    case 4: uVec =  1; break;
    default: return null;
  }
  // Per OSRS client tick (20ms), UV moves by `speed * (1/128)` along the
  // direction vector. Convert to per-second so useFrame can multiply by
  // elapsed seconds.
  const perSecond = (speed * TEXTURE_ANIM_UNIT) / OSRS_CLIENT_TICK_SECONDS;
  return {
    texture,
    dx: uVec * perSecond,
    dy: vVec * perSecond,
  };
}

// === <AnimatedScene> ===
// All the actual geometry rendering lives inside the Canvas. useFrame can
// only be called from a component mounted under <Canvas>, so we split the
// scene out from the outer host element.
interface AnimatedSceneProps {
  parts: SubGeometry[];
  geometries: THREE.BufferGeometry[];
  textures: Record<string, THREE.DataTexture>;
  tracks: PlaybackTrack[];
  scrolls: ScrollTrack[];
}

function AnimatedScene({ parts, geometries, textures, tracks, scrolls }: AnimatedSceneProps) {
  // r3f's clock is seconds since mount. Modulo per-track cycleSeconds to
  // loop. We bind tracks via a stable ref so the useFrame closure doesn't
  // need to recapture on every render.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const scrollsRef = useRef(scrolls);
  scrollsRef.current = scrolls;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const tr of tracksRef.current) {
      const phase = t % tr.cycleSeconds;
      // Find which frame phase falls into. Linear scan is fine — frame
      // counts are <100 for any in-game animation. Binary search would
      // be over-engineered.
      let frameIdx = 0;
      for (let i = tr.anim.numFrames - 1; i >= 0; i -= 1) {
        if (phase >= tr.frameStarts[i]) { frameIdx = i; break; }
      }
      applyAnimFrame(tr, frameIdx);
    }
    // UV-scroll: set texture.offset to the integrated offset. Modulo 1 so
    // floats stay bounded (UV repeats anyway, but very large offsets
    // start losing precision after many minutes).
    for (const s of scrollsRef.current) {
      s.texture.offset.x = (s.dx * t) % 1;
      s.texture.offset.y = (s.dy * t) % 1;
    }
  });

  return (
    <>
      {geometries.map((g, i) => {
        const part = parts[i];
        const texKey = part.textureId != null ? String(part.textureId) : null;
        const tex = texKey ? textures[texKey] : null;
        return (
          <mesh key={i} geometry={g}>
            {tex ? (
              <meshStandardMaterial map={tex} flatShading />
            ) : (
              <meshStandardMaterial vertexColors flatShading />
            )}
          </mesh>
        );
      })}
    </>
  );
}

export function ModelViewer({ modelId, kind = 'model', src, height = 480 }: ModelViewerProps) {
  const [resp, setResp] = useState<ComposedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = src ?? (modelId != null ? `/api/${kind}/${modelId}` : null);

  useEffect(() => {
    setResp(null);
    setError(null);
    if (!url) { setError('ModelViewer: need either src or modelId'); return; }
    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return r.json() as Promise<ComposedResponse>;
      })
      .then((g) => { if (!cancelled) setResp(g); })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [url]);

  // Build geometries + textures + playback tracks once per response.
  // Memoised so we don't recreate three.js objects on every React render.
  const prepared = useMemo(() => {
    if (!resp || resp.parts.length === 0) return null;
    const geometries = resp.parts.map(makeGeometry);
    const textures: Record<string, THREE.DataTexture> = {};
    for (const [tid, data] of Object.entries(resp.textures)) {
      textures[tid] = makeTexture(data);
    }
    // Build playback tracks: one per part whose sourceModelKey matches an
    // entry in the response's `animations` map. Static parts contribute
    // nothing here and just render as-is.
    const animations = resp.animations ?? {};
    const tracks: PlaybackTrack[] = [];
    for (let i = 0; i < resp.parts.length; i += 1) {
      const part = resp.parts[i];
      if (!part.sourceModelKey) continue;
      const anim = animations[part.sourceModelKey];
      if (!anim) continue;
      tracks.push(buildPlaybackTrack(geometries[i], part, anim));
    }
    // UV-scroll tracks: one per DataTexture whose source had animationSpeed>0.
    // Built from the same response.textures entries we just turned into
    // DataTextures, so the scroll track and the on-screen texture share
    // a single THREE.DataTexture instance.
    const scrolls: ScrollTrack[] = [];
    for (const [tid, data] of Object.entries(resp.textures)) {
      const tex = textures[tid];
      if (!tex) continue;
      const s = buildScrollTrack(tex, data);
      if (s) scrolls.push(s);
    }
    // Combined bounding sphere across all parts for camera framing
    const overallSphere = new THREE.Sphere();
    for (const g of geometries) {
      if (g.boundingSphere) overallSphere.union(g.boundingSphere);
    }
    return { geometries, textures, sphere: overallSphere, tracks, scrolls };
  }, [resp]);

  if (error) return <div style={{ color: 'crimson' }}>Model load failed: {error}</div>;
  if (!prepared) return <div style={{ opacity: 0.6 }}>Loading…</div>;

  const { geometries, textures, sphere, tracks, scrolls } = prepared;
  const radius = sphere.radius || 1;
  const camDist = radius * 3;
  const camTarget: [number, number, number] = [sphere.center.x, sphere.center.y, sphere.center.z];
  const near = Math.max(0.01, radius * 0.001);
  const far = Math.max(2000, radius * 100);

  return (
    <div style={{ width: '100%', height, background: '#1a1a1a', borderRadius: 8 }}>
      <Canvas camera={{ position: [camDist, camDist, camDist], fov: 50, near, far }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 7]} intensity={1.2} />
        <directionalLight position={[-5, -10, -7]} intensity={0.4} />
        {/* Orientation is baked into the geometry (X-axis 180° rotation in
            modelGeometry.ts: negates Y and Z). No additional rotation here. */}
        <group>
          <AnimatedScene
            parts={resp!.parts}
            geometries={geometries}
            textures={textures}
            tracks={tracks}
            scrolls={scrolls}
          />
        </group>
        <OrbitControls target={camTarget} />
      </Canvas>
    </div>
  );
}

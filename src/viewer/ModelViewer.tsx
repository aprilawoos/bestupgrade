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
// Phase 6 scope: static textures only. Animated textures (fire/infernal
// cape) render their first frame and don't cycle.

'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { SubGeometry } from './modelGeometry';

interface TextureData {
  width: number;
  height: number;
  rgbaBase64: string;
}

interface ComposedResponse {
  parts: SubGeometry[];
  textures: Record<string, TextureData>;
}

interface ModelViewerProps {
  modelId?: number;
  kind?: 'model' | 'npc';
  src?: string;
  height?: number;
}

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

  // Build geometries + textures once per response. Memoised so the meshes
  // don't get recreated on every render — three.js objects don't like that.
  const prepared = useMemo(() => {
    if (!resp || resp.parts.length === 0) return null;
    const geometries = resp.parts.map(makeGeometry);
    const textures: Record<string, THREE.DataTexture> = {};
    for (const [tid, data] of Object.entries(resp.textures)) {
      textures[tid] = makeTexture(data);
    }
    // Combined bounding sphere across all parts for camera framing
    const overallSphere = new THREE.Sphere();
    for (const g of geometries) {
      if (g.boundingSphere) overallSphere.union(g.boundingSphere);
    }
    return { geometries, textures, sphere: overallSphere };
  }, [resp]);

  if (error) return <div style={{ color: 'crimson' }}>Model load failed: {error}</div>;
  if (!prepared) return <div style={{ opacity: 0.6 }}>Loading…</div>;

  const { geometries, textures, sphere } = prepared;
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
        {/* Rotate the whole assembled mesh 180° around Y so models face the
            camera at default orientation. Applied to a parent <group> so all
            parts (textured + untextured) stay aligned. */}
        <group rotation={[0, Math.PI, 0]}>
          {geometries.map((g, i) => {
            const part = resp!.parts[i];
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
        </group>
        <OrbitControls target={camTarget} />
      </Canvas>
    </div>
  );
}

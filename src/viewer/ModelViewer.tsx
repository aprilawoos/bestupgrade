// === <ModelViewer modelId=... /> ===
// Client component. Fetches /api/model/[id], builds a three.js BufferGeometry
// from the returned positions+indices, and renders it inside an r3f Canvas
// with OrbitControls so you can drag to rotate / scroll to zoom.
//
// Phase 1 scope: no colors, no textures, no animation. Single flat-shaded
// mesh just to prove the cache → server → client → three.js pipeline works.

'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { FlatGeometry } from './modelGeometry';

interface ModelViewerProps {
  modelId: number;
  height?: number;
}

export function ModelViewer({ modelId, height = 480 }: ModelViewerProps) {
  const [geom, setGeom] = useState<FlatGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGeom(null);
    setError(null);
    let cancelled = false;
    fetch(`/api/model/${modelId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return r.json() as Promise<FlatGeometry>;
      })
      .then((g) => { if (!cancelled) setGeom(g); })
      .catch((e) => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [modelId]);

  // Build BufferGeometry from the flat arrays — memoised so we only rebuild
  // when geom changes, not on every parent re-render. Centre + scale the
  // model to fit the camera frame.
  const bufferGeometry = useMemo(() => {
    if (!geom) return null;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(geom.positions, 3));
    bg.setIndex(geom.indices);
    bg.computeVertexNormals();
    bg.computeBoundingSphere();
    return bg;
  }, [geom]);

  if (error) {
    return <div style={{ color: 'crimson' }}>Model load failed: {error}</div>;
  }
  if (!bufferGeometry) {
    return <div style={{ opacity: 0.6 }}>Loading model {modelId}…</div>;
  }

  // Camera distance scaled to the model's bounding sphere — works for any size.
  const sphere = bufferGeometry.boundingSphere!;
  const camDist = sphere.radius * 3;
  const camTarget: [number, number, number] = [sphere.center.x, sphere.center.y, sphere.center.z];

  return (
    <div style={{ width: '100%', height, background: '#1a1a1a', borderRadius: 8 }}>
      <Canvas camera={{ position: [camDist, camDist, camDist], fov: 50 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 7]} intensity={1.2} />
        <directionalLight position={[-5, -10, -7]} intensity={0.4} />
        <mesh geometry={bufferGeometry}>
          <meshStandardMaterial color="#888888" flatShading wireframe={false} />
        </mesh>
        <OrbitControls target={camTarget} />
      </Canvas>
    </div>
  );
}

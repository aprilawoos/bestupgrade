// === ModelDefinition → flat geometry payload ===
// Extracts only what we need for a static three.js BufferGeometry: vertex
// positions (one Float32Array of XYZ) and triangle indices (one Uint32Array).
// Colors / UVs / animations deferred to later phases — phase 1 only proves
// the pipeline.
//
// Wire format: { positions: number[], indices: number[] }
// JSON-serializable so the API route can just send it as-is. We materialize
// typed arrays on the client side.

export interface FlatGeometry {
  positions: number[];
  indices: number[];
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
}

export function toFlatGeometry(model: OsrsModelDef): FlatGeometry {
  // Vertex positions are stored as three parallel arrays of length vertexCount.
  // Interleave into [x0,y0,z0, x1,y1,z1, ...] for BufferAttribute consumption.
  const positions = new Array<number>(model.vertexCount * 3);
  for (let i = 0; i < model.vertexCount; i += 1) {
    positions[i * 3 + 0] = model.vertexPositionsX[i];
    positions[i * 3 + 1] = model.vertexPositionsY[i];
    positions[i * 3 + 2] = model.vertexPositionsZ[i];
  }

  // Face indices: three parallel arrays naming the three vertices of each
  // triangle. Flatten into one index array.
  const indices = new Array<number>(model.faceCount * 3);
  for (let i = 0; i < model.faceCount; i += 1) {
    indices[i * 3 + 0] = model.faceVertexIndices1[i];
    indices[i * 3 + 1] = model.faceVertexIndices2[i];
    indices[i * 3 + 2] = model.faceVertexIndices3[i];
  }

  return { positions, indices };
}

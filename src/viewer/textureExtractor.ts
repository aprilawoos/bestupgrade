// =============================================================================
// textureExtractor.ts — pull a single OSRS texture out of the cache as RGBA
// =============================================================================
//
// OSRS textures live at IndexType.TEXTURES, archive 0. Each TextureDefinition
// references one or more sprite ids in `fileIds`. We use only the first
// sprite frame for phase 6; multi-sprite animated textures (fire cape,
// infernal cape — `animationSpeed > 0`) cycle through frames in-game, but
// we render frame 0 statically.
//
// Sprite pixel data is already decoded by osrscachereader into int32 ARGB
// (each pixel: 0xAARRGGBB, stored as a signed 32-bit number). We unpack to
// Uint8Array(width*height*4) and base64-encode for transport over the API.
// =============================================================================

import { IndexType } from 'osrscachereader';

export interface TextureData {
  width: number;
  height: number;
  rgbaBase64: string; // base64 of width * height * 4 bytes (RGBA, row-major, top-left origin)
}

export async function extractTexture(cache: any, textureId: number): Promise<TextureData | null> {
  // TEXTURES has a single archive (id 0) holding texture defs as files.
  const file = await cache.getFile(IndexType.TEXTURES, 0, textureId).catch(() => null);
  if (!file?.def?.fileIds?.length) return null;

  const spriteId = file.def.fileIds[0];
  const spriteDef = await cache.getDef(IndexType.SPRITES, spriteId).catch(() => null);
  const sprite = spriteDef?.sprites?.[0];
  if (!sprite?.pixels) return null;

  const { width, height, pixels } = sprite;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    // Sprite pixels are ints stored signed. >>> 0 normalises to unsigned.
    const p = pixels[i] >>> 0;
    rgba[i * 4 + 0] = (p >> 16) & 0xff; // R
    rgba[i * 4 + 1] = (p >> 8) & 0xff;  // G
    rgba[i * 4 + 2] = p & 0xff;         // B
    rgba[i * 4 + 3] = (p >> 24) & 0xff; // A
  }

  return { width, height, rgbaBase64: rgba.toString('base64') };
}

// === GET /api/player/base?gender=male|female&items=ID,...&kits=ID,... ===
// Returns the composed geometry of a player with the requested gender,
// optionally with equipped items and/or overridden kits (e.g. choose a
// specific hair / facial-hair / torso style instead of the default first
// selectable). Items use wearPos1/2/3 placement rules; kits use their
// own bodyPartId to override the default per body part.
//
// Examples:
//   /api/player/base?gender=male
//   /api/player/base?gender=female&kits=15
//   /api/player/base?gender=male&items=4151,1163&kits=43,15

import { NextResponse } from 'next/server';
import { getCache } from '@/viewer/cache';
import { composePlayer, type Gender } from '@/viewer/playerComposer';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const genderParam = url.searchParams.get('gender') ?? 'male';
  if (genderParam !== 'male' && genderParam !== 'female') {
    return NextResponse.json(
      { error: `gender must be "male" or "female", got: ${genderParam}` },
      { status: 400 },
    );
  }

  const parseIds = (raw: string | null) =>
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n >= 0);

  const itemIds = parseIds(url.searchParams.get('items'));
  const kitIds = parseIds(url.searchParams.get('kits'));

  const cache = await getCache();
  const geom = await composePlayer(cache, genderParam as Gender, itemIds, kitIds);

  if (geom.parts.length === 0) {
    return NextResponse.json(
      { error: `composed geometry is empty for gender=${genderParam}, items=${itemIds.join(',')}, kits=${kitIds.join(',')}` },
      { status: 500 },
    );
  }

  return NextResponse.json(geom);
}

// === GET /api/player/base?gender=male|female&items=ID,ID,... ===
// Returns the composed geometry of a player with the requested gender and
// (optionally) a list of equipped items. Items are placed by their wearPos1
// field; wearPos2/3 clear the visually-hidden kit slots. Order in the
// comma-separated list doesn't matter.
//
// Examples:
//   /api/player/base?gender=male
//   /api/player/base?gender=male&items=4151,1163,1127,1079,1135,2581

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

  const itemsParam = url.searchParams.get('items') ?? '';
  const itemIds = itemsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const cache = await getCache();
  const geom = await composePlayer(cache, genderParam as Gender, itemIds);

  if (geom.parts.length === 0) {
    return NextResponse.json(
      { error: `composed geometry is empty for gender=${genderParam}, items=${itemIds.join(',')}` },
      { status: 500 },
    );
  }

  return NextResponse.json(geom);
}

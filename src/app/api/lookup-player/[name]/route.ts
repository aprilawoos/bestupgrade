// === GET /api/lookup-player/[name] ===
// Proxies the official Jagex Old School RuneScape hiscores API:
//   https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=...
// Jagex doesn't set Access-Control-Allow-Origin, so the browser can't hit
// this endpoint directly. This route does the fetch server-side, parses the
// skill list, and returns a clean { skills, name } payload that the page
// can drop into its progression preset.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Maps the hiscores JSON's skill `name` field onto two keys: the short
// PlayerSkills name (atk/str/def/...) that the sim consumes, and the
// lowercase-canonical name used by the quest-req registry (attack/strength/
// defence/...). We return BOTH so the page can drive the sim AND the
// "auto-complete completable quests" feature without needing a second API
// call for the non-combat skills.
const SHORT_NAME_MAP: Record<string, string> = {
  Attack: 'atk',
  Defence: 'def',
  Strength: 'str',
  Hitpoints: 'hp',
  Ranged: 'ranged',
  Prayer: 'prayer',
  Magic: 'magic',
  Mining: 'mining',
  Herblore: 'herblore',
};

interface HiscoresSkill { id: number; name: string; rank: number; level: number; xp: number }
interface HiscoresResponse { name: string; skills: HiscoresSkill[]; activities: unknown[] }

export async function GET(
  _req: Request,
  { params }: { params: { name: string } },
) {
  const playerName = decodeURIComponent(params.name).trim();
  if (!playerName) {
    return NextResponse.json({ error: 'empty player name' }, { status: 400 });
  }
  // OSRS names allow letters/digits/spaces/hyphens/underscores; reject
  // obvious garbage early. (Real validation lives in Jagex's response.)
  if (!/^[A-Za-z0-9 _-]{1,12}$/.test(playerName)) {
    return NextResponse.json({ error: `invalid OSRS name: ${playerName}` }, { status: 400 });
  }

  const url = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=${encodeURIComponent(playerName)}`;
  let resp: Response;
  try {
    resp = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    return NextResponse.json({ error: `fetch failed: ${(e as Error).message}` }, { status: 502 });
  }
  if (resp.status === 404) {
    return NextResponse.json({ error: `player not found on the OSRS hiscores: ${playerName}` }, { status: 404 });
  }
  if (!resp.ok) {
    return NextResponse.json({ error: `hiscores returned ${resp.status}` }, { status: resp.status });
  }

  const data = (await resp.json()) as HiscoresResponse;
  const skills: Record<string, number> = {};        // short names — sim input
  const allSkills: Record<string, number> = {};     // lowercased full set — quest-req checks
  for (const s of data.skills ?? []) {
    // Unranked skills show as level 1 (Jagex baseline) — the hiscores
    // returns rank=-1 level=1 in that case. We just pass through whatever
    // level the API reports.
    const short = SHORT_NAME_MAP[s.name];
    if (short) skills[short] = s.level;
    if (s.name && s.name !== 'Overall') {
      allSkills[s.name.toLowerCase()] = s.level;
    }
  }

  return NextResponse.json({ name: data.name ?? playerName, skills, allSkills });
}

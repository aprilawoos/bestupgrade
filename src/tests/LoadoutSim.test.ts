import { describe, test, expect } from '@jest/globals';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { simulateBestLoadout, SimStyle } from '@/lib/loadoutSim';
import { allVendorQuestNames, getPlayerAccessiblePool, PlayerProgression } from '@/lib/vendorAccess';
import type { PlayerSkills } from '@/types/Player';

describe('LoadoutSim — Gemstone Crab vs vendor pool', () => {
  const monster = (() => {
    const m = getMonsters().find((x) => x.id === 14779);
    if (!m) throw new Error('Gemstone Crab missing');
    return { ...m, inputs: { ...INITIAL_MONSTER_INPUTS } };
  })();

  const progL1: PlayerProgression = {
    skills: { atk: 1, str: 1, def: 1, ranged: 1, magic: 1, prayer: 1, hp: 10, mining: 1, herblore: 1 } as Partial<PlayerSkills>,
    questPoints: 0,
    questsStarted: new Set(),
    questsCompleted: new Set(),
  };
  const prog99: PlayerProgression = (() => {
    const { started, completed } = allVendorQuestNames();
    return {
      skills: { atk: 99, str: 99, def: 99, ranged: 99, magic: 99, prayer: 99, hp: 99, mining: 99, herblore: 99 } as Partial<PlayerSkills>,
      questPoints: 300,
      questsStarted: new Set(started),
      questsCompleted: new Set(completed),
    };
  })();

  describe.each<[string, PlayerProgression]>([
    ['L1', progL1],
    ['99', prog99],
  ])('%s stats', (label, progression) => {
  test.each<SimStyle>(['melee', 'ranged', 'magic'])('%s sim produces a non-null result', (style) => {
    const pool = getPlayerAccessiblePool(progression);
    const r = simulateBestLoadout({ pool, monster, skills: progression.skills, style });
    expect(r).not.toBeNull();
    if (!r) return;

    /* eslint-disable no-console */
    console.log(`\n[${label} ${style.toUpperCase()}] pool=${pool.length}  DPS=${r.dps.toFixed(4)}  max=${r.maxHit}  acc=${(r.accuracy * 100).toFixed(2)}%  combos=${r.combosEvaluated.toLocaleString()}  elapsed=${r.elapsedMs.toFixed(0)}ms`);
    console.log(`  frontiers: ${Object.entries(r.frontierSizes).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`  weapon: ${r.loadout.weapon?.name} (stance=${r.stance.name}/${r.stance.stance}/${r.stance.type})`);
    console.log(`  ammo:   ${r.loadout.ammo?.name ?? '—'}`);
    console.log(`  head:   ${r.loadout.head?.name ?? '—'}`);
    console.log(`  cape:   ${r.loadout.cape?.name ?? '—'}`);
    console.log(`  body:   ${r.loadout.body?.name ?? '—'}`);
    console.log(`  shield: ${r.loadout.shield?.name ?? '—'}`);
    console.log(`  legs:   ${r.loadout.legs?.name ?? '—'}`);
    console.log(`  hands:  ${r.loadout.hands?.name ?? '—'}`);
    console.log(`  feet:   ${r.loadout.feet?.name ?? '—'}`);
    console.log(`  ring:   ${r.loadout.ring?.name ?? '—'}`);
    console.log(`  spell:  ${r.spell?.name ?? '—'}`);
    console.log(`  defSum=${r.defSum}  prayer=+${r.prayerBonus}`);
    /* eslint-enable no-console */

    expect(r.loadout.weapon).not.toBeNull();
  });
  });
});

import { describe, test, expect } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { vendorStarterItems } from '@/lib/vendorStarter';
import { simulateBestLoadout, SimStyle } from '@/lib/loadoutSim';
import type { EquipmentPiece } from '@/types/Player';

describe('LoadoutSim — Gemstone Crab L1 vendor pool', () => {
  const byId = new Map(availableEquipment.map((e) => [e.id, e]));
  const pool: EquipmentPiece[] = vendorStarterItems
    .map((v) => byId.get(v.itemId))
    .filter((e): e is EquipmentPiece => e !== undefined);

  const monster = (() => {
    const m = getMonsters().find((x) => x.id === 14779);
    if (!m) throw new Error('Gemstone Crab missing');
    return { ...m, inputs: { ...INITIAL_MONSTER_INPUTS } };
  })();

  const skills = { atk: 1, str: 1, def: 1, ranged: 1, magic: 1, prayer: 1, hp: 10 };

  test.each<SimStyle>(['melee', 'ranged', 'magic'])('%s sim produces a non-null result', (style) => {
    const r = simulateBestLoadout({ pool, monster, skills, style });
    expect(r).not.toBeNull();
    if (!r) return;

    /* eslint-disable no-console */
    console.log(`\n[${style.toUpperCase()}] DPS=${r.dps.toFixed(4)}  max=${r.maxHit}  acc=${(r.accuracy * 100).toFixed(2)}%  combos=${r.combosEvaluated.toLocaleString()}  elapsed=${r.elapsedMs.toFixed(0)}ms`);
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

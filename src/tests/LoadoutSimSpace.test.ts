// Diagnostic: dump the full candidate iteration space the brute-force sim
// considers for each style at L99 vs the Gemstone Crab. Answers "what
// items/spells/stances does the sim test", as distinct from "what wins".

import { describe, test } from '@jest/globals';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { describeSimSpace, SimStyle } from '@/lib/loadoutSim';
import { allVendorQuestNames, getPlayerAccessiblePool, PlayerProgression } from '@/lib/vendorAccess';
import type { PlayerSkills } from '@/types/Player';

describe('LoadoutSim space @ L99 vs Crab', () => {
  const monster = (() => {
    const m = getMonsters().find((x) => x.id === 14779);
    if (!m) throw new Error('Gemstone Crab missing');
    return { ...m, inputs: { ...INITIAL_MONSTER_INPUTS } };
  })();

  const progression: PlayerProgression = (() => {
    const { started, completed } = allVendorQuestNames();
    return {
      skills: { atk: 99, str: 99, def: 99, ranged: 99, magic: 99, prayer: 99, hp: 99, mining: 99, herblore: 99 } as Partial<PlayerSkills>,
      questPoints: 300,
      questsStarted: new Set(started),
      questsCompleted: new Set(completed),
    };
  })();
  const skills = progression.skills;
  const pool = getPlayerAccessiblePool(progression);

  test.each<SimStyle>(['melee', 'ranged', 'magic'])('%s space', (style) => {
    const space = describeSimSpace({ pool, monster, skills, style });

    /* eslint-disable no-console */
    console.log(`\n========= ${style.toUpperCase()} =========`);
    console.log(`\nWeapons (${space.weapons.length}):`);
    for (const w of space.weapons) {
      const stanceList = w.stances.map((s) => `${s.name}/${s.stance}/${s.type}`).join(', ');
      const ammoStr = w.ammo ? ` + ${w.ammo.name}` : '';
      console.log(`  ${w.weapon.name}${ammoStr}  stances: [${stanceList}]`);
    }

    if (space.spells.length > 0) {
      console.log(`\nSpells (${space.spells.length}):`);
      for (const s of space.spells) {
        console.log(`  ${s.name}  (element=${s.element}, base max=${s.max_hit})`);
      }
    }

    console.log('\nArmour frontiers (Pareto-pruned per slot, includes null):');
    for (const [slot, items] of Object.entries(space.armourFrontiers)) {
      const names = items.map((i) => i?.name ?? '(none)').join(', ');
      console.log(`  ${slot.padEnd(7)} [${items.length}]: ${names}`);
    }
    /* eslint-enable no-console */
  });
});

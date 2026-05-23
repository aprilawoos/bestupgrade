// === Home page ===
// End-to-end sanity check that the vendored calc is wired up correctly:
// roll a random loadout, run PlayerVsNPCCalc against an Abyssal demon,
// render the DPS. Button rerolls. No upgrade-ranking logic here yet —
// this just proves the engine produces a number end-to-end in the browser.
'use client';

import { useState, useCallback } from 'react';
import merge from 'lodash.mergewith';

import { availableEquipment, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { generateEmptyPlayer } from '@/state';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import type { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import type { Monster } from '@/types/Monster';

// === Slot list ===
// Mirrors PlayerEquipment in order; used both to drive random selection and
// the loadout display below.
const SLOTS: (keyof PlayerEquipment)[] = [
  'head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring',
];

// === Test target ===
// Standard-variant Abyssal demon. The Catacombs / Wilderness Slayer Cave
// variants exist too but have identical stats — picking the simplest.
function getAbyssalDemon(): Monster {
  const base = getMonsters().find(
    (m) => m.name === 'Abyssal demon' && m.version === 'Standard',
  );
  if (!base) throw new Error('Abyssal demon (Standard) missing from monsters.json');
  return { ...base, inputs: { ...INITIAL_MONSTER_INPUTS } };
}

// === Random loadout ===
// One random piece per slot. Doesn't check legality (e.g., 2H weapon + shield)
// — the calc just ignores impossible combos in its accuracy/strength rolls.
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomLoadout(): PlayerEquipment {
  const loadout = {} as PlayerEquipment;
  for (const slot of SLOTS) {
    const candidates = availableEquipment.filter((e) => e.slot === slot);
    loadout[slot] = candidates.length > 0 ? pickRandom(candidates) : null;
  }
  return loadout;
}

// === Compute player + DPS ===
// Same pattern as upstream's src/tests/utils/TestUtils.ts getTestPlayer:
// build a base player, set equipment, derive bonuses from gear, pick the
// first valid combat style for the weapon, then run the calc.
interface CalcResult {
  player: Player;
  monster: Monster;
  dps: number;
}

function rollAndCalc(): CalcResult {
  const monster = getAbyssalDemon();
  const equipment = randomLoadout();

  const player = merge(generateEmptyPlayer(), { equipment });
  const derived = calculateEquipmentBonusesFromGear(player, monster);
  player.bonuses = derived.bonuses;
  player.offensive = derived.offensive;
  player.defensive = derived.defensive;
  player.attackSpeed = derived.attackSpeed;

  const weaponCat = player.equipment.weapon?.category ?? EquipmentCategory.NONE;
  player.style = getCombatStylesForCategory(weaponCat)[0];

  const dps = new PlayerVsNPCCalc(player, monster).getDps();
  return { player, monster, dps };
}

// === UI ===
export default function Home() {
  const [result, setResult] = useState<CalcResult | null>(null);
  const reroll = useCallback(() => setResult(rollAndCalc()), []);

  return (
    <main>
      <h1>BestUpgrade — calc sanity check</h1>
      <p>
        Rolls a random gear set and runs the vendored DPS engine against an
        Abyssal demon. If a number renders here, the calc is wired up.
      </p>
      <button onClick={reroll} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
        {result ? 'Reroll loadout' : 'Roll loadout'}
      </button>

      {result && (
        <section style={{ marginTop: '1.5rem' }}>
          <p>
            <strong>vs {result.monster.name}</strong> (HP {result.monster.skills.hp},
            Def {result.monster.skills.def})
          </p>
          <p style={{ fontSize: '1.5rem' }}>
            DPS: <strong>{result.dps.toFixed(3)}</strong>
          </p>
          <p style={{ color: '#888' }}>
            Style: {result.player.style.name} ({result.player.style.type ?? 'n/a'},{' '}
            {result.player.style.stance ?? 'n/a'}) · Attack speed:{' '}
            {result.player.attackSpeed} ticks
          </p>
          <h2>Loadout</h2>
          <ul>
            {SLOTS.map((slot) => {
              const item = result.player.equipment[slot];
              return (
                <li key={slot}>
                  <strong>{slot}:</strong> {item?.name ?? '—'}
                  {item?.version ? ` (${item.version})` : ''}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

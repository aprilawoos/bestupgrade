// === Home page ===
// Random gear roll → DPS computed against an Abyssal demon → 3D viewers
// for the composed player loadout (left) and the demon (right).
// Reroll regenerates the loadout, recomputes the DPS, and the viewer
// refetches the new composed geometry from the API.
'use client';

import { useState, useCallback, useMemo } from 'react';
import merge from 'lodash.mergewith';

import { availableEquipment, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { generateEmptyPlayer } from '@/state';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import type { Player, PlayerEquipment } from '@/types/Player';
import type { Monster } from '@/types/Monster';

import { ModelViewer } from '@/viewer/ModelViewer';

// === Slot list ===
// Mirrors PlayerEquipment in order; used both to drive random selection and
// the loadout display below.
const SLOTS: (keyof PlayerEquipment)[] = [
  'head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring',
];

// === Test target ===
// Standard-variant Abyssal demon. The Catacombs / Wilderness Slayer Cave
// variants exist too but have identical stats — picking the simplest.
const DEMON_NPC_ID = 415;

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

// Phase 8 spot-check: pin the cape + weapon slots so every roll exercises
// the per-weapon idle (AGS = anim 7053, over-shoulder pose) and the UV-
// scroll path (fire cape, anim direction 1, animationSpeed 2).
const PINNED_CAPE_ID = 6570;   // Fire cape
const PINNED_WEAPON_ID = 11802; // Armadyl godsword

function randomLoadout(): PlayerEquipment {
  const loadout = {} as PlayerEquipment;
  for (const slot of SLOTS) {
    const candidates = availableEquipment.filter((e) => e.slot === slot);
    loadout[slot] = candidates.length > 0 ? pickRandom(candidates) : null;
  }
  const pinnedCape = availableEquipment.find((e) => e.id === PINNED_CAPE_ID);
  if (pinnedCape) loadout.cape = pinnedCape;
  const pinnedWeapon = availableEquipment.find((e) => e.id === PINNED_WEAPON_ID);
  if (pinnedWeapon) loadout.weapon = pinnedWeapon;
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

  // Comma-joined item IDs for the player viewer's API call. Recomputed
  // whenever the loadout changes; ModelViewer keys off the URL so a new
  // value triggers a refetch + re-render.
  const playerSrc = useMemo(() => {
    if (!result) return null;
    const ids = SLOTS
      .map((slot) => result.player.equipment[slot]?.id)
      .filter((id): id is number => typeof id === 'number');
    return `/api/player/base?gender=female&items=${ids.join(',')}&kits=296`;
  }, [result]);

  return (
    <main style={{ maxWidth: 1280 }}>
      <h1>BestUpgrade — calc sanity check</h1>
      <p>
        Rolls a random gear set, runs the vendored DPS engine against an
        Abyssal demon, and renders both in 3D. First model load triggers
        the cache parse (~30s on the dev server's first request).
      </p>

      <button onClick={reroll} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
        {result ? 'Reroll loadout' : 'Roll loadout'}
      </button>

      {result && (
        <>
          <section style={{ marginTop: '1.5rem' }}>
            <p style={{ fontSize: '1.5rem', margin: 0 }}>
              DPS: <strong>{result.dps.toFixed(3)}</strong>{' '}
              <span style={{ color: '#888', fontSize: '1rem' }}>
                vs {result.monster.name} (HP {result.monster.skills.hp}, Def {result.monster.skills.def})
              </span>
            </p>
            <p style={{ color: '#888', marginTop: '0.25rem' }}>
              Style: {result.player.style.name} ({result.player.style.type ?? 'n/a'},{' '}
              {result.player.style.stance ?? 'n/a'}) · Attack speed:{' '}
              {result.player.attackSpeed} ticks
            </p>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            <div>
              <h2 style={{ marginTop: 0 }}>Player</h2>
              {playerSrc && <ModelViewer src={playerSrc} />}
            </div>
            <div>
              <h2 style={{ marginTop: 0 }}>{result.monster.name}</h2>
              <ModelViewer modelId={DEMON_NPC_ID} kind="npc" />
            </div>
          </section>

          <section style={{ marginTop: '1rem' }}>
            <h2>Loadout</h2>
            <ul style={{ columns: 2, columnGap: '2rem' }}>
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
        </>
      )}
    </main>
  );
}

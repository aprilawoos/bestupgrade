// ============================================================================
// Set-bonus registry.
//
// Tracks gear sets where wearing all the named armour pieces alongside one
// of the named "trigger" weapons activates an in-calc bonus (extra max hit,
// extra accuracy, multipliers, etc.). The calc engine implements the actual
// bonus math; this registry just lets the loadout sim KNOW that pinning
// these armour pieces is sometimes worth a separate brute-force pass even
// when single-slot Pareto would otherwise drop them.
//
// To add a new set: confirm via grep against src/lib/PlayerVsNPCCalc.ts /
// src/lib/BaseCalc.ts that the calc actually applies the bonus, then add
// the exact item names (must match equipment.json `name` fields) here.
//
// The sim's per-weapon loop runs the normal Pareto-pruned brute force AND
// an additional pass with the set-piece slots pinned to the set's pieces.
// The higher-DPS result wins. This avoids over-extending the frontier (set
// pieces only enter iteration when their trigger weapon is being tested).
// ============================================================================

export interface SetBonus {
  /** Short name for diagnostics. */
  name: string;
  /** Armour pieces that must ALL be equipped to activate the set. */
  pieces: { slot: 'head' | 'cape' | 'neck' | 'body' | 'shield' | 'legs' | 'hands' | 'feet' | 'ring' | 'ammo'; itemName: string }[];
  /** Trigger weapon item names. Wearing one of these + all pieces activates. */
  triggerWeapons: string[];
}

export const SET_BONUSES: SetBonus[] = [
  {
    name: 'Obsidian',
    pieces: [
      { slot: 'head', itemName: 'Obsidian helmet' },
      { slot: 'body', itemName: 'Obsidian platebody' },
      { slot: 'legs', itemName: 'Obsidian platelegs' },
    ],
    // Mirrors BaseCalc.ts:isWearingTzhaarWeapon. Calc applies +10% accuracy
    // and +10% max hit (melee) when this set + one of these weapons is
    // equipped.
    triggerWeapons: [
      'Tzhaar-ket-em', 'Tzhaar-ket-om', 'Tzhaar-ket-om (t)',
      'Toktz-xil-ak', 'Toktz-xil-ek', 'Toktz-mej-tal',
    ],
  },
  // Add future sets here (Inquisitor, Void, Justiciar, Crystal, Virtus, …).
];

export function setsActivatedByWeapon(weaponName: string): SetBonus[] {
  return SET_BONUSES.filter((s) => s.triggerWeapons.includes(weaponName));
}

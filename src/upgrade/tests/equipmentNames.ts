// ============================================================================
// Wiki-name -> equipment.json name resolution, shared by the data generators
// (VendorStarterGen, BossDropsGen, MiscDropsGen, BossDpsGen).
//
// The .scratch research JSON records item names as the wiki displayed them
// when they were researched. Upstream's equipment.json follows the wiki's
// CURRENT capitalisation, which changes over time ('Scythe of vitur' became
// 'Scythe of Vitur' in the 2026-09 sync). An exact match wins; otherwise a
// case-insensitive match is accepted only when exactly one equipment.json
// name qualifies — so a capitalisation change resolves, but nothing
// ambiguous does. Unresolvable names are returned unchanged, so the
// generator's own "no equipment.json match" reporting still fires.
// ============================================================================

import { EquipmentPiece } from '@/types/Player';
import eqJson from '../../../cdn/json/equipment.json';

const exactNames = new Set((eqJson as EquipmentPiece[]).map((e) => e.name));
const namesByLower = new Map<string, string[]>();
for (const n of exactNames) {
  const key = n.toLowerCase();
  namesByLower.set(key, [...(namesByLower.get(key) ?? []), n]);
}

/** The equipment.json spelling of `name`, or `name` itself if none / ambiguous. */
export function resolveEquipmentName(name: string): string {
  if (exactNames.has(name)) return name;
  const hits = namesByLower.get(name.toLowerCase()) ?? [];
  return hits.length === 1 ? hits[0] : name;
}

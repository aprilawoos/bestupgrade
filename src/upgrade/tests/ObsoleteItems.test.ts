// ============================================================================
// Obsolete-item filter: dominance rules, MAX_ACCOUNT verdicts, and the safety
// property /crabsim relies on — removing obsolete items from a pool never
// changes the brute-force sim's best DPS.
// ============================================================================

import { describe, expect, test } from '@jest/globals';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { availableEquipment } from '@/lib/Equipment';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import type { EquipmentPiece } from '@/types/Player';
import type { Monster } from '@/types/Monster';
import { ALL_DOMINANCE_KEYS, DominanceContext, dominates } from '@/upgrade/lib/itemDominance';
import {
  ALL_OSRS_SKILLS,
  MAX_ACCOUNT,
  ProgressionAssumptions,
  allReferencedQuestNames,
  findObsoleteItems,
} from '@/upgrade/lib/obsoleteItems';
import { simulateBestLoadout, SimStyle } from '@/upgrade/lib/loadoutSim';
import { AllSkills, getPlayerAccessiblePool } from '@/upgrade/lib/vendorAccess';
import { getPlayerBossDropPool } from '@/upgrade/lib/bossAccess';
import { getPlayerMiscDropPool } from '@/upgrade/lib/miscAccess';
import { MISC_REQS } from '@/upgrade/lib/miscRequirements';

// =====
// Fixtures
// =====
const NO_CTX: DominanceContext = { ammoIds: [], launcherIds: [] };

function byName(name: string, version = ''): EquipmentPiece {
  const hit = availableEquipment.find((e) => e.name === name && (!version || e.version === version))
    ?? availableEquipment.find((e) => e.name === name);
  if (!hit) throw new Error(`equipment.json has no '${name}'`);
  return hit;
}

// Synthetic armour piece — negative ids never collide with real items or
// the calc's alias table, and plain names carry no effect tags.
let nextId = -1;
function armour(name: string, stats: {
  str?: number; rstr?: number; mstr?: number;
  stab?: number; slash?: number; crush?: number; ranged?: number; magic?: number;
  dStab?: number; dSlash?: number; dCrush?: number; dRanged?: number; dMagic?: number;
}): EquipmentPiece {
  const id = nextId;
  nextId -= 1;
  return {
    name, id, version: '', slot: 'head', image: '', weight: 0, speed: 0,
    category: EquipmentCategory.NONE, isTwoHanded: false,
    bonuses: { str: stats.str ?? 0, ranged_str: stats.rstr ?? 0, magic_str: stats.mstr ?? 0, prayer: 0 },
    offensive: { stab: stats.stab ?? 0, slash: stats.slash ?? 0, crush: stats.crush ?? 0, ranged: stats.ranged ?? 0, magic: stats.magic ?? 0 },
    defensive: { stab: stats.dStab ?? 0, slash: stats.dSlash ?? 0, crush: stats.dCrush ?? 0, ranged: stats.dRanged ?? 0, magic: stats.dMagic ?? 0 },
  };
}

function monster(name: string, version = ''): Monster {
  const m = getMonsters().find((x) => x.name === name && (!version || x.version === version));
  if (!m) throw new Error(`monsters.json has no '${name}' '${version}'`);
  return { ...m, inputs: { ...INITIAL_MONSTER_INPUTS } };
}

// =====
// Dominance rules (calc-derived — see itemDominance.ts header)
// =====
describe('itemDominance rules', () => {
  test('different weapon types are never compared (Rune 2h sword vs Rune warhammer)', () => {
    const twoH = byName('Rune 2h sword');
    const hammer = byName('Rune warhammer');
    for (const key of ALL_DOMINANCE_KEYS) {
      expect(dominates(twoH, hammer, key, NO_CTX)).toBe(false);
      expect(dominates(hammer, twoH, key, NO_CTX)).toBe(false);
    }
  });

  test('same weapon type with better stats dominates (Rune scimitar over Adamant scimitar)', () => {
    expect(dominates(byName('Rune scimitar'), byName('Adamant scimitar'), 'slash', NO_CTX)).toBe(true);
  });

  test('crush: the bulwark\'s defence total (no magic) counts because Dinh\'s bulwark converts it to strength', () => {
    // Equal 5-type defence totals, so the sim's tie-break (rule 7) is level;
    // only the bulwark's stab+slash+crush+ranged subset differs.
    const strong = armour('Strong helm', { str: 5, crush: 5, stab: 5, dCrush: 10, dMagic: 40 });
    const tanky = armour('Tanky helm', { str: 4, crush: 4, stab: 4, dCrush: 50 });
    expect(dominates(strong, tanky, 'crush', NO_CTX)).toBe(false);
    // Stab isn't a bulwark attack type, so the subset doesn't matter there.
    expect(dominates(strong, tanky, 'stab', NO_CTX)).toBe(true);
  });

  test('more offence but less defence never dominates (DPS can tie; the sim then prefers defence)', () => {
    const offence = armour('Offence helm', { str: 5, slash: 5 });
    const defence = armour('Defence helm', { str: 4, slash: 4, dSlash: 30 });
    expect(dominates(offence, defence, 'slash', NO_CTX)).toBe(false);
  });

  test('a tie on one stat never protects the less capable weapon (Yew shortbow over Shortbow)', () => {
    const ctx: DominanceContext = {
      ammoIds: availableEquipment.filter((e) => e.slot === 'ammo').map((e) => e.id),
      launcherIds: [],
    };
    expect(dominates(byName('Yew shortbow'), byName('Shortbow'), 'ranged', ctx)).toBe(true);
    expect(dominates(byName('Shortbow'), byName('Yew shortbow'), 'ranged', ctx)).toBe(false);
  });

  test('ranged: melee strength counts (Eclipse atlatl / Hunter\'s spear)', () => {
    const archer = armour('Archer hood', { rstr: 3, ranged: 10 });
    const brawler = armour('Brawler hood', { rstr: 2, ranged: 9, str: 4 });
    expect(dominates(archer, brawler, 'ranged', NO_CTX)).toBe(false);
  });

  test('crush: a "better" item may not raise stab past its crush gain (Hueycoatl tail)', () => {
    const base = armour('Base helm', { str: 1, crush: 10, stab: 0 });
    const stabby = armour('Stabby helm', { str: 1, crush: 11, stab: 8 });
    expect(dominates(stabby, base, 'crush', NO_CTX)).toBe(false);
    const balanced = armour('Balanced helm', { str: 1, crush: 11, stab: 1 });
    expect(dominates(balanced, base, 'crush', NO_CTX)).toBe(true);
  });

  test('items with a calc effect only lose to items with the same effect', () => {
    const salve = byName('Salve amulet');
    const plainButBetter = { ...byName('Amulet of fury'), slot: salve.slot };
    for (const key of ALL_DOMINANCE_KEYS) expect(dominates(plainButBetter, salve, key, NO_CTX)).toBe(false);
  });

  test('containing an effect item\'s name is not having its effect (Salve amulet (e) vs Salve amulet)', () => {
    // The calc checks exact names; 'Salve amulet (e)' fails wearing('Salve amulet').
    for (const key of ALL_DOMINANCE_KEYS) {
      expect(dominates(byName('Salve amulet (e)'), byName('Salve amulet'), key, NO_CTX)).toBe(false);
    }
  });

  test('exact duplicates: exactly one of the pair is dominated', () => {
    const a = armour('Twin helm A', { str: 2, slash: 3 });
    const b = { ...a, name: 'Twin helm B', id: a.id - 1000 };
    const ab = dominates(a, b, 'slash', NO_CTX);
    const ba = dominates(b, a, 'slash', NO_CTX);
    expect(ab !== ba).toBe(true);
  });
});

// =====
// MAX_ACCOUNT verdicts — the examples the model was designed around
// =====
describe('findObsoleteItems(MAX_ACCOUNT)', () => {
  const result = findObsoleteItems(MAX_ACCOUNT);
  const verdict = (name: string, version = '') => {
    const id = byName(name, version).id;
    const v = result.verdicts.get(id);
    if (!v) throw new Error(`'${name}' not obtainable under MAX_ACCOUNT`);
    return v;
  };

  test.each([
    ['Bronze sword'],
    ['Iron full helm'],
    ['Bronze platelegs'],
    ['Shortbow'],
  ])('%s is obsolete', (name) => {
    expect(verdict(name).obsolete).toBe(true);
  });

  test.each([
    // Drops you wear while farming the next upgrade.
    ['Abyssal whip'], ['Abyssal tentacle'], ['Abyssal bludgeon'], ['Rune defender', 'Normal'],
    // Different weapon types — neither can be ruled out.
    ['Rune 2h sword'], ['Rune warhammer'],
    // Effect items stay until something with the same effect beats them.
    ['Salve amulet'],
    // High defence is real DPS with Dinh's bulwark.
    ['Rune platebody'],
  ])('%s is kept', (name, version = '') => {
    expect(verdict(name, version).obsolete).toBe(false);
  });

  test('every obsolete item names, per attack type, a dominator that is itself obtainable', () => {
    for (const v of result.verdicts.values()) {
      if (!v.obsolete) continue;
      for (const d of Object.values(v.beatenBy)) expect(result.verdicts.has(d.id)).toBe(true);
    }
  });
});

// =====
// Growing the base table one boss at a time: obsolete sets only grow
// =====
describe('adding bosses to the base table one at a time', () => {
  const order = ['Abyssal Sire', 'Kraken', 'General Graardor', 'Zulrah', 'Vorkath', 'Chambers of Xeric'];
  const steps = order.map((_, i) => findObsoleteItems({
    ...MAX_ACCOUNT,
    alwaysAvailableBosses: new Set(order.slice(0, i + 1)),
  }));
  const start = findObsoleteItems({ ...MAX_ACCOUNT, alwaysAvailableBosses: new Set() });

  test('nothing obsolete ever comes back', () => {
    let prev = start.obsoleteIds;
    for (const step of steps) {
      for (const id of prev) expect(step.obsoleteIds.has(id)).toBe(true);
      prev = step.obsoleteIds;
    }
  });

  test.each([
    ['Rune platebody', 'Bandos chestplate'],
    ['Dragon platelegs', 'Bandos tassets'],
  ])('%s becomes obsolete once General Graardor is in the base table (%s)', (name, dominator) => {
    const id = byName(name).id;
    expect(steps[1].verdicts.get(id)?.obsolete).toBe(false); // Sire + Kraken
    const after = steps[2].verdicts.get(id);                 // + Graardor
    expect(after?.obsolete).toBe(true);
    if (after?.obsolete) expect(Object.values(after.beatenBy).map((p) => p.name)).toContain(dominator);
  });
});

// =====
// Safety: filtering never changes the sim's result — best DPS and both
// tie-breaks (defence total, prayer bonus)
// =====
describe('removing obsolete items never changes the sim\'s result', () => {
  // Build the sim pool exactly as /crabsim does, from the same source sets
  // the filter is given.
  function poolFor(a: Required<ProgressionAssumptions>): EquipmentPiece[] {
    const progression = { skills: a.skills, questsStarted: a.questsStarted, questsCompleted: a.questsCompleted, isOnTaskFor: () => true };
    const misc = new Set([...a.alwaysAvailableMiscSources, ...a.obtainableMiscSources]);
    const bosses = new Set([...a.alwaysAvailableBosses, ...a.obtainableBosses]);
    const seen = new Set<number>();
    const out: EquipmentPiece[] = [];
    const pools = [
      getPlayerAccessiblePool({ skills: a.skills, questPoints: a.questPoints, questsStarted: a.questsStarted, questsCompleted: a.questsCompleted }),
      getPlayerBossDropPool(progression, bosses, misc),
      getPlayerMiscDropPool(progression, misc, bosses),
    ];
    for (const pool of pools) for (const p of pool) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
    return out;
  }

  const skillsAt = (level: number): AllSkills => {
    const s: AllSkills = {};
    for (const k of ALL_OSRS_SKILLS) s[k] = level;
    if (level < 10) s.hitpoints = 10;
    return s;
  };
  const quests = allReferencedQuestNames();
  const questRewards = new Set(Object.keys(MISC_REQS).filter((s) => MISC_REQS[s].kind === 'quest_reward'));
  const none = new Set<string>();

  // States small enough for the unfiltered melee brute force to stay quick.
  const states: [string, Required<ProgressionAssumptions>][] = [
    ['level 1, shops only', { skills: skillsAt(1), questsStarted: none, questsCompleted: none, questPoints: 0,
      alwaysAvailableBosses: none, alwaysAvailableMiscSources: none, obtainableBosses: none, obtainableMiscSources: none }],
    ['level 70, every quest + quest rewards', { skills: skillsAt(70), questsStarted: quests, questsCompleted: quests, questPoints: 300,
      alwaysAvailableBosses: none, alwaysAvailableMiscSources: questRewards, obtainableBosses: none, obtainableMiscSources: none }],
    ['level 99, every quest + Warriors\' Guild + Barbarian Assault', { skills: skillsAt(99), questsStarted: quests, questsCompleted: quests, questPoints: 300,
      alwaysAvailableBosses: none, alwaysAvailableMiscSources: questRewards, obtainableBosses: none,
      obtainableMiscSources: new Set(["Warriors' Guild Cyclopes", 'Barbarian Assault']) }],
    // Mirrors /crabsim: every killed boss and acquired source in the base table.
    ['level 99, every quest; Sire / Graardor / Kraken + Warriors\' Guild + Barbarian Assault in the base table', {
      skills: skillsAt(99), questsStarted: quests, questsCompleted: quests, questPoints: 300,
      alwaysAvailableBosses: new Set(['Abyssal Sire', 'General Graardor', 'Kraken']),
      alwaysAvailableMiscSources: new Set([...questRewards, "Warriors' Guild Cyclopes", 'Barbarian Assault']),
      obtainableBosses: none, obtainableMiscSources: none }],
  ];
  const targets = [monster('Abyssal demon', 'Standard'), monster('General Graardor')];

  describe.each(states)('%s', (_label, state) => {
    const pool = poolFor(state);
    const { obsoleteIds } = findObsoleteItems(state);
    const filtered = pool.filter((p) => !obsoleteIds.has(p.id));
    const calcSkills = {
      atk: state.skills.attack, str: state.skills.strength, def: state.skills.defence, hp: state.skills.hitpoints,
      ranged: state.skills.ranged, magic: state.skills.magic, prayer: state.skills.prayer,
      mining: state.skills.mining, herblore: state.skills.herblore,
    };

    test('the filter removes something', () => {
      expect(filtered.length).toBeLessThan(pool.length);
    });

    test.each(targets.flatMap((t) => (['melee', 'ranged', 'magic'] as SimStyle[]).map((s) => [t.name, s, t] as const)))(
      'vs %s, %s',
      (_name, style, target) => {
        const opts = { monster: target, skills: calcSkills, style, questsCompleted: state.questsCompleted, accessibleBossSet: state.obtainableBosses };
        const before = simulateBestLoadout({ ...opts, pool });
        const after = simulateBestLoadout({ ...opts, pool: filtered });
        const score = (r: typeof before) => (r ? [r.dps, r.defSum, r.prayerBonus] : null);
        expect(score(after)).toEqual(score(before));
      },
    );
  });
});

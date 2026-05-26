// ============================================================================
// Quest stat-requirement registry — workaround for the lack of a public OSRS
// quest-completion API. Lets the /crabsim "Auto-complete completable" button
// flip on any quest whose stat thresholds the player already meets.
//
// LIMITATIONS:
//   - Stat reqs ONLY. Quests with quest-chain prerequisites (e.g. Heroes'
//     Quest needs Dragon Slayer I + Shield of Arrav + Lost City + Merlin's
//     Crystal) are flagged completable if the player meets the SKILL part,
//     even though they'd need to actually do the earlier quests in order.
//     This is a deliberate workaround — the user accepts the imprecision.
//   - Recommended-but-not-required levels are included as hard reqs to be
//     conservative.
//   - Skill names are lowercased OSRS standard ("attack", "defence",
//     "strength", "hitpoints", "ranged", "prayer", "magic", "cooking",
//     "woodcutting", "fletching", "fishing", "firemaking", "crafting",
//     "smithing", "mining", "herblore", "agility", "thieving", "slayer",
//     "farming", "runecraft", "hunter", "construction") so they match the
//     /api/lookup-player response's `allSkills` keys.
//   - Fight Caves (our obsidian-armour unlock) is INTENTIONALLY ABSENT —
//     it's a boss-completion unlock and the user will wire boss progression
//     in a follow-up. Leave it draggable but not auto-completable.
// ============================================================================

export type AllSkills = Record<string, number>;

export interface QuestReq {
  /** Skill thresholds — meet ALL to be considered completable. */
  skills?: AllSkills;
  /** True if this entry should never auto-complete (e.g. boss unlocks). */
  excludeFromAutocomplete?: true;
}

// Stat requirements wiki-verified 2026-05-26. Recommended-but-not-required
// levels are EXCLUDED (the user explicitly said: ignore recommended reqs,
// they're possible to complete earlier). Ironman-only extras are EXCLUDED
// when an alternative path exists (e.g. The Fremennik Trials lyre via
// Fletching 25 / Woodcutting 40 / Crafting 40 — bypassable by grinding the
// NPC drop, so not a hard ironman gate). Items obtainable from shops or as
// quest-given drops are NOT counted as ironman-only either.
export const QUEST_REQS: Record<string, QuestReq> = {
  // F2P-tier; no skill reqs. Combat needed to kill Elvarg but that's not a
  // listed skill threshold.
  "Dragon Slayer I": { skills: {} },

  // Falador Park / Telekinetic Grab on a chest, plus minor smithing demo.
  "The Giant Dwarf": { skills: { crafting: 12, firemaking: 16, magic: 33, thieving: 14 } },

  // Cooking gauntlet pizza, ranged combat trial, Mining gem.
  "Heroes' Quest": { skills: { cooking: 53, fishing: 53, herblore: 25, mining: 50 } },

  // No skill thresholds; only quest-chain prereqs.
  "Contact!": { skills: {} },

  // No skill thresholds. (Temple shortcut at 23 Prayer is optional traversal,
  // not a quest requirement.)
  "Priest in Peril": { skills: {} },

  // Myreque chain entry — agility + crafting bumps, plus minor magic/mining.
  "In Aid of the Myreque": { skills: { agility: 25, crafting: 25, magic: 7, mining: 15 } },

  // Pirate-chain endpoint.
  "Cabin Fever": { skills: { agility: 42, crafting: 45, smithing: 50, ranged: 40 } },

  // No skill thresholds; only quest prereqs (Black Knights' Fortress + Druidic Ritual).
  "Recruitment Drive": { skills: {} },

  // Temple Knight chain.
  "The Slug Menace": { skills: { crafting: 30, runecraft: 30, slayer: 30, thieving: 30 } },

  "The Hand in the Sand": { skills: { thieving: 17, crafting: 49 } },

  "Tai Bwo Wannai Trio": { skills: { cooking: 30, fishing: 5, agility: 15 } },

  // No hard skill reqs listed on infobox. Lyre crafting (Fletching 25 / WC
  // 40 / Crafting 40) is an ironman-optional path — drop grind bypasses it.
  "The Fremennik Trials": { skills: {} },

  // Tirannwn line.
  "Mourning's End Part I": { skills: { ranged: 60, thieving: 50 } },
  "Regicide": { skills: { agility: 56, crafting: 10 } },

  // Song of the Elves — every 70 is a hard, unboostable requirement.
  "Song of the Elves": {
    skills: {
      agility: 70, construction: 70, farming: 70, herblore: 70,
      hunter: 70, mining: 70, smithing: 70, woodcutting: 70,
    },
  },

  // DT2-era Mokhaiotl chain.
  "Perilous Moons": { skills: { slayer: 48, hunter: 20, fishing: 20, runecraft: 20, construction: 10 } },

  // ====================================================================
  // Boss-access quest chain (wiki-verified 2026-05-26). These power the
  // /crabsim boss panel's killableBosses() filter — without them in the
  // registry the auto-complete button skips them silently and the boss
  // stays locked even after meeting the stat reqs.
  //
  // Hard reqs only. Quest-chain prereqs (e.g. DS2 needs Legends' Quest +
  // Dream Mentor + Bone Voyage + Client of Kourend etc.) are intentionally
  // NOT modelled — see top-of-file LIMITATIONS comment.
  // ====================================================================

  // Vorkath access. Also requires 200 QP — not modelled here; user accepts
  // the imprecision (autocomplete will flag DS2 at the skill thresholds
  // regardless of actual QP).
  "Dragon Slayer II": { skills: { magic: 75, smithing: 70, mining: 68, crafting: 62, agility: 60, thieving: 60, construction: 50, hitpoints: 50 } },

  // Nex access (DT1) + Ancient staff wield + Ancient sceptre prereq.
  "Desert Treasure I": { skills: { magic: 50, firemaking: 50, thieving: 53, slayer: 10 } },

  // DT2 quartet (Vardorvis / Duke Sucellus / The Leviathan / The Whisperer).
  "Desert Treasure II - The Fallen Empire": { skills: { firemaking: 75, magic: 75, thieving: 70, herblore: 62, runecraft: 60, construction: 60 } },

  // Nex frozen-key miniquest.
  "The Frozen Door": { skills: { agility: 70, ranged: 70, strength: 70, hitpoints: 70 } },

  // Phantom Muspah access.
  "Secrets of the North": { skills: { agility: 69, thieving: 64, hunter: 56 } },

  // Tombs of Amascut access.
  "Beneath Cursed Sands": { skills: { agility: 62, crafting: 55, firemaking: 55 } },

  // Yama access.
  "A Kingdom Divided": { skills: { agility: 54, thieving: 52, woodcutting: 52, herblore: 50, mining: 42, crafting: 38, magic: 35 } },

  // Sol Heredit (Colosseum) access.
  "Children of the Sun": { skills: {} },

  // Deranged Archaeologist access.
  "Bone Voyage": { skills: {} },

  // Amoxliatl access.
  "The Heart of Darkness": { skills: { mining: 55, thieving: 48, slayer: 48, agility: 46 } },

  // Doom of Mokhaiotl access.
  "The Final Dawn": { skills: { thieving: 66, runecraft: 52, fletching: 52 } },

  // Brutus access.
  "The Ides of Milk": { skills: {} },

  // ----------------------------------------------------------------------
  // NOT a quest — our pseudo-unlock for the inner Mor Ul Rek shop. Boss
  // completion, handled by a future boss-progression UI.
  // ----------------------------------------------------------------------
  "Fight Caves": { excludeFromAutocomplete: true },
};

/**
 * Returns the set of unlock-names the player can flip to "Completed" given
 * their current skill levels. Excludes `Fight Caves` and the QP pseudo-
 * unlock (which is named separately by the caller).
 */
export function autocompletableQuests(
  unlockList: readonly string[],
  skills: AllSkills,
): string[] {
  const out: string[] = [];
  for (const quest of unlockList) {
    const req = QUEST_REQS[quest];
    if (!req || req.excludeFromAutocomplete) continue;
    const reqs = req.skills ?? {};
    let ok = true;
    for (const [skill, level] of Object.entries(reqs)) {
      if ((skills[skill] ?? 1) < level) { ok = false; break; }
    }
    if (ok) out.push(quest);
  }
  return out;
}

// Rules engine: pure functions from (character, lookup) → sheet view-model.
// No React, no fetch — lookup is injected (API-backed in the app, file-backed in tests).
// docs/CHARACTER.md describes the character format; docs/SCHEMA.md the compendium.

import { abilityMod, fmtMod } from '../dice/engine.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const SKILLS = {
  acrobatics: 'dex', 'animal-handling': 'wis', arcana: 'int', athletics: 'str',
  deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha',
  investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight-of-hand': 'dex',
  stealth: 'dex', survival: 'wis',
};

export const profBonus = (totalLevel) => 2 + Math.floor((totalLevel - 1) / 4);

// Standard multiclass spell slot table, indexed by effective caster level (1-20).
export const SLOT_TABLE = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// Warlock pact magic: [slots, slotLevel] by warlock level (1-20).
export const PACT_TABLE = [
  [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

export function spellSlots(classes, lookup) {
  // classes: [{class, level}] with compendium class entries resolved via lookup.
  const entries = classes.map((c) => ({ ...c, entry: lookup.get('class', c.class) }));
  const casters = entries.filter((c) => c.entry?.data?.spellcasting && c.entry.data.spellcasting.kind !== 'pact');
  const warlock = entries.find((c) => c.entry?.data?.spellcasting?.kind === 'pact');

  let slots = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  if (casters.length === 1 && !warlock) {
    // Single-class: use the class's own table (paladin/ranger get slots at their
    // own pace, artificer-style rounding differences preserved by the data).
    const c = casters[0];
    const lvl = c.entry.data.levels.find((l) => l.level === c.level);
    slots = [...(lvl?.slots ?? slots)];
  } else if (casters.length > 0) {
    const casterLevel = casters.reduce((sum, c) => {
      const kind = c.entry.data.spellcasting.kind;
      if (kind === 'full') return sum + c.level;
      if (kind === 'half') return sum + Math.floor(c.level / 2);
      if (kind === 'third') return sum + Math.floor(c.level / 3);
      return sum;
    }, 0);
    if (casterLevel > 0) slots = [...SLOT_TABLE[Math.min(casterLevel, 20) - 1]];
  }

  const pact = warlock ? { count: PACT_TABLE[warlock.level - 1][0], level: PACT_TABLE[warlock.level - 1][1] } : null;
  return { slots, pact };
}

export function maxHp(character, lookup) {
  const conMod = abilityMod(character.abilities.con);
  let hp = 0, isFirst = true;
  for (const c of character.classes) {
    const die = lookup.get('class', c.class)?.data?.hitDie ?? 8;
    for (let lvl = 0; lvl < c.level; lvl++) {
      const rolled = c.hpRolls?.[lvl];
      if (isFirst) { hp += die + conMod; isFirst = false; }
      else hp += (rolled ?? die / 2 + 1) + conMod;
    }
  }
  return Math.max(1, hp);
}

export function armorClass(character, lookup) {
  const dex = abilityMod(character.abilities.dex);
  const equipped = (character.equipment ?? [])
    .filter((e) => e.equipped)
    .map((e) => lookup.get('item', e.item))
    .filter(Boolean);
  const isShield = (i) => /shield/i.test(i.data.armor?.category ?? '') || /shield/i.test(i.slug);
  const armor = equipped.find((i) => i.data.itemType === 'armor' && !isShield(i));
  const shield = equipped.find((i) => i.data.itemType === 'armor' && isShield(i));

  let ac;
  if (armor) {
    const a = armor.data.armor;
    const dexPart = a.addDex ? (a.dexCap != null && a.dexCap > 0 ? Math.min(dex, a.dexCap) : a.dexCap === 0 ? 0 : dex) : 0;
    ac = (a.ac ?? 10) + dexPart;
  } else {
    const classSlugs = character.classes.map((c) => c.class);
    if (classSlugs.includes('barbarian')) ac = 10 + dex + abilityMod(character.abilities.con);
    else if (classSlugs.includes('monk') && !shield) ac = 10 + dex + abilityMod(character.abilities.wis);
    else ac = 10 + dex;
  }
  if (shield) ac += 2;
  return ac;
}

export function attacks(character, lookup, prof) {
  const out = [];
  for (const e of character.equipment ?? []) {
    if (!e.equipped) continue;
    const item = lookup.get('item', e.item);
    const w = item?.data?.weapon;
    if (!w?.damage) continue;
    const props = (w.properties ?? []).map((p) => String(p).toLowerCase());
    const str = abilityMod(character.abilities.str);
    const dex = abilityMod(character.abilities.dex);
    const isRanged = !!w.range && !props.includes('thrown');
    const mod = props.includes('finesse') ? Math.max(str, dex) : isRanged ? dex : str;
    out.push({
      name: item.name,
      toHit: `1d20${fmtMod(mod + prof)}`,
      toHitMod: mod + prof,
      damage: `${w.damage}${mod ? fmtMod(mod) : ''}`,
      damageType: w.damageType,
      versatile: w.versatileDamage ? `${w.versatileDamage}${mod ? fmtMod(mod) : ''}` : null,
      properties: w.properties ?? [],
      mastery: w.mastery ?? null,
      range: w.range ?? null,
    });
  }
  return out;
}

export function derive(character, lookup) {
  const totalLevel = character.classes.reduce((s, c) => s + c.level, 0);
  const prof = profBonus(totalLevel);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a, abilityMod(character.abilities[a] ?? 10)]));

  const startingClass = lookup.get('class', character.classes[0]?.class);
  const saveProfs = new Set(startingClass?.data?.saves ?? []);
  const saves = Object.fromEntries(ABILITIES.map((a) => [a, mods[a] + (saveProfs.has(a) ? prof : 0)]));

  const skillProfs = new Set(character.proficiencies?.skills ?? []);
  const expertise = new Set(character.proficiencies?.expertise ?? []);
  const skills = Object.fromEntries(Object.entries(SKILLS).map(([skill, ab]) => [
    skill,
    mods[ab] + (expertise.has(skill) ? prof * 2 : skillProfs.has(skill) ? prof : 0),
  ]));

  const species = character.species ? lookup.get('species', character.species) : null;
  const { slots, pact } = spellSlots(character.classes, lookup);

  const spellcasting = character.classes
    .map((c) => ({ c, entry: lookup.get('class', c.class) }))
    .filter(({ entry }) => entry?.data?.spellcasting)
    .map(({ c, entry }) => {
      const ability = entry.data.spellcasting.ability;
      const lvl = entry.data.levels.find((l) => l.level === c.level);
      return {
        class: c.class,
        ability,
        saveDc: 8 + prof + mods[ability],
        attackMod: prof + mods[ability],
        cantripsKnown: lvl?.classSpecific?.cantrips_known ?? 0,
        preparedMax: lvl?.classSpecific?.prepared_spells ?? lvl?.classSpecific?.spells_known ?? 0,
      };
    });

  let view = {
    name: character.name,
    totalLevel,
    prof,
    classes: character.classes,
    abilities: character.abilities,
    mods,
    saves,
    saveProfs: [...saveProfs],
    skills,
    passivePerception: 10 + skills.perception,
    initiative: mods.dex,
    speed: species?.data?.speed ?? 30,
    size: species?.data?.size ?? 'Medium',
    darkvision: species?.data?.darkvision ?? null,
    ac: armorClass(character, lookup),
    maxHp: maxHp(character, lookup),
    attacks: attacks(character, lookup, prof),
    slots,
    pact,
    spellcasting,
  };

  for (const o of character.overrides ?? []) {
    view = { ...view, [o.path]: o.value };
  }
  return view;
}

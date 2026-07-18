import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive, spellSlots, maxHp, armorClass, profBonus, SLOT_TABLE } from './derive.js';

// File-backed lookup over the real shipped SRD — tests double as data validation.
const SRD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'srd');
const byKey = new Map();
before(() => {
  for (const f of readdirSync(SRD)) {
    for (const e of JSON.parse(readFileSync(join(SRD, f), 'utf8'))) {
      const key = `${e.type}/${e.slug}`;
      const cur = byKey.get(key);
      if (!cur || e.edition === '2024') byKey.set(key, e); // 2024 wins
      byKey.set(`${key}/${e.edition}`, e);
    }
  }
});
const lookup = { get: (type, slug, edition) => byKey.get(edition ? `${type}/${slug}/${edition}` : `${type}/${slug}`) ?? null };

const base = (over = {}) => ({
  name: 'Test', edition: '2024',
  abilities: { str: 10, dex: 16, con: 14, int: 16, wis: 12, cha: 8 },
  classes: [{ class: 'wizard', level: 5 }],
  species: 'elf', background: 'sage',
  proficiencies: { skills: ['arcana', 'perception'], expertise: [] },
  equipment: [], overrides: [],
  ...over,
});

test('proficiency bonus progression', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(profBonus), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
});

test('single-class wizard 5 uses its own slot table', () => {
  const { slots, pact } = spellSlots([{ class: 'wizard', level: 5 }], lookup);
  assert.deepEqual(slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(pact, null);
});

test('fighter has no slots', () => {
  const { slots } = spellSlots([{ class: 'fighter', level: 10 }], lookup);
  assert.deepEqual(slots, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('single-class paladin matches its own progression data', () => {
  const paladin = lookup.get('class', 'paladin');
  const ownL5 = paladin.data.levels.find((l) => l.level === 5).slots;
  const { slots } = spellSlots([{ class: 'paladin', level: 5 }], lookup);
  assert.deepEqual(slots, ownL5);
});

test('multiclass full casters sum levels: wizard 3 / cleric 2 → caster 5', () => {
  const { slots } = spellSlots([{ class: 'wizard', level: 3 }, { class: 'cleric', level: 2 }], lookup);
  assert.deepEqual(slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
});

test('half caster rounds down in multiclass: wizard 5 / paladin 2 → caster 6', () => {
  const { slots } = spellSlots([{ class: 'wizard', level: 5 }, { class: 'paladin', level: 2 }], lookup);
  assert.deepEqual(slots, [4, 3, 3, 0, 0, 0, 0, 0, 0]);
});

test('warlock pact slots separate; other casters use multiclass table', () => {
  const { slots, pact } = spellSlots([{ class: 'warlock', level: 3 }, { class: 'wizard', level: 2 }], lookup);
  assert.deepEqual(pact, { count: 2, level: 2 });
  assert.deepEqual(slots, [3, 0, 0, 0, 0, 0, 0, 0, 0]); // wizard 2 alone on the shared table
});

test('warlock 17 has four 5th-level pact slots', () => {
  const { pact } = spellSlots([{ class: 'warlock', level: 17 }], lookup);
  assert.deepEqual(pact, { count: 4, level: 5 });
});

test('max HP: average and rolled', () => {
  assert.equal(maxHp(base(), lookup), 8 + 4 * 6); // d6: 6+2 first, then 4×(4+2)
  const rolled = base({ classes: [{ class: 'wizard', level: 5, hpRolls: [null, 4, 2, 6, 3] }] });
  assert.equal(maxHp(rolled, lookup), 8 + 6 + 4 + 8 + 5);
});

test('multiclass HP uses each class hit die', () => {
  const c = base({ classes: [{ class: 'fighter', level: 1 }, { class: 'wizard', level: 1 }] });
  assert.equal(maxHp(c, lookup), (10 + 2) + (4 + 2)); // d10 first level, then d6 average
});

test('AC: unarmored, light armor caps nothing, heavy ignores DEX, shield stacks', () => {
  assert.equal(armorClass(base(), lookup), 13); // 10 + 3 dex
  const leather = base({ equipment: [{ item: 'leather-armor', equipped: true }] });
  assert.equal(armorClass(leather, lookup), 11 + 3);
  const chain = base({ equipment: [{ item: 'chain-mail', equipped: true }] });
  assert.equal(armorClass(chain, lookup), 16);
  const shielded = base({ equipment: [{ item: 'chain-mail', equipped: true }, { item: 'shield', equipped: true }] });
  assert.equal(armorClass(shielded, lookup), 18);
});

test('AC: medium armor caps DEX at 2; barbarian unarmored defense', () => {
  const breastplate = base({ equipment: [{ item: 'breastplate', equipped: true }] });
  assert.equal(armorClass(breastplate, lookup), 14 + 2);
  const barb = base({ classes: [{ class: 'barbarian', level: 1 }] });
  assert.equal(armorClass(barb, lookup), 10 + 3 + 2);
});

test('derive: saves, skills, expertise, passives', () => {
  const v = derive(base(), lookup);
  assert.equal(v.prof, 3);
  assert.equal(v.saves.int, 3 + 3); // wizard save prof
  assert.equal(v.saves.str, 0);
  assert.equal(v.skills.arcana, 3 + 3);
  assert.equal(v.skills.stealth, 3);
  assert.equal(v.passivePerception, 10 + 1 + 3);
  const exp = derive(base({ proficiencies: { skills: ['arcana'], expertise: ['arcana'] } }), lookup);
  assert.equal(exp.skills.arcana, 3 + 6);
});

test('derive: weapon attacks pick the right ability', () => {
  const v = derive(base({
    equipment: [
      { item: 'longsword', equipped: true },
      { item: 'dagger', equipped: true },
      { item: 'longbow', equipped: true },
    ],
  }), lookup);
  const byName = Object.fromEntries(v.attacks.map((a) => [a.name.toLowerCase(), a]));
  assert.equal(byName.longsword.toHitMod, 0 + 3);      // STR 10 + prof 3
  assert.equal(byName.dagger.toHitMod, 3 + 3);         // finesse → DEX 16
  assert.equal(byName.longbow.toHitMod, 3 + 3);        // ranged → DEX
  assert.ok(byName.longsword.versatile);               // 1d10 versatile
});

test('derive: spellcasting DC/attack and overrides', () => {
  const v = derive(base(), lookup);
  assert.equal(v.spellcasting[0].saveDc, 8 + 3 + 3);
  assert.equal(v.spellcasting[0].attackMod, 6);
  assert.ok(v.spellcasting[0].preparedMax > 0);
  const o = derive(base({ overrides: [{ path: 'ac', value: 18, note: 'mage armor' }] }), lookup);
  assert.equal(o.ac, 18);
});

test('derive: species grants speed and darkvision', () => {
  const v = derive(base(), lookup);
  assert.equal(v.speed, 30);
  assert.ok(v.darkvision >= 60);
});

// --- edge cases added during the hardening pass ---
test('warlock-only: no shared slots, pact only', () => {
  const { slots, pact } = spellSlots([{ class: 'warlock', level: 5 }], lookup);
  assert.deepEqual(slots, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(pact, { count: 2, level: 3 });
});

test('level 20 wizard has the full slot spread', () => {
  const { slots } = spellSlots([{ class: 'wizard', level: 20 }], lookup);
  assert.equal(slots[8], 1); // one 9th-level slot
  assert.ok(slots[0] >= 4);
});

test('three full casters stack to 20 max', () => {
  const { slots } = spellSlots([
    { class: 'wizard', level: 10 }, { class: 'cleric', level: 10 }, { class: 'bard', level: 5 },
  ], lookup);
  assert.deepEqual(slots, SLOT_TABLE[19]);
});

test('monk unarmored defense uses WIS; shield disables it', () => {
  const monk = base({ classes: [{ class: 'monk', level: 1 }], abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 14, cha: 8 } });
  assert.equal(armorClass(monk, lookup), 10 + 3 + 2);
  const shielded = base({ classes: [{ class: 'monk', level: 1 }], abilities: { str: 10, dex: 16, con: 10, int: 10, wis: 14, cha: 8 }, equipment: [{ item: 'shield', equipped: true }] });
  assert.equal(armorClass(shielded, lookup), 10 + 3 + 2); // falls back to 10+dex, +2 shield
});

test('unknown item slugs are skipped without crashing', () => {
  const c = base({ equipment: [{ item: 'no-such-item', equipped: true }] });
  const v = derive(c, lookup);
  assert.equal(v.attacks.length, 0);
  assert.ok(v.ac >= 10);
});

test('empty classes array yields a sane view', () => {
  const v = derive(base({ classes: [] }), lookup);
  assert.equal(v.totalLevel, 0);
  assert.equal(v.maxHp, 1);
});

test('2014 species still resolves via edition fallback', () => {
  const c = base({ species: 'half-orc' }); // 2014-only species
  const v = derive(c, lookup);
  assert.ok(v.speed >= 25);
  assert.ok(v.darkvision);
});

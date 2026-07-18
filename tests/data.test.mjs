import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Validates every shipped compendium entry against docs/SCHEMA.md invariants.
const SRD = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'srd');
const all = [];
const byType = {};
before(() => {
  for (const f of readdirSync(SRD).filter((f) => f.endsWith('.json'))) {
    const entries = JSON.parse(readFileSync(join(SRD, f), 'utf8'));
    byType[f.replace('.json', '')] = entries;
    all.push(...entries);
  }
});

test('every entry has the envelope fields and consistent id', () => {
  for (const e of all) {
    assert.ok(e.id && e.type && e.slug && e.name, `missing envelope: ${JSON.stringify(e).slice(0, 80)}`);
    assert.ok(['2014', '2024'].includes(e.edition), `bad edition on ${e.id}`);
    assert.ok(e.source?.key, `missing source on ${e.id}`);
    assert.equal(e.id, `${e.type}/${e.slug}/${e.source.key}`, `id mismatch on ${e.id}`);
    assert.match(e.slug, /^[a-z0-9][a-z0-9-]*$/, `bad slug: ${e.slug}`);
    assert.equal(typeof e.text, 'string', `text not string on ${e.id}`);
  }
});

test('ids are globally unique', () => {
  const seen = new Set();
  for (const e of all) {
    assert.ok(!seen.has(e.id), `duplicate id: ${e.id}`);
    seen.add(e.id);
  }
});

test('spells: level 0-9, components object, classes are slugs', () => {
  for (const s of byType.spell) {
    assert.ok(s.data.level >= 0 && s.data.level <= 9, `${s.id} level ${s.data.level}`);
    assert.equal(typeof s.data.components, 'object', `${s.id} components`);
    for (const c of s.data.classes) assert.match(c, /^[a-z-]+$/, `${s.id} class "${c}"`);
    if (s.data.damage) assert.ok(s.data.damage.dice, `${s.id} damage without dice`);
  }
});

test('monsters: six abilities, numeric cr, hp, parseable attack bonuses', () => {
  for (const m of byType.monster) {
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      assert.equal(typeof m.data.abilities[ab], 'number', `${m.id} missing ${ab}`);
    }
    assert.equal(typeof m.data.cr, 'number', `${m.id} cr ${m.data.cr}`);
    assert.ok(m.data.hp.average > 0, `${m.id} hp`);
    for (const group of ['traits', 'actions', 'bonusActions', 'reactions', 'legendary']) {
      for (const a of m.data[group] ?? []) {
        assert.ok(a.name, `${m.id} unnamed ${group} entry`);
        if (a.attack) {
          assert.equal(typeof a.attack.bonus, 'number', `${m.id} ${a.name} attack bonus`);
          for (const d of a.attack.damage) {
            // flat damage ("1") is legal — the roller treats it as a modifier
            assert.match(d.dice, /^(\d+|\d+d\d+([+-]\d+)?)$/, `${m.id} ${a.name} dice "${d.dice}"`);
          }
        }
      }
    }
  }
});

test('classes: 20 levels, ascending, valid saves, casters have slots', () => {
  for (const c of byType.class) {
    assert.equal(c.data.levels.length, 20, `${c.id} has ${c.data.levels.length} levels`);
    c.data.levels.forEach((l, i) => assert.equal(l.level, i + 1, `${c.id} level order`));
    for (const s of c.data.saves) assert.match(s, /^(str|dex|con|int|wis|cha)$/, `${c.id} save "${s}"`);
    assert.ok(c.data.hitDie >= 6 && c.data.hitDie <= 12, `${c.id} hit die`);
    if (c.data.spellcasting && c.data.spellcasting.kind !== 'pact') {
      const l5 = c.data.levels.find((l) => l.level === 5);
      assert.ok(l5.slots?.some((n) => n > 0), `${c.id} caster with no slots at 5`);
    }
  }
});

test('class level features all resolve to feature entries', () => {
  const featureSlugs = new Set(byType.feature.map((f) => `${f.slug}/${f.edition}`));
  let missing = [];
  for (const c of byType.class) {
    for (const l of c.data.levels) {
      for (const f of l.features) {
        if (!featureSlugs.has(`${f}/${c.edition}`)) missing.push(`${c.slug}/${c.edition} L${l.level}: ${f}`);
      }
    }
  }
  assert.deepEqual(missing, [], `dangling feature refs:\n${missing.join('\n')}`);
});

test('subclasses reference existing classes', () => {
  const classSlugs = new Set(byType.class.map((c) => `${c.slug}/${c.edition}`));
  for (const sc of byType.subclass) {
    assert.ok(classSlugs.has(`${sc.data.class}/${sc.edition}`), `${sc.id} → class "${sc.data.class}"`);
  }
});

test('items: weapons have damage+type, armor has ac, magic items have rarity', () => {
  for (const i of byType.item) {
    if (i.data.itemType === 'weapon' && i.data.weapon?.damage) {
      assert.match(i.data.weapon.damage, /^(\d+|\d+d\d+)$/, `${i.id} weapon damage "${i.data.weapon.damage}"`);
    }
    if (i.data.itemType === 'armor') {
      assert.ok(i.data.armor?.ac >= 2, `${i.id} armor ac`);
    }
    if (i.data.itemType === 'magic') {
      assert.ok(i.data.rarity, `${i.id} magic item without rarity`);
    }
  }
});

test('species have traits and sane speed', () => {
  for (const s of byType.species) {
    assert.ok(Array.isArray(s.data.traits), `${s.id} traits`);
    assert.ok(s.data.speed >= 25 && s.data.speed <= 40, `${s.id} speed ${s.data.speed}`);
  }
});

test('every 2024 background grants a feat and three ability scores', () => {
  for (const b of byType.background.filter((b) => b.edition === '2024')) {
    assert.ok(b.data.feat, `${b.id} missing feat`);
    assert.equal(b.data.abilityScores.length, 3, `${b.id} ability scores`);
  }
});

test('nontrivial corpus sizes (regression guard against silent data loss)', () => {
  assert.ok(byType.spell.length >= 600, `spells: ${byType.spell.length}`);
  assert.ok(byType.monster.length >= 600, `monsters: ${byType.monster.length}`);
  assert.equal(byType.class.length, 24);
  assert.equal(byType.species.length, 18);
  assert.ok(byType.item.length >= 850);
  assert.ok(byType.feature.length >= 600);
});

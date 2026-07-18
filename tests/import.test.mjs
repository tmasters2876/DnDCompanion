import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('source importer resolves copies and reports complete, deduplicated coverage', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dnd-import-'));
  const src = join(fixture, 'sources');
  const out = join(fixture, 'normalized');
  const dndData = join(fixture, 'dnd-data');
  mkdirSync(src); mkdirSync(out); mkdirSync(dndData);
  const document = {
    monster: [
      { name: 'Base Horror', source: 'TEST', size: ['M'], type: 'undead', ac: [13], hp: { average: 22, formula: '4d8+4' }, speed: { walk: 30 }, str: 12, dex: 14, con: 12, int: 8, wis: 10, cha: 6, cr: '1', action: [{ name: 'Claw', entries: ['{@atk mw} {@hit 4} to hit. {@h}5 ({@damage 1d6 + 2}) slashing damage.'] }] },
      { name: 'Greater Horror', source: 'TEST2', _copy: { name: 'Base Horror', source: 'TEST', _mod: { action: { mode: 'appendArr', items: { name: 'Shriek', entries: ['Creatures flee.'] } } } }, hp: { average: 40, formula: '6d8+12' } },
    ],
    monsterFluff: [{ name: 'Greater Horror', source: 'TEST2', entries: ['A terror remembered in forbidden histories.'] }],
    magicvariant: [{ name: 'Moon-Touched', requires: [{ sword: true }], inherits: { nameSuffix: ' of Moonlight', source: 'TEST', rarity: 'rare', entries: ['It shines.'] } }],
    race: [{ name: 'Starfolk', source: 'TEST', size: ['M'], speed: 30, ability: [{ choose: { from: ['int', 'wis', 'cha'] } }], entries: [{ name: 'Starlight', entries: ['You glow.'] }] }],
    subrace: [{ name: 'Duskborn', raceName: 'Starfolk', source: 'TEST', darkvision: 60, entries: [{ name: 'Night Eyes', entries: ['You see.'] }] }],
    optionalfeature: [{ name: 'Forbidden Study', source: 'TEST', featureType: ['EI'], entries: ['Learn a secret.'] }],
    variantrule: [{ name: 'Doom Clock', source: 'TEST', entries: ['Time advances.'] }],
    table: [{ name: 'Dooms', source: 'TEST', colLabels: ['d6', 'Doom'], rows: [['1', 'Ash']] }],
    itemGroup: [{ name: 'Relics', source: 'TEST', items: ['Moon Blade|TEST'], entries: ['A collection.'] }],
    reward: [{ name: 'Night Boon', source: 'TEST', type: 'Boon', entries: ['A gift.'] }],
    language: [{ name: 'Old Speech', source: 'TEST', typicalSpeakers: ['Liches'], entries: ['Whispers.'] }],
    disease: [{ name: 'Ash Fever', source: 'TEST', entries: ['A wasting illness.'] }],
    class: [{ name: 'Warden', source: 'TEST', hd: { faces: 10 }, proficiency: ['str', 'con'], spellcastingAbility: 'wis', casterProgression: 'half', classSpells: ['Moon Spark|TEST'], classFeatures: ['Vigil|Warden|TEST|1'], classTableGroups: [{ title: 'Spell Slots', rowsSpellProgression: Array.from({ length: 20 }, (_, i) => i < 1 ? [0, 0] : [2, i > 4 ? 1 : 0]) }] }],
    classFeature: [{ name: 'Vigil', className: 'Warden', level: 1, source: 'TEST', entries: ['Stand watch.'] }],
    subclass: [{ name: 'Grave Warden', shortName: 'Grave Warden', className: 'Warden', classSource: 'TEST', source: 'TEST', subclassFeatures: ['Grave Sight|Warden|TEST|Grave Warden|TEST|3'] }],
    subclassFeature: [{ name: 'Grave Sight', className: 'Warden', subclassShortName: 'Grave Warden', level: 3, source: 'TEST', entries: ['See spirits.'] }],
    spell: [{ name: 'Moon Spark', source: 'TEST', level: 1, school: 'V', entries: ['A target takes 1d6 radiant damage.'] }],
    background: [{ name: 'Watcher', source: 'TEST', ability: [{ choose: { from: ['int', 'wis', 'cha'] } }], feats: [{ Alert: true }], skillProficiencies: [{ perception: true, insight: true }], entries: [{ name: 'Feature: Vigilance', data: { isFeature: true }, entries: ['You notice danger.'] }] }],
    adventure: [{ name: 'The Black Bell', id: 'TBB', source: 'TEST', level: { min: 3, max: 5 } }],
    adventureData: [{ id: 'TBB', data: [{ type: 'section', name: 'Arrival', entries: ['The bell tolls.'] }] }],
    item: [{ name: 'Repeated Relic', source: 'TEST', entries: ['One.'] }, { name: 'Repeated Relic', source: 'TEST', entries: ['One.'] }],
    unhandledThing: [{ name: 'Measured Gap' }],
  };
  writeFileSync(join(src, 'fixture.json'), JSON.stringify(document));
  writeFileSync(join(dndData, 'spells.json'), JSON.stringify([{
    name: 'Archive Ray', description: 'A locally supplied flattened spell.', publisher: 'Fixture Press', book: 'Fixture Compendium',
    properties: { Level: 2, School: 'evocation', Components: 'V, S', 'Casting Time': '1 action', Duration: 'Instantaneous', Classes: 'Wizard' },
  }]));

  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'import-sources.mjs')], {
      env: { ...process.env, DND_SOURCE_DIR: src, DND_OUTPUT_DIR: out, DND_DATA_DIR: dndData }, stdio: 'pipe',
    });
    const monsters = JSON.parse(readFileSync(join(out, 'monster.json')));
    const derived = monsters.find((entry) => entry.name === 'Greater Horror');
    assert.equal(derived.data.hp.average, 40);
    assert.ok(derived.data.actions.some((action) => action.name === 'Claw'));
    assert.ok(derived.data.actions.some((action) => action.name === 'Shriek'));
    assert.match(derived.text, /forbidden histories/);

    const classes = JSON.parse(readFileSync(join(out, 'class.json')));
    assert.equal(classes[0].data.levels.length, 20);
    assert.deepEqual(classes[0].data.levels[0].features, ['vigil']);
    const spells = JSON.parse(readFileSync(join(out, 'spell.json')));
    assert.deepEqual(spells.find((entry) => entry.name === 'Moon Spark').data.classes, ['warden']);
    assert.deepEqual(spells.find((entry) => entry.name === 'Archive Ray').data.classes, ['wizard']);
    const adventures = JSON.parse(readFileSync(join(out, 'adventure.json')));
    assert.match(adventures[0].text, /bell tolls/);

    const report = JSON.parse(readFileSync(join(out, 'import-report.json')));
    assert.equal(report.summary.parseErrors, 0);
    assert.equal(report.summary.copies.resolved, 1);
    assert.equal(report.summary.duplicateIds, 1);
    assert.equal(report.unsupportedByKey.unhandledThing, 1);
    assert.equal(report.recognizedByKey.magicvariant, 1);
    for (const type of ['table', 'item-group', 'reward', 'language', 'disease', 'species', 'feature']) {
      assert.ok(report.normalizedByType[type] > 0, `missing ${type}`);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

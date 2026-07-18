import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { choosePreferred, loadCompendium, resolve } from '../server/lib/compendium.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const abilities = `<table><tbody>
<tr><td><strong>STR</strong></td><td>12</td><td>+1</td><td>+1</td><td><strong>DEX</strong></td><td>14</td><td>+2</td><td>+2</td><td><strong>CON</strong></td><td>12</td><td>+1</td><td>+1</td></tr>
<tr><td><strong>INT</strong></td><td>8</td><td>−1</td><td>−1</td><td><strong>WIS</strong></td><td>10</td><td>+0</td><td>+0</td><td><strong>CHA</strong></td><td>6</td><td>−2</td><td>−2</td></tr>
</tbody></table>`;

const statBlock = (name) => `## ${name}\n\n_Medium Undead, Neutral Evil_\n\n**AC** 13\n**HP** 22 (4d8 + 4)\n**Speed** 30 ft.\n\n${abilities}\n\n**Senses** Passive Perception 10\n**Languages** Common\n**CR** 1 (XP 200)\n\n#### Actions\n\n**_Claw._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Slashing damage.`;

test('Markdown importer routes structured content, audits conflicts, and preserves explicit stat-block absence', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'dnd-markdown-'));
  const src = join(fixture, 'pdfs');
  const out = join(fixture, 'sources', '_normalized');
  const baseline = join(fixture, 'srd');
  mkdirSync(src, { recursive: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(baseline, { recursive: true });

  const spells = `﻿# Spells\r\n## Spell Descriptions\r\n#### Alpha Bolt\r\n\r\n_Level 2 Evocation (Wizard)_\r\n\r\n**Casting Time:** Action\r\n**Range:** 60 feet\r\n**Components:** V, S\r\n**Duration:** Instantaneous\r\n\r\nA target takes 2d6 Force damage.\r\n\r\n${statBlock('Clockwork Servant')}\r\n\r\n#### Beta Ray\r\n\r\n_Evocation Cantrip (Wizard)_\r\n\r\n**Casting Time:** Action\r\n**Range:** 30 feet\r\n**Components:** V\r\n**Duration:** Instantaneous\r\n\r\nA target takes 1d6 Radiant damage.`;
  const monsters = `# Monsters\n## Horrors\n### Grave Horror\n\n_Medium Undead, Neutral Evil_\n\n**AC** 13\n**HP** 22 (4d8 + 4)\n**Speed** 30 ft.\n\n${abilities}\n\n**Senses** Passive Perception 10\n**Languages** Common\n**CR** 1 (XP 200)\n\n#### Actions\n\n**_Claw._** _Melee Attack Roll:_ +4, reach 5 ft. _Hit:_ 5 (1d6 + 2) Slashing damage.`;
  const glossary = `# Rules Glossary\n## Rules Definitions\n### Attack [Action]\nResolve an attack against a target using the appropriate modifier and defense.\n\n**Outcome Table**\n\n<table><thead><tr><th>d2</th><th>Outcome</th></tr></thead><tbody><tr><td>1</td><td>Hit</td></tr><tr><td>2</td><td>Miss</td></tr></tbody></table>`;
  const classRows = Array.from({ length: 20 }, (_, index) => {
    const level = index + 1;
    const slots = level === 5 ? [4, 3, 2] : [2];
    return `<tr><td>${level}</td><td>+${2 + Math.floor(index / 4)}</td><td>—</td><td>4</td><td>9</td>${Array.from({ length: 9 }, (_, slot) => `<td>${slots[slot] ?? '—'}</td>`).join('')}</tr>`;
  }).join('');
  const classes = `# Classes\n## Wizard\n\n**Core Wizard Traits**\n<table><tbody><tr><td>Primary Ability</td><td>Intelligence</td></tr><tr><td>Hit Point Die</td><td>D6 per Wizard level</td></tr><tr><td>Saving Throw Proficiencies</td><td>Intelligence and Wisdom</td></tr><tr><td>Skill Proficiencies</td><td>Choose 2: Arcana or History</td></tr><tr><td>Weapon Proficiencies</td><td>Simple weapons</td></tr><tr><td>Armor Training</td><td>None</td></tr><tr><td>Starting Equipment</td><td>Spellbook</td></tr></tbody></table>\n\n**Wizard Features**\n<table><thead><tr><th>Level</th><th>Proficiency Bonus</th><th>Class Features</th><th>Cantrips</th><th>Prepared Spells</th><th colspan="9">Spell Slots per Spell Level</th></tr><tr><th></th><th></th><th></th><th></th><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th></tr></thead><tbody>${classRows}</tbody></table>`;
  writeFileSync(join(src, 'spells.md'), spells);
  writeFileSync(join(src, 'monsters-A-Z.md'), monsters);
  writeFileSync(join(src, 'rules-glossary.md'), glossary);
  writeFileSync(join(src, 'classes.md'), classes);
  writeFileSync(join(src, 'notes.pdf'), 'unsupported fixture');
  mkdirSync(join(src, 'broken.md'));

  writeFileSync(join(baseline, 'spell.json'), JSON.stringify([{
    id: 'spell/alpha-bolt/srd52', type: 'spell', slug: 'alpha-bolt', name: 'Alpha Bolt', edition: '2024',
    source: { key: 'srd52', name: 'SRD 5.2' },
    data: { level: 3, school: 'evocation', castingTime: 'Action', range: '60 feet', components: { v: true, s: true, m: false }, duration: 'Instantaneous', classes: ['wizard'] },
    text: 'A target takes 2d6 Force damage.',
  }]));
  writeFileSync(join(baseline, 'monster.json'), JSON.stringify([{
    id: 'monster/grave-horror/srd52', type: 'monster', slug: 'grave-horror', name: 'Grave Horror', edition: '2024',
    source: { key: 'srd52', name: 'SRD 5.2' },
    data: { size: 'Medium', creatureType: 'undead', ac: 13, hp: { average: 22, formula: '4d8+4' }, speed: { walk: 30, swim: 15, climb: 15 }, abilities: { str: 12, dex: 14, con: 12, int: 8, wis: 10, cha: 6 }, cr: 1, actions: [] },
    text: 'A compact baseline record.',
  }]));

  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'import-markdown.mjs')], {
      env: { ...process.env, DND_MARKDOWN_DIR: src, DND_OUTPUT_DIR: out, DND_BASELINE_DIR: baseline }, stdio: 'pipe',
    });
    const importedSpells = JSON.parse(readFileSync(join(out, 'markdown-spell.json')));
    assert.deepEqual(importedSpells.map((entry) => entry.name), ['Alpha Bolt', 'Beta Ray']);
    assert.equal(importedSpells[0].data.level, 2, 'Markdown scalar conflict is authoritative');

    const importedMonsters = JSON.parse(readFileSync(join(out, 'markdown-monster.json')));
    assert.deepEqual(importedMonsters.map((entry) => entry.name).sort(), ['Clockwork Servant', 'Grave Horror']);
    assert.equal(importedMonsters.find((entry) => entry.name === 'Grave Horror').data.abilities.cha, 6);

    const actions = JSON.parse(readFileSync(join(out, 'markdown-action.json')));
    assert.equal(actions[0].name, 'Attack');
    const tables = JSON.parse(readFileSync(join(out, 'markdown-table.json')));
    assert.deepEqual(tables.find((entry) => entry.name === 'Outcome Table').data.columns, ['d2', 'Outcome']);
    const importedClasses = JSON.parse(readFileSync(join(out, 'markdown-class.json')));
    assert.equal(importedClasses[0].data.levels.length, 20);
    assert.deepEqual(importedClasses[0].data.levels[4].slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
    assert.equal(importedClasses[0].data.levels[4].classSpecific.cantrips_known, 4);

    const report = JSON.parse(readFileSync(join(out, 'markdown-report.json')));
    assert.equal(report.summary.filesScanned, 5);
    assert.equal(report.summary.unsupportedFiles, 1);
    assert.equal(report.summary.parseErrors, 1);
    assert.ok(report.summary.matchingJsonEntries >= 2);
    assert.equal(report.conflicts.find((entry) => entry.slug === 'alpha-bolt').decision, 'markdown-wins');
    assert.equal(report.sourceDirectory, 'data/pdfs');
    assert.doesNotMatch(JSON.stringify(report), new RegExp(fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const compendium = loadCompendium(fixture);
    const horror = resolve(compendium, 'monster', 'grave-horror', '2024');
    assert.equal(horror.source.key, 'personal-md');
    assert.deepEqual(horror.data.speed, { walk: 30, fly: null, swim: null, climb: null, burrow: null, hover: false });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('JSON only leads local Markdown when it is materially more complete', () => {
  const personal = { id: 'item/relic/personal-md', type: 'item', slug: 'relic', name: 'Relic', edition: '2024', source: { key: 'personal-md' }, data: { itemType: 'magic' }, text: 'Short local note.' };
  const json = { id: 'item/relic/srd52', type: 'item', slug: 'relic', name: 'Relic', edition: '2024', source: { key: 'srd52' }, data: { itemType: 'magic', rarity: 'rare', attunement: true, cost: { qty: 5000, unit: 'gp' }, charges: 7, actions: [{ name: 'Flare', damage: '4d6' }] }, text: 'A substantially more complete mechanical and narrative description of this relic and every one of its powers.' };
  const winner = choosePreferred(personal, json);
  assert.equal(winner.source.key, 'srd52');
  assert.deepEqual(winner.data.provenance, ['srd52', 'personal-md']);
});

test('ordinary source selection never invents a hybrid record', () => {
  const official = { id: 'monster/warden/srd52', type: 'monster', slug: 'warden', name: 'Warden', edition: '2024', source: { key: 'srd52' }, data: { speed: { walk: 30, fly: null, swim: null, climb: null } }, text: 'Official.' };
  const community = { id: 'monster/warden/community', type: 'monster', slug: 'warden', name: 'Warden', edition: '2024', source: { key: 'community' }, data: { speed: { walk: 30, swim: 15, climb: 15 }, extra: true }, text: 'Community.' };
  const winner = choosePreferred(official, community);
  assert.equal(winner.source.key, 'srd52');
  assert.deepEqual(winner.data, { speed: { walk: 30, fly: null, swim: null, climb: null }, provenance: ['srd52', 'community'] });
});

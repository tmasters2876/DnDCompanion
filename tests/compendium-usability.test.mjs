import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCompendium, resolve } from '../server/lib/compendium.mjs';

const envelope = (type, slug, source, data, text = '') => ({
  id: `${type}/${slug}/${source}`, type, slug, name: slug.replace(/-/g, ' '), edition: '2024',
  source: { key: source, name: source }, data, text,
});

test('public compendium excludes unusable imports but preserves tool-created homebrew', () => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-usable-'));
  const normalized = join(root, 'sources', '_normalized');
  const homebrew = join(root, 'homebrew');
  mkdirSync(normalized, { recursive: true });
  mkdirSync(homebrew, { recursive: true });
  const shell = envelope('monster', 'the-vorga', 'imported', {
    ac: null, hp: { average: null, formula: null },
    abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null }, partial: true,
  });
  const playable = envelope('monster', 'fire-giant', 'imported', {
    ac: 18, hp: { average: 162, formula: '13d12+78' },
    abilities: { str: 25, dex: 9, con: 23, int: 10, wis: 14, cha: 13 },
    actions: [{ name: 'Flame Sword', text: 'Melee Attack Roll: +11. Hit: 21 (4d6 + 7) Slashing damage.' }],
  }, 'A complete combat-ready giant.');
  const vehicleShell = envelope('vehicle', 'the-corvette', 'imported', {
    page: 12, properties: { vehicleType: 'SHIP', size: 'corvette' },
  });
  const playableObject = envelope('object', 'brazen-bull', 'imported', {
    properties: { objectType: 'U', ac: 10, hp: 50, speed: 30 },
  });
  writeFileSync(join(normalized, 'entries.json'), JSON.stringify([shell, playable, vehicleShell, playableObject]));
  writeFileSync(join(homebrew, 'monster-blank-friend.json'), JSON.stringify(envelope('monster', 'blank-friend', 'homebrew', {})));
  try {
    const compendium = loadCompendium(root);
    assert.equal(resolve(compendium, 'monster', 'the-vorga', '2024'), null);
    assert.ok(resolve(compendium, 'monster', 'fire-giant', '2024'));
    assert.equal(resolve(compendium, 'vehicle', 'the-corvette', '2024'), null);
    assert.ok(resolve(compendium, 'object', 'brazen-bull', '2024'));
    assert.ok(resolve(compendium, 'monster', 'blank-friend', '2024'));
    assert.equal(compendium.dedupe.excludedUnusable, 2);
    assert.deepEqual(compendium.dedupe.excludedByType, { monster: 1, vehicle: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

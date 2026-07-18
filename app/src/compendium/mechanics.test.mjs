import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionMechanics, entryRolls, extractActionMechanics } from './mechanics.js';

test('extracts emphasized 2024 attack rolls and every damage component', () => {
  const result = extractActionMechanics('_Melee Attack Roll:_ +11, reach 10 ft. _Hit:_ 21 (4d6 + 7) Slashing damage plus 10 (3d6) Fire damage.');
  assert.equal(result.attack.bonus, 11);
  assert.equal(result.attack.reach, 10);
  assert.deepEqual(result.damage, [
    { kind: 'damage', formula: '4d6+7', type: 'slashing' },
    { kind: 'damage', formula: '3d6', type: 'fire' },
  ]);
});

test('backfills damage when an imported attack only has its hit bonus', () => {
  const result = actionMechanics({ attack: { bonus: 7, damage: [] }, text: 'Hit: 13 (2d8 + 4) Force damage.' });
  assert.deepEqual(result.attack.damage, [{ dice: '2d8+4', type: 'force' }]);
});

test('generic cards expose attacks, saves, damage, healing, and weapon dice', () => {
  const rolls = entryRolls({
    data: { weapon: { damage: '1d8', damageType: 'piercing' } },
    text: 'Ranged Attack Roll: +6. Hit: 8 (1d10 + 3) Force damage. DC 14 Dexterity Saving Throw. The target regains 2d8 Hit Points.',
  });
  assert.equal(rolls.attack.bonus, 6);
  assert.deepEqual(rolls.save, { dc: 14, ability: 'dex' });
  assert.ok(rolls.damage.some((roll) => roll.formula === '1d8'));
  assert.ok(rolls.damage.some((roll) => roll.formula === '1d10+3'));
  assert.deepEqual(rolls.healing, [{ kind: 'healing', formula: '2d8', type: 'healing' }]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, roll, withAdvantage, abilityMod } from './engine.js';

const fixed = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
// rng returning x/sides-epsilon yields value x: floor(rng*sides)+1
const rngFor = (sides, ...values) => fixed(...values.map((v) => (v - 1) / sides + 1e-9));

test('parses plain terms', () => {
  assert.equal(parse('1d20+5').length, 2);
  assert.equal(parse('2d20kh1+3')[0].keep.mode, 'kh');
  assert.equal(parse('d6')[0].count, 1);
  assert.equal(parse('8d6 + 2 - 1d4').length, 3);
});

test('rejects garbage', () => {
  assert.throws(() => parse('banana'));
  assert.throws(() => parse('1d20+'));
  assert.throws(() => parse('999d2000'));
});

test('rolls with modifier', () => {
  const r = roll('1d20+5', rngFor(20, 13));
  assert.equal(r.total, 18);
  assert.equal(r.d20.natural, 13);
  assert.equal(r.d20.crit, false);
});

test('advantage keeps highest', () => {
  const r = roll('2d20kh1+2', rngFor(20, 4, 17));
  assert.equal(r.total, 19);
  assert.equal(r.d20.natural, 17);
  assert.equal(r.terms[0].rolls.filter((x) => x.kept).length, 1);
});

test('disadvantage keeps lowest', () => {
  const r = roll('2d20kl1', rngFor(20, 4, 17));
  assert.equal(r.total, 4);
});

test('crit and fumble detection', () => {
  assert.equal(roll('1d20', rngFor(20, 20)).d20.crit, true);
  assert.equal(roll('1d20', rngFor(20, 1)).d20.fumble, true);
});

test('multi-term damage', () => {
  const r = roll('2d6+1d4+3', rngFor(6, 2, 5)); // note: d4 also drawn from same rng seq
  assert.equal(r.terms.length, 3);
  assert.ok(r.total >= 2 + 1 + 1 + 3);
  assert.equal(r.d20, null);
});

test('subtraction', () => {
  const r = roll('10-1d4', rngFor(4, 3));
  assert.equal(r.total, 7);
});

test('withAdvantage rewrites only the d20 term', () => {
  assert.equal(withAdvantage('1d20+5', 'adv'), '2d20kh1+5');
  assert.equal(withAdvantage('d20+5', 'dis'), '2d20kl1+5');
  assert.equal(withAdvantage('8d6', 'adv'), '8d6');
  assert.equal(withAdvantage('1d20+5', null), '1d20+5');
});

test('ability modifiers', () => {
  assert.equal(abilityMod(10), 0);
  assert.equal(abilityMod(8), -1);
  assert.equal(abilityMod(20), 5);
  assert.equal(abilityMod(13), 1);
});

// --- edge cases added during the hardening pass ---
test('keep-multiple and drop variants', () => {
  const r = roll('4d6kh3', rngFor(6, 1, 4, 5, 3));
  assert.equal(r.total, 12); // drops the 1
  const d = roll('4d6dl1', rngFor(6, 1, 4, 5, 3));
  assert.equal(d.total, 12); // same thing via drop-lowest
  const dh = roll('3d6dh1', rngFor(6, 2, 6, 4));
  assert.equal(dh.total, 6); // drops the 6
});

test('whitespace and bare dice tolerated', () => {
  assert.equal(roll(' 1d20 + 5 ', rngFor(20, 10)).total, 15);
  assert.equal(roll('d20', rngFor(20, 7)).total, 7);
});

test('withAdvantage is idempotent-ish on already-doubled rolls', () => {
  assert.equal(withAdvantage('2d20kh1+5', 'adv'), '2d20kh1+5'); // only 1d20/d20 rewritten
});

test('mod-only formulas work', () => {
  assert.equal(roll('5+3').total, 8);
  assert.equal(roll('5+3').d20, null);
});

test('zero and negative totals allowed', () => {
  assert.equal(roll('1d4-10', rngFor(4, 2)).total, -8);
});

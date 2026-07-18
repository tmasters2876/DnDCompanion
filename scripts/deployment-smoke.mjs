// Non-destructive production smoke test by default. Set ALLOW_SMOKE_WRITES=1
// to exercise namespaced character/homebrew CRUD with exact cleanup.
import assert from 'node:assert/strict';

const base = String(process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!base) throw new Error('BASE_URL is required, for example http://10.0.1.50:15177');

const json = async (path, options) => {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  return { response, body };
};

const health = await json('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body.ready, true);
assert.ok(health.body.entries >= 100_000, `only ${health.body.entries} entries loaded`);
assert.equal(health.body.stateWritable, true);

const version = await json('/api/version');
assert.equal(version.response.status, 200);
if (process.env.EXPECTED_RELEASE) assert.equal(version.body.release, process.env.EXPECTED_RELEASE);
if (process.env.EXPECTED_DATA_DIGEST) assert.equal(version.body.dataDigest, process.env.EXPECTED_DATA_DIGEST);

const types = await json('/api/compendium/types');
assert.ok(types.body.monster > 10_000 && types.body.spell > 10_000);
const giant = await json('/api/compendium/monster/fire-giant');
assert.equal(giant.response.status, 200);
assert.ok(giant.body.data.ac > 0 && giant.body.data.hp.average > 0 && giant.body.data.actions.length > 0);
assert.equal((await fetch(`${base}/api/compendium/monster/the-vorga?edition=2014`)).status, 404);
const root = await fetch(`${base}/`);
assert.equal(root.status, 200);
assert.match(await root.text(), /<div id="root"><\/div>/);
assert.doesNotMatch(JSON.stringify({ health: health.body, version: version.body }), /\/Users\/|\/volume1\/|OPENAI|TOKEN|PASSWORD/i);

if (process.env.ALLOW_SMOKE_WRITES === '1') {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let characterId;
  const homebrewSlug = `deployment-smoke-${stamp}`;
  try {
    const character = await json('/api/characters', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Deployment Smoke ${stamp}`, classes: [{ class: 'fighter', level: 1 }] }),
    });
    assert.equal(character.response.status, 201);
    characterId = character.body.id;
    assert.equal((await json(`/api/characters/${characterId}`)).response.status, 200);

    const homebrew = await json('/api/homebrew', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'rule', slug: homebrewSlug, name: `Deployment Smoke ${stamp}`, text: 'Namespaced deployment verification.' }),
    });
    assert.equal(homebrew.response.status, 201);
    assert.equal((await json(`/api/compendium/rule/${homebrewSlug}`)).response.status, 200);
  } finally {
    if (characterId) await fetch(`${base}/api/characters/${characterId}`, { method: 'DELETE' });
    await fetch(`${base}/api/homebrew/rule/${homebrewSlug}`, { method: 'DELETE' });
  }
}

console.log(`Deployment smoke passed: ${health.body.entries} entries, release ${version.body.release}, ${version.body.dataDigest}`);

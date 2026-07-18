import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration tests against a real server process on a test port.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5178;
const API = `http://localhost:${PORT}/api`;
let proc;

before(async () => {
  proc = spawn('node', [join(ROOT, 'server', 'index.mjs')], {
    env: {
      ...process.env, PORT: String(PORT), APP_RELEASE: 'test-release',
      DATA_DIGEST: 'sha256:test-data', BUILD_DATE: '2026-07-18T00:00:00.000Z',
      EXPECTED_COMPENDIUM_MIN: '1',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${API}/compendium/types`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('server did not start');
});
after(() => proc?.kill());

const get = async (path) => {
  const r = await fetch(`${API}${path}`);
  return { status: r.status, body: await r.json() };
};

test('health and version identify a ready immutable deployment without leaking paths', async () => {
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.ready, true);
  assert.equal(health.body.release, 'test-release');
  assert.ok(health.body.entries > 100_000);
  assert.equal(health.body.stateWritable, true);

  const versionResponse = await fetch(`${API}/version`);
  assert.equal(versionResponse.headers.get('cache-control'), 'no-store');
  const version = await versionResponse.json();
  assert.deepEqual(version, {
    appVersion: '0.1.0', release: 'test-release', dataDigest: 'sha256:test-data',
    builtAt: '2026-07-18T00:00:00.000Z', campaignSchemaVersion: 1,
  });
  assert.doesNotMatch(JSON.stringify({ health: health.body, version }), /\/Users\/|\/volume1\/|OPENAI|TOKEN|PASSWORD/i);
});

test('types endpoint reports the full corpus', async () => {
  const { body } = await get('/compendium/types');
  assert.ok(body.spell >= 600 && body.monster >= 600 && body.class >= 24);
});

test('list endpoint: search, filters, pagination', async () => {
  const fireball = await get('/compendium/spell?q=fireball');
  assert.ok(fireball.body.results.some((r) => r.slug === 'fireball'));

  const evoc3 = await get('/compendium/spell?level=3&school=evocation');
  assert.ok(evoc3.body.results.every((r) => r.level === 3 && r.school === 'evocation'));
  assert.ok(evoc3.body.results.some((r) => r.slug === 'lightning-bolt'));

  const page = await get('/compendium/monster?limit=10&offset=5');
  assert.equal(page.body.results.length, 10);
  // default view dedupes 2014 entries shadowed by 2024 versions, so total < raw corpus
  assert.ok(page.body.total >= 300, `deduped total ${page.body.total}`);
  const all = await get('/compendium/monster?edition=2014');
  assert.ok(all.body.total >= 300);

  const cr = await get('/compendium/monster?cr=0.25');
  assert.ok(cr.body.results.length > 0);
  assert.ok(cr.body.results.every((r) => r.cr === 0.25));
});

test('edition layering: default resolves 2024, explicit 2014 works, legacy hidden by default', async () => {
  const def = await get('/compendium/spell/fireball');
  assert.equal(def.body.edition, '2024');
  assert.ok(def.body.otherEditions.some((e) => e.edition === '2014'));

  const legacy = await get('/compendium/spell/fireball?edition=2014');
  assert.equal(legacy.body.edition, '2014');

  const list = await get('/compendium/spell?q=fireball');
  const editions = list.body.results.filter((r) => r.slug === 'fireball').map((r) => r.edition);
  assert.deepEqual(editions, ['2024'], 'default list should hide shadowed legacy');

  const only2014 = await get('/compendium/spell?q=fireball&edition=2014');
  assert.ok(only2014.body.results.every((r) => r.edition === '2014'));
});

test('detail 404s cleanly', async () => {
  const { status } = await get('/compendium/spell/does-not-exist');
  assert.equal(status, 404);
});

test('statless imported mechanical shells are excluded from public browsing', async () => {
  assert.equal((await get('/compendium/monster/the-vorga?edition=2014')).status, 404);
  const { body } = await get('/compendium/monster?q=the%20vorga&edition=2014');
  assert.ok(!body.results.some((entry) => entry.slug === 'the-vorga'));
});

test('characters: full CRUD cycle with 404 handling', async () => {
  const created = await fetch(`${API}/characters`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'API Test', classes: [{ class: 'rogue', level: 1 }] }),
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const fetched = await get(`/characters/${id}`);
  assert.equal(fetched.body.name, 'API Test');

  const put = await fetch(`${API}/characters/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...fetched.body, name: 'Renamed' }),
  });
  assert.equal((await put.json()).name, 'Renamed');

  const list = await get('/characters');
  assert.ok(list.body.some((c) => c.id === id && c.name === 'Renamed'));

  const del = await fetch(`${API}/characters/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await get(`/characters/${id}`)).status, 404);
  assert.equal((await fetch(`${API}/characters/${id}`, { method: 'DELETE' })).status, 404);
});

test('homebrew: validation, create, immediate compendium presence, delete', async () => {
  const bad = await fetch(`${API}/homebrew`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'spell', slug: 'Bad Slug!', name: 'X' }),
  });
  assert.equal(bad.status, 400);

  const good = await fetch(`${API}/homebrew`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-dm-key': 'testkey-zap-0000-zap-000000000000' },
    body: JSON.stringify({
      type: 'spell', slug: 'test-zap', name: 'Test Zap', edition: '2024', tier: 'shared',
      data: { level: 1, school: 'evocation', classes: ['wizard'], damage: { dice: '2d8', type: 'lightning', scaling: {} }, components: { v: true, s: false, m: false } },
      text: 'Zap.',
    }),
  });
  assert.equal(good.status, 201);

  const inCompendium = await get('/compendium/spell/test-zap');
  assert.equal(inCompendium.status, 200);
  assert.equal(inCompendium.body.source.key, 'homebrew');

  const del = await fetch(`${API}/homebrew/spell/test-zap`, { method: 'DELETE', headers: { 'x-dm-key': 'testkey-zap-0000-zap-000000000000' } });
  assert.equal(del.status, 200);
  assert.equal((await get('/compendium/spell/test-zap')).status, 404);

  const traversal = await fetch(`${API}/homebrew/spell/..%2F..%2Fetc`, { method: 'DELETE' });
  assert.ok([400, 404].includes(traversal.status), 'path traversal rejected');
});

test('reload endpoint refreshes counts', async () => {
  const { body } = await get('/compendium/reload');
  assert.ok(body.reloaded);
  assert.ok(body.types.spell >= 600);
});

test('audit endpoint exposes importer gaps and boot dedupe metrics', async () => {
  const { status, body } = await get('/compendium/audit');
  assert.equal(status, 200);
  assert.ok(body.summary.filesScanned > 0);
  assert.ok(body.summary.copies.found >= body.summary.copies.resolved);
  assert.equal(typeof body.unsupportedByKey, 'object');
  assert.ok(body.dedupeAtBoot.rawIds > 0);
  assert.ok(body.dedupeAtBoot.excludedUnusable > 0);
  assert.ok(body.dedupeAtBoot.excludedByType.monster > 0);
  assert.ok(body.markdown?.summary.filesScanned > 0);
  assert.equal(body.markdown.sourceDirectory, 'data/pdfs');
  assert.doesNotMatch(JSON.stringify(body), /\/Users\/|sourceDirectory":"\//);
});

// ---- homebrew privacy tiers ----
const KEY_A = 'testkey-aaaa-1111-aaaa-111111111111';
const KEY_B = 'testkey-bbbb-2222-bbbb-222222222222';
// content-type only when a body exists — Fastify 400s an empty JSON body
const hb = (path, opts = {}, key) => fetch(`${API}${path}`, {
  ...opts,
  headers: {
    ...(opts.body ? { 'content-type': 'application/json' } : {}),
    ...(key ? { 'x-dm-key': key } : {}),
    ...(opts.headers ?? {}),
  },
});

test('private homebrew: owner-only visibility in list and compendium', async () => {
  const created = await hb('/homebrew', {
    method: 'POST',
    body: JSON.stringify({ type: 'spell', slug: 'tier-test-secret', name: 'Tier Test Secret', edition: '2024', tier: 'private', data: { level: 1, school: 'evocation', classes: [], components: { v: true, s: false, m: false } }, text: 'Secret.' }),
  }, KEY_A);
  assert.equal(created.status, 201);

  const anonList = await (await hb('/homebrew')).json();
  assert.ok(!anonList.some((e) => e.slug === 'tier-test-secret'), 'anonymous list must not include private entries');
  const strangerList = await (await hb('/homebrew', {}, KEY_B)).json();
  assert.ok(!strangerList.some((e) => e.slug === 'tier-test-secret'), 'other DMs must not see private entries');
  const ownerList = await (await hb('/homebrew', {}, KEY_A)).json();
  const mine = ownerList.find((e) => e.slug === 'tier-test-secret');
  assert.ok(mine?.mine, 'owner sees the entry flagged as theirs');
  assert.equal(mine.tier, 'private');

  const anonSearch = await (await hb('/compendium/spell?q=tier+test+secret')).json();
  assert.equal(anonSearch.results.length, 0, 'compendium search must hide private entries');
  const anonDetail = await hb('/compendium/spell/tier-test-secret');
  assert.equal(anonDetail.status, 404, 'compendium detail must 404 without the key');
  const ownerSearch = await (await hb('/compendium/spell?q=tier+test+secret', {}, KEY_A)).json();
  assert.equal(ownerSearch.results.length, 1, 'owner search must find the private entry');
});

test('tier moves are owner-only and unshare truly hides', async () => {
  const denied = await hb('/homebrew/spell/tier-test-secret/tier', { method: 'PUT', body: JSON.stringify({ tier: 'shared' }) }, KEY_B);
  assert.equal(denied.status, 403, `expected 403, got ${denied.status}: ${await denied.text()}`);

  const shared = await hb('/homebrew/spell/tier-test-secret/tier', { method: 'PUT', body: JSON.stringify({ tier: 'shared' }) }, KEY_A);
  assert.equal(shared.status, 200);
  const anonNow = await (await hb('/compendium/spell/tier-test-secret')).json();
  assert.equal(anonNow.slug, 'tier-test-secret', 'shared entry visible to everyone');

  const unshared = await hb('/homebrew/spell/tier-test-secret/tier', { method: 'PUT', body: JSON.stringify({ tier: 'private' }) }, KEY_A);
  assert.equal(unshared.status, 200);
  assert.equal((await hb('/compendium/spell/tier-test-secret')).status, 404, 'unshared entry hidden again');

  const strangerDelete = await hb('/homebrew/spell/tier-test-secret', { method: 'DELETE' }, KEY_B);
  assert.equal(strangerDelete.status, 403);
  const ownerDelete = await hb('/homebrew/spell/tier-test-secret', { method: 'DELETE' }, KEY_A);
  assert.equal(ownerDelete.status, 200);
});

test('homebrew writes are incremental, not full reloads', async () => {
  const t0 = Date.now();
  const res = await hb('/homebrew', {
    method: 'POST',
    body: JSON.stringify({ type: 'rule', slug: 'tier-test-speed', name: 'Tier Speed', tier: 'private', data: {}, text: 'speed probe' }),
  }, KEY_A);
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 201);
  assert.ok(elapsed < 3000, `homebrew POST took ${elapsed}ms — full-reload regression?`);
  const visible = await hb('/compendium/rule/tier-test-speed', {}, KEY_A);
  assert.equal(visible.status, 200, 'incrementally-added entry must be immediately searchable');
  await hb('/homebrew/rule/tier-test-speed', { method: 'DELETE' }, KEY_A);
  assert.equal((await hb('/compendium/rule/tier-test-speed', {}, KEY_A)).status, 404, 'incrementally-removed entry must vanish');
});

test('keyless saves are rejected; legacy entries stay frozen and visible', async () => {
  const keyless = await hb('/homebrew', {
    method: 'POST',
    body: JSON.stringify({ type: 'spell', slug: 'tier-test-keyless', name: 'Keyless', data: {}, text: '' }),
  });
  assert.equal(keyless.status, 400);

  // simulate a pre-tier legacy file via the filesystem (as upgrades encounter)
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const { join } = await import('node:path');
  const legacyPath = join(ROOT, 'data', 'homebrew', 'rule-tier-test-legacy.json');
  writeFileSync(legacyPath, JSON.stringify({ id: 'rule/tier-test-legacy/homebrew', type: 'rule', slug: 'tier-test-legacy', name: 'Tier Legacy', edition: '2024', source: { key: 'homebrew', name: 'Homebrew' }, data: {}, text: 'Legacy.' }));
  await hb('/compendium/reload');
  try {
    const anon = await (await hb('/homebrew')).json();
    const legacy = anon.find((e) => e.slug === 'tier-test-legacy');
    assert.ok(legacy?.legacy, 'legacy entry visible to everyone and flagged');
    const freeze = await hb('/homebrew/rule/tier-test-legacy/tier', { method: 'PUT', body: JSON.stringify({ tier: 'private' }) }, KEY_A);
    assert.equal(freeze.status, 403, 'legacy entries are frozen shared');
  } finally {
    unlinkSync(legacyPath);
    await hb('/compendium/reload');
  }
});

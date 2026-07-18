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
    env: { ...process.env, PORT: String(PORT) },
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

test('types endpoint reports the full corpus', async () => {
  const { body } = await get('/compendium/types');
  assert.ok(body.spell >= 600 && body.monster >= 600 && body.class === 24);
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
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'spell', slug: 'test-zap', name: 'Test Zap', edition: '2024',
      data: { level: 1, school: 'evocation', classes: ['wizard'], damage: { dice: '2d8', type: 'lightning', scaling: {} }, components: { v: true, s: false, m: false } },
      text: 'Zap.',
    }),
  });
  assert.equal(good.status, 201);

  const inCompendium = await get('/compendium/spell/test-zap');
  assert.equal(inCompendium.status, 200);
  assert.equal(inCompendium.body.source.key, 'homebrew');

  const del = await fetch(`${API}/homebrew/spell/test-zap`, { method: 'DELETE' });
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

// D&D Companion server: compendium API + character/homebrew file I/O + static app.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadCompendium, resolve, search, summarize } from './lib/compendium.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const CHARACTERS = join(DATA, 'characters');
const HOMEBREW = join(DATA, 'homebrew');
mkdirSync(CHARACTERS, { recursive: true });
mkdirSync(HOMEBREW, { recursive: true });

const app = Fastify({ logger: { level: 'warn' } });
let compendium = loadCompendium(DATA);
const slugPattern = /^[a-z0-9][a-z0-9-]*$/;

// ---------- compendium ----------
app.get('/api/compendium/types', () => {
  const types = {};
  for (const [type, list] of compendium.byType) types[type] = list.length;
  return types;
});

app.get('/api/compendium/audit', (req, reply) => {
  const report = join(DATA, 'sources', '_normalized', 'import-report.json');
  if (!existsSync(report)) return reply.code(404).send({ error: 'run npm run data:import to generate the coverage report' });
  return { ...JSON.parse(readFileSync(report, 'utf8')), dedupeAtBoot: compendium.dedupe };
});

app.get('/api/compendium/reload', () => {
  compendium = loadCompendium(DATA);
  const types = {};
  for (const [type, list] of compendium.byType) types[type] = list.length;
  return { reloaded: true, types };
});

app.get('/api/compendium/:type', (req) => {
  const list = search(compendium, req.params.type, req.query ?? {});
  const limit = Math.min(Number(req.query?.limit ?? 500), 50000);
  const offset = Number(req.query?.offset ?? 0);
  return {
    total: list.length,
    results: list.slice(offset, offset + limit).map(summarize),
  };
});

app.get('/api/compendium/:type/:slug', (req, reply) => {
  const entry = resolve(compendium, req.params.type, req.params.slug, req.query?.edition);
  if (!entry) return reply.code(404).send({ error: 'not found' });
  const siblings = (compendium.byType.get(req.params.type) ?? [])
    .filter((e) => e.slug === entry.slug && e.id !== entry.id)
    .map((e) => ({ id: e.id, edition: e.edition, source: e.source }));
  return { ...entry, otherEditions: siblings };
});

// ---------- characters ----------
const charPath = (id) => join(CHARACTERS, `${id}.json`);

app.get('/api/characters', () => readdirSync(CHARACTERS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const c = JSON.parse(readFileSync(join(CHARACTERS, f), 'utf8'));
    return { id: c.id, name: c.name ?? 'Unnamed', classes: c.classes ?? [], updatedAt: c.updatedAt ?? null };
  }));

app.post('/api/characters', (req, reply) => {
  const id = randomUUID();
  const character = { ...(req.body ?? {}), id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  writeFileSync(charPath(id), JSON.stringify(character, null, 1));
  return reply.code(201).send(character);
});

app.get('/api/characters/:id', (req, reply) => {
  if (!existsSync(charPath(req.params.id))) return reply.code(404).send({ error: 'not found' });
  return JSON.parse(readFileSync(charPath(req.params.id), 'utf8'));
});

app.put('/api/characters/:id', (req, reply) => {
  if (!existsSync(charPath(req.params.id))) return reply.code(404).send({ error: 'not found' });
  const character = { ...(req.body ?? {}), id: req.params.id, updatedAt: new Date().toISOString() };
  writeFileSync(charPath(req.params.id), JSON.stringify(character, null, 1));
  return character;
});

app.delete('/api/characters/:id', (req, reply) => {
  if (!existsSync(charPath(req.params.id))) return reply.code(404).send({ error: 'not found' });
  unlinkSync(charPath(req.params.id));
  return { deleted: req.params.id };
});

// ---------- homebrew ----------
// A homebrew entry is a full schema envelope; it joins the compendium on save.
app.get('/api/homebrew', () => readdirSync(HOMEBREW)
  .filter((f) => f.endsWith('.json'))
  .map((f) => summarize(JSON.parse(readFileSync(join(HOMEBREW, f), 'utf8')))));

app.post('/api/homebrew', (req, reply) => {
  const { type, slug, name } = req.body ?? {};
  if (!type || !slug || !name || !slugPattern.test(slug)) {
    return reply.code(400).send({ error: 'type, name, and kebab-case slug are required' });
  }
  const entry = {
    id: `${type}/${slug}/homebrew`,
    type, slug, name,
    edition: req.body.edition ?? '2024',
    source: { key: 'homebrew', name: 'Homebrew' },
    data: req.body.data ?? {},
    text: req.body.text ?? '',
  };
  writeFileSync(join(HOMEBREW, `${type}-${slug}.json`), JSON.stringify(entry, null, 1));
  compendium = loadCompendium(DATA);
  return reply.code(201).send(entry);
});

app.delete('/api/homebrew/:type/:slug', (req, reply) => {
  const { type, slug } = req.params;
  if (!slugPattern.test(slug) || !slugPattern.test(type)) return reply.code(400).send({ error: 'bad id' });
  const file = join(HOMEBREW, `${type}-${slug}.json`);
  if (!existsSync(file)) return reply.code(404).send({ error: 'not found' });
  unlinkSync(file);
  compendium = loadCompendium(DATA);
  return { deleted: `${type}/${slug}/homebrew` };
});

// ---------- static app (production build) ----------
const dist = join(ROOT, 'app', 'dist');
if (existsSync(dist)) {
  app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 5177);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  const total = [...compendium.byType.values()].reduce((n, l) => n + l.length, 0);
  console.log(`D&D Companion server on http://localhost:${port}  (${total} compendium entries)`);
});

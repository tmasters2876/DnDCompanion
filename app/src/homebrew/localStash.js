// Local-only homebrew: entries that never touch the server. Stored in this
// browser; export/import gives durability and device portability. Entries are
// full schema envelopes with source key "local" so cards render normally.
const KEY = 'dnd-companion.localstash.v1';
const SCHEMA_VERSION = 1;
export const MAX_STASH_FILE_BYTES = 2 * 1024 * 1024;

export function loadStash(storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch { return []; }
}

const persist = (entries, storage) => storage.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries }));

export function saveStashEntry(entry, storage = localStorage) {
  const entries = loadStash(storage);
  const envelope = {
    ...entry,
    id: `${entry.type}/${entry.slug}/local`,
    source: { key: 'local', name: 'This device' },
    tier: 'local',
  };
  const existing = entries.findIndex((e) => e.id === envelope.id);
  if (existing >= 0) entries[existing] = envelope; else entries.push(envelope);
  persist(entries, storage);
  return envelope;
}

export function removeStashEntry(id, storage = localStorage) {
  persist(loadStash(storage).filter((e) => e.id !== id), storage);
}

export function stashSearch(type, q, storage = localStorage) {
  const needle = (q ?? '').toLowerCase();
  return loadStash(storage)
    .filter((e) => e.type === type && (!needle || e.name.toLowerCase().includes(needle)))
    .map((e) => ({
      id: e.id, type: e.type, slug: e.slug, name: e.name, edition: e.edition,
      source: e.source, tier: 'local',
      ...(e.type === 'spell' ? { level: e.data?.level, school: e.data?.school, damage: e.data?.damage?.dice ?? null, damageType: e.data?.damage?.type ?? null } : {}),
      ...(e.type === 'monster' ? { cr: e.data?.cr, size: e.data?.size, creatureType: e.data?.creatureType } : {}),
    }));
}

export function stashResolve(type, slug, storage = localStorage) {
  return loadStash(storage).find((e) => e.type === type && e.slug === slug) ?? null;
}

export function exportStashDocument(storage = localStorage) {
  return { app: 'dnd-companion-local-stash', schemaVersion: SCHEMA_VERSION, exportedAt: null, entries: loadStash(storage) };
}

export function importStashDocument(text, storage = localStorage) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (parsed?.app !== 'dnd-companion-local-stash') throw new Error('That file is not a local-stash export.');
  if (parsed.schemaVersion > SCHEMA_VERSION) throw new Error('That stash was exported by a newer version of the app.');
  if (!Array.isArray(parsed.entries)) throw new Error('That stash file has no entries.');
  for (const entry of parsed.entries) {
    if (!entry?.type || !entry?.slug || !entry?.name) throw new Error('That stash file contains a malformed entry.');
  }
  const current = loadStash(storage);
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const entry of parsed.entries) byId.set(`${entry.type}/${entry.slug}/local`, { ...entry, id: `${entry.type}/${entry.slug}/local`, tier: 'local', source: { key: 'local', name: 'This device' } });
  persist([...byId.values()], storage);
  return parsed.entries.length;
}

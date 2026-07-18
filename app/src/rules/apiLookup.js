// API-backed lookup for the rules engine: prefetches every compendium entry a
// character references, then serves them synchronously to derive().

const cache = new Map(); // "type/slug" -> entry

async function fetchEntry(type, slug) {
  const key = `${type}/${slug}`;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`/api/compendium/${type}/${slug}`);
  const entry = res.ok ? await res.json() : null;
  cache.set(key, entry);
  return entry;
}

export async function lookupFor(character) {
  const wanted = [];
  for (const c of character.classes ?? []) {
    wanted.push(['class', c.class]);
    if (c.subclass) wanted.push(['subclass', c.subclass]);
  }
  if (character.species) wanted.push(['species', character.species]);
  if (character.background) wanted.push(['background', character.background]);
  for (const f of character.feats ?? []) wanted.push(['feat', f]);
  for (const e of character.equipment ?? []) wanted.push(['item', e.item]);
  for (const s of [...(character.spells?.known ?? []), ...(character.spells?.prepared ?? [])]) {
    wanted.push(['spell', s]);
  }
  await Promise.all(wanted.map(([t, s]) => fetchEntry(t, s)));
  return {
    get: (type, slug) => cache.get(`${type}/${slug}`) ?? null,
    fetch: fetchEntry,
  };
}

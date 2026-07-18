// Loads and merges the compendium: data/srd/ (shipped), data/sources/_normalized/
// (user imports), data/homebrew/ (app-created). Later layers win on id conflict.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SUMMARY_FIELDS = {
  spell: (d) => ({ level: d.level, school: d.school, concentration: d.concentration, ritual: d.ritual, classes: d.classes, damage: d.damage?.dice ?? null, damageType: d.damage?.type ?? null }),
  monster: (d) => ({ cr: d.cr, size: d.size, creatureType: d.creatureType, partial: !!d.partial }),
  item: (d) => ({ itemType: d.itemType, rarity: d.rarity, attunement: d.attunement, partial: !!d.partial }),
  feat: (d) => ({ category: d.category, prerequisite: d.prerequisite }),
  class: (d) => ({ hitDie: d.hitDie, partial: !!d.partial }),
  subclass: (d) => ({ class: d.class }),
  feature: (d) => ({ class: d.class, subclass: d.subclass, level: d.level }),
  species: (d) => ({ partial: !!d.partial }),
  background: (d) => ({ partial: !!d.partial }),
  condition: () => ({}),
  rule: (d) => ({ category: d.category }),
  table: (d) => ({ dice: d.dice, columns: d.columns?.length ?? 0 }),
  adventure: (d) => ({ level: d.level, published: d.published }),
  book: (d) => ({ author: d.author, published: d.published }),
  language: (d) => ({ category: d.category }),
  disease: (d) => ({ category: d.category }),
  deity: (d) => ({ category: d.category }),
  reward: (d) => ({ category: d.category }),
  recipe: (d) => ({ category: d.category }),
};

// Duplicate resolution: when the same (type, slug, edition) exists in several
// sources, keep the one closest to official material.
const OFFICIAL_CODES = new Set([
  'phb', 'xphb', 'dmg', 'xdmg', 'mm', 'xmm', 'tce', 'xge', 'scag', 'vgm', 'vgtm',
  'mtf', 'mtof', 'mpmm', 'ftd', 'erlw', 'egw', 'ggr', 'ai', 'scc', 'bgg', 'sais',
  'tftyp', 'cos', 'oota', 'skt', 'toa', 'wdh', 'gos', 'idrotf', 'wbtw', 'bmt', 'dosi',
]);
const OPEN_PACKS = new Set(['tob2023', 'tob2', 'tob3', 'ccdx', 'a5emm', 'bfrd', 'deepm', 'deepmx']);
const SOURCE_ALIASES = new Map([['vgtm', 'vgm'], ['mtof', 'mtf'], ['xphb2024', 'xphb'], ['xdmg2024', 'xdmg'], ['xmm2024', 'xmm']]);
const canonicalSource = (key) => SOURCE_ALIASES.get(key) ?? key;
export const sourceRank = (key) =>
  canonicalSource(key) === 'srd52' ? 0
  : canonicalSource(key) === 'srd51' ? 1
  : OFFICIAL_CODES.has(canonicalSource(key)) ? 2
  : OPEN_PACKS.has(canonicalSource(key)) ? 3
  : canonicalSource(key) === 'homebrew' ? 5
  : 4;

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== 'lore' && key !== 'identity').map((key) => [key, stable(value[key])]));
  return value;
};
const fingerprint = (entry) => createHash('sha256').update(JSON.stringify({ type: entry.type, edition: entry.edition, data: stable(entry.data), text: entry.text.trim().replace(/\s+/g, ' ') })).digest('hex').slice(0, 20);
const identitySlugs = (entry) => new Set([
  entry.slug,
  ...(entry.data?.identity?.aliases ?? []).map((name) => String(name).split('|')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
  ...(entry.data?.identity?.reprints ?? []).map((name) => String(name).split('|')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
].filter(Boolean));

export function loadCompendium(dataDir) {
  const byId = new Map();
  const layers = [
    join(dataDir, 'srd'),
    join(dataDir, 'sources', '_normalized'),
  ];
  for (const dir of layers) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (!Array.isArray(parsed)) continue; // import-report.json and future metadata files
      for (const entry of parsed) {
        byId.set(entry.id, entry);
      }
    }
  }
  const homebrewDir = join(dataDir, 'homebrew');
  if (existsSync(homebrewDir)) {
    for (const file of readdirSync(homebrewDir).filter((f) => f.endsWith('.json'))) {
      const entry = JSON.parse(readFileSync(join(homebrewDir, file), 'utf8'));
      byId.set(entry.id, entry);
    }
  }

  // Collapse duplicates: best source per (type, slug, edition).
  const winners = new Map();
  let identityDuplicates = 0;
  for (const entry of byId.values()) {
    const key = `${entry.type}/${entry.slug}/${entry.edition}`;
    const cur = winners.get(key);
    if (cur) identityDuplicates++;
    if (!cur || sourceRank(entry.source.key) < sourceRank(cur.source.key)) winners.set(key, entry);
  }

  // A second, conservative pass catches explicit aliases/reprints with identical
  // normalized structure. Different names are never collapsed on shape alone.
  const structural = new Map();
  let structuralDuplicates = 0;
  for (const [winnerKey, entry] of winners) {
    const key = `${entry.type}/${entry.edition}/${fingerprint(entry)}`;
    const cur = structural.get(key);
    const overlaps = cur && [...identitySlugs(entry)].some((slug) => identitySlugs(cur.entry).has(slug));
    if (!cur || !overlaps) structural.set(cur && !overlaps ? `${key}/${winnerKey}` : key, { winnerKey, entry });
    else {
      structuralDuplicates++;
      if (sourceRank(entry.source.key) < sourceRank(cur.entry.source.key)) structural.set(key, { winnerKey, entry });
    }
  }

  const byType = new Map();
  for (const { entry } of structural.values()) {
    if (!byType.has(entry.type)) byType.set(entry.type, []);
    byType.get(entry.type).push(entry);
  }
  for (const list of byType.values()) list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return { byId, byType, dedupe: { rawIds: byId.size, identityDuplicates, structuralDuplicates } };
}

// Edition layering: same (type, slug) in both editions resolves to 2024 unless
// edition is requested explicitly.
export function resolve(compendium, type, slug, edition) {
  const matches = (compendium.byType.get(type) ?? []).filter((e) => e.slug === slug);
  if (!matches.length) return null;
  if (edition) return matches.find((e) => e.edition === edition) ?? null;
  return matches.find((e) => e.edition === '2024') ?? matches[0];
}

export function search(compendium, type, query) {
  let list = compendium.byType.get(type) ?? [];
  const { q, edition, source, level, school, cr, itemType, category, class: cls, fullText } = query;

  if (edition) list = list.filter((e) => e.edition === edition);
  else {
    // Default view: legacy entries hidden when a 2024 entry with the same slug exists.
    const slugs2024 = new Set(list.filter((e) => e.edition === '2024').map((e) => e.slug));
    list = list.filter((e) => e.edition === '2024' || !slugs2024.has(e.slug));
  }
  if (source) list = list.filter((e) => e.source.key === source);
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(needle)
      || (fullText === 'true' && e.text.toLowerCase().includes(needle)));
  }
  if (level != null) list = list.filter((e) => e.data.level === Number(level));
  if (school) list = list.filter((e) => e.data.school === school);
  if (cr != null) list = list.filter((e) => e.data.cr === Number(cr));
  if (itemType) list = list.filter((e) => e.data.itemType === itemType);
  if (category) list = list.filter((e) => e.data.category === category);
  if (cls) list = list.filter((e) => (e.data.classes ?? []).includes(cls) || e.data.class === cls);
  return list;
}

export function summarize(entry) {
  return {
    id: entry.id,
    type: entry.type,
    slug: entry.slug,
    name: entry.name,
    edition: entry.edition,
    source: entry.source,
    ...(SUMMARY_FIELDS[entry.type]?.(entry.data) ?? {}),
  };
}

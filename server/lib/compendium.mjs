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

// Duplicate resolution. Ordinary source conflicts keep one record intact; the
// user's local Markdown is the only layer eligible for field-level enrichment.
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
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => !['lore', 'identity', 'provenance', 'markdownFile', 'headingPath', 'contentHash', 'parserVersion'].includes(key)).map((key) => [key, stable(value[key])]));
  return value;
};
const fingerprint = (entry) => createHash('sha256').update(JSON.stringify({ type: entry.type, edition: entry.edition, data: stable(entry.data), text: entry.text.trim().replace(/\s+/g, ' ') })).digest('hex').slice(0, 20);
const identitySlugs = (entry) => new Set([
  entry.slug,
  ...(entry.data?.identity?.aliases ?? []).map((name) => String(name).split('|')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
  ...(entry.data?.identity?.reprints ?? []).map((name) => String(name).split('|')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
].filter(Boolean));

const isMissing = (value) => value == null || value === '' || (Array.isArray(value) && value.length === 0);
const structuredScore = (value, depth = 0) => {
  if (isMissing(value)) return 0;
  if (typeof value !== 'object') return 1;
  if (depth > 4) return 0;
  if (Array.isArray(value)) return Math.min(20, value.reduce((sum, item) => sum + structuredScore(item, depth + 1), 0));
  return Object.entries(value)
    .filter(([key]) => !['identity', 'lore', 'provenance'].includes(key))
    .reduce((sum, [, child]) => sum + structuredScore(child, depth + 1), 0);
};

export function entryQuality(entry) {
  const textScore = Math.min(20, Math.sqrt((entry.text ?? '').trim().length) / 5);
  const dataScore = structuredScore(entry.data) * 2;
  const required = {
    spell: ['level', 'school', 'castingTime', 'range', 'components', 'duration'],
    monster: ['ac', 'hp', 'speed', 'abilities', 'cr', 'actions'],
    class: ['hitDie', 'saves', 'proficiencies', 'levels'],
    species: ['size', 'speed', 'traits'],
    background: ['abilityScores', 'skills', 'equipment'],
    item: ['itemType'],
  }[entry.type] ?? [];
  const completeness = required.filter((field) => !isMissing(entry.data?.[field])).length * 8;
  return dataScore + textScore + completeness - (entry.data?.partial ? 20 : 0);
}

function mergeAbsent(primary, secondary) {
  if (Array.isArray(primary) || Array.isArray(secondary) || !primary || !secondary || typeof primary !== 'object' || typeof secondary !== 'object') return primary;
  const merged = structuredClone(primary);
  for (const [key, value] of Object.entries(secondary)) {
    if (key === 'partial') continue; // completeness belongs to the winning record only
    if (!Object.hasOwn(merged, key)) merged[key] = structuredClone(value);
    else if (merged[key] && value && !Array.isArray(merged[key]) && !Array.isArray(value)
      && typeof merged[key] === 'object' && typeof value === 'object') merged[key] = mergeAbsent(merged[key], value);
  }
  return merged;
}

function requiredCoverage(entry) {
  const required = {
    spell: ['level', 'school', 'castingTime', 'range', 'components', 'duration'],
    monster: ['ac', 'hp', 'speed', 'abilities', 'cr', 'actions'],
    class: ['hitDie', 'saves', 'proficiencies', 'levels'],
    species: ['size', 'speed', 'traits'],
    background: ['abilityScores', 'skills', 'equipment'],
    item: ['itemType'],
  }[entry.type] ?? [];
  return required.filter((field) => !isMissing(entry.data?.[field])).length;
}

function jsonMateriallyDominates(personal, json) {
  if (json.data?.partial) return false;
  const personalStructure = structuredScore(personal.data);
  const jsonStructure = structuredScore(json.data);
  const personalText = (personal.text ?? '').trim().length;
  const jsonText = (json.text ?? '').trim().length;
  return requiredCoverage(json) >= requiredCoverage(personal)
    && jsonStructure >= Math.max(personalStructure + 2, personalStructure * 1.25)
    && jsonText >= personalText * 0.9;
}

export function choosePreferred(a, b) {
  const aPersonal = a.source?.key === 'personal-md';
  const bPersonal = b.source?.key === 'personal-md';
  let primary;
  if (aPersonal !== bPersonal) {
    const personal = aPersonal ? a : b;
    const json = aPersonal ? b : a;
    // Markdown wins every tie. JSON leads only when it is demonstrably more
    // complete in mechanics and narrative, rather than merely more verbose data.
    primary = jsonMateriallyDominates(personal, json) ? json : personal;
  } else {
    const rankDelta = sourceRank(a.source.key) - sourceRank(b.source.key);
    primary = rankDelta < 0 ? a : rankDelta > 0 ? b : entryQuality(a) >= entryQuality(b) ? a : b;
  }
  const secondary = primary === a ? b : a;
  const hasPersonal = aPersonal || bPersonal;
  const personal = aPersonal ? a : bPersonal ? b : null;
  const richerText = hasPersonal && (personal.text ?? '').trim().length >= (primary.text ?? '').trim().length
    ? personal.text : primary.text;
  return {
    ...primary,
    text: richerText,
    data: {
      ...(hasPersonal ? mergeAbsent(primary.data ?? {}, secondary.data ?? {}) : primary.data),
      provenance: [...new Set([primary.source?.key, secondary.source?.key, ...(primary.data?.provenance ?? []), ...(secondary.data?.provenance ?? [])].filter(Boolean))],
    },
  };
}

const hasText = (entry) => (entry.text ?? '').trim().length >= 10;
const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const hasMeaningfulData = (data) => Object.entries(data ?? {}).some(([key, value]) => {
  if (['partial', 'provenance', 'identity', 'lore', 'markdownFile', 'headingPath', 'contentHash', 'parserVersion'].includes(key)) return false;
  if (value == null || value === '' || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some((child) => child != null && child !== '' && child !== false && (!Array.isArray(child) || child.length));
  return true;
});

// The public compendium is an at-the-table tool, not a raw-source browser. Keep
// locally created homebrew, but suppress imported shells that cannot render a
// useful card or drive the mechanics expected for their type.
export function isUsableEntry(entry) {
  if (!entry?.type || !entry?.name || entry.source?.key === 'homebrew') return !!entry?.type && !!entry?.name;
  const d = entry.data ?? {};
  if (entry.type === 'monster') {
    return hasNumber(d.ac)
      && (hasNumber(d.hp?.average) || !!d.hp?.formula)
      && ['str', 'dex', 'con', 'int', 'wis', 'cha'].every((ability) => hasNumber(d.abilities?.[ability]))
      && (hasText(entry) || ['traits', 'actions', 'bonusActions', 'reactions', 'legendary'].some((group) => d[group]?.length));
  }
  if (entry.type === 'spell') {
    return hasNumber(d.level) && !!d.school && !!d.castingTime && !!d.range
      && !!d.components && !!d.duration && hasText(entry);
  }
  if (entry.type === 'class') return hasNumber(d.hitDie) && d.levels?.length === 20;
  if (entry.type === 'subclass') return !!d.class && (d.levels?.length > 0 || hasText(entry));
  if (entry.type === 'species') return !!d.size && hasNumber(d.speed) && d.traits?.length > 0;
  if (entry.type === 'background') return hasText(entry) || d.skills?.length > 0 || !!d.feature || !!d.equipment;
  if (entry.type === 'item') return hasText(entry) || !!d.weapon?.damage || hasNumber(d.armor?.ac);
  if (entry.type === 'object') return hasText(entry)
    || (hasNumber(d.properties?.ac) && hasNumber(d.properties?.hp));
  if (entry.type === 'vehicle') return hasText(entry)
    || (hasNumber(d.properties?.ac) && hasNumber(d.properties?.hp));
  if (entry.type === 'legendary-group' || entry.type === 'card') return hasText(entry);
  if (entry.type === 'feature' || entry.type === 'rule') return hasText(entry);
  if (entry.type === 'table') return d.columns?.length > 1 && d.rows?.length > 0;
  if (entry.type === 'book' || entry.type === 'adventure') return hasText(entry) || d.sections?.some((section) => section.text?.trim());
  return hasText(entry) || hasMeaningfulData(d);
}

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
    if (!cur) winners.set(key, entry);
    else winners.set(key, choosePreferred(cur, entry));
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
      structural.set(key, { winnerKey, entry: choosePreferred(cur.entry, entry) });
    }
  }

  const byType = new Map();
  const excludedByType = {};
  const usableAlternatives = new Map();
  for (const candidate of byId.values()) {
    if (!isUsableEntry(candidate)) continue;
    const identity = `${candidate.type}/${candidate.slug}/${candidate.edition}`;
    if (!usableAlternatives.has(identity)) usableAlternatives.set(identity, []);
    usableAlternatives.get(identity).push(candidate);
  }
  let replacedUnusable = 0;
  for (const { entry: winner } of structural.values()) {
    let entry = winner;
    if (!isUsableEntry(entry)) {
      const alternatives = usableAlternatives.get(`${entry.type}/${entry.slug}/${entry.edition}`) ?? [];
      if (alternatives.length) {
        entry = alternatives.slice(1).reduce((best, candidate) => choosePreferred(best, candidate), alternatives[0]);
        replacedUnusable++;
      } else {
        excludedByType[entry.type] = (excludedByType[entry.type] ?? 0) + 1;
        continue;
      }
    }
    if (!byType.has(entry.type)) byType.set(entry.type, []);
    byType.get(entry.type).push(entry);
  }
  for (const list of byType.values()) list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return { byId, byType, dedupe: { rawIds: byId.size, identityDuplicates, structuralDuplicates, replacedUnusable, excludedUnusable: Object.values(excludedByType).reduce((sum, count) => sum + count, 0), excludedByType } };
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
    provenance: entry.data?.provenance ?? [entry.source?.key].filter(Boolean),
    ...(SUMMARY_FIELDS[entry.type]?.(entry.data) ?? {}),
  };
}

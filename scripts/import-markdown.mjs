// Imports the user's manually curated Markdown collection from data/pdfs/.
// Files stay local/gitignored; normalized records join the same internal schema.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { choosePreferred, entryQuality } from '../server/lib/compendium.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.DND_MARKDOWN_DIR || join(ROOT, 'data', 'pdfs');
const OUT = process.env.DND_OUTPUT_DIR || join(ROOT, 'data', 'sources', '_normalized');
const BASELINE = process.env.DND_BASELINE_DIR || join(ROOT, 'data', 'srd');
const SOURCE = { key: 'personal-md', name: 'Personal Markdown Collection' };
const EDITION = '2024';
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SIZE = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const slugify = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleText = (value) => String(value ?? '').replace(/<[^>]+>/g, '').replace(/[*_`]/g, '').trim();
const abilitySlug = (value) => slugify(value).slice(0, 3);
const number = (value) => Number(String(value ?? '').replace(/,/g, '').replace(/−/g, '-').match(/-?\d+(?:\.\d+)?/)?.[0]) || null;
const fraction = (value) => {
  const raw = String(value ?? '').trim();
  if (raw.includes('/')) return Number(raw.split('/')[0]) / Number(raw.split('/')[1]);
  return Number(raw) || 0;
};
const groupBy = (values, keyFor) => {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return grouped;
};

function decode(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\uFEFF/g, '');
}

function parseHtmlTables(markdown) {
  const tables = [];
  for (const match of String(markdown).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [];
    for (const rowMatch of match[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => decode(cell[1]).replace(/<br\s*\/?\s*>/gi, ' / ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push({ raw: match[0], rows });
  }
  return tables;
}

function cleanMarkdown(markdown) {
  let text = decode(markdown);
  for (const table of parseHtmlTables(text)) {
    const width = Math.max(...table.rows.map((row) => row.length));
    const normalized = table.rows.filter((row) => row.length === width);
    const rendered = normalized.length ? [
      `| ${normalized[0].join(' | ')} |`,
      `| ${normalized[0].map(() => '---').join(' | ')} |`,
      ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ].join('\n') : '';
    text = text.replace(table.raw, rendered);
  }
  return text
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<hr\s*\/?\s*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^•\s*/gm, '- ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sections(markdown) {
  const headings = [...String(markdown).matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length, title: titleText(match[2]), start: match.index, bodyStart: match.index + match[0].length,
  }));
  const stack = [];
  return headings.map((heading, index) => {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const parents = stack.map((entry) => entry.title);
    stack.push(heading);
    let end = markdown.length;
    for (let next = index + 1; next < headings.length; next++) {
      if (headings[next].level <= heading.level) { end = headings[next].start; break; }
    }
    return { ...heading, parents, raw: markdown.slice(heading.bodyStart, end).trim() };
  });
}

const out = new Map();
const origins = new Map();
function put(type, name, data, textValue, file, options = {}) {
  const slug = options.slug ?? slugify(name);
  if (!slug || !name) return;
  const text = cleanMarkdown(textValue);
  const entry = {
    id: `${type}/${slug}/${SOURCE.key}`, type, slug, name: titleText(name), edition: EDITION,
    source: SOURCE,
    data: {
      ...data,
      provenance: [SOURCE.key],
      markdownFile: basename(file),
      headingPath: options.headingPath ?? [],
      contentHash: createHash('sha256').update(text).digest('hex').slice(0, 20),
      parserVersion: 1,
    },
    text,
  };
  const key = entry.id;
  out.set(key, out.has(key) ? choosePreferred(out.get(key), entry) : entry);
  origins.set(key, [...(origins.get(key) ?? []), basename(file)]);
}

function field(raw, label) {
  return decode(new RegExp(`\\*\\*${label}:?\\*\\*\\s*([^<\\n]+)`, 'i').exec(raw)?.[1] ?? '').trim() || null;
}
function listField(raw, label) {
  return String(field(raw, label) ?? '').split(/,|;/).map((value) => slugify(value.replace(/[+−-]?\d+.*$/, ''))).filter(Boolean);
}
function parseCost(raw) {
  const match = String(raw ?? '').replace(/,/g, '').match(/([\d.]+)\s*(CP|SP|EP|GP|PP)/i);
  return match ? { qty: Number(match[1]), unit: match[2].toLowerCase() } : null;
}
function parseSpeed(raw) {
  const speed = { walk: null, fly: null, swim: null, climb: null, burrow: null, hover: false };
  const source = String(raw ?? '');
  speed.walk = number(source.match(/(?:^|,\s*)(\d+)\s*ft/i)?.[1]);
  for (const key of ['fly', 'swim', 'climb', 'burrow']) speed[key] = number(source.match(new RegExp(`${key}\\s+(\\d+)`, 'i'))?.[1]);
  speed.hover = /hover/i.test(source);
  return speed;
}

function actionGroups(raw) {
  const groups = { traits: [], actions: [], bonusActions: [], reactions: [], legendary: [] };
  const markers = [...String(raw).matchAll(/^#{3,5}\s+(Traits|Actions|Bonus Actions|Reactions|Legendary Actions)\s*$/gmi)];
  for (let index = 0; index < markers.length; index++) {
    const label = markers[index][1].toLowerCase();
    const key = label === 'traits' ? 'traits' : label === 'actions' ? 'actions' : label === 'bonus actions' ? 'bonusActions' : label === 'reactions' ? 'reactions' : 'legendary';
    const body = raw.slice(markers[index].index + markers[index][0].length, markers[index + 1]?.index ?? raw.length);
    const entries = [...body.matchAll(/\*\*_(.+?)\._\*\*\s*([\s\S]*?)(?=\n\s*\*\*_.*?\._\*\*|$)/g)];
    for (const match of entries) {
      const text = cleanMarkdown(match[2]);
      const hit = /(?:Attack Roll:|to hit:)\s*\+?(\d+)/i.exec(text);
      const damage = [...text.matchAll(/\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)\s+(\w+)\s+damage/gi)]
        .map((value) => ({ dice: value[1].replace(/\s/g, '').replace('−', '-'), type: value[2].toLowerCase() }));
      groups[key].push({ name: match[1], text, ...(hit ? { attack: { bonus: Number(hit[1]), reach: null, range: null, damage } } : {}) });
    }
  }
  return groups;
}

function importSpells(file, markdown) {
  for (const section of sections(markdown).filter((entry) => entry.level === 4)) {
    const meta = /^\s*_((?:Level\s+(\d+)\s+([A-Za-z]+))|(?:([A-Za-z]+)\s+Cantrip))\s*\(([^)]+)\)_/m.exec(section.raw);
    if (!meta) continue;
    const castingTime = field(section.raw, 'Casting Time');
    const componentsRaw = field(section.raw, 'Components') ?? '';
    const duration = field(section.raw, 'Duration');
    const text = cleanMarkdown(section.raw);
    const damage = /(\d+d\d+(?:\s*[+−-]\s*\d+)?)\s+(\w+)\s+damage/i.exec(text);
    put('spell', section.title, {
      level: meta[2] ? Number(meta[2]) : 0,
      school: String(meta[3] ?? meta[4]).toLowerCase(), castingTime,
      range: field(section.raw, 'Range'),
      components: { v: /\bV\b/.test(componentsRaw), s: /\bS\b/.test(componentsRaw), m: /\bM\b/.test(componentsRaw), materialText: /M\s*\(([^)]+)\)/.exec(componentsRaw)?.[1] ?? null },
      duration, concentration: /concentration/i.test(duration ?? ''), ritual: /ritual/i.test(castingTime ?? ''),
      classes: meta[5].split(',').map(slugify).filter(Boolean),
      damage: damage ? { dice: damage[1].replace(/\s/g, '').replace('−', '-'), type: damage[2].toLowerCase(), scaling: {} } : null,
      attackType: /melee spell attack/i.test(text) ? 'melee' : /ranged spell attack/i.test(text) ? 'ranged' : null,
      save: /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(text)?.[1].slice(0, 3).toLowerCase() ?? null,
    }, section.raw, file, { headingPath: [...section.parents, section.title] });
  }
}

function parseAbilities(raw) {
  const abilities = {};
  const saves = {};
  for (const table of parseHtmlTables(raw)) {
    for (const row of table.rows) {
      for (let index = 0; index <= row.length - 4; index += 4) {
        const ability = row[index]?.toLowerCase();
        if (!ABILITIES.includes(ability)) continue;
        abilities[ability] = number(row[index + 1]) ?? 10;
        const base = Math.floor((abilities[ability] - 10) / 2);
        const save = number(row[index + 3]);
        if (save != null && save !== base) saves[ability] = save;
      }
    }
  }
  return { abilities, saves };
}

function importMonsters(file, markdown) {
  for (const section of sections(markdown).filter((entry) => [2, 3, 4].includes(entry.level))) {
    const meta = new RegExp(`^\\s*_(${SIZE.join('|')})(?:\\s+or\\s+(${SIZE.join('|')}))?\\s+(.+?),\\s*([^_\\n]+)_`, 'i').exec(section.raw);
    if (!meta || !field(section.raw, 'AC') || !field(section.raw, 'HP')) continue;
    const { abilities, saves } = parseAbilities(section.raw);
    if (Object.keys(abilities).length !== 6) continue;
    const hpRaw = field(section.raw, 'HP') ?? '';
    const acRaw = field(section.raw, 'AC') ?? '';
    const crRaw = field(section.raw, 'CR') ?? '0';
    const groups = actionGroups(section.raw);
    const immunityParts = String(field(section.raw, 'Immunities') ?? '').split(/,|;/).map((value) => slugify(value)).filter(Boolean);
    const conditions = new Set(['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious']);
    put('monster', section.title, {
      size: meta[1], ...(meta[2] ? { sizeOptions: [meta[1], meta[2]] } : {}),
      creatureType: meta[3].replace(/\s*\([^)]*\)\s*$/, '').toLowerCase(), alignment: meta[4],
      ac: number(acRaw), acNote: acRaw.replace(/^.*?\d+\s*/, '').replace(/\*\*.*$/, '').trim() || null,
      hp: { average: number(hpRaw), formula: /\(([^)]+)\)/.exec(hpRaw)?.[1]?.replace(/\s/g, '') ?? null },
      speed: parseSpeed(field(section.raw, 'Speed')), abilities, saves,
      skills: Object.fromEntries(String(field(section.raw, 'Skills') ?? '').split(',').map((part) => [slugify(part.replace(/[+−-]?\d+.*$/, '')), number(part)]).filter(([key, value]) => key && value != null)),
      senses: field(section.raw, 'Senses') ?? '', languages: field(section.raw, 'Languages') ?? '', cr: fraction(crRaw.match(/[\d/]+/)?.[0]),
      xp: number(/XP\s+([\d,]+)/i.exec(crRaw)?.[1]),
      vulnerabilities: listField(section.raw, 'Vulnerabilities'), resistances: listField(section.raw, 'Resistances'),
      immunities: immunityParts.filter((value) => !conditions.has(value)), conditionImmunities: immunityParts.filter((value) => conditions.has(value)),
      ...groups,
    }, section.raw, file, { headingPath: [...section.parents, section.title] });
  }
}

function importFeats(file, markdown) {
  for (const section of sections(markdown).filter((entry) => entry.level === 4 && /Feats$/.test(entry.parents.at(-1) ?? ''))) {
    const meta = /^\s*_([^_\n]+Feat[^_\n]*)_/m.exec(section.raw)?.[1] ?? '';
    put('feat', section.title, {
      category: /origin/i.test(meta) ? 'origin' : /fighting style/i.test(meta) ? 'fighting-style' : /epic/i.test(meta) ? 'epic' : 'general',
      prerequisite: /Prerequisite:\s*([^\n]+)/i.exec(section.raw)?.[1] ?? null,
      abilityIncrease: [], repeatable: /_Repeatable\._/i.test(section.raw),
    }, section.raw, file, { headingPath: [...section.parents, section.title] });
  }
}

function importOrigins(file, markdown) {
  for (const section of sections(markdown).filter((entry) => entry.level === 4)) {
    if (section.parents.includes('Background Descriptions')) {
      put('background', section.title, {
        abilityScores: String(field(section.raw, 'Ability Scores') ?? '').toLowerCase().match(/strength|dexterity|constitution|intelligence|wisdom|charisma/g)?.map(abilitySlug) ?? [],
        feat: slugify(field(section.raw, 'Feat')?.split('(')[0]), skills: listField(section.raw, 'Skill Proficiencies'),
        tools: listField(section.raw, 'Tool Proficiency'), equipment: field(section.raw, 'Equipment'), feature: null,
      }, section.raw, file, { headingPath: [...section.parents, section.title] });
    } else if (section.parents.includes('Species Descriptions')) {
      const speed = number(/(?:Walking\s+)?Speed[^\d]*(\d+)/i.exec(section.raw)?.[1]) ?? 30;
      const traitMatches = [...section.raw.matchAll(/^(?:\*\*|_)([^*_\n]+)\.(?:\*\*|_)\s*([\s\S]*?)(?=\n(?:\*\*|_)[^*_\n]+\.(?:\*\*|_)|$)/gm)];
      put('species', section.title, {
        size: SIZE.find((size) => new RegExp(`\\b${size}\\b`, 'i').test(field(section.raw, 'Size') ?? section.raw)) ?? 'Medium', speed,
        traits: traitMatches.map((match) => ({ name: match[1], text: cleanMarkdown(match[2]) })), subspecies: [],
        darkvision: number(/Darkvision[^\d]*(\d+)\s*(?:feet|ft)/i.exec(section.raw)?.[1]), abilityBonuses: [], languages: [], resistances: [], innateSpells: [],
      }, section.raw, file, { headingPath: [...section.parents, section.title] });
    }
  }
}

function tableLookup(table, label) {
  return table?.rows.find((row) => row[0]?.toLowerCase() === label.toLowerCase())?.[1] ?? null;
}

function importClasses(file, markdown) {
  const casterKinds = { bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half', warlock: 'pact' };
  const classSpecificKeys = {
    rages: 'rage_count', 'rage-damage': 'rage_damage_bonus', 'weapon-mastery': 'weapon_mastery',
    'bardic-inspiration': 'bardic_inspiration_die', 'bardic-die': 'bardic_inspiration_die', cantrips: 'cantrips_known',
    'channel-divinity': 'channel_divinity_charges', 'wild-shape': 'wild_shape_uses',
    'second-wind': 'second_wind_uses', 'martial-arts': 'martial_arts_die',
    'focus-points': 'focus_points', 'unarmored-movement': 'unarmored_movement_bonus',
    'favored-enemy': 'favored_enemies', 'sneak-attack': 'sneak_attack',
    'sorcery-points': 'sorcery_points', 'eldritch-invocations': 'eldritch_invocations',
    'prepared-spells': 'prepared_spells',
  };
  const subclassPrefixes = {
    'path-of-the-berserker': 'berserker', 'college-of-lore': 'lore', 'life-domain': 'life',
    'circle-of-the-land': 'land', champion: 'champion', 'warrior-of-the-open-hand': 'open-hand',
    'oath-of-devotion': 'devotion', hunter: 'hunter', thief: 'thief',
    'draconic-sorcery': 'draconic-sorcery', 'fiend-patron': 'fiend-patron', evoker: 'evoker',
  };
  for (const section of sections(markdown).filter((entry) => entry.level === 2)) {
    const tables = parseHtmlTables(section.raw);
    const core = tables.find((table) => table.rows.some((row) => row[0] === 'Primary Ability'));
    const progression = tables.find((table) => table.rows[0]?.includes('Level') && table.rows[0]?.some((cell) => /Class Features/i.test(cell)));
    if (!core || !progression) continue;
    const headers = progression.rows[0];
    const featureIndex = headers.findIndex((header) => /Class Features/i.test(header));
    const bodyRows = progression.rows.filter((row) => {
      const level = number(row[0]);
      return level >= 1 && level <= 20;
    });
    const slotGroupIndex = headers.findIndex((header) => /Spell Slots per Spell Level/i.test(header));
    const pactSlotIndex = headers.findIndex((header) => /^Spell Slots$/i.test(header));
    const pactLevelIndex = headers.findIndex((header) => /^Slot Level$/i.test(header));
    const slotCount = slotGroupIndex >= 0
      ? Math.max(1, progression.rows.find((row) => row !== headers && row.length > headers.length)?.slice(slotGroupIndex).filter((cell) => /^\d+$/.test(cell)).length ?? 0)
      : 0;
    const extraEnd = slotGroupIndex >= 0 ? slotGroupIndex : pactSlotIndex >= 0 ? pactSlotIndex : headers.length;
    const extraColumns = headers.map((header, index) => {
      const slug = slugify(header);
      return { key: classSpecificKeys[slug] ?? slug.replace(/-/g, '_'), index };
    })
      .filter(({ key, index }) => index > featureIndex && index < extraEnd && key);
    const byLevel = new Map();
    for (const row of bodyRows) {
      const level = number(row[0]);
      if (!level) continue;
      byLevel.set(level, (row[featureIndex] ?? '').split(',').map(slugify).filter((value) => value && value !== 'subclass-feature'));
    }
    const childHeadings = sections(section.raw).filter((entry) => entry.level === 4 && /^Level\s+\d+:/i.test(entry.title) && !entry.parents.some((parent) => /Subclass:/.test(parent)));
    const featureCounts = new Map();
    const featureByLevel = new Map();
    for (const feature of childHeadings) {
      const match = /^Level\s+(\d+):\s*(.+)/i.exec(feature.title);
      const base = `${slugify(section.title)}-${slugify(match[2])}`;
      const count = (featureCounts.get(base) ?? 0) + 1;
      featureCounts.set(base, count);
      const featureSlug = `${base}${count > 1 ? `-${count}` : ''}`;
      featureByLevel.set(`${Number(match[1])}/${slugify(match[2])}`, featureSlug);
      put('feature', match[2], { class: slugify(section.title), subclass: null, level: Number(match[1]) }, feature.raw, file, { slug: featureSlug, headingPath: [section.title, feature.title] });
    }
    const primary = String(tableLookup(core, 'Primary Ability') ?? '').split(/,|and|or/).map(abilitySlug).filter((value) => ABILITIES.includes(value));
    const saveText = tableLookup(core, 'Saving Throw Proficiencies') ?? '';
    const skillText = tableLookup(core, 'Skill Proficiencies') ?? '';
    put('class', section.title, {
      hitDie: number(tableLookup(core, 'Hit Point Die')) ?? 8, primaryAbilities: primary,
      saves: String(saveText).split(/,|and/).map(abilitySlug).filter((value) => ABILITIES.includes(value)),
      proficiencies: {
        armor: String(tableLookup(core, 'Armor Training') ?? '').split(/,|and/).map((value) => value.trim()).filter(Boolean),
        weapons: String(tableLookup(core, 'Weapon Proficiencies') ?? '').split(/,|and/).map((value) => value.trim()).filter(Boolean),
        skills: { choose: number(/Choose\s+(\d+)/i.exec(skillText)?.[1]) ?? 0, from: String(skillText).replace(/^.*?:/, '').split(/,|or/).map(slugify).filter(Boolean) },
      },
      spellcasting: casterKinds[slugify(section.title)] ? { ability: primary.at(-1) ?? null, kind: casterKinds[slugify(section.title)] } : null,
      levels: Array.from({ length: 20 }, (_, index) => {
        const row = bodyRows.find((candidate) => number(candidate[0]) === index + 1);
        let slots;
        if (slotGroupIndex >= 0) slots = [...row.slice(slotGroupIndex, slotGroupIndex + slotCount).map((cell) => number(cell) ?? 0), ...Array(9).fill(0)].slice(0, 9);
        else if (pactSlotIndex >= 0 && pactLevelIndex >= 0) {
          slots = Array(9).fill(0);
          const pactLevel = number(row[pactLevelIndex]);
          if (pactLevel) slots[pactLevel - 1] = number(row[pactSlotIndex]) ?? 0;
        }
        const classSpecific = Object.fromEntries(extraColumns.map(({ key, index: column }) => [key, number(row[column]) ?? 0]));
        if (casterKinds[slugify(section.title)] && !Object.hasOwn(classSpecific, 'cantrips_known')) classSpecific.cantrips_known = 0;
        return {
          level: index + 1, profBonus: 2 + Math.floor(index / 4), features: (byLevel.get(index + 1) ?? []).map((feature) => featureByLevel.get(`${index + 1}/${feature}`) ?? `${slugify(section.title)}-${feature}`),
          ...(slots ? { slots } : {}),
          classSpecific,
        };
      }),
      startingEquipment: tableLookup(core, 'Starting Equipment'),
    }, section.raw, file, { headingPath: [section.title] });

    for (const subclass of sections(section.raw).filter((entry) => entry.level === 3 && /Subclass:/.test(entry.title))) {
      const name = subclass.title.split('Subclass:').at(-1).trim();
      const subclassSlug = slugify(name);
      const prefix = subclassPrefixes[subclassSlug] ?? subclassSlug;
      const subclassCounts = new Map();
      const levels = sections(subclass.raw).filter((entry) => entry.level === 4 && /^Level\s+\d+:/i.test(entry.title)).map((feature) => {
        const match = /^Level\s+(\d+):\s*(.+)/i.exec(feature.title);
        const base = `${prefix}-${slugify(match[2])}`;
        const count = (subclassCounts.get(base) ?? 0) + 1;
        subclassCounts.set(base, count);
        const featureSlug = `${base}${count > 1 ? `-${count}` : ''}`;
        put('feature', match[2], { class: slugify(section.title), subclass: subclassSlug, level: Number(match[1]) }, feature.raw, file, { slug: featureSlug, headingPath: [section.title, subclass.title, feature.title] });
        return { level: Number(match[1]), feature: featureSlug };
      });
      const grouped = [...groupBy(levels, (entry) => entry.level)].map(([level, values]) => ({ level, features: values.map((entry) => entry.feature) }));
      put('subclass', name, { class: slugify(section.title), classSource: SOURCE.key, flavor: name, levels: grouped, spellcasting: null, additionalSpells: null }, subclass.raw, file, { headingPath: [section.title, subclass.title] });
    }
  }
}

function importMagicItems(file, markdown) {
  for (const section of sections(markdown).filter((entry) => entry.level === 4 && entry.parents.includes('Magic Items A–Z'))) {
    const meta = /^\s*_([^_\n]+)_/m.exec(section.raw)?.[1];
    if (!meta || !/(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous)/i.test(meta)) continue;
    const rarity = /(Common|Uncommon|Rare|Very Rare|Legendary|Artifact)/i.exec(meta)?.[1]?.toLowerCase() ?? null;
    put('item', section.title, {
      itemType: rarity ? 'magic' : /weapon/i.test(meta) ? 'weapon' : /armor/i.test(meta) ? 'armor' : 'gear',
      rarity, attunement: /requires attunement/i.test(meta), cost: null, weight: null, categories: [meta], partial: false,
    }, section.raw, file, { headingPath: [...section.parents, section.title] });
  }
}

function importEquipment(file, markdown) {
  const tables = parseHtmlTables(markdown);
  const weapons = tables.find((table) => table.rows[0]?.includes('Damage') && table.rows[0]?.includes('Mastery'));
  let category = null;
  for (const row of weapons?.rows.slice(1) ?? []) {
    if (row.length === 1) { category = row[0]; continue; }
    if (row.length !== 6) continue;
    const damage = /(\d+d\d+)\s+(\w+)/i.exec(row[1]);
    if (!damage) continue;
    const range = /Range\s+(\d+)\/(\d+)/i.exec(row[2]);
    put('item', row[0], {
      itemType: 'weapon', rarity: null, attunement: false, cost: parseCost(row[5]), weight: number(row[4]),
      weapon: { category, damage: damage[1], damageType: damage[2].toLowerCase(), properties: row[2] === '—' ? [] : row[2].split(',').map((value) => value.trim()), mastery: row[3] === '—' ? null : row[3], range: range ? { normal: Number(range[1]), long: Number(range[2]) } : null },
    }, `**${row[0]}.** ${row.join(' · ')}`, file, { headingPath: ['Weapons', row[0]] });
  }
  const armor = tables.find((table) => table.rows[0]?.includes('Armor Class (AC)'));
  category = null;
  for (const row of armor?.rows.slice(1) ?? []) {
    if (row.length === 1) { category = row[0]; continue; }
    if (row.length !== 6) continue;
    put('item', row[0], {
      itemType: 'armor', rarity: null, attunement: false, cost: parseCost(row[5]), weight: number(row[4]),
      armor: { category, ac: number(row[1]), dexCap: /max\s*2/i.test(row[1]) ? 2 : /^\d+$/.test(row[1]) ? 0 : null, addDex: /Dex/i.test(row[1]), strengthReq: number(row[2]), stealthDisadvantage: /disadvantage/i.test(row[3]) },
    }, `**${row[0]}.** ${row.join(' · ')}`, file, { headingPath: ['Armor', row[0]] });
  }
  for (const section of sections(markdown).filter((entry) => entry.level === 4 && entry.parents.includes('Adventuring Gear'))) {
    const match = /^(.*?)\s*\(([^)]+)\)$/.exec(section.title);
    put('item', match?.[1] ?? section.title, { itemType: 'gear', rarity: null, attunement: false, cost: parseCost(match?.[2]), weight: null }, section.raw, file, { headingPath: [...section.parents, section.title] });
  }
}

function importTables(file, markdown) {
  const filename = basename(file, '.md');
  const allSections = sections(markdown);
  for (const [index, match] of [...markdown.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].entries()) {
    const prefix = markdown.slice(Math.max(0, match.index - 300), match.index);
    const captions = [...prefix.matchAll(/^\*\*([^*\n]+)\*\*\s*$/gm)];
    const caption = captions.at(-1)?.[1]?.trim();
    if (!caption) continue;
    const table = parseHtmlTables(match[0])[0];
    if (!table || table.rows.length < 2 || table.rows[0].length < 2) continue;
    const owner = allSections.filter((section) => section.start < match.index).at(-1);
    const baseSlug = `${slugify(filename)}-${slugify(owner?.parents.join('-'))}-${slugify(caption)}`;
    let slug = baseSlug;
    let duplicate = 2;
    while (out.has(`table/${slug}/${SOURCE.key}`)) slug = `${baseSlug}-${duplicate++}`;
    put('table', caption, { dice: table.rows[0][0] ?? null, columns: table.rows[0], rows: table.rows.slice(1), section: owner?.title ?? null }, match[0], file, {
      slug,
      headingPath: [...(owner?.parents ?? []), owner?.title, caption].filter(Boolean),
    });
  }
}

function importRules(file, markdown) {
  const filename = basename(file, '.md');
  const allowed = new Set(['rules-glossary', 'playing-the-game', 'character-creation', 'monsters', 'gameplay-toolbox']);
  if (!allowed.has(filename)) return;
  for (const section of sections(markdown).filter((entry) => entry.level >= 2 && entry.level <= 4)) {
    if (['Traits', 'Actions', 'Bonus Actions', 'Reactions', 'Legendary Actions'].includes(section.title)) continue;
    const ownBody = section.raw.split(/^#{2,6}\s+/m)[0].trim();
    if (cleanMarkdown(ownBody).length < 40) continue;
    const tagged = /\[(Condition|Hazard|Action|Area of Effect|Attitude)\]/i.exec(section.title)?.[1]?.toLowerCase();
    const parentText = section.parents.join(' ');
    const type = tagged === 'condition' ? 'condition'
      : tagged === 'hazard' || /Traps|Environmental Effects/i.test(parentText) ? 'hazard'
        : section.parents.includes('Example Contagions') ? 'disease'
          : section.parents.includes('Sample Poisons') ? 'item'
          : tagged === 'action' ? 'action' : 'rule';
    const displayName = section.title.replace(/\s*\[(?:Condition|Hazard|Action|Area of Effect|Attitude)\]\s*/i, '').replace(/\s*\([\d,]+\s*GP\)\s*$/i, '');
    const data = type === 'item'
      ? { itemType: 'poison', rarity: null, attunement: false, cost: parseCost(section.title), weight: null, categories: ['poison'] }
      : { category: type === 'rule' ? (tagged ?? filename) : tagged ?? type, section: section.parents.at(-1) ?? null };
    put(type, displayName, data, ownBody, file, { headingPath: [...section.parents, section.title] });
  }
}

const sourceNames = existsSync(SRC) ? readdirSync(SRC) : [];
const files = sourceNames.filter((name) => name.endsWith('.md') && name !== 'README.md').map((name) => join(SRC, name));
const unsupportedFiles = sourceNames.filter((name) => !name.endsWith('.md') && name !== 'README.md' && !name.startsWith('.'));
const fileReports = [];
for (const file of files) {
  const name = basename(file);
  const before = out.size;
  const beforeKeys = new Set(out.keys());
  try {
    const markdown = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (name === 'spells.md') importSpells(file, markdown);
    importMonsters(file, markdown);
    if (name === 'feats.md') importFeats(file, markdown);
    if (name === 'character-origins.md') importOrigins(file, markdown);
    if (name === 'classes.md') importClasses(file, markdown);
    if (name === 'magic-items.md') importMagicItems(file, markdown);
    if (name === 'equipment.md') importEquipment(file, markdown);
    importTables(file, markdown);
    importRules(file, markdown);
    const tables = parseHtmlTables(markdown);
    fileReports.push({ file: name, bytes: Buffer.byteLength(markdown), headings: sections(markdown).length, tables: tables.length, normalized: out.size - before });
  } catch (error) {
    for (const key of out.keys()) {
      if (!beforeKeys.has(key)) { out.delete(key); origins.delete(key); }
    }
    fileReports.push({ file: name, normalized: 0, error: error.message });
  }
}

mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT).filter((name) => /^markdown-.*\.json$/.test(name))) unlinkSync(join(OUT, name));
const byType = groupBy([...out.values()], (entry) => entry.type);
for (const [type, entries] of byType) writeFileSync(join(OUT, `markdown-${type}.json`), JSON.stringify(entries));

const existing = new Map();
for (const dir of [BASELINE, OUT]) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('markdown-') && !name.endsWith('-report.json'))) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed) {
      const key = `${entry.type}/${entry.slug}/${entry.edition}`;
      const current = existing.get(key);
      existing.set(key, current ? choosePreferred(current, entry) : entry);
    }
  }
}
const conflicts = [...out.values()].filter((entry) => existing.has(`${entry.type}/${entry.slug}/${entry.edition}`)).map((entry) => {
  const json = existing.get(`${entry.type}/${entry.slug}/${entry.edition}`);
  const winner = choosePreferred(entry, json);
  return {
    type: entry.type, slug: entry.slug,
    markdownQuality: Number(entryQuality(entry).toFixed(2)), jsonQuality: Number(entryQuality(json).toFixed(2)),
    decision: winner.source.key === SOURCE.key ? 'markdown-wins' : 'json-more-complete', preferred: winner.source.key,
  };
});
const duplicateIds = [...origins].filter(([, files]) => files.length > 1).map(([id, sourceFiles]) => ({ id, files: [...new Set(sourceFiles)] }));
const report = {
  version: 1, generatedAt: new Date().toISOString(), sourceDirectory: 'data/pdfs',
  summary: { filesScanned: files.length, unsupportedFiles: unsupportedFiles.length, normalizedEntries: out.size, matchingJsonEntries: conflicts.length, markdownPreferred: conflicts.filter((entry) => entry.preferred === SOURCE.key).length, jsonPreferred: conflicts.filter((entry) => entry.preferred !== SOURCE.key).length, duplicateIds: duplicateIds.length, parseErrors: fileReports.filter((file) => file.error).length },
  normalizedByType: Object.fromEntries([...byType].map(([type, entries]) => [type, entries.length]).sort()),
  files: fileReports, unsupportedFiles, duplicateIds, conflicts,
};
writeFileSync(join(OUT, 'markdown-report.json'), JSON.stringify(report, null, 2));
console.log(`${files.length} Markdown files scanned; ${out.size} entries normalized; ${conflicts.length} matched JSON identities.`);
console.log(`Conflict preview: ${report.summary.markdownPreferred} Markdown preferred, ${report.summary.jsonPreferred} JSON preferred.`);
console.log(`Markdown coverage report → ${join(OUT, 'markdown-report.json')}`);

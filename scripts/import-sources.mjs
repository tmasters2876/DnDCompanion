// Imports user-supplied 5etools-format JSON from data/sources/ into the internal
// schema (docs/SCHEMA.md), writing data/sources/_normalized/<type>.json.
// Fails loudly per file, partially loads gracefully: a bad file is reported and
// skipped, never blocking the rest.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.DND_SOURCE_DIR || join(ROOT, 'data', 'sources');
const OUT = process.env.DND_OUTPUT_DIR || join(SRC, '_normalized');
mkdirSync(OUT, { recursive: true });

const EDITION_2024 = new Set(['XPHB', 'XDMG', 'XMM']);
const edition = (src) => (EDITION_2024.has(src) ? '2024' : '2014');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SIZE = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
const SCHOOL = { A: 'abjuration', C: 'conjuration', D: 'divination', E: 'enchantment', V: 'evocation', I: 'illusion', N: 'necromancy', T: 'transmutation' };
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const clone = (value) => value == null ? value : structuredClone(value);
const refParts = (value) => String(typeof value === 'object' ? value.classFeature ?? value.subclassFeature ?? '' : value).split('|');
const refName = (value) => refParts(value)[0];
const refLevel = (value) => Number(refParts(value).at(-1)) || null;
const primitive = (value) => value == null || ['string', 'number', 'boolean'].includes(typeof value);

// ---- 5etools "entries" → markdown ----
function stripTags(s) {
  // {@dice 8d6} → 8d6, {@spell fireball|XPHB} → fireball, {@hit 5} → +5, etc.
  return String(s)
    .replace(/\{@hit (\d+)\}/g, '+$1')
    .replace(/\{@h\}/g, 'Hit: ')
    .replace(/\{@atk mw\}/g, 'Melee Weapon Attack:')
    .replace(/\{@atk rw\}/g, 'Ranged Weapon Attack:')
    .replace(/\{@atkr m\}/g, 'Melee Attack Roll:')
    .replace(/\{@atkr r\}/g, 'Ranged Attack Roll:')
    .replace(/\{@\w+ ([^|}]+)(\|[^}]*)?\}/g, '$1')
    .replace(/\{=([^}/]+)\/[^}]+\}/g, '$1');
}
function entriesToMd(e, depth = 0) {
  if (e == null) return '';
  if (typeof e === 'string') return stripTags(e);
  if (Array.isArray(e)) return e.map((x) => entriesToMd(x, depth)).filter(Boolean).join('\n\n');
  switch (e.type) {
    case 'entries': case 'section': case 'inset': case 'insetReadaloud':
      return [(e.name ? `**${e.name}.**` : ''), entriesToMd(e.entries, depth + 1)].filter(Boolean).join(' ');
    case 'list':
      return (e.items ?? []).map((i) => `- ${entriesToMd(i, depth + 1)}`).join('\n');
    case 'item':
      return [(e.name ? `**${e.name}.**` : ''), entriesToMd(e.entries ?? e.entry, depth + 1)].filter(Boolean).join(' ');
    case 'table': {
      const rows = (e.rows ?? []).map((raw) => {
        const r = Array.isArray(raw) ? raw : Array.isArray(raw?.row) ? raw.row : [raw];
        return `| ${r.map((c) => entriesToMd(c)).join(' | ')} |`;
      });
      const head = e.colLabels ? `| ${e.colLabels.map(stripTags).join(' | ')} |\n|${e.colLabels.map(() => '---').join('|')}|` : '';
      return [e.caption ? `**${stripTags(e.caption)}**` : '', head, ...rows].filter(Boolean).join('\n');
    }
    case 'quote':
      return entriesToMd(e.entries, depth + 1);
    default:
      if (e.entries) return entriesToMd(e.entries, depth + 1);
      if (e.entry) return entriesToMd(e.entry, depth + 1);
      if (e.items) return entriesToMd(e.items, depth + 1);
      return '';
  }
}

function proficiencyKeys(list) {
  const found = [];
  for (const group of list ?? []) {
    if (!group || typeof group !== 'object') continue;
    for (const [key, enabled] of Object.entries(group)) {
      if (enabled === true) found.push(slugify(key));
      if (key === 'choose') found.push(...(enabled?.from ?? []).map(slugify));
    }
  }
  return [...new Set(found.filter(Boolean))];
}

function abilityChoices(raw) {
  const found = [];
  for (const group of raw ?? []) {
    if (!group || typeof group !== 'object') continue;
    found.push(...ABILITIES.filter((ability) => group[ability] != null));
    found.push(...(group.choose?.from ?? []).filter((ability) => ABILITIES.includes(ability)));
  }
  return [...new Set(found)];
}

function featureText(entries) {
  const feature = (entries ?? []).find((entry) => entry?.data?.isFeature || /^feature:/i.test(entry?.name ?? ''));
  return feature ? { name: stripTags(feature.name ?? '').replace(/^feature:\s*/i, ''), text: entriesToMd(feature.entries) } : null;
}

function usableEntryName(entry, fallback = 'Unnamed feature') {
  if (slugify(entry?.name ?? '')) return entry.name;
  const nested = (entry?.entries ?? []).find((value) => slugify(value?.name ?? ''))?.name;
  return nested ?? [entry?.className, entry?.subclassShortName, entry?.level ? `level ${entry.level}` : null, fallback].filter(Boolean).join(' ');
}

const out = {}; // type -> [entries]
const loreIndex = new Map();
const documentIndex = new Map();
const spellClassIndex = new Map();
let activeFile = null;
let activeRaw = null;
const entryOrigins = new Map();
function put(type, name, src, ed, data, text) {
  if (!name || typeof name !== 'string') throw new Error('entry has no name');
  const source = { key: slugify(src ?? 'unknown') || 'unknown', name: src ?? 'Unknown' };
  const slug = slugify(name);
  if (!slug) throw new Error(`unusable name "${name}"`);
  const lore = loreIndex.get(`${type}|${String(name).toLowerCase()}|${String(src).toLowerCase()}`)
    ?? loreIndex.get(`${type}|${String(name).toLowerCase()}|`);
  const body = [text ?? '', lore ? `## Lore\n\n${lore}` : ''].filter(Boolean).join('\n\n');
  const identity = {
    aliases: (activeRaw?.alias ?? activeRaw?.aliases ?? []).map?.((x) => primitive(x) ? String(x) : x.name).filter(Boolean) ?? [],
    reprints: (activeRaw?.reprintedAs ?? []).map?.((x) => primitive(x) ? String(x) : `${x.name ?? ''}|${x.source ?? ''}`).filter(Boolean) ?? [],
    copiedFrom: activeRaw?._copy ? `${activeRaw._copy.name}|${activeRaw._copy.source}` : null,
  };
  const entry = {
    id: `${type}/${slug}/${source.key}`,
    type, slug, name, edition: ed ?? edition(src), source,
    data: { ...(lore ? { ...data, lore } : data), ...(identity.aliases.length || identity.reprints.length || identity.copiedFrom ? { identity } : {}) },
    text: body,
  };
  (out[type] ??= []).push(entry);
  const origins = entryOrigins.get(entry.id) ?? [];
  origins.push(activeFile);
  entryOrigins.set(entry.id, origins);
}

// ---- per-type mappers (pragmatic: normalize what the engine needs, text gets the rest) ----
function mapSpell(s) {
  const time = s.time?.[0];
  const range = s.range ? (s.range.distance ? `${s.range.distance.amount ?? ''} ${s.range.distance.type ?? ''}`.trim() : s.range.type) : null;
  const dur = s.duration?.[0];
  const text = entriesToMd(s.entries) + (s.entriesHigherLevel ? `\n\n${entriesToMd(s.entriesHigherLevel)}` : '');
  const dmgMatch = /(\d+d\d+(?:\s*\+\s*\d+)?)\s+(\w+) damage/i.exec(text);
  put('spell', s.name, s.source, edition(s.source), {
    level: s.level ?? 0,
    school: SCHOOL[s.school] ?? null,
    castingTime: time ? `${time.number ?? ''} ${time.unit ?? ''}`.trim() : null,
    range,
    components: {
      v: !!s.components?.v, s: !!s.components?.s, m: !!s.components?.m,
      materialText: typeof s.components?.m === 'object' ? s.components.m.text : (typeof s.components?.m === 'string' ? s.components.m : null),
    },
    duration: dur ? (dur.type === 'timed' ? `${dur.duration?.amount ?? ''} ${dur.duration?.type ?? ''}`.trim() : dur.type) : null,
    concentration: !!dur?.concentration,
    ritual: !!s.meta?.ritual,
    classes: [...new Set([
      ...(s.classes?.fromClassList ?? []).map((c) => slugify(c.name)),
      ...(s.classes?.fromSubclass ?? []).map((c) => slugify(c.class?.name)),
      ...(spellClassIndex.get(slugify(s.name)) ?? []),
    ].filter(Boolean))],
    damage: dmgMatch ? { dice: dmgMatch[1].replace(/\s/g, ''), type: dmgMatch[2].toLowerCase(), scaling: {} } : null,
    attackType: /melee spell attack/i.test(text) ? 'melee' : /ranged spell attack/i.test(text) ? 'ranged' : null,
    save: /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(text)?.[1]?.slice(0, 3).toLowerCase() ?? null,
  }, text);
}

function mapMonster(m) {
  const mapActs = (list) => (list ?? []).map((a) => {
    const text = entriesToMd(a.entries);
    const hit = /[+](\d+)(?= to hit)|Attack Roll:\s*\+(\d+)/.exec(text);
    const damage = [...text.matchAll(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s+(\w+) damage/gi)]
      .map((x) => ({ dice: x[1].replace(/\s/g, ''), type: x[2].toLowerCase() }));
    return {
      name: stripTags(a.name ?? ''),
      text,
      ...(hit ? { attack: { bonus: Number(hit[1] ?? hit[2]), reach: null, range: null, damage } } : {}),
    };
  });
  const ac = Array.isArray(m.ac) ? m.ac[0] : m.ac;
  const cr = typeof m.cr === 'object' ? m.cr?.cr : m.cr;
  // type can nest a choice: {type: {choose: ["fey", "humanoid"]}}
  let rawType = typeof m.type === 'object' ? m.type?.type : m.type;
  if (rawType && typeof rawType === 'object') {
    rawType = Array.isArray(rawType.choose) ? rawType.choose.join(' or ') : null;
  }
  put('monster', m.name, m.source, edition(m.source), {
    size: SIZE[m.size?.[0]] ?? null,
    creatureType: rawType ?? null,
    alignment: Array.isArray(m.alignment)
      ? m.alignment.filter((x) => typeof x === 'string').join('') || null
      : m.alignment ?? null,
    ac: typeof ac === 'object' ? ac?.ac : ac,
    acNote: typeof ac === 'object' ? (ac?.from ?? []).map(stripTags).join(', ') || null : null,
    hp: {
      average: (m.hp?.average ?? Number(String(m.hp?.special ?? '').match(/\d+/)?.[0])) || null,
      formula: m.hp?.formula ?? null,
    },
    speed: {
      walk: typeof m.speed?.walk === 'object' ? m.speed.walk.number : m.speed?.walk ?? null,
      fly: typeof m.speed?.fly === 'object' ? m.speed.fly.number : m.speed?.fly ?? null,
      swim: typeof m.speed?.swim === 'object' ? m.speed.swim.number : m.speed?.swim ?? null,
      climb: typeof m.speed?.climb === 'object' ? m.speed.climb.number : m.speed?.climb ?? null,
      burrow: typeof m.speed?.burrow === 'object' ? m.speed.burrow.number : m.speed?.burrow ?? null,
      hover: !!(typeof m.speed?.fly === 'object' && m.speed.fly.condition),
    },
    abilities: { str: m.str, dex: m.dex, con: m.con, int: m.int, wis: m.wis, cha: m.cha },
    saves: Object.fromEntries(Object.entries(m.save ?? {}).map(([k, v]) => [k, parseInt(v)])),
    skills: Object.fromEntries(Object.entries(m.skill ?? {}).map(([k, v]) => [k, parseInt(v)])),
    senses: [(m.senses ?? []).map(stripTags).join(', '), m.passive != null ? `passive Perception ${m.passive}` : '']
      .filter(Boolean).join(', '),
    languages: (m.languages ?? []).join(', '),
    cr: typeof cr === 'string' && cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr ?? 0),
    xp: null,
    vulnerabilities: (m.vulnerable ?? []).map((x) => typeof x === 'string' ? x : '').filter(Boolean),
    resistances: (m.resist ?? []).map((x) => typeof x === 'string' ? x : '').filter(Boolean),
    immunities: (m.immune ?? []).map((x) => typeof x === 'string' ? x : '').filter(Boolean),
    conditionImmunities: (m.conditionImmune ?? []).map((x) => typeof x === 'string' ? x : '').filter(Boolean),
    traits: mapActs(m.trait),
    actions: mapActs(m.action),
    bonusActions: mapActs(m.bonus),
    reactions: mapActs(m.reaction),
    legendary: mapActs(m.legendary),
  }, mapActs([...(m.trait ?? []), ...(m.action ?? [])]).map((a) => `**${a.name}.** ${a.text}`).join('\n\n'));
}

function mapItem(i) {
  const text = entriesToMd(i.entries);
  const isWeapon = !!i.weapon || !!i.weaponCategory || !!i.dmg1;
  const isArmor = !!i.armor || i.type?.startsWith?.('LA') || i.type?.startsWith?.('MA') || i.type?.startsWith?.('HA') || i.type === 'S';
  put('item', i.name, i.source, edition(i.source), {
    itemType: i.rarity && i.rarity !== 'none' ? 'magic' : isWeapon ? 'weapon' : isArmor ? 'armor' : 'gear',
    rarity: i.rarity && i.rarity !== 'none' ? i.rarity : null,
    attunement: !!i.reqAttune,
    cost: i.value != null ? { qty: i.value / 100, unit: 'gp' } : null,
    weight: i.weight ?? null,
    categories: [],
    ...(isWeapon ? {
      weapon: {
        category: i.weaponCategory ?? null,
        damage: i.dmg1 ?? null,
        damageType: { P: 'piercing', S: 'slashing', B: 'bludgeoning' }[i.dmgType] ?? i.dmgType ?? null,
        versatileDamage: i.dmg2 ?? null,
        properties: i.property ?? [],
        mastery: i.mastery?.[0]?.split?.('|')[0] ?? null,
        range: i.range ? { normal: Number(i.range.split('/')[0]), long: Number(i.range.split('/')[1]) || null } : null,
      },
    } : {}),
    ...(isArmor ? {
      armor: {
        category: { LA: 'Light', MA: 'Medium', HA: 'Heavy', S: 'Shield' }[i.type?.split?.('|')[0]] ?? null,
        ac: i.ac ?? null,
        dexCap: i.type?.startsWith?.('MA') ? 2 : i.type?.startsWith?.('HA') ? 0 : null,
        addDex: !i.type?.startsWith?.('HA'),
        strengthReq: i.strength ? Number(i.strength) : null,
        stealthDisadvantage: !!i.stealth,
      },
    } : {}),
  }, text);
}

function mapFeat(f) {
  put('feat', f.name, f.source, edition(f.source), {
    category: f.category ? String(f.category).toLowerCase() : null,
    prerequisite: f.prerequisite ? stripTags(JSON.stringify(f.prerequisite)) : null,
    abilityIncrease: abilityChoices(f.ability),
    repeatable: !!f.repeatable,
  }, entriesToMd(f.entries));
}

function mapBackground(b) {
  const feats = (b.feats ?? b.feat ?? []).flatMap((group) => primitive(group) ? [group] : Object.keys(group ?? {}));
  put('background', b.name, b.source, edition(b.source), {
    abilityScores: abilityChoices(b.ability ?? b.abilityScores),
    feat: feats.length ? slugify(String(feats[0]).split('|')[0]) : null,
    skills: proficiencyKeys(b.skillProficiencies),
    tools: proficiencyKeys(b.toolProficiencies),
    languages: proficiencyKeys(b.languageProficiencies),
    equipment: b.startingEquipment ?? null,
    feature: featureText(b.entries),
  }, entriesToMd(b.entries));
}

function mapSpecies(r, parent = null) {
  const speed = typeof r.speed === 'object' ? r.speed.walk : r.speed;
  put('species', parent ? `${parent}: ${r.name}` : r.name, r.source, edition(r.source), {
    size: SIZE[r.size?.[0]] ?? (r.size?.length === 1 ? r.size[0] : null),
    speed: speed ?? 30,
    traits: (r.entries ?? []).filter((e) => e?.name).map((e) => ({ name: stripTags(e.name), text: entriesToMd(e.entries) })),
    subspecies: parent ? [] : (r.subraces ?? []).map((x) => slugify(x.name ?? x)),
    parent: parent ? slugify(parent) : null,
    darkvision: r.darkvision ?? null,
    abilityBonuses: abilityChoices(r.ability),
    languages: proficiencyKeys(r.languageProficiencies),
    resistances: (r.resist ?? []).flatMap((x) => primitive(x) ? [x] : (x.choose?.from ?? [])),
    innateSpells: r.additionalSpells ?? [],
  }, entriesToMd(r.entries));
}

function mapClass(c) {
  const byLevel = new Map();
  for (const ref of c.classFeatures ?? []) {
    const level = refLevel(ref);
    if (level) (byLevel.get(level) ?? byLevel.set(level, []).get(level)).push(slugify(refName(ref)));
  }
  const slotRows = c.classTableGroups?.find((group) => Array.isArray(group.rowsSpellProgression))?.rowsSpellProgression ?? [];
  const tableGroups = c.classTableGroups ?? [];
  const progression = String(c.casterProgression ?? '').toLowerCase();
  const kind = progression === 'full' ? 'full'
    : ['1/2', 'half', 'artificer'].includes(progression) ? 'half'
      : ['1/3', 'third'].includes(progression) ? 'third'
        : progression === 'pact' ? 'pact' : null;
  const skills = c.startingProficiencies?.skills?.find((x) => x?.choose)?.choose ?? {};
  put('class', c.name, c.source, edition(c.source), {
    hitDie: c.hd?.faces ?? c.hitDie ?? 8,
    primaryAbilities: [...new Set([...(c.primaryAbility ?? []), c.spellcastingAbility].filter(Boolean).flatMap((x) => primitive(x) ? [x] : Object.keys(x)))],
    saves: (c.proficiency ?? []).filter((x) => ABILITIES.includes(x)),
    proficiencies: {
      armor: (c.startingProficiencies?.armor ?? []).map(stripTags),
      weapons: (c.startingProficiencies?.weapons ?? []).map(stripTags),
      tools: (c.startingProficiencies?.tools ?? []).map(stripTags),
      skills: { choose: skills.count ?? 0, from: skills.from ?? [] },
    },
    spellcasting: c.spellcastingAbility ? {
      ability: c.spellcastingAbility, kind, preparedFormula: c.preparedSpells ?? null,
    } : null,
    levels: Array.from({ length: 20 }, (_, index) => ({
      level: index + 1,
      profBonus: 2 + Math.floor(index / 4),
      features: [...new Set(byLevel.get(index + 1) ?? [])],
      ...(slotRows[index] ? { slots: slotRows[index].map(Number) } : {}),
      classSpecific: Object.fromEntries(tableGroups.flatMap((group) => (group.colLabels ?? []).map((label, col) => [
        slugify(stripTags(label)), group.rows?.[index]?.[col] ?? group.rowsSpellProgression?.[index]?.[col] ?? null,
      ])).filter(([key, value]) => key && value != null)),
    })),
    startingEquipment: c.startingEquipment ?? null,
    multiclass: c.multiclassing ?? null,
    classSpells: (c.classSpells ?? []).map((x) => slugify(String(x).split('|')[0])),
    subclassTitle: c.subclassTitle ?? null,
  }, entriesToMd(c.entries ?? c.fluff));
}

function mapSubclass(sc) {
  const byLevel = new Map();
  for (const ref of sc.subclassFeatures ?? []) {
    const level = refLevel(ref);
    if (level) (byLevel.get(level) ?? byLevel.set(level, []).get(level)).push(slugify(refName(ref)));
  }
  put('subclass', sc.name, sc.source, edition(sc.source), {
    class: slugify(sc.className ?? ''),
    classSource: slugify(sc.classSource ?? ''),
    flavor: sc.shortName ?? null,
    levels: [...byLevel].sort((a, b) => a[0] - b[0]).map(([level, features]) => ({ level, features: [...new Set(features)] })),
    spellcasting: sc.casterProgression ? { kind: sc.casterProgression, ability: sc.spellcastingAbility ?? null } : null,
    additionalSpells: sc.additionalSpells ?? sc.subSubclassSpells ?? null,
  }, entriesToMd(sc.entries));
}

function mapMagicVariant(v) {
  const inherited = v.inherits ?? {};
  mapItem({
    ...inherited,
    name: v.name ?? `${inherited.namePrefix ?? ''}Variant${inherited.nameSuffix ?? ''}`,
    source: inherited.source ?? v.source,
    entries: inherited.entries ?? v.entries,
    type: inherited.type ?? v.type,
    _variant: { requires: v.requires ?? [], excludes: v.excludes ?? {}, template: v.name },
  });
  const added = out.item.at(-1);
  if (added) added.data.variant = { requires: v.requires ?? [], excludes: v.excludes ?? {}, template: v.name };
}

function mapTable(t) {
  put('table', t.name ?? t.caption, t.source, edition(t.source), {
    columns: (t.colLabels ?? []).map(stripTags),
    rows: (t.rows ?? []).map((row) => (Array.isArray(row) ? row : row?.row ?? [row]).map((cell) => entriesToMd(cell))),
    dice: t.diceExpression ?? t.colLabels?.[0] ?? null,
  }, entriesToMd({ ...t, type: 'table' }));
}

function mapDocument(kind, meta) {
  const body = documentIndex.get(`${kind}|${meta.id ?? meta.source}`) ?? [];
  const sections = body.map((section) => ({ name: section.name ?? 'Section', page: section.page ?? null, text: entriesToMd(section.entries) }));
  put(kind, meta.name, meta.source ?? meta.id, edition(meta.source), {
    author: meta.author ?? null,
    published: meta.published ?? null,
    level: meta.level ?? null,
    storyline: meta.storyline ?? null,
    sections,
  }, sections.map((section) => `# ${section.name}\n\n${section.text}`).join('\n\n'));
}

const generic = (type, category = null) => (entry) => put(type, entry.name, entry.source, edition(entry.source), {
  category: category ?? entry.type ?? null,
  page: entry.page ?? null,
  properties: Object.fromEntries(Object.entries(entry).filter(([key, value]) => !['name', 'source', 'entries'].includes(key) && primitive(value))),
}, entriesToMd(entry.entries ?? entry.instructions ?? entry.description));

const MAPPERS = {
  spell: mapSpell,
  monster: mapMonster,
  item: mapItem,
  baseitem: mapItem,
  magicvariant: mapMagicVariant,
  feat: mapFeat,
  background: mapBackground,
  race: (r) => mapSpecies(r),
  subrace: (r) => mapSpecies(r, r.raceName ?? 'Unknown ancestry'),
  condition: generic('condition'),
  disease: generic('disease'),
  language: generic('language'),
  deity: generic('deity'),
  reward: generic('reward'),
  recipe: generic('recipe'),
  psionic: generic('psionic'),
  card: generic('card'),
  trap: generic('hazard', 'trap'),
  hazard: generic('hazard'),
  vehicle: generic('vehicle'),
  object: generic('object'),
  action: generic('action'),
  boon: generic('reward', 'boon'),
  charoption: generic('feature', 'character-option'),
  cult: generic('deity', 'cult'),
  table: mapTable,
  deck: generic('deck'),
  legendaryGroup: generic('legendary-group'),
  vehicleUpgrade: generic('vehicle-upgrade'),
  makebrewCreatureTrait: generic('feature', 'creature-trait'),
  itemGroup: (i) => put('item-group', i.name, i.source, edition(i.source), { items: i.items ?? [], rarity: i.rarity ?? null }, entriesToMd(i.entries)),
  itemProperty: (r) => put('rule', r.name ?? r.entries?.find((e) => e?.name)?.name ?? r.abbreviation, r.source, edition(r.source), { category: 'item-property', abbreviation: r.abbreviation ?? null }, entriesToMd(r.entries)),
  itemMastery: (r) => put('rule', r.name, r.source, edition(r.source), { category: 'weapon-mastery' }, entriesToMd(r.entries)),
  itemType: (r) => put('rule', r.name ?? r.entries?.find((e) => e?.name)?.name ?? r.abbreviation, r.source, edition(r.source), { category: 'item-type', abbreviation: r.abbreviation ?? null }, entriesToMd(r.entries)),
  skill: (r) => put('rule', r.name, r.source, edition(r.source), { category: 'skill', ability: r.ability ?? null }, entriesToMd(r.entries)),
  sense: (r) => put('rule', r.name, r.source, edition(r.source), { category: 'sense' }, entriesToMd(r.entries)),
  status: (r) => put('condition', r.name, r.source, edition(r.source), { category: 'status' }, entriesToMd(r.entries)),
  variantrule: (r) => put('rule', r.name, r.source, edition(r.source), { category: 'variant-rule', ruleType: r.ruleType ?? null }, entriesToMd(r.entries)),
  optionalfeature: (f) => put('feature', f.name, f.source, edition(f.source), {
    class: slugify(f.prerequisite?.[0]?.level?.class?.name ?? ''), subclass: null,
    level: f.prerequisite?.[0]?.level?.level ?? null, category: 'optional', featureTypes: f.featureType ?? [],
  }, entriesToMd(f.entries)),
  classFeature: (f) => put('feature', usableEntryName(f, 'class feature'), f.source, edition(f.source), {
    class: slugify(f.className ?? ''), subclass: null, level: f.level ?? null,
  }, entriesToMd(f.entries)),
  subclassFeature: (f) => put('feature', usableEntryName(f, 'subclass feature'), f.source, edition(f.source), {
    class: slugify(f.className ?? ''), subclass: slugify(f.subclassShortName ?? ''), level: f.level ?? null,
  }, entriesToMd(f.entries)),
  class: mapClass,
  subclass: mapSubclass,
  adventure: (a) => mapDocument('adventure', a),
  book: (b) => mapDocument('book', b),
};

const CONTRIBUTING_KEYS = new Set([
  'monsterFluff', 'itemFluff', 'raceFluff', 'backgroundFluff', 'classFluff', 'subclassFluff',
  'spellFluff', 'featFluff', 'adventureData', 'bookData',
]);

// ---- run ----
// Walk data/sources/ recursively — files are usually organized in per-type folders.
const SKIP_DIRS = new Set(['_normalized', 'node_modules', '.git']);
const SKIP_FILES = new Set(['package.json', 'package-lock.json']);
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) yield* walk(join(dir, entry.name));
    } else if (entry.name.endsWith('.json') && !SKIP_FILES.has(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}
const localDndDataDir = process.env.DND_DATA_DIR || join(ROOT, 'data');
const localDndDataFiles = ['backgrounds.json', 'classes.json', 'items.json', 'monsters.json', 'species.json', 'spells.json']
  .map((name) => join(localDndDataDir, name)).filter(existsSync);
const files = [...new Set([...walk(SRC), ...localDndDataFiles])];
if (!files.length) {
  console.log('No source files in data/sources/ — nothing to import. (Drop 5etools-format JSON there.)');
}

function replaceTextDeep(value, spec) {
  if (typeof value === 'string') {
    try { return value.replace(new RegExp(spec.replace, spec.flags ?? 'g'), spec.with ?? ''); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map((item) => replaceTextDeep(item, spec));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceTextDeep(child, spec)]));
  return value;
}

function modifyArray(current, mod) {
  const list = Array.isArray(current) ? [...current] : [];
  const items = Array.isArray(mod.items) ? mod.items : mod.items == null ? [] : [mod.items];
  const names = new Set((Array.isArray(mod.names) ? mod.names : [mod.names]).filter(Boolean).map((x) => String(x).toLowerCase()));
  const replace = String(mod.replace ?? '').toLowerCase();
  switch (mod.mode) {
    case 'appendArr': return [...list, ...items];
    case 'prependArr': return [...items, ...list];
    case 'appendIfNotExistsArr': return [...list, ...items.filter((item) => !list.some((x) => (x?.name ?? x) === (item?.name ?? item)))];
    case 'removeArr': return list.filter((item) => !names.has(String(item?.name ?? item).toLowerCase()));
    case 'replaceArr': return list.flatMap((item) => String(item?.name ?? item).toLowerCase() === replace ? items : [item]);
    case 'replaceOrAppendArr': return list.some((item) => String(item?.name ?? item).toLowerCase() === replace)
      ? list.flatMap((item) => String(item?.name ?? item).toLowerCase() === replace ? items : [item]) : [...list, ...items];
    case 'renameArr': return list.map((item) => String(item?.name ?? item).toLowerCase() === replace ? { ...item, name: mod.with } : item);
    case 'insertArr': { const next = [...list]; next.splice(Number(mod.index ?? 0), 0, ...items); return next; }
    default: return list;
  }
}

function applyCopyMods(base, mods) {
  let result = clone(base);
  for (const [field, rawMods] of Object.entries(mods ?? {})) {
    for (const mod of Array.isArray(rawMods) ? rawMods : [rawMods]) {
      if (!mod) continue;
      if (field === '*' && mod.mode === 'replaceTxt') result = replaceTextDeep(result, mod);
      else if (mod.mode === 'replaceTxt') result[field] = replaceTextDeep(result[field], mod);
      else if (['appendArr', 'prependArr', 'appendIfNotExistsArr', 'removeArr', 'replaceArr', 'replaceOrAppendArr', 'renameArr', 'insertArr'].includes(mod.mode)) {
        result[field] = modifyArray(result[field], mod);
      } else if (mod.mode === 'setProp') result[field] = clone(mod.value);
      else if (mod.mode === 'addSkills') result.skill = { ...(result.skill ?? {}), ...(mod.skills ?? mod) };
      else if (mod.mode === 'replaceName') {
        result[field] = (result[field] ?? []).map((item) => item?.name === mod.replace ? { ...item, name: mod.with } : item);
      } else if (['addSpells', 'replaceSpells', 'removeSpells'].includes(mod.mode)) {
        const spellcasting = clone(result[field] ?? []);
        const block = spellcasting[0] ?? {};
        if (mod.mode === 'addSpells') {
          for (const group of ['will', 'daily', 'rest', 'weekly', 'spells']) {
            if (!mod[group]) continue;
            if (group === 'will') block.will = [...new Set([...(block.will ?? []), ...mod.will])];
            else {
              block[group] ??= {};
              for (const [level, additions] of Object.entries(mod[group])) {
                const additionsList = Array.isArray(additions) ? additions : Array.isArray(additions?.spells) ? additions.spells : [additions];
                if (group === 'spells') {
                  block.spells[level] ??= { spells: [] };
                  block.spells[level].spells = [...new Set([...(block.spells[level].spells ?? []), ...additionsList])];
                } else block[group][level] = [...new Set([...(block[group][level] ?? []), ...additionsList])];
              }
            }
          }
        } else if (mod.mode === 'replaceSpells') {
          for (const [level, replacements] of Object.entries(mod.spells ?? {})) {
            if (!block.spells?.[level]) continue;
            const spells = block.spells?.[level]?.spells ?? [];
            block.spells[level].spells = spells.map((spell) => replacements.find((r) => r.replace.toLowerCase() === String(spell).toLowerCase())?.with ?? spell);
          }
        } else {
          for (const [level, removals] of Object.entries(mod.spells ?? {})) {
            const remove = new Set(removals.map((spell) => String(spell).toLowerCase()));
            if (block.spells?.[level]) block.spells[level].spells = (block.spells[level].spells ?? []).filter((spell) => !remove.has(String(spell).toLowerCase()));
          }
        }
        spellcasting[0] = block;
        result[field] = spellcasting;
      }
      else if (mod.mode === 'scalarAddHit') {
        result = replaceTextDeep(result, { replace: '\\{@hit (\\d+)\\}', with: (_, n) => `{@hit ${Number(n) + Number(mod.scalar ?? 0)}}`, flags: 'g' });
      }
    }
  }
  return result;
}

const documents = [];
const parseErrors = [];
for (const file of files) {
  try {
    let doc = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(doc)) {
      const plural = basename(file, '.json').toLowerCase();
      const key = ({ spells: 'dndDataSpell', monsters: 'dndDataMonster', items: 'dndDataItem', classes: 'dndDataClass', species: 'dndDataSpecies', backgrounds: 'dndDataBackground' })[plural];
      doc = key ? { [key]: doc } : { unsupportedRootArray: doc };
    }
    documents.push({ file, rel: file.startsWith(`${SRC}/`) ? file.slice(SRC.length + 1) : `dnd-data/${basename(file)}`, doc });
  } catch (error) {
    parseErrors.push({ file: file.slice(SRC.length + 1), error: error.message });
  }
}

const registry = new Map();
const registryByName = new Map();
const CORE_SOURCES = new Set(['PHB', 'XPHB', 'DMG', 'XDMG', 'MM', 'XMM', 'TCE', 'XGE', 'VGM', 'MTF', 'MPMM']);
const fluffTypes = {
  monsterFluff: 'monster', itemFluff: 'item', raceFluff: 'species', backgroundFluff: 'background',
  classFluff: 'class', subclassFluff: 'subclass', spellFluff: 'spell', featFluff: 'feat',
  optionalfeatureFluff: 'feature', rewardFluff: 'reward', recipeFluff: 'recipe', diseaseFluff: 'disease',
  hazardFluff: 'hazard', vehicleFluff: 'vehicle', languageFluff: 'language', deityFluff: 'deity',
};
for (const { doc } of documents) {
  for (const [key, values] of Object.entries(doc)) {
    if (!Array.isArray(values)) continue;
    for (const entry of values) {
      if (entry?.name && entry?.source) {
        registry.set(`${key}|${entry.name.toLowerCase()}|${entry.source.toLowerCase()}`, entry);
        const nameKey = `${key}|${entry.name.toLowerCase()}`;
        const candidates = registryByName.get(nameKey) ?? [];
        candidates.push(entry);
        candidates.sort((a, b) => Number(!CORE_SOURCES.has(a.source)) - Number(!CORE_SOURCES.has(b.source)));
        registryByName.set(nameKey, candidates);
      }
      if (fluffTypes[key] && entry?.name) {
        loreIndex.set(`${fluffTypes[key]}|${entry.name.toLowerCase()}|${String(entry.source ?? '').toLowerCase()}`, entriesToMd(entry.entries));
      }
      if (key === 'adventureData' || key === 'bookData') documentIndex.set(`${key === 'adventureData' ? 'adventure' : 'book'}|${entry.id ?? entry.source}`, entry.data ?? []);
      if (key === 'class') for (const spell of entry.classSpells ?? []) {
        const spellSlug = slugify(String(spell).split('|')[0]);
        const classes = spellClassIndex.get(spellSlug) ?? [];
        classes.push(slugify(entry.name));
        spellClassIndex.set(spellSlug, [...new Set(classes)]);
      }
    }
  }
}

// Link explicit fluff references after the fluff records themselves are indexed.
for (const { doc } of documents) for (const [key, values] of Object.entries(doc)) {
  if (!Array.isArray(values) || !MAPPERS[key]) continue;
  for (const entry of values) {
    const ref = entry?.fluff?._monsterFluff ?? entry?.fluff?._itemFluff ?? entry?.fluff?._raceFluff;
    if (!ref || !entry.name) continue;
    const type = key === 'race' || key === 'subrace' ? 'species' : key === 'baseitem' ? 'item' : key;
    const lore = loreIndex.get(`${type}|${String(ref.name).toLowerCase()}|${String(ref.source ?? '').toLowerCase()}`);
    if (lore) loreIndex.set(`${type}|${entry.name.toLowerCase()}|${String(entry.source ?? '').toLowerCase()}`, lore);
  }
}

const copyStats = { found: 0, resolved: 0, unresolved: 0, sourceFallbacks: 0, modes: {} };
function resolveCopy(key, entry, seen = new Set(), track = true) {
  if (!entry?._copy) return entry;
  if (track) copyStats.found++;
  const ref = entry._copy;
  const token = `${key}|${String(ref.name).toLowerCase()}|${String(ref.source).toLowerCase()}`;
  if (seen.has(token)) { if (track) copyStats.unresolved++; return null; }
  const rawBase = registry.get(token) ?? registryByName.get(`${key}|${String(ref.name).toLowerCase()}`)?.[0];
  if (rawBase && !registry.has(token)) copyStats.sourceFallbacks++;
  if (!rawBase) { if (track) copyStats.unresolved++; return null; }
  const base = resolveCopy(key, rawBase, new Set([...seen, token]), false);
  if (!base) { if (track) copyStats.unresolved++; return null; }
  for (const spec of Object.values(ref._mod ?? {}).flatMap((x) => Array.isArray(x) ? x : [x])) {
    if (spec?.mode) copyStats.modes[spec.mode] = (copyStats.modes[spec.mode] ?? 0) + 1;
  }
  const modified = applyCopyMods(base, ref._mod);
  const { _copy, ...overrides } = entry;
  if (track) copyStats.resolved++;
  return { ...modified, ...clone(overrides), name: entry.name ?? ref.name, source: entry.source ?? ref.source };
}

// A large share of lore records are copy-based too; resolve them before mapping
// mechanical entries so explicit fluff references can attach complete prose.
for (const { doc } of documents) for (const [key, values] of Object.entries(doc)) {
  if (!fluffTypes[key] || !Array.isArray(values)) continue;
  for (const raw of values) {
    const entry = raw?._copy ? resolveCopy(key, raw) : raw;
    if (entry?.name) loreIndex.set(`${fluffTypes[key]}|${entry.name.toLowerCase()}|${String(entry.source ?? '').toLowerCase()}`, entriesToMd(entry.entries));
  }
}
for (const { doc } of documents) for (const [key, values] of Object.entries(doc)) {
  if (!Array.isArray(values) || !MAPPERS[key]) continue;
  for (const entry of values) {
    const ref = entry?.fluff?._monsterFluff ?? entry?.fluff?._itemFluff ?? entry?.fluff?._raceFluff;
    if (!ref || !entry.name) continue;
    const type = key === 'race' || key === 'subrace' ? 'species' : key === 'baseitem' ? 'item' : key;
    const lore = loreIndex.get(`${type}|${String(ref.name).toLowerCase()}|${String(ref.source ?? '').toLowerCase()}`);
    if (lore) loreIndex.set(`${type}|${entry.name.toLowerCase()}|${String(entry.source ?? '').toLowerCase()}`, lore);
  }
}

function dndSource(entry) {
  return slugify(`dnd-data-${entry.publisher ?? entry.book ?? 'local'}`);
}
function dndEdition(entry) {
  return /2024/i.test(`${entry.book ?? ''} ${entry.properties?.Edition ?? ''}`) ? '2024' : '2014';
}
const DND_DATA_MAPPERS = {
  dndDataSpell: (s) => put('spell', s.name, dndSource(s), dndEdition(s), {
    level: Number(s.properties?.Level ?? 0), school: String(s.properties?.School ?? '').toLowerCase() || null,
    castingTime: s.properties?.['Casting Time'] ?? null, range: s.properties?.['data-RangeAoe'] ?? s.properties?.Range ?? null,
    components: { v: /V/.test(s.properties?.Components ?? ''), s: /S/.test(s.properties?.Components ?? ''), m: /M/.test(s.properties?.Components ?? ''), materialText: s.properties?.Material ?? null },
    duration: s.properties?.Duration ?? null, concentration: /concentration/i.test(`${s.properties?.Duration ?? ''} ${s.properties?.Concentration ?? ''}`), ritual: !!s.properties?.Ritual,
    classes: String(s.properties?.Classes ?? '').split(/,|\//).map(slugify).filter(Boolean),
    damage: s.properties?.Damage ? { dice: String(s.properties.Damage).replace(/\s/g, ''), type: String(s.properties?.['Damage Type'] ?? '').toLowerCase() || null, scaling: {} } : null,
    attackType: /melee/i.test(s.properties?.['Spell Attack'] ?? '') ? 'melee' : /ranged/i.test(s.properties?.['Spell Attack'] ?? '') ? 'ranged' : null,
    save: slugify(s.properties?.Save ?? '').slice(0, 3) || null,
    partial: !s.properties?.Duration,
  }, s.description ?? ''),
  dndDataMonster: (m) => {
    const challenge = String(m.properties?.['Challenge Rating'] ?? m.properties?.CR ?? '0');
    const cr = challenge.includes('/') ? Number(challenge.split('/')[0]) / Number(challenge.split('/')[1]) : Number(challenge) || 0;
    put('monster', m.name, dndSource(m), dndEdition(m), {
    size: m.properties?.Size ?? null, creatureType: m.properties?.Type ?? null, alignment: m.properties?.Alignment ?? null,
    ac: Number(m.properties?.AC ?? 0) || null, acNote: null,
    hp: { average: Number(m.properties?.HP ?? 0) || null, formula: m.properties?.['Hit Dice'] ?? null },
    speed: { walk: Number(String(m.properties?.Speed ?? '').match(/\d+/)?.[0]) || null, fly: null, swim: null, climb: null, burrow: null, hover: false },
    abilities: Object.fromEntries(ABILITIES.map((a) => [a, m.properties?.[a.toUpperCase()] == null ? null : Number(m.properties[a.toUpperCase()])])),
    saves: {}, skills: {}, senses: m.properties?.Senses ?? '', languages: m.properties?.Languages ?? '', cr, xp: Number(m.properties?.['data-XP'] ?? 0) || null,
    vulnerabilities: [], resistances: [], immunities: [], conditionImmunities: [], traits: [], actions: [], bonusActions: [], reactions: [], legendary: [],
    partial: ABILITIES.some((ability) => m.properties?.[ability.toUpperCase()] == null),
  }, m.description ?? '');
  },
  dndDataItem: (i) => {
    const kind = String(i.properties?.['Item Type'] ?? 'gear').toLowerCase();
    put('item', i.name, dndSource(i), dndEdition(i), {
      itemType: i.properties?.['Item Rarity'] ? 'magic' : /weapon|sword|bow|axe|staff/.test(kind) ? 'weapon' : /armor|shield/.test(kind) ? 'armor' : 'gear',
      rarity: i.properties?.['Item Rarity']?.toLowerCase() ?? null,
      attunement: !!i.properties?.['Requires Attunement'], cost: null, weight: Number(i.properties?.Weight) || null,
      ...(i.properties?.Damage ? { weapon: { category: kind, damage: String(i.properties.Damage).replace(/\s/g, ''), damageType: String(i.properties?.['Damage Type'] ?? '').toLowerCase() || null, properties: String(i.properties?.Properties ?? '').split(',').map((x) => x.trim()).filter(Boolean), mastery: i.properties?.Mastery ?? null, range: null } } : {}),
      ...(i.properties?.AC ? { armor: { category: kind, ac: Number(i.properties.AC), dexCap: null, addDex: null, strengthReq: null, stealthDisadvantage: /disadvantage/i.test(i.properties?.Stealth ?? '') } } : {}),
      partial: true,
    }, i.description ?? '');
  },
  dndDataBackground: (b) => put('background', b.name, dndSource(b), dndEdition(b), { abilityScores: [], feat: null, skills: [], tools: [], equipment: b.properties?.['data-Equipment'] ?? null, feature: null, partial: true }, b.description ?? ''),
  dndDataSpecies: (s) => put('species', s.name, dndSource(s), dndEdition(s), { size: s.properties?.Size ?? null, speed: Number(String(s.properties?.Speed ?? '').match(/\d+/)?.[0]) || 30, traits: [], subspecies: [], darkvision: null, partial: true }, s.description ?? ''),
  dndDataClass: (c) => {
    mapClass({ name: c.name, source: dndSource(c), hd: { faces: Number(String(c.properties?.['Hit Die'] ?? '8').match(/\d+/)?.[0]) || 8 }, proficiency: String(c.properties?.['data-Saving Throws'] ?? '').toLowerCase().match(/str|dex|con|int|wis|cha/g) ?? [], spellcastingAbility: slugify(c.properties?.['Spellcasting Ability'] ?? '').slice(0, 3) || null, casterProgression: c.properties?.['Caster Progression'] ?? null, classFeatures: [], entries: [c.description ?? ''] });
    out.class.at(-1).data.partial = true;
  },
};

const unsupported = {};
const recognizedByKey = {};
const failures = [];
const perFile = [];
let total = 0, failed = 0, empty = 0;
for (const { rel, doc } of documents) {
  activeFile = rel;
  let count = 0;
  const fileUnsupported = {};
  for (const [key, values] of Object.entries(doc)) {
    if (!Array.isArray(values)) continue;
    const mapper = MAPPERS[key] ?? DND_DATA_MAPPERS[key];
    if (!mapper) {
      if (!CONTRIBUTING_KEYS.has(key) && !fluffTypes[key]) {
        unsupported[key] = (unsupported[key] ?? 0) + values.length;
        fileUnsupported[key] = values.length;
      }
      continue;
    }
    recognizedByKey[key] = (recognizedByKey[key] ?? 0) + values.length;
    for (const rawEntry of values) {
      try {
        activeRaw = rawEntry;
        const entry = rawEntry?._copy ? resolveCopy(key, rawEntry) : rawEntry;
        if (!entry) continue;
        mapper(entry);
        count++;
      } catch (error) {
        failed++;
        if (failures.length < 2000) failures.push({ file: rel, key, name: rawEntry?.name ?? null, error: error.message });
        if (failed <= 25) console.error(`  ! ${rel} → ${key} "${rawEntry?.name ?? '?'}": ${error.message}`);
      }
    }
  }
  if (!count) empty++;
  total += count;
  perFile.push({ file: rel, normalized: count, unsupported: fileUnsupported });
}

const duplicateIds = [...entryOrigins].filter(([, origins]) => origins.length > 1)
  .map(([id, origins]) => ({ id, occurrences: origins.length, files: [...new Set(origins)].slice(0, 20) }));
const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  sourceDirectory: SRC,
  summary: {
    filesScanned: files.length,
    filesParsed: documents.length,
    parseErrors: parseErrors.length,
    filesWithoutNormalizedEntries: empty,
    normalizedEntries: Object.values(out).reduce((sum, entries) => sum + entries.length, 0),
    failedEntries: failed,
    duplicateIds: duplicateIds.length,
    copies: copyStats,
  },
  normalizedByType: Object.fromEntries(Object.entries(out).map(([type, entries]) => [type, entries.length]).sort()),
  normalizedBySource: Object.fromEntries(Object.values(out).flat().reduce((counts, entry) => counts.set(entry.source.key, (counts.get(entry.source.key) ?? 0) + 1), new Map())),
  recognizedByKey: Object.fromEntries(Object.entries(recognizedByKey).sort((a, b) => b[1] - a[1])),
  unsupportedByKey: Object.fromEntries(Object.entries(unsupported).sort((a, b) => b[1] - a[1])),
  parseErrors,
  failures,
  duplicateIds,
  files: perFile,
};

if (failed > 25) console.error(`  … and ${failed - 25} more per-entry failures`);
console.log(`${files.length} files scanned; ${empty} contained no normalized entries; ${parseErrors.length} unreadable.`);
for (const [type, entries] of Object.entries(out)) writeFileSync(join(OUT, `${type}.json`), JSON.stringify(entries));
writeFileSync(join(OUT, 'import-report.json'), JSON.stringify(report, null, 2));
console.log(`\nImported ${total} entries (${failed} failed, ${copyStats.resolved}/${copyStats.found} copies resolved) → ${OUT}`);
console.log(`Coverage report → ${join(OUT, 'import-report.json')}`);

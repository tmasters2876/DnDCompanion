// Imports user-supplied 5etools-format JSON from data/sources/ into the internal
// schema (docs/SCHEMA.md), writing data/sources/_normalized/<type>.json.
// Fails loudly per file, partially loads gracefully: a bad file is reported and
// skipped, never blocking the rest.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data', 'sources');
const OUT = join(SRC, '_normalized');
mkdirSync(OUT, { recursive: true });

const EDITION_2024 = new Set(['XPHB', 'XDMG', 'XMM']);
const edition = (src) => (EDITION_2024.has(src) ? '2024' : '2014');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SIZE = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };
const SCHOOL = { A: 'abjuration', C: 'conjuration', D: 'divination', E: 'enchantment', V: 'evocation', I: 'illusion', N: 'necromancy', T: 'transmutation' };

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
    .replace(/\{@\w+ ([^|}]+)(\|[^}]*)?\}/g, '$1');
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
      return e.entries ? entriesToMd(e.entries, depth + 1) : e.entry ? entriesToMd(e.entry, depth + 1) : '';
  }
}

const out = {}; // type -> [entries]
function put(type, name, src, ed, data, text) {
  if (!name || typeof name !== 'string') throw new Error('entry has no name');
  const source = { key: slugify(src ?? 'unknown') || 'unknown', name: src ?? 'Unknown' };
  const slug = slugify(name);
  if (!slug) throw new Error(`unusable name "${name}"`);
  (out[type] ??= []).push({
    id: `${type}/${slug}/${source.key}`,
    type, slug, name, edition: ed ?? edition(src), source, data, text: text ?? '',
  });
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
    classes: [], // 5etools class lists live in separate files; builder falls back to text search
    damage: dmgMatch ? { dice: dmgMatch[1].replace(/\s/g, ''), type: dmgMatch[2].toLowerCase(), scaling: {} } : null,
    attackType: /melee spell attack/i.test(text) ? 'melee' : /ranged spell attack/i.test(text) ? 'ranged' : null,
    save: /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(text)?.[1]?.slice(0, 3).toLowerCase() ?? null,
  }, text);
}

function mapMonster(m) {
  if (m._copy) return; // _copy-based variants need the base entry; out of scope for now
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
    hp: { average: m.hp?.average ?? null, formula: m.hp?.formula ?? null },
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

const MAPPERS = {
  spell: mapSpell,
  monster: mapMonster,
  item: mapItem,
  baseitem: mapItem,
  feat: (f) => put('feat', f.name, f.source, edition(f.source), {
    category: f.category ? String(f.category).toLowerCase() : null,
    prerequisite: f.prerequisite ? stripTags(JSON.stringify(f.prerequisite)) : null,
    repeatable: !!f.repeatable,
  }, entriesToMd(f.entries)),
  background: (b) => put('background', b.name, b.source, edition(b.source), {
    abilityScores: [], feat: null, skills: [], tools: [], equipment: null, feature: null,
  }, entriesToMd(b.entries)),
  race: (r) => put('species', r.name, r.source, edition(r.source), {
    size: SIZE[r.size?.[0]] ?? null,
    speed: typeof r.speed === 'object' ? r.speed.walk : r.speed ?? null,
    traits: (r.entries ?? []).filter((e) => e.name).map((e) => ({ name: stripTags(e.name), text: entriesToMd(e.entries) })),
    subspecies: [],
    darkvision: r.darkvision ?? null,
  }, entriesToMd(r.entries)),
  condition: (c) => put('condition', c.name, c.source, edition(c.source), {}, entriesToMd(c.entries)),
  classFeature: (f) => put('feature', f.name, f.source, edition(f.source), {
    class: slugify(f.className ?? ''), subclass: null, level: f.level ?? null,
  }, entriesToMd(f.entries)),
  subclassFeature: (f) => put('feature', f.name, f.source, edition(f.source), {
    class: slugify(f.className ?? ''), subclass: slugify(f.subclassShortName ?? ''), level: f.level ?? null,
  }, entriesToMd(f.entries)),
  // class/subclass files are complex (progression tables split across features);
  // v1 imports their features for reading, not their full progression.
  class: (c) => put('rule', c.name, c.source, edition(c.source), { category: 'imported-class' },
    `Imported class "${c.name}" — full progression import not yet supported; features are browsable.`),
  subclass: (sc) => put('subclass', sc.name, sc.source, edition(sc.source), {
    class: slugify(sc.className ?? ''), flavor: null, levels: [],
  }, entriesToMd(sc.subclassTableGroups ? [] : sc.entries)),
};

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
const files = [...walk(SRC)];
if (!files.length) {
  console.log('No source files in data/sources/ — nothing to import. (Drop 5etools-format JSON there.)');
}
let total = 0, failed = 0, skipped = 0, empty = 0;
for (const file of files) {
  const rel = file.slice(SRC.length + 1);
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    let count = 0;
    for (const [key, mapper] of Object.entries(MAPPERS)) {
      for (const entry of Array.isArray(doc[key]) ? doc[key] : []) {
        try { mapper(entry); count++; } catch (e) {
          failed++;
          if (failed <= 25) console.error(`  ! ${rel} → ${key} "${entry?.name ?? '?'}": ${e.message}`);
        }
      }
    }
    if (count === 0) empty++;
    total += count;
  } catch (e) {
    skipped++;
    if (skipped <= 25) console.error(`SKIPPED ${rel}: ${e.message}`);
  }
}
if (failed > 25) console.error(`  … and ${failed - 25} more per-entry failures`);
if (skipped > 25) console.error(`  … and ${skipped - 25} more skipped files`);
console.log(`${files.length} files scanned; ${empty} contained no recognized top-level keys; ${skipped} unreadable.`);
for (const [type, entries] of Object.entries(out)) {
  writeFileSync(join(OUT, `${type}.json`), JSON.stringify(entries)); // compact: this corpus is large
}
console.log(`\nImported ${total} entries (${failed} failed) → data/sources/_normalized/`);

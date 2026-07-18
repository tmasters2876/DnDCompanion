// Normalizes raw SRD data (data/raw/) into the internal schema (docs/SCHEMA.md),
// writing one JSON array per type into data/srd/.
//   2024 (srd52): 5e-bits 2024/en for everything except spells + monsters, which
//                 come from Open5e v2 (5e-bits doesn't ship those yet).
//   2014 (srd51): 5e-bits 2014/en for everything.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'data', 'srd');
mkdirSync(OUT, { recursive: true });

const load = (...p) => JSON.parse(readFileSync(join(RAW, ...p), 'utf8'));
const db = (ed, name) => load('5e-database', 'src', ed, 'en', `5e-SRD-${name}.json`);

const SRD52 = { key: 'srd52', name: 'SRD 5.2' };
const SRD51 = { key: 'srd51', name: 'SRD 5.1' };
const ABBR = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const CASTER_KIND = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full',
  paladin: 'half', ranger: 'half', warlock: 'pact',
};

const out = {}; // type -> entries
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function put(type, rawSlug, name, edition, source, data, text) {
  const slug = slugify(rawSlug);
  (out[type] ??= []).push({
    id: `${type}/${slug}/${source.key}`,
    type, slug, name, edition, source, data, text: text ?? '',
  });
}
const desc = (d) => Array.isArray(d) ? d.join('\n\n') : (d ?? '');
const abbr = (x) => ABBR[String(x).toLowerCase()] ?? String(x).toLowerCase();

// Open5e v2 keys look like "<document>_<slug>"; the document key never contains "_".
const stripDoc = (key) => (key.includes('_') ? key.split('_').slice(1).join('_') : key);

// ---------- spells ----------
function open5eSpells(file = 'spells-2024.json', source = SRD52, edition = '2024') {
  for (const s of load('open5e', file)) {
    const slug = stripDoc(s.key);
    const text = [s.desc, s.higher_level].filter(Boolean).join('\n\n**Using a Higher-Level Spell Slot.** ');
    const attackType = /melee spell attack/i.test(s.desc) ? 'melee'
      : /ranged spell attack/i.test(s.desc) ? 'ranged'
      : s.attack_roll ? 'ranged' : null;
    put('spell', slug, s.name, edition, source, {
      level: s.level,
      school: s.school?.key ?? null,
      castingTime: s.casting_time?.toLowerCase().replace(/_/g, ' ') ?? null,
      range: s.range_text || (s.range != null ? `${s.range} ${s.range_unit ?? 'feet'}` : null),
      components: { v: !!s.verbal, s: !!s.somatic, m: !!s.material, materialText: s.material_specified || null },
      duration: s.duration ?? null,
      concentration: !!s.concentration,
      ritual: !!s.ritual,
      classes: (s.classes ?? []).map((c) => stripDoc(c.key)),
      damage: s.damage_roll ? {
        dice: s.damage_roll,
        type: (s.damage_types ?? [])[0] ?? null,
        scaling: Object.fromEntries((s.casting_options ?? [])
          .filter((o) => o.type?.startsWith('slot_level_') && o.damage_roll)
          .map((o) => [o.type.replace('slot_level_', ''), o.damage_roll])),
      } : null,
      attackType,
      save: s.saving_throw_ability ? abbr(s.saving_throw_ability) : null,
    }, text);
  }
}

function srd51Spells() {
  for (const s of db('2014', 'Spells')) {
    const dmgLevels = s.damage?.damage_at_slot_level ?? s.damage?.damage_at_character_level ?? null;
    const baseDice = dmgLevels ? Object.values(dmgLevels)[0] : null;
    put('spell', s.index, s.name, '2014', SRD51, {
      level: s.level,
      school: s.school?.index ?? null,
      castingTime: s.casting_time ?? null,
      range: s.range ?? null,
      components: {
        v: s.components?.includes('V') ?? false,
        s: s.components?.includes('S') ?? false,
        m: s.components?.includes('M') ?? false,
        materialText: s.material ?? null,
      },
      duration: s.duration ?? null,
      concentration: !!s.concentration,
      ritual: !!s.ritual,
      classes: (s.classes ?? []).map((c) => c.index),
      damage: s.damage ? { dice: baseDice, type: s.damage.damage_type?.index ?? null, scaling: dmgLevels ?? {} } : null,
      attackType: s.attack_type ?? null,
      save: s.dc?.dc_type?.index ?? null,
    }, [desc(s.desc), s.higher_level?.length ? `**At Higher Levels.** ${desc(s.higher_level)}` : ''].filter(Boolean).join('\n\n'));
  }
}

// ---------- monsters ----------
const DIE = { D4: 'd4', D6: 'd6', D8: 'd8', D10: 'd10', D12: 'd12', D20: 'd20' };
function parseOpen5eAttack(a) {
  const dice = a.damage_die_count && a.damage_die_type
    ? `${a.damage_die_count}${DIE[a.damage_die_type] ?? a.damage_die_type.toLowerCase()}${a.damage_bonus ? `+${a.damage_bonus}` : ''}`
    : null;
  const type = a.damage_type?.key ?? a.extra_damage_type?.key ?? null;
  return {
    bonus: a.to_hit_mod ?? null,
    reach: a.reach ?? null,
    range: a.range ? { normal: a.range, long: a.long_range } : null,
    damage: dice ? [{ dice, type }] : [],
  };
}
function parseAttackFromDesc(text) {
  const hit = /Attack Roll:\s*([+-]\d+)/.exec(text);
  if (!hit) return null;
  const damage = [];
  for (const m of text.matchAll(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s+(\w+) damage/g)) {
    damage.push({ dice: m[1].replace(/\s/g, ''), type: m[2].toLowerCase() });
  }
  const reach = /reach\s+(\d+)\s*ft/.exec(text);
  const range = /range\s+(\d+)(?:\/(\d+))?\s*ft/.exec(text);
  return {
    bonus: Number(hit[1]),
    reach: reach ? Number(reach[1]) : null,
    range: range ? { normal: Number(range[1]), long: range[2] ? Number(range[2]) : null } : null,
    damage,
  };
}

function open5eMonsters(file = 'creatures-2024.json', source = SRD52, edition = '2024') {
  for (const c of load('open5e', file)) {
    if (!c.ability_scores) continue; // rare partial entries in third-party docs
    const slug = stripDoc(c.key);
    const groups = { ACTION: [], BONUS_ACTION: [], REACTION: [], LEGENDARY_ACTION: [] };
    for (const a of c.actions ?? []) {
      const attack = a.attacks?.length ? parseOpen5eAttack(a.attacks[0]) : parseAttackFromDesc(a.desc ?? '');
      const entry = { name: a.name, text: a.desc ?? '', ...(attack ? { attack } : {}) };
      if (a.usage_limits) entry.name += a.usage_limits.type === 'PER_DAY' ? ` (${a.usage_limits.param}/Day)` : ` (Recharge)`;
      (groups[a.action_type] ?? groups.ACTION).push(entry);
    }
    const senses = [
      c.blindsight_range && `blindsight ${c.blindsight_range} ft.`,
      c.darkvision_range && `darkvision ${c.darkvision_range} ft.`,
      c.tremorsense_range && `tremorsense ${c.tremorsense_range} ft.`,
      c.truesight_range && `truesight ${c.truesight_range} ft.`,
      c.passive_perception != null && `passive Perception ${c.passive_perception}`,
    ].filter(Boolean).join(', ');
    const ri = c.resistances_and_immunities ?? {};
    const speedAll = c.speed_all ?? c.speed ?? {};
    put('monster', slug, c.name, edition, source, {
      size: c.size?.name ?? null,
      creatureType: c.type?.name ?? null,
      alignment: c.alignment ?? null,
      ac: c.armor_class ?? null,
      acNote: c.armor_detail || null,
      hp: { average: c.hit_points ?? null, formula: c.hit_dice ?? null },
      speed: {
        walk: speedAll.walk ?? null, fly: speedAll.fly || null, swim: speedAll.swim || null,
        climb: speedAll.climb || null, burrow: speedAll.burrow || null, hover: !!speedAll.hover,
      },
      abilities: Object.fromEntries(Object.entries(c.ability_scores ?? {}).map(([k, v]) => [abbr(k), v])),
      saves: Object.fromEntries(Object.entries(c.saving_throws ?? {}).map(([k, v]) => [abbr(k), v])),
      skills: c.skill_bonuses ?? {},
      senses,
      languages: c.languages?.as_string ?? '',
      cr: Number(c.challenge_rating ?? 0),
      xp: c.experience_points ?? null,
      vulnerabilities: ri.damage_vulnerabilities ?? [],
      resistances: ri.damage_resistances ?? [],
      immunities: ri.damage_immunities ?? [],
      conditionImmunities: ri.condition_immunities ?? [],
      traits: (c.traits ?? []).map((t) => ({ name: t.name, text: t.desc })),
      actions: groups.ACTION,
      bonusActions: groups.BONUS_ACTION,
      reactions: groups.REACTION,
      legendary: groups.LEGENDARY_ACTION,
    }, [
      `*${c.size?.name ?? ''} ${c.type?.name ?? ''}, ${c.alignment ?? ''}*`,
      ...(c.traits ?? []).map((t) => `**${t.name}.** ${t.desc}`),
      ...(c.actions ?? []).map((a) => `**${a.name}.** ${a.desc}`),
    ].join('\n\n'));
  }
}

function srd51Monsters() {
  const mapAction = (a) => ({
    name: a.name,
    text: desc(a.desc),
    ...(a.attack_bonus != null ? {
      attack: {
        bonus: a.attack_bonus,
        reach: null, range: null,
        damage: (a.damage ?? []).filter((d) => d.damage_dice).map((d) => ({
          dice: d.damage_dice, type: d.damage_type?.index ?? null,
        })),
      },
    } : {}),
  });
  for (const m of db('2014', 'Monsters')) {
    const saves = {}, skills = {};
    for (const p of m.proficiencies ?? []) {
      const name = p.proficiency?.name ?? '';
      if (name.startsWith('Saving Throw:')) saves[name.replace('Saving Throw: ', '').toLowerCase()] = p.value;
      if (name.startsWith('Skill:')) skills[name.replace('Skill: ', '').toLowerCase().replace(/ /g, '_')] = p.value;
    }
    put('monster', m.index, m.name, '2014', SRD51, {
      size: m.size ?? null,
      creatureType: m.type ?? null,
      alignment: m.alignment ?? null,
      ac: Array.isArray(m.armor_class) ? m.armor_class[0]?.value : m.armor_class,
      acNote: Array.isArray(m.armor_class) ? m.armor_class[0]?.type : null,
      hp: { average: m.hit_points, formula: m.hit_points_roll ?? m.hit_dice },
      speed: {
        walk: parseInt(m.speed?.walk) || null, fly: parseInt(m.speed?.fly) || null,
        swim: parseInt(m.speed?.swim) || null, climb: parseInt(m.speed?.climb) || null,
        burrow: parseInt(m.speed?.burrow) || null, hover: !!m.speed?.hover,
      },
      abilities: { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma },
      saves, skills,
      senses: Object.entries(m.senses ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', '),
      languages: m.languages ?? '',
      cr: m.challenge_rating ?? null,
      xp: m.xp ?? null,
      vulnerabilities: m.damage_vulnerabilities ?? [],
      resistances: m.damage_resistances ?? [],
      immunities: m.damage_immunities ?? [],
      conditionImmunities: (m.condition_immunities ?? []).map((ci) => ci.name ?? ci),
      traits: (m.special_abilities ?? []).map(mapAction),
      actions: (m.actions ?? []).map(mapAction),
      bonusActions: [],
      reactions: (m.reactions ?? []).map(mapAction),
      legendary: (m.legendary_actions ?? []).map(mapAction),
    }, [
      `*${m.size ?? ''} ${m.type ?? ''}, ${m.alignment ?? ''}*`,
      ...(m.special_abilities ?? []).map((a) => `**${a.name}.** ${desc(a.desc)}`),
      ...(m.actions ?? []).map((a) => `**${a.name}.** ${desc(a.desc)}`),
    ].join('\n\n'));
  }
}

// ---------- classes / subclasses / features ----------
function classes(ed, source, edition) {
  const classesRaw = db(ed, 'Classes');
  const levelsRaw = db(ed, 'Levels');
  const featuresRaw = db(ed, 'Features');
  const subclassesRaw = db(ed, 'Subclasses');

  for (const f of featuresRaw) {
    put('feature', f.index, f.name, edition, source, {
      class: f.class?.index ?? null,
      subclass: f.subclass?.index ?? null,
      level: f.level ?? null,
    }, desc(f.desc ?? f.description));
  }

  for (const c of classesRaw) {
    const levels = levelsRaw
      .filter((l) => l.class?.index === c.index && !l.subclass)
      .sort((a, b) => a.level - b.level)
      .map((l) => {
        const sc = l.spellcasting;
        return {
          level: l.level,
          profBonus: l.prof_bonus,
          features: (l.features ?? []).map((f) => f.index),
          ...(sc ? {
            slots: Array.from({ length: 9 }, (_, i) => sc[`spell_slots_level_${i + 1}`] ?? 0),
          } : {}),
          classSpecific: {
            ...(l.class_specific ?? {}),
            ...(sc?.cantrips_known != null ? { cantrips_known: sc.cantrips_known } : {}),
            ...(sc?.prepared_spells != null ? { prepared_spells: sc.prepared_spells } : {}),
            ...(sc?.spells_known != null ? { spells_known: sc.spells_known } : {}),
          },
        };
      });
    const skillChoice = (c.proficiency_choices ?? []).find((pc) => /skill/i.test(JSON.stringify(pc).slice(0, 400)));
    put('class', c.index, c.name, edition, source, {
      hitDie: c.hit_die,
      primaryAbilities: (Array.isArray(c.primary_ability) ? c.primary_ability : [c.primary_ability])
        .filter(Boolean).map((a) => a.index ?? abbr(a.name ?? a)),
      saves: (c.saving_throws ?? []).map((s) => s.index),
      proficiencies: {
        armor: (c.proficiencies ?? []).filter((p) => /armor|shield/i.test(p.name)).map((p) => p.name),
        weapons: (c.proficiencies ?? []).filter((p) => /weapon/i.test(p.name)).map((p) => p.name),
        tools: (c.proficiencies ?? []).filter((p) => !/armor|shield|weapon|saving/i.test(p.name)).map((p) => p.name),
        skills: skillChoice ? {
          choose: skillChoice.choose,
          from: (skillChoice.from?.options ?? []).map((o) => o.item?.name?.replace('Skill: ', '') ?? '').filter(Boolean),
        } : null,
      },
      spellcasting: CASTER_KIND[c.index] ? {
        ability: c.spellcasting?.spellcasting_ability?.index ?? { bard: 'cha', cleric: 'wis', druid: 'wis', paladin: 'cha', ranger: 'wis', sorcerer: 'cha', warlock: 'cha', wizard: 'int' }[c.index],
        kind: CASTER_KIND[c.index],
      } : null,
      levels,
      startingEquipment: c.starting_equipment_options ?? c.starting_equipment ?? null,
      multiclass: c.multi_classing ? {
        requirements: (c.multi_classing.prerequisites ?? c.multi_classing.prerequisite_options?.from?.options ?? [])
          .map((p) => p.ability_score ? `${p.ability_score.name} ${p.minimum_score}` : JSON.stringify(p)),
        grants: (c.multi_classing.proficiencies ?? []).map((p) => p.name),
      } : null,
    }, `Hit die: d${c.hit_die}. Saves: ${(c.saving_throws ?? []).map((s) => s.name).join(', ')}.`);
  }

  for (const sc of subclassesRaw) {
    const levels = levelsRaw
      .filter((l) => l.subclass?.index === sc.index)
      .sort((a, b) => a.level - b.level)
      .map((l) => ({ level: l.level, features: (l.features ?? []).map((f) => f.index) }));
    // 2024 subclass levels aren't in Levels.json — recover from Features' level field.
    if (!levels.length) {
      const byLevel = {};
      for (const f of featuresRaw.filter((f) => f.subclass?.index === sc.index)) {
        (byLevel[f.level ?? 0] ??= []).push(f.index);
      }
      for (const [lvl, feats] of Object.entries(byLevel).sort((a, b) => a[0] - b[0])) {
        levels.push({ level: Number(lvl), features: feats });
      }
    }
    put('subclass', sc.index, sc.name, edition, source, {
      class: sc.class?.index ?? null,
      flavor: sc.subclass_flavor ?? null,
      levels,
    }, desc(sc.desc));
  }
}

// ---------- species ----------
function species2024() {
  const traits = db('2024', 'Traits');
  const subspecies = db('2024', 'Subspecies');
  const traitsFor = (kind, index) => traits
    .filter((t) => (t[kind] ?? []).some((s) => s.index === index))
    .map((t) => ({ name: t.name, text: t.description ?? desc(t.desc) }));
  for (const s of db('2024', 'Species')) {
    const own = traitsFor('species', s.index);
    const subs = (s.subspecies ?? []).map((ss) => {
      const full = subspecies.find((x) => x.index === ss.index);
      return { slug: ss.index, name: ss.name, traits: traitsFor('subspecies', ss.index), text: desc(full?.desc ?? full?.description) };
    });
    const dv = own.find((t) => /darkvision/i.test(t.name));
    put('species', s.index, s.name, '2024', SRD52, {
      size: s.size ?? null,
      speed: s.speed ?? null,
      creatureType: s.type ?? null,
      traits: own,
      subspecies: subs,
      darkvision: dv ? (parseInt(/(\d+)/.exec(dv.text)?.[1]) || 60) : null,
    }, own.map((t) => `**${t.name}.** ${t.text}`).join('\n\n'));
  }
}

function species2014() {
  const traits = db('2014', 'Traits');
  const subraces = db('2014', 'Subraces');
  const traitText = (t) => desc(t.desc);
  for (const r of db('2014', 'Races')) {
    const own = traits.filter((t) => (t.races ?? []).some((x) => x.index === r.index))
      .map((t) => ({ name: t.name, text: traitText(t) }));
    const subs = (r.subraces ?? []).map((sr) => {
      const full = subraces.find((x) => x.index === sr.index);
      const st = traits.filter((t) => (t.subraces ?? []).some((x) => x.index === sr.index))
        .map((t) => ({ name: t.name, text: traitText(t) }));
      return {
        slug: sr.index, name: sr.name, traits: st, text: full?.desc ?? '',
        abilityBonuses: (full?.ability_bonuses ?? []).map((b) => ({ ability: b.ability_score?.index, bonus: b.bonus })),
      };
    });
    const dv = own.find((t) => /darkvision/i.test(t.name));
    put('species', r.index, r.name, '2014', SRD51, {
      size: r.size ?? null,
      speed: r.speed ?? null,
      traits: own,
      subspecies: subs,
      darkvision: dv ? (parseInt(/(\d+)/.exec(dv.text)?.[1]) || 60) : null,
      abilityBonuses: (r.ability_bonuses ?? []).map((b) => ({ ability: b.ability_score?.index, bonus: b.bonus })),
    }, [r.alignment, r.age, r.size_description, r.language_desc].filter(Boolean).join('\n\n'));
  }
}

// ---------- backgrounds / feats ----------
function backgrounds(ed, source, edition) {
  for (const b of db(ed, 'Backgrounds')) {
    const profs = b.proficiencies ?? b.starting_proficiencies ?? [];
    put('background', b.index, b.name, edition, source, {
      abilityScores: (b.ability_scores ?? []).map((a) => a.index),
      feat: b.feat?.index ?? null,
      featNote: b.feat?.note ?? null,
      skills: profs.filter((p) => p.index?.startsWith('skill-')).map((p) => p.name.replace('Skill: ', '')),
      tools: profs.filter((p) => p.index?.startsWith('tool-')).map((p) => p.name.replace('Tool: ', '')),
      equipment: b.equipment_options ?? b.starting_equipment ?? null,
      feature: b.feature ? { name: b.feature.name, text: desc(b.feature.desc) } : null,
    }, b.feature ? `**${b.feature.name}.** ${desc(b.feature.desc)}` : '');
  }
}

function feats(ed, source, edition) {
  for (const f of db(ed, 'Feats')) {
    put('feat', f.index, f.name, edition, source, {
      category: f.type ? String(f.type).toLowerCase().replace(/_/g, '-') : null,
      prerequisite: (Array.isArray(f.prerequisites) ? f.prerequisites : []).map((p) =>
        p.ability_score ? `${p.ability_score.name} ${p.minimum_score}` : JSON.stringify(p)).join(', ') || null,
      repeatable: /repeat/i.test(desc(f.desc ?? f.description)),
    }, desc(f.desc ?? f.description));
  }
}

// ---------- items ----------
function equipment(ed, source, edition) {
  const mundaneSlugs = new Set();
  for (const e of db(ed, 'Equipment')) {
    mundaneSlugs.add(e.index);
    const cats = (e.equipment_categories ?? (e.equipment_category ? [e.equipment_category] : [])).map((c) => c.index);
    const isWeapon = cats.some((c) => c?.includes('weapon')) || !!e.weapon_category;
    const isArmor = cats.some((c) => c?.includes('armor') || c === 'shields') || !!e.armor_category;
    const itemType = isWeapon ? 'weapon' : isArmor ? 'armor' : cats.includes('tools') || e.tool_category ? 'tool' : 'gear';
    const props = (e.properties ?? []).map((p) => p.name ?? p.index);
    put('item', e.index, e.name, edition, source, {
      itemType,
      rarity: null,
      attunement: false,
      cost: e.cost ? { qty: e.cost.quantity, unit: e.cost.unit } : null,
      weight: e.weight ?? null,
      categories: cats,
      ...(isWeapon ? {
        weapon: {
          category: e.weapon_category ?? (cats.find((c) => c?.startsWith('martial')) ? 'Martial' : cats.find((c) => c?.startsWith('simple')) ? 'Simple' : null),
          damage: e.damage?.damage_dice ?? null,
          damageType: e.damage?.damage_type?.index ?? null,
          versatileDamage: e.two_handed_damage?.damage_dice ?? props.find((p) => /versatile/i.test(p)) ? e.two_handed_damage?.damage_dice ?? null : null,
          properties: props,
          mastery: e.mastery?.name ?? null,
          range: e.range?.long ? { normal: e.range.normal, long: e.range.long } : null,
        },
      } : {}),
      ...(isArmor ? {
        armor: {
          category: e.armor_category ?? null,
          ac: e.armor_class?.base ?? null,
          dexCap: e.armor_class?.dex_bonus ? (e.armor_class.max_bonus ?? null) : 0,
          addDex: !!e.armor_class?.dex_bonus,
          strengthReq: e.str_minimum || null,
          stealthDisadvantage: !!e.stealth_disadvantage,
        },
      } : {}),
    }, desc(e.desc));
  }
  for (const m of db(ed, 'Magic-Items')) {
    if (m.variant) continue; // variants render under their parent
    // e.g. the "Shield (+1/+2/+3)" variant parent shares its index with mundane Shield
    const slug = mundaneSlugs.has(m.index) ? `${m.index}-magic` : m.index;
    put('item', slug, m.name, edition, source, {
      itemType: 'magic',
      rarity: m.rarity?.name ?? null,
      attunement: m.attunement ?? /requires attunement/i.test(desc(m.desc)),
      cost: null,
      weight: null,
      categories: [m.equipment_category?.index].filter(Boolean),
      variants: (m.variants ?? []).map((v) => v.name),
    }, desc(m.desc));
  }
}

// ---------- conditions / rules ----------
function conditions(ed, source, edition) {
  for (const c of db(ed, 'Conditions')) {
    put('condition', c.index, c.name, edition, source, {}, desc(c.desc ?? c.description));
  }
}
function rules2014() {
  for (const r of db('2014', 'Rules')) put('rule', r.index, r.name, '2014', SRD51, { category: 'rule' }, desc(r.desc));
  for (const r of db('2014', 'Rule-Sections')) put('rule', r.index, r.name, '2014', SRD51, { category: 'rule-section' }, desc(r.desc));
}
function weaponRules(ed, source, edition) {
  for (const w of db(ed, 'Weapon-Properties')) {
    put('rule', `weapon-property-${w.index}`, `Weapon Property: ${w.name}`, edition, source, { category: 'weapon-property' }, desc(w.desc ?? w.description));
  }
  if (ed === '2024') {
    for (const w of db('2024', 'Weapon-Mastery-Properties')) {
      put('rule', `weapon-mastery-${w.index}`, `Weapon Mastery: ${w.name}`, '2024', SRD52, { category: 'weapon-mastery' }, desc(w.desc ?? w.description));
    }
  }
}

// ---------- run ----------
// Openly-licensed third-party documents (OGL / CC-BY via Open5e); 5e-2014-era rules.
const OPEN_SOURCES = {
  'tob-2023': 'Tome of Beasts (2023)',
  tob2: 'Tome of Beasts 2',
  tob3: 'Tome of Beasts 3',
  ccdx: 'Creature Codex',
  'a5e-mm': 'Monstrous Menagerie (A5E)',
  bfrd: 'Black Flag SRD',
  deepm: 'Deep Magic',
  deepmx: 'Deep Magic Extended',
};
const openSource = (key) => ({ key: key.replace(/[^a-z0-9]+/g, ''), name: OPEN_SOURCES[key] });

open5eSpells();
srd51Spells();
open5eMonsters();
srd51Monsters();
for (const key of ['tob-2023', 'tob2', 'tob3', 'ccdx', 'a5e-mm', 'bfrd']) {
  open5eMonsters(`creatures-${key}.json`, openSource(key), '2014');
}
for (const key of ['deepm', 'deepmx']) {
  open5eSpells(`spells-${key}.json`, openSource(key), '2014');
}
classes('2024', SRD52, '2024');
classes('2014', SRD51, '2014');
species2024();
species2014();
backgrounds('2024', SRD52, '2024');
backgrounds('2014', SRD51, '2014');
feats('2024', SRD52, '2024');
feats('2014', SRD51, '2014');
equipment('2024', SRD52, '2024');
equipment('2014', SRD51, '2014');
conditions('2024', SRD52, '2024');
conditions('2014', SRD51, '2014');
rules2014();
weaponRules('2024', SRD52, '2024');
weaponRules('2014', SRD51, '2014');

for (const [type, entries] of Object.entries(out)) {
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.edition.localeCompare(b.edition));
  writeFileSync(join(OUT, `${type}.json`), JSON.stringify(entries, null, 1));
  const by = entries.reduce((m, e) => ((m[e.edition] = (m[e.edition] ?? 0) + 1), m), {});
  console.log(`${type.padEnd(12)} ${String(entries.length).padStart(5)}  (${Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
}
console.log(`\nWrote ${Object.keys(out).length} files to data/srd/`);

import React, { useEffect, useMemo, useState } from 'react';
import { derive, ABILITIES } from '../rules/derive.js';
import { abilityMod, fmtMod } from '../dice/engine.js';

// Phase-6 creation wizard: class → species → background → abilities → skills →
// equipment → spells → review. Produces a choices-only character file; every
// derived number previewed live via the rules engine.

const STEPS = ['class', 'species', 'background', 'abilities', 'skills', 'equipment', 'spells', 'review'];
const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

const sourceKeys = (entry) => new Set([entry.source?.key, ...(entry.provenance ?? [])].filter(Boolean));
const srdRank = (entry) => {
  const keys = sourceKeys(entry);
  return keys.has('srd52') ? 0 : keys.has('srd51') ? 1 : 2;
};

// Search box + SRD-first ordering + capped grid — keeps huge imported lists usable.
function PickList({ items, isActive, onPick, cap = 48, children }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items
    .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => srdRank(a) - srdRank(b) || a.name.localeCompare(b.name))
    .slice(0, cap), [items, q, cap]);
  const total = q ? items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())).length : items.length;
  return (
    <div>
      {items.length > cap && (
        <input placeholder={`Search ${items.length.toLocaleString()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="pickgrid">
        {shown.map((i) => (
          <button key={i.id} className={`pickcard${isActive(i) ? ' active' : ''}`} onClick={() => onPick(i)}>
            <strong>{i.name}</strong>
            <span className="muted">{srdRank(i) < 2 ? (children ? children(i) : i.edition) : i.source.name}</span>
          </button>
        ))}
      </div>
      {total > cap && <p className="muted">Showing {cap} of {total.toLocaleString()} — type to narrow.</p>}
    </div>
  );
}

const useList = (type) => {
  const [list, setList] = useState([]);
  useEffect(() => {
    fetch(`/api/compendium/${type}?limit=2000`).then((r) => r.json()).then((d) => setList(d.results));
  }, [type]);
  return list;
};
const fetchEntry = (type, slug, edition) => fetch(`/api/compendium/${type}/${slug}${edition ? `?edition=${edition}` : ''}`).then((r) => (r.ok ? r.json() : null));

export default function Wizard({ onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [cls, setCls] = useState(null);          // full class entry
  const [species, setSpecies] = useState(null);  // full species entry
  const [subspecies, setSubspecies] = useState(null);
  const [background, setBackground] = useState(null); // full background entry
  const [bgBonus, setBgBonus] = useState({});    // {ability: +2/+1}
  const [baseScores, setBaseScores] = useState({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  const [mode, setMode] = useState('pointbuy');
  const [skills, setSkills] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [cantrips, setCantrips] = useState([]);
  const [spells, setSpells] = useState([]);
  const [name, setName] = useState('New Adventurer');

  const abilities = useMemo(() => {
    const out = { ...baseScores };
    for (const [ab, bonus] of Object.entries(bgBonus)) out[ab] = (out[ab] ?? 8) + bonus;
    return out;
  }, [baseScores, bgBonus]);

  const character = useMemo(() => ({
    name,
    edition: '2024',
    abilities,
    classes: [{ class: cls?.slug, subclass: null, level: 1, hpRolls: [null] }],
    species: species?.slug ?? null,
    subspecies: subspecies ?? null,
    background: background?.slug ?? null,
    proficiencies: {
      skills: [...new Set([...skills, ...(background?.data?.skills ?? []).map((s) => s.toLowerCase().replace(/ /g, '-'))])],
      expertise: [], tools: background?.data?.tools ?? [], languages: ['common'],
    },
    feats: background?.data?.feat ? [background.data.feat] : [],
    equipment: equipment.map((e) => ({ item: e.slug, qty: 1, equipped: e.equipped })),
    spells: { known: [...cantrips, ...spells], prepared: [...spells] },
    hp: { current: 1, temp: 0 },
    slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0,
    conditions: [], deathSaves: { success: 0, fail: 0 },
    currency: { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 },
    overrides: [], notes: '',
  }), [name, abilities, cls, species, subspecies, background, skills, equipment, cantrips, spells]);

  const canNext = {
    class: !!cls,
    species: !!species,
    background: !!background && Object.values(bgBonus).reduce((a, b) => a + b, 0) === 3,

    abilities: true,
    skills: true,
    equipment: true,
    spells: true,
    review: false,
  }[STEPS[step]];

  const create = async () => {
    const preview = { ...character, hp: { current: 0, temp: 0 } };
    // current HP starts at derived max
    const lookup = await previewLookup(character);
    preview.hp.current = derive(character, lookup).maxHp;
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preview),
    });
    onDone((await res.json()).id);
  };

  return (
    <div className="wizard">
      <div className="wizsteps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={i === step ? 'active' : i < step ? 'done' : ''}
            disabled={i > step && !canNext}
            onClick={() => i <= step && setStep(i)}
          >{i + 1}. {s}</button>
        ))}
        <button className="linkish" onClick={onCancel}>cancel</button>
      </div>

      {STEPS[step] === 'class' && <ClassStep cls={cls} setCls={setCls} />}
      {STEPS[step] === 'species' && (
        <SpeciesStep species={species} setSpecies={setSpecies} subspecies={subspecies} setSubspecies={setSubspecies} />
      )}
      {STEPS[step] === 'background' && (
        <BackgroundStep background={background} setBackground={setBackground} bgBonus={bgBonus} setBgBonus={setBgBonus} />
      )}
      {STEPS[step] === 'abilities' && (
        <AbilitiesStep mode={mode} setMode={setMode} baseScores={baseScores} setBaseScores={setBaseScores}
          bgBonus={bgBonus} abilities={abilities} primary={cls?.data?.primaryAbilities ?? []} />
      )}
      {STEPS[step] === 'skills' && <SkillsStep cls={cls} background={background} skills={skills} setSkills={setSkills} />}
      {STEPS[step] === 'equipment' && <EquipmentStep equipment={equipment} setEquipment={setEquipment} />}
      {STEPS[step] === 'spells' && (
        <SpellsStep cls={cls} cantrips={cantrips} setCantrips={setCantrips} spells={spells} setSpells={setSpells} />
      )}
      {STEPS[step] === 'review' && (
        <ReviewStep character={character} name={name} setName={setName} onCreate={create} />
      )}

      {STEPS[step] !== 'review' && (
        <div className="wiznext">
          <button className="bigbutton" disabled={!canNext} onClick={() => setStep(step + 1)}>Next →</button>
          {!canNext && STEPS[step] === 'background' && background && (
            <span className="muted">assign the +2 and +1 to continue</span>
          )}
        </div>
      )}
    </div>
  );
}

function ClassStep({ cls, setCls }) {
  const classes = useList('class').filter((entry) => !entry.partial);
  return (
    <div>
      <PickList
        items={classes}
        isActive={(c) => cls?.slug === c.slug}
        onPick={async (c) => setCls(await fetchEntry('class', c.slug))}
      >
        {(c) => `d${c.hitDie}`}
      </PickList>
      {cls && (
        <p className="wizhint">
          {cls.name}: d{cls.data.hitDie} hit die, saves {cls.data.saves.map((s) => s.toUpperCase()).join('/')}
          {cls.data.spellcasting ? `, ${cls.data.spellcasting.kind} caster (${cls.data.spellcasting.ability.toUpperCase()})` : ', martial'}
          . Subclass unlocks at level 3 via level-up.
        </p>
      )}
    </div>
  );
}

function SpeciesStep({ species, setSpecies, subspecies, setSubspecies }) {
  const list = useList('species').filter((entry) => !entry.partial);
  return (
    <div>
      <PickList
        items={list}
        isActive={(s) => species?.slug === s.slug && species?.source?.key === s.source?.key}
        onPick={async (s) => { setSpecies(await fetchEntry('species', s.slug, s.edition)); setSubspecies(null); }}
      />
      {species?.data?.subspecies?.length > 0 && (
        <p>
          Lineage:{' '}
          <select value={subspecies ?? ''} onChange={(e) => setSubspecies(e.target.value || null)}>
            <option value="">— choose —</option>
            {species.data.subspecies.map((ss) => <option key={ss.slug} value={ss.slug}>{ss.name}</option>)}
          </select>
        </p>
      )}
      {species && (
        <div className="wizhint">
          {species.data.traits.map((t) => <p key={t.name}><strong>{t.name}.</strong> {t.text.slice(0, 160)}{t.text.length > 160 ? '…' : ''}</p>)}
        </div>
      )}
    </div>
  );
}

function BackgroundStep({ background, setBackground, bgBonus, setBgBonus }) {
  const list = useList('background').filter((entry) => !entry.partial);
  // Backgrounds without 2024 ability-score metadata (imports, legacy) allow free
  // assignment anywhere, per the 2024 custom-background rule.
  const opts = background?.data?.abilityScores?.length ? background.data.abilityScores : ABILITIES;
  const assign = (ab, v) => {
    const next = { ...bgBonus };
    for (const k of Object.keys(next)) if (next[k] === v) delete next[k];
    if (v) next[ab] = v; else delete next[ab];
    setBgBonus(next);
  };
  return (
    <div>
      <PickList
        items={list}
        isActive={(b) => background?.slug === b.slug && background?.source?.key === b.source?.key}
        onPick={async (b) => { setBackground(await fetchEntry('background', b.slug, b.edition)); setBgBonus({}); }}
      />
      {background && (
        <div className="wizhint">
          <p>
            Skills: {background.data.skills.join(', ') || '—'} · Tools: {background.data.tools.join(', ') || '—'}
            {background.data.feat && <> · Feat: <strong>{background.data.feat}</strong>{background.data.featNote ? ` (${background.data.featNote})` : ''}</>}
          </p>
          {opts.length > 0 && (
            <p>
              Assign <strong>+2</strong> and <strong>+1</strong> among {background?.data?.abilityScores?.length ? opts.map((o) => o.toUpperCase()).join(', ') : 'any abilities (this background doesn\u2019t specify — 2024 custom-background rule)'}:{' '}
              {opts.map((ab) => (
                <span key={ab} className="bonuspick">
                  {ab.toUpperCase()}
                  <select value={bgBonus[ab] ?? ''} onChange={(e) => assign(ab, Number(e.target.value) || 0)}>
                    <option value="">—</option><option value="2">+2</option><option value="1">+1</option>
                  </select>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AbilitiesStep({ mode, setMode, baseScores, setBaseScores, bgBonus, abilities, primary }) {
  const spent = ABILITIES.reduce((s, a) => s + (POINT_COST[baseScores[a]] ?? 0), 0);
  const setScore = (ab, v) => setBaseScores({ ...baseScores, [ab]: v });
  return (
    <div>
      <p>
        <label><input type="radio" checked={mode === 'pointbuy'} onChange={() => setMode('pointbuy')} /> Point buy ({27 - spent} points left)</label>{' '}
        <label><input type="radio" checked={mode === 'array'} onChange={() => { setMode('array'); }} /> Standard array</label>{' '}
        <label><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Manual</label>
      </p>
      <div className="abilityassign">
        {ABILITIES.map((ab) => (
          <div key={ab} className={`abilitybox${primary.includes(ab) ? ' primary' : ''}`}>
            <div className="abilityname">{ABILITY_NAMES[ab]}{primary.includes(ab) ? ' ★' : ''}</div>
            {mode === 'array' ? (
              <select value={baseScores[ab]} onChange={(e) => setScore(ab, Number(e.target.value))}>
                {[8, ...STANDARD_ARRAY].filter((v, i, a) => a.indexOf(v) === i).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input
                type="number" min={mode === 'manual' ? 3 : 8} max={mode === 'manual' ? 18 : 15}
                value={baseScores[ab]}
                onChange={(e) => setScore(ab, Number(e.target.value))}
              />
            )}
            <div className="muted">
              {bgBonus[ab] ? `+${bgBonus[ab]} bg → ` : ''}{abilities[ab]} ({fmtMod(abilityMod(abilities[ab]))})
            </div>
          </div>
        ))}
      </div>
      {mode === 'pointbuy' && spent > 27 && <p className="warn">Over budget by {spent - 27} points.</p>}
      {mode === 'array' && <p className="wizhint">Assign 15, 14, 13, 12, 10, 8 — duplicates allowed here; the review step won't stop you, it's your table.</p>}
    </div>
  );
}

function SkillsStep({ cls, background, skills, setSkills }) {
  const choice = cls?.data?.proficiencies?.skills;
  const bgSkills = (background?.data?.skills ?? []).map((s) => s.toLowerCase().replace(/ /g, '-'));
  if (!choice) return <p className="muted">No class skill choices.</p>;
  const from = choice.from.map((s) => s.toLowerCase().replace(/ /g, '-'));
  const toggle = (s) => setSkills(skills.includes(s)
    ? skills.filter((x) => x !== s)
    : skills.length < choice.choose ? [...skills, s] : skills);
  return (
    <div>
      <p>Choose {choice.choose} from your class list ({skills.length}/{choice.choose}).
        {bgSkills.length > 0 && <span className="muted"> Background grants {bgSkills.join(', ')}.</span>}</p>
      <div className="pickgrid small">
        {from.map((s) => (
          <button
            key={s}
            className={`pickcard${skills.includes(s) ? ' active' : ''}${bgSkills.includes(s) ? ' dim' : ''}`}
            onClick={() => toggle(s)}
          >{s.replace(/-/g, ' ')}{bgSkills.includes(s) ? ' (bg)' : ''}</button>
        ))}
      </div>
    </div>
  );
}

function EquipmentStep({ equipment, setEquipment }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/compendium/item?q=${encodeURIComponent(q)}&limit=30`)
        .then((r) => r.json()).then((d) => setResults(d.results.filter((i) => i.itemType !== 'magic')));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const add = (i) => !equipment.some((e) => e.slug === i.slug)
    && setEquipment([...equipment, { slug: i.slug, name: i.name, equipped: i.itemType === 'weapon' || i.itemType === 'armor' }]);
  return (
    <div>
      <p className="muted">Add starting gear (your class's standard kit works well — e.g. armor, a weapon or two, a pack). Equip toggles live on the sheet.</p>
      <input placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pickgrid small">
        {results.map((i) => (
          <button key={i.id} className="pickcard" onClick={() => add(i)}>{i.name} <span className="muted">{i.itemType}</span></button>
        ))}
      </div>
      <p>
        {equipment.map((e) => (
          <span key={e.slug} className="badge">
            {e.name} <a className="rowlink" onClick={() => setEquipment(equipment.filter((x) => x.slug !== e.slug))}>×</a>
          </span>
        ))}
      </p>
    </div>
  );
}

function SpellsStep({ cls, cantrips, setCantrips, spells, setSpells }) {
  const sc = cls?.data?.spellcasting;
  const l1 = cls?.data?.levels?.find((l) => l.level === 1);
  const nCantrips = l1?.classSpecific?.cantrips_known ?? 0;
  const nSpells = l1?.classSpecific?.prepared_spells ?? l1?.classSpecific?.spells_known ?? 0;
  const [available, setAvailable] = useState([]);
  useEffect(() => {
    if (!sc) return;
    fetch(`/api/compendium/spell?class=${cls.slug}&limit=2000`)
      .then((r) => r.json()).then((d) => setAvailable(d.results.filter((s) => s.level <= 1)));
  }, [cls?.slug, sc]);

  if (!sc || (nCantrips === 0 && nSpells === 0)) {
    return <p className="muted">No spellcasting at level 1 — skip ahead.</p>;
  }
  const pick = (list, setList, cap) => (slug) => setList(list.includes(slug)
    ? list.filter((x) => x !== slug)
    : list.length < cap ? [...list, slug] : list);
  const cantripList = available.filter((s) => s.level === 0);
  const spellList = available.filter((s) => s.level === 1);
  return (
    <div>
      <p>Cantrips ({cantrips.length}/{nCantrips})</p>
      <div className="pickgrid small">
        {cantripList.map((s) => (
          <button key={s.id} className={`pickcard${cantrips.includes(s.slug) ? ' active' : ''}`}
            onClick={() => pick(cantrips, setCantrips, nCantrips)(s.slug)}>{s.name}</button>
        ))}
      </div>
      <p>Level-1 spells — prepared ({spells.length}/{nSpells})</p>
      <div className="pickgrid small">
        {spellList.map((s) => (
          <button key={s.id} className={`pickcard${spells.includes(s.slug) ? ' active' : ''}`}
            onClick={() => pick(spells, setSpells, nSpells)(s.slug)}>{s.name}</button>
        ))}
      </div>
    </div>
  );
}

async function previewLookup(character) {
  const { lookupFor } = await import('../rules/apiLookup.js');
  return lookupFor(character);
}

function ReviewStep({ character, name, setName, onCreate }) {
  const [view, setView] = useState(null);
  useEffect(() => {
    let live = true;
    previewLookup(character).then((lookup) => live && setView(derive(character, lookup)));
    return () => { live = false; };
  }, [character]);
  return (
    <div>
      <p>Name: <input className="charname" value={name} onChange={(e) => setName(e.target.value)} /></p>
      {view ? (
        <div className="wizhint">
          <p>
            <strong>{character.classes[0].class} 1</strong> · {character.species} · {character.background} —{' '}
            AC <strong>{view.ac}</strong>, HP <strong>{view.maxHp}</strong>, Init {fmtMod(view.initiative)}, Speed {view.speed}
          </p>
          <p>{ABILITIES.map((a) => `${a.toUpperCase()} ${character.abilities[a]} (${fmtMod(view.mods[a])})`).join(' · ')}</p>
          <p>Skills: {Object.entries(view.skills).filter(([s]) => character.proficiencies.skills.includes(s)).map(([s, v]) => `${s} ${fmtMod(v)}`).join(', ') || '—'}</p>
          {view.spellcasting.length > 0 && (
            <p>Spell DC {view.spellcasting[0].saveDc}, attack {fmtMod(view.spellcasting[0].attackMod)} · slots {view.slots.filter((s) => s > 0).map((s, i) => `L${i + 1}×${s}`).join(', ') || '—'}</p>
          )}
        </div>
      ) : <p className="muted">deriving…</p>}
      <p><button className="bigbutton" onClick={onCreate}>Create character</button></p>
    </div>
  );
}

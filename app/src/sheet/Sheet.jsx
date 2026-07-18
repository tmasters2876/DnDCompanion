import React, { useEffect, useMemo, useRef, useState } from 'react';
import { derive, ABILITIES, SKILLS } from '../rules/derive.js';
import { lookupFor } from '../rules/apiLookup.js';
import { fmtMod } from '../dice/engine.js';
import { useRoller } from '../dice/RollContext.jsx';
import Markdown from '../Markdown.jsx';
import LevelUp from '../builder/LevelUp.jsx';

// Phase-5 sheet, v1: layout follows the 2024-sheet structure (header strip,
// abilities+saves rail, skills, attacks, spells with slot pips, inventory,
// features). Every stat is clickable. Visual fidelity pass comes with the
// user's Roll20 screenshots in reference/.

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

export default function Sheet({ id, onBack }) {
  const [character, setCharacter] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [tab, setTab] = useState('actions');
  const [levelingUp, setLevelingUp] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    fetch(`/api/characters/${id}`)
      .then((r) => r.json())
      .then(async (c) => { setLookup(await lookupFor(c)); setCharacter(c); });
  }, [id]);

  // Persist ~1s after the latest change; choices only, derived values never stored.
  const update = (patch) => {
    setCharacter((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        fetch(`/api/characters/${next.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
      }, 800);
      return next;
    });
  };

  const view = useMemo(
    () => (character && lookup ? derive(character, lookup) : null),
    [character, lookup],
  );
  if (!view) return <p className="muted">loading sheet…</p>;

  return (
    <div className="sheet">
      <SheetHeader
        character={character} view={view} update={update} onBack={onBack}
        onLevelUp={() => setLevelingUp(true)}
      />
      {levelingUp && (
        <LevelUp
          character={character}
          lookup={lookup}
          onClose={() => setLevelingUp(false)}
          onApply={async (next) => {
            setLevelingUp(false);
            setLookup(await lookupFor(next)); // new class/subclass may need fetching
            update(() => next);
          }}
        />
      )}
      <div className="sheet-columns">
        <div className="sheet-rail">
          <Abilities view={view} name={character.name} />
          <Skills view={view} name={character.name} />
          <div className="panel">
            <h3>Senses</h3>
            <div className="skillrow"><span>passive Perception</span><span className="skillmod">{view.passivePerception}</span></div>
            <div className="skillrow"><span>passive Investigation</span><span className="skillmod">{10 + view.skills.investigation}</span></div>
            <div className="skillrow"><span>passive Insight</span><span className="skillmod">{10 + view.skills.insight}</span></div>
            {view.darkvision && <div className="skillrow"><span>darkvision</span><span className="skillmod">{view.darkvision}</span></div>}
          </div>
          <div className="panel">
            <h3>Proficiencies &amp; Languages</h3>
            <p className="muted" style={{ margin: '0.2rem 0', fontSize: '0.82rem' }}>
              {(character.proficiencies?.tools ?? []).concat(character.proficiencies?.languages ?? []).join(', ') || '—'}
            </p>
            {(character.feats ?? []).length > 0 && (
              <p className="muted" style={{ margin: '0.2rem 0', fontSize: '0.82rem' }}>
                Feats: {character.feats.map((f) => f.replace(/-/g, ' ')).join(', ')}
              </p>
            )}
          </div>
        </div>
        <div className="sheet-main">
          <nav className="sheettabs">
            {[['actions', 'combat'], ['spells', 'spells'], ['inventory', 'inventory'], ['features', 'features & traits'], ['notes', 'notes']].map(([key, label]) => (
              <button key={key} className={key === tab ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>
          {tab === 'actions' && <Actions view={view} name={character.name} />}
          {tab === 'spells' && <Spells character={character} view={view} update={update} lookup={lookup} />}
          {tab === 'inventory' && <Inventory character={character} update={update} lookup={lookup} />}
          {tab === 'features' && <Features character={character} lookup={lookup} />}
          {tab === 'notes' && (
            <textarea
              className="notes"
              value={character.notes ?? ''}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder="Notes, backstory, allies…"
            />
          )}
        </div>
      </div>
    </div>
  );
}

const CONDITIONS = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'exhaustion'];

function SheetHeader({ character, view, update, onBack, onLevelUp }) {
  const { rollDice } = useRoller();
  const hp = character.hp ?? { current: view.maxHp, temp: 0 };
  const setHp = (current) => update({ hp: { ...hp, current: Math.max(0, Math.min(view.maxHp + 20, current)) } });

  const shortRest = () => update({ pactUsed: 0 }); // pact slots return on short rest
  const longRest = () => update({
    hp: { current: view.maxHp, temp: 0 },
    slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pactUsed: 0,
    deathSaves: { success: 0, fail: 0 },
  });
  const ds = character.deathSaves ?? { success: 0, fail: 0 };
  const tickDeath = (kind) => update({
    deathSaves: { ...ds, [kind]: (ds[kind] + 1) % 4 }, // 4th click wraps to 0
  });
  const toggleCondition = (c) => update({
    conditions: (character.conditions ?? []).includes(c)
      ? character.conditions.filter((x) => x !== c)
      : [...(character.conditions ?? []), c],
  });

  return (
    <div className="sheethead">
      <div>
        <a className="rowlink muted" onClick={onBack}>← characters</a>
        <input
          className="charname"
          value={character.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        <div className="muted subtitle">
          {character.classes.map((c) => `${c.class}${c.subclass ? ` (${c.subclass})` : ''} ${c.level}`).join(' / ')}
          {' · '}{character.species}{' · '}{character.background}
          {' · '}<button className="linkish" onClick={onLevelUp}>level up ↑</button>
          {' '}<button className="linkish" onClick={() => window.print()}>print</button>
        </div>
      </div>
      <div className="statpills">
        <button className="statpill rollable" onClick={() => rollDice({
          label: `${character.name}: Initiative`, formula: `1d20${fmtMod(view.initiative)}`, query: true,
        })}>
          <span className="statval">{fmtMod(view.initiative)}</span><span>Initiative</span>
        </button>
        <div className="statpill"><span className="statval">{view.ac}</span><span>AC</span></div>
        <div className="statpill"><span className="statval">+{view.prof}</span><span>Prof</span></div>
        <div className="statpill"><span className="statval">{view.speed}</span><span>Speed</span></div>
        <div className="statpill hp">
          <span className="statval">
            <button className="hpbtn" onClick={() => setHp(hp.current - 1)}>−</button>
            {hp.current}/{view.maxHp}
            <button className="hpbtn" onClick={() => setHp(hp.current + 1)}>+</button>
          </span>
          <span>Hit Points{hp.temp ? ` (+${hp.temp} temp)` : ''}</span>
        </div>
        <div className="statpill rests">
          <button className="linkish" onClick={shortRest}>short rest</button>
          <button className="linkish" onClick={longRest}>long rest</button>
        </div>
      </div>
      {hp.current === 0 && (
        <div className="deathsaves">
          <strong>Death saves</strong>
          <button className="rollable" onClick={() => rollDice({ label: `${character.name}: Death save`, formula: '1d20', query: true })}>roll</button>
          <span>✓ {Array.from({ length: 3 }, (_, i) => (
            <button key={i} className={`pip${i < ds.success ? '' : ' used'}`} onClick={() => tickDeath('success')} />
          ))}</span>
          <span>✗ {Array.from({ length: 3 }, (_, i) => (
            <button key={i} className={`pip fail${i < ds.fail ? '' : ' used'}`} onClick={() => tickDeath('fail')} />
          ))}</span>
        </div>
      )}
      <div className="conditionbar">
        {CONDITIONS.map((c) => (
          <button
            key={c}
            className={`condchip${(character.conditions ?? []).includes(c) ? ' active' : ''}`}
            onClick={() => toggleCondition(c)}
          >{c}</button>
        ))}
      </div>
    </div>
  );
}

function Abilities({ view, name }) {
  const { rollDice } = useRoller();
  return (
    <div className="panel abilities">
      {ABILITIES.map((a) => (
        <div key={a} className="abilitybox">
          <div className="abilityname">{a.toUpperCase()}</div>
          <button className="rollable abilitymod" onClick={() => rollDice({
            label: `${name}: ${ABILITY_NAMES[a]} check`, formula: `1d20${fmtMod(view.mods[a])}`, query: true,
          })}>{fmtMod(view.mods[a])}</button>
          <div className="abilityscore">{view.abilities[a]}</div>
          <button className="rollable savelink" onClick={() => rollDice({
            label: `${name}: ${ABILITY_NAMES[a]} save`, formula: `1d20${fmtMod(view.saves[a])}`, query: true,
          })}>
            save {fmtMod(view.saves[a])}{view.saveProfs.includes(a) ? ' ●' : ''}
          </button>
        </div>
      ))}
    </div>
  );
}

function Skills({ view, name }) {
  const { rollDice } = useRoller();
  return (
    <div className="panel">
      <h3>Skills</h3>
      {Object.entries(SKILLS).map(([skill, ab]) => (
        <div key={skill} className="skillrow">
          <button className="rollable" onClick={() => rollDice({
            label: `${name}: ${skill.replace(/-/g, ' ')}`, formula: `1d20${fmtMod(view.skills[skill])}`, query: true,
          })}>{skill.replace(/-/g, ' ')}</button>
          <span className="muted">{ab.toUpperCase()}</span>
          <span className="skillmod">{fmtMod(view.skills[skill])}</span>
        </div>
      ))}
      <div className="skillrow passive">
        <span>passive Perception</span><span /><span className="skillmod">{view.passivePerception}</span>
      </div>
    </div>
  );
}

function Actions({ view, name }) {
  const { rollDice } = useRoller();
  if (!view.attacks.length) return <p className="muted">No equipped weapons — equip something in Inventory.</p>;
  return (
    <table className="attacks">
      <thead><tr><th>Attack</th><th>Hit</th><th>Damage</th><th /></tr></thead>
      <tbody>
        {view.attacks.map((a) => (
          <tr key={a.name}>
            <td>{a.name}{a.mastery && <span className="badge">{a.mastery}</span>}</td>
            <td>
              <button className="rollable" onClick={() => rollDice({
                label: `${name}: ${a.name}`, sublabel: 'to hit', formula: a.toHit, query: true,
              })}>{fmtMod(a.toHitMod)}</button>
            </td>
            <td>
              <button className="rollable dmg" onClick={() => rollDice({
                label: `${name}: ${a.name}`, sublabel: a.damageType, formula: a.damage,
              })}>{a.damage}</button>
              {a.versatile && (
                <button className="rollable dmg subtle" onClick={() => rollDice({
                  label: `${name}: ${a.name} (two-handed)`, sublabel: a.damageType, formula: a.versatile,
                })}>{a.versatile}</button>
              )}
            </td>
            <td className="muted">{a.properties.join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Spells({ character, view, update, lookup }) {
  const { rollDice } = useRoller();
  const used = character.slotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const toggleSlot = (lvlIdx, slotIdx) => {
    const next = [...used];
    next[lvlIdx] = slotIdx < used[lvlIdx] ? slotIdx : slotIdx + 1;
    update({ slotsUsed: next });
  };

  const spells = (character.spells?.known ?? [])
    .map((slug) => lookup.get('spell', slug))
    .filter(Boolean)
    .sort((a, b) => a.data.level - b.data.level || a.name.localeCompare(b.name));

  return (
    <div>
      {view.spellcasting.map((sc) => (
        <p key={sc.class} className="muted">
          {sc.class}: save DC <strong>{sc.saveDc}</strong>, attack {fmtMod(sc.attackMod)},
          {' '}prepares {sc.preparedMax}, cantrips {sc.cantripsKnown}
        </p>
      ))}
      <div className="slotrows">
        {view.slots.map((n, i) => n > 0 && (
          <div key={i} className="slotrow">
            <span className="muted">L{i + 1}</span>
            {Array.from({ length: n }, (_, s) => (
              <button
                key={s}
                className={`pip${s < used[i] ? ' used' : ''}`}
                title={s < used[i] ? 'restore slot' : 'expend slot'}
                onClick={() => toggleSlot(i, s)}
              />
            ))}
          </div>
        ))}
        {view.pact && (
          <div className="slotrow">
            <span className="muted">Pact L{view.pact.level}</span>
            {Array.from({ length: view.pact.count }, (_, s) => (
              <button
                key={s}
                className={`pip pact${s < (character.pactUsed ?? 0) ? ' used' : ''}`}
                onClick={() => update({ pactUsed: s < (character.pactUsed ?? 0) ? s : s + 1 })}
              />
            ))}
          </div>
        )}
      </div>
      {spells.length === 0 && <p className="muted">No spells yet — add slugs to spells.known (builder wizard lands in Phase 6), or browse the compendium.</p>}
      {spells.map((s) => {
        const atkMod = view.spellcasting[0]?.attackMod ?? 0;
        return (
          <div key={s.id} className="spellrow">
            <span className="muted">{s.data.level === 0 ? 'C' : s.data.level}</span>
            <a className="rowlink" href={`#/spell/${s.slug}`}>{s.name}</a>
            {character.spells?.prepared?.includes(s.slug) && <span className="badge">prepared</span>}
            {s.data.attackType && (
              <button className="rollable atk" title={`Spell attack 1d20${atkMod >= 0 ? '+' : ''}${atkMod}`}
                onClick={() => rollDice({
                  label: `${character.name}: ${s.name}`,
                  sublabel: `${s.data.attackType} spell attack`,
                  formula: `1d20${atkMod >= 0 ? '+' : ''}${atkMod}`,
                  query: true,
                })}>atk {atkMod >= 0 ? '+' : ''}{atkMod}</button>
            )}
            {s.data.save && <span className="badge">{s.data.save.toUpperCase()} DC {view.spellcasting[0]?.saveDc ?? '—'}</span>}
            {s.data.damage?.dice && (
              <button className="rollable dmg" onClick={() => rollDice({
                label: `${character.name}: ${s.name}`, sublabel: s.data.damage.type, formula: s.data.damage.dice,
              })}>{s.data.damage.dice}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Inventory({ character, update, lookup }) {
  return (
    <table className="listing">
      <thead><tr><th>Item</th><th>Qty</th><th>Equipped</th></tr></thead>
      <tbody>
        {(character.equipment ?? []).map((e, i) => {
          const item = lookup.get('item', e.item);
          return (
            <tr key={i}>
              <td><a className="rowlink" href={`#/item/${e.item}`}>{item?.name ?? e.item}</a></td>
              <td className="muted">{e.qty ?? 1}</td>
              <td>
                <input
                  type="checkbox"
                  checked={!!e.equipped}
                  onChange={() => update((prev) => ({
                    ...prev,
                    equipment: prev.equipment.map((x, xi) => (xi === i ? { ...x, equipped: !x.equipped } : x)),
                  }))}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Features({ character, lookup }) {
  const [open, setOpen] = useState(null);
  const sections = character.classes.map((c) => {
    const entry = lookup.get('class', c.class);
    const features = (entry?.data?.levels ?? [])
      .filter((l) => l.level <= c.level)
      .flatMap((l) => l.features.map((f) => ({ level: l.level, slug: f })));
    return { class: c.class, features };
  });
  const openFeature = async (slug) => setOpen(await lookup.fetch('feature', slug));

  return (
    <div>
      {sections.map((s) => (
        <div key={s.class}>
          <h3>{s.class}</h3>
          {s.features.map((f) => (
            <div key={f.slug} className="skillrow">
              <button className="rollable" onClick={() => openFeature(f.slug)}>{f.slug.replace(/-/g, ' ')}</button>
              <span className="muted">L{f.level}</span>
            </div>
          ))}
        </div>
      ))}
      {open && (
        <div className="featurebox">
          <h3>{open.name}</h3>
          <Markdown text={open.text} />
          <p><a className="rowlink" onClick={() => setOpen(null)}>close</a></p>
        </div>
      )}
    </div>
  );
}

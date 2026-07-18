import React, { useState } from 'react';
import Markdown from '../Markdown.jsx';
import { useRoller } from '../dice/RollContext.jsx';
import { fmtMod } from '../dice/engine.js';
import { entryRolls } from './mechanics.js';

const MOD_KEY = 'dnd-companion.genericAtkMod';
const label = (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
const printable = (value) => {
  if (value == null || value === '' || value === false) return null;
  if (value === true) return 'yes';
  if (Array.isArray(value)) return value.filter((item) => typeof item !== 'object').join(', ') || null;
  if (typeof value === 'object' && value.qty != null) return `${value.qty} ${value.unit ?? ''}`.trim();
  return typeof value === 'object' ? null : String(value);
};

function StructuredSummary({ entry }) {
  const d = entry.data ?? {};
  const fields = [];
  const add = (name, value) => { const shown = printable(value); if (shown) fields.push([name, shown]); };
  add('type', d.itemType);
  add('rarity', d.rarity);
  add('attunement', d.attunement ? 'required' : null);
  add('cost', d.cost);
  add('weight', d.weight != null ? `${d.weight} lb.` : null);
  if (d.armor) {
    add('armor class', d.armor.ac);
    add('armor category', d.armor.category);
    add('strength required', d.armor.strengthReq);
    add('stealth disadvantage', d.armor.stealthDisadvantage);
  }
  if (d.weapon) {
    add('weapon category', d.weapon.category);
    add('range', d.weapon.range ? `${d.weapon.range.normal}${d.weapon.range.long ? `/${d.weapon.range.long}` : ''} ft.` : null);
    add('properties', d.weapon.properties);
  }
  add('class', d.class);
  add('subclass', d.subclass);
  add('level', d.level);
  add('category', d.category);
  for (const [key, value] of Object.entries(d.properties ?? {})) {
    if (['page', 'hasToken', 'hasFluffImages'].includes(key)) continue;
    add(label(key), value);
  }
  if (d.levels?.length) add('feature levels', d.levels.map((row) => row.level));
  if (d.items?.length) add('contents', d.items);
  if (!fields.length) return null;
  return (
    <dl className="structured-summary">
      {fields.map(([name, value]) => <React.Fragment key={`${name}-${value}`}><dt>{name}</dt><dd>{value}</dd></React.Fragment>)}
    </dl>
  );
}

export default function GenericCard({ entry }) {
  const { rollDice } = useRoller();
  const mechanics = entryRolls(entry);
  const adjustableAttack = !!entry.data?.weapon && mechanics.attack?.bonus == null;
  const [attackMod, setAttackMod] = useState(() => {
    const saved = Number(localStorage.getItem(MOD_KEY));
    return Number.isFinite(saved) ? saved : 5;
  });
  const setAndSave = (value) => {
    const next = Math.max(-5, Math.min(20, Number(value) || 0));
    setAttackMod(next);
    localStorage.setItem(MOD_KEY, String(next));
  };
  const bonus = mechanics.attack?.bonus ?? attackMod;
  return (
    <div className="detail genericcard">
      <h2>{entry.name}</h2>
      <StructuredSummary entry={entry} />
      {(mechanics.attack || adjustableAttack || mechanics.damage.length || mechanics.healing.length || mechanics.save) && (
        <div className="mechanicbar">
          {(mechanics.attack?.bonus != null || adjustableAttack) && (
            <button className="rollable atk" onClick={() => rollDice({
              label: `${entry.name}: attack`, sublabel: 'to hit', formula: `1d20${fmtMod(bonus)}`, query: true,
            })}>attack {fmtMod(bonus)}</button>
          )}
          {adjustableAttack && (
            <label className="modinput" title="Wielder's attack bonus">mod
              <input type="number" value={attackMod} min={-5} max={20} onChange={(event) => setAndSave(event.target.value)} />
            </label>
          )}
          {mechanics.damage.map((damage, index) => (
            <button key={`${damage.formula}-${damage.type}-${index}`} className="rollable dmg" onClick={() => rollDice({
              label: entry.name, sublabel: damage.type, formula: damage.formula,
            })}>{damage.formula} {damage.type}</button>
          ))}
          {mechanics.healing.map((heal, index) => (
            <button key={`heal-${index}`} className="rollable heal" onClick={() => rollDice({
              label: entry.name, sublabel: 'healing', formula: heal.formula,
            })}>{heal.formula} healing</button>
          ))}
          {mechanics.save && <span className="savechip">{mechanics.save.ability.toUpperCase()} save DC {mechanics.save.dc}</span>}
        </div>
      )}
      {entry.text && <Markdown text={entry.text} />}
    </div>
  );
}

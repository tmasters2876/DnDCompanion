import React, { useState } from 'react';
import Markdown from '../Markdown.jsx';
import { useRoller } from '../dice/RollContext.jsx';
import { fmtMod } from '../dice/engine.js';

const ORDINAL = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
export const spellLevelText = (lvl, school) =>
  lvl === 0 ? `${school ?? ''} cantrip` : `${ORDINAL[lvl]}-level ${school ?? ''}`;

const MOD_KEY = 'dnd-companion.spellAtkMod';

// attackMod: pass the caster's spell attack bonus when known (character sheet).
// Standalone cards (DM screen, compendium) show an adjustable modifier instead,
// remembered across spells — the DM sets it once per caster.
export default function SpellCard({ entry, attackMod }) {
  const { rollDice } = useRoller();
  const d = entry.data;
  const [mod, setMod] = useState(() => {
    if (attackMod != null) return attackMod;
    const saved = Number(localStorage.getItem(MOD_KEY));
    return Number.isFinite(saved) ? saved : 5;
  });
  const setAndSave = (v) => {
    const n = Math.max(-5, Math.min(20, Number(v) || 0));
    setMod(n);
    localStorage.setItem(MOD_KEY, String(n));
  };
  const comp = [d.components.v && 'V', d.components.s && 'S', d.components.m && 'M'].filter(Boolean).join(', ')
    + (d.components.materialText ? ` (${d.components.materialText})` : '');

  return (
    <div className="spellcard">
      <h2>{entry.name}</h2>
      <p className="muted"><em>{spellLevelText(d.level, d.school)}{d.ritual ? ' (ritual)' : ''}</em></p>
      <div className="spellmeta">
        <div><strong>Casting Time</strong>{d.castingTime}</div>
        <div><strong>Range</strong>{d.range}</div>
        <div><strong>Components</strong>{comp || '—'}</div>
        <div><strong>Duration</strong>{d.concentration ? `Concentration, ${d.duration}` : d.duration}</div>
      </div>
      {(d.damage || d.save || d.attackType) && (
        <p className="spellrolls">
          {d.attackType && (
            <>
              <button
                className="rollable atk"
                title="Roll the spell attack (asks advantage/disadvantage)"
                onClick={() => rollDice({
                  label: entry.name,
                  sublabel: `${d.attackType} spell attack`,
                  formula: `1d20${fmtMod(mod)}`,
                  query: true,
                })}
              >{d.attackType} attack {fmtMod(mod)}</button>
              {attackMod == null && (
                <label className="modinput" title="Caster's spell attack bonus">
                  mod
                  <input type="number" value={mod} min={-5} max={20} onChange={(e) => setAndSave(e.target.value)} />
                </label>
              )}
            </>
          )}
          {d.save && <span className="badge">{d.save.toUpperCase()} save</span>}
          {d.damage?.dice && (
            <button className="rollable dmg" onClick={() => rollDice({
              label: entry.name,
              sublabel: `${d.damage.type ?? 'damage'}`,
              formula: d.damage.dice,
            })}>{d.damage.dice} {d.damage.type}</button>
          )}
          {Object.entries(d.damage?.scaling ?? {}).map(([slot, dice]) => (
            <button key={slot} className="rollable dmg subtle" onClick={() => rollDice({
              label: entry.name,
              sublabel: `at slot level ${slot}`,
              formula: dice,
            })}>L{slot}: {dice}</button>
          ))}
        </p>
      )}
      <Markdown text={entry.text} />
      {d.classes?.length > 0 && (
        <p className="muted">Classes: {d.classes.join(', ')}</p>
      )}
    </div>
  );
}

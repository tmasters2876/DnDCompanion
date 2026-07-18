import React from 'react';
import Markdown from '../Markdown.jsx';
import { useRoller } from '../dice/RollContext.jsx';

const ORDINAL = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
export const spellLevelText = (lvl, school) =>
  lvl === 0 ? `${school ?? ''} cantrip` : `${ORDINAL[lvl]}-level ${school ?? ''}`;

export default function SpellCard({ entry }) {
  const { rollDice } = useRoller();
  const d = entry.data;
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
          {d.attackType && <span className="badge">{d.attackType} spell attack</span>}
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

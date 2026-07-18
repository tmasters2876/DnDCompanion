import React from 'react';
import Markdown from '../Markdown.jsx';
import { useRoller } from '../dice/RollContext.jsx';
import { fmtMod, abilityMod } from '../dice/engine.js';
import { actionMechanics } from './mechanics.js';

const CR_NAMES = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const crText = (cr) => CR_NAMES[cr] ?? String(cr);
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function ActionEntry({ monster, entry, group }) {
  const { rollDice } = useRoller();
  const mechanics = actionMechanics(entry);
  const a = mechanics.attack;
  const rollAttack = () => rollDice({
    label: `${monster.name}: ${entry.name}`,
    sublabel: 'to hit',
    formula: `1d20${fmtMod(a.bonus)}`,
    query: true,
  });
  return (
    <div className="sb-entry">
      <span className="sb-entry-name">
        {a?.bonus != null ? (
          <button className="rollable" title={`Attack: 1d20${fmtMod(a.bonus)}`} onClick={rollAttack}>
            {entry.name}
          </button>
        ) : entry.name}
        {group && <em className="muted"> ({group})</em>}.
      </span>{' '}
      <Markdown text={entry.text} />
      {(a?.bonus != null || a?.damage?.length > 0 || mechanics.damage.length > 0 || mechanics.healing.length > 0 || mechanics.save) && (
        <span className="dmgbuttons">
          {a?.bonus != null && (
            <button className="rollable atk" title="Roll to hit (asks advantage/disadvantage)" onClick={rollAttack}>
              attack {fmtMod(a.bonus)}
            </button>
          )}
          {(a?.damage ?? []).map((d, i) => (
            <button
              key={i}
              className="rollable dmg"
              title="Roll damage"
              onClick={() => rollDice({
                label: `${monster.name}: ${entry.name}`,
                sublabel: `${d.type ?? 'damage'}`,
                formula: d.dice,
              })}
            >{d.dice} {d.type}</button>
          ))}
          {!a && mechanics.damage.map((d, i) => (
            <button key={`fallback-${i}`} className="rollable dmg" title="Roll damage" onClick={() => rollDice({
              label: `${monster.name}: ${entry.name}`, sublabel: d.type, formula: d.formula,
            })}>{d.formula} {d.type}</button>
          ))}
          {mechanics.healing.map((heal, i) => (
            <button key={`heal-${i}`} className="rollable heal" title="Roll healing" onClick={() => rollDice({
              label: `${monster.name}: ${entry.name}`, sublabel: 'healing', formula: heal.formula,
            })}>{heal.formula} healing</button>
          ))}
          {mechanics.save && <span className="savechip">{mechanics.save.ability.toUpperCase()} save DC {mechanics.save.dc}</span>}
        </span>
      )}
    </div>
  );
}

function Section({ monster, title, entries, group }) {
  if (!entries?.length) return null;
  return (
    <>
      {title && <h3 className="sb-section">{title}</h3>}
      {entries.map((e, i) => <ActionEntry key={i} monster={monster} entry={e} group={group} />)}
    </>
  );
}

export default function StatBlock({ entry }) {
  const { rollDice } = useRoller();
  const d = entry.data;
  const speed = Object.entries(d.speed ?? {})
    .filter(([k, v]) => v && k !== 'hover')
    .map(([k, v]) => `${k === 'walk' ? '' : k + ' '}${v} ft.${k === 'fly' && d.speed.hover ? ' (hover)' : ''}`)
    .join(', ');

  const rollCheck = (ab) => rollDice({
    label: `${entry.name}: ${ab.toUpperCase()} check`,
    formula: `1d20${fmtMod(abilityMod(d.abilities[ab]))}`,
    query: true,
  });
  const rollSave = (ab) => rollDice({
    label: `${entry.name}: ${ab.toUpperCase()} save`,
    formula: `1d20${fmtMod(d.saves[ab] ?? abilityMod(d.abilities[ab]))}`,
    query: true,
  });

  return (
    <div className="statblock">
      <h2>{entry.name}</h2>
      <p className="sb-meta"><em>{d.size} {d.creatureType}, {d.alignment}</em></p>
      <div className="sb-rule" />
      <p><strong>AC</strong> {d.ac}{d.acNote ? ` (${d.acNote})` : ''}{' '}
        <strong>HP</strong>{' '}
        {d.hp.formula ? (
          <button className="rollable" title={d.hp.formula}
            onClick={() => rollDice({ label: `${entry.name}: Hit Points`, formula: d.hp.formula.replace(/\s/g, '') })}>
            {d.hp.average} ({d.hp.formula})
          </button>
        ) : d.hp.average}{' '}
        <strong>Speed</strong> {speed}
      </p>
      <div className="sb-rule" />
      <table className="sb-abilities">
        <tbody>
          <tr>{ABILITIES.map((ab) => <th key={ab}>{ab.toUpperCase()}</th>)}</tr>
          <tr>
            {ABILITIES.map((ab) => (
              <td key={ab}>
                <button className="rollable" onClick={() => rollCheck(ab)}>
                  {d.abilities[ab]} ({fmtMod(abilityMod(d.abilities[ab] ?? 10))})
                </button>
              </td>
            ))}
          </tr>
          <tr className="sb-saverow">
            {ABILITIES.map((ab) => (
              <td key={ab}>
                <button className="rollable" title={`${ab.toUpperCase()} save`} onClick={() => rollSave(ab)}>
                  save {fmtMod(d.saves?.[ab] ?? abilityMod(d.abilities[ab] ?? 10))}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="sb-rule" />
      {Object.keys(d.skills ?? {}).length > 0 && (
        <p><strong>Skills</strong> {Object.entries(d.skills).map(([k, v], i) => (
          <React.Fragment key={k}>
            {i > 0 && ', '}
            <button className="rollable" onClick={() => rollDice({
              label: `${entry.name}: ${k.replace(/_/g, ' ')}`, formula: `1d20${fmtMod(v)}`, query: true,
            })}>{k.replace(/_/g, ' ')} {fmtMod(v)}</button>
          </React.Fragment>
        ))}</p>
      )}
      {d.vulnerabilities?.length > 0 && <p><strong>Vulnerabilities</strong> {d.vulnerabilities.join(', ')}</p>}
      {d.resistances?.length > 0 && <p><strong>Resistances</strong> {d.resistances.join(', ')}</p>}
      {d.immunities?.length > 0 && <p><strong>Immunities</strong> {d.immunities.join(', ')}</p>}
      {d.conditionImmunities?.length > 0 && <p><strong>Condition Immunities</strong> {d.conditionImmunities.join(', ')}</p>}
      {d.senses && <p><strong>Senses</strong> {d.senses}</p>}
      {d.languages && <p><strong>Languages</strong> {d.languages}</p>}
      <p><strong>CR</strong> {crText(d.cr)}{d.xp ? ` (XP ${d.xp.toLocaleString()})` : ''}</p>
      <div className="sb-rule" />
      <Section monster={entry} entries={d.traits} />
      <Section monster={entry} title="Actions" entries={d.actions} />
      <Section monster={entry} title="Bonus Actions" entries={d.bonusActions} />
      <Section monster={entry} title="Reactions" entries={d.reactions} />
      <Section monster={entry} title="Legendary Actions" entries={d.legendary} />
      {!['traits', 'actions', 'bonusActions', 'reactions', 'legendary'].some((group) => d[group]?.length) && entry.text && (
        <Section monster={entry} title="Mechanics" entries={[{ name: 'Combat', text: entry.text }]} />
      )}
    </div>
  );
}

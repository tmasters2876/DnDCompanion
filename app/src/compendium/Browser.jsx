import React, { useEffect, useMemo, useState } from 'react';
import { useRoller } from '../dice/RollContext.jsx';
import { dmHeaders } from '../homebrew/dmProfile.js';
import { stashSearch } from '../homebrew/localStash.js';

// Full-page listings with per-type filters. The whole type list is fetched once
// (local app, ≤1k summaries) and filtered client-side for instant response.

const CR_NAMES = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const crText = (cr) => CR_NAMES[cr] ?? String(cr);
const LEVELS = ['C', 1, 2, 3, 4, 5, 6, 7, 8, 9];

const uniq = (rows, key) => [...new Set(rows.map((r) => r[key]).filter((v) => v != null))]
  .sort((a, b) => (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))));

function Select({ value, onChange, options, label, fmt = String }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}
    </select>
  );
}

// Search/filter state survives detail-and-back navigation (per type, per session)
// so "back to list" returns to the narrowed list, not the full corpus.
const stateKey = (type) => `dnd-companion.browse.${type}`;
const loadBrowseState = (type) => {
  try { return JSON.parse(sessionStorage.getItem(stateKey(type))) ?? {}; } catch { return {}; }
};

export default function Browser({ type, onOpen }) {
  const { rollDice } = useRoller();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState(() => loadBrowseState(type).q ?? '');
  const [edition, setEdition] = useState(() => loadBrowseState(type).edition ?? '');
  const [f, setF] = useState(() => loadBrowseState(type).f ?? {});
  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));
  const hasNarrowing = q !== '' || edition !== '' || Object.values(f).some((v) => v !== '' && v !== undefined);
  const clearAll = () => { setQ(''); setEdition(''); setF({}); };

  // Save keyed by the SETTLED type (ref), never the changing prop: on a type
  // switch the state variables still hold the previous type's filters for one
  // render, and writing them under the new key would leak filters across types
  // (monster CR=10 emptying the class list — a caught-in-e2e bug).
  const mountedType = React.useRef(type);
  useEffect(() => {
    sessionStorage.setItem(stateKey(mountedType.current), JSON.stringify({ q, edition, f }));
  }, [q, edition, f]);

  // restore on type CHANGE only — mount already restored via initializers, and
  // re-running on mount would clobber anything the user typed before effects ran
  useEffect(() => {
    if (mountedType.current === type) return;
    mountedType.current = type;
    const restored = loadBrowseState(type);
    setQ(restored.q ?? ''); setEdition(restored.edition ?? ''); setF(restored.f ?? {});
  }, [type]);

  useEffect(() => {
    fetch(`/api/compendium/${type}?limit=50000${edition ? `&edition=${edition}` : ''}`, { headers: dmHeaders() })
      .then((r) => r.json())
      .then((d) => setRows([...stashSearch(type, ''), ...d.results]));
  }, [type, edition]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (f.level !== undefined && f.level !== '' && r.level !== Number(f.level)) return false;
    if (f.school && r.school !== f.school) return false;
    if (f.class && !(r.classes ?? []).includes(f.class) && r.class !== f.class) return false;
    if (f.cr !== undefined && f.cr !== '' && r.cr !== Number(f.cr)) return false;
    if (f.size && r.size !== f.size) return false;
    if (f.creatureType && r.creatureType !== f.creatureType) return false;
    if (f.itemType && r.itemType !== f.itemType) return false;
    if (f.rarity && r.rarity !== f.rarity) return false;
    if (f.category && r.category !== f.category) return false;
    return true;
  }), [rows, q, f]);

  const cols = {
    spell: ['level', 'school'],
    monster: ['cr', 'size', 'creatureType'],
    item: ['itemType', 'rarity'],
    feat: ['category'],
    feature: ['class', 'level'],
    subclass: ['class'],
    rule: ['category'],
    table: ['dice', 'columns'],
    adventure: ['level', 'published'],
    book: ['author', 'published'],
    language: ['category'],
    disease: ['category'],
    deity: ['category'],
    reward: ['category'],
    recipe: ['category'],
  }[type] ?? [];

  return (
    <div>
      <div className="toolbar">
        <input placeholder={`Search ${filtered.length} ${type}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={edition} onChange={(e) => setEdition(e.target.value)}>
          <option value="">Current (2024 first)</option>
          <option value="2024">2024 only</option>
          <option value="2014">2014 only</option>
        </select>
        {type === 'spell' && (
          <>
            <div className="levelpips">
              {LEVELS.map((l, i) => (
                <button
                  key={l}
                  className={String(f.level ?? '') === String(i === 0 ? 0 : l) ? 'active' : ''}
                  onClick={() => set('level')(String(f.level ?? '') === String(i === 0 ? 0 : l) ? '' : String(i === 0 ? 0 : l))}
                >{l}</button>
              ))}
            </div>
            <Select value={f.school ?? ''} onChange={set('school')} options={uniq(rows, 'school')} label="School" />
            <Select value={f.class ?? ''} onChange={set('class')} options={uniq(rows.flatMap((r) => (r.classes ?? []).map((c) => ({ c }))), 'c')} label="Class" />
          </>
        )}
        {type === 'monster' && (
          <>
            <Select value={f.cr ?? ''} onChange={set('cr')} options={uniq(rows, 'cr')} label="CR" fmt={crText} />
            <Select value={f.size ?? ''} onChange={set('size')} options={uniq(rows, 'size')} label="Size" />
            <Select value={f.creatureType ?? ''} onChange={set('creatureType')} options={uniq(rows, 'creatureType')} label="Type" />
          </>
        )}
        {type === 'item' && (
          <>
            <Select value={f.itemType ?? ''} onChange={set('itemType')} options={uniq(rows, 'itemType')} label="Kind" />
            <Select value={f.rarity ?? ''} onChange={set('rarity')} options={uniq(rows, 'rarity')} label="Rarity" />
          </>
        )}
        {(type === 'feature' || type === 'subclass') && (
          <Select value={f.class ?? ''} onChange={set('class')} options={uniq(rows, 'class')} label="Class" />
        )}
        {(type === 'feat' || type === 'rule') && (
          <Select value={f.category ?? ''} onChange={set('category')} options={uniq(rows, 'category')} label="Category" />
        )}
        {hasNarrowing && (
          <button className="linkish clear-filters" onClick={clearAll}>clear filters</button>
        )}
      </div>
      <table className="listing">
        <thead>
          <tr>
            <th>Name</th>
            {cols.map((c) => <th key={c}>{c === 'creatureType' ? 'type' : c === 'itemType' ? 'kind' : c}</th>)}
            <th>Edition</th><th>Source</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 400).map((r) => (
            <tr key={r.id}>
              <td>
                <a className="rowlink" onClick={() => onOpen(r)}>{r.name}</a>
                {r.damage && (
                  <button
                    className="rollable dmg subtle"
                    title={`Roll ${r.damage} ${r.damageType ?? ''}`}
                    onClick={() => rollDice({ label: r.name, sublabel: r.damageType ?? 'damage', formula: r.damage })}
                  >{r.damage}</button>
                )}
              </td>
              {cols.map((c) => {
                const v = c === 'cr' ? crText(r[c]) : c === 'level' && r.level === 0 && type === 'spell' ? 'C' : r[c];
                // imported data can surprise us — never hand React a non-primitive
                return <td key={c} className="muted">{v == null || typeof v === 'object' ? '—' : v}</td>;
              })}
              <td>{r.edition === '2014' ? <span className="badge legacy">legacy</span> : r.edition}</td>
              <td className="muted">
                {r.source.name}
                {r.tier === 'private' && <span className="badge tier-private">private</span>}
                {r.tier === 'local' && <span className="badge tier-local">this device</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 400 && <p className="muted">Showing 400 of {filtered.length} — narrow the search.</p>}
    </div>
  );
}

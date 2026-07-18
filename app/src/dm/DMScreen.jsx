import React, { useEffect, useRef, useState } from 'react';
import StatBlock from '../compendium/StatBlock.jsx';
import SpellCard from '../compendium/SpellCard.jsx';
import Markdown from '../Markdown.jsx';

// The DM's play surface: search monsters / NPCs / spells and pin them as tabs.
// Every pinned entity keeps its full rollable block — attacks, saves, damage —
// wired into the shared roll log. Tabs persist across sessions.

const TABS_KEY = 'dnd-companion.dmtabs.v1';
const loadTabs = () => { try { return JSON.parse(localStorage.getItem(TABS_KEY)) ?? []; } catch { return []; } };
const KINDS = [
  { key: 'monster', label: 'Monsters' },
  { key: 'npc', label: 'NPCs' },
  { key: 'spell', label: 'Spells' },
];

export default function DMScreen() {
  const [tabs, setTabs] = useState(loadTabs);
  const [active, setActive] = useState(0);
  const [kind, setKind] = useState('monster');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [entries, setEntries] = useState({}); // id -> full entry
  const searchTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const type = kind === 'spell' ? 'spell' : 'monster';
      const res = await fetch(`/api/compendium/${type}?q=${encodeURIComponent(q)}&limit=800`);
      let rows = (await res.json()).results;
      if (kind === 'npc') rows = rows.filter((r) => r.creatureType === 'Humanoid');
      setResults(rows.slice(0, 12));
    }, 200);
    return () => clearTimeout(searchTimer.current);
  }, [q, kind]);

  const openTab = async (row) => {
    const existing = tabs.findIndex((t) => t.id === row.id);
    if (existing >= 0) { setActive(existing); setQ(''); return; }
    const tab = { id: row.id, type: row.type, slug: row.slug, edition: row.edition, name: row.name };
    setTabs((t) => [...t, tab]);
    setActive(tabs.length);
    setQ('');
    if (!entries[row.id]) {
      const full = await (await fetch(`/api/compendium/${row.type}/${row.slug}?edition=${row.edition}`)).json();
      setEntries((e) => ({ ...e, [row.id]: full }));
    }
  };

  const closeTab = (i) => {
    setTabs((t) => t.filter((_, x) => x !== i));
    setActive((a) => Math.max(0, a > i ? a - 1 : Math.min(a, tabs.length - 2)));
  };

  // hydrate persisted tabs on first load
  useEffect(() => {
    for (const t of tabs) {
      if (!entries[t.id]) {
        fetch(`/api/compendium/${t.type}/${t.slug}?edition=${t.edition}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((full) => full && setEntries((e) => ({ ...e, [t.id]: full })));
      }
    }
  }, []); // eslint-disable-line

  const current = tabs[active];
  const entry = current ? entries[current.id] : null;

  return (
    <div className="dmscreen">
      <div className="dm-toolbar">
        <div className="dm-kinds">
          {KINDS.map((k) => (
            <button key={k.key} className={kind === k.key ? 'active' : ''} onClick={() => setKind(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="dm-search">
          <input
            placeholder={`Search ${KINDS.find((k) => k.key === kind).label.toLowerCase()} to pin…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <div className="dm-results">
              {results.map((r) => (
                <button key={r.id} onClick={() => openTab(r)}>
                  {r.name}
                  <span className="muted">
                    {r.type === 'monster' ? ` CR ${r.cr ?? '?'} · ${r.creatureType ?? ''}` : ` L${r.level} ${r.school ?? ''}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="dm-tabs">
        {tabs.map((t, i) => (
          <div key={t.id} className={`dm-tab${i === active ? ' active' : ''}`}>
            <button className="dm-tab-name" onClick={() => setActive(i)}>{t.name}</button>
            <button className="dm-tab-close" title="close" onClick={() => closeTab(i)}>×</button>
          </div>
        ))}
        {tabs.length === 0 && (
          <p className="muted dm-empty">
            Pin monsters, NPCs, and spells from the search above — each becomes a tab you can
            run combat from. Attacks, saves, and damage all roll into the log.
          </p>
        )}
      </div>

      <div className="dm-content">
        {current && !entry && <p className="muted">loading {current.name}…</p>}
        {entry && entry.type === 'monster' && <StatBlock entry={entry} />}
        {entry && entry.type === 'spell' && <SpellCard entry={entry} />}
        {entry && entry.type !== 'monster' && entry.type !== 'spell' && (
          <div className="detail"><h2>{entry.name}</h2><Markdown text={entry.text} /></div>
        )}
      </div>
    </div>
  );
}

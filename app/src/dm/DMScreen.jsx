import React, { useCallback, useEffect, useRef, useState } from 'react';
import StatBlock from '../compendium/StatBlock.jsx';
import SpellCard from '../compendium/SpellCard.jsx';
import GenericCard from '../compendium/GenericCard.jsx';
import Sheet from '../sheet/Sheet.jsx';
import { useRoller } from '../dice/RollContext.jsx';
import { abilityMod, fmtMod } from '../dice/engine.js';

// The DM's persistent play surface. Every search result becomes an independent
// instance, so two copies of the same creature can track HP and conditions apart.

const TABS_KEY = 'dnd-companion.dmtabs.v2';
const OLD_TABS_KEY = 'dnd-companion.dmtabs.v1';
const makeInstanceId = (id) => `${id}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const loadTabs = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(TABS_KEY) ?? localStorage.getItem(OLD_TABS_KEY)) ?? [];
    return stored.map((tab) => ({
      ...tab,
      entityId: tab.entityId ?? tab.id,
      instanceId: tab.instanceId ?? makeInstanceId(tab.id),
    }));
  } catch { return []; }
};
const KINDS = [
  { key: 'monster', label: 'Monsters' },
  { key: 'npc', label: 'NPCs' },
  { key: 'character', label: 'Characters' },
  { key: 'spell', label: 'Spells' },
  { key: 'item', label: 'Items' },
  { key: 'object', label: 'Objects' },
  { key: 'vehicle', label: 'Vehicles' },
];
const CONDITIONS = ['blinded', 'charmed', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];

const trackerFor = (entry) => {
  if (entry.type === 'character') return null; // the character sheet persists its own HP
  const max = Number(entry.data?.hp?.average ?? entry.data?.hp ?? entry.data?.properties?.hp ?? 0);
  if (!Number.isFinite(max) || max <= 0) return null;
  return { current: max, max, temp: 0, conditions: [] };
};

function CombatTracker({ entry, tracker, onChange }) {
  const [amount, setAmount] = useState(1);
  const { rollDice } = useRoller();
  if (!tracker) return null;
  const qty = Math.max(0, Number(amount) || 0);
  const damage = () => {
    const absorbed = Math.min(tracker.temp, qty);
    onChange({ ...tracker, temp: tracker.temp - absorbed, current: Math.max(0, tracker.current - (qty - absorbed)) });
  };
  const heal = () => onChange({ ...tracker, current: Math.min(tracker.max, tracker.current + qty) });
  const temp = () => onChange({ ...tracker, temp: Math.max(tracker.temp, qty) });
  const toggleCondition = (condition) => onChange({
    ...tracker,
    conditions: tracker.conditions.includes(condition)
      ? tracker.conditions.filter((value) => value !== condition)
      : [...tracker.conditions, condition],
  });
  const dex = entry.data?.abilities?.dex;
  return (
    <div className="combat-tracker">
      <div className="combat-vitals">
        <strong>{tracker.current} / {tracker.max} HP</strong>
        {tracker.temp > 0 && <span className="temp-hp">+{tracker.temp} temporary</span>}
        <input aria-label="HP adjustment" type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <button className="damage-button" onClick={damage}>Take damage</button>
        <button className="heal-button" onClick={heal}>Heal</button>
        <button onClick={temp}>Temp HP</button>
        <button onClick={() => onChange({ ...tracker, current: tracker.max, temp: 0 })}>Reset</button>
        {typeof dex === 'number' && (
          <button className="rollable atk" onClick={() => rollDice({
            label: `${entry.name}: Initiative`, formula: `1d20${fmtMod(abilityMod(dex))}`, query: true,
          })}>initiative {fmtMod(abilityMod(dex))}</button>
        )}
      </div>
      <div className="tracker-conditions">
        {CONDITIONS.map((condition) => (
          <button key={condition} className={tracker.conditions.includes(condition) ? 'active' : ''} onClick={() => toggleCondition(condition)}>
            {condition}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DMScreen({ pending, onPendingHandled }) {
  const [tabs, setTabs] = useState(loadTabs);
  const [active, setActive] = useState(0);
  const [kind, setKind] = useState('monster');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [entries, setEntries] = useState({}); // canonical entity id -> full entry
  const searchTimer = useRef(null);

  useEffect(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
    localStorage.removeItem(OLD_TABS_KEY);
  }, [tabs]);

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setResults([]); return undefined; }
    searchTimer.current = setTimeout(async () => {
      if (kind === 'character') {
        const characters = await (await fetch('/api/characters')).json();
        setResults(characters.filter((row) => row.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12)
          .map((row) => ({ ...row, type: 'character', slug: row.id, edition: null })));
        return;
      }
      const type = kind === 'npc' ? 'monster' : kind;
      const res = await fetch(`/api/compendium/${type}?q=${encodeURIComponent(q)}&limit=800`);
      let rows = (await res.json()).results;
      if (kind === 'npc') rows = rows.filter((row) => row.creatureType?.toLowerCase() === 'humanoid');
      setResults(rows.slice(0, 12));
    }, 200);
    return () => clearTimeout(searchTimer.current);
  }, [q, kind]);

  const fetchFull = useCallback(async (row) => {
    if (row.data || row.type === 'character' && row.classes) return row;
    const url = row.type === 'character'
      ? `/api/characters/${row.id}`
      : `/api/compendium/${row.type}/${row.slug}${row.edition ? `?edition=${row.edition}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const full = await response.json();
    return row.type === 'character' ? { ...full, type: 'character', slug: full.id } : full;
  }, []);

  const openTab = useCallback(async (row) => {
    const full = await fetchFull(row);
    if (!full) return;
    const entityId = row.id ?? full.id;
    const tab = {
      instanceId: makeInstanceId(entityId), entityId, type: row.type ?? full.type,
      slug: row.slug ?? full.slug, edition: row.edition ?? full.edition, name: row.name ?? full.name,
      tracker: trackerFor(full),
    };
    setEntries((current) => ({ ...current, [entityId]: full }));
    setTabs((current) => {
      setActive(current.length);
      return [...current, tab];
    });
    setQ('');
  }, [fetchFull]);

  useEffect(() => {
    if (!pending) return;
    openTab(pending).finally(() => onPendingHandled?.());
  }, [pending, onPendingHandled, openTab]);

  const closeTab = (index) => {
    setTabs((current) => current.filter((_, tabIndex) => tabIndex !== index));
    setActive((current) => Math.max(0, current > index ? current - 1 : Math.min(current, tabs.length - 2)));
  };

  // Hydrate persisted tabs and initialize trackers added before v2.
  useEffect(() => {
    for (const tab of tabs) {
      if (entries[tab.entityId]) continue;
      fetchFull({ id: tab.entityId, type: tab.type, slug: tab.slug, edition: tab.edition })
        .then((full) => {
          if (!full) {
            setTabs((current) => current.filter((candidate) => candidate.instanceId !== tab.instanceId));
            return;
          }
          setEntries((current) => ({ ...current, [tab.entityId]: full }));
          if (!tab.tracker) {
            const tracker = trackerFor(full);
            if (tracker) setTabs((current) => current.map((candidate) => candidate.instanceId === tab.instanceId ? { ...candidate, tracker } : candidate));
          }
        });
    }
  }, []); // eslint-disable-line

  const current = tabs[active];
  const entry = current ? entries[current.entityId] : null;
  const updateTracker = (tracker) => setTabs((all) => all.map((tab) => tab.instanceId === current.instanceId ? { ...tab, tracker } : tab));

  return (
    <div className="dmscreen">
      <div className="dm-toolbar">
        <div className="dm-kinds">
          {KINDS.map((option) => (
            <button key={option.key} className={kind === option.key ? 'active' : ''} onClick={() => setKind(option.key)}>{option.label}</button>
          ))}
        </div>
        <div className="dm-search">
          <input placeholder={`Search ${KINDS.find((option) => option.key === kind).label.toLowerCase()} to pin…`} value={q} onChange={(event) => setQ(event.target.value)} />
          {results.length > 0 && (
            <div className="dm-results">
              {results.map((result) => (
                <button key={result.id} onClick={() => openTab(result)}>
                  {result.name}
                  <span className="muted">
                    {result.type === 'monster' ? ` CR ${result.cr ?? '?'} · ${result.creatureType ?? ''}` : result.type === 'spell' ? ` L${result.level} ${result.school ?? ''}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="dm-tabs">
        {tabs.map((tab, index) => (
          <div key={tab.instanceId} className={`dm-tab${index === active ? ' active' : ''}`}>
            <button className="dm-tab-name" onClick={() => setActive(index)}>
              {tab.name}{tab.tracker ? ` · ${tab.tracker.current}/${tab.tracker.max}` : ''}
            </button>
            <button className="dm-tab-close" title="close" onClick={() => closeTab(index)}>×</button>
          </div>
        ))}
        {tabs.length === 0 && <p className="muted dm-empty">Search here or add an entry from the compendium. Combatants keep independent HP, temporary HP, and conditions; every usable mechanic remains rollable.</p>}
      </div>

      <div className="dm-content">
        {current && !entry && <p className="muted">loading {current.name}…</p>}
        {entry && current.tracker && <CombatTracker entry={entry} tracker={current.tracker} onChange={updateTracker} />}
        {entry && entry.type === 'monster' && <StatBlock entry={entry} />}
        {entry && entry.type === 'spell' && <SpellCard entry={entry} />}
        {entry && entry.type === 'character' && <Sheet id={entry.id} onBack={() => {}} />}
        {entry && !['monster', 'spell', 'character'].includes(entry.type) && <GenericCard entry={entry} />}
      </div>
    </div>
  );
}

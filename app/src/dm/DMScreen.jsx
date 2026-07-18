import React, { useCallback, useEffect, useRef, useState } from 'react';
import StatBlock from '../compendium/StatBlock.jsx';
import SpellCard from '../compendium/SpellCard.jsx';
import GenericCard from '../compendium/GenericCard.jsx';
import Sheet from '../sheet/Sheet.jsx';
import { useRoller } from '../dice/RollContext.jsx';
import { abilityMod, fmtMod } from '../dice/engine.js';
import {
  MAX_CAMPAIGN_FILE_BYTES,
  TRACKED_CONDITIONS,
  campaignFilename,
  createCampaignDocument,
  loadStoredCampaign,
  mergeCampaigns,
  parseCampaignDocument,
  replaceCampaign,
  saveStoredCampaign,
} from './campaignState.js';

// The DM's persistent play surface. Every search result becomes an independent
// instance, so two copies of the same creature can track HP and conditions apart.

const makeInstanceId = (id) => `${id}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
const KINDS = [
  { key: 'monster', label: 'Monsters' },
  { key: 'npc', label: 'NPCs' },
  { key: 'character', label: 'Characters' },
  { key: 'spell', label: 'Spells' },
  { key: 'item', label: 'Items' },
  { key: 'object', label: 'Objects' },
  { key: 'vehicle', label: 'Vehicles' },
];
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
        {TRACKED_CONDITIONS.map((condition) => (
          <button key={condition} className={tracker.conditions.includes(condition) ? 'active' : ''} onClick={() => toggleCondition(condition)}>
            {condition}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DMScreen({ pending, onPendingHandled }) {
  const [campaign, setCampaign] = useState(() => loadStoredCampaign(localStorage));
  const [kind, setKind] = useState('monster');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [entries, setEntries] = useState({}); // canonical entity id -> full entry
  const [entryErrors, setEntryErrors] = useState({});
  const [importCandidate, setImportCandidate] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const searchTimer = useRef(null);
  const fileInput = useRef(null);
  const hydrating = useRef(new Set());
  const tabs = campaign.tabs;
  const active = Math.max(0, tabs.findIndex((tab) => tab.instanceId === campaign.activeInstanceId));
  const [pinFilter, setPinFilter] = useState(() => localStorage.getItem('dnd-companion.dmpinfilter') ?? 'all');

  // Pin kind is derived (never stored) so old campaigns filter correctly:
  // humanoid monsters count as NPCs, matching the search facets.
  const kindOfTab = useCallback((tab) => {
    if (tab.type !== 'monster') return tab.type;
    const hydrated = entries[tab.entityId];
    return hydrated?.data?.creatureType?.toLowerCase() === 'humanoid' ? 'npc' : 'monster';
  }, [entries]);
  const visibleTabs = pinFilter === 'all' ? tabs : tabs.filter((tab) => kindOfTab(tab) === pinFilter);
  const pinCounts = tabs.reduce((counts, tab) => {
    const key = kindOfTab(tab);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const applyPinFilter = (next) => {
    setPinFilter(next);
    localStorage.setItem('dnd-companion.dmpinfilter', next);
    const nextVisible = next === 'all' ? tabs : tabs.filter((tab) => kindOfTab(tab) === next);
    if (nextVisible.length && !nextVisible.some((tab) => tab.instanceId === campaign.activeInstanceId)) {
      setCampaign((value) => ({ ...value, activeInstanceId: nextVisible[0].instanceId }));
    }
  };

  useEffect(() => {
    try { saveStoredCampaign(localStorage, campaign); }
    catch { setNotice({ kind: 'error', text: 'This browser could not save the campaign locally. Export a backup before closing it.' }); }
  }, [campaign]);

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
      ? `/api/characters/${row.id ?? row.entityId}`
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
    setEntryErrors((current) => { const next = { ...current }; delete next[entityId]; return next; });
    setCampaign((current) => ({ ...current, tabs: [...current.tabs, tab], activeInstanceId: tab.instanceId }));
    setQ('');
  }, [fetchFull]);

  useEffect(() => {
    if (!pending) return;
    openTab(pending).finally(() => onPendingHandled?.());
  }, [pending, onPendingHandled, openTab]);

  const closeTab = (instanceId) => {
    setCampaign((current) => {
      const index = current.tabs.findIndex((tab) => tab.instanceId === instanceId);
      if (index < 0) return current;
      const nextTabs = current.tabs.filter((tab) => tab.instanceId !== instanceId);
      const activeInstanceId = instanceId === current.activeInstanceId
        ? nextTabs[Math.min(index, nextTabs.length - 1)]?.instanceId ?? null
        : current.activeInstanceId;
      return { ...current, tabs: nextTabs, activeInstanceId };
    });
  };

  // Hydrate stored or imported references. Missing entries remain in the campaign
  // as explicit unavailable placeholders so an update never silently destroys state.
  useEffect(() => {
    for (const tab of tabs) {
      if (entries[tab.entityId] || entryErrors[tab.entityId] || hydrating.current.has(tab.entityId)) continue;
      hydrating.current.add(tab.entityId);
      fetchFull({ id: tab.entityId, type: tab.type, slug: tab.slug, edition: tab.edition })
        .then((full) => {
          if (!full) {
            setEntryErrors((current) => ({ ...current, [tab.entityId]: 'This referenced entry is not available on this server.' }));
            return;
          }
          setEntries((current) => ({ ...current, [tab.entityId]: full }));
          if (!tab.tracker) {
            const tracker = trackerFor(full);
            if (tracker) setCampaign((current) => ({
              ...current,
              tabs: current.tabs.map((candidate) => candidate.instanceId === tab.instanceId ? { ...candidate, tracker } : candidate),
            }));
          }
        })
        .finally(() => hydrating.current.delete(tab.entityId));
    }
  }, [tabs, entries, entryErrors, fetchFull]);

  const exportCampaign = () => {
    const document = createCampaignDocument(campaign);
    const filename = campaignFilename(campaign.name);
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' }));
    const link = window.document.createElement('a');
    link.href = url; link.download = filename;
    window.document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice({ kind: 'success', text: `Exported ${tabs.length} tab${tabs.length === 1 ? '' : 's'} to ${filename}.` });
  };

  const chooseImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_CAMPAIGN_FILE_BYTES) {
      setNotice({ kind: 'error', text: 'That campaign file is larger than the 2 MB safety limit.' });
      return;
    }
    try {
      setImportCandidate(parseCampaignDocument(await file.text()));
      setNotice(null);
    } catch (error) {
      setNotice({ kind: 'error', text: error.message });
    }
  };

  const applyImport = async (mode) => {
    setImportBusy(true);
    let next;
    try { next = mode === 'merge' ? mergeCampaigns(campaign, importCandidate) : replaceCampaign(importCandidate); }
    catch (error) {
      setNotice({ kind: 'error', text: error.message });
      setImportBusy(false);
      return;
    }
    const resolved = await Promise.all(importCandidate.tabs.map(async (tab) => {
      try { return { tab, full: await fetchFull(tab) }; } catch { return { tab, full: null }; }
    }));
    const missing = resolved.filter(({ full }) => !full);
    setEntries((current) => Object.assign({}, current, ...resolved.filter(({ full }) => full).map(({ tab, full }) => ({ [tab.entityId]: full }))));
    setEntryErrors((current) => {
      const next = { ...current };
      for (const { tab, full } of resolved) {
        if (full) delete next[tab.entityId];
        else next[tab.entityId] = 'This referenced entry is not available on this server.';
      }
      return next;
    });
    setCampaign(next);
    setImportCandidate(null);
    setImportBusy(false);
    const unavailable = missing.length ? ` ${missing.length} unavailable reference${missing.length === 1 ? ' was' : 's were'} retained.` : '';
    setNotice({ kind: 'success', text: `${mode === 'merge' ? 'Merged' : 'Restored'} ${importCandidate.tabs.length} tab${importCandidate.tabs.length === 1 ? '' : 's'}.${unavailable}` });
  };

  const current = tabs[active];
  const entry = current ? entries[current.entityId] : null;
  const entryError = current ? entryErrors[current.entityId] : null;
  const updateTracker = (tracker) => setCampaign((value) => ({
    ...value, tabs: value.tabs.map((tab) => tab.instanceId === current.instanceId ? { ...tab, tracker } : tab),
  }));

  return (
    <div className="dmscreen">
      <div className="campaign-toolbar">
        <label>
          Campaign
          <input aria-label="Campaign name" value={campaign.name} maxLength="120" placeholder="Untitled campaign"
            onChange={(event) => setCampaign((currentCampaign) => ({ ...currentCampaign, name: event.target.value }))} />
        </label>
        <button onClick={exportCampaign}>Export campaign</button>
        <button onClick={() => fileInput.current?.click()}>Import campaign</button>
        <input ref={fileInput} className="campaign-file-input" aria-label="Campaign JSON file" type="file"
          accept=".json,.dnd-campaign.json,application/json" onChange={chooseImport} />
        <span className="campaign-help">DM tabs and combat state · characters/homebrew remain on this server</span>
      </div>
      {notice && <p className={`campaign-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
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

      {tabs.length > 0 && (
        <div className="dm-filters">
          <button className={pinFilter === 'all' ? 'active' : ''} onClick={() => applyPinFilter('all')}>
            All ({tabs.length})
          </button>
          {KINDS.filter((option) => pinCounts[option.key]).map((option) => (
            <button
              key={option.key}
              className={pinFilter === option.key ? 'active' : ''}
              onClick={() => applyPinFilter(option.key)}
            >{option.label} ({pinCounts[option.key]})</button>
          ))}
        </div>
      )}
      <div className="dm-tabs">
        {visibleTabs.map((tab) => (
          <div key={tab.instanceId} className={`dm-tab${tab.instanceId === campaign.activeInstanceId ? ' active' : ''}`}>
            <button className="dm-tab-name" onClick={() => setCampaign((value) => ({ ...value, activeInstanceId: tab.instanceId }))}>
              {tab.name}{tab.tracker ? ` · ${tab.tracker.current}/${tab.tracker.max}` : ''}
            </button>
            <button className="dm-tab-close" title="close" onClick={() => closeTab(tab.instanceId)}>×</button>
          </div>
        ))}
        {tabs.length > 0 && visibleTabs.length === 0 && (
          <p className="muted dm-empty">No pinned {KINDS.find((option) => option.key === pinFilter)?.label.toLowerCase() ?? 'entries'} — switch to All.</p>
        )}
        {tabs.length === 0 && <p className="muted dm-empty">Search here or add an entry from the compendium. Combatants keep independent HP, temporary HP, and conditions; every usable mechanic remains rollable.</p>}
      </div>

      <div className="dm-content">
        {current && !entry && !entryError && <p className="muted">loading {current.name}…</p>}
        {current && entryError && <p className="campaign-unavailable"><strong>{current.name} is unavailable.</strong> {entryError} Its saved tracker and tab are retained.</p>}
        {current && current.tracker && <CombatTracker entry={entry ?? { name: current.name, data: {} }} tracker={current.tracker} onChange={updateTracker} />}
        {entry && entry.type === 'monster' && <StatBlock entry={entry} />}
        {entry && entry.type === 'spell' && <SpellCard entry={entry} />}
        {entry && entry.type === 'character' && <Sheet id={entry.id} onBack={() => {}} />}
        {entry && !['monster', 'spell', 'character'].includes(entry.type) && <GenericCard entry={entry} />}
      </div>
      {importCandidate && (
        <div className="advquery-backdrop" onClick={() => !importBusy && setImportCandidate(null)}>
          <div className="campaign-import-dialog" role="dialog" aria-modal="true" aria-label="Import campaign" onClick={(event) => event.stopPropagation()}>
            <h3>Import {importCandidate.name || 'Untitled campaign'}?</h3>
            <p>This file contains {importCandidate.tabs.length} DM tab{importCandidate.tabs.length === 1 ? '' : 's'} with combat tracker state.</p>
            <p className="muted">Character and homebrew records are not embedded. Unavailable references will be retained and identified.</p>
            <div className="campaign-import-actions">
              <button disabled={importBusy} onClick={() => setImportCandidate(null)}>Cancel</button>
              <button disabled={importBusy} onClick={() => applyImport('merge')}>Merge with current</button>
              <button className="bigbutton" disabled={importBusy} onClick={() => applyImport('replace')}>Replace current</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

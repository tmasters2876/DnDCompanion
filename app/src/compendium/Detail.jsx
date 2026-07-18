import React, { useEffect, useState } from 'react';
import StatBlock from './StatBlock.jsx';
import SpellCard from './SpellCard.jsx';
import ClassPage from './ClassPage.jsx';
import GenericCard from './GenericCard.jsx';
import { dmHeaders } from '../homebrew/dmProfile.js';
import { stashResolve } from '../homebrew/localStash.js';

export default function Detail({ type, slug, edition, onBack, onSwitchEdition, onAddToDm }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setEntry(null); setError(null);
    const local = stashResolve(type, slug);
    if (local) { setEntry(local); return; }
    fetch(`/api/compendium/${type}/${slug}${edition ? `?edition=${edition}` : ''}`, { headers: dmHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setEntry)
      .catch((e) => setError(e.message));
  }, [type, slug, edition]);

  if (error) return <p className="muted">Couldn't load {type}/{slug} ({error}). <a className="rowlink" onClick={onBack}>← back</a></p>;
  if (!entry) return <p className="muted">loading…</p>;

  const body =
    type === 'monster' && !entry.data?.partial ? <StatBlock entry={entry} /> :
    type === 'spell' ? <SpellCard entry={entry} /> :
    type === 'class' && !entry.data?.partial ? <ClassPage entry={entry} /> :
    <GenericCard entry={entry} />;

  return (
    <div>
      <p>
        <a className="rowlink" onClick={onBack}>← back to list</a>
        <span className="badge">{entry.source.name}</span>
        {entry.edition === '2014' && <span className="badge legacy">legacy</span>}
        <button className="bigbutton dm-add" onClick={() => onAddToDm(entry)}>＋ Add to DM console</button>
        {entry.otherEditions?.map((e) => (
          <a key={e.id} className="rowlink badge" onClick={() => onSwitchEdition(e.edition)}>
            view {e.edition} version
          </a>
        ))}
      </p>
      {body}
    </div>
  );
}

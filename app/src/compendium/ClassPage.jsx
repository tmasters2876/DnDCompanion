import React, { useEffect, useState } from 'react';
import Markdown from '../Markdown.jsx';

// Class detail: progression table (features per level, slots for casters) with
// feature text expandable inline. Features arrive via a second fetch filtered
// by class slug.

export default function ClassPage({ entry }) {
  const d = entry.data;
  const [features, setFeatures] = useState({});
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch(`/api/compendium/feature?class=${entry.slug}&edition=${entry.edition}&limit=500`)
      .then((r) => r.json())
      .then((res) => {
        const bySlug = {};
        for (const f of res.results) bySlug[f.slug] = f;
        setFeatures(bySlug);
      });
  }, [entry.slug, entry.edition]);

  const openFeature = (slug) => {
    fetch(`/api/compendium/feature/${slug}?edition=${entry.edition}`)
      .then((r) => r.json())
      .then((f) => setOpen(f));
  };

  const caster = d.levels.some((l) => l.slots?.some((s) => s > 0));
  const maxSlot = caster
    ? Math.max(...d.levels.flatMap((l) => (l.slots ?? []).map((s, i) => (s > 0 ? i + 1 : 0))))
    : 0;

  return (
    <div className="classpage">
      <h2>{entry.name}</h2>
      <p className="muted">
        d{d.hitDie} hit die · saves {d.saves.map((s) => s.toUpperCase()).join(', ')}
        {d.spellcasting && ` · ${d.spellcasting.kind} caster (${d.spellcasting.ability?.toUpperCase()})`}
      </p>
      {d.proficiencies?.skills && (
        <p className="muted">Skills: choose {d.proficiencies.skills.choose} from {d.proficiencies.skills.from.join(', ')}</p>
      )}
      <table className="progression">
        <thead>
          <tr>
            <th>Lvl</th><th>Prof</th><th>Features</th>
            {caster && Array.from({ length: maxSlot }, (_, i) => <th key={i}>{i + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          {d.levels.map((l) => (
            <tr key={l.level}>
              <td>{l.level}</td>
              <td>+{l.profBonus}</td>
              <td>
                {l.features.map((slug, i) => (
                  <React.Fragment key={slug}>
                    {i > 0 && ', '}
                    <button className="rollable" onClick={() => openFeature(slug)}>
                      {features[slug]?.name ?? slug}
                    </button>
                  </React.Fragment>
                ))}
              </td>
              {caster && Array.from({ length: maxSlot }, (_, i) => (
                <td key={i} className="slotcell">{l.slots?.[i] || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

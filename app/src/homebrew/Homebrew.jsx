import React, { useEffect, useState } from 'react';

// Phase-8 homebrew: create custom spells / feats / items via forms. Entries are
// written to data/homebrew/ as full schema envelopes and join the compendium
// immediately — the builder, sheet, and browser treat them like official content.

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const BLANK = {
  spell: { level: 0, school: 'evocation', castingTime: 'action', range: '60 feet', duration: 'instantaneous', concentration: false, ritual: false, damageDice: '', damageType: '', save: '', classes: '' },
  feat: { category: 'general', prerequisite: '' },
  item: { itemType: 'weapon', damage: '1d8', damageType: 'slashing', properties: '', ac: '', rarity: '' },
};

export default function Homebrew() {
  const [list, setList] = useState([]);
  const [type, setType] = useState('spell');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [fields, setFields] = useState(BLANK.spell);
  const [status, setStatus] = useState(null);

  const refresh = () => fetch('/api/homebrew').then((r) => r.json()).then(setList);
  useEffect(() => { refresh(); }, []);
  useEffect(() => { setFields(BLANK[type]); }, [type]);

  const set = (k) => (e) => setFields({ ...fields, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const buildData = () => {
    if (type === 'spell') {
      return {
        level: Number(fields.level), school: fields.school,
        castingTime: fields.castingTime, range: fields.range,
        components: { v: true, s: true, m: false, materialText: null },
        duration: fields.duration, concentration: fields.concentration, ritual: fields.ritual,
        classes: fields.classes.split(',').map((s) => slugify(s.trim())).filter(Boolean),
        damage: fields.damageDice ? { dice: fields.damageDice, type: fields.damageType || null, scaling: {} } : null,
        attackType: null, save: fields.save || null,
      };
    }
    if (type === 'feat') {
      return { category: fields.category, prerequisite: fields.prerequisite || null, repeatable: false };
    }
    return {
      itemType: fields.itemType, rarity: fields.rarity || null, attunement: false,
      cost: null, weight: null, categories: [],
      ...(fields.itemType === 'weapon' ? {
        weapon: { category: null, damage: fields.damage, damageType: fields.damageType, versatileDamage: null, properties: fields.properties.split(',').map((s) => s.trim()).filter(Boolean), mastery: null, range: null },
      } : {}),
      ...(fields.itemType === 'armor' ? {
        armor: { category: null, ac: Number(fields.ac) || 10, dexCap: null, addDex: true, strengthReq: null, stealthDisadvantage: false },
      } : {}),
    };
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await fetch('/api/homebrew', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, slug: slugify(name), name: name.trim(), edition: '2024', data: buildData(), text }),
    });
    if (res.ok) {
      setStatus(`Saved "${name}" — it's live in the compendium now.`);
      setName(''); setText('');
      refresh();
    } else {
      setStatus(`Save failed: ${(await res.json()).error}`);
    }
  };

  const remove = async (e) => {
    if (!confirm(`Delete homebrew "${e.name}"?`)) return;
    await fetch(`/api/homebrew/${e.type}/${e.slug}`, { method: 'DELETE' });
    refresh();
  };

  const input = (k, label, extra = {}) => (
    <label className="hb-field">{label}
      <input value={fields[k] ?? ''} onChange={set(k)} {...extra} />
    </label>
  );

  return (
    <div className="homebrew">
      <h2>Homebrew</h2>
      <form onSubmit={save} className="wizhint">
        <p>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="spell">Spell</option><option value="feat">Feat</option><option value="item">Item</option>
          </select>{' '}
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        </p>
        {type === 'spell' && (
          <p className="hb-row">
            {input('level', 'Level', { type: 'number', min: 0, max: 9 })}
            {input('school', 'School')}
            {input('castingTime', 'Casting time')}
            {input('range', 'Range')}
            {input('duration', 'Duration')}
            {input('damageDice', 'Damage dice (e.g. 3d8)')}
            {input('damageType', 'Damage type')}
            {input('save', 'Save (str/dex/…)')}
            {input('classes', 'Classes (comma-sep)')}
            <label className="hb-field">Conc.<input type="checkbox" checked={fields.concentration} onChange={set('concentration')} /></label>
            <label className="hb-field">Ritual<input type="checkbox" checked={fields.ritual} onChange={set('ritual')} /></label>
          </p>
        )}
        {type === 'feat' && (
          <p className="hb-row">
            {input('category', 'Category (origin/general/…)')}
            {input('prerequisite', 'Prerequisite')}
          </p>
        )}
        {type === 'item' && (
          <p className="hb-row">
            <label className="hb-field">Kind
              <select value={fields.itemType} onChange={set('itemType')}>
                <option value="weapon">weapon</option><option value="armor">armor</option>
                <option value="gear">gear</option><option value="magic">magic</option>
              </select>
            </label>
            {fields.itemType === 'weapon' && <>{input('damage', 'Damage')}{input('damageType', 'Damage type')}{input('properties', 'Properties (comma-sep)')}</>}
            {fields.itemType === 'armor' && input('ac', 'Base AC', { type: 'number' })}
            {fields.itemType === 'magic' && input('rarity', 'Rarity')}
          </p>
        )}
        <textarea className="notes" placeholder="Rules text (markdown: **bold**, - lists, | tables |)" value={text} onChange={(e) => setText(e.target.value)} />
        <p><button className="bigbutton" type="submit">Save to compendium</button> {status && <span className="muted">{status}</span>}</p>
      </form>

      <h3>Your creations</h3>
      {list.length === 0 && <p className="muted">Nothing yet.</p>}
      <table className="listing">
        <tbody>
          {list.map((e) => (
            <tr key={e.id}>
              <td><a className="rowlink" href={`#/${e.type}/${e.slug}`}>{e.name}</a></td>
              <td className="muted">{e.type}</td>
              <td><button className="linkish" onClick={() => remove(e)}>delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

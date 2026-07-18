import React, { useEffect, useState } from 'react';
import { loadProfile, createProfile, pairProfile, dmHeaders } from './dmProfile.js';
import { loadStash, saveStashEntry, removeStashEntry, exportStashDocument, importStashDocument, MAX_STASH_FILE_BYTES } from './localStash.js';

// Phase-8 homebrew: create custom spells / feats / items via forms. Entries are
// written to data/homebrew/ as full schema envelopes and join the compendium
// immediately — the builder, sheet, and browser treat them like official content.

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const BLANK = {
  spell: { level: 0, school: 'evocation', castingTime: 'action', range: '60 feet', duration: 'instantaneous', concentration: false, ritual: false, damageDice: '', damageType: '', save: '', classes: '' },
  feat: { category: 'general', prerequisite: '' },
  item: { itemType: 'weapon', damage: '1d8', damageType: 'slashing', properties: '', ac: '', rarity: '' },
};

function ProfilePanel({ profile, onProfile }) {
  const [name, setName] = useState('');
  const [pairKey, setPairKey] = useState('');
  const [error, setError] = useState(null);
  if (profile) {
    return (
      <p className="muted profile-line">
        DM profile: <strong>{profile.name}</strong>
        {' · '}<button className="linkish" onClick={() => navigator.clipboard?.writeText(profile.key).catch(() => {})}>copy pairing code</button>
        <span className="muted"> (paste it on another device to carry your private table)</span>
      </p>
    );
  }
  return (
    <div className="wizhint profile-setup">
      <p><strong>Create your DM profile</strong> to save private homebrew. Private entries are hidden from every other browser; the profile lives on this device.</p>
      <p className="hb-row">
        <input placeholder="DM name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="bigbutton" disabled={!name.trim()} onClick={() => onProfile(createProfile(name))}>Create profile</button>
        <input placeholder="…or paste a pairing code" value={pairKey} onChange={(e) => setPairKey(e.target.value)} />
        <button disabled={!name.trim() || !pairKey.trim()} className="linkish" onClick={() => {
          try { onProfile(pairProfile(name, pairKey)); setError(null); }
          catch (err) { setError(err.message); }
        }}>pair this device</button>
      </p>
      {error && <p className="warn">{error}</p>}
    </div>
  );
}

export default function Homebrew() {
  const [list, setList] = useState([]);
  const [profile, setProfile] = useState(() => loadProfile());
  const [stash, setStash] = useState(() => loadStash());
  const [tier, setTier] = useState('private');
  const [campaign, setCampaign] = useState('');
  const [type, setType] = useState('spell');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [fields, setFields] = useState(BLANK.spell);
  const [status, setStatus] = useState(null);

  const refresh = () => {
    fetch('/api/homebrew', { headers: dmHeaders() }).then((r) => r.json()).then(setList);
    setStash(loadStash());
  };
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
    const envelope = { type, slug: slugify(name), name: name.trim(), edition: '2024', campaign, data: buildData(), text };
    if (tier === 'local') {
      saveStashEntry(envelope);
      setStatus(`Saved "${name}" to this device only — it never touches the server.`);
      setName(''); setText('');
      refresh();
      return;
    }
    const res = await fetch('/api/homebrew', {
      method: 'POST', headers: { 'content-type': 'application/json', ...dmHeaders() },
      body: JSON.stringify({ ...envelope, tier }),
    });
    if (res.ok) {
      setStatus(tier === 'shared'
        ? `Saved "${name}" — shared with every table on this server.`
        : `Saved "${name}" — private to your DM profile.`);
      setName(''); setText('');
      refresh();
    } else {
      setStatus(`Save failed: ${(await res.json()).error}`);
    }
  };

  const remove = async (e) => {
    if (!confirm(`Delete homebrew "${e.name}"?`)) return;
    await fetch(`/api/homebrew/${e.type}/${e.slug}`, { method: 'DELETE', headers: dmHeaders() });
    refresh();
  };

  const moveTier = async (e, nextTier) => {
    const res = await fetch(`/api/homebrew/${e.type}/${e.slug}/tier`, {
      method: 'PUT', headers: { 'content-type': 'application/json', ...dmHeaders() },
      body: JSON.stringify({ tier: nextTier }),
    });
    setStatus(res.ok
      ? (nextTier === 'shared' ? `"${e.name}" is now shared.` : `"${e.name}" is private again — removed from everyone else's view.`)
      : `Change failed: ${(await res.json()).error}`);
    refresh();
  };

  const moveToDevice = async (e) => {
    if (!confirm(`Move "${e.name}" to this device only? It will be deleted from the server.`)) return;
    const full = await (await fetch(`/api/compendium/${e.type}/${e.slug}`, { headers: dmHeaders() })).json();
    saveStashEntry({ type: full.type, slug: full.slug, name: full.name, edition: full.edition, campaign: full.campaign ?? '', data: full.data, text: full.text });
    await fetch(`/api/homebrew/${e.type}/${e.slug}`, { method: 'DELETE', headers: dmHeaders() });
    setStatus(`"${e.name}" now lives only in this browser.`);
    refresh();
  };

  const removeLocal = (e) => {
    if (!confirm(`Delete "${e.name}" from this device? Local entries have no server copy.`)) return;
    removeStashEntry(e.id);
    refresh();
  };

  const exportStash = () => {
    const doc = exportStashDocument();
    doc.exportedAt = new Date().toISOString();
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'homebrew-local-stash.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importStash = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_STASH_FILE_BYTES) { setStatus('That stash file is larger than the 2 MB safety limit.'); return; }
    try {
      const count = importStashDocument(await file.text());
      setStatus(`Imported ${count} local entr${count === 1 ? 'y' : 'ies'}.`);
      refresh();
    } catch (err) { setStatus(err.message); }
  };

  const input = (k, label, extra = {}) => (
    <label className="hb-field">{label}
      <input value={fields[k] ?? ''} onChange={set(k)} {...extra} />
    </label>
  );

  const canServerSave = Boolean(profile);
  return (
    <div className="homebrew">
      <h2>Homebrew</h2>
      <ProfilePanel profile={profile} onProfile={setProfile} />
      <form onSubmit={save} className="wizhint">
        <p>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="spell">Spell</option><option value="feat">Feat</option><option value="item">Item</option>
          </select>{' '}
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          {' '}
          <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Privacy tier" disabled={!canServerSave && tier !== 'local'}>
            <option value="private" disabled={!canServerSave}>Private to me (server)</option>
            <option value="shared" disabled={!canServerSave}>Shared with everyone</option>
            <option value="local">This device only</option>
          </select>{' '}
          <input placeholder="Campaign tag (optional)" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </p>
        <p className="muted tier-hint">
          {tier === 'local'
            ? 'This device only: true secrecy — never touches the server; export a stash backup so a cleared browser can\u2019t eat it.'
            : tier === 'private'
              ? 'Private: hidden from every other browser and screen. Spoiler-proofing among friends, not encryption.'
              : 'Shared: visible to every table on this server.'}
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
      {list.length === 0 && stash.length === 0 && <p className="muted">Nothing yet.</p>}
      <table className="listing">
        <tbody>
          {stash.map((e) => (
            <tr key={e.id}>
              <td><a className="rowlink" href={`#/${e.type}/${e.slug}`}>{e.name}</a><span className="badge tier-local">this device</span></td>
              <td className="muted">{e.type}{e.campaign ? ` · ${e.campaign}` : ''}</td>
              <td><button className="linkish" onClick={() => removeLocal(e)}>delete</button></td>
            </tr>
          ))}
          {list.map((e) => (
            <tr key={e.id}>
              <td>
                <a className="rowlink" href={`#/${e.type}/${e.slug}`}>{e.name}</a>
                {e.tier === 'private' && <span className="badge tier-private">private</span>}
                {e.tier === 'shared' && <span className="badge">shared</span>}
                {e.legacy && <span className="badge">shared · legacy</span>}
              </td>
              <td className="muted">{e.type}</td>
              <td>
                {e.mine && e.tier === 'private' && <button className="linkish" onClick={() => moveTier(e, 'shared')}>share</button>}
                {e.mine && e.tier === 'shared' && <button className="linkish" onClick={() => moveTier(e, 'private')}>unshare</button>}
                {e.mine && <button className="linkish" onClick={() => moveToDevice(e)}>to this device</button>}
                {(e.mine || e.legacy) && <button className="linkish" onClick={() => remove(e)}>delete</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="stash-tools">
        <button className="linkish" onClick={exportStash}>export local stash</button>
        <label className="linkish stash-import">import local stash
          <input type="file" accept=".json,application/json" onChange={importStash} className="campaign-file-input" />
        </label>
      </p>
    </div>
  );
}

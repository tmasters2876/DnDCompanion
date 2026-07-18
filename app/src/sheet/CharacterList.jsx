import React, { useEffect, useState } from 'react';

const NEW_CHARACTER = {
  name: 'New Adventurer',
  edition: '2024',
  abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  classes: [{ class: 'fighter', subclass: null, level: 1, hpRolls: [null] }],
  species: 'human',
  background: 'soldier',
  proficiencies: { skills: ['athletics', 'perception'], expertise: [], tools: [], languages: ['common'] },
  feats: [],
  equipment: [
    { item: 'chain-mail', qty: 1, equipped: true },
    { item: 'longsword', qty: 1, equipped: true },
    { item: 'shield', qty: 1, equipped: true },
  ],
  spells: { known: [], prepared: [] },
  hp: { current: 12, temp: 0 },
  slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  pactUsed: 0,
  conditions: [],
  deathSaves: { success: 0, fail: 0 },
  currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
  overrides: [],
  notes: '',
};

export default function CharacterList({ onOpen, onNew }) {
  const [list, setList] = useState(null);

  const refresh = () => fetch('/api/characters').then((r) => r.json()).then(setList);
  useEffect(() => { refresh(); }, []);

  const quickCreate = async () => {
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(NEW_CHARACTER),
    });
    const c = await res.json();
    onOpen(c.id);
  };

  const remove = async (id, name) => {
    if (!confirm(`Delete ${name}? The JSON file is removed permanently.`)) return;
    await fetch(`/api/characters/${id}`, { method: 'DELETE' });
    refresh();
  };

  if (!list) return <p className="muted">loading…</p>;
  return (
    <div className="charlist">
      <p>
        <button className="bigbutton" onClick={onNew}>+ New character</button>{' '}
        <button className="linkish" onClick={quickCreate}>quick-create a fighter</button>
      </p>
      {list.length === 0 && <p className="muted">No characters yet.</p>}
      <table className="listing">
        <tbody>
          {list.map((c) => (
            <tr key={c.id}>
              <td><a className="rowlink" onClick={() => onOpen(c.id)}>{c.name}</a></td>
              <td className="muted">{(c.classes ?? []).map((k) => `${k.class} ${k.level}`).join(' / ')}</td>
              <td><button className="linkish" onClick={() => remove(c.id, c.name)}>delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { ABILITIES } from '../rules/derive.js';
import { abilityMod, fmtMod, roll } from '../dice/engine.js';

// Phase-7 guided level-up: pick class (multiclass prereqs enforced), roll or
// average HP, pick subclass when it unlocks, handle ASI/feat levels, preview
// new features. Applies a choices-only patch to the character.

const fetchEntry = (type, slug) => fetch(`/api/compendium/${type}/${slug}`).then((r) => (r.ok ? r.json() : null));

export default function LevelUp({ character, lookup, onApply, onClose }) {
  const [allClasses, setAllClasses] = useState([]);
  const [target, setTarget] = useState(character.classes[0].class);
  const [targetEntry, setTargetEntry] = useState(null);
  const [hpMode, setHpMode] = useState('average');
  const [hpRoll, setHpRoll] = useState(null);
  const [subclass, setSubclass] = useState(null);
  const [subclasses, setSubclasses] = useState([]);
  const [asi, setAsi] = useState({ kind: 'asi', a: null, b: null, feat: null });
  const [feats, setFeats] = useState([]);

  useEffect(() => {
    fetch('/api/compendium/class?limit=2000').then((r) => r.json()).then((d) => setAllClasses(d.results.filter((entry) => !entry.partial)));
    fetch('/api/compendium/feat?limit=100').then((r) => r.json())
      .then((d) => setFeats(d.results.filter((f) => f.category !== 'origin')));
  }, []);

  useEffect(() => {
    fetchEntry('class', target).then(setTargetEntry);
    fetch(`/api/compendium/subclass?class=${target}&limit=50`).then((r) => r.json())
      .then((d) => setSubclasses(d.results));
    setSubclass(null);
  }, [target]);

  const existing = character.classes.find((c) => c.class === target);
  const newLevel = (existing?.level ?? 0) + 1;
  const totalLevel = character.classes.reduce((s, c) => s + c.level, 0) + 1;

  const meetsPrereq = (slug) => {
    // Multiclassing: need 13+ in the new class's primary AND your current primaries.
    if (character.classes.some((c) => c.class === slug)) return true;
    const check = (entry) => (entry?.data?.primaryAbilities ?? [])
      .every ? (entry?.data?.primaryAbilities ?? []).some((a) => (character.abilities[a] ?? 0) >= 13) : true;
    const current = lookup.get('class', character.classes[0].class);
    const next = allClasses.find((c) => c.slug === slug);
    return check(current) && (next ? (next.hitDie, true) : true); // full check done on selection below
  };

  const levelData = targetEntry?.data?.levels?.find((l) => l.level === newLevel);
  const grantsSubclass = (levelData?.features ?? []).some((f) => /subclass$/.test(f));
  const isAsiLevel = (levelData?.features ?? []).some((f) => /ability-score-improvement/.test(f));

  const prereqFail = useMemo(() => {
    if (!targetEntry || character.classes.some((c) => c.class === target)) return null;
    const need = [
      ...(targetEntry.data.primaryAbilities ?? []),
      ...(lookup.get('class', character.classes[0].class)?.data?.primaryAbilities ?? []),
    ];
    const missing = [...new Set(need)].filter((a) => (character.abilities[a] ?? 0) < 13);
    return missing.length ? missing : null;
  }, [targetEntry, target, character, lookup]);

  const doRoll = () => {
    const die = targetEntry?.data?.hitDie ?? 8;
    setHpRoll(roll(`1d${die}`).total);
    setHpMode('roll');
  };

  const ready = targetEntry && !prereqFail
    && (!grantsSubclass || subclass)
    && (!isAsiLevel || asi.kind === 'feat' ? true : true);

  const apply = () => {
    const next = structuredClone(character);
    const cls = next.classes.find((c) => c.class === target);
    const hpValue = hpMode === 'roll' ? hpRoll : null;
    if (cls) {
      cls.level += 1;
      cls.hpRolls = [...(cls.hpRolls ?? []), hpValue];
      if (subclass) cls.subclass = subclass;
    } else {
      next.classes.push({ class: target, subclass: subclass ?? null, level: 1, hpRolls: [hpValue] });
    }
    if (isAsiLevel) {
      if (asi.kind === 'asi' && asi.a) {
        next.abilities[asi.a] = Math.min(20, next.abilities[asi.a] + (asi.b && asi.b !== asi.a ? 1 : 2));
        if (asi.b && asi.b !== asi.a) next.abilities[asi.b] = Math.min(20, next.abilities[asi.b] + 1);
      } else if (asi.kind === 'feat' && asi.feat) {
        next.feats = [...(next.feats ?? []), asi.feat];
      }
    }
    onApply(next);
  };

  return (
    <div className="advquery-backdrop" onClick={onClose}>
      <div className="advquery levelup" onClick={(e) => e.stopPropagation()}>
        <h3>Level up → level {totalLevel}</h3>

        <p>
          Class:{' '}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {character.classes.map((c) => (
              <option key={c.class} value={c.class}>{c.class} ({c.level} → {c.level + 1})</option>
            ))}
            <optgroup label="multiclass into…">
              {allClasses.filter((c) => !character.classes.some((x) => x.class === c.slug)).map((c) => (
                <option key={c.slug} value={c.slug}>{c.name} 1</option>
              ))}
            </optgroup>
          </select>
        </p>
        {prereqFail && (
          <p className="warn">Multiclass prerequisites not met: need 13+ {prereqFail.map((a) => a.toUpperCase()).join(', ')}.</p>
        )}

        {targetEntry && (
          <>
            <p>
              Hit points (d{targetEntry.data.hitDie}, CON {fmtMod(abilityMod(character.abilities.con))}):{' '}
              <label><input type="radio" checked={hpMode === 'average'} onChange={() => setHpMode('average')} />
                {' '}average ({targetEntry.data.hitDie / 2 + 1})</label>{' '}
              <label><input type="radio" checked={hpMode === 'roll'} onChange={() => hpRoll == null ? doRoll() : setHpMode('roll')} />
                {' '}roll{hpRoll != null ? `ed: ${hpRoll}` : ''}</label>
              {hpMode === 'roll' && hpRoll == null && <button className="linkish" onClick={doRoll}>roll now</button>}
            </p>

            {levelData?.features?.length > 0 && (
              <p className="muted">New at {target} {newLevel}: {levelData.features.map((f) => f.replace(/-/g, ' ')).join(', ')}</p>
            )}

            {grantsSubclass && (
              <p>
                Subclass:{' '}
                <select value={subclass ?? ''} onChange={(e) => setSubclass(e.target.value || null)}>
                  <option value="">— choose —</option>
                  {subclasses.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
              </p>
            )}

            {isAsiLevel && (
              <div className="wizhint">
                <p>
                  <label><input type="radio" checked={asi.kind === 'asi'} onChange={() => setAsi({ ...asi, kind: 'asi' })} /> Ability scores</label>{' '}
                  <label><input type="radio" checked={asi.kind === 'feat'} onChange={() => setAsi({ ...asi, kind: 'feat' })} /> Feat</label>
                </p>
                {asi.kind === 'asi' ? (
                  <p>
                    +2 to <select value={asi.a ?? ''} onChange={(e) => setAsi({ ...asi, a: e.target.value || null })}>
                      <option value="">—</option>
                      {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                    </select>
                    {' '}or +1/+1 with <select value={asi.b ?? ''} onChange={(e) => setAsi({ ...asi, b: e.target.value || null })}>
                      <option value="">—</option>
                      {ABILITIES.filter((a) => a !== asi.a).map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
                    </select>
                  </p>
                ) : (
                  <p>
                    Feat: <select value={asi.feat ?? ''} onChange={(e) => setAsi({ ...asi, feat: e.target.value || null })}>
                      <option value="">— choose —</option>
                      {feats.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                    </select>
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="advquery-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={apply}>Apply level {totalLevel}</button>
        </div>
      </div>
    </div>
  );
}

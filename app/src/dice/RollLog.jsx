import React, { useState } from 'react';
import { useRoller } from './RollContext.jsx';

function DiceTerm({ term }) {
  if (term.kind === 'mod') return <span className="mod">{term.sign < 0 ? '−' : '+'}{term.value}</span>;
  return (
    <span className="diceterm">
      <span className="dicelabel">{term.count}d{term.sides}{term.keep ? term.keep.mode + term.keep.n : ''}:</span>
      {term.rolls.map((r, i) => (
        <span key={i} className={`die${r.kept ? '' : ' dropped'}${term.sides === 20 && r.value === 20 ? ' nat20' : ''}${term.sides === 20 && r.value === 1 ? ' nat1' : ''}`}>
          {r.value}
        </span>
      ))}
    </span>
  );
}

function RollCard({ entry }) {
  return (
    <div className={`rollcard${entry.d20?.crit ? ' crit' : ''}${entry.d20?.fumble ? ' fumble' : ''}`}>
      <div className="rollhead">
        <span className="rolllabel">{entry.label}</span>
        {entry.mode && <span className={`badge ${entry.mode}`}>{entry.mode === 'adv' ? 'ADV' : 'DIS'}</span>}
      </div>
      {entry.sublabel && <div className="rollsub">{entry.sublabel}</div>}
      <div className="rollbody">
        <div className="rollterms">
          <span className="formula">{entry.formula}</span>
          <div>{entry.terms.map((t, i) => <DiceTerm key={i} term={t} />)}</div>
        </div>
        <div className="rolltotal">{entry.total}</div>
      </div>
    </div>
  );
}

const TRAY_KEY = 'dnd-companion.rolltray.open';

// Fixed right rail: stays put while the page scrolls. Default face is clean —
// a d20 quick roll plus a "+" that expands the full tray (all dice + formula).
export default function RollLog() {
  const { log, rollDice, clearLog } = useRoller();
  const [manual, setManual] = useState('');
  const [trayOpen, setTrayOpen] = useState(() => localStorage.getItem(TRAY_KEY) === '1');

  const toggleTray = () => {
    setTrayOpen((open) => {
      localStorage.setItem(TRAY_KEY, open ? '0' : '1');
      return !open;
    });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!manual.trim()) return;
    try {
      rollDice({ label: 'Custom roll', formula: manual.trim() });
      setManual('');
    } catch { /* leave the bad formula in the box */ }
  };

  return (
    <aside className="rolllog">
      <div className="rolllog-head">
        <h2>Rolls</h2>
        {log.length > 0 && <button className="linkish" onClick={clearLog}>clear</button>}
      </div>
      <div className="quickdice">
        <button
          className="d20-quick"
          title="Roll 1d20"
          onClick={() => rollDice({ label: 'd20', formula: '1d20' })}
        >
          <svg viewBox="0 0 32 32" width="17" height="17" aria-hidden="true">
            <polygon points="16,1 29,8.5 29,23.5 16,31 3,23.5 3,8.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
            <text x="16" y="21" textAnchor="middle" fontSize="12" fill="currentColor" fontWeight="700">20</text>
          </svg>
          d20
        </button>
        <button
          className={`tray-toggle${trayOpen ? ' open' : ''}`}
          title={trayOpen ? 'Hide dice tray' : 'More dice + custom formula'}
          aria-expanded={trayOpen}
          onClick={toggleTray}
        >{trayOpen ? '−' : '+'}</button>
      </div>
      {trayOpen && (
        <div className="tray-expanded">
          <div className="dicetray">
            {[4, 6, 8, 10, 12, 20, 100].map((d) => (
              <button key={d} onClick={() => rollDice({ label: `d${d}`, formula: `1d${d}` })}>D{d}</button>
            ))}
          </div>
          <form onSubmit={submit}>
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="e.g. 2d20kh1+5"
              spellCheck={false}
            />
          </form>
        </div>
      )}
      <div className="rolllog-entries">
        {log.length === 0 && <p className="muted">Click anything rollable — attacks, saves, damage — or roll from the tray above.</p>}
        {log.map((e) => <RollCard key={e.id} entry={e} />)}
      </div>
    </aside>
  );
}

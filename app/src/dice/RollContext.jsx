import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { roll, withAdvantage } from './engine.js';

// Central roller: any component calls rollDice(...) and the result lands in the
// shared roll log. Rolls flagged `query: true` (attacks, checks, saves) first pop
// the advantage/disadvantage query, matching Roll20's flow.

const RollCtx = createContext(null);
export const useRoller = () => useContext(RollCtx);

const LOG_KEY = 'dnd-companion.rolllog.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(LOG_KEY)) ?? []; } catch { return []; } };

export function RollProvider({ children }) {
  const [log, setLog] = useState(load);
  const [pending, setPending] = useState(null); // roll awaiting adv/dis answer

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100)));
  }, [log]);

  const commit = useCallback((label, sublabel, formula, mode) => {
    const result = roll(withAdvantage(formula, mode));
    setLog((l) => [{
      id: crypto.randomUUID(),
      ts: Date.now(),
      label, sublabel: sublabel ?? null, mode: mode ?? null,
      ...result,
    }, ...l].slice(0, 100));
  }, []);

  const rollDice = useCallback(({ label, sublabel, formula, query }) => {
    if (query && /d20(?!\d)/.test(formula)) setPending({ label, sublabel, formula });
    else commit(label, sublabel, formula, null);
  }, [commit]);

  const answer = (mode) => {
    if (pending) commit(pending.label, pending.sublabel, pending.formula, mode);
    setPending(null);
  };

  return (
    <RollCtx.Provider value={{ log, rollDice, clearLog: () => setLog([]) }}>
      {children}
      {pending && (
        <div className="advquery-backdrop" onClick={() => setPending(null)}>
          <div className="advquery" onClick={(e) => e.stopPropagation()}>
            <h3>{pending.label}</h3>
            <div className="advquery-buttons">
              <button onClick={() => answer('dis')}>Disadvantage</button>
              <button className="primary" onClick={() => answer(null)}>Normal</button>
              <button onClick={() => answer('adv')}>Advantage</button>
            </div>
          </div>
        </div>
      )}
    </RollCtx.Provider>
  );
}

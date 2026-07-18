import React, { useCallback, useEffect, useState } from 'react';
import Browser from './compendium/Browser.jsx';
import Detail from './compendium/Detail.jsx';
import CharacterList from './sheet/CharacterList.jsx';
import Sheet from './sheet/Sheet.jsx';
import Wizard from './builder/Wizard.jsx';
import Homebrew from './homebrew/Homebrew.jsx';
import DMScreen from './dm/DMScreen.jsx';
import Sigil, { LichWatermark } from './Sigil.jsx';
import { RollProvider } from './dice/RollContext.jsx';
import RollLog from './dice/RollLog.jsx';

// Hash routes: #/spell  ·  #/spell/fireball  ·  #/spell/fireball?edition=2014

const TYPE_ORDER = [
  'spell', 'monster', 'item', 'class', 'subclass', 'species', 'background', 'feat', 'feature',
  'condition', 'rule', 'table', 'adventure', 'book', 'item-group', 'legendary-group',
  'language', 'disease', 'deity', 'reward', 'recipe', 'psionic', 'action', 'hazard',
  'vehicle', 'vehicle-upgrade', 'deck', 'card', 'object',
];

const parseHash = () => {
  const [path, query] = (location.hash.replace(/^#\/?/, '') || 'dm').split('?');
  const [type, slug] = path.split('/');
  const edition = new URLSearchParams(query).get('edition') ?? '';
  return { type: type || 'dm', slug: slug || null, edition };
};

export default function App() {
  const [types, setTypes] = useState({});
  const [route, setRoute] = useState(parseHash);
  const [dmPending, setDmPending] = useState(null);

  useEffect(() => {
    fetch('/api/compendium/types').then((r) => r.json()).then(setTypes);
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (type, slug, edition) => {
    location.hash = `#/${type}${slug ? `/${slug}` : ''}${edition ? `?edition=${edition}` : ''}`;
  };

  const grand = Object.values(types).reduce((a, b) => a + b, 0);
  const addToDm = (entry) => {
    setDmPending(entry);
    go('dm');
  };
  const clearDmPending = useCallback(() => setDmPending(null), []);

  return (
    <RollProvider>
      <div className="layout">
        <LichWatermark />
        <div className="content">
          <header>
            <Sigil className="crest" />
            <h1>Dungeon Master's Companion</h1>
            <span className="counts">{grand ? `${grand.toLocaleString()} entries` : 'loading…'}</span>
          </header>
          <nav className="types primary">
            <button className={route.type === 'dm' ? 'active' : ''} onClick={() => go('dm')}>☠ DM screen</button>
            <button
              className={TYPE_ORDER.includes(route.type) ? 'active' : ''}
              onClick={() => go('monster')}
            >📖 compendium</button>
            <button
              className={route.type === 'characters' ? 'active' : ''}
              onClick={() => go('characters')}
            >⚔ characters</button>
            <button
              className={route.type === 'homebrew' ? 'active' : ''}
              onClick={() => go('homebrew')}
            >⚗ homebrew</button>
          </nav>
          {TYPE_ORDER.includes(route.type) && (
            <nav className="types">
              {TYPE_ORDER.filter((t) => types[t]).map((t) => (
                <button key={t} className={t === route.type ? 'active' : ''} onClick={() => go(t)}>
                  {t} <span className="muted">({types[t]})</span>
                </button>
              ))}
            </nav>
          )}
          <main>
            {route.type === 'dm' ? (
              <DMScreen pending={dmPending} onPendingHandled={clearDmPending} />
            ) : route.type === 'homebrew' ? (
              <Homebrew />
            ) : route.type === 'characters' ? (
              route.slug === 'new'
                ? <Wizard onDone={(id) => go('characters', id)} onCancel={() => go('characters')} />
                : route.slug
                  ? <Sheet id={route.slug} onBack={() => go('characters')} />
                  : <CharacterList onOpen={(id) => go('characters', id)} onNew={() => go('characters', 'new')} />
            ) : route.slug ? (
              <Detail
                type={route.type}
                slug={route.slug}
                edition={route.edition}
                onBack={() => go(route.type)}
                onSwitchEdition={(ed) => go(route.type, route.slug, ed)}
                onAddToDm={addToDm}
              />
            ) : (
              <Browser type={route.type} onOpen={(r) => go(r.type, r.slug, r.edition === '2014' ? '2014' : '')} />
            )}
          </main>
        </div>
        <RollLog />
      </div>
    </RollProvider>
  );
}

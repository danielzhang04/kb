/**
 * SPA shell (D0.9). Control-view landing (Option B, adopted default Q1) with the Code view one
 * toggle away. Navigation is a hand-rolled two-view toggle rather than a router dependency: the v0
 * surface is exactly these two top-level views reachable by "one toggle" (no URL/nested routing is
 * needed until D2/D3 populate the Code view), so a `react-router` dep is not warranted here.
 */
import { useState } from 'react';
import { Control } from './views/Control';
import { CodeView } from './views/CodeView';

type View = 'control' | 'code';

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('control');

  return (
    <div className="app-shell">
      <header className="app-shell__topbar">
        <h1 className="app-shell__title">kb Mission Control</h1>
        <nav className="app-shell__tabs" aria-label="Primary views">
          <button
            type="button"
            className={`app-shell__tab${view === 'control' ? ' app-shell__tab--active' : ''}`}
            aria-current={view === 'control' ? 'page' : undefined}
            onClick={() => setView('control')}
          >
            Control
          </button>
          <button
            type="button"
            className={`app-shell__tab${view === 'code' ? ' app-shell__tab--active' : ''}`}
            aria-current={view === 'code' ? 'page' : undefined}
            onClick={() => setView('code')}
          >
            Code
          </button>
        </nav>
        <span className="app-shell__badge">v0 · read-only observatory</span>
      </header>
      <main className="app-shell__body">{view === 'control' ? <Control /> : <CodeView />}</main>
    </div>
  );
}

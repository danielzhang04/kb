import { Fragment, useEffect, useMemo, useState } from 'react';
import { ExecutionArmingProvider } from './control/ExecutionUnlock';
import { getAttention } from './control/controlClient';
import { fetchInbox } from './lib/inboxClient';
import { createInboxRefresher } from './lib/inboxRefresher';
import {
  type ClientRuntimeCapabilities, decodeRuntimeCapabilities, RuntimeCapabilitiesProvider,
  UNAVAILABLE_RUNTIME_CAPABILITIES,
} from './lib/runtimeCapabilities';
import { SessionProvider, useSession } from './lib/sessionContext';
import { useSse, type SseFactory } from './lib/sseClient';
import { applyTheme, persistThemeChoice, readThemeChoice, type ThemeChoice } from './lib/theme';
import { DEFAULT_DESTINATION, isLive, NAV_SECTIONS, type DestinationId, type NavDestination } from './nav/config';
import {
  backStack,
  focusTarget,
  goToStack,
  navigationSearchFor,
  parseNavigationSearch,
  pushStack,
  setSectionOnStack,
  type NavEntry,
  type NavTarget,
} from './nav/stack';
import { CommandPalette } from './palette/CommandPalette';
import type { PaletteCommand } from './palette/paletteModel';
import { Agents } from './views/Agents';
import { Browser } from './views/Browser';
import { Health } from './views/Health';
import { Home } from './views/Home';
import { Inbox } from './views/Inbox';
import { Projects } from './views/Projects';
import { SchedulesBody as Schedules } from './views/Schedules';
import { Tasks } from './views/Tasks';
import { Terminal } from './views/Terminal';
import { Workflows } from './views/Workflows';

const DISABLED_SSE_FACTORY: SseFactory = () => ({
  addEventListener: () => undefined,
  close: () => undefined,
});
const NARROW_VIEWPORT_QUERY = '(max-width: 899px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function useInboxCount(enabled: boolean, tick: number): number {
  const [count, setCount] = useState(0);
  const refresher = useMemo(() => createInboxRefresher({
    load: () => fetchInbox(),
    onSuccess: (response) => setCount(response.items.length),
    onFailure: () => undefined,
  }), [enabled]);
  useEffect(() => () => refresher.dispose(), [refresher]);
  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    refresher.trigger();
  }, [enabled, refresher, tick]);
  return count;
}

function useAttentionCounts(token: string | undefined, tick: number): { agents: number; workflows: number } {
  const [counts, setCounts] = useState({ agents: 0, workflows: 0 });
  useEffect(() => {
    if (!token) {
      setCounts({ agents: 0, workflows: 0 });
      return;
    }
    let alive = true;
    void getAttention(token).then((attention) => {
      if (!alive) return;
      const distinct = new Map(attention.pairs.map((pair) => [
        `${pair.runRef}\u0000${pair.owner.type}\u0000${pair.owner.id}\u0000${pair.owner.type === 'workflow' ? pair.owner.project : ''}`,
        pair,
      ]));
      setCounts({
        agents: [...distinct.values()].filter((pair) => pair.owner.type === 'agent').length,
        workflows: [...distinct.values()].filter((pair) => pair.owner.type === 'workflow').length,
      });
    }).catch(() => { if (alive) setCounts({ agents: 0, workflows: 0 }); });
    return () => { alive = false; };
  }, [tick, token]);
  return counts;
}

export function NavItem({ item, active, badge, onSelect }: {
  item: NavDestination;
  active: DestinationId;
  badge?: number;
  onSelect: (id: DestinationId) => void;
}): React.JSX.Element {
  const disabled = !isLive(item);
  return (
    <li className="mc-nav-item__li">
      <button
        type="button"
        className={`mc-nav-item${active === item.id ? ' mc-nav-item--active' : ''}${disabled ? ' mc-nav-item--disabled' : ''}`}
        title={item.label}
        aria-current={active === item.id ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onSelect(item.id)}
      >
        <span className="mc-nav-item__icon mc-mono" aria-hidden="true">{item.icon}</span>
        <span className="mc-nav-item__label">{item.label}</span>
        {badge && badge > 0 ? <span className="mc-nav-item__badge mc-mono" aria-label={`${badge} pending`}>{badge}</span> : null}
      </button>
    </li>
  );
}

function SessionChip(): React.JSX.Element {
  const { mode, session, locked, requireSession } = useSession();
  const [, retick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => retick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [session]);
  if (locked) {
    return <button type="button" className="mc-btn mc-btn--primary mc-session-chip mc-session-chip--locked" data-testid="session-chip" onClick={() => void requireSession()}>Unlock</button>;
  }
  if (mode === 'tailnet') {
    return <button type="button" className="mc-session-chip" data-testid="session-chip" disabled>Tailnet · connected</button>;
  }
  const minutes = session ? Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 60_000)) : 0;
  return <button type="button" className="mc-session-chip" data-testid="session-chip" disabled>{`Unlocked · expires in ${minutes}m`}</button>;
}

function SignInView(): React.JSX.Element {
  return <main className="mc-main"><section className="code-view" aria-label="Sign in"><h2>Sign in</h2><p>Unlock this dashboard with your device passkey.</p><SessionChip /></section></main>;
}

function BootingView(): React.JSX.Element {
  return <main className="mc-main"><section className="code-view" aria-label="Starting dashboard" aria-live="polite"><h2>Starting dashboard</h2></section></main>;
}

function Sidebar({ active, onSelect, rail, railForced, onToggleRail, badges }: {
  active: DestinationId;
  onSelect: (id: DestinationId) => void;
  rail: boolean;
  railForced: boolean;
  onToggleRail: () => void;
  badges: Partial<Record<'inbox' | 'agents' | 'workflows', number>>;
}): React.JSX.Element {
  return (
    <nav className="mc-sidebar" aria-label="Primary navigation">
      <div className="mc-sidebar__brand">
        <span className="mc-sidebar__brand-text">kb</span>
        <button type="button" className="mc-sidebar__collapse-toggle" aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={rail} hidden={railForced} onClick={onToggleRail}>{rail ? '»' : '«'}</button>
      </div>
      <div className="mc-nav">
        {NAV_SECTIONS.map((section, sectionIndex) => (
          <Fragment key={section.id}>
            {sectionIndex > 0 ? <div className="mc-nav__divider" role="separator" /> : null}
            <ul className="mc-nav-section__items">
              {section.items.map((item) => (
                <NavItem key={item.id} item={item} active={active} badge={item.id === 'inbox' || item.id === 'agents' || item.id === 'workflows' ? badges[item.id] : undefined} onSelect={onSelect} />
              ))}
            </ul>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

function ViewBody({ entry, onPush, onBack, onSectionChange, onNavigateTarget, onOpenAgentTerminal, onOpenWorkflowTerminal }: {
  entry: NavEntry;
  onPush: (target: NavTarget) => void;
  onBack: () => void;
  onSectionChange: (section: string) => void;
  onNavigateTarget: (target: NavTarget) => void;
  onOpenAgentTerminal: (agent: { id: string }) => void;
  onOpenWorkflowTerminal: (workflow: { id: string }) => void;
}): React.JSX.Element {
  switch (entry.view) {
    case 'home': return <Home onNavigateTarget={onNavigateTarget} />;
    case 'inbox': return <Inbox onNavigate={onNavigateTarget} />;
    case 'schedules': return <Schedules scheduleOwner={entry.scheduleOwner} />;
    case 'terminal': return <></>;
    case 'agents': return <Agents filter={entry.filter} focusAgentId={entry.focus?.kind === 'agent' ? entry.focus.id : null} onOpenAgent={(id) => onPush({ ...focusTarget({ kind: 'agent', id }), ...(entry.filter ? { filter: entry.filter } : {}) })} onBack={onBack} activeSectionId={entry.section} onSectionChange={onSectionChange} onNavigate={onNavigateTarget} onOpenTerminal={onOpenAgentTerminal} />;
    case 'workflows': return <Workflows filter={entry.filter} focusWorkflowId={entry.focus?.kind === 'workflow' ? entry.focus.id : null} focusRunRef={entry.focus?.kind === 'run' ? entry.focus.id : null} onOpenWorkflow={(id) => onPush({ ...focusTarget({ kind: 'workflow', id }), ...(entry.filter ? { filter: entry.filter } : {}) })} onOpenRun={(id) => onPush(focusTarget({ kind: 'run', id }))} onBack={onBack} onNavigate={onNavigateTarget} activeSectionId={entry.section} onSectionChange={onSectionChange} onOpenTerminal={onOpenWorkflowTerminal} />;
    case 'tasks': return <Tasks initialSelectedId={entry.focus?.kind === 'card' ? entry.focus.id : undefined} />;
    case 'projects': return <section aria-label="Projects view"><Projects /></section>;
    case 'files': return <section aria-label="Files view"><Browser /></section>;
    case 'health': return <Health />;
  }
}

export function App(): React.JSX.Element {
  return <SessionProvider><ExecutionArmingProvider><AppShell /></ExecutionArmingProvider></SessionProvider>;
}

function AppShell(): React.JSX.Element {
  const { mode, locked } = useSession();
  if (mode === null) return <BootingView />;
  return locked ? <SignInView /> : <AuthenticatedAppShell />;
}

function AuthenticatedAppShell(): React.JSX.Element {
  const { session } = useSession();
  const [stack, setStack] = useState<NavEntry[]>(() => typeof window === 'undefined' ? goToStack(DEFAULT_DESTINATION) : parseNavigationSearch(window.location.search));
  const current = stack.at(-1) ?? { view: DEFAULT_DESTINATION };
  const view = current.view;
  const [rail, setRail] = useState(view === 'terminal');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice());
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<ClientRuntimeCapabilities>(UNAVAILABLE_RUNTIME_CAPABILITIES);
  const viewportForcesRail = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const { count: controlTick } = useSse('/events', session?.token ? undefined : DISABLED_SSE_FACTORY);
  const inboxCount = useInboxCount(view !== 'inbox', controlTick);
  const attention = useAttentionCounts(session?.token, controlTick);
  const terminalVisible = view === 'terminal';
  const railMode = rail || viewportForcesRail;

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const onPopState = (): void => {
      const next = parseNavigationSearch(window.location.search);
      setStack(next);
      setRail(next.at(-1)?.view === 'terminal');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    const search = navigationSearchFor(current);
    if (window.location.search !== search) window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  }, [current]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!session?.token) return;
    let alive = true;
    void fetch('/api/runtime/capabilities', { headers: { authorization: `Bearer ${session.token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('runtime capabilities unavailable');
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        // A payload without the closed capability is not a terminal we may advertise: the decoder
        // refuses it and the app falls back to the same closed unavailable state as a failed fetch.
        const capabilities = decodeRuntimeCapabilities(payload);
        if (alive) setRuntimeCapabilities(capabilities ?? UNAVAILABLE_RUNTIME_CAPABILITIES);
      })
      .catch(() => { if (alive) setRuntimeCapabilities(UNAVAILABLE_RUNTIME_CAPABILITIES); });
    return () => { alive = false; };
  }, [session?.token]);

  const goTo = (id: DestinationId): void => {
    setStack(goToStack(id));
    setRail(id === 'terminal');
  };
  const push = (target: NavTarget): void => {
    setStack((currentStack) => pushStack(currentStack, target));
    setRail(target.view === 'terminal');
  };
  const navigateTo = (target: NavTarget): void => push(target);
  // "Open terminal" from a roster row is a NAVIGATION, not a spawn: the v2 grammar has no agent- or
  // workflow-primed launcher, so the workspace opens and the operator picks a launcher there.
  const openTerminal = (): void => goTo('terminal');
  const runPaletteCommand = (command: PaletteCommand): void => goTo(command.target);
  const toggleTheme = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    persistThemeChoice(next);
  };

  return (
    <RuntimeCapabilitiesProvider value={runtimeCapabilities}>
      <div className={`app-shell${railMode ? ' app-shell--rail' : ''}`}>
        <Sidebar active={view} onSelect={goTo} rail={railMode} railForced={viewportForcesRail} onToggleRail={() => setRail((value) => !value)} badges={{
          inbox: inboxCount, agents: attention.agents, workflows: attention.workflows,
        }} />
        <header className="mc-topbar">
          <h1 className="mc-topbar__title">kb mission control</h1>
          <span className="mc-topbar__glance"><span className="mc-status-dot mc-status-dot--running" aria-hidden="true" />local agent operations</span>
          <SessionChip />
          <button type="button" className="mc-theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? '☾' : '☀'}</button>
        </header>
        <main className={terminalVisible ? 'mc-main mc-main--terminal' : 'mc-main'}>
          <div className="persistent-terminal-surface" hidden={!terminalVisible} aria-hidden={!terminalVisible} data-testid="persistent-terminal-surface">
            <Terminal ptyEnabled={runtimeCapabilities.pty === true} visible={terminalVisible} onOpenHealth={() => goTo('health')} />
          </div>
          {view !== 'terminal' ? <ViewBody entry={current} onPush={push} onBack={() => setStack((value) => backStack(value))} onSectionChange={(section) => setStack((value) => setSectionOnStack(value, section))} onNavigateTarget={navigateTo} onOpenAgentTerminal={openTerminal} onOpenWorkflowTerminal={openTerminal} /> : null}
        </main>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onRun={runPaletteCommand} />
      </div>
    </RuntimeCapabilitiesProvider>
  );
}

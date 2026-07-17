/**
 * SPA shell (U2.5 — entity-first IA). Desktop-first "Mission Control" shell: a fixed left sidebar owns
 * primary navigation, a slim topbar carries the app title and a fleet-status glance, and the main
 * region renders whichever view is active. A pinned-bottom Session/Stop floor lives in the sidebar so
 * the WebAuthn session state and the fleet-stop controls are always reachable — never hunted for.
 *
 * Navigation is a hand-rolled `useState` switch rather than a router dependency — the v0/v1 surface is
 * a fixed, known set of top-level views (no URL/nested routing is needed until D3 adds real sub-routes),
 * so a `react-router` dep is not warranted here.
 *
 * The nav is driven entirely by `NAV_SECTIONS` in `src/nav/config.ts`, rendered as UNLABELLED groups
 * separated by hairline dividers (entity-first IA — no uppercase group headers; supersedes brief §D's
 * verb grouping). A [+ New ▾] menu sits above the first divider. A new destination is ONE entry in that
 * config; a destination with a dedicated view also gets one `case` in the body switch below (everything
 * else lands on the shared U3 {@link ComingSoon} placeholder). The whole sidebar collapses to a 48px
 * icon rail (icons keep a hover tooltip via the native title attribute). Destinations flagged
 * `soon`/`future` render greyed + disabled.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  NAV_SECTIONS,
  DEFAULT_DESTINATION,
  isLive,
  type DestinationId,
  type NavDestination,
  type NewMenuEntry,
} from './nav/config';
import { NewMenu } from './nav/NewMenu';
import { CommandPalette } from './palette/CommandPalette';
import type { PaletteCommand } from './palette/paletteModel';
import { Flyout } from './flyout/Flyout';
import { useFleetData } from './flyout/useFleetData';
import { FLYOUT_DESTINATIONS, summaryFor, type FlyoutSummary } from './flyout/flyoutModel';
import { StopControls } from './views/Control';
import { Home } from './views/Home';
import { ApprovalsLive } from './views/ApprovalsLive';
import { Browser } from './views/Browser';
import { Timeline } from './views/Timeline';
import { Workflows } from './views/Workflows';
import { Connectors } from './views/Connectors';
import { Tasks } from './views/Tasks';
import { Pipeline } from './views/Pipeline';
import { Agents } from './views/Agents';
import { Projects } from './views/Projects';
import { Ledgers } from './views/Ledgers';
import { Sentinel } from './views/panels/Sentinel';
import { Quartermaster } from './views/panels/Quartermaster';
import { FlightRecorder } from './views/panels/FlightRecorder';
import { Atlas } from './views/panels/Atlas';
import { DeployOutcome } from './composer/DeployOutcome';
import type { SeedKind } from './composer/artifactTypes';
import { fetchPending } from './lib/approvalsClient';
import { useSse } from './lib/sseClient';
import { signIn, type Session } from './lib/authClient';
import { readThemeChoice, persistThemeChoice, applyTheme, type ThemeChoice } from './lib/theme';

/** Live count of pending approvals for the sidebar badge. Reuses the same `fetchPending` + SSE-tick
 *  pattern as {@link ApprovalsLive}, so the count refreshes when a card is promoted without a reload.
 *  Cheap: one GET per SSE tick; on failure it silently keeps the last-known count. */
function useApprovalsCount(): number {
  const [count, setCount] = useState(0);
  const { count: tick } = useSse('/events');
  useEffect(() => {
    let alive = true;
    fetchPending()
      .then((cards) => {
        if (alive) setCount(cards.length);
      })
      .catch(() => {
        /* transient failure: keep the last-known count; the next SSE tick retries */
      });
    return () => {
      alive = false;
    };
  }, [tick]);
  return count;
}

export function NavItem({
  item,
  active,
  badge,
  onSelect,
  summary,
  flyoutDelay = 150,
}: {
  item: NavDestination;
  active: DestinationId;
  badge?: number;
  onSelect: (id: DestinationId) => void;
  /** Live contents summary for the hover-flyout, or undefined for items without one. */
  summary?: FlyoutSummary | null;
  /** Delay before the flyout opens on hover/focus (ms). Injectable for tests. */
  flyoutDelay?: number;
}): React.JSX.Element {
  const disabled = !isLive(item);
  const hasFlyout = Boolean(summary && !summary.empty);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const scheduleFlyout = (): void => {
    if (!hasFlyout) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFlyoutOpen(true), flyoutDelay);
  };
  const closeFlyout = (): void => {
    clearTimeout(timerRef.current);
    setFlyoutOpen(false);
  };

  return (
    <li className="mc-nav-item__li">
      <button
        type="button"
        ref={btnRef}
        className={`mc-nav-item${active === item.id ? ' mc-nav-item--active' : ''}${
          disabled ? ' mc-nav-item--disabled' : ''
        }`}
        // Rail-mode hover tooltip (VS Code activity-bar / Linear pattern).
        title={item.hint ? `${item.label} · ${item.hint}` : item.label}
        aria-current={active === item.id ? 'page' : undefined}
        disabled={disabled}
        onClick={() => {
          closeFlyout();
          onSelect(item.id);
        }}
        onMouseEnter={scheduleFlyout}
        onMouseLeave={closeFlyout}
        onFocus={scheduleFlyout}
        onBlur={closeFlyout}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && flyoutOpen) {
            e.stopPropagation();
            closeFlyout();
          }
        }}
      >
        <span className="mc-nav-item__icon mc-mono" aria-hidden="true">
          {item.icon}
        </span>
        <span className="mc-nav-item__label">{item.label}</span>
        {badge && badge > 0 ? (
          <span className="mc-nav-item__badge mc-mono" aria-label={`${badge} pending`}>
            {badge}
          </span>
        ) : item.hint ? (
          <span className="mc-nav-item__hint">{item.hint}</span>
        ) : null}
      </button>
      <Flyout open={flyoutOpen} id={item.id} summary={summary} anchor={btnRef} />
    </li>
  );
}

/**
 * The Session/Stop floor (U5.1 redesign) — pinned to the bottom of the sidebar, hairline-separated,
 * always visible. Daniel's review round 1 retired the explicit sign-in/sign-out chrome: there is no
 * "Sign in" button and no "Signed in/out" label. Instead a QUIET, passive indicator reflects whether a
 * session is currently held, and the WebAuthn ceremony (`authClient.signIn`, unchanged) now runs at
 * point-of-action — the governed {@link StopControls} below receive `onRequestSession`, so attempting a
 * stop without a session mints one inline rather than gating behind a sign-in wall. In rail mode the
 * detail collapses to a single stop glyph.
 */
function SessionStopFloor({
  session,
  onRequestSession,
}: {
  session: Session | null;
  onRequestSession: () => Promise<Session | null>;
}): React.JSX.Element {
  const active = session !== null;
  return (
    <div className="mc-sidebar__floor" data-testid="stop-floor">
      <div className="mc-session" data-testid="session-state" title="Session state">
        <span
          className={`mc-status-dot ${active ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
          aria-hidden="true"
        />
        <span className="mc-session__label">{active ? 'session active' : 'session'}</span>
      </div>
      <span className="mc-sidebar__floor-rail" aria-hidden="true" title="Stop floor">
        ⏻
      </span>
      <StopControls sessionToken={session?.token} onRequestSession={onRequestSession} />
    </div>
  );
}

function Sidebar({
  active,
  onSelect,
  onCreate,
  rail,
  onToggleRail,
  approvalsCount,
  session,
  onRequestSession,
}: {
  active: DestinationId;
  onSelect: (id: DestinationId) => void;
  onCreate: (id: NewMenuEntry['id']) => void;
  rail: boolean;
  onToggleRail: () => void;
  approvalsCount: number;
  session: Session | null;
  onRequestSession: () => Promise<Session | null>;
}): React.JSX.Element {
  // One shared snapshot feeds every flyout (module-cached + SSE-refreshed) — no per-hover fetch.
  const { index, registry } = useFleetData();
  const summaries = useMemo(() => {
    const m = new Map<DestinationId, FlyoutSummary | null>();
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (FLYOUT_DESTINATIONS.has(item.id)) m.set(item.id, summaryFor(item.id, index, registry));
      }
    }
    return m;
  }, [index, registry]);

  return (
    <nav className="mc-sidebar" aria-label="Primary navigation">
      <div className="mc-sidebar__brand">
        <span className="mc-sidebar__brand-text">kb</span>
        <button
          type="button"
          className="mc-sidebar__collapse-toggle"
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={rail}
          onClick={onToggleRail}
        >
          {rail ? '»' : '«'}
        </button>
      </div>
      <NewMenu onCreate={onCreate} />
      <div className="mc-nav">
        {/* Unlabelled groups: a hairline divider before each section, NO group header (Linear pattern).
         *  The divider above the first section also separates it from the [+ New] menu. */}
        {NAV_SECTIONS.map((section) => (
          <Fragment key={section.id}>
            <div className="mc-nav__divider" role="separator" />
            <ul className="mc-nav-section__items">
              {section.items.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  active={active}
                  badge={item.id === 'approvals' ? approvalsCount : undefined}
                  onSelect={onSelect}
                  summary={summaries.get(item.id)}
                />
              ))}
            </ul>
          </Fragment>
        ))}
      </div>
      <SessionStopFloor session={session} onRequestSession={onRequestSession} />
    </nav>
  );
}

/** Flatten the config once so the body switch can look up a destination's label/hint for the greyed
 *  placeholder without re-walking sections. */
const DEST_BY_ID: Record<string, NavDestination> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items).map((d) => [d.id, d]),
);

/** Placeholder body for a destination whose real view has not been built yet. After U3 only the greyed
 *  soon/future stubs (Atlas/Terminal) fall through here — the switch keeps this case to stay total. */
function ComingSoon({ id }: { id: DestinationId }): React.JSX.Element {
  const dest = DEST_BY_ID[id];
  const live = dest ? isLive(dest) : false;
  return (
    <section className="code-view" aria-label={`${dest?.label ?? id} view`}>
      <h2>{dest?.label ?? id}</h2>
      <p>
        {live
          ? 'The navigation is in place; this view is built in U3.'
          : dest?.hint === 'D3'
            ? 'Arrives in D3 behind its WebAuthn + threat-review gate. Nothing to view or steer here yet.'
            : 'Arrives in a later wave. Nothing to view or steer here yet.'}
      </p>
    </section>
  );
}

/** Composer view — the [+ New ▾] menu opens this. C5 wraps C3's {@link Composer} in {@link DeployOutcome},
 *  which wires C4's governed deploy dispatcher (POST /api/write/launch | /api/write/save) and surfaces the
 *  outcome (filed card id / branch-PR target / refusal / follow-up saves) inside the Composer surface.
 *  `initialKind` pre-seeds the type chip: `idea` for the idea-first entry, a concrete kind for the
 *  workflow/skill/project entity pickers. */
function ComposerView({
  onClose,
  sessionToken,
  initialKind,
}: {
  onClose: () => void;
  sessionToken?: string;
  initialKind: SeedKind;
}): React.JSX.Element {
  return <DeployOutcome sessionToken={sessionToken} initialKind={initialKind} onBack={onClose} />;
}

/** The read-only layer panels, reachable from the single `sentinel` nav destination via an underline-tab
 *  bar (the Registry internal-tab pattern — one nav entry, four panels behind it). Sentinel (liveness) is
 *  the default tab; Atlas is a static future-layer stub. Each panel self-fetches its own read-only source. */
const LAYER_PANELS = [
  { id: 'sentinel', label: 'Sentinel', render: () => <Sentinel /> },
  { id: 'quartermaster', label: 'Quartermaster', render: () => <Quartermaster /> },
  { id: 'recorder', label: 'Flight Recorder', render: () => <FlightRecorder /> },
  { id: 'atlas', label: 'Atlas', render: () => <Atlas /> },
] as const;

function LayerPanels(): React.JSX.Element {
  const [tab, setTab] = useState<(typeof LAYER_PANELS)[number]['id']>('sentinel');
  const active = LAYER_PANELS.find((p) => p.id === tab) ?? LAYER_PANELS[0];
  return (
    <section className="v-panels" aria-label="Sentinel view">
      <div className="v-panels__tabs" role="tablist" aria-label="Layer panels">
        {LAYER_PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={tab === p.id}
            className={`v-panels__tab${tab === p.id ? ' v-panels__tab--active' : ''}`}
            onClick={() => setTab(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {active.render()}
    </section>
  );
}

/** Route a destination to its view. A destination with a dedicated view gets one case here; only the
 *  greyed soon/future stubs fall through to the shared placeholder. Home is the default rollup landing
 *  and hosts the governed Launch/Rerun surface, so it receives the session token (the [+ New ▾] → Task
 *  action navigates here) and `onNavigate` to jump from a rollup row/tile into its entity view. */
function ViewBody({
  view,
  sessionToken,
  onNavigate,
  onRequestSession,
  onOpenCard,
  taskSelectedId,
}: {
  view: DestinationId;
  sessionToken?: string;
  onNavigate: (id: DestinationId) => void;
  onRequestSession: () => Promise<Session | null>;
  /** Pipeline canvas click-through: open a card in the Tasks detail pane. */
  onOpenCard: (cardId: string) => void;
  /** The card the Tasks view should open on mount (set by a pipeline click-through). */
  taskSelectedId?: string;
}): React.JSX.Element {
  switch (view) {
    case 'home':
      return <Home sessionToken={sessionToken} onNavigate={onNavigate} onRequestSession={onRequestSession} />;
    case 'approvals':
      // Live GET /api/approvals feed (refreshed on SSE), onVerify -> POST /api/approvals/verify.
      return <ApprovalsLive sessionToken={sessionToken} />;
    case 'activity':
      // Standalone full-view live feed (same replay the Home board embeds). Self-fetches.
      return (
        <section aria-label="Activity view">
          <Timeline />
        </section>
      );
    case 'workflows':
      return <Workflows />;
    case 'agents':
      return <Agents sessionToken={sessionToken} onRequestSession={onRequestSession} />;
    case 'tasks':
      return (
        <Tasks
          sessionToken={sessionToken}
          onRequestSession={onRequestSession}
          initialSelectedId={taskSelectedId}
        />
      );
    case 'pipeline':
      // D3.4 — React Flow canvas over the queue's depends-on DAG. Its governed node toggle reuses the
      // card-routing write; a node click-through opens that card in the Tasks detail surface. Pipeline
      // renders its own aria-labelled section.
      return <Pipeline sessionToken={sessionToken} onRequestSession={onRequestSession} onOpenCard={onOpenCard} />;
    case 'projects':
      return (
        <section aria-label="Projects view">
          <Projects />
        </section>
      );
    case 'ledgers':
      return <Ledgers />;
    case 'sentinel':
      // D3.5 — the layer-panel set (Sentinel / Quartermaster / Flight Recorder / Atlas) behind sub-tabs.
      return <LayerPanels />;
    case 'connectors':
      return <Connectors />;
    case 'files':
      return (
        <section aria-label="Files view">
          <Browser />
        </section>
      );
    default:
      return <ComingSoon id={view} />;
  }
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<DestinationId>(DEFAULT_DESTINATION);
  const [rail, setRail] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The [+ New ▾] menu opens the Composer surface over the current view; `composerKind` pre-seeds its
  // type chip (`idea` for the idea-first entry, a concrete kind for the entity pickers).
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerKind, setComposerKind] = useState<SeedKind>('idea');
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice());
  // Card id a Pipeline node click-through wants opened in the Tasks detail pane.
  const [openCardId, setOpenCardId] = useState<string | undefined>(undefined);
  const approvalsCount = useApprovalsCount();

  // Ctrl/Cmd+K toggles the command palette anywhere in the shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = (): void => {
    setTheme((prev) => {
      const next: ThemeChoice = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      persistThemeChoice(next);
      return next;
    });
  };

  // Navigate to a destination, closing the transient Composer placeholder if it was open.
  const goTo = (id: DestinationId): void => {
    setComposerOpen(false);
    setView(id);
  };

  // Pipeline canvas click-through: open the card in the Tasks detail pane and jump there.
  const openCardInTasks = (cardId: string): void => {
    setOpenCardId(cardId);
    goTo('tasks');
  };

  // Run a palette command. The palette is a SHORTCUT, never a bypass: this only changes the active view
  // (navigate) and/or focuses the pinned Session/Stop floor — it never calls a governed endpoint.
  const handlePaletteRun = (cmd: PaletteCommand): void => {
    if (cmd.focusFloor) {
      const btn = document.querySelector<HTMLElement>('[data-testid="stop-floor"] button');
      if (typeof btn?.scrollIntoView === 'function') btn.scrollIntoView({ block: 'nearest' });
      btn?.focus();
    }
    if (cmd.target) goTo(cmd.target);
  };

  // Point-of-action session mint. Runs the WebAuthn ceremony (`authClient.signIn`, unchanged) and holds
  // the minted bearer in app state so every governed surface can use it. Replaces the retired floor
  // "Sign in" button: governed controls call this inline when they need a session. Fail-closed — a
  // refused/absent passkey resolves to null and the action stays a no-op.
  const requestSession = (): Promise<Session | null> =>
    signIn()
      .then((s) => {
        setSession(s);
        return s;
      })
      .catch(() => {
        setSession(null);
        return null;
      });

  // [+ New ▾] routing (C5): "Idea…" opens the Composer surface in idea mode; the "Workflow"/"Skill"/
  // "Project"/"Agent" entity pickers open the SAME surface pre-seeded to that type; "Task" keeps its
  // day-one route to the governed launch surface (Home). C7.2 un-defers "Agent" — it opens the Composer
  // pre-seeded to `agent` (its dedicated draft form lands in a later chunk; until then the operator
  // converges via the chat / picks a concrete type).
  const handleCreate = (id: NewMenuEntry['id']): void => {
    if (id === 'task') {
      setComposerOpen(false);
      setView('home');
    } else if (
      id === 'idea' ||
      id === 'workflow' ||
      id === 'skill' ||
      id === 'project' ||
      id === 'agent'
    ) {
      setComposerKind(id);
      setComposerOpen(true);
    }
  };

  return (
    <div className={`app-shell${rail ? ' app-shell--rail' : ''}`}>
      <Sidebar
        active={view}
        onSelect={goTo}
        onCreate={handleCreate}
        rail={rail}
        onToggleRail={() => setRail((r) => !r)}
        approvalsCount={approvalsCount}
        session={session}
        onRequestSession={requestSession}
      />
      <header className="mc-topbar">
        <h1 className="mc-topbar__title">kb mission control</h1>
        <span className="mc-topbar__glance">
          <span className="mc-status-dot mc-status-dot--running" aria-hidden="true" />
          v0 · read-only observatory
        </span>
        <button
          type="button"
          className="mc-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
        </button>
      </header>
      <main className="mc-main">
        {composerOpen ? (
          <ComposerView
            onClose={() => setComposerOpen(false)}
            sessionToken={session?.token}
            initialKind={composerKind}
          />
        ) : (
          <ViewBody
            view={view}
            sessionToken={session?.token}
            onNavigate={goTo}
            onRequestSession={requestSession}
            onOpenCard={openCardInTasks}
            taskSelectedId={openCardId}
          />
        )}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={handlePaletteRun}
      />
    </div>
  );
}

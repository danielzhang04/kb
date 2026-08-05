/**
 * SPA shell (U2.5 — entity-first IA). Desktop-first "Mission Control" shell: a fixed left sidebar owns
 * primary navigation, a slim topbar carries the app title, a fleet-status glance and the app's ONE
 * unlock affordance (the lock chip), and the main region renders whichever view is active. A
 * pinned-bottom Stop floor lives in the sidebar so the fleet-stop controls are always reachable.
 *
 * The WebAuthn session lives in exactly one place — {@link SessionProvider} — and every surface below
 * reads it with `useSession()` at point of action. No view owns an unlock button, and no view is handed
 * a session-plumbing prop.
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
} from './nav/config';
import {
  backStack,
  focusTarget,
  goToStack,
  pushStack,
  rootStack,
  setSectionOnStack,
  type NavEntry,
  type NavTarget,
} from './nav/stack';
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
import { Agents } from './views/Agents';
import { Projects } from './views/Projects';
import { Ledgers } from './views/Ledgers';
import { Sentinel } from './views/panels/Sentinel';
import { Quartermaster } from './views/panels/Quartermaster';
import { FlightRecorder } from './views/panels/FlightRecorder';
import { Atlas } from './views/Atlas';
import { AtlasMiniOrb } from './components/AtlasMiniOrb';
import { Terminal } from './views/Terminal';
import { DeployOutcome } from './composer/DeployOutcome';
import { WorkspaceTabs } from './composer/WorkspaceTabs';
import {
  archiveComposerSession,
  createComposerSession,
  forkComposerSession,
  listComposerSessions,
  restoreComposerSession,
  type ComposerSession,
} from './composer/workspaceClient';
import { fetchHumanInbox } from './lib/approvalsClient';
import { useSse } from './lib/sseClient';
import { SessionProvider, useSession } from './lib/sessionContext';
import { readThemeChoice, persistThemeChoice, applyTheme, type ThemeChoice } from './lib/theme';

/** Live count of all human-attention items for the sidebar Inbox badge. Reuses the same SSE-tick
 *  pattern as {@link ApprovalsLive}, so decisions/questions/interventions appear without a reload.
 *  Cheap: one GET per SSE tick; on failure it silently keeps the last-known count. */
function useApprovalsCount(): number {
  const [count, setCount] = useState(0);
  const { count: tick } = useSse('/events');
  useEffect(() => {
    let alive = true;
    fetchHumanInbox()
      .then((inbox) => {
        if (alive) setCount(inbox.counts.total);
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
 * The app's ONE standing unlock affordance — a small top-bar chip. It reads the shared session context;
 * a click while locked runs the single passkey ceremony that unlocks every surface at once. Everything
 * else unlocks at POINT OF ACTION through the same context, so this is the only unlock button in the app.
 */
function SessionChip(): React.JSX.Element {
  const { session, locked, requireSession } = useSession();
  const [, retick] = useState(0);
  // Re-render on a coarse tick so the remaining-time readout stays honest while the tab sits open.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => retick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [session]);
  const minutes = session ? Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 60_000)) : 0;
  const label = locked ? 'Locked' : `Unlocked · expires in ${minutes}m`;
  return (
    <button
      type="button"
      className="mc-session-chip"
      data-testid="session-chip"
      disabled={!locked}
      title={locked
        ? 'Uses your device passkey. No private key leaves your device.'
        : 'This tab is unlocked until the session expires.'}
      onClick={() => {
        if (locked) void requireSession();
      }}
    >
      <span
        className={`mc-status-dot ${locked ? 'mc-status-dot--idle' : 'mc-status-dot--running'}`}
        aria-hidden="true"
      />
      <span className="mc-session-chip__label">{label}</span>
    </button>
  );
}

/**
 * The Stop floor — pinned to the bottom of the sidebar, hairline-separated, always visible. Session
 * state left this floor with the single-unlock consolidation: it now lives in the top-bar
 * {@link SessionChip}, and `StopControls` mints at point-of-action through the session context. In rail
 * mode the detail collapses to a single stop glyph.
 */
function SessionStopFloor(): React.JSX.Element {
  return (
    <div className="mc-sidebar__floor" data-testid="stop-floor">
      <span className="mc-sidebar__floor-rail" aria-hidden="true" title="Stop floor">
        ⏻
      </span>
      <StopControls />
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
  creatingWorkspace,
}: {
  active: DestinationId;
  onSelect: (id: DestinationId) => void;
  onCreate: () => void;
  rail: boolean;
  onToggleRail: () => void;
  approvalsCount: number;
  creatingWorkspace: boolean;
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
      <NewMenu onCreate={onCreate} disabled={creatingWorkspace} />
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
      <SessionStopFloor />
    </nav>
  );
}

/** Flatten the config once so the body switch can look up a destination's label/hint for the greyed
 *  placeholder without re-walking sections. */
const DEST_BY_ID: Record<string, NavDestination> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items).map((d) => [d.id, d]),
);

/** Placeholder body for a destination whose real view has not been built yet. Every current destination
 *  now maps to a real view (Atlas went live in Atlas V1, Terminal in D3.2); this case is kept only to
 *  keep the switch total against the DestinationId union. */
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
  composerSession,
  onComposerSessionChange,
  onRunningChange,
  onOpenRun,
  onBack,
}: {
  composerSession: ComposerSession;
  onComposerSessionChange: (session: ComposerSession) => void;
  onRunningChange: (running: boolean) => void;
  onOpenRun?: (runRef: string) => void;
  onBack?: () => void;
}): React.JSX.Element {
  const ideaText = composerSession.agent
    ? `Work with the declared agent at ${composerSession.agent.path} (source revision ${composerSession.agent.sourceHash}). First read that authoritative declaration, explain what it does and how it is configured to run, then help the operator plan work through the normal governed workflow. This Composer workspace is planning-only: do not invent a runner or claim a background queue runner has started unless the observed facts prove it.`
    : undefined;
  return (
    <DeployOutcome
      composerSession={composerSession}
      onComposerSessionChange={onComposerSessionChange}
      onRunningChange={onRunningChange}
      onOpenRun={onOpenRun}
      ideaText={ideaText}
      onBack={onBack}
    />
  );
}

/** The read-only layer panels, reachable from the single `sentinel` nav destination via an underline-tab
 *  bar (the Registry internal-tab pattern — one nav entry, three panels behind it). Sentinel (liveness) is
 *  the default tab. Each panel self-fetches its own read-only source. (Atlas was retired from this tab bar
 *  in Atlas V1 — it is now a top-level nav destination with its own full view + global mini-orb.) */
const LAYER_PANELS = [
  { id: 'sentinel', label: 'Sentinel', render: () => <Sentinel /> },
  { id: 'quartermaster', label: 'Quartermaster', render: () => <Quartermaster /> },
  { id: 'recorder', label: 'Flight Recorder', render: () => <FlightRecorder /> },
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
 *  greyed soon/future stubs fall through to the shared placeholder. Views that write take their bearer
 *  from the session context themselves; this switch only carries navigation. Home is the default rollup
 *  landing and hosts the governed Launch/Rerun surface (the [+ New ▾] → Task action navigates here), with
 *  `onNavigate` to jump from a rollup row/tile into its entity view. */
function ViewBody({
  view,
  onNavigate,
  taskSelectedId,
  entry,
  onPush,
  onBack,
  onSectionChange,
  onNavigateTarget,
  onWorkWithAgent,
}: {
  view: DestinationId;
  onNavigate: (id: DestinationId) => void;
  /** The card the Tasks view should open on mount (set by a card click-through elsewhere). */
  taskSelectedId?: string;
  /** The top nav-stack entry — carries the focused entity and the active detail section. */
  entry: NavEntry;
  onPush: (target: NavTarget) => void;
  onBack: () => void;
  onSectionChange: (id: string) => void;
  onNavigateTarget: (target: NavTarget) => void;
  onWorkWithAgent: (agent: { id: string }) => void;
}): React.JSX.Element {
  switch (view) {
    case 'home':
      return <Home onNavigate={onNavigate} />;
    case 'approvals':
      // Live unified Inbox feed (refreshed on SSE); decision verification remains an explicit POST.
      return <ApprovalsLive />;
    case 'activity':
      // Standalone full-view live feed (same replay the Home board embeds). Self-fetches.
      return (
        <section aria-label="Activity view">
          <Timeline />
        </section>
      );
    case 'atlas':
      // Atlas V1 — the desk voice worker mirror (big orb + live transcript + activity history + filed
      // cards). Reads the shared useAtlasState poller; renders its own aria-labelled section.
      return <Atlas />;
    case 'workflows':
      // The ONE surface for definitions and their executions: a workflow row pushes its detail, and a
      // run row pushes that RUN's detail — both within this destination, both on the nav stack. Runs
      // used to have two destinations of their own; they have none.
      return (
        <Workflows
          focusWorkflowId={entry.focus?.kind === 'workflow' ? entry.focus.id : null}
          focusRunRef={entry.focus?.kind === 'run' ? entry.focus.id : null}
          onOpenWorkflow={(ref) => onPush(focusTarget({ kind: 'workflow', id: ref }))}
          onOpenRun={(runRef) => onPush(focusTarget({ kind: 'run', id: runRef }))}
          onBack={onBack}
          onNavigate={onNavigateTarget}
        />
      );
    case 'agents':
      // arc-3: an agent row pushes that agent's detail onto the nav stack WITHIN this destination —
      // "a separate window, still inside the agents sidebar, with a back button". No new NAV_SECTIONS
      // entry and no new case here; the locked entity-first IA is untouched.
      return (
        <Agents
          focusAgentId={entry.focus?.kind === 'agent' ? entry.focus.id : null}
          onOpenAgent={(agentId) => onPush({ view: 'agents', focus: { kind: 'agent', id: agentId } })}
          onBack={onBack}
          activeSectionId={entry.section}
          onSectionChange={onSectionChange}
          onNavigate={onNavigateTarget}
          onWorkWithAgent={onWorkWithAgent}
        />
      );
    case 'tasks':
      return <Tasks initialSelectedId={taskSelectedId} />;
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
    case 'terminal':
      // The PTY pane is owned by App's persistent surface below, outside this replace-on-navigation switch.
      // This case is therefore intentionally empty: rendering it here as well would create duplicate shells.
      return <></>;
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

const OPEN_COMPOSER_REFS_KEY = 'kb-composer-open-refs-v1';

function readOpenComposerRefs(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_COMPOSER_REFS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function persistOpenComposerRefs(refs: string[]): void {
  try {
    window.localStorage.setItem(OPEN_COMPOSER_REFS_KEY, JSON.stringify(refs));
  } catch {
    // Browser storage is a convenience for tab restoration; server sessions remain authoritative.
  }
}

/** The app's single session boundary: everything below `SessionProvider` shares one bearer and one
 *  passkey ceremony (see `lib/sessionContext.tsx`). */
export function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  );
}

function AppShell(): React.JSX.Element {
  // arc-3 — navigation is a STACK, not a single destination. `goTo` (a sidebar click) resets it to a
  // fresh root so the mental model is unchanged; `push` drills into an entity detail and reveals a back
  // affordance. Every existing read site still just reads `view`. See src/nav/stack.ts for why this is
  // ~40 lines of stack rather than a router dependency.
  const [stack, setStack] = useState<NavEntry[]>(() => rootStack(DEFAULT_DESTINATION));
  const current = stack[stack.length - 1];
  const view = current.view;
  const [rail, setRail] = useState(false);
  const { session, requireSession } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The [+ New ▾] menu opens the Composer surface over the current view; `composerKind` pre-seeds its
  // type chip (`idea` for the idea-first entry, a concrete kind for the entity pickers).
  const [composerSessions, setComposerSessions] = useState<Record<string, ComposerSession>>({});
  const [openComposerRefs, setOpenComposerRefs] = useState<string[]>(readOpenComposerRefs);
  const [activeComposerRef, setActiveComposerRef] = useState<string | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [runningComposerRefs, setRunningComposerRefs] = useState<Set<string>>(() => new Set());
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice());
  // Card id a card click-through (a run's card graph, a step's canonical card) wants opened in Tasks.
  const [openCardId, setOpenCardId] = useState<string | undefined>(undefined);
  const approvalsCount = useApprovalsCount();
  // Unlike ordinary destination bodies, Terminal is a long-lived workspace: navigating away hides it but
  // must not unmount its xterm instances or close their WebSockets. Composer behaves like another overlay.
  const terminalVisible = view === 'terminal' && activeComposerRef === null;

  useEffect(() => persistOpenComposerRefs(openComposerRefs), [openComposerRefs]);

  useEffect(() => {
    if (!session?.token) return;
    let alive = true;
    listComposerSessions(session.token)
      .then((sessions) => {
        if (!alive) return;
        setComposerSessions(Object.fromEntries(sessions.map((item) => [item.composerRef, item])));
        setOpenComposerRefs((current) => current.filter((ref) => sessions.some((item) => item.composerRef === ref && item.state === 'open')));
      })
      .catch((error: unknown) => {
        if (alive) setWorkspaceError(error instanceof Error ? error.message : 'Could not load Composer workspaces.');
      });
    return () => { alive = false; };
  }, [session?.token]);

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

  // Navigate to a destination, closing the transient Composer placeholder if it was open. A sidebar
  // click RESETS the stack: a fresh root, no back arrow, no accumulated history.
  const goTo = (id: DestinationId): void => {
    setActiveComposerRef(null);
    setStack(goToStack(id));
  };

  /** Drill into an entity detail within its own destination. Back becomes available. */
  const push = (target: NavTarget): void => {
    setActiveComposerRef(null);
    setStack((s) => pushStack(s, target));
  };

  /** Pop one entry. A no-op at the root, where the affordance is not rendered. */
  const back = (): void => setStack((s) => backStack(s));

  /** Record the operator's active detail tab into the top entry so back-then-forward restores it. */
  const setSection = (section: string): void => setStack((s) => setSectionOnStack(s, section));

  /**
   * Cross-entity navigation. A `card` focus keeps using the pre-existing Tasks detail-pane payload
   * path rather than opening a second one.
   */
  const navigateTo = (target: NavTarget): void => {
    if (target.focus?.kind === 'card') {
      setOpenCardId(target.focus.id);
      push({ view: 'tasks' });
      return;
    }
    push(target);
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

  // [+ New ▾] routing (C5): "Idea…" opens the Composer surface in idea mode; the "Workflow"/"Skill"/
  // "Project"/"Agent" entity pickers open the SAME surface pre-seeded to that type; "Task" keeps its
  // quick-launch route to the governed launch surface (Home). "Agent" opens Composer's declaration form.
  const upsertComposerSession = (next: ComposerSession): void => {
    setComposerSessions((current) => ({ ...current, [next.composerRef]: next }));
  };

  const withWorkspaceToken = async (action: (token: string) => Promise<void>): Promise<void> => {
    if (workspaceBusy) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const unlocked = await requireSession();
      if (!unlocked) throw new Error('Composer needs this tab unlocked.');
      await action(unlocked.token);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Composer request failed.');
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleCreate = (): void => {
    void withWorkspaceToken(async (token) => {
      const created = await createComposerSession(token);
      upsertComposerSession(created);
      setOpenComposerRefs((current) => [...current.filter((ref) => ref !== created.composerRef), created.composerRef]);
      setActiveComposerRef(created.composerRef);
    });
  };

  /** Open a normal persistent Composer workspace, scoped to a declared agent's authoritative file. */
  const workWithAgent = (agent: { id: string }): void => {
    void withWorkspaceToken(async (token) => {
      const created = await createComposerSession(token, { title: `Agent · ${agent.id}`, agentId: agent.id });
      upsertComposerSession(created);
      setOpenComposerRefs((current) => [...current.filter((ref) => ref !== created.composerRef), created.composerRef]);
      setActiveComposerRef(created.composerRef);
    });
  };

  const closeComposerTab = (composerRef: string): void => {
    if (runningComposerRefs.has(composerRef)) return;
    setOpenComposerRefs((current) => {
      const next = current.filter((ref) => ref !== composerRef);
      setActiveComposerRef((active) => active === composerRef ? next.at(-1) ?? null : active);
      return next;
    });
  };

  const setComposerRunning = (composerRef: string, running: boolean): void => {
    setRunningComposerRefs((current) => {
      const next = new Set(current);
      if (running) next.add(composerRef);
      else next.delete(composerRef);
      return next;
    });
  };

  const archiveComposer = (composerRef: string): void => {
    void withWorkspaceToken(async (token) => {
      upsertComposerSession(await archiveComposerSession(composerRef, token));
      closeComposerTab(composerRef);
    });
  };

  const forkComposer = (composerRef: string): void => {
    void withWorkspaceToken(async (token) => {
      const forked = await forkComposerSession(composerRef, token);
      upsertComposerSession(forked);
      setOpenComposerRefs((current) => [...current.filter((ref) => ref !== forked.composerRef), forked.composerRef]);
      setActiveComposerRef(forked.composerRef);
    });
  };

  const restoreComposer = (composerRef: string): void => {
    void withWorkspaceToken(async (token) => {
      const restored = await restoreComposerSession(composerRef, token);
      upsertComposerSession(restored);
      setOpenComposerRefs((current) => [...current.filter((ref) => ref !== composerRef), composerRef]);
      setActiveComposerRef(composerRef);
    });
  };

  const reopenComposer = (composerRef: string): void => {
    setOpenComposerRefs((current) => [...current.filter((ref) => ref !== composerRef), composerRef]);
    setActiveComposerRef(composerRef);
  };

  const openWorkspaces = openComposerRefs
    .map((ref) => composerSessions[ref])
    .filter((item): item is ComposerSession => Boolean(item && item.state === 'open'));
  const archivedWorkspaces = Object.values(composerSessions).filter((item) => item.state === 'archived');
  const recentWorkspaces = Object.values(composerSessions).filter(
    (item) => item.state === 'open' && !openComposerRefs.includes(item.composerRef),
  );

  return (
    <div className={`app-shell${rail ? ' app-shell--rail' : ''}`}>
      <Sidebar
        active={view}
        onSelect={goTo}
        onCreate={handleCreate}
        rail={rail}
        onToggleRail={() => setRail((r) => !r)}
        approvalsCount={approvalsCount}
        creatingWorkspace={workspaceBusy}
      />
      <header className="mc-topbar">
        <h1 className="mc-topbar__title">kb mission control</h1>
        <span className="mc-topbar__glance">
          <span className="mc-status-dot mc-status-dot--running" aria-hidden="true" />
          local agent operations
        </span>
        <SessionChip />
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
      <main className={terminalVisible ? 'mc-main mc-main--terminal' : 'mc-main'}>
        <WorkspaceTabs
          open={openWorkspaces}
          recent={recentWorkspaces}
          archived={archivedWorkspaces}
          activeRef={activeComposerRef}
          runningRefs={runningComposerRefs}
          busy={workspaceBusy}
          onNew={handleCreate}
          onSelect={setActiveComposerRef}
          onClose={closeComposerTab}
          onReopen={reopenComposer}
          onArchive={archiveComposer}
          onFork={forkComposer}
          onRestore={restoreComposer}
        />
        {workspaceError ? <p className="composer-workspace-error" role="alert">{workspaceError}</p> : null}
        <div
          className="persistent-terminal-surface"
          hidden={!terminalVisible}
          aria-hidden={!terminalVisible}
          data-testid="persistent-terminal-surface"
        >
          <Terminal visible={terminalVisible} />
        </div>
        {openWorkspaces.map((workspace) => (
          <div
            key={workspace.composerRef}
            hidden={activeComposerRef !== workspace.composerRef}
            aria-hidden={activeComposerRef !== workspace.composerRef}
            data-testid={`composer-workspace-${workspace.composerRef}`}
          >
            <ComposerView
              composerSession={workspace}
              onComposerSessionChange={upsertComposerSession}
              onRunningChange={(running) => setComposerRunning(workspace.composerRef, running)}
              onOpenRun={(runRef) => push(focusTarget({ kind: 'run', id: runRef }))}
              onBack={workspace.agent ? () => setActiveComposerRef(null) : undefined}
            />
          </div>
        ))}
        {activeComposerRef === null && view !== 'terminal' ? (
          <ViewBody
            view={view}
            onNavigate={goTo}
            taskSelectedId={openCardId}
            entry={current}
            onPush={push}
            onBack={back}
            onSectionChange={setSection}
            onNavigateTarget={navigateTo}
            onWorkWithAgent={workWithAgent}
          />
        ) : null}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={handlePaletteRun}
      />
      {/* Atlas V1 — the global mini-orb renders over EVERY view except the Atlas view itself (no double
       *  orb). It hides itself while the worker is ASLEEP/OFFLINE; a click jumps to the Atlas view. */}
      {view !== 'atlas' ? <AtlasMiniOrb onOpen={() => goTo('atlas')} /> : null}
    </div>
  );
}

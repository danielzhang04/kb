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
import { Fragment, useEffect, useState } from 'react';
import {
  NAV_SECTIONS,
  DEFAULT_DESTINATION,
  isLive,
  type DestinationId,
  type NavDestination,
} from './nav/config';
import { NewMenu } from './nav/NewMenu';
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
import { fetchPending } from './lib/approvalsClient';
import { useSse } from './lib/sseClient';
import { signIn, type Session } from './lib/authClient';

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

function NavItem({
  item,
  active,
  badge,
  onSelect,
}: {
  item: NavDestination;
  active: DestinationId;
  badge?: number;
  onSelect: (id: DestinationId) => void;
}): React.JSX.Element {
  const disabled = !isLive(item);
  return (
    <li>
      <button
        type="button"
        className={`mc-nav-item${active === item.id ? ' mc-nav-item--active' : ''}${
          disabled ? ' mc-nav-item--disabled' : ''
        }`}
        // Rail-mode hover tooltip (VS Code activity-bar / Linear pattern).
        title={item.hint ? `${item.label} · ${item.hint}` : item.label}
        aria-current={active === item.id ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onSelect(item.id)}
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
    </li>
  );
}

/**
 * The Session/Stop floor — pinned to the bottom of the sidebar, hairline-separated, always visible. It
 * surfaces the real WebAuthn session state (a passkey login mints a short-TTL bearer via
 * `authClient.signIn`) and the relocated {@link StopControls} (scoped stop + nuclear STOP). Signed out,
 * a "Sign in" button runs the ceremony; fail-closed pre-passkey, the server refuses and the floor stays
 * signed out. In rail mode the detail collapses to a single stop glyph.
 */
function SessionStopFloor({
  session,
  onSignIn,
}: {
  session: Session | null;
  onSignIn: () => void;
}): React.JSX.Element {
  const signedIn = session !== null;
  return (
    <div className="mc-sidebar__floor" data-testid="stop-floor">
      <div className="mc-session" data-testid="session-state" title="WebAuthn session">
        <span
          className={`mc-status-dot ${signedIn ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`}
          aria-hidden="true"
        />
        <span className="mc-session__label">{signedIn ? 'Signed in' : 'Signed out'}</span>
        {signedIn ? null : (
          <button type="button" className="mc-session__signin" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </div>
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
  session,
  onSignIn,
}: {
  active: DestinationId;
  onSelect: (id: DestinationId) => void;
  onCreate: (id: 'task' | 'workflow' | 'skill' | 'project' | 'agent') => void;
  rail: boolean;
  onToggleRail: () => void;
  approvalsCount: number;
  session: Session | null;
  onSignIn: () => void;
}): React.JSX.Element {
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
                />
              ))}
            </ul>
          </Fragment>
        ))}
      </div>
      <SessionStopFloor session={session} onSignIn={onSignIn} />
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

/** Route a destination to its view. A destination with a dedicated view gets one case here; only the
 *  greyed soon/future stubs fall through to the shared placeholder. Home is the default rollup landing
 *  and hosts the governed Launch/Rerun surface, so it receives the session token (the [+ New ▾] → Task
 *  action navigates here) and `onNavigate` to jump from a rollup row/tile into its entity view. */
function ViewBody({
  view,
  sessionToken,
  onNavigate,
}: {
  view: DestinationId;
  sessionToken?: string;
  onNavigate: (id: DestinationId) => void;
}): React.JSX.Element {
  switch (view) {
    case 'home':
      return <Home sessionToken={sessionToken} onNavigate={onNavigate} />;
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
      return <Agents />;
    case 'tasks':
      return <Tasks />;
    case 'projects':
      return (
        <section aria-label="Projects view">
          <Projects />
        </section>
      );
    case 'ledgers':
      return <Ledgers />;
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
  const approvalsCount = useApprovalsCount();

  const handleSignIn = (): void => {
    // WebAuthn login -> short-TTL bearer. Fail-closed: a refused ceremony (no passkey) leaves the floor
    // signed out; the error is intentionally not surfaced as a blocking modal in v0.
    void signIn()
      .then((s) => setSession(s))
      .catch(() => setSession(null));
  };

  // [+ New ▾] → Task navigates to Home, which hosts the governed Launch/Rerun surface. The other
  // entries are disabled in the menu, so only 'task' reaches here.
  const handleCreate = (id: 'task' | 'workflow' | 'skill' | 'project' | 'agent'): void => {
    if (id === 'task') setView('home');
  };

  return (
    <div className={`app-shell${rail ? ' app-shell--rail' : ''}`}>
      <Sidebar
        active={view}
        onSelect={setView}
        onCreate={handleCreate}
        rail={rail}
        onToggleRail={() => setRail((r) => !r)}
        approvalsCount={approvalsCount}
        session={session}
        onSignIn={handleSignIn}
      />
      <header className="mc-topbar">
        <h1 className="mc-topbar__title">kb mission control</h1>
        <span className="mc-topbar__glance">
          <span className="mc-status-dot mc-status-dot--running" aria-hidden="true" />
          v0 · read-only observatory
        </span>
      </header>
      <main className="mc-main">
        <ViewBody view={view} sessionToken={session?.token} onNavigate={setView} />
      </main>
    </div>
  );
}

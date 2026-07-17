/**
 * SPA shell (U1 foundation). Desktop-first "Mission Control" shell: a fixed left sidebar owns
 * primary navigation, a slim topbar carries the app title and a fleet-status glance, and the main
 * region renders whichever view is active. A pinned-bottom Session/Stop floor lives in the sidebar
 * so the WebAuthn session state and the fleet-stop controls are always reachable — never hunted for.
 *
 * Navigation is a hand-rolled `useState` switch rather than a router dependency — the v0/v1 surface
 * is a fixed, known set of top-level views (no URL/nested routing is needed until D3 adds real
 * sub-routes), so a `react-router` dep is not warranted here.
 *
 * The nav is GROUPED and collapsible, driven entirely by `NAV_SECTIONS` in `src/nav/config.ts`. A
 * new layer/agent/workflow is ONE entry in that config; a `live` destination also gets one `case`
 * in the body switch below. Sections collapse independently; the whole sidebar collapses to a 48px
 * icon rail (icons keep a hover tooltip via the native title attribute). Destinations flagged
 * `soon`/`future` render greyed + disabled — the eventual destination is visible without pretending
 * the feature exists.
 */
import { useState } from 'react';
import {
  NAV_SECTIONS,
  DEFAULT_DESTINATION,
  isLive,
  type DestinationId,
  type NavDestination,
  type NavSection,
} from './nav/config';
import { Control, StopControls } from './views/Control';
import { Approvals } from './views/Approvals';
import { Registry } from './views/Registry';
import { Browser } from './views/Browser';
import { Timeline } from './views/Timeline';
import { Editor } from './views/Editor';
import { Vibe } from './views/Vibe';

function NavSectionGroup({
  section,
  active,
  expanded,
  rail,
  onToggle,
  onSelect,
}: {
  section: NavSection;
  active: DestinationId;
  expanded: boolean;
  rail: boolean;
  onToggle: () => void;
  onSelect: (id: DestinationId) => void;
}): React.JSX.Element {
  return (
    <div className="mc-nav-section">
      <button
        type="button"
        className="mc-nav-section__header"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span
          className={`mc-nav-section__caret${expanded ? '' : ' mc-nav-section__caret--collapsed'}`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="mc-nav-section__label">{section.label}</span>
      </button>
      {/* Rail mode keeps items in the DOM (labels hidden via CSS) so every destination stays
       *  reachable; a collapsed section still hides its items. */}
      {expanded || rail ? (
        <ul className="mc-nav-section__items">
          {section.items.map((item) => {
            const disabled = !isLive(item);
            return (
              <li key={item.id}>
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
                  {item.hint ? <span className="mc-nav-item__hint">{item.hint}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The Session/Stop floor — pinned to the bottom of the sidebar, hairline-separated, always visible.
 * It surfaces the WebAuthn session state (placeholder until U2 wires real session minting) and the
 * relocated {@link StopControls} (scoped stop + nuclear STOP). Mounted WITHOUT a session token for
 * now, so every control degrades to its disabled/signed-out state — the write path is server-gated
 * regardless. In rail mode the detail collapses to a single stop glyph.
 */
function SessionStopFloor(): React.JSX.Element {
  return (
    <div className="mc-sidebar__floor" data-testid="stop-floor">
      <div className="mc-session" data-testid="session-state" title="WebAuthn session">
        <span className="mc-status-dot mc-status-dot--idle" aria-hidden="true" />
        <span className="mc-session__label">Signed out</span>
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
  rail,
  onToggleRail,
}: {
  active: DestinationId;
  onSelect: (id: DestinationId) => void;
  rail: boolean;
  onToggleRail: () => void;
}): React.JSX.Element {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

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
      <div className="mc-nav">
        {NAV_SECTIONS.map((section) => (
          <NavSectionGroup
            key={section.id}
            section={section}
            active={active}
            expanded={!collapsedSections[section.id]}
            rail={rail}
            onToggle={() =>
              setCollapsedSections((prev) => ({ ...prev, [section.id]: !prev[section.id] }))
            }
            onSelect={onSelect}
          />
        ))}
      </div>
      <SessionStopFloor />
    </nav>
  );
}

/** Flatten the config once so the body switch can look up a destination's label/hint for the
 *  greyed placeholder without re-walking sections. */
const DEST_BY_ID: Record<string, NavDestination> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items).map((d) => [d.id, d]),
);

/** Placeholder body for a not-yet-built destination (soon/future). Unreachable in practice — its
 *  nav item is disabled — but keeps the body switch total and self-documenting. */
function ComingSoon({ id }: { id: DestinationId }): React.JSX.Element {
  const dest = DEST_BY_ID[id];
  const hint = dest?.hint;
  return (
    <section className="code-view" aria-label={`${dest?.label ?? id} view`}>
      <h2>{dest?.label ?? id}</h2>
      <p>
        Arrives{' '}
        {hint === 'D3' || hint === 'D3/v2'
          ? 'in D3 behind its WebAuthn + threat-review gate'
          : 'in a later wave'}
        . Nothing to view or steer here yet.
      </p>
    </section>
  );
}

/** Route a live destination to its view. New live destination = one more case here (data only for
 *  everything else). Editor/Vibe mount read-only-safe: no session token is wired yet (U2), so their
 *  governed actions stay disabled and they degrade gracefully. */
function ViewBody({ view }: { view: DestinationId }): React.JSX.Element {
  switch (view) {
    case 'board':
      return <Control />;
    case 'approvals':
      // U1 foundation: mounts Approvals with no pending cards yet — real `/api/index`-sourced
      // wiring is the Approvals view pass.
      return <Approvals pending={[]} />;
    case 'timeline':
      // Standalone full-view Timeline (same live feed the Board embeds). Self-fetches its replay.
      return (
        <section aria-label="Timeline view">
          <Timeline />
        </section>
      );
    case 'editor':
      // Read-only-safe mount: no file selected / no session yet (wired in U2).
      return <Editor relpath="" />;
    case 'vibe':
      return <Vibe />;
    case 'registry':
      return <Registry />;
    case 'browser':
      return (
        <section aria-label="KB browser view">
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

  return (
    <div className={`app-shell${rail ? ' app-shell--rail' : ''}`}>
      <Sidebar active={view} onSelect={setView} rail={rail} onToggleRail={() => setRail((r) => !r)} />
      <header className="mc-topbar">
        <h1 className="mc-topbar__title">kb mission control</h1>
        <span className="mc-topbar__glance">
          <span className="mc-status-dot mc-status-dot--running" aria-hidden="true" />
          v0 · read-only observatory
        </span>
      </header>
      <main className="mc-main">
        <ViewBody view={view} />
      </main>
    </div>
  );
}

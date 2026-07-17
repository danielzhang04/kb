/**
 * SPA shell (D1 foundation). Desktop-first "Mission Control" shell: a fixed left sidebar owns
 * primary navigation, a slim topbar carries the app title and a fleet-status glance, and the main
 * region renders whichever view is active.
 *
 * Navigation is a hand-rolled `useState` switch rather than a router dependency — the v0/v1 surface
 * is a fixed, known set of top-level views (no URL/nested routing is needed until D2/D3 add real
 * sub-routes), so a `react-router` dep is not warranted here.
 *
 * The nav is GROUPED and collapsible (`NAV_SECTIONS` below) rather than a flat list, because this
 * is meant to scale: more layers (Atlas/"jarvis", Sentinel), more agents, more workflows/skills, and
 * a growing knowledge base all land as ONE more entry in this config, never a markup rewrite. Each
 * section can collapse independently; the whole sidebar can also collapse to an icon-only rail.
 * Items not yet built (no dedicated view file exists) are listed as disabled placeholders so the
 * eventual destination is visible without pretending the feature exists — same pattern as the D0.9
 * Code-view stub.
 */
import { useState } from 'react';
import { Control } from './views/Control';
import { CodeView } from './views/CodeView';
import { Approvals } from './views/Approvals';
import { Registry } from './views/Registry';
import { Browser } from './views/Browser';

type ViewId =
  | 'board'
  | 'approvals'
  | 'terminal'
  | 'code'
  | 'skills'
  | 'workflows'
  | 'kb'
  | 'atlas'
  | 'registry'
  | 'agents'
  | 'ledgers';

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  disabled?: boolean;
  hint?: string;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * The nav config. Adding a section or item is a one-line change here — nothing in Sidebar's markup
 * needs to change. Grouping mirrors how the fleet actually grows: OPERATE (day-to-day steering),
 * BUILD (code/skills/workflow authoring), KNOWLEDGE (the KB + future Atlas layer), SYSTEM (registries
 * and future fleet/ledger introspection).
 */
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { id: 'board', label: 'Board', icon: '◧' },
      { id: 'approvals', label: 'Approvals', icon: '✓' },
      { id: 'terminal', label: 'Terminal', icon: '_', disabled: true, hint: 'D3' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      { id: 'code', label: 'Code', icon: '</>' },
      { id: 'skills', label: 'Skills', icon: '✺', disabled: true, hint: 'soon' },
      { id: 'workflows', label: 'Workflows', icon: '⇄', disabled: true, hint: 'soon' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    items: [
      { id: 'kb', label: 'KB Browser', icon: '▤' },
      { id: 'atlas', label: 'Atlas', icon: '✦', disabled: true, hint: 'soon' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'registry', label: 'Registry', icon: '≡' },
      { id: 'agents', label: 'Agents', icon: '◎', disabled: true, hint: 'soon' },
      { id: 'ledgers', label: 'Ledgers', icon: '▦', disabled: true, hint: 'soon' },
    ],
  },
];

function NavSectionGroup({
  section,
  active,
  expanded,
  onToggle,
  onSelect,
}: {
  section: NavSection;
  active: ViewId;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (id: ViewId) => void;
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
      {expanded ? (
        <ul className="mc-nav-section__items">
          {section.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`mc-nav-item${active === item.id ? ' mc-nav-item--active' : ''}${
                  item.disabled ? ' mc-nav-item--disabled' : ''
                }`}
                aria-current={active === item.id ? 'page' : undefined}
                disabled={item.disabled}
                onClick={() => onSelect(item.id)}
              >
                <span className="mc-nav-item__icon mc-mono" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="mc-nav-item__label">{item.label}</span>
                {item.hint ? <span className="mc-nav-item__hint">{item.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Sidebar({
  active,
  onSelect,
  rail,
  onToggleRail,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
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
            onToggle={() =>
              setCollapsedSections((prev) => ({ ...prev, [section.id]: !prev[section.id] }))
            }
            onSelect={onSelect}
          />
        ))}
      </div>
    </nav>
  );
}

/** Shared placeholder for nav items whose view doesn't exist yet — always unreachable (their nav
 *  item is `disabled`), kept only so the switch below stays exhaustive and self-documenting. */
function ComingSoon({ label, hint }: { label: string; hint?: string }): React.JSX.Element {
  return (
    <section className="code-view" aria-label={`${label} view`}>
      <h2>{label}</h2>
      <p>
        Arrives {hint === 'D3' ? 'in D3 behind its WebAuthn + threat-review gate' : 'in a later wave'}.
        Nothing to view or steer here yet.
      </p>
    </section>
  );
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('board');
  const [rail, setRail] = useState(false);

  let body: React.JSX.Element;
  switch (view) {
    case 'board':
      body = <Control />;
      break;
    case 'approvals':
      // D1 foundation: mounts the existing Approvals component with no pending cards yet — real
      // `/api/index`-sourced wiring is the later batch that owns the Approvals view.
      body = <Approvals pending={[]} />;
      break;
    case 'code':
      body = <CodeView />;
      break;
    case 'kb':
      body = (
        <section aria-label="KB browser view">
          <Browser />
        </section>
      );
      break;
    case 'registry':
      body = <Registry />;
      break;
    case 'terminal':
      body = <ComingSoon label="Terminal" hint="D3" />;
      break;
    case 'skills':
      body = <ComingSoon label="Skills" />;
      break;
    case 'workflows':
      body = <ComingSoon label="Workflows" />;
      break;
    case 'atlas':
      body = <ComingSoon label="Atlas" />;
      break;
    case 'agents':
      body = <ComingSoon label="Agents" />;
      break;
    case 'ledgers':
      body = <ComingSoon label="Ledgers" />;
      break;
  }

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
      <main className="mc-main">{body}</main>
    </div>
  );
}

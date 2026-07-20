import type { ComposerSession } from './workspaceClient';

export function WorkspaceTabs({
  open,
  recent,
  archived,
  activeRef,
  runningRefs,
  busy,
  onNew,
  onSelect,
  onClose,
  onReopen,
  onArchive,
  onFork,
  onRestore,
}: {
  open: ComposerSession[];
  recent: ComposerSession[];
  archived: ComposerSession[];
  activeRef: string | null;
  runningRefs: ReadonlySet<string>;
  busy: boolean;
  onNew: () => void | Promise<void>;
  onSelect: (composerRef: string) => void;
  onClose: (composerRef: string) => void;
  onReopen: (composerRef: string) => void;
  onArchive: (composerRef: string) => void | Promise<void>;
  onFork: (composerRef: string) => void | Promise<void>;
  onRestore: (composerRef: string) => void | Promise<void>;
}): React.JSX.Element | null {
  if (open.length === 0 && recent.length === 0 && archived.length === 0) return null;
  const active = open.find((session) => session.composerRef === activeRef);
  return (
    <div className="composer-tabs" aria-label="Composer workspaces">
      <div className="composer-tabs__list" role="tablist" aria-label="Open Composer workspaces">
        {open.map((session) => (
          <div key={session.composerRef} className={`composer-tabs__tab${session.composerRef === activeRef ? ' composer-tabs__tab--active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={session.composerRef === activeRef}
              className="composer-tabs__label"
              onClick={() => onSelect(session.composerRef)}
            >
              <span className={`mc-status-dot ${runningRefs.has(session.composerRef) || session.turns.some((turn) => turn.state === 'running') ? 'mc-status-dot--running' : 'mc-status-dot--idle'}`} aria-hidden="true" />
              {session.title}
            </button>
            <button
              type="button"
              className="composer-tabs__close"
              aria-label={runningRefs.has(session.composerRef) ? `Stop turn before closing ${session.title}` : `Close ${session.title}`}
              disabled={runningRefs.has(session.composerRef)}
              title={runningRefs.has(session.composerRef) ? 'Stop the active turn before closing this tab' : 'Close tab'}
              onClick={() => onClose(session.composerRef)}
            >×</button>
          </div>
        ))}
      </div>
      <button type="button" className="composer-tabs__new" onClick={() => void onNew()} disabled={busy}>+ New</button>
      {active ? (
        <div className="composer-tabs__actions">
          <button type="button" onClick={() => void onFork(active.composerRef)} disabled={busy}>Fork</button>
          <button type="button" onClick={() => void onArchive(active.composerRef)} disabled={busy}>Archive</button>
        </div>
      ) : null}
      {recent.length > 0 ? (
        <details className="composer-tabs__archived">
          <summary>Recent ({recent.length})</summary>
          <div className="composer-tabs__archive-menu">
            {recent.map((session) => (
              <button key={session.composerRef} type="button" onClick={() => onReopen(session.composerRef)} disabled={busy}>
                Reopen {session.title}
              </button>
            ))}
          </div>
        </details>
      ) : null}
      {archived.length > 0 ? (
        <details className="composer-tabs__archived">
          <summary>Archived ({archived.length})</summary>
          <div className="composer-tabs__archive-menu">
            {archived.map((session) => (
              <button key={session.composerRef} type="button" onClick={() => void onRestore(session.composerRef)} disabled={busy}>
                Reopen {session.title}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

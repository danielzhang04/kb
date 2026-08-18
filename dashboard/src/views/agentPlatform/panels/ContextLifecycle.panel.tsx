/**
 * Context Lifecycle panel (Agent Platform, Wave-1 U8).
 *
 * ── What it is ──
 * The visible half of the INERT context-lifecycle hook family. Three hooks (SessionStart, PreCompact,
 * PostToolUse) would keep one markdown store per session — a north star, the invariants, the current
 * gate, a deterministic summary of the turns a compaction was about to discard, and a redacted ring
 * buffer of recent tool calls. This panel is where an operator reads those stores.
 *
 * ── Inert on purpose, and the panel says so ──
 * Nothing in `.claude/settings*.json` registers these hooks, so on a machine that has never armed
 * them the store directory does not exist and this panel is EMPTY. That empty state is the expected
 * reading, not a failed fetch, so it is spelled out on screen — the arming snippet lives in
 * `docs/proposals/context-lifecycle-hooks.md`.
 *
 * ── The U7 seam, made visible ──
 * `## North star` and `## Invariants` are spelled byte-identically to the two sections
 * `scripts/hooks/regrounding_hook.js` extracts, so pointing that hook's `KB_GOAL_STATE_PATH` at a
 * store file re-grounds a session with zero edits to U7. The "What re-grounding injects" sub-block
 * below renders exactly those two sections and nothing else — it is U7's only UI surface, and showing
 * more of the store there would misrepresent what the re-grounding hook actually injects.
 *
 * ── Where the data comes from ──
 * `/api/context-lifecycle` (the stores that exist) and `/api/context-lifecycle/:sessionId` (one store,
 * parsed). Both are read-only server projections; the browser never reads a file, and no route here
 * can arm, disarm, or edit anything.
 *
 * House rules honoured: ONE entry file, its OWN stylesheet, `import type` only across the
 * client→server boundary, and zero edits to any shared file.
 */
import { useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { ContextSection, ContextSessionSummary } from '../../../../server/contextLifecycle/routes';
import { useReadPanel } from '../../../lib/useReadPanel';
import '../../../styles/views/agentPlatformContextLifecycle.css';

/** The two sections the re-grounding hook lifts, in its emission order. */
const REGROUNDING_HEADINGS = ['North star', 'Invariants'] as const;

interface ListResponse {
  available: boolean;
  storeRoot: string;
  sessions: ContextSessionSummary[];
}

interface StoreResponse {
  sessionId: string;
  modifiedAt: string;
  sections: ContextSection[];
}

function shortTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}

/** One `## heading` + body block, rendered as preformatted text — stores are markdown, not HTML. */
function Section({ section }: { section: ContextSection }): React.JSX.Element {
  return (
    <div className="ap-ctxlife__section" data-testid={`ap-ctxlife-section-${section.heading}`}>
      <h5 className="ap-ctxlife__section-title">{section.heading}</h5>
      <pre className="ap-ctxlife__body">{section.body}</pre>
    </div>
  );
}

/**
 * The U7 seam block. Deliberately renders ONLY the two sections the re-grounding hook extracts, and
 * says out loud when a store has neither — a store written purely by the activity tracker has no
 * north star in it, and an empty block here would otherwise read as a broken panel.
 */
function RegroundingPreview({ sections }: { sections: ContextSection[] }): React.JSX.Element {
  const injected = REGROUNDING_HEADINGS.map((heading) =>
    sections.find((s) => s.heading === heading),
  ).filter((s): s is ContextSection => Boolean(s && s.body.trim()));

  return (
    <section className="ap-ctxlife__seam" data-testid="ap-ctxlife-seam">
      <h5 className="ap-ctxlife__seam-title">What re-grounding injects</h5>
      <p className="ap-ctxlife__note">
        These are the only sections <code>scripts/hooks/regrounding_hook.js</code> lifts out of a
        store. Point its <code>KB_GOAL_STATE_PATH</code> at this file and a drifting session gets
        exactly this back — behind the stale-replay guard, with no edit to that hook.
      </p>
      {injected.length === 0 ? (
        <p className="ap-ctxlife__status" data-testid="ap-ctxlife-seam-empty">
          This store has no <code>North star</code> or <code>Invariants</code> section, so re-grounding
          would inject nothing from it.
        </p>
      ) : (
        injected.map((section) => <Section key={section.heading} section={section} />)
      )}
    </section>
  );
}

function ContextLifecycleBody(): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  // Two reads through the shared hook. A dead daemon is an expected input for a read-only panel: it
  // names the state, never crashes, and never invents context. With no store open the second url is
  // null, so nothing is requested and its state is `idle` rather than a spinner over an empty pane.
  const { data: list, state: listState } = useReadPanel<ListResponse>('/api/context-lifecycle');
  const { data: store, state: storeState } = useReadPanel<StoreResponse>(
    openId ? `/api/context-lifecycle/${encodeURIComponent(openId)}` : null,
  );

  if (listState === 'loading' || listState === 'idle') {
    return (
      <div className="ap-ctxlife">
        <p className="ap-ctxlife__status" data-testid="ap-ctxlife-loading">
          Reading the session stores…
        </p>
      </div>
    );
  }

  if (listState === 'unavailable') {
    return (
      <div className="ap-ctxlife">
        <p className="ap-ctxlife__status ap-ctxlife__status--error" data-testid="ap-ctxlife-unavailable">
          The session stores could not be listed. This panel reads{' '}
          <code>/api/context-lifecycle</code> and shows nothing rather than invented context.
        </p>
      </div>
    );
  }

  const sessions = list?.sessions ?? [];

  if (openId && store && storeState === 'ready') {
    return (
      <div className="ap-ctxlife">
        <button
          type="button"
          className="ap-ctxlife__back"
          data-testid="ap-ctxlife-back"
          onClick={() => setOpenId(null)}
        >
          <span aria-hidden="true">←</span> All sessions
        </button>
        <div className="ap-ctxlife__head">
          <h4 className="ap-ctxlife__title">{store.sessionId}</h4>
          <span className="ap-ctxlife__meta">last written {shortTime(store.modifiedAt)}</span>
        </div>
        <RegroundingPreview sections={store.sections} />
        <section className="ap-ctxlife__full" data-testid="ap-ctxlife-full">
          <h5 className="ap-ctxlife__seam-title">Whole store</h5>
          {store.sections.length === 0 ? (
            <p className="ap-ctxlife__status" data-testid="ap-ctxlife-store-empty">
              This store file has no sections.
            </p>
          ) : (
            store.sections.map((section) => <Section key={section.heading} section={section} />)
          )}
        </section>
      </div>
    );
  }

  if (openId && storeState === 'loading') {
    return (
      <div className="ap-ctxlife">
        <p className="ap-ctxlife__status" data-testid="ap-ctxlife-store-loading">
          Reading the store for {openId}…
        </p>
      </div>
    );
  }

  if (openId && storeState === 'unavailable') {
    return (
      <div className="ap-ctxlife">
        <button
          type="button"
          className="ap-ctxlife__back"
          data-testid="ap-ctxlife-back"
          onClick={() => setOpenId(null)}
        >
          <span aria-hidden="true">←</span> All sessions
        </button>
        <p className="ap-ctxlife__status ap-ctxlife__status--error" data-testid="ap-ctxlife-store-error">
          The store for <code>{openId}</code> could not be read. It may have been removed since the
          list was taken.
        </p>
      </div>
    );
  }

  return (
    <div className="ap-ctxlife">
      {sessions.length === 0 ? (
        <p className="ap-ctxlife__status" data-testid="ap-ctxlife-empty">
          No session stores yet — the context-lifecycle hooks are inert until armed. Nothing in{' '}
          <code>.claude/settings.json</code> registers them, so no session has written a store. The
          snippet that would arm them is in <code>docs/proposals/context-lifecycle-hooks.md</code>.
        </p>
      ) : (
        <>
          <div className="ap-ctxlife__list">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                className="ap-ctxlife__row"
                data-testid={`ap-ctxlife-row-${session.sessionId}`}
                aria-label={`Open the context store for ${session.sessionId}`}
                onClick={() => setOpenId(session.sessionId)}
              >
                <span className="ap-ctxlife__id">{session.sessionId}</span>
                <span className="ap-ctxlife__meta">{shortTime(session.modifiedAt)}</span>
              </button>
            ))}
          </div>
          <p className="ap-ctxlife__note">
            Read-only. Stores live outside the repo (daemon-local state, never coordination truth) and
            are written only by the hooks — this panel cannot create, edit, or delete one.
          </p>
        </>
      )}
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'context-lifecycle',
  order: 70,
  title: 'Context Lifecycle',
  description:
    'Per-session context stores the inert SessionStart / PreCompact / PostToolUse hooks would keep.',
  render: () => <ContextLifecycleBody />,
};

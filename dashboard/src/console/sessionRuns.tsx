/**
 * Session runs in the UI — the "chat session" half of an entity's Runs tab.
 *
 * ── The rule this file exists to hold: two provenances, two vocabularies ──
 *
 * An entity's Runs tab shows two kinds of history that must never be mistaken for each other:
 *
 *   a GOVERNED RUN   — launched from a compiled, hash-pinned plan and driven by the executor. It opens
 *                      the run detail, which by design contains no terminal.
 *   a CHAT SESSION   — one primed `claude` in a PTY, driven by an operator's keystrokes. It has no plan,
 *                      no stages, and no governance; it opens in-page, as a live console or a transcript.
 *
 * So every row carries an explicit kind label in plain words, and nothing here ever renders a session
 * run with a governed run's chrome (no run ref, no state dot vocabulary, no "open run"). The honest
 * failure mode of this design is a slightly busier list; the dishonest alternative is a chat that looks
 * like a governed execution.
 *
 * ── Why a live row does not embed its own console ──
 *
 * The persistent-session registry allows exactly ONE attached sink per shell, and a second attach EVICTS
 * the first (persistentSessions.ts:304-309). Two panes attached to the same session would therefore
 * fight, each kicking the other off. The live console is hosted in exactly one place per detail — the
 * console block at the top of the Runs section — and a live row points at it instead of opening a rival
 * pane.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalSession } from '../lib/sessionContext';
import { defaultSessionRunsClient } from '../lib/terminalClient';
import type { SessionRunDto, SessionRunOutcome, SessionRunsClient } from '../lib/terminalClient';
import { relativeAge } from '../control/runEvents';
import type { ConsoleSpec } from './useAttachableSession';
import '../styles/console.css';

/** Outcome in the operator's words. `abandoned` is stated, never softened — it means the transcript
 *  stops at a daemon restart, and a UI that hid that would be lying about what it is showing. */
export function sessionRunOutcomeLabel(outcome: SessionRunOutcome): string {
  switch (outcome) {
    case 'live': return 'running';
    case 'ended': return 'ended';
    case 'abandoned': return 'ended at a daemon restart';
    default: return 'dismissed';
  }
}

/** The one-line truth about what the transcript below IS. */
export function transcriptNote(run: SessionRunDto, truncated: boolean): string | null {
  if (run.outcome === 'abandoned') {
    return 'The daemon restarted while this session was running, so the transcript ends there.';
  }
  if (truncated) return 'Only the last 512KB of this session was kept.';
  return null;
}

/** A key the server can replay safely. `randomUUID` is not guaranteed in every embedding, so there is a
 *  plain fallback — an unsendable Dismiss would be a worse failure than a less-pretty key. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `srun-dismiss-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SessionRunsState {
  /** `undefined` = not loaded (locked, or still in flight) — a different claim from "none". */
  runs: SessionRunDto[] | undefined;
  status: 'loading' | 'ready';
  unlocked: boolean;
  refresh: () => void;
  archive: (ref: string) => Promise<void>;
  archivingRef: string | null;
  /** A refusal in plain words, shown next to the list rather than swallowed. */
  error: string | null;
}

/**
 * This entity's session runs, newest first. Scoped to the spec: the server returns every session run the
 * caller owns, and a detail view shows only the ones bound to the entity it is showing.
 */
export function useSessionRuns(
  spec: ConsoleSpec | null,
  options: { client?: SessionRunsClient; includeArchived?: boolean } = {},
): SessionRunsState {
  const client = options.client ?? defaultSessionRunsClient;
  const token = useOptionalSession()?.session?.token;
  const [runs, setRuns] = useState<SessionRunDto[] | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [nonce, setNonce] = useState(0);
  const [archivingRef, setArchivingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read without re-running the effect: a fresh client object per render must not re-list.
  const clientRef = useRef(client);
  clientRef.current = client;

  const specKind = spec?.kind ?? null;
  const specRef = spec?.ref ?? null;
  const includeArchived = options.includeArchived === true;

  useEffect(() => {
    if (specKind === null || specRef === null || !token) {
      setRuns(undefined);
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      const all = await clientRef.current.list(token, { includeArchived });
      if (cancelled) return;
      setRuns(all.filter((run) => run.kind === specKind && run.targetRef === specRef));
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [specKind, specRef, token, includeArchived, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const archive = useCallback(async (ref: string): Promise<void> => {
    if (!token) {
      setError('Unlock the dashboard to dismiss a session.');
      return;
    }
    setArchivingRef(ref);
    setError(null);
    try {
      const result = await clientRef.current.archive(ref, token, { idempotencyKey: newIdempotencyKey() });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setRuns((current) => current?.filter((run) => run.sessionRunRef !== ref));
    } finally {
      setArchivingRef(null);
    }
  }, [token]);

  return { runs, status, unlocked: Boolean(token), refresh, archive, archivingRef, error };
}

export interface SessionRunRowProps {
  run: SessionRunDto;
  now?: number;
  expanded: boolean;
  onToggle: () => void;
  onArchive?: () => void;
  archiving?: boolean;
  client?: SessionRunsClient;
  /** Shown on a LIVE row instead of a second console (see the module doc). */
  liveNote?: string;
}

/**
 * ONE chat-session row. Collapsed it states what it was and how it ended; expanded it shows the
 * transcript (fetched on demand — a list of ten sessions must not pull ten transcripts) and, for a
 * finished session, the Dismiss action.
 */
export function SessionRunRow({
  run,
  now,
  expanded,
  onToggle,
  onArchive,
  archiving = false,
  client,
  liveNote,
}: SessionRunRowProps): React.JSX.Element {
  const sessionClient = client ?? defaultSessionRunsClient;
  const token = useOptionalSession()?.session?.token;
  const [transcript, setTranscript] = useState<{ text: string; truncated: boolean } | null>(null);
  const [transcriptState, setTranscriptState] = useState<'idle' | 'loading' | 'ready' | 'empty'>('idle');
  const clientRef = useRef(sessionClient);
  clientRef.current = sessionClient;
  // "Have I already asked for this transcript?" lives in a REF, not in the state the effect sets. Keying
  // the effect on its own state made the `loading` transition re-run it, and the re-run's cleanup
  // cancelled the very fetch it had just started — the pane sat on "Loading…" forever.
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded || !token) return;
    if (requestedRef.current === run.sessionRunRef) return;
    requestedRef.current = run.sessionRunRef;
    let cancelled = false;
    setTranscriptState('loading');
    void (async () => {
      const detail = await clientRef.current.get(run.sessionRunRef, token);
      if (cancelled) return;
      if (detail?.transcript && detail.transcript.text.length > 0) {
        setTranscript({ text: detail.transcript.text, truncated: detail.transcript.truncated });
        setTranscriptState('ready');
      } else {
        setTranscriptState('empty');
      }
    })();
    return () => { cancelled = true; };
  }, [expanded, token, run.sessionRunRef]);

  const note = transcript ? transcriptNote(run, transcript.truncated) : transcriptNote(run, false);

  return (
    <div className="session-run" data-testid={`session-run-${run.sessionRunRef}`}>
      <button
        type="button"
        className="session-run__row"
        aria-expanded={expanded}
        onClick={onToggle}
        data-testid={`session-run-toggle-${run.sessionRunRef}`}
      >
        {/* The kind label is never optional: this is what keeps a chat from reading as a governed run. */}
        <span className="session-run__kind mc-mono" data-testid={`session-run-kind-${run.sessionRunRef}`}>
          chat session
        </span>
        <span className="session-run__main">
          {run.outcome === 'live' ? 'Live session' : 'Session'} with{' '}
          <span className="mc-mono">{run.targetRef}</span>
        </span>
        <span className="session-run__state" data-testid={`session-run-outcome-${run.sessionRunRef}`}>
          <span
            className={`mc-status-dot mc-status-dot--${run.outcome === 'live' ? 'running' : 'idle'}`}
            aria-hidden="true"
          />
          {sessionRunOutcomeLabel(run.outcome)}
        </span>
        <span className="mc-mono session-run__age">{relativeAge(run.startedAt, now)}</span>
      </button>

      {expanded ? (
        <div className="session-run__body" data-testid={`session-run-body-${run.sessionRunRef}`}>
          {run.outcome === 'live' ? (
            <p className="entity-note" data-testid={`session-run-live-note-${run.sessionRunRef}`}>
              {liveNote ?? 'This session is still running — it is attached in the console above.'}
            </p>
          ) : null}

          {transcriptState === 'loading' ? (
            <p className="entity-note">Loading the transcript…</p>
          ) : transcriptState === 'empty' ? (
            <p className="entity-note" data-testid={`session-run-transcript-empty-${run.sessionRunRef}`}>
              No transcript was kept for this session.
            </p>
          ) : transcript ? (
            <>
              {note ? (
                <p className="entity-note" data-testid={`session-run-transcript-note-${run.sessionRunRef}`}>{note}</p>
              ) : null}
              <pre className="session-run__transcript" data-testid={`session-run-transcript-${run.sessionRunRef}`}>
                {transcript.text}
              </pre>
            </>
          ) : null}

          {run.outcome !== 'live' && onArchive ? (
            <button
              type="button"
              className="mc-btn session-run__dismiss"
              onClick={onArchive}
              disabled={archiving}
              data-testid={`session-run-archive-${run.sessionRunRef}`}
            >
              {archiving ? 'Dismissing…' : 'Dismiss'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

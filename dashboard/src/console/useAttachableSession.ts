/**
 * `useAttachableSession` — "is there already a live shell for THIS entity?"
 *
 * This hook is what makes an EMBEDDED console viable at all. `EntityDetail` renders only the active
 * section (`src/entity/EntityDetail.tsx`), so switching an agent's detail from Runs to Overview and back
 * fully UNMOUNTS and REMOUNTS the console. A console that only knew how to spawn would open a brand-new
 * shell on every one of those round trips, quietly eating the daemon's 8-session cap until the operator's
 * Terminal tabs stopped opening.
 *
 * The server now records what each session was opened AS (`kind` + `targetRef`, stamped at create in
 * `server/pty/route.ts`). So on mount this hook asks the daemon for the caller's live sessions and looks
 * for one already bound to this entity:
 *
 *   found    → `{ mode:'attach', sessionId }`, and the pane reattaches; the server replays its 512 KB
 *              output ring, so the operator gets their scrollback back with no client-side buffering.
 *   none yet → `{ mode:'spawn', … }`, offered but NOT auto-used — starting a shell is the operator's
 *              decision, and a detail view that spawned one just by being looked at would be a defect.
 *
 * `status` stays `'loading'` until that list settles. Callers MUST honour it: rendering the spawn target
 * before the answer arrives is precisely the respawn bug this hook exists to prevent.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOptionalSession } from '../lib/sessionContext';
import { defaultTerminalSessionsClient } from '../lib/terminalClient';
import type { PtySessionSummary, PtySpawnTarget, TerminalSessionsClient } from '../lib/terminalClient';
import type { ConsoleTarget } from './ConsolePane';

/** The entity a console belongs to. Mirrors the two primed spawn modes the server accepts. */
export type ConsoleSpec =
  | { kind: 'agent'; ref: string }
  | { kind: 'workflow'; ref: string };

export interface AttachableSession {
  /** `'loading'` while the live-session list is in flight. Never render a spawn target during this. */
  status: 'loading' | 'ready';
  /** A live session already bound to this spec, or null. */
  attach: Extract<ConsoleTarget, { mode: 'attach' }> | null;
  /** What opening a console for this spec WOULD be. Stable across renders. */
  spawn: Extract<ConsoleTarget, { mode: 'spawn' }>;
  /** True once the caller is signed in; a locked caller can neither list nor open anything. */
  unlocked: boolean;
  /** Drop the discovered attach locally — for when the pane reports its shell exited. */
  release: () => void;
  /** Re-read the live list from the server. */
  refresh: () => void;
}

/** The spawn request one spec opens. `agent`/`workflow` are the server's own primed modes; the browser
 *  only ever NAMES the target and the server resolves it against its allowlist. */
export function spawnForSpec(spec: ConsoleSpec): PtySpawnTarget {
  return spec.kind === 'agent'
    ? { mode: 'agent', agentId: spec.ref }
    : { mode: 'workflow', workflowRef: spec.ref };
}

/** Does this live session belong to this spec? Kind AND ref must match: a plain-claude session that was
 *  merely FLIPPED out of agent mode is a different program and must not be adopted as the agent's. */
export function sessionMatchesSpec(summary: PtySessionSummary, spec: ConsoleSpec): boolean {
  return summary.kind === spec.kind && summary.targetRef === spec.ref;
}

/**
 * Find the session a console for `spec` should attach to, if any.
 *
 * `spec` may be null (nothing to look for — the caller has no entity yet); the hook then settles
 * immediately as `ready` with no attach.
 */
export function useAttachableSession(
  spec: ConsoleSpec | null,
  options: { sessionsClient?: TerminalSessionsClient } = {},
): AttachableSession {
  const sessionsClient = options.sessionsClient ?? defaultTerminalSessionsClient;
  const sessionToken = useOptionalSession()?.session?.token;
  const [attach, setAttach] = useState<Extract<ConsoleTarget, { mode: 'attach' }> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [nonce, setNonce] = useState(0);

  // Read by the lookup effect without re-running it: injecting a fresh client object each render must
  // not re-list (and a re-list that flips `attach` under a mounted pane would tear its socket down).
  const clientRef = useRef(sessionsClient);
  clientRef.current = sessionsClient;

  const specKind = spec?.kind ?? null;
  const specRef = spec?.ref ?? null;

  useEffect(() => {
    if (specKind === null || specRef === null || !sessionToken) {
      // Nothing to look up (no entity, or locked). Settle honestly rather than spinning: the caller
      // renders its locked / empty state, and no console is opened either way.
      setAttach(null);
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      const live = await clientRef.current.list(sessionToken);
      if (cancelled) return;
      const target: ConsoleSpec = { kind: specKind, ref: specRef } as ConsoleSpec;
      const match = live.find((summary) => sessionMatchesSpec(summary, target)) ?? null;
      setAttach(match ? { mode: 'attach', sessionId: match.sessionId } : null);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [specKind, specRef, sessionToken, nonce]);

  const release = useCallback(() => setAttach(null), []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Rebuilt only when the spec itself changes, so a caller can hand it straight to `<ConsolePane>`
  // without the object identity churning the pane's connection.
  const spawnTargetRef = useRef<Extract<ConsoleTarget, { mode: 'spawn' }>>({ mode: 'spawn' });
  const spawnKeyRef = useRef<string | null>(null);
  const spawnKey = specKind === null ? null : `${specKind}:${specRef ?? ''}`;
  if (spawnKeyRef.current !== spawnKey) {
    spawnKeyRef.current = spawnKey;
    spawnTargetRef.current = spec
      ? { mode: 'spawn', spawn: spawnForSpec(spec) }
      : { mode: 'spawn' };
  }

  return {
    status,
    attach,
    spawn: spawnTargetRef.current,
    unlocked: Boolean(sessionToken),
    release,
    refresh,
  };
}

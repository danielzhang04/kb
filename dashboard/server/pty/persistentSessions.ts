/**
 * Persistent PTY session registry — the piece that lets a web terminal SURVIVE a page reload.
 *
 * A `/api/pty` WebSocket used to own its shell: the socket closing (a reload, a nav-away) tore the PTY
 * down. This registry decouples the shell's LIFETIME from any one socket. Each session:
 *
 *  - is OWNER-BOUND (the WebAuthn session `sub`) — one operator can never attach, list, close, or write
 *    to another operator's shell (owner mismatch is a typed refusal, never a throw across the route);
 *  - buffers ALL output into a bounded, drop-oldest RING (server-side scrollback) via ONE `onData`
 *    listener installed at create time, so nothing is lost while no socket is attached;
 *  - forwards live output to AT MOST ONE attached sink; a second attach SWAPS the sink (the route evicts
 *    the displaced socket with an error frame — the registry just changes which sink receives bytes);
 *  - dies only on an explicit `close` (kill via the host), the shell process exiting, or `clear` on the
 *    daemon-shutdown drain. A socket closing calls `detach`, which keeps the shell alive and buffering.
 *
 * Ordering invariant (design §3, mirrors `pty/route.ts` pre-audit buffering): on attach the CURRENT ring
 * is snapshotted, the sink is set as the live flag, then the snapshot is flushed — no `await` between the
 * flag and the flush, so a chunk emitted after the attach streams live and lands AFTER the replayed
 * backlog, never interleaved.
 *
 * Strip-only floor: no TS parameter properties / enums / namespaces — plain interfaces + a factory.
 */
import type { HostOpenRequest, PtyHost } from './host.ts';

/** Default retained-output ceiling per session: ~512 KB of most-recent bytes, drop-oldest. Chosen to
 *  cover a generous xterm scrollback (a few thousand 80-col rows) without letting an idle-but-noisy shell
 *  grow unbounded memory. Overridable for tests. */
export const DEFAULT_RING_BYTES = 512_000;
/** Bounded exit acknowledgements bridge the tiny natural-exit -> closeAndWait call race. */
const MAX_CONFIRMED_EXIT_TOMBSTONES = 512;

/** Shape of the sessionId the host mints (`pty-<epoch>-<counter>`). Used to reject a malformed id in a
 *  URL/path before it ever reaches a Map lookup. Test hosts inject ids like `pty-test-1`, also accepted. */
export const SESSION_ID_RE = /^pty-[A-Za-z0-9_-]+$/;

/**
 * The sink a socket presents when it attaches. `send` delivers one output chunk; `closed` lets the
 * registry skip a torn-down socket without throwing; the two optional callbacks let the ROUTE own socket
 * lifecycle while the registry stays transport-agnostic:
 *  - `onExit`   — the shell process exited; the route closes the socket (1000 'shell exited').
 *  - `onEvicted`— a newer socket attached to the same session; the route closes this displaced socket
 *                 with an error frame. The registry only triggers it; it never formats a frame itself.
 */
export interface SessionSink {
  send(chunk: string): void;
  closed(): boolean;
  onExit?(info: { exitCode: number; signal?: number }): void;
  onEvicted?(): void;
}

/** What `create` hands back — enough for the route to send the `{type:'session'}` bind frame. */
export interface CreatedSession {
  sessionId: string;
  createdAt: number;
}

/**
 * WHAT a session was opened as. `shell` is the login shell (no spawn parameters on the upgrade); the
 * other three mirror the route's `PtySpawnMode`. Recorded at create time and never mutated — a PTY's
 * program is fixed at spawn, so this is a fact about the session, not a setting.
 */
export type SessionKind = 'shell' | 'claude' | 'agent' | 'workflow';

/**
 * The entity a session was primed FOR, as the route resolved it from the (already allowlisted) spawn
 * parameters. Purely descriptive: it is a label on a session, never an authorisation input — attach,
 * write, close and list all still gate on `owner` alone.
 */
export interface SessionTarget {
  kind: SessionKind;
  /** The agent id or workflow ref, or null for a shell / plain claude. */
  targetRef?: string | null;
}

/** The kind a session gets when `create` is called without a target — today's behaviour, named. */
export const DEFAULT_SESSION_TARGET: SessionTarget = { kind: 'shell', targetRef: null };

/** One row of `list(owner)` — a live session the operator may reattach to. `kind`/`targetRef` let a
 *  surface find the session ALREADY bound to the entity it is showing, instead of opening a second one
 *  beside it (an embedded console must reattach on remount, never respawn). */
export interface SessionSummary {
  sessionId: string;
  createdAt: number;
  attached: boolean;
  kind: SessionKind;
  targetRef: string | null;
}

/** Typed attach/canAttach outcome. `not-found` = unknown id; `exited` = shell already gone; `not-owner`
 *  = owned by another `sub`. The route collapses every failure to the browser-facing `session-not-found`. */
export type AttachResult = { ok: true } | { ok: false; reason: 'not-found' | 'not-owner' | 'exited' };

/** Typed close outcome — `not-found`/`not-owner` map to a REST 404 (never leaking another owner's ids). */
export type CloseResult = { ok: true } | { ok: false; reason: 'not-found' | 'not-owner' };

/** A kill request is not proof the PTY process group exited. This result is reserved for callers that
 * must hold a security boundary until the host's real `onExit` acknowledgement arrives. */
export type CloseAndWaitResult =
  | { ok: true; exited: true }
  | { ok: false; reason: 'not-found' | 'not-owner' | 'timeout' | 'unconfirmed' };

/**
 * A server-side, NON-EXCLUSIVE output tap on one manual Terminal session.
 *
 * Why this is not `attach`: a sink is single and evictable by design — the browser terminal owns it, and
 * a second attach displaces the first. A diagnostic that must READ a session's output can therefore never
 * use a sink without fighting the UI for it. An observer is additive: it receives every chunk the ring
 * receives, it is never evicted by an
 * attach, and it can never send input (that stays `write`, which is owner-checked).
 */
export type SessionObserver = (chunk: string) => void;

/**
 * Paired "this session is gone" notification for an observer — fired when the shell exits OR the session
 * is explicitly closed, exactly once, before the observer set is dropped. Without it a server component
 * awaiting output would wait forever on a dead shell.
 */
export type SessionObserverGone = () => void;

/** The owner-bound registry surface. A single instance is shared by the WS route, the REST endpoints,
 *  and the shutdown drain. */
export interface PersistentSessionRegistry {
  /** Spawn a shell via `host.open`, start buffering immediately, and track it under `owner`. `target`
   *  records WHAT was spawned (see {@link SessionTarget}); omitted it defaults to the login shell. */
  create(owner: string, host: PtyHost, openRequest: HostOpenRequest, target?: SessionTarget): CreatedSession;
  /** Pure ownership/existence check (no side effects) — lets the route audit the correct result BEFORE
   *  attaching, preserving the fail-closed "audit before any byte flows" discipline. */
  canAttach(owner: string, sessionId: string): AttachResult;
  /** Swap the live sink to `sink`, replaying the ring snapshot AFTER setting it (flag-then-flush). A
   *  previously-attached sink is evicted first. */
  attach(owner: string, sessionId: string, sink: SessionSink): AttachResult;
  /** Clear the live sink (buffering continues). `sink` guards against a stale close racing a newer
   *  attach: only the still-current sink is cleared. */
  detach(sessionId: string, sink?: SessionSink): void;
  /**
   * Install a non-evicting, owner-checked output tap; returns its unsubscribe. Unknown/foreign/dead
   * sessions yield a no-op unsubscribe rather than a throw, so a caller racing a shell exit is safe.
   * Observers never receive replay of the existing ring: a watcher installed at create time has seen
   * every byte already, and replaying scrollback would duplicate observations.
   */
  observe(owner: string, sessionId: string, observer: SessionObserver, onGone?: SessionObserverGone): () => void;
  /** Kill the shell (host.stop) and forget it. */
  close(owner: string, sessionId: string): CloseResult;
  /**
   * Kill the shell but retain its registry entry until the underlying PTY emits `onExit`. The promise
   * resolves successfully only on that acknowledgement; timeout is an explicit refusal, never an
   * optimistic close. Existing browser/Claude teardown keeps using synchronous {@link close}.
   */
  closeAndWait(owner: string, sessionId: string, timeoutMs: number): Promise<CloseAndWaitResult>;
  /** Forward raw stdin to the shell. Owner-checked; a no-op for unknown/foreign/dead sessions. */
  write(owner: string, sessionId: string, data: string): boolean;
  /** Resize the shell's window. Owner-checked; a no-op for unknown/foreign/dead sessions. */
  resize(owner: string, sessionId: string, cols: number, rows: number): boolean;
  /** Live sessions for `owner` only. */
  list(owner: string): SessionSummary[];
  /** Total live sessions across all owners — the concurrency cap counts THIS, not open sockets. */
  liveCount(): number;
  /** Drop every entry (daemon-shutdown drain; the host's `stopAll` kills the PTYs themselves). */
  clear(): void;
}

/** Injectable seams for hermetic tests. */
export interface RegistryDeps {
  /** Clock for `createdAt`. Defaults to `Date.now`. */
  now?: () => number;
  /** Ring ceiling in bytes. Defaults to {@link DEFAULT_RING_BYTES}. */
  maxBytes?: number;
}

interface SessionEntry {
  sessionId: string;
  owner: string;
  createdAt: number;
  /** Descriptive only — what this session was opened as. Stamped at create, never mutated. */
  kind: SessionKind;
  targetRef: string | null;
  host: PtyHost;
  handle: { write(d: string): void; resize(c: number, r: number): void };
  chunks: string[];
  bytes: number;
  sink: SessionSink | null;
  /** Non-exclusive server-side taps (see {@link SessionObserver}); independent of `sink`. */
  observers: Set<{ observer: SessionObserver; onGone?: SessionObserverGone }>;
  /** Exit-confirmation waiters installed before host.stop, so even a synchronous onExit cannot race them. */
  exitWaiters: Set<(confirmed: boolean) => void>;
  exited: boolean;
  disposed: boolean;
  closing: boolean;
}

/** Create an owner-bound persistent PTY session registry over an existing {@link PtyHost}. */
export function createPersistentSessionRegistry(deps: RegistryDeps = {}): PersistentSessionRegistry {
  const now = deps.now ?? Date.now;
  const maxBytes = deps.maxBytes ?? DEFAULT_RING_BYTES;
  const sessions = new Map<string, SessionEntry>();
  const confirmedExits = new Map<string, string>();

  const rememberConfirmedExit = (entry: SessionEntry): void => {
    confirmedExits.delete(entry.sessionId);
    confirmedExits.set(entry.sessionId, entry.owner);
    while (confirmedExits.size > MAX_CONFIRMED_EXIT_TOMBSTONES) {
      const oldest = confirmedExits.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      confirmedExits.delete(oldest);
    }
  };

  /** Append a chunk to the ring, dropping whole oldest chunks until back under the byte ceiling. A lone
   *  chunk larger than the ceiling is retained (it is the freshest output; there is nothing older left). */
  const pushChunk = (entry: SessionEntry, chunk: string): void => {
    entry.chunks.push(chunk);
    entry.bytes += chunk.length;
    while (entry.bytes > maxBytes && entry.chunks.length > 1) {
      const dropped = entry.chunks.shift() as string;
      entry.bytes -= dropped.length;
    }
  };

  /** Fire every observer's paired gone-notification exactly once, then drop the tap set. */
  const notifyGone = (entry: SessionEntry): void => {
    const taps = [...entry.observers];
    entry.observers.clear();
    for (const tap of taps) {
      if (!tap.onGone) continue;
      try { tap.onGone(); } catch { /* a watcher's cleanup must never break session teardown */ }
    }
  };

  const resolveExitWaiters = (entry: SessionEntry, confirmed: boolean): void => {
    const waiters = [...entry.exitWaiters];
    entry.exitWaiters.clear();
    for (const waiter of waiters) waiter(confirmed);
  };

  return {
    create(owner, host, openRequest, target = DEFAULT_SESSION_TARGET) {
      const session = host.open(openRequest);
      const entry: SessionEntry = {
        sessionId: session.sessionId,
        owner,
        createdAt: now(),
        kind: target.kind,
        targetRef: target.targetRef ?? null,
        host,
        handle: session.handle,
        chunks: [],
        bytes: 0,
        sink: null,
        observers: new Set(),
        exitWaiters: new Set(),
        exited: false,
        disposed: false,
        closing: false,
      };
      confirmedExits.delete(entry.sessionId);
      sessions.set(entry.sessionId, entry);

      // ONE data listener for the session's whole life: ALWAYS buffer, then forward live if attached,
      // then fan out to every server-side observer. An observer that throws is contained — a watcher
      // bug must never break the terminal's byte pump.
      session.handle.onData((chunk: string) => {
        pushChunk(entry, chunk);
        const sink = entry.sink;
        if (sink && !sink.closed()) sink.send(chunk);
        for (const tap of entry.observers) {
          try { tap.observer(chunk); } catch { /* observer failures never propagate into the pump */ }
        }
      });

      // Shell exit: mark, notify the attached sink so the route can close its socket, and forget it.
      session.handle.onExit((info: { exitCode: number; signal?: number }) => {
        if (entry.disposed) return;
        entry.disposed = true;
        entry.exited = true;
        const sink = entry.sink;
        entry.sink = null;
        notifyGone(entry);
        sessions.delete(entry.sessionId);
        rememberConfirmedExit(entry);
        resolveExitWaiters(entry, true);
        if (sink && !sink.closed() && sink.onExit) sink.onExit(info);
      });

      return { sessionId: entry.sessionId, createdAt: entry.createdAt };
    },

    canAttach(owner, sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.disposed) return { ok: false, reason: 'not-found' };
      if (entry.exited) return { ok: false, reason: 'exited' };
      if (entry.closing) return { ok: false, reason: 'exited' };
      if (entry.owner !== owner) return { ok: false, reason: 'not-owner' };
      return { ok: true };
    },

    attach(owner, sessionId, sink) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.disposed) return { ok: false, reason: 'not-found' };
      if (entry.exited) return { ok: false, reason: 'exited' };
      if (entry.closing) return { ok: false, reason: 'exited' };
      if (entry.owner !== owner) return { ok: false, reason: 'not-owner' };

      // Evict any currently-attached sink FIRST (single-sink discipline). Clear the slot before firing
      // onEvicted so the displaced socket's synchronous close→detach cannot clobber the new sink below.
      const previous = entry.sink;
      if (previous && previous !== sink) {
        entry.sink = null;
        if (!previous.closed() && previous.onEvicted) previous.onEvicted();
      }

      // Flag-then-flush: snapshot the ring, set the live sink, then replay the snapshot. No await between
      // setting the flag and flushing, so a chunk emitted after attach streams live AFTER this backlog.
      const backlog = entry.chunks.slice();
      entry.sink = sink;
      for (const chunk of backlog) {
        if (sink.closed()) break;
        sink.send(chunk);
      }
      return { ok: true };
    },

    detach(sessionId, sink) {
      const entry = sessions.get(sessionId);
      if (!entry) return;
      // A bare detach clears whatever is attached; a sink-scoped detach only clears if it is still the
      // current sink (defends against a stale socket close arriving after a newer socket attached).
      if (sink === undefined || entry.sink === sink) entry.sink = null;
    },

    observe(owner, sessionId, observer, onGone) {
      const entry = sessions.get(sessionId);
      // A tap on an unknown/foreign/dead session is inert AND immediately reported gone, so a caller that
      // raced a shell exit settles instead of waiting on output that can never arrive.
      if (!entry || entry.disposed || entry.exited || entry.owner !== owner) {
        if (onGone) { try { onGone(); } catch { /* contain */ } }
        return () => {};
      }
      const tap = { observer, ...(onGone ? { onGone } : {}) };
      entry.observers.add(tap);
      return () => {
        entry.observers.delete(tap);
      };
    },

    close(owner, sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return { ok: false, reason: 'not-found' };
      if (entry.owner !== owner) return { ok: false, reason: 'not-owner' };
      entry.disposed = true; // guard the onExit that host.stop's kill may fire
      entry.sink = null;
      notifyGone(entry);
      sessions.delete(sessionId);
      resolveExitWaiters(entry, false);
      try {
        entry.host.stop(sessionId); // kills the shell's whole process group
      } catch {
        /* best-effort reap */
      }
      return { ok: true };
    },

    closeAndWait(owner, sessionId, timeoutMs) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.disposed) {
        if (confirmedExits.get(sessionId) === owner) {
          confirmedExits.delete(sessionId);
          return Promise.resolve({ ok: true, exited: true });
        }
        return Promise.resolve({ ok: false, reason: 'not-found' });
      }
      if (entry.owner !== owner) return Promise.resolve({ ok: false, reason: 'not-owner' });
      const boundedTimeout = Number.isFinite(timeoutMs) ? Math.max(0, Math.round(timeoutMs)) : 0;
      return new Promise<CloseAndWaitResult>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const waiter = (confirmed: boolean): void => {
          if (settled) return;
          settled = true;
          entry.exitWaiters.delete(waiter);
          if (timer) clearTimeout(timer);
          if (confirmed) confirmedExits.delete(entry.sessionId);
          resolve(confirmed ? { ok: true, exited: true } : { ok: false, reason: 'unconfirmed' });
        };
        entry.exitWaiters.add(waiter);
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          entry.exitWaiters.delete(waiter);
          resolve({ ok: false, reason: 'timeout' });
        }, boundedTimeout);
        if (typeof timer.unref === 'function') timer.unref();
        if (entry.closing) return;
        entry.closing = true;
        entry.sink = null;
        notifyGone(entry);
        try {
          // Do not delete/dispose here. Only the registered onExit callback may turn this into success.
          entry.host.stop(sessionId);
        } catch {
          // The timeout remains authoritative when a host cannot even issue the kill.
        }
      });
    },

    write(owner, sessionId, data) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.disposed || entry.closing || entry.owner !== owner) return false;
      try {
        entry.handle.write(data);
        return true;
      } catch {
        return false; // the PTY may have just exited
      }
    },

    resize(owner, sessionId, cols, rows) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.disposed || entry.closing || entry.owner !== owner) return false;
      try {
        entry.handle.resize(cols, rows);
        return true;
      } catch {
        return false;
      }
    },

    list(owner) {
      const out: SessionSummary[] = [];
      for (const entry of sessions.values()) {
        if (entry.owner !== owner || entry.disposed || entry.closing) continue;
        out.push({
          sessionId: entry.sessionId,
          createdAt: entry.createdAt,
          attached: entry.sink !== null,
          kind: entry.kind,
          targetRef: entry.targetRef,
        });
      }
      return out;
    },

    liveCount() {
      return sessions.size;
    },

    clear() {
      for (const entry of sessions.values()) {
        entry.disposed = true;
        notifyGone(entry);
        resolveExitWaiters(entry, false);
      }
      sessions.clear();
    },
  };
}

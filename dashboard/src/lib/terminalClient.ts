/**
 * Browser glue for PERSISTENT terminal sessions. The `/api/pty` shells now outlive their WebSocket (the
 * server buffers output and keeps the PTY alive across a reload), so on mount the Terminal view reconciles
 * its locally-remembered tabs against the server's live-session list and reattaches. This module owns:
 *
 *  - `listPtySessions` — GET the caller's live sessions (bearer-verified server-side) to reconcile against.
 *  - `deletePtySession` — DELETE one session (used to kill a shell whose socket is already gone).
 *  - localStorage read/write for the remembered tab order (`kb-terminal-tabs-v1`, `[{sessionId}]`).
 *
 * `fetch` and `Storage` are injected so this is unit-testable with no network and no real localStorage.
 * Every failure is swallowed into a safe empty/no-op result — a persistence hiccup must never crash the
 * terminal or, worse, kill a live shell.
 */
export type FetchLike = typeof fetch;

/**
 * What a session RUNS. Absent = the login shell (the historical default, unchanged).
 *   `claude`   — a plain interactive Claude Code session in the repo the daemon serves.
 *   `agent`    — the same session primed with `agentId`'s own declaration file.
 *   `workflow` — the same session primed as the agent that runs `workflowRef`'s definition.
 *
 * `agentId`/`workflowRef` are retained even in `claude` mode so a mode toggle can switch back without
 * the operator re-picking anything. The SERVER resolves either reference to a file; the browser only
 * ever names it.
 */
export interface PtySpawnTarget {
  mode: 'claude' | 'agent' | 'workflow';
  agentId?: string;
  workflowRef?: string;
}

/** Opens the PTY WebSocket to the governed endpoint, bearer token carried as a subprotocol (never the
 *  URL). An optional `attachSessionId` reattaches to an existing persistent shell via `?session=<id>`
 *  (a non-secret reference; ownership is enforced server-side); an optional `spawn` asks the server to
 *  open something other than the login shell. Injectable so a component test can drive a console
 *  through a fake socket. */
export type PtySocketFactory = (
  sessionToken: string,
  attachSessionId?: string,
  spawn?: PtySpawnTarget,
) => WebSocket;

/** The upgrade query for one console. An attach and a spawn are mutually exclusive (the server refuses
 *  the combination): reattaching reuses a live shell, so there is nothing left to spawn. Callers express
 *  that exclusivity in their own types now (see `ConsoleTarget`); this stays defensive. */
export function ptyQuery(attachSessionId?: string, spawn?: PtySpawnTarget): string {
  if (attachSessionId) return `?${new URLSearchParams({ session: attachSessionId }).toString()}`;
  if (!spawn) return '';
  const params =
    spawn.mode === 'agent' && spawn.agentId
      ? new URLSearchParams({ spawn: 'agent', agent: spawn.agentId })
      : spawn.mode === 'workflow' && spawn.workflowRef
        ? new URLSearchParams({ spawn: 'workflow', workflow: spawn.workflowRef })
        : new URLSearchParams({ spawn: 'claude' });
  return `?${params.toString()}`;
}

export const defaultPtySocketFactory: PtySocketFactory = (sessionToken, attachSessionId, spawn) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The token rides as a subprotocol value, not a query param — keeps it out of access logs / history.
  return new WebSocket(
    `${proto}//${window.location.host}/api/pty${ptyQuery(attachSessionId, spawn)}`,
    ['kb-pty.v1', sessionToken],
  );
};

/** What a live session was OPENED as, as the server records it at create time. `shell` is the login
 *  shell (no spawn parameters); the other three mirror {@link PtySpawnTarget.mode}. */
export type PtySessionKind = 'shell' | 'claude' | 'agent' | 'workflow';

/** One live session as the server reports it. `kind`/`targetRef` are what let a surface find the session
 *  ALREADY bound to the entity it is showing, instead of opening a second one beside it. */
export interface PtySessionSummary {
  sessionId: string;
  createdAt: number;
  attached: boolean;
  /** What this session runs. Older daemons omit it; readers treat a missing value as `shell`. */
  kind?: PtySessionKind;
  /** The agent id / workflow ref this session was primed for, or null for a shell or plain claude. */
  targetRef?: string | null;
}

/** GET the caller's live sessions. Any non-2xx (e.g. an expired session → 401) yields `[]` so the view
 *  simply opens a fresh tab rather than surfacing an error. */
export async function listPtySessions(token: string, fetchImpl: FetchLike = fetch): Promise<PtySessionSummary[]> {
  try {
    const res = await fetchImpl('/api/pty/sessions', {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions?: PtySessionSummary[] };
    return Array.isArray(body.sessions) ? body.sessions : [];
  } catch {
    return [];
  }
}

/** DELETE (kill) one session by id. Best-effort — the caller has already dropped the tab locally. */
export async function deletePtySession(sessionId: string, token: string, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    await fetchImpl(`/api/pty/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort: the shell will also die on daemon shutdown */
  }
}

/**
 * ── SESSION RUNS ──────────────────────────────────────────────────────────────────────────────────────
 *
 * A session run is the daemon's durable record of one entity-primed terminal session: "someone sat down
 * with this agent / this workflow's governing agent and talked to it". It is a DIFFERENT KIND OF RECORD
 * from a governed control-plane run, and the UI must never blur the two — a governed run is launched
 * from a compiled, hash-pinned plan and driven by the executor; a session run is a chat in a shell.
 * Two vocabularies, everywhere: "governed run" vs "chat session".
 *
 * Everything below is owner-scoped server-side by the same bearer the PTY endpoints verify.
 */
export type SessionRunKind = 'agent' | 'workflow';

/**
 *   live      — the shell is still running (closing the browser tab does NOT end it).
 *   ended     — the shell exited, or the operator ended the session.
 *   abandoned — it was live when the daemon restarted; the transcript stops there.
 *   archived  — the operator dismissed the record. Hidden from the default list.
 */
export type SessionRunOutcome = 'live' | 'ended' | 'abandoned' | 'archived';

export interface SessionRunDto {
  sessionRunRef: string;
  kind: SessionRunKind;
  targetRef: string;
  ptySessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: SessionRunOutcome;
  exitCode: number | null;
  /** `truncated` is a truth label the UI must render, not a detail to hide. */
  transcript: { bytes: number; truncated: boolean } | null;
  version: number;
}

export interface SessionRunDetail {
  sessionRun: SessionRunDto;
  transcript: { text: string; bytes: number; truncated: boolean } | null;
}

/** GET my session runs. Any non-2xx (e.g. an expired session) yields `[]` — a detail view degrades to
 *  "no past sessions" rather than surfacing a transport error the operator cannot act on. */
export async function listSessionRuns(
  token: string,
  options: { includeArchived?: boolean } = {},
  fetchImpl: FetchLike = fetch,
): Promise<SessionRunDto[]> {
  try {
    const query = options.includeArchived ? '?includeArchived=1' : '';
    const res = await fetchImpl(`/api/pty/session-runs${query}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { sessionRuns?: SessionRunDto[] };
    return Array.isArray(body.sessionRuns) ? body.sessionRuns : [];
  } catch {
    return [];
  }
}

/** GET one session run plus its transcript text (server-bounded). `null` on any failure. */
export async function fetchSessionRun(
  ref: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<SessionRunDetail | null> {
  try {
    const res = await fetchImpl(`/api/pty/session-runs/${encodeURIComponent(ref)}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SessionRunDetail;
    return body?.sessionRun ? body : null;
  } catch {
    return null;
  }
}

/** The archive outcome, in the words the surface shows. A refusal is REPORTED, never swallowed: an
 *  operator who pressed Dismiss and saw nothing happen would reasonably assume it worked. */
export type ArchiveSessionRunResult =
  | { ok: true; sessionRun: SessionRunDto; replayed: boolean }
  | { ok: false; reason: string };

export async function archiveSessionRun(
  ref: string,
  token: string,
  request: { idempotencyKey: string; reason?: string | null },
  fetchImpl: FetchLike = fetch,
): Promise<ArchiveSessionRunResult> {
  try {
    const res = await fetchImpl(`/api/pty/session-runs/${encodeURIComponent(ref)}/archive`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        idempotencyKey: request.idempotencyKey,
        ...(request.reason == null ? {} : { reason: request.reason }),
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; sessionRun?: SessionRunDto; replayed?: boolean; error?: string }
      | null;
    if (res.ok && body?.sessionRun) {
      return { ok: true, sessionRun: body.sessionRun, replayed: body.replayed === true };
    }
    if (res.status === 409 && body?.error === 'session-run-live') {
      return { ok: false, reason: 'This session is still running. End it first, then dismiss it.' };
    }
    if (res.status === 401) return { ok: false, reason: 'Unlock the dashboard to dismiss a session.' };
    return { ok: false, reason: 'The session could not be dismissed.' };
  } catch {
    return { ok: false, reason: 'The session could not be dismissed.' };
  }
}

/** The session-run contract a detail view depends on; injected in tests as a fake. */
export interface SessionRunsClient {
  list(token: string, options?: { includeArchived?: boolean }): Promise<SessionRunDto[]>;
  get(ref: string, token: string): Promise<SessionRunDetail | null>;
  archive(
    ref: string,
    token: string,
    request: { idempotencyKey: string; reason?: string | null },
  ): Promise<ArchiveSessionRunResult>;
}

export const defaultSessionRunsClient: SessionRunsClient = {
  list: (token, options) => listSessionRuns(token, options),
  get: (ref, token) => fetchSessionRun(ref, token),
  archive: (ref, token, request) => archiveSessionRun(ref, token, request),
};

/** The persistence contract the Terminal view depends on; injected in tests as a fake. */
export interface TerminalSessionsClient {
  list(token: string): Promise<PtySessionSummary[]>;
  remove(sessionId: string, token: string): Promise<void>;
}

export const defaultTerminalSessionsClient: TerminalSessionsClient = {
  list: (token) => listPtySessions(token),
  remove: (sessionId, token) => deletePtySession(sessionId, token),
};

const STORAGE_KEY = 'kb-terminal-tabs-v1';

/** One remembered tab — only its (confirmed) sessionId is persisted; nothing else survives a reload. */
export interface StoredTab {
  sessionId: string;
}

function getStore(store?: Storage): Storage | null {
  if (store) return store;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // localStorage can throw in a locked-down context
  }
}

/** Read the remembered tab order; `[]` on absence or any parse error. */
export function loadStoredTabs(store?: Storage): StoredTab[] {
  const s = getStore(store);
  if (!s) return [];
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredTab[] = [];
    for (const item of parsed) {
      const id = (item as { sessionId?: unknown } | null)?.sessionId;
      if (typeof id === 'string' && id.length > 0) out.push({ sessionId: id });
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the remembered tab order (only tabs that have a confirmed sessionId). Best-effort. */
export function saveStoredTabs(tabs: StoredTab[], store?: Storage): void {
  const s = getStore(store);
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(tabs.map((t) => ({ sessionId: t.sessionId }))));
  } catch {
    /* quota / disabled storage — persistence is a convenience, never load-bearing */
  }
}

/**
 * Reconcile the remembered tab order against the server's live sessions: keep remembered ids that are
 * still live (in their stored order), then append any live sessions not yet remembered (adopted, e.g.
 * opened in another window). Dead remembered ids are dropped. Returns the ordered, de-duplicated id list.
 */
export function reconcileSessions(stored: StoredTab[], live: PtySessionSummary[]): string[] {
  const liveIds = new Set(live.map((s) => s.sessionId));
  const ordered: string[] = [];
  for (const tab of stored) {
    if (liveIds.has(tab.sessionId) && !ordered.includes(tab.sessionId)) ordered.push(tab.sessionId);
  }
  for (const s of live) {
    if (!ordered.includes(s.sessionId)) ordered.push(s.sessionId);
  }
  return ordered;
}

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

/** One live session as the server reports it. */
export interface PtySessionSummary {
  sessionId: string;
  createdAt: number;
  attached: boolean;
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

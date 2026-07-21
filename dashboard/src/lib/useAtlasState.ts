/**
 * Atlas V1 (Task 8) — the ONE shared poller for the Atlas panel (`GET /api/panels/atlas`, built by
 * `server/panels/atlas.ts`). Both dashboard consumers — the full `views/Atlas.tsx` and the App-shell
 * `components/AtlasMiniOrb.tsx` — read Atlas worker state through THIS hook, and they share a single
 * module-level fetch loop (a refcounted `setInterval`), never one loop per consumer.
 *
 * Loop discipline (design §4):
 *   - ~1s interval while the tab is visible; the tick is skipped while `document.hidden` and an
 *     immediate refetch fires again on `visibilitychange` when the tab comes back.
 *   - the existing `/events` SSE tick (via {@link useSse}) triggers an extra refetch so the
 *     filesystem-derived parts (transcript history + atlas cards) refresh without waiting for the poll.
 *   - the interval starts when the first consumer mounts and stops when the last one unmounts.
 *
 * Read-only: a failed/again-OFFLINE fetch keeps the last-known panel; the hook never throws. Server
 * types are imported `import type` only — this module must never runtime-import `server/panels/atlas.ts`
 * (it reaches `node:fs`); see `clientImportGraph.test.ts`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSse } from './sseClient';
import type { AtlasPanel, WorkerSnapshot, HistoryEntry, AtlasCard, TranscriptLine } from '../../server/panels/atlas';

/** The route the poller reads — the pre-auth, read-only Atlas panel projection. */
export const ATLAS_PANEL_URL = '/api/panels/atlas';
/** Poll cadence while the tab is visible (design §4: ~1s; SSE upgrade is a named follow-on). */
export const ATLAS_POLL_MS = 1000;

/** The five orb states the dashboard renders: the four worker states plus the dashboard-derived OFFLINE. */
export type OrbState = 'OFFLINE' | 'ASLEEP' | 'LISTENING' | 'THINKING' | 'SPEAKING';

/** The four real worker states (OFFLINE is never a worker state — it is derived when unreachable). */
const WORKER_STATES: readonly OrbState[] = ['ASLEEP', 'LISTENING', 'THINKING', 'SPEAKING'];

/** A normalized, always-present worker projection for the UI (never null; OFFLINE stands in for absent). */
export interface AtlasWorkerView {
  state: OrbState;
  /** ISO of the last state change (null when OFFLINE / unknown). */
  since: string | null;
  /** Liveness stamp: the live snapshot's `heartbeat`, or the OFFLINE shape's last-known `lastHeartbeat`. */
  heartbeat: string | null;
  sessionId: string | null;
  voice: string | null;
  transcript: TranscriptLine[];
}

export interface AtlasStateResult {
  /** The raw panel payload, or null before the first successful fetch. */
  panel: AtlasPanel | null;
  /** The normalized worker projection (defaults to OFFLINE while loading). */
  worker: AtlasWorkerView;
  history: HistoryEntry[];
  cards: AtlasCard[];
  /** True until the first successful fetch resolves. */
  loading: boolean;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toLine(row: unknown): TranscriptLine {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  return { t: strOrNull(r.t), role: strOrNull(r.role), text: strOrNull(r.text) };
}

const OFFLINE_VIEW: AtlasWorkerView = {
  state: 'OFFLINE',
  since: null,
  heartbeat: null,
  sessionId: null,
  voice: null,
  transcript: [],
};

/**
 * Normalize a raw worker snapshot (the worker's `/state` passthrough OR the derived
 * `{ state: 'OFFLINE', lastHeartbeat }` shape) into an always-present {@link AtlasWorkerView}. An
 * unknown/absent snapshot, or an unrecognized `state`, degrades to OFFLINE / ASLEEP defensively.
 */
export function deriveWorker(snapshot: WorkerSnapshot | null | undefined): AtlasWorkerView {
  if (!snapshot || typeof snapshot !== 'object') return OFFLINE_VIEW;
  const w = snapshot as Record<string, unknown>;
  const rawState = strOrNull(w.state);
  if (rawState === 'OFFLINE' || rawState === null) {
    return { ...OFFLINE_VIEW, heartbeat: strOrNull(w.lastHeartbeat) };
  }
  const state = (WORKER_STATES as readonly string[]).includes(rawState) ? (rawState as OrbState) : 'ASLEEP';
  return {
    state,
    since: strOrNull(w.since),
    heartbeat: strOrNull(w.heartbeat),
    sessionId: strOrNull(w.session_id),
    voice: strOrNull(w.voice),
    transcript: Array.isArray(w.transcript) ? w.transcript.map(toLine) : [],
  };
}

// ---- Module-level singleton: one fetch loop shared by every consumer -------------------------------
let currentPanel: AtlasPanel | null = null;
const listeners = new Set<() => void>();
let subscriberCount = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

async function fetchOnce(): Promise<void> {
  try {
    const res = await fetch(ATLAS_PANEL_URL);
    if (!res.ok) return; // keep last-known panel; the next tick retries
    const data = (await res.json()) as AtlasPanel;
    if (data && typeof data === 'object') {
      currentPanel = data;
      emit();
    }
  } catch {
    /* read-only: a transient failure keeps the last-known panel */
  }
}

/** Fetch immediately (used by the SSE-tick refetch). Exported so tests/other triggers can force a refresh. */
export function refreshAtlasState(): void {
  void fetchOnce();
}

function tick(): void {
  if (typeof document !== 'undefined' && document.hidden) return; // pause while backgrounded
  void fetchOnce();
}

function onVisibility(): void {
  if (typeof document !== 'undefined' && !document.hidden) void fetchOnce(); // resume → refetch now
}

function startLoop(): void {
  if (intervalId !== null) return;
  void fetchOnce(); // seed immediately, don't wait a full interval
  intervalId = setInterval(tick, ATLAS_POLL_MS);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
}

function stopLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
}

/**
 * Subscribe to the shared Atlas poller. Every consumer that calls this hook shares one fetch loop; the
 * loop starts with the first subscriber and stops with the last. Also refetches on each `/events` tick.
 */
export function useAtlasState(): AtlasStateResult {
  const [panel, setPanel] = useState<AtlasPanel | null>(currentPanel);
  const { count } = useSse('/events');

  useEffect(() => {
    const listener = (): void => setPanel(currentPanel);
    listeners.add(listener);
    subscriberCount += 1;
    if (subscriberCount === 1) startLoop();
    setPanel(currentPanel); // sync any panel fetched before this mount
    return () => {
      listeners.delete(listener);
      subscriberCount -= 1;
      if (subscriberCount === 0) stopLoop();
    };
  }, []);

  // The filesystem-derived parts (history + cards) change on fleet activity — refetch on the SSE tick.
  useEffect(() => {
    if (count > 0) refreshAtlasState();
  }, [count]);

  const worker = useMemo(() => deriveWorker(panel?.worker), [panel]);

  return {
    panel,
    worker,
    history: panel?.history ?? [],
    cards: panel?.cards ?? [],
    loading: panel === null,
  };
}

// P4 section 3.3: the Inbox source snapshot cache and the GLOBAL `gh` subprocess budget.
//
// [P4-C34] The budget is server-wide, not per session: at most ONE `gh` subprocess per
// `PR_REFRESH_BUDGET_MS` across every caller, and the 60 s background poll draws on the same budget
// (it is the only periodic caller). Two concurrent sessions therefore join one in-flight read, and a
// read inside the window spawns nothing and returns the cached projection with `stale: true`
// [P4-C26]. This module owns no subprocess of its own (the reader is injected) and no route.
//
// COMPOSITION RULE, structural rather than conventional: the budget and the snapshots are
// MODULE-LEVEL state, not instance fields. `InboxSourceCache` is a facade over that one record, so
// even a caller that ignores `getInboxSourceCache()` and constructs its own instance cannot spend a
// second slot in the same window -- there is exactly one `lastSpawnAt` per process, and the unit
// test proves it with two independently constructed caches. `getInboxSourceCache()` is additionally
// the intended accessor: it returns the SAME instance every time and throws on a second call
// carrying different options. `resetInboxSourceCacheForTests()` is the only escape hatch.
//
// STALENESS: a cached read inside the window returns the last VERIFIED source state carrying the
// additive `stale: true` marker of W0's contract, so the projection is honest about its age. W6.1
// surfaces that marker at the route so the UI never claims freshness it does not have.
import type { EscalationSubject, PrSubject, SourceState } from './contracts.ts';
import { PR_REFRESH_BUDGET_MS } from './contracts.ts';

/** A source read: the last-good items plus the state that describes how the read went. */
export interface PrRead {
  readonly items: readonly PrSubject[];
  readonly state: SourceState;
}
export interface EscalationRead {
  readonly items: readonly EscalationSubject[];
  readonly state: SourceState;
}

/** The injected read. Production supplies `readOpenPullRequests` bound to the pin and a real port. */
export type PrReader = () => Promise<PrRead>;

export interface PrReadOutcome extends PrRead {
  /** True when this outcome was served from cache rather than a fresh read of the source. */
  readonly stale: boolean;
}

export interface SourceCacheOptions {
  readonly now: () => number;
  /** Present only so the suite can shorten the window; production keeps the pinned budget. */
  readonly budgetMs?: number;
}

/** No last-good data yet: an explicit failed row, never a false empty state (section 3.3). */
const NO_DATA: SourceState = { status: 'failed', errorCode: 'unavailable', stale: false };

/**
 * A reader that REJECTS becomes this per-source failure. The joined promise must never reject:
 * session A's transient `gh` error may not tear down session B's whole Inbox read, and it may not
 * touch the escalation source at all. The rejection value is discarded unread (no stderr leakage).
 */
const UNAVAILABLE_READ: PrRead = { items: [], state: { status: 'failed', errorCode: 'unavailable', stale: false } };

/** Mark a source state stale by switching on `status`; the union is never crossed with a cast. */
function markStale(state: SourceState): SourceState {
  if (state.status === 'verified') return { status: 'verified', revision: state.revision, verifiedAt: state.verifiedAt, stale: true };
  return { ...state, stale: true };
}

interface ProcessState {
  cachedPr: PrRead;
  cachedEscalation: EscalationRead;
  lastSpawnAt: number | null;
  inFlight: Promise<PrRead> | null;
  invalidated: boolean;
}

function emptyState(): ProcessState {
  return {
    cachedPr: { items: [], state: NO_DATA },
    cachedEscalation: { items: [], state: NO_DATA },
    lastSpawnAt: null,
    inFlight: null,
    invalidated: false,
  };
}

/** THE budget. One record per process; every `InboxSourceCache` is a view onto it. */
let state: ProcessState = emptyState();

export class InboxSourceCache {
  private readonly now: () => number;
  private readonly budgetMs: number;

  constructor(options: SourceCacheOptions) {
    this.now = options.now;
    this.budgetMs = options.budgetMs ?? PR_REFRESH_BUDGET_MS;
  }

  /** The escalation source is store-driven, so it carries no subprocess budget. */
  putEscalation(read: EscalationRead): void {
    if (read.state.status === 'verified' || state.cachedEscalation.items.length === 0) {
      state.cachedEscalation = read;
      return;
    }
    // Failure with last-good escalation items: keep the items, mark the state stale.
    state.cachedEscalation = { items: state.cachedEscalation.items, state: markStale(read.state) };
  }

  peekEscalation(): EscalationRead {
    return state.cachedEscalation;
  }

  /**
   * Invalidate on a publisher receipt, a card-store event, a run terminal event, or a Plane-A STOP
   * change. It marks the snapshot stale; it never buys an extra subprocess, because the global
   * budget is the hard wall [P4-C34].
   */
  invalidatePr(): void {
    state.invalidated = true;
  }

  /** False once the snapshot is invalidated or failed: a refetch is owed at the next window edge. */
  isPrFresh(): boolean {
    return state.cachedPr.state.status === 'verified' && !state.invalidated;
  }

  async readPr(reader: PrReader): Promise<PrReadOutcome> {
    const joined = state.inFlight;
    if (joined !== null) {
      // `inFlight` is already failure-wrapped below, so joining can never reject.
      const read = await joined;
      return { ...read, stale: read.state.status !== 'verified' };
    }
    if (state.lastSpawnAt !== null && this.now() - state.lastSpawnAt < this.budgetMs) {
      // In-window cached read: verified data, older than this request.
      return { ...state.cachedPr, state: markStale(state.cachedPr.state), stale: true };
    }

    state.lastSpawnAt = this.now();
    // Wrapped HERE, not at the await: every joiner shares this one already-safe promise.
    const pending = reader().then((read) => read, () => UNAVAILABLE_READ);
    state.inFlight = pending;
    let read: PrRead;
    try {
      read = await pending;
    } finally {
      state.inFlight = null;
    }

    if (read.state.status === 'verified') {
      state.cachedPr = read;
      state.invalidated = false;
    } else if (state.cachedPr.items.length > 0) {
      // Source failure with last-good data: keep the items, mark the source stale.
      state.cachedPr = { items: state.cachedPr.items, state: markStale(read.state) };
    } else {
      state.cachedPr = read;
    }
    return { ...state.cachedPr, stale: state.cachedPr.state.status !== 'verified' };
  }
}

let singleton: InboxSourceCache | null = null;
let singletonOptions: SourceCacheOptions | null = null;

export class InboxSourceCacheConflictError extends Error {
  constructor() {
    super('the Inbox source cache is a process singleton: a second construction would fork the budget');
    this.name = 'InboxSourceCacheConflictError';
  }
}

/**
 * The intended accessor. The first call constructs the cache; every later call returns the SAME
 * instance, and a call carrying different options throws rather than silently handing back a cache
 * that does not obey the caller's clock.
 */
export function getInboxSourceCache(options: SourceCacheOptions): InboxSourceCache {
  if (singleton !== null) {
    const same = singletonOptions !== null
      && singletonOptions.now === options.now && singletonOptions.budgetMs === options.budgetMs;
    if (!same) throw new InboxSourceCacheConflictError();
    return singleton;
  }
  singleton = new InboxSourceCache(options);
  singletonOptions = options;
  return singleton;
}

/** Test-only: drop the process budget and snapshots so each test owns a clean window. */
export function resetInboxSourceCacheForTests(): void {
  state = emptyState();
  singleton = null;
  singletonOptions = null;
}

/**
 * Wave A — the queue -> governed-engine bridge (T3: discovery + inverse filter predicate; NO dispatch).
 *
 * The bridge is the counterpart of the legacy `scripts/agent_runner.ps1` runner. Each executor claims a
 * disjoint slice of the queue, arbitrated by ONE frontmatter flag, `execution-controller`:
 *   - legacy runner claims iff `execution-controller != "dashboard"` (absent/null included) — ps1 step 6;
 *   - this bridge claims iff `execution-controller === "dashboard"` (the exact literal) AND
 *     `owner === <dashboard subject>` AND `state ∈ {inbox, working}`.
 * The two predicates partition the owner/state-matched card space with no overlap and no gap — that is
 * the double-execution guard. `bridgeClaimsCard` is the authoritative TS statement of the bridge side;
 * `scripts/queue_bridge_select.py#claims_card` is its Python mirror (unit-tested for parity on both
 * sides). Keeping the controller test an EXACT string equality — never a truthiness or "not legacy"
 * test — is what makes the partition hold.
 *
 * This module (T3) only DISCOVERS owned cards and gates a poll tick on the shared preamble (STOP file +
 * budget, via `assertFleetRunnable`, D7 — never re-implemented in TS). Mapping a card to a run and
 * driving the launch machinery is T4/T5, injected through `dispatch`.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with explicit `.ts` specifiers.
 */
import { defaultPyRunner, type PyRunner } from '../write/launch.ts';
import { assertFleetRunnable, type PreambleRunner } from '../write/preambleGate.ts';
import { DASHBOARD_EXECUTOR_SUBJECT } from './activation.ts';

export class QueueBridgeError extends Error {}

/** The claim-relevant slice of a card's parsed frontmatter. Only these three fields decide ownership. */
export interface CardClaimMeta {
  'execution-controller'?: string | null;
  owner?: string | null;
  state?: string | null;
}

/** The literal controller value that routes a card to the dashboard engine. */
export const DASHBOARD_CONTROLLER = 'dashboard';
/** The only two states a card can be claimed in — matches the legacy runner's inbox|working scan. */
export const CLAIMABLE_STATES: readonly string[] = ['inbox', 'working'];

/**
 * The bridge side of the double-execution guard: true iff the dashboard engine (not the legacy runner)
 * owns this card. The exact inverse, on the `execution-controller` axis, of `agent_runner.ps1` step 6.
 * `subject` defaults to the single dashboard executor identity (D1); T4 re-asserts this on the full card
 * meta read at dispatch time, so a card the Python selector returned is never dispatched on stale state.
 */
export function bridgeClaimsCard(meta: CardClaimMeta, subject: string = DASHBOARD_EXECUTOR_SUBJECT): boolean {
  return meta['execution-controller'] === DASHBOARD_CONTROLLER
    && meta.owner === subject
    && typeof meta.state === 'string'
    && CLAIMABLE_STATES.includes(meta.state);
}

/** One discovered, bridge-owned card. `path` is repo-relative (as emitted by the Python selector). */
export interface OwnedCard {
  id: string;
  path: string;
  state: string;
}

/**
 * The embedded-python invocation (CANONICAL_RESULT_*_SCRIPT discipline): a fixed, non-interpolated script
 * whose ONLY input, the JSON op, arrives as `sys.argv[1]`. It defers all parsing/filtering to the
 * committed `scripts/queue_bridge_select.py` module (so `cards.parse` semantics are identical to the
 * legacy runner and the same code is exercised by `tests/test_queue_bridge_select.py`).
 */
export const QUEUE_BRIDGE_SELECT_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import queue_bridge_select
op = json.loads(sys.argv[1])
print(json.dumps(queue_bridge_select.select_owned_dashboard_cards(Path(op.get("queueRoot", "queue")), op["subject"])))
`.trim();

export interface ScanDeps {
  repoRoot: string;
  runPy?: PyRunner;
}

export interface ScanOptions {
  subject?: string;
  /** Overrides the default `queue` root (repo-relative), for tests/fixtures. */
  queueRoot?: string;
}

/**
 * Enumerate `queue/inbox` + `queue/working` under the ops repo and return the bridge-owned cards, via the
 * Python selector for parse-parity with `cards.py`. Fail-closed: a non-zero selector exit or unparseable
 * JSON throws (the poller catches and reports) rather than silently returning an empty claim set.
 */
export function scanOwnedDashboardCards(deps: ScanDeps, options: ScanOptions = {}): OwnedCard[] {
  const runPy = deps.runPy ?? defaultPyRunner;
  const subject = options.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const op: Record<string, string> = { subject };
  if (options.queueRoot !== undefined) op.queueRoot = options.queueRoot;

  const result = runPy(deps.repoRoot, QUEUE_BRIDGE_SELECT_SCRIPT, JSON.stringify(op));
  if (result.exitCode !== 0) {
    throw new QueueBridgeError(
      `queue selector exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || '(no output)'}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim() || '[]');
  } catch (err) {
    throw new QueueBridgeError(`queue selector produced unparseable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) throw new QueueBridgeError('queue selector did not return a JSON array');
  return parsed.map((row) => {
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.path !== 'string' || typeof r.state !== 'string') {
      throw new QueueBridgeError('queue selector row missing id/path/state');
    }
    return { id: r.id, path: r.path, state: r.state };
  });
}

export interface QueueBridgeOptions {
  repoRoot: string;
  subject?: string;
  runPy?: PyRunner;
  runPreamble?: PreambleRunner;
  queueRoot?: string;
  /**
   * Dispatch one owned card. T3 default: a no-op (discovery only). T4/T5 supply the real drive
   * (card -> workflow request -> `executeApprovedLaunch` -> fleet ledger). Awaited per card so a slow
   * dispatch cannot overlap the next.
   */
  dispatch?: (card: OwnedCard) => Promise<void>;
  /** Surfaces a tick error without crashing the interval (default: swallow). */
  onError?: (err: unknown) => void;
}

export interface QueueBridgeTickResult {
  /** false when a prior tick was still in flight (single-flight guard skipped this one). */
  ran: boolean;
  /** true when the preamble/STOP/budget gate refused — nothing was scanned or dispatched. */
  blocked: boolean;
  discovered: number;
  dispatched: number;
}

export interface QueueBridge {
  /** Run one poll cycle: preamble gate -> scan -> dispatch each owned card. Single-flight. */
  tick(): Promise<QueueBridgeTickResult>;
  /** Begin polling every `intervalMs`. Idempotent; the interval is unref'd so it never holds the loop open. */
  start(intervalMs: number): void;
  stop(): void;
}

const NOOP_DISPATCH = async (_card: OwnedCard): Promise<void> => {};

/**
 * Create the bridge poller. The tick gates on `assertFleetRunnable` (the sanctioned preamble seam, D7)
 * BEFORE any scan or dispatch, so a present STOP file or blown budget halts the bridge exactly as it
 * halts every other governed writer. A single-flight guard prevents overlapping ticks.
 */
export function createQueueBridge(options: QueueBridgeOptions): QueueBridge {
  const subject = options.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const dispatch = options.dispatch ?? NOOP_DISPATCH;
  const onError = options.onError ?? (() => {});
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<QueueBridgeTickResult> {
    if (running) return { ran: false, blocked: false, discovered: 0, dispatched: 0 };
    running = true;
    try {
      // D7: STOP file + budget gate via the shared preamble — never re-implemented here.
      const preamble = assertFleetRunnable(options.repoRoot, options.runPreamble);
      if (!preamble.ok) return { ran: true, blocked: true, discovered: 0, dispatched: 0 };

      const owned = scanOwnedDashboardCards(
        { repoRoot: options.repoRoot, runPy: options.runPy },
        { subject, queueRoot: options.queueRoot },
      );
      let dispatched = 0;
      for (const card of owned) {
        await dispatch(card);
        dispatched += 1;
      }
      return { ran: true, blocked: false, discovered: owned.length, dispatched };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(intervalMs) {
      if (timer !== null) return;
      timer = setInterval(() => { void tick().catch(onError); }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    },
  };
}

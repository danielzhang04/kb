/**
 * D3.3 — the Broker daemon: a long-lived, PM2-supervised, dispatcher-side SESSION OWNER.
 *
 * ┌─ WHAT THIS IS ───────────────────────────────────────────────────────────────────────────────┐
 * │ The Broker owns Claude Agent SDK streaming sessions for the fleet. When it spawns a worker it   │
 * │ holds that worker's live CONTROL HANDLE (interrupt / signal / steer) in an in-process handle    │
 * │ table, so the dashboard can list/inspect/stop/steer/rerun a running turn WITHOUT the worker     │
 * │ having to poll a file. It is its OWN human-reviewed security line (plan §D3.3, ordering-law 7): │
 * │ an unauthenticated control socket would grant genuinely new lateral-movement capability         │
 * │ (injecting into a sibling agent's in-flight turn), so `broker/socket.ts` authenticates every    │
 * │ connection by peer-credential AND a per-boot token, and every graceful verb is confined to      │
 * │ Broker-spawned handles.                                                                          │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * CREDENTIAL RULE (hard ceiling, CLAUDE.md "Autonomy"): the Broker reads `CLAUDE_CODE_OAUTH_TOKEN`
 * from ITS OWN runtime environment (a human provisions it; this code NEVER creates, prints, copies,
 * persists, or transmits it). It is used as an ambient runtime credential only — passed to the SDK
 * spawner via the inherited environment, never written to a handle, a log, a session summary, or disk.
 * `ANTHROPIC_API_KEY` being set is refused at the preamble gate (subscription-billing only).
 *
 * SPAWN PATH (`spawnSession`):
 *   1. `assertFleetRunnable()` FIRST (broker/preambleGate.ts, ordering-law 8) — a frozen / API-keyed /
 *      budget-breached fleet refuses to START new work here, before any child/session exists.
 *   2. If an OAuth token is present AND an SDK spawner is available → SDK streaming session
 *      (kind `broker-sdk`). Otherwise DEGRADE to the first-class CLI-subprocess fallback
 *      (broker/fallback.ts, kind `broker-cli`). "SDK/OAuth unavailable" = no token, no SDK spawner, or
 *      the SDK spawner throwing on construction.
 *   3. Register the returned handle in the table, keyed by session id.
 */
import { randomUUID } from 'node:crypto';
import { assertFleetRunnable, defaultPreambleRunner } from './preambleGate.ts';
import type { PreambleRunner } from './preambleGate.ts';
import { defaultCliSessionSpawner } from './fallback.ts';

export type RiskTier = 'T1' | 'T2' | 'T3';

/**
 * How a session came to exist. `broker-*` sessions carry a live control handle (graceful verbs apply);
 * `external-*` sessions were started OUTSIDE the Broker (a human TTY, a `claude -p` one-shot, a
 * scheduled Routine) — the Broker may only KILL them, never inject/steer (see `broker/verbs.ts`).
 */
export type SessionKind =
  | 'broker-sdk'
  | 'broker-cli'
  | 'external-tty'
  | 'external-print'
  | 'external-routine';

/** The card fields a running session is bound to. Mirrors `challenge.ts`'s canonical field names EXACTLY
 *  (`risk-tier`, not `riskTier`) so `broker/verbs.ts` can hash a proposed post-steer card with the SAME
 *  content-hash preimage the dashboard approval channel binds. */
export interface SessionCard {
  action: string;
  target: string;
  'risk-tier': RiskTier;
  owner: string | null;
  /** The `## Work order` body — bound into the content hash alongside the four frontmatter fields. */
  workOrderBody: string;
}

/**
 * A live control handle onto one session. For a `broker-sdk` session these map to the SDK's own control
 * primitives; for a `broker-cli` fallback session they map to process signals (documented in
 * broker/fallback.ts). `live` is flipped to `false` by the spawner when the underlying session exits.
 */
export interface SessionHandle {
  readonly id: string;
  readonly kind: SessionKind;
  readonly cardId?: string;
  /** The bound card (for graceful verbs / steer re-approval hashing). Absent for external sessions. */
  readonly card?: SessionCard;
  readonly createdAt: number;
  /** Whether the session is still running. Read by `stopWatch`/verbs to stop escalating a dead handle. */
  live: boolean;
  /** Graceful turn interrupt (SDK `interrupt()`; CLI fallback maps this to a soft signal). */
  interrupt(): void;
  /** Escalation rung 2 — SIGTERM the session's process (group). */
  sigterm(): void;
  /** Escalation rung 3 — SIGKILL the session's process (group). */
  sigkill(): void;
  /** Inject steering guidance into the live turn (SDK stream; CLI fallback stdin stream-json). */
  steer(text: string): void;
}

/** What `spawnSession` needs to file a new session. `card` binds the session to a card for verbs. */
export interface SpawnSpec {
  cardId?: string;
  card?: SessionCard;
  /** argv-safe prompt/goal; written to the session's input stream, never to argv (fallback mirrors vibe). */
  prompt: string;
}

/** Constructs a live SDK/CLI session and returns its control handle. Injected for hermetic tests. */
export type SessionSpawner = (spec: SpawnSpec, ctx: SpawnerContext) => SessionHandle;

/** Context handed to a spawner: the resolved session id, repo root, and (SDK only) the ambient OAuth
 *  token — passed by REFERENCE for the spawner to hand to the SDK's env, NEVER logged or stored. */
export interface SpawnerContext {
  sessionId: string;
  repoRoot: string;
  oauthToken?: string;
}

/** Injectable dependencies for the session owner. Every field is hermetic-test-safe. */
export interface OwnerDeps {
  repoRoot: string;
  runPreamble?: PreambleRunner;
  /**
   * The ambient OAuth token. Defaults to `process.env.CLAUDE_CODE_OAUTH_TOKEN` (read once, never
   * persisted). Its PRESENCE gates the SDK path; its VALUE is only ever handed to `sdkSpawner`.
   */
  oauthToken?: string;
  /** SDK streaming-session spawner. Absent/throwing → the CLI fallback is used (first-class degrade). */
  sdkSpawner?: SessionSpawner;
  /** CLI-subprocess fallback spawner. Defaults to `defaultCliSessionSpawner` (broker/fallback.ts). */
  cliSpawner?: SessionSpawner;
  /** Injectable id generator (default `randomUUID`) and clock (default `Date.now`) for deterministic tests. */
  idGen?: () => string;
  now?: () => number;
}

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  cardId?: string;
  createdAt: number;
  live: boolean;
  brokerSpawned: boolean;
}

export type SpawnOutcome =
  | { ok: true; handle: SessionHandle; via: 'sdk' | 'cli' }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'no-runtime'; detail: string };

/** True iff this session was spawned BY the Broker (holds a real control handle) — the boundary every
 *  graceful verb checks. `external-*` sessions are kill-only. */
export function isBrokerSpawned(handle: Pick<SessionHandle, 'kind'>): boolean {
  return handle.kind === 'broker-sdk' || handle.kind === 'broker-cli';
}

/**
 * The Broker's session owner: the handle table plus the preamble-gated `spawnSession` path. One
 * instance per daemon boot; `broker/socket.ts` fronts it with auth, `broker/verbs.ts` operates on it,
 * `broker/stopWatch.ts` drains its live handles on STOP.
 */
export class SessionOwner {
  private readonly handles = new Map<string, SessionHandle>();
  private readonly deps: OwnerDeps;

  constructor(deps: OwnerDeps) {
    this.deps = deps;
  }

  /**
   * Spawn (or refuse to spawn) one fleet worker as a Broker-owned session.
   *
   * `assertFleetRunnable()` runs FIRST (ordering-law 8) — nothing downstream is evaluated and no
   * session is constructed if the fleet is frozen. Only past the gate is a runtime chosen: SDK when an
   * OAuth token AND SDK spawner are present and the spawner constructs cleanly; otherwise the CLI
   * fallback. The resulting handle is registered in the table.
   */
  spawnSession(spec: SpawnSpec): SpawnOutcome {
    const runnable = assertFleetRunnable(this.deps.repoRoot, this.deps.runPreamble ?? defaultPreambleRunner);
    if (!runnable.ok) {
      return { ok: false, reason: 'fleet-frozen', problems: runnable.problems };
    }

    const sessionId = (this.deps.idGen ?? randomUUID)();
    const ctx: SpawnerContext = {
      sessionId,
      repoRoot: this.deps.repoRoot,
      oauthToken: this.deps.oauthToken ?? process.env.CLAUDE_CODE_OAUTH_TOKEN,
    };

    let handle: SessionHandle | undefined;
    let via: 'sdk' | 'cli' | undefined;

    // SDK path requires BOTH an ambient OAuth token and an SDK spawner. A spawner that throws on
    // construction (SDK package missing, OAuth handshake unavailable) is treated as "SDK unavailable"
    // and we degrade — the CLI fallback is first-class, not an error path.
    if (ctx.oauthToken && this.deps.sdkSpawner) {
      try {
        handle = this.deps.sdkSpawner(spec, ctx);
        via = 'sdk';
      } catch {
        handle = undefined;
      }
    }

    if (!handle) {
      const cli = this.deps.cliSpawner ?? defaultCliSessionSpawner;
      try {
        handle = cli(spec, ctx);
        via = 'cli';
      } catch (err) {
        return { ok: false, reason: 'no-runtime', detail: `no session runtime available: ${(err as Error).message}` };
      }
    }

    this.handles.set(handle.id, handle);
    return { ok: true, handle, via: via as 'sdk' | 'cli' };
  }

  /** Register an EXTERNAL session (TTY / `-p` / Routine) the Broker discovered but did not spawn — so it
   *  appears in `list` and can be KILLED, but graceful verbs refuse it. */
  registerExternal(handle: SessionHandle): void {
    this.handles.set(handle.id, handle);
  }

  get(id: string): SessionHandle | undefined {
    return this.handles.get(id);
  }

  /** Every live handle — what `stopWatch` drains on STOP. */
  liveHandles(): SessionHandle[] {
    return [...this.handles.values()].filter((h) => h.live);
  }

  /** Token-free summaries only — never surfaces the OAuth token or any prompt content. */
  list(): SessionSummary[] {
    return [...this.handles.values()].map((h) => ({
      id: h.id,
      kind: h.kind,
      cardId: h.cardId,
      createdAt: h.createdAt,
      live: h.live,
      brokerSpawned: isBrokerSpawned(h),
    }));
  }

  /** Drop a handle from the table (after it has exited/been reaped). */
  forget(id: string): void {
    this.handles.delete(id);
  }
}

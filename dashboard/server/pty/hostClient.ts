/**
 * D3.2 — the dashboard daemon's PTY open path: `openPty`.
 *
 * SECURITY ARCHITECTURE (the whole point of this design). The dashboard daemon runs as Daniel. It
 * NEVER spawns a process as another user and NEVER holds any account credential. It cannot open a
 * terminal by itself. Instead a SEPARATE, pre-authenticated PTY-HOST process — later registered by
 * the D3.1 human gate as a Windows scheduled task running under a constrained fleet account — is
 * SIGNALLED over an authenticated local channel (a named pipe with a peer-credential check plus a
 * per-boot token). The daemon sends only an authenticated open-REQUEST; the host is what actually
 * spawns `node-pty` (see `host.ts`). So `openPty` here contains, and can contain, NO
 * `CreateProcessAsUser`/`runas` call and passes NO password/token-as-credential argument anywhere —
 * that is asserted by the test suite, not merely intended.
 *
 * Gate order, enforced before a single byte is ever signalled to the host (mirrors
 * `server/write/launch.ts` and `server/vibe/session.ts` exactly — do NOT reorder):
 *   1. **Preamble gate FIRST** — `assertFleetRunnable()` (D2.6, imported verbatim, never
 *      reimplemented; ordering law 8: no fleet work under STOP). A STOP-frozen fleet, a set
 *      `ANTHROPIC_API_KEY`, or a breached budget all refuse identically, and NOTHING downstream (the
 *      session check, the transport, the host) is even evaluated — the host is never contacted.
 *   2. **WebAuthn session gate** — `verifySession()` (D2.1, imported verbatim). Fail-closed: a
 *      missing / malformed / expired / bad-signature token is rejected with a 401 before any signal.
 *      (These interfaces are fail-closed until the D2.12 passkey gate closes; this builds against the
 *      interface — a real fresh session is required to get past here.)
 *   3. **Signal the host** over the injectable authenticated transport (named pipe + per-boot token).
 *
 * Every call — refused at gate 1, refused at gate 2, or actually opened — writes EXACTLY ONE audit
 * row via `appendAudit()` (D2.9, imported verbatim from `server/audit/log.ts`). The transport, the
 * preamble runner, and `appendAudit` are all injectable (same DI shape/rationale as
 * `OpsGitRunner`/`VibeSpawner`) so the whole suite is hermetic: no real pipe, STOP file, passkey, or
 * `ledgers/audit/**` write is ever touched by a test.
 */
import { randomUUID } from 'node:crypto';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow, OpsGitRunner } from '../audit/log.ts';

/** The bearer session token plus the config needed to verify it (mirrors `write/launch.ts`'s shape). */
export interface SessionInput {
  token: string | null | undefined;
  config: SessionConfig;
}

/**
 * Authentication material for the local daemon→host channel. The `bootToken` is a per-BOOT secret
 * that proves this daemon instance may signal the host; the host ALSO does an OS peer-credential
 * check on the pipe. This is CHANNEL authentication — it is NOT, and must never be confused with, an
 * account credential: it grants no ability to log in as, or spawn a process as, the fleet account.
 */
export interface HostChannelAuth {
  /** Named-pipe path, e.g. `\\.\pipe\kb-pty-host`. */
  pipePath: string;
  /** Per-boot channel token (NOT an account credential). */
  bootToken: string;
}

/**
 * The authenticated open-REQUEST the daemon sends the host. Deliberately carries ONLY terminal
 * geometry, a working directory, a correlation id, and the verified session subject (for the host's
 * own audit correlation). It carries NO password, NO account token, and NO spawn-as-user directive —
 * the host decides what identity it runs `node-pty` under (it already IS the fleet account).
 */
export interface OpenPtyRequest {
  type: 'open-pty';
  /** Correlation id tying this request to the audit row and the host-side session. */
  requestId: string;
  cols: number;
  rows: number;
  /** Working directory for the spawned shell (the repo root by default). */
  cwd: string;
  /** The VERIFIED WebAuthn session subject — audit correlation only, never a credential. */
  sessionSubject: string;
}

/** The host's acknowledgement of a successful open: the id of the spawned PTY session. */
export interface OpenPtyAck {
  sessionId: string;
}

/** A live connection to the host for one PTY session. IO is proxied through here to the browser WS. */
export interface HostConnection {
  /** Send the authenticated open-request; the host spawns `node-pty` and returns its session id. */
  requestOpen(req: OpenPtyRequest): OpenPtyAck;
  onData(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Scoped stop from the daemon side — closes the channel; the host kills the PTY process group. */
  close(): void;
}

/**
 * Connects to the PTY host over the authenticated local channel. Injected for hermetic tests — the
 * real default (a named-pipe client) is wired at the D3.1 go-live gate, not here, because a live host
 * process does not exist until that human gate registers the scheduled task under the fleet account.
 */
export type HostTransport = (auth: HostChannelAuth) => HostConnection;

/**
 * The default transport is intentionally fail-closed and NOT yet a live named-pipe client: no PTY
 * host exists to talk to until the D3.1 human gate registers it as a scheduled task under the
 * constrained fleet account. Wiring the real `\\.\pipe` client is that gate's job; until then the
 * daemon refuses to fabricate a connection. Tests always inject a fake transport, so this default is
 * never exercised by the suite.
 */
export const defaultHostTransport: HostTransport = () => {
  throw new Error(
    'PTY host transport is not wired: the pre-authenticated fleet-account host is registered at the ' +
      'D3.1 human gate (scheduled task). Refusing to signal a non-existent host (fail-closed).',
  );
};

/** Everything `openPty` needs, all hermetic-test-safe. */
export interface OpenPtyDeps {
  repoRoot: string;
  /** Channel auth for the daemon→host pipe. Defaults to the env-resolved values. */
  channelAuth?: HostChannelAuth;
  transport?: HostTransport;
  runPreamble?: PreambleRunner;
  /** Terminal geometry for the initial spawn. */
  cols?: number;
  rows?: number;
  /** Same signature as the real `appendAudit` — inject a recording fake in tests. */
  appendAudit?: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow;
  runGit?: OpsGitRunner;
  now?: () => Date;
  /** Injectable id source (correlation id) — tests pin it for deterministic assertions. */
  requestId?: () => string;
}

export type OpenPtyOutcome =
  | { ok: true; sessionId: string; connection: HostConnection }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'unauthenticated'; status: 401; detail: string }
  | { ok: false; reason: 'host-unreachable'; detail: string };

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** Resolve the daemon→host channel auth from the environment. The per-boot token is generated fresh
 *  for this process when unset (never a fixed default) — same fail-safe-not-fail-open stance as the
 *  session secret in `auth/session.ts`. */
export function resolveChannelAuth(
  env: Record<string, string | undefined> = process.env,
): HostChannelAuth {
  const pipePath = env.DASHBOARD_PTY_HOST_PIPE?.trim() || '\\\\.\\pipe\\kb-pty-host';
  const bootToken = env.DASHBOARD_PTY_HOST_TOKEN?.trim() || randomUUID();
  return { pipePath, bootToken };
}

/**
 * Open a PTY by SIGNALLING the pre-authenticated fleet-identity host — never by spawning anything as
 * another user. See the module docstring for the gate order (preamble first, then WebAuthn session,
 * then the host signal) and the exactly-one-audit-row invariant.
 */
export function openPty(session: SessionInput, deps: OpenPtyDeps): OpenPtyOutcome {
  const appendAuditFn = deps.appendAudit ?? defaultAppendAudit;
  const requestId = (deps.requestId ?? randomUUID)();

  function audited(outcome: OpenPtyOutcome, owner?: string): OpenPtyOutcome {
    const detail: Record<string, unknown> = { requestId, cols: deps.cols ?? DEFAULT_COLS, rows: deps.rows ?? DEFAULT_ROWS };
    if (!outcome.ok && 'problems' in outcome) detail.problems = outcome.problems;
    if (!outcome.ok && 'detail' in outcome) detail.refusalDetail = outcome.detail;
    appendAuditFn(
      deps.repoRoot,
      {
        action: 'pty-open',
        owner,
        result: outcome.ok ? 'opened' : outcome.reason,
        detail,
      },
      { runGit: deps.runGit, now: deps.now },
    );
    return outcome;
  }

  // 1. Preamble gate FIRST — a STOP-frozen / API-keyed / budget-breached fleet refuses regardless of
  //    who is asking. The host is NEVER contacted on a preamble failure (ordering law 8).
  const preamble = assertFleetRunnable(deps.repoRoot, deps.runPreamble ?? defaultPreambleRunner);
  if (!preamble.ok) {
    return audited({ ok: false, reason: 'fleet-frozen', problems: preamble.problems });
  }

  // 2. WebAuthn session gate — fail-closed 401. Checked only after the preamble passes.
  if (!session.token) {
    return audited({ ok: false, reason: 'unauthenticated', status: 401, detail: 'no WebAuthn session token supplied' });
  }
  const check = verifySession(session.token, session.config);
  if (!check.ok) {
    return audited({ ok: false, reason: 'unauthenticated', status: 401, detail: check.reason });
  }
  const owner = check.claims.sub;

  // 3. Signal the host over the authenticated local channel. The daemon ONLY sends an open-request —
  //    it never spawns a process as a user and passes no credential as an argument.
  const auth = deps.channelAuth ?? resolveChannelAuth();
  const transport = deps.transport ?? defaultHostTransport;
  let connection: HostConnection;
  try {
    connection = transport(auth);
  } catch (err) {
    return audited({ ok: false, reason: 'host-unreachable', detail: (err as Error).message }, owner);
  }

  let ack: OpenPtyAck;
  try {
    ack = connection.requestOpen({
      type: 'open-pty',
      requestId,
      cols: deps.cols ?? DEFAULT_COLS,
      rows: deps.rows ?? DEFAULT_ROWS,
      cwd: deps.repoRoot,
      sessionSubject: owner,
    });
  } catch (err) {
    try {
      connection.close();
    } catch {
      /* best-effort teardown of a half-open channel */
    }
    return audited({ ok: false, reason: 'host-unreachable', detail: (err as Error).message }, owner);
  }

  return audited({ ok: true, sessionId: ack.sessionId, connection }, owner);
}

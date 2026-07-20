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
import { readFileSync } from 'node:fs';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow, OpsGitRunner } from '../audit/log.ts';
import type { ControlFrame, InboundFrame, PtyAssertion, PtyClientChannel } from './ptyProtocol.ts';
import { bootTokenPath, readBootTokenFresh } from './rendezvousToken.ts';
import { DEFAULT_RENDEZVOUS_DIR } from './peerConfig.ts';
import { resolveFleetSid } from './fleetIdentity.ts';
import { loadWin32PtyApi } from './win32PtyApi.ts';

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

/**
 * Collects a hardware-passkey WebAuthn assertion over the host-issued `challenge` (D3.1 MED mitigation,
 * Factor C). In production this relays to the browser (`navigator.credentials.get` via the WS); in tests
 * it is a fake. MUST reject (throw / return a rejected promise) rather than return a bogus assertion if
 * the passkey ceremony fails — the daemon then fails the open closed.
 */
export type PtyAssertionProvider = (challenge: string) => Promise<PtyAssertion>;

/** A live connection to the host for one PTY session. IO is proxied through here to the browser WS. */
export interface HostConnection {
  /** Two-phase (D3.1): await the host's `challenge`, collect the passkey assertion via the injected
   *  provider, send the authenticated open-request carrying it; the host verifies Factor C, spawns
   *  `node-pty`, and returns its session id. Async because the assertion ceremony is interactive. */
  requestOpen(req: OpenPtyRequest): Promise<OpenPtyAck>;
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
export type HostTransport = (auth: HostChannelAuth, assertionProvider: PtyAssertionProvider) => HostConnection;

/** Bound the synchronous open handshake. In production the host is a SEPARATE process, so this blocking
 *  read does not stall its event loop; the bound guarantees `openPty` cannot hang if the host wedges. */
const OPEN_HANDSHAKE_TIMEOUT_MS = 15_000;

/** Bound the wait for the host's unsolicited `challenge` frame (phase 1 of the two-phase ceremony). */
const CHALLENGE_TIMEOUT_MS = 15_000;

/**
 * Adapt a connected, server-identity-verified `PtyClientChannel` into the `HostConnection` the daemon
 * consumes. `requestOpen` performs the SYNCHRONOUS open handshake (send `open` carrying the per-boot token
 * — Factor B — and block for the single `open-ack`); the peer/server SID checks (Factor A / anti-squat)
 * already happened at the transport layer BEFORE this channel existed. After a successful ack it wires the
 * persistent stream: `data` frames → `onData`, `exit` (or channel close) → `onExit`. Exported for hermetic
 * tests (a fake channel), so the multiplexing is proven without koffi.
 */
export function createHostConnection(
  channel: PtyClientChannel,
  bootToken: string,
  assertionProvider: PtyAssertionProvider,
): HostConnection {
  const dataCbs: Array<(chunk: string) => void> = [];
  const exitCbs: Array<(code: number | null) => void> = [];
  let streaming = false;
  let exited = false;

  const emitExit = (code: number | null): void => {
    if (exited) return;
    exited = true;
    for (const cb of exitCbs) {
      try {
        cb(code);
      } catch {
        /* a consumer callback must not break teardown */
      }
    }
  };

  const startStreaming = (): void => {
    if (streaming) return;
    streaming = true;
    channel.onFrame((frame: InboundFrame) => {
      if (frame.type === 'data' && typeof frame.data === 'string') {
        for (const cb of dataCbs) cb(frame.data);
      } else if (frame.type === 'exit') {
        emitExit(typeof frame.code === 'number' ? frame.code : null);
      }
    });
    channel.onClose(() => emitExit(null));
  };

  return {
    async requestOpen(req: OpenPtyRequest): Promise<OpenPtyAck> {
      // Phase 1 — receive the host's fresh per-connection `challenge` (issued on connect, before `open`).
      const challengeFrame = channel.receiveFrame(CHALLENGE_TIMEOUT_MS);
      if (!challengeFrame || challengeFrame.type !== 'challenge' || typeof challengeFrame.challenge !== 'string') {
        channel.close();
        throw new Error('PTY host did not issue a challenge (fail-closed)');
      }

      // Phase 2 — collect a hardware-passkey assertion over that exact challenge (Factor C). A ceremony
      // failure (declined / no touch / provider error) fails the open CLOSED — never a bogus assertion.
      let assertion: PtyAssertion;
      try {
        assertion = await assertionProvider(challengeFrame.challenge);
      } catch (err) {
        channel.close();
        throw new Error(`PTY passkey assertion ceremony failed: ${(err as Error).message} (fail-closed)`);
      }
      if (
        !assertion ||
        typeof assertion.credentialId !== 'string' ||
        typeof assertion.authenticatorData !== 'string' ||
        typeof assertion.clientDataJSON !== 'string' ||
        typeof assertion.signature !== 'string'
      ) {
        channel.close();
        throw new Error('PTY passkey assertion provider returned no/invalid assertion (fail-closed)');
      }

      // Phase 3 — send the authenticated open carrying the token (Factor B) + assertion (Factor C).
      const openFrame: ControlFrame = {
        type: 'open',
        token: bootToken,
        requestId: req.requestId,
        cols: req.cols,
        rows: req.rows,
        cwd: req.cwd,
        sessionSubject: req.sessionSubject,
        assertion,
      };
      const resp = channel.requestSync(openFrame, OPEN_HANDSHAKE_TIMEOUT_MS);
      if (!resp) {
        channel.close();
        throw new Error('PTY host open handshake timed out or the channel closed (fail-closed)');
      }
      if (resp.type === 'open-nack') {
        channel.close();
        throw new Error(`PTY host refused the open: ${typeof resp.error === 'string' ? resp.error : 'unknown'}`);
      }
      if (resp.type !== 'open-ack' || typeof resp.sessionId !== 'string') {
        channel.close();
        throw new Error('PTY host returned a malformed open response (fail-closed)');
      }
      startStreaming();
      return { sessionId: resp.sessionId };
    },
    onData(cb) {
      dataCbs.push(cb);
    },
    onExit(cb) {
      exitCbs.push(cb);
    },
    write(data) {
      channel.sendFrame({ type: 'write', data });
    },
    resize(cols, rows) {
      channel.sendFrame({ type: 'resize', cols, rows });
    },
    close() {
      try {
        channel.sendFrame({ type: 'stop' });
      } catch {
        /* best-effort — the channel may already be broken */
      }
      channel.close();
    },
  };
}

/**
 * The REAL default transport (D3.1f): a native named-pipe client. Order is load-bearing —
 *   1. refuse on a non-win32 platform or a missing `boot.token` (fail closed, no host contacted);
 *   2. connect the pipe and verify the SERVER's SID == kb-fleet BEFORE presenting a single byte of the
 *      token (mutual auth / anti-squat — a squatter pipe owned by another user cannot harvest the token;
 *      design Point 4). A connect failure or an identity mismatch → `host-unreachable`.
 * Only after the server identity is confirmed is the per-boot token sent (inside `requestOpen`). Tests
 * inject a fake transport, so this native path is exercised only on a real box.
 */
export const defaultHostTransport: HostTransport = (auth, assertionProvider) => {
  if (process.platform !== 'win32') {
    throw new Error('PTY host transport is win32-only; there is no host to signal on this platform (fail-closed)');
  }
  if (!auth.bootToken) {
    throw new Error('boot.token missing/unreadable at the rendezvous path — refusing to signal the host (fail-closed)');
  }
  const expectedServerSid = resolveFleetSid();
  const channel = loadWin32PtyApi().connectAndVerifyServer(auth.pipePath, expectedServerSid);
  if (!channel) {
    throw new Error(
      'PTY host pipe unreachable, or the pipe server identity is not kb-fleet (anti-squat); fail-closed',
    );
  }
  return createHostConnection(channel, auth.bootToken, assertionProvider);
};

/** Everything `openPty` needs, all hermetic-test-safe. */
export interface OpenPtyDeps {
  repoRoot: string;
  /** Channel auth for the daemon→host pipe. Defaults to the env-resolved values. */
  channelAuth?: HostChannelAuth;
  transport?: HostTransport;
  /**
   * D3.1 Factor C — collects the hardware-passkey assertion over the host-issued challenge. Wired at
   * go-live to the browser ceremony (relayed over the terminal WS); injected as a fake in tests. Required
   * for a successful open: without it the daemon cannot answer the host's per-open challenge.
   */
  assertionProvider?: PtyAssertionProvider;
  runPreamble?: PreambleRunner;
  /** Terminal geometry for the initial spawn. */
  cols?: number;
  rows?: number;
  /** Same signature as the real `appendAudit` — inject a recording fake in tests. Widened to allow a
   *  `Promise` (the real sink's git commit now runs off the event loop). */
  appendAudit?: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
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

/** The default pipe name (overridable via `DASHBOARD_PTY_HOST_PIPE`). */
export const DEFAULT_PTY_HOST_PIPE = '\\\\.\\pipe\\kb-pty-host';

/**
 * Resolve the daemon→host channel auth from the environment. `resolveChannelAuth` is called once PER
 * `openPty`, so reading the token file here IS the "read boot.token fresh per open" discipline (design
 * Point 3): a host restart that re-mints is picked up without caching.
 *
 * D-2 FIX: the token is read from the ACL-locked rendezvous file `C:\ProgramData\kb\pty-host\boot.token`
 * (override `DASHBOARD_PTY_HOST_TOKEN_FILE`), NOT a `randomUUID()` fallback. A missing / short / malformed
 * file yields an EMPTY token — which `defaultHostTransport` rejects as `host-unreachable` (fail closed) —
 * NEVER a fabricated token that could only ever mismatch silently.
 */
export function resolveChannelAuth(
  env: Record<string, string | undefined> = process.env,
): HostChannelAuth {
  const pipePath = env.DASHBOARD_PTY_HOST_PIPE?.trim() || DEFAULT_PTY_HOST_PIPE;
  const tokenFile = env.DASHBOARD_PTY_HOST_TOKEN_FILE?.trim() || bootTokenPath(DEFAULT_RENDEZVOUS_DIR);
  let bootToken = '';
  const res = readBootTokenFresh({ read: (p) => readFileSync(p, 'utf-8'), path: tokenFile });
  if (res.ok) bootToken = res.token;
  return { pipePath, bootToken };
}

/**
 * Open a PTY by SIGNALLING the pre-authenticated fleet-identity host — never by spawning anything as
 * another user. See the module docstring for the gate order (preamble first, then WebAuthn session,
 * then the host signal) and the exactly-one-audit-row invariant.
 */
/**
 * The default assertion provider fails CLOSED: no browser ceremony is wired at this layer (the terminal
 * WS relays the real one at go-live). A caller that reaches the host without wiring `assertionProvider`
 * therefore cannot answer the per-open challenge, and the open is refused — never opened without Factor C.
 */
export const defaultAssertionProvider: PtyAssertionProvider = () => {
  return Promise.reject(
    new Error('no PTY passkey assertion provider wired — a fleet-terminal open requires a hardware passkey (fail-closed)'),
  );
};

export async function openPty(session: SessionInput, deps: OpenPtyDeps): Promise<OpenPtyOutcome> {
  const appendAuditFn = deps.appendAudit ?? defaultAppendAudit;
  const requestId = (deps.requestId ?? randomUUID)();

  async function audited(outcome: OpenPtyOutcome, owner?: string): Promise<OpenPtyOutcome> {
    const detail: Record<string, unknown> = { requestId, cols: deps.cols ?? DEFAULT_COLS, rows: deps.rows ?? DEFAULT_ROWS };
    if (!outcome.ok && 'problems' in outcome) detail.problems = outcome.problems;
    if (!outcome.ok && 'detail' in outcome) detail.refusalDetail = outcome.detail;
    await appendAuditFn(
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
    return await audited({ ok: false, reason: 'fleet-frozen', problems: preamble.problems });
  }

  // 2. WebAuthn session gate — fail-closed 401. Checked only after the preamble passes.
  if (!session.token) {
    return await audited({ ok: false, reason: 'unauthenticated', status: 401, detail: 'no WebAuthn session token supplied' });
  }
  const check = verifySession(session.token, session.config);
  if (!check.ok) {
    return await audited({ ok: false, reason: 'unauthenticated', status: 401, detail: check.reason });
  }
  const owner = check.claims.sub;

  // 3. Signal the host over the authenticated local channel. The daemon ONLY sends an open-request —
  //    it never spawns a process as a user and passes no credential as an argument.
  const auth = deps.channelAuth ?? resolveChannelAuth();
  const transport = deps.transport ?? defaultHostTransport;
  const assertionProvider = deps.assertionProvider ?? defaultAssertionProvider;
  let connection: HostConnection;
  try {
    connection = transport(auth, assertionProvider);
  } catch (err) {
    return await audited({ ok: false, reason: 'host-unreachable', detail: (err as Error).message }, owner);
  }

  let ack: OpenPtyAck;
  try {
    ack = await connection.requestOpen({
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
    return await audited({ ok: false, reason: 'host-unreachable', detail: (err as Error).message }, owner);
  }

  return await audited({ ok: true, sessionId: ack.sessionId, connection }, owner);
}

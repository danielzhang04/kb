/**
 * D3.1 (persistent sessions, 2026-07-19) — the browser↔shell terminal bridge: the governed `/api/pty`
 * WebSocket, now backed by a PERSISTENT session registry so a page reload no longer kills the shell.
 *
 * ARCHITECTURE ("working now, harden later", chosen with Daniel 2026-07-18): the terminal spawns
 * `node-pty` IN-PROCESS in the daemon and pumps bytes over the WebSocket — the standard web-terminal
 * design (VS Code, ttyd, wetty). `createPtyHost` (host.ts) strips every credential/token name from the
 * child, so a terminal here still cannot read the fleet's push token or API keys.
 *
 * PERSISTENCE: the socket no longer OWNS the shell. A `persistentSessions.ts` registry does — buffering
 * all output into a bounded ring and forwarding to at most one attached socket. A socket closing merely
 * DETACHES (shell keeps running, output keeps buffering); revisiting REATTACHES with a scrollback replay.
 * The shell dies only on (a) an explicit `{type:'close'}` from the UI, (b) the shell process exiting, or
 * (c) the daemon-shutdown drain (`ptyHost.stopAll` + `registry.clear`).
 *
 * Two entry shapes on one endpoint, chosen by an optional `?session=<id>` on the upgrade URL (the id is a
 * NON-SECRET reference — ownership is enforced server-side; the bearer token still rides ONLY the
 * subprotocol, never the URL):
 *   OPEN  (no param): origin → preamble → session → cap → create → audit 'opened' → attach (replay covers
 *                     the pre-audit startup window).
 *   ATTACH (param):   origin → preamble → session → audit 'pty-attach' → attach+replay (no cap; an attach
 *                     never consumes a slot). Unknown/exited/not-owned → one 'session-not-found' row + refuse.
 * Either way exactly ONE audit row is written per allowed-origin connection, and a `{type:'session'}`
 * control frame is sent to the browser FIRST so the client can bind its tab id before the replay flush.
 *
 * SPAWN MODES (the Agents view's "Run agent" / the Workflows view's "Run workflow"): an OPEN may ask for
 * something other than the login shell via `?spawn=claude`, `?spawn=agent&agent=<id>`, or
 * `?spawn=workflow&workflow=<ref>`. `agent` is validated against the server's DECLARED agent roster
 * (`declaredAgentFilePath`) and `workflow` against the scanned definition registry
 * (`declaredWorkflowDefPath`) — exact-match allowlists — before any path or argv exists; the resolved
 * path is server-side and is passed as its own argv element, never interpolated into a command string.
 * A workflow spawn additionally GENERATES its governing-agent priming file into the daemon state root
 * (never into the repo) and primes claude with that. A bad mode, an unknown id, or an unknown ref is
 * refused twice over: HTTP 400 on the upgrade from the route's `preValidation` hook, and a fail-closed
 * re-check in the handler.
 *
 * REST companion (same origin-guarded scope): `GET /api/pty/sessions` lists the caller's live sessions
 * and `DELETE /api/pty/sessions/:id` kills one — both bearer-verified with the SAME `verifySession`, no
 * audit (a read and a not-audited-today close, respectively).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertOrigin, resolveAllowedOrigins } from '../security/origin.ts';
import type { AllowedOrigins } from '../security/origin.ts';
import { resolveSessionSecret, resolveSessionTtlMs, verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { bearerToken } from '../http/middleware.ts';
import { assertFleetRunnable, defaultPreambleRunner } from '../write/preambleGate.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { appendAudit as defaultAppendAudit } from '../audit/log.ts';
import type { AppendAuditOptions, AuditEvent, AuditRow } from '../audit/log.ts';
import { resolveRepoRoot } from '../http/surface.ts';
import { declaredAgentFilePath } from '../agents/roster.ts';
import { declaredWorkflowDefPath, workflowPrimingText } from '../workflows/routes.ts';
import { resolveDashboardStateRoot } from '../composer/store.ts';
import { buildChildEnv } from './host.ts';
import type { PtyCommand, PtyHost } from './host.ts';
import { CommandNotFoundError, resolveCommandPath } from './resolveCommand.ts';
import { createPersistentSessionRegistry, SESSION_ID_RE } from './persistentSessions.ts';
import type { PersistentSessionRegistry, SessionSink } from './persistentSessions.ts';
import type { SessionRunKind, SessionRunStore } from './sessionRuns.ts';
import type { TranscriptRecorder, TranscriptSummary } from './transcripts.ts';

/** The negotiated subprotocol that carries `['kb-pty.v1', sessionToken]` from the browser. */
export const PTY_SUBPROTOCOL = 'kb-pty.v1';

/** Max simultaneous LIVE SESSIONS across the whole daemon — a hard backstop, not a per-request limit.
 *  Counted from `registry.liveCount()`; an attach to an existing session never consumes a slot.
 *
 *  Manual shells retain their slot across browser reconnects; attaching to an existing session costs
 *  nothing. */
export const MAX_CONCURRENT_PTY = 16;

/** Initial shell geometry until the browser sends its first `{type:'resize'}` (matches xterm's default). */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/** The minimal WebSocket surface the handler uses — lets tests drive it with a fake (record send/close,
 *  emit message/close/error). Matches the `ws` instance `@fastify/websocket` hands the route. */
export interface PtySocketLike {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err?: unknown) => void): void;
}

/**
 * The non-default programs a terminal may be opened as (the "Run agent" path). Absent = today's login
 * shell, byte-identical to the pre-existing behaviour.
 *   `claude`   — a plain interactive Claude Code session in the repo the daemon serves.
 *   `agent`    — the same session PRIMED with one declared agent's own `agents/<id>.md`.
 *   `workflow` — the same session PRIMED as the GOVERNING agent for one workflow definition, from a
 *                priming file this server generates into its own state root (never into the repo).
 */
export type PtySpawnMode = 'claude' | 'agent' | 'workflow';

/** A parsed, SYNTACTICALLY valid spawn request. `agentId` is present exactly when `mode` is `agent` and
 *  `workflowRef` exactly when `mode` is `workflow`; neither is yet known to name anything real —
 *  {@link PtyRouteContext.resolveAgentFile} / {@link PtyRouteContext.resolveWorkflowFile} decide that. */
export interface PtySpawnRequest {
  mode: PtySpawnMode;
  agentId?: string;
  workflowRef?: string;
}

/** Why a spawn request was refused. Each maps to one HTTP 400 on the upgrade and one audit row. */
export type SpawnParamRefusal =
  | 'unknown-spawn-mode'
  | 'agent-required'
  | 'agent-not-allowed'
  | 'workflow-required'
  | 'workflow-not-allowed'
  | 'spawn-with-attach';

export type SpawnParamResult =
  | { ok: true; spawn: PtySpawnRequest | null }
  | { ok: false; reason: SpawnParamRefusal };

/**
 * The claude CLI as an argv[0]. Same command name the governed worker adapter spawns
 * (`server/control/claudeWorkerAdapter.ts`), resolved through the child's allowlisted PATH.
 *
 * NEVER passed to node-pty as-is. node-pty's ConPTY agent does not PATHEXT-search a bare, extensionless
 * name, so spawning this literally failed with an empty `File not found: ` — the live "Run agent" /
 * "Run workflow" defect. {@link resolveClaudeFile} turns it into an absolute path first.
 */
export const CLAUDE_COMMAND = 'claude';

/** Resolves {@link CLAUDE_COMMAND} to an absolute executable path. Injected in tests. */
export type ClaudeFileResolver = () => string;

/**
 * The real resolver: look `claude` up on the CHILD's allowlisted PATH — the very environment the spawned
 * process will run with — so what we resolve is exactly what it could itself have found. Throws
 * {@link CommandNotFoundError} when the CLI is absent, which the handler audits as
 * `claude-not-found-on-path`.
 */
export const resolveClaudeFile: ClaudeFileResolver = () =>
  resolveCommandPath(CLAUDE_COMMAND, buildChildEnv(process.env));

/**
 * Parse the optional `spawn`/`agent` query parameters off the upgrade URL.
 *
 * Strict and closed by construction: an absent pair is the ordinary shell open; anything present must be
 * an exact known mode with exactly the companion parameter that mode requires, and it may never be
 * combined with `session=` (an ATTACH reuses a live shell and spawns nothing, so a spawn request there
 * would be silently ignored — refusing is the honest reading). No value parsed here is ever used to
 * build a path; `agentId` still has to clear the roster allowlist and `workflowRef` the definition
 * allowlist. A BARE `agent=` or `workflow=` with no `spawn=` is a refusal, never an ordinary shell open:
 * silently ignoring a named target would be the same lie as silently ignoring a spawn on an attach.
 */
export function parseSpawnParams(url: string | undefined): SpawnParamResult {
  const q = url === undefined ? -1 : url.indexOf('?');
  const params = new URLSearchParams(q < 0 ? '' : (url as string).slice(q + 1));
  const mode = params.get('spawn');
  const agentId = params.get('agent');
  const workflowRef = params.get('workflow');
  if (mode === null && agentId === null && workflowRef === null) return { ok: true, spawn: null };
  const attach = params.get('session');
  if (attach !== null && attach !== '') return { ok: false, reason: 'spawn-with-attach' };
  if (mode !== 'claude' && mode !== 'agent' && mode !== 'workflow') return { ok: false, reason: 'unknown-spawn-mode' };
  if (mode === 'claude') {
    if (agentId !== null) return { ok: false, reason: 'agent-not-allowed' };
    if (workflowRef !== null) return { ok: false, reason: 'workflow-not-allowed' };
    return { ok: true, spawn: { mode } };
  }
  if (mode === 'agent') {
    if (workflowRef !== null) return { ok: false, reason: 'workflow-not-allowed' };
    if (agentId === null || agentId === '') return { ok: false, reason: 'agent-required' };
    return { ok: true, spawn: { mode, agentId } };
  }
  if (agentId !== null) return { ok: false, reason: 'agent-not-allowed' };
  if (workflowRef === null || workflowRef === '') return { ok: false, reason: 'workflow-required' };
  return { ok: true, spawn: { mode, workflowRef } };
}

/**
 * Build the child argv for an ALREADY-VALIDATED spawn request. `primingFile` is a SERVER-OWNED absolute
 * path — the agent declaration resolved through the roster allowlist for `agent`, or the priming file
 * this server just generated for `workflow` — never a client string. It lands as its own argv element
 * beside the flag, so a path is a path and can never become extra arguments or a shell fragment.
 *
 * `file` is ALWAYS an ABSOLUTE, resolved executable — never the bare `claude`. node-pty's ConPTY agent
 * does not PATHEXT-search a bare, extensionless name, so the bare form failed every spawn with an empty
 * `File not found: `. `resolveFile` is the injectable seam; it throws {@link CommandNotFoundError} when
 * the CLI is absent from the child's PATH, and the caller fails closed on that.
 *
 * The argv-purity property is unchanged: we resolve a PATH lookup to a path, we do not wrap in a shell.
 */
export function buildSpawnCommand(
  spawn: PtySpawnRequest,
  primingFile: string | null,
  resolveFile: ClaudeFileResolver = resolveClaudeFile,
): PtyCommand {
  if (spawn.mode === 'claude') return { file: resolveFile(), args: [] };
  if (primingFile === null || primingFile === '') {
    throw new Error(
      spawn.mode === 'workflow'
        ? 'buildSpawnCommand: a workflow-primed spawn needs a server-generated priming file path'
        : 'buildSpawnCommand: an agent-primed spawn needs a server-resolved declaration path',
    );
  }
  return { file: resolveFile(), args: ['--append-system-prompt-file', primingFile] };
}

/** A workflow ref safe to reuse verbatim as a filename stem (the parser's own definition-id grammar). */
const SAFE_WORKFLOW_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A deterministic, per-ref filename inside the priming directory. A ref that already cleared the
 *  definition allowlist always matches the id grammar; the hash branch is a belt-and-braces backstop so
 *  a ref can never contribute a path separator or a `..` to the filename under any future scan change. */
export function workflowPrimingFileName(ref: string): string {
  if (SAFE_WORKFLOW_REF.test(ref)) return `workflow-${ref}.md`;
  return `workflow-${createHash('sha256').update(ref, 'utf8').digest('hex').slice(0, 32)}.md`;
}

/**
 * Generate the governing-agent priming file for an ALREADY-ALLOWLISTED workflow ref and return its
 * absolute path.
 *
 * It is written into the DAEMON STATE ROOT (`resolveDashboardStateRoot`, the same directory the composer
 * and control stores use), never into the repo: the repo is the operator's working tree and a terminal
 * spawn must not litter it or make it dirty. Regenerated on every spawn under a deterministic per-ref
 * name, so the file always describes the definition as it is RIGHT NOW and an overwrite is expected.
 *
 * The content is built from the definition's own declared text (`workflowPrimingText`). If the priming
 * text cannot be built — which should be unreachable, since the ref already cleared the allowlist — a
 * minimal but honest preamble naming the ref and its path is written instead: the operator still gets a
 * governing terminal rather than a refused spawn. No credential, token, or environment value is ever
 * rendered into this file.
 */
export function writeWorkflowPrimingFile(
  repoRoot: string,
  ref: string,
  primingRoot: string,
  defFile: string,
): string {
  const primed = workflowPrimingText(repoRoot, ref);
  const text = primed?.text ?? [
    `# Governing agent — workflow: ${ref}`,
    '',
    'You are the HEAD, GOVERNING agent for this workflow. This session is not a stage worker.',
    '',
    `- workflow ref: ${ref}`,
    `- definition: ${defFile}`,
    '',
    'The server could not summarise this definition. READ the definition file first, gather any declared',
    'parameters CONVERSATIONALLY from the operator, then drive the stages through the platform\'s normal',
    'mechanisms. Do not invent an agent for a stage that names none — ask the operator.',
    '',
  ].join('\n');
  mkdirSync(primingRoot, { recursive: true });
  const path = join(primingRoot, workflowPrimingFileName(ref));
  writeFileSync(path, text, 'utf8');
  return path;
}

/** Everything a PTY connection needs, all hermetic-test-injectable. */
export interface PtyRouteContext {
  repoRoot: string;
  sessionConfig: SessionConfig;
  /** The Origin/Host allowlist; enforced by the scope guard AND re-checked defensively in-handler. */
  allowedOrigins?: AllowedOrigins;
  /** The in-process node-pty host (shared; the registry spawns/kills through it). Tests inject a fake. */
  ptyHost: PtyHost;
  /** The persistent session registry (shared by the WS route, the REST endpoints, and the drain). */
  registry: PersistentSessionRegistry;
  /** Fleet preamble runner. It is always invoked before session validation or spawn. */
  runPreamble: PreambleRunner;
  /** Independent audit sink. Tests inject a recorder, so no test writes `ledgers/audit/**`. Widened to
   *  allow a `Promise` — the real `appendAudit` now runs its git commit off the event loop. */
  appendAudit: (repoRoot: string, event: AuditEvent, options?: AppendAuditOptions) => AuditRow | Promise<AuditRow>;
  /** Optional git/time seams forwarded to the real audit implementation. */
  auditOptions?: AppendAuditOptions;
  /** The concurrency cap ceiling. Defaults to {@link MAX_CONCURRENT_PTY}. */
  maxConcurrent?: number;
  /**
   * The agent ALLOWLIST behind "Run agent": resolve one declared agent id to its authoritative
   * `agents/<id>.md` inside the repo THIS daemon serves, or null when the id is not on the roster.
   * Defaults to `declaredAgentFilePath`; injected in tests so no declaration filesystem is read.
   */
  resolveAgentFile: (repoRoot: string, agentId: string) => string | null;
  /**
   * The workflow ALLOWLIST behind "Run workflow": resolve one workflow ref to its authoritative
   * definition file inside the repo THIS daemon serves, or null when the ref names no valid, uniquely
   * identified definition. Defaults to `declaredWorkflowDefPath`; injected in tests exactly like
   * {@link resolveAgentFile}, so no test depends on this checkout's real workflow-definition tree.
   */
  resolveWorkflowFile: (repoRoot: string, ref: string) => string | null;
  /**
   * Where generated workflow priming files are written. ALWAYS outside the repo — it defaults to a
   * `pty-priming` directory under the daemon state root (`resolveDashboardStateRoot`). Tests point it
   * at a temp directory.
   */
  workflowPrimingRoot: string;
  /**
   * Resolves the claude CLI to an ABSOLUTE path against the child's own allowlisted PATH. Defaults to
   * {@link resolveClaudeFile}; injected in tests so no test depends on this machine having the CLI
   * installed, and so the not-found branch is exercisable.
   */
  resolveClaudeFile: ClaudeFileResolver;
  /**
   * The durable SESSION RUN record store (`sessionRuns.ts`). Optional: when absent this route behaves
   * exactly as it did before — sessions still spawn, attach and die, they are simply not recorded. It is
   * wired in `server/http/surface.ts` for the daemon; tests inject a store over a temp state root.
   *
   * A session run is written for an `agent`- or `workflow`-primed spawn ONLY. A login shell and a plain
   * `claude` belong to no entity, so there is no detail surface a record for them could honestly appear
   * on, and inventing one would put un-entity-bound shells in a list titled "this workflow's runs".
   */
  sessionRuns?: SessionRunStore;
  /** The transcript recorder (`transcripts.ts`). Optional for the same reason as {@link sessionRuns}. */
  transcripts?: TranscriptRecorder;
}

/** Build a full {@link PtyRouteContext}, filling every unset field with its real default. The session
 *  secret is resolved ONCE here so the token this route verifies matches the one the write surface mints.
 *
 *  N4 (fail-closed host, 2026-08-03): `ptyHost` has NO default. The daemon's ONE pty host is the
 *  `fleetGatedPtyHost` built in `makeSurfaceContext`; every caller MUST pass it in. If none is supplied we
 *  THROW rather than fabricate a raw `createPtyHost` here — an ungated fallback would silently spawn a shell
 *  that bypasses the fleet gate (STOP/API-key/budget), so the safe failure is no context at all. Tests inject
 *  a fake host, so they are unaffected. */
export function makePtyRouteContext(overrides: Partial<PtyRouteContext> = {}): PtyRouteContext {
  if (overrides.ptyHost === undefined) {
    throw new Error(
      'makePtyRouteContext: ptyHost is required (fail-closed) — pass the fleet-gated host; ' +
        'no ungated fallback is created here',
    );
  }
  return {
    repoRoot: overrides.repoRoot ?? resolveRepoRoot(),
    sessionConfig:
      overrides.sessionConfig ?? { secret: resolveSessionSecret(), ttlMs: resolveSessionTtlMs() },
    allowedOrigins: overrides.allowedOrigins ?? resolveAllowedOrigins(),
    ptyHost: overrides.ptyHost,
    registry: overrides.registry ?? createPersistentSessionRegistry(),
    runPreamble: overrides.runPreamble ?? defaultPreambleRunner,
    appendAudit: overrides.appendAudit ?? defaultAppendAudit,
    auditOptions: overrides.auditOptions,
    maxConcurrent: overrides.maxConcurrent ?? MAX_CONCURRENT_PTY,
    resolveAgentFile: overrides.resolveAgentFile ?? declaredAgentFilePath,
    resolveWorkflowFile: overrides.resolveWorkflowFile ?? declaredWorkflowDefPath,
    workflowPrimingRoot: overrides.workflowPrimingRoot ?? join(resolveDashboardStateRoot(), 'pty-priming'),
    resolveClaudeFile: overrides.resolveClaudeFile ?? resolveClaudeFile,
    // No defaults are fabricated for these two. Constructing a file-backed store here would make every
    // context construction (tests included) touch the daemon's real state root; the composition root
    // owns them instead, exactly as it owns the fleet-gated host.
    ...(overrides.sessionRuns ? { sessionRuns: overrides.sessionRuns } : {}),
    ...(overrides.transcripts ? { transcripts: overrides.transcripts } : {}),
  };
}

/** Read the bearer session token from the offered subprotocols — NEVER from the URL. The browser offers
 *  `['kb-pty.v1', sessionToken]`, which arrives comma-joined in `sec-websocket-protocol`. */
export function tokenFromSubprotocol(req: Pick<FastifyRequest, 'headers'>): string | undefined {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((s) => s.trim());
  return offered[0] === PTY_SUBPROTOCOL ? offered[1] || undefined : undefined;
}

/** Parse the optional `session` attach reference off the upgrade URL's query string. The value is a
 *  non-secret sessionId (ownership enforced server-side); the token never appears here. */
export function sessionParamFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const q = url.indexOf('?');
  if (q < 0) return undefined;
  const value = new URLSearchParams(url.slice(q + 1)).get('session');
  return value && value.length > 0 ? value : undefined;
}

/** Parse one inbound client message as a control frame (`resize` or `close`), or null if it is raw stdin.
 *  Keystrokes are never JSON objects (they never start with `{`), so the fast-path reject keeps typing cheap. */
function parseControlFrame(raw: string): { type: 'resize'; cols: number; rows: number } | { type: 'close' } | null {
  if (raw.length === 0 || raw[0] !== '{') return null;
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (m && m.type === 'close') return { type: 'close' };
    if (
      m &&
      m.type === 'resize' &&
      typeof m.cols === 'number' &&
      typeof m.rows === 'number' &&
      m.cols > 0 &&
      m.rows > 0
    ) {
      return { type: 'resize', cols: Math.floor(m.cols), rows: Math.floor(m.rows) };
    }
  } catch {
    /* not JSON → raw stdin */
  }
  return null;
}

const isOpen = (socket: PtySocketLike): boolean => socket.readyState === socket.OPEN;

/**
 * Drive one `/api/pty` WebSocket end to end: gate it (origin → preamble → session, plus the cap on the
 * OPEN path), then either create a fresh persistent session or reattach to an existing one, multiplexing
 * bytes both ways through the registry. Exported so the whole path is hermetically testable with a fake
 * socket, preamble, audit sink, `ptyHost`, and registry.
 */
export async function handlePtyConnection(
  socket: PtySocketLike,
  req: Pick<FastifyRequest, 'headers' | 'url'>,
  ctx: PtyRouteContext,
): Promise<void> {
  const maxConcurrent = ctx.maxConcurrent ?? MAX_CONCURRENT_PTY;
  const registry = ctx.registry;
  const requestedSession = sessionParamFromUrl(req.url);
  const auditAction = requestedSession ? 'pty-attach' : 'pty-open';

  // Exactly one row for every connection that clears the Origin/Host boundary. The action distinguishes
  // an open attempt from an attach attempt; a socket close/error only reaps resources (no second row).
  const audit = async (result: string, owner?: string, detail: Record<string, unknown> = {}): Promise<void> => {
    await ctx.appendAudit(ctx.repoRoot, { action: auditAction, owner, result, detail }, ctx.auditOptions);
  };

  // 1. Defensive Origin/Host re-check (the scope guard already 403s a bad upgrade; this only bites if the
  //    route is ever mounted without the guard — mirrors `hub/ws.ts`).
  if (ctx.allowedOrigins !== undefined) {
    const result = assertOrigin(req as { headers: FastifyRequest['headers'] }, ctx.allowedOrigins);
    if (!result.ok) {
      socket.close(1008, result.reason ?? 'forbidden');
      return;
    }
  }

  // 2. Fleet preamble FIRST — STOP/API-key/budget refusal wins even for an invalid session. The check
  //    READS the shared ops checkout (budget/ledger/STOP), so it runs under the ops-transaction lock:
  //    a concurrent transaction's pull --rebase shifts those files mid-read and yields a FALSE
  //    fleet-frozen (observed live on a terminal reattach). Reentrant, so callers already holding
  //    the lock are unaffected.
  const preamble = await withOpsTransaction(async () => assertFleetRunnable(ctx.repoRoot, ctx.runPreamble));
  if (!preamble.ok) {
    await audit('fleet-frozen', undefined, { problems: preamble.problems });
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'fleet-frozen' }));
    socket.close(1008, 'fleet-frozen');
    return;
  }

  // 3. Session gate — must be signed in. The token rides the subprotocol, never the URL.
  const token = tokenFromSubprotocol(req);
  const session = token ? verifySession(token, ctx.sessionConfig) : null;
  if (!session || !session.ok) {
    await audit('unauthenticated');
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'unauthenticated' }));
    socket.close(1008, 'unauthenticated');
    return;
  }
  const owner = session.claims.sub;

  /**
   * The SESSION RUN this connection opens, once it exists. Declared here because the sink below closes
   * over it: the shell's exit code is only ever seen by an ATTACHED sink, and it is the one lifecycle
   * fact the registry's gone-notification cannot carry.
   */
  let sessionRunRef: string | null = null;

  // 3b. Spawn-mode gate. Parsed AFTER authentication and BEFORE anything touches a path, an argv, or the
  //     concurrency cap, so an unknown mode or an unknown agent id costs a refusal and nothing else. The
  //     route's `preValidation` hook already 400s these on the upgrade; this is the fail-closed backstop
  //     for any future mounting of the handler without that hook.
  const spawnParams = parseSpawnParams(req.url);
  if (!spawnParams.ok) {
    await audit('bad-spawn-request', owner, { reason: spawnParams.reason });
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'bad-spawn-request' }));
    socket.close(1008, 'bad-spawn-request');
    return;
  }

  // A sink over this socket. `send`/`closed` relay bytes; `onExit` closes the socket when the shell dies;
  // `onEvicted` closes it (with an error frame) when a newer socket supersedes this attach.
  const makeSink = (): SessionSink => ({
    send: (chunk) => {
      if (isOpen(socket)) socket.send(chunk);
    },
    closed: () => !isOpen(socket),
    onExit: (info) => {
      // Best-effort exit code. `observe()`'s gone-notification (which ends the record) carries no exit
      // info, so this fills an UNKNOWN when — and only when — a socket was still attached to see it.
      if (sessionRunRef && ctx.sessionRuns) {
        void Promise.resolve(ctx.sessionRuns.stampExitCode(owner, sessionRunRef, info.exitCode)).catch(() => {});
      }
      if (isOpen(socket)) socket.close(1000, 'shell exited');
    },
    onEvicted: () => {
      if (isOpen(socket)) {
        socket.send(JSON.stringify({ type: 'error', reason: 'session-superseded' }));
        socket.close(1008, 'superseded');
      }
    },
  });

  // Browser → shell: `{type:'resize'}` resizes, `{type:'close'}` kills the session (explicit operator
  // close — the ONE UI-driven death), everything else is raw stdin. Closes are NOT audited.
  const wireInput = (sessionId: string): void => {
    socket.on('message', (data: unknown) => {
      const raw = typeof data === 'string' ? data : String(data);
      const control = parseControlFrame(raw);
      if (control?.type === 'resize') {
        registry.resize(owner, sessionId, control.cols, control.rows);
        return;
      }
      if (control?.type === 'close') {
        registry.close(owner, sessionId);
        if (isOpen(socket)) socket.close(1000, 'closed by operator');
        return;
      }
      registry.write(owner, sessionId, raw);
    });
  };

  // ── ATTACH PATH ────────────────────────────────────────────────────────────────────────────────────
  if (requestedSession) {
    const check = registry.canAttach(owner, requestedSession);
    if (!check.ok) {
      // Unknown / exited / not-owned all collapse to one browser-facing refusal + one audit row.
      await audit('session-not-found', owner, { sessionId: requestedSession, reason: check.reason });
      if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'session-not-found' }));
      socket.close(1008, 'session-not-found');
      return;
    }
    // Audit BEFORE attach/replay: no shell byte reaches the browser until the attach is durably recorded
    // (fail-closed). If the audit throws, nothing was attached, so there is nothing to detach.
    try {
      await audit('attached', owner, { sessionId: requestedSession });
    } catch {
      if (isOpen(socket)) {
        socket.send(JSON.stringify({ type: 'error', reason: 'audit-failed' }));
        socket.close(1011, 'audit-failed');
      }
      return;
    }
    const sink = makeSink();
    socket.on('close', () => registry.detach(requestedSession, sink));
    socket.on('error', () => registry.detach(requestedSession, sink));
    wireInput(requestedSession);
    // Bind frame first, then the replay flush lands after it.
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'session', sessionId: requestedSession }));
    const attached = registry.attach(owner, requestedSession, sink);
    if (!attached.ok) {
      // Rare race: the shell exited between canAttach and attach. Refuse without a second audit row.
      if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'session-not-found' }));
      socket.close(1008, 'session-not-found');
    }
    return;
  }

  // ── OPEN PATH ──────────────────────────────────────────────────────────────────────────────────────
  // 4a. Resolve the child program. `null` spawn = the login shell (unchanged). An agent-primed spawn
  //     resolves its declaration path SERVER-SIDE from the validated id; a workflow-primed spawn
  //     resolves its DEFINITION path the same way and then generates its priming file outside the repo.
  //     An id or ref that is not on its allowlist is refused here (fail-closed backstop for the route's
  //     `preValidation` 400) and never reaches a path join, an argv, or a process.
  let command: PtyCommand | undefined;
  // Hoisted out of the spawn block: the session-run record keeps the priming file this session was
  // actually started with, which is the only durable answer to "what was this shell told to be?".
  let primingFile: string | null = null;
  if (spawnParams.spawn) {
    if (spawnParams.spawn.mode === 'agent') {
      primingFile = ctx.resolveAgentFile(ctx.repoRoot, spawnParams.spawn.agentId as string);
      if (primingFile === null) {
        await audit('unknown-agent', owner, { agentId: spawnParams.spawn.agentId });
        if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'unknown-agent' }));
        socket.close(1008, 'unknown-agent');
        return;
      }
    }
    if (spawnParams.spawn.mode === 'workflow') {
      const workflowRef = spawnParams.spawn.workflowRef as string;
      const defFile = ctx.resolveWorkflowFile(ctx.repoRoot, workflowRef);
      if (defFile === null) {
        await audit('unknown-workflow', owner, { workflowRef });
        if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'unknown-workflow' }));
        socket.close(1008, 'unknown-workflow');
        return;
      }
      try {
        primingFile = writeWorkflowPrimingFile(ctx.repoRoot, workflowRef, ctx.workflowPrimingRoot, defFile);
      } catch (err) {
        await audit('spawn-failed', owner, { workflowRef, error: (err as Error).message });
        if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'spawn-failed' }));
        socket.close(1011, 'priming-write-failed');
        return;
      }
    }
    // Resolving `claude` to an absolute path is the LAST thing before the spawn, and it can fail: the
    // CLI may not be on the child's PATH at all. Fail CLOSED and NAMED — one `claude-not-found-on-path`
    // row an operator can act on, never node-pty's empty `File not found: `.
    try {
      command = buildSpawnCommand(spawnParams.spawn, primingFile, ctx.resolveClaudeFile);
    } catch (err) {
      if (err instanceof CommandNotFoundError) {
        await audit('claude-not-found-on-path', owner, { command: err.command, searchedDirs: err.searchedDirs });
        if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'claude-not-found-on-path' }));
        socket.close(1011, 'claude-not-found-on-path');
        return;
      }
      await audit('spawn-failed', owner, { error: (err as Error).message });
      if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'spawn-failed' }));
      socket.close(1011, (err as Error).message);
      return;
    }
  }

  // 4b. Concurrency cap — count LIVE SESSIONS, refuse over the ceiling BEFORE spawning anything.
  if (registry.liveCount() >= maxConcurrent) {
    await audit('too-many-terminals', owner, { maxConcurrent });
    if (isOpen(socket)) socket.send(JSON.stringify({ type: 'error', reason: 'too-many-terminals' }));
    socket.close(1013, 'too many terminals');
    return;
  }

  // 5. Create the persistent session. `create` spawns via the host and starts buffering IMMEDIATELY, so
  //    the shell's banner/first prompt emitted during the async audit below is captured, never dropped.
  let created: { sessionId: string; createdAt: number };
  try {
    created = registry.create(
      owner,
      ctx.ptyHost,
      {
        requestId: '',
        // Always the repo THIS daemon serves — resolved from the server's own config, never from the
        // request. An agent-primed claude therefore starts in the same checkout the agent file came from.
        cwd: ctx.repoRoot,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        ...(command ? { command } : {}),
      },
      // What this session IS, recorded alongside it. The same facts the `opened` audit row carries, kept
      // where a later `GET /api/pty/sessions` can return them: a surface showing one agent has to be able
      // to find the session already primed for THAT agent and reattach, instead of spawning a second one
      // every time it is re-rendered. Descriptive only — ownership still gates every operation.
      {
        kind: spawnParams.spawn?.mode ?? 'shell',
        targetRef: spawnParams.spawn?.agentId ?? spawnParams.spawn?.workflowRef ?? null,
      },
    );
  } catch (err) {
    await audit('spawn-failed', owner, { error: (err as Error).message });
    if (isOpen(socket)) {
      socket.send(JSON.stringify({ type: 'error', reason: 'spawn-failed' }));
      socket.close(1011, (err as Error).message);
    }
    return;
  }
  const sessionId = created.sessionId;

  // ── SESSION RUN + TRANSCRIPT ───────────────────────────────────────────────────────────────────────
  // Recorded for an entity-primed spawn only (see PtyRouteContext.sessionRuns). Two orderings matter:
  //
  //  1. The transcript tap goes on FIRST, before any await. Observers get no replay of the ring, so a
  //     banner emitted while the record write or the audit is in flight would otherwise be lost from the
  //     transcript forever.
  //  2. The record is written BEFORE the `opened` audit — i.e. before any byte reaches the operator —
  //     and a failure to write it fails the spawn CLOSED (kill the shell, refuse the socket), exactly as
  //     an unwritable audit row does. A session the daemon could not record is a session nothing can
  //     later account for.
  //
  // The id is already minted by `registry.create` above, so the record is born complete rather than
  // stamped in a second write: there is no window in which a record exists without its `ptySessionId`.
  const runKind: SessionRunKind | null =
    spawnParams.spawn?.mode === 'agent' ? 'agent' : spawnParams.spawn?.mode === 'workflow' ? 'workflow' : null;
  const runTargetRef = spawnParams.spawn?.agentId ?? spawnParams.spawn?.workflowRef ?? null;
  const recordable = Boolean(ctx.sessionRuns && runKind && runTargetRef);
  // Mutable state read across the async boundary below. A plain `let` would be narrowed by the compiler
  // to its initializer; a container is honest about being written from a callback.
  const goneState: { fired: boolean; summary: TranscriptSummary | null } = { fired: false, summary: null };

  const endSessionRun = (summary: TranscriptSummary | null): void => {
    if (!ctx.sessionRuns || !sessionRunRef) return;
    // Record-keeping never breaks teardown: a store failure here leaves the record `live`, and the boot
    // sweep corrects it to `abandoned` on the next daemon start.
    void Promise.resolve(ctx.sessionRuns.end(owner, sessionRunRef, { transcript: summary })).catch(() => {});
  };

  // The registry's gone-notification fires EXACTLY ONCE — on shell exit or on an explicit close — which
  // is precisely the "this session ended" edge. Closing the browser tab is NOT that edge: it detaches a
  // socket, the shell keeps running, and the record stays `live` because it still is.
  const onSessionGone = (summary: TranscriptSummary | null): void => {
    goneState.fired = true;
    goneState.summary = summary;
    endSessionRun(summary);
  };
  if (recordable) {
    if (ctx.transcripts) {
      ctx.transcripts.record(registry, owner, sessionId, onSessionGone);
    } else {
      registry.observe(owner, sessionId, () => {}, () => onSessionGone(null));
    }
  }

  if (recordable && ctx.sessionRuns) {
    try {
      const record = await ctx.sessionRuns.create({
        owner,
        kind: runKind as SessionRunKind,
        targetRef: runTargetRef as string,
        ptySessionId: sessionId,
        primingPath: primingFile,
      });
      sessionRunRef = record.sessionRunRef;
    } catch {
      registry.close(owner, sessionId);
      // Still exactly ONE audit row for this connection: the spawn was rolled back, so it is reported as
      // the spawn failure it now is rather than as an `opened` that did not happen.
      await audit('spawn-failed', owner, { error: 'session-run-record-failed' });
      if (isOpen(socket)) {
        socket.send(JSON.stringify({ type: 'error', reason: 'session-run-record-failed' }));
        socket.close(1011, 'session-run-record-failed');
      }
      return;
    }
    // A shell can die inside that await (a bad priming file, an instant exit). The gone-notification
    // then fired before the ref existed, so settle the record now instead of leaving it `live` forever.
    if (goneState.fired) endSessionRun(goneState.summary);
  }

  // Opening the shell is the consequential action. If its audit cannot be recorded, fail closed: kill the
  // just-created session, close the WS, and contain the exception here.
  try {
    await audit('opened', owner, {
      sessionId,
      // What was actually spawned is part of the record: a shell and an agent-primed claude are not the
      // same action, and an audit that could not tell them apart would be a hole.
      spawn: spawnParams.spawn?.mode ?? 'shell',
      ...(spawnParams.spawn?.agentId ? { agentId: spawnParams.spawn.agentId } : {}),
      ...(spawnParams.spawn?.workflowRef ? { workflowRef: spawnParams.spawn.workflowRef } : {}),
      // Ties this row to the durable record it opened, so the audit log and the session-run list can be
      // read against each other without guessing from timestamps.
      ...(sessionRunRef ? { sessionRunRef } : {}),
    });
  } catch {
    registry.close(owner, sessionId);
    if (isOpen(socket)) {
      socket.send(JSON.stringify({ type: 'error', reason: 'audit-failed' }));
      socket.close(1011, 'audit-failed');
    }
    return;
  }

  const sink = makeSink();
  // Socket close/error DETACHES only — the shell survives a reload and keeps buffering.
  socket.on('close', () => registry.detach(sessionId, sink));
  socket.on('error', () => registry.detach(sessionId, sink));
  wireInput(sessionId);
  // Bind frame first, then attach replays the buffered pre-audit startup output after it.
  if (isOpen(socket)) socket.send(JSON.stringify({ type: 'session', sessionId }));
  registry.attach(owner, sessionId, sink);
}

/** Verify the bearer on a REST request the same way the WS verifies its subprotocol token. Returns the
 *  owner `sub` on success, or replies 401 and returns undefined. Exported so the session-run routes
 *  registered beside this one authenticate through the exact same check, not a second copy of it. */
export function requireBearerOwner(
  req: FastifyRequest,
  reply: FastifyReply,
  sessionConfig: SessionConfig,
): string | undefined {
  const token = bearerToken(req);
  const check = token ? verifySession(token, sessionConfig) : { ok: false as const, reason: 'malformed' as const };
  if (!check.ok) {
    void reply.code(401).send({ error: 'unauthenticated', reason: check.reason });
    return undefined;
  }
  return check.claims.sub;
}

/**
 * Register `/api/pty` (WS) plus the `/api/pty/sessions` REST endpoints on `app`. Register the WS plugin
 * FIRST, then the caller wraps this in an origin-guarded child scope (see `server/index.ts`) — the
 * scope's Origin/Host hook covers the REST routes too. One shared registry per registration; a shutdown
 * `onClose` drains it (kill every PTY, forget every entry).
 */
export async function registerPtyRoute(
  app: FastifyInstance,
  ctx: PtyRouteContext = makePtyRouteContext(),
): Promise<void> {
  await app.register(fastifyWebsocket);

  /**
   * Spawn-mode admission control, run on the UPGRADE request itself so a bad or unknown target is a
   * plain HTTP 400 and the WebSocket is never established. The check is exact-match against the server's
   * declared-agent roster and happens before any path is built; the handler re-checks fail-closed.
   */
  app.get(
    '/api/pty',
    {
      websocket: true,
      preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = parseSpawnParams(req.url);
        if (!parsed.ok) {
          await reply.code(400).send({ error: 'bad-spawn-request', reason: parsed.reason });
          return;
        }
        if (parsed.spawn?.mode === 'agent' && ctx.resolveAgentFile(ctx.repoRoot, parsed.spawn.agentId as string) === null) {
          await reply.code(400).send({ error: 'unknown-agent' });
          return;
        }
        if (parsed.spawn?.mode === 'workflow' && ctx.resolveWorkflowFile(ctx.repoRoot, parsed.spawn.workflowRef as string) === null) {
          await reply.code(400).send({ error: 'unknown-workflow' });
        }
      },
    },
    (socket, req) => {
      void handlePtyConnection(socket as unknown as PtySocketLike, req, ctx);
    },
  );

  // REST: list my live sessions (read — no audit). Bearer verified exactly like the WS.
  app.get('/api/pty/sessions', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    return reply.code(200).send({ sessions: ctx.registry.list(owner) });
  });

  // REST: kill one of my sessions (close is not audited today either). 404 unknown/not-owned/malformed.
  app.delete('/api/pty/sessions/:sessionId', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireBearerOwner(req, reply, ctx.sessionConfig);
    if (owner === undefined) return reply;
    const sessionId = (req.params as { sessionId?: unknown }).sessionId;
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
      return reply.code(404).send({ error: 'not-found' });
    }
    const result = ctx.registry.close(owner, sessionId);
    if (!result.ok) return reply.code(404).send({ error: 'not-found', reason: result.reason });
    return reply.code(200).send({ ok: true });
  });

  // Daemon shutdown drain: kill every live PTY and forget every registry entry so no shell is orphaned.
  // `clear()` fires each session's gone-notification, so transcripts flush and their records settle on
  // the way out; whatever does not complete before the process exits is corrected by the boot sweep.
  app.addHook('onClose', async () => {
    try {
      ctx.ptyHost.stopAll();
    } catch {
      /* best-effort */
    }
    ctx.registry.clear();
    try {
      ctx.transcripts?.dispose();
    } catch {
      /* best-effort */
    }
  });
}

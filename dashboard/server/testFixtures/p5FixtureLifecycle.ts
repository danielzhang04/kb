/**
 * P5 W6.1/W6.4 — the BOUNDED lifecycle wrapper the §8 Inbox deployment + asset-pull browser proofs run
 * under. It is the P5 analogue of {@link file://./p4FixtureLifecycle.ts}: the same guarantee that a
 * fixture server is up before the browser runner starts and gone afterwards — on success, on client
 * failure, on a ready-timeout, and on SIGINT/SIGTERM — with no orphaned node process.
 *
 * The P5 Inbox surface lives in the shipping dashboard shell fixture (`p1BrowserFixture.ts`), which now
 * serves the four-source envelope and the deployment T3 refusal route, so this wrapper spawns THAT
 * fixture rather than a bespoke one. Every OS seam (spawn, ready probe, clock, signal registration) is
 * injected, so all four teardown paths are proven against a fake child with no real process.
 *
 * The fixture command is always started as a BACKGROUND child in its own process, never `shell: true`:
 * nothing here composes a command string, so no argument can be re-parsed by a shell.
 */
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultOnSignal, defaultReadyProbe, type LifecycleChild, type ReadyProbe, type SleepFn,
} from './p4FixtureLifecycle.ts';
// P5 production modules the §9 attacks drive DIRECTLY [P5-C24, W6.4b lesson: no same-belief stub
// re-implements a refusal — a regression in any of these turns the owning attack red].
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import type { Deployment, DeploymentTransitionPatch } from '../control/types.ts';
import type { DeploymentState } from '../control/deploymentState.ts';
import { DeploymentService } from '../deploy/deploymentService.ts';
import { createHelperClient } from '../deploy/helperClient.ts';
import type { HelperFetch, HelperFetchResponse } from '../deploy/helperClient.ts';
import { createDeployReadyReader } from '../deploy/deployReady.ts';
import { closePtysAndContinue } from '../deploy/quiescence.ts';
import type { DeployReadyCandidate, DeployReadyPort, HelperRequest } from '../deploy/contracts.ts';
import {
  projectDeployReadyItem, type CommitAncestryPort, type DeploymentsReaderPort, type LiveReleasePort,
} from '../inbox/deploymentSubjects.ts';
import {
  assertKnownMutatingVerb, resolveAbortAttempt, resolveDeploymentAction,
} from '../inbox/actionResolver.ts';
import {
  P5_SCENARIOS, isP5FixtureKind, isP5Scenario, type P5FixtureKind, type P5Scenario,
} from './p5ActualBrowserRunner.ts';

export type { LifecycleChild } from './p4FixtureLifecycle.ts';
export type LifecycleSpawn = (command: string, args: readonly string[]) => LifecycleChild;

/** The seven §8 browser scenarios and the two fixture kinds — re-exported from the runner so the arg
 *  parser, the fixture server, and the matrix runner all agree on one closed set. */
export {
  P5_SCENARIOS as P5_BROWSER_SCENARIOS, P5_FIXTURE_KINDS, isP5FixtureKind, isP5Scenario,
} from './p5ActualBrowserRunner.ts';
export type { P5Scenario as P5BrowserScenario, P5FixtureKind } from './p5ActualBrowserRunner.ts';

export interface P5FixtureLifecycleOptions {
  /** Argv of the fixture server, already split — never a command string. */
  readonly fixtureArgv: readonly string[];
  /** Argv of the client to run after the fixture is ready (`--` separated on the CLI). */
  readonly clientArgv: readonly string[];
  /** The `/readyz` URL to poll. */
  readonly readyUrl: string;
  readonly readyTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly pollIntervalMs: number;
}

export interface P5FixtureLifecycleDeps {
  spawn: LifecycleSpawn;
  readyProbe: ReadyProbe;
  now: () => number;
  sleep: SleepFn;
  /** Register a SIGINT/SIGTERM handler; returns a disposer. */
  onSignal: (handler: () => void) => () => void;
  log?: (line: string) => void;
}

export const P5_LIFECYCLE_EXIT = { ok: 0, clientFailed: 1, readyTimeout: 66, usage: 2 } as const;
export type P5LifecycleExitCode = number;

export class P5LifecycleUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P5LifecycleUsageError';
  }
}

/** Parse `--fixture bounded|real --scenario <seven> --port … --https … -- <client argv>`. */
export function parseP5FixtureLifecycleArgs(argv: readonly string[]): P5FixtureLifecycleOptions {
  const dashDash = argv.indexOf('--');
  const own = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const clientArgv = dashDash === -1 ? [] : argv.slice(dashDash + 1);
  if (clientArgv.length === 0) throw new P5LifecycleUsageError('a client command after `--` is required');

  let scenario: P5Scenario = 'deployment-action-matrix';
  let fixtureKind: P5FixtureKind = 'bounded';
  let port = 4431;
  let https = false;
  let readyTimeoutMs = 20000;
  let shutdownTimeoutMs = 5000;
  let pollIntervalMs = 100;
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    const value = own[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P5LifecycleUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--scenario': {
        const v = needValue();
        if (!isP5Scenario(v)) throw new P5LifecycleUsageError(`--scenario must be one of: ${P5_SCENARIOS.join(', ')}`);
        scenario = v;
        break;
      }
      case '--fixture': {
        const v = needValue();
        if (!isP5FixtureKind(v)) throw new P5LifecycleUsageError('--fixture must be bounded or real');
        fixtureKind = v;
        break;
      }
      case '--port': port = Number.parseInt(needValue(), 10); break;
      case '--https': https = true; break;
      case '--ready-timeout-ms': readyTimeoutMs = Number.parseInt(needValue(), 10); break;
      case '--shutdown-timeout-ms': shutdownTimeoutMs = Number.parseInt(needValue(), 10); break;
      case '--poll-interval-ms': pollIntervalMs = Number.parseInt(needValue(), 10); break;
      default: throw new P5LifecycleUsageError(`unknown flag: ${arg}`);
    }
  }
  const scheme = https ? 'https' : 'http';
  return {
    // `node <file>.ts` — bare type-stripping under native node, exactly as the P4 wrapper spawns its
    // fixture. process.execPath is the current node binary, so the child is the same runtime. The §8
    // surfaces are served by `p5FixtureServer.ts`, which serves EVERY boot route (incl. /api/home and
    // /api/attention) so no cell 404s on boot — the W6.5 fix over the reused p1 fixture.
    fixtureArgv: [
      process.execPath, 'server/testFixtures/p5FixtureServer.ts',
      '--scenario', scenario, '--fixture', fixtureKind, '--port', String(port), ...(https ? ['--https'] : []),
    ],
    clientArgv,
    readyUrl: `${scheme}://127.0.0.1:${port}/readyz`,
    readyTimeoutMs,
    shutdownTimeoutMs,
    pollIntervalMs,
  };
}

/**
 * Start the fixture, wait for ready, run the client, and tear the fixture down in `finally` on every
 * path. Returns the exit code the outer command should adopt. Identical control flow to the proven P4
 * wrapper, so the four teardown paths behave the same.
 */
export async function runP5FixtureLifecycle(
  options: P5FixtureLifecycleOptions,
  deps: P5FixtureLifecycleDeps,
): Promise<P5LifecycleExitCode> {
  const log = deps.log ?? (() => undefined);
  const fixtureChild = deps.spawn(options.fixtureArgv[0], options.fixtureArgv.slice(1));
  let fixtureExited = false;
  fixtureChild.once('exit', () => { fixtureExited = true; });

  const closeFixture = async (): Promise<void> => {
    if (fixtureExited) return;
    fixtureChild.kill('SIGTERM');
    const deadline = deps.now() + options.shutdownTimeoutMs;
    while (!fixtureExited && deps.now() < deadline) {
      await deps.sleep(Math.min(options.pollIntervalMs, options.shutdownTimeoutMs));
    }
    if (!fixtureExited) fixtureChild.kill('SIGKILL');
  };

  const disposeSignal = deps.onSignal(() => { void closeFixture(); });

  try {
    const readyDeadline = deps.now() + options.readyTimeoutMs;
    let ready = false;
    while (deps.now() < readyDeadline) {
      if (await deps.readyProbe(options.readyUrl)) { ready = true; break; }
      await deps.sleep(options.pollIntervalMs);
    }
    if (!ready) {
      log(`fixture never became ready at ${options.readyUrl}`);
      return P5_LIFECYCLE_EXIT.readyTimeout;
    }

    const clientChild = deps.spawn(options.clientArgv[0], options.clientArgv.slice(1));
    const clientExit = await new Promise<number>((resolvePromise) => {
      clientChild.once('exit', (code) => resolvePromise(code ?? P5_LIFECYCLE_EXIT.clientFailed));
      clientChild.once('error', () => resolvePromise(P5_LIFECYCLE_EXIT.clientFailed));
    });
    return clientExit;
  } finally {
    disposeSignal();
    await closeFixture();
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * Real OS deps for the CLI path. The ready probe and signal registration are the PROVEN P4 ones
 * (loopback-cert pinning included); only the spawn is defined here.
 * ------------------------------------------------------------------------------------------------ */

/** Spawn a bounded child in its own process, never `shell: true`. */
export function defaultLifecycleSpawn(command: string, args: readonly string[]): LifecycleChild {
  return spawn(command, [...args], { stdio: 'inherit', shell: false }) as ChildProcess;
}

/** The full real-dep set, so the CLI is one call. */
export function defaultP5FixtureLifecycleDeps(
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): P5FixtureLifecycleDeps {
  return {
    spawn: defaultLifecycleSpawn,
    readyProbe: defaultReadyProbe,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); }),
    onSignal: defaultOnSignal,
    log,
  };
}

/* ================================================================================================ *
 * §9 adversarial attack harness [P5-C24, plan §9, design 619's twelve probes].
 *
 * Each attack DRIVES A REAL PRODUCTION MODULE — never a same-belief stub that re-implements the check
 * (the P4 W6.4b lesson). A regression in helperClient / protocolCheck / deployReady / quiescence /
 * store.transitionDeployment / deploymentSubjects / actionResolver turns the owning attack red. Every
 * legitimate injection below is a real production seam (an in-memory `HelperFetch`, a `DeployReadyPort`,
 * a `CommitAncestryPort`, in-memory store ports) — exactly the boundaries production constructs the real
 * adapters over. The `--assert-isolated` guarantee: an attack writes ONLY under the gitignored
 * `.artifacts/` attack root, and the live worktree (`git status`/HEAD) is left byte-identical.
 * ================================================================================================ */

/** The frozen twelve §9 attack ids — MUST equal `p5AttackManifest.json` and `assertP5GateResults.ts`. */
export const P5_ATTACK_IDS = [
  'forged-node', 'forged-source', 'forged-attestation', 'unknown-verb', 'unknown-field', 'repeat-key',
  'cooldown', 'stale-revision', 'active-pty', 'failed-swap', 'rollback', 'misleading-symlink',
] as const;
export type P5AttackId = (typeof P5_ATTACK_IDS)[number];

export function isP5AttackId(value: string): value is P5AttackId {
  return (P5_ATTACK_IDS as readonly string[]).includes(value);
}

export class P5AttackIsolationError extends Error {
  constructor(message: string) { super(message); this.name = 'P5AttackIsolationError'; }
}

/** The record every probe emits — exactly the shape `assertP5GateResults.ts` reads (id/passed/assertion/path). */
export interface P5AttackResult {
  readonly id: P5AttackId;
  readonly passed: boolean;
  /** A nonempty human-readable statement of the REAL module driven and its refusal. */
  readonly assertion: string;
  /** The artifact file this probe wrote (under the gitignored attack root). */
  readonly artifactPath: string;
  /** The real production symbols this probe exercised, so a result cannot be forged detached from them. */
  readonly drivenModules: readonly string[];
}

// --- shared fixture constants (valid wire shapes) -------------------------------------------------
const TARGET_SHA = 'a'.repeat(40);
const PREVIOUS_SHA = 'b'.repeat(40);
const ATTEST_DIGEST = 'c'.repeat(64);
const HELPER_ORIGIN = 'https://vm.fixture.ts.net';
const REQUEST_REF = 'deploy-request-1';
const TS = '2026-08-25T00:00:00.000Z';

function deployRequest(): HelperRequest {
  return { verb: 'deploy', sourceCommit: TARGET_SHA, attestationDigest: ATTEST_DIGEST, requestRef: REQUEST_REF };
}

interface HelperReceiptShape {
  time: string; requestRef: string; shortSha: string; callerNode: string; outcome: string;
  [extra: string]: unknown;
}

function acceptedReceipt(overrides: Partial<HelperReceiptShape> = {}): HelperReceiptShape {
  return { time: TS, requestRef: REQUEST_REF, shortSha: 'abcdef0', callerNode: 'vm-node', outcome: 'accepted', ...overrides };
}

/** An in-memory `HelperFetch` that answers the version handshake and one invoke, counting invoke POSTs. */
function helperFetch(receipt: unknown): { fetch: HelperFetch; invokePosts: () => number } {
  let invokePosts = 0;
  const fetch: HelperFetch = async (url, init): Promise<HelperFetchResponse> => {
    if (init.method === 'GET' && url.includes('/deploy-helper/protocol')) {
      return { ok: true, status: 200, json: async () => ({ version: 'deploy/v1' }) };
    }
    if (init.method === 'POST' && url.includes('/deploy-helper/invoke')) {
      invokePosts += 1;
      return { ok: true, status: 200, json: async () => receipt };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, invokePosts: () => invokePosts };
}

// --- on-disk release-tree helper (deployReady drives real fs) -------------------------------------
interface WriteReleaseOptions {
  sha?: string;
  sourceCommit?: string;
  archiveDigest?: string;
  breaking?: boolean;
  /** Record a BREAKING manifest digest that DISAGREES with the file's bytes → whole candidate refused. */
  tamperBreakingDigest?: boolean;
  /** Make the VERSION sidecar a symlink escaping the release root → readContained refuses it. */
  escapeVersionSidecar?: boolean;
  escapeTargetDir?: string;
}

/** Build a release tree the REAL `createDeployReadyReader` reads; returns the release root. */
function writeReleaseTree(root: string, options: WriteReleaseOptions = {}): string {
  const sha = options.sha ?? TARGET_SHA;
  const sourceCommit = options.sourceCommit ?? sha;
  const archiveDigest = options.archiveDigest ?? ATTEST_DIGEST;
  mkdirSync(root, { recursive: true });
  const manifestLines: string[] = [];
  const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
  const attestation = Buffer.from(JSON.stringify({ workflow: 'kb-platform-release', sourceCommit, sha256: archiveDigest }));
  const versionBytes = Buffer.from(`${sha}\n`);
  // A real MANIFEST.sha256 lists the sidecars; the reader only re-verifies the BREAKING marker, but the
  // manifest must be NON-EMPTY (an empty MANIFEST is refused as a disagreeing sidecar).
  manifestLines.push(`${digest(attestation)}  attestation.json`);
  if (options.escapeVersionSidecar === true) {
    const outside = options.escapeTargetDir ?? mkdtempSync(join(tmpdir(), 'p5-escape-'));
    mkdirSync(outside, { recursive: true });
    const realVersion = join(outside, 'VERSION');
    writeFileSync(realVersion, versionBytes);
    trySymlink(realVersion, join(root, 'VERSION'));
  } else {
    writeFileSync(join(root, 'VERSION'), versionBytes);
    manifestLines.push(`${digest(versionBytes)}  VERSION`);
  }
  if (options.breaking === true) {
    const markerBytes = Buffer.from('breaking\n');
    writeFileSync(join(root, 'BREAKING'), markerBytes);
    const recorded = options.tamperBreakingDigest === true
      ? 'f'.repeat(64) // a digest that disagrees with the actual bytes → readBreaking refuses.
      : digest(markerBytes);
    manifestLines.push(`${recorded}  BREAKING`);
  }
  writeFileSync(join(root, 'attestation.json'), attestation);
  writeFileSync(join(root, 'MANIFEST.sha256'), `${manifestLines.join('\n')}\n`);
  return root;
}

function trySymlink(target: string, linkPath: string): void {
  try { symlinkSync(target, linkPath); return; } catch { /* retry with an explicit type on Windows */ }
  symlinkSync(target, linkPath, 'file');
}

// --- store helpers (real in-memory control store) -------------------------------------------------
function createRequestedDeployment(store: ReturnType<typeof createInMemoryControlPlaneStore>): Deployment {
  const created = store.createDeployment('deployment', {
    deploymentRef: `deploy-ready:${TARGET_SHA}`,
    idempotencyKey: `deploy:${TARGET_SHA}`,
    initialState: 'requested',
    targetCommit: TARGET_SHA,
    previousCommit: PREVIOUS_SHA,
    requestedAt: TS,
    parkWarnAt: '2026-08-25T00:01:30.000Z',
  });
  if (!created.ok) throw new Error(`fixture createDeployment failed: ${created.reason} ${created.detail}`);
  return created.value;
}

function advanceDeployment(
  store: ReturnType<typeof createInMemoryControlPlaneStore>,
  ref: string, expectedRevision: number, expectedState: DeploymentState,
  nextState: DeploymentState, patch: DeploymentTransitionPatch,
): Deployment {
  const result = store.transitionDeployment('system', ref, {
    expectedRevision, expectedState, nextState,
    idempotencyKey: `${nextState}:${ref}:${expectedRevision}`, patch,
  });
  if (!result.ok) throw new Error(`fixture advance to ${nextState} failed: ${result.reason} ${result.detail}`);
  return result.value;
}

// --- deploy-ready candidate via a real DeployReadyPort double (the production injection seam) ------
function candidatePort(candidate: DeployReadyCandidate | null): DeployReadyPort {
  return { latestCandidate: () => candidate };
}

// ---------------------------------------------------------------------------------------------------
// The twelve probes. Each returns { assertion, drivenModules } on success, or throws on failure.
// ---------------------------------------------------------------------------------------------------

type ProbeOutcome = { assertion: string; drivenModules: string[] };
type AttackProbe = () => Promise<ProbeOutcome>;

const ATTACK_PROBES: Record<P5AttackId, AttackProbe> = {
  'forged-node': async () => {
    // The pinned-VM node check lives in the desktop helper (which owns the signer); the dashboard never
    // learns its path and observes the refusal as a receipt whose outcome is `refused`. The REAL
    // helperClient decodes that receipt (real decodeHelperReceipt + protocol wall) and maps it to
    // `helper-refused`, never `accepted` — no signer output is ever trusted.
    const forged = acceptedReceipt({ callerNode: 'attacker-node-not-the-pinned-vm', outcome: 'refused' });
    const { fetch, invokePosts } = helperFetch(forged);
    const client = createHelperClient({ origin: HELPER_ORIGIN, fetch, now: () => 0 });
    const result = await client.invoke(deployRequest(), { idempotencyKey: 'forged-node-1' });
    if (result.ok) throw new Error('a forged-node refused receipt was accepted');
    if (result.code !== 'helper-refused') throw new Error(`expected helper-refused, got ${result.code}`);
    if (invokePosts() !== 1) throw new Error('the client did not send exactly one bounded invoke');
    return {
      assertion: 'REAL helperClient.invoke + decodeHelperReceipt: a receipt whose caller node is not the pinned VM carries outcome:"refused" (the helper refused before any signer call), which the dashboard maps to helper-refused and never accepts.',
      drivenModules: ['deploy/helperClient.ts#createHelperClient.invoke', 'deploy/contracts.ts#decodeHelperReceipt'],
    };
  },

  'forged-source': async () => {
    // A real on-disk release yields a real candidate via the REAL deployReady reader; the REAL Inbox
    // deploy-ready gate (projectDeployReadyItem) refuses to emit any subject when the candidate sha is
    // not a strict descendant of the live sha — so no Deploy action is offered and no helper request is
    // ever formed. A strict-descendant candidate DOES project (positive control), proving the gate.
    const root = mkdtempSync(join(tmpdir(), 'p5-src-'));
    try {
      const releaseRoot = writeReleaseTree(join(root, 'release'));
      const candidate = createDeployReadyReader({ currentPath: releaseRoot }).latestCandidate();
      if (candidate === null) throw new Error('fixture release did not yield a candidate');
      const deployments: DeploymentsReaderPort = { listDeployments: () => [] };
      const liveRelease: LiveReleasePort = { liveSha: () => PREVIOUS_SHA };
      const forgedAncestry: CommitAncestryPort = { isStrictDescendant: () => false };
      const legitAncestry: CommitAncestryPort = { isStrictDescendant: () => true };
      const now = new Date(TS);
      const refused = projectDeployReadyItem({
        deployReady: candidatePort(candidate), liveRelease, ancestry: forgedAncestry, deployments, now,
      });
      if (refused !== null) throw new Error('the real gate emitted a subject for a non-descendant source');
      const accepted = projectDeployReadyItem({
        deployReady: candidatePort(candidate), liveRelease, ancestry: legitAncestry, deployments, now,
      });
      if (accepted === null) throw new Error('the real gate wrongly dropped a strict-descendant candidate');
      return {
        assertion: 'REAL deployReady.createDeployReadyReader + inbox/deploymentSubjects.projectDeployReadyItem: a candidate whose sourceCommit is not a strict descendant of the live sha yields NO deploy-ready subject (no Deploy offered, no request formed); a strict-descendant candidate does project.',
        drivenModules: ['deploy/deployReady.ts#createDeployReadyReader', 'inbox/deploymentSubjects.ts#projectDeployReadyItem'],
      };
    } finally { rmSync(root, { recursive: true, force: true }); }
  },

  'forged-attestation': async () => {
    // The REAL deployReady reader verifies the release's recorded digests against the actual bytes: a
    // BREAKING marker whose MANIFEST.sha256 digest disagrees with its bytes is a tampered tree, so the
    // WHOLE candidate is refused (null) — never partially trusted, never a guessed SHA. A matching tree
    // yields a candidate (positive control).
    const root = mkdtempSync(join(tmpdir(), 'p5-attest-'));
    try {
      const good = createDeployReadyReader({
        currentPath: writeReleaseTree(join(root, 'good'), { breaking: true }),
      }).latestCandidate();
      if (good === null || good.breaking !== true) throw new Error('a well-formed breaking release did not yield a candidate');
      const tampered = createDeployReadyReader({
        currentPath: writeReleaseTree(join(root, 'bad'), { breaking: true, tamperBreakingDigest: true }),
      }).latestCandidate();
      if (tampered !== null) throw new Error('a digest-tampered release yielded a candidate (partial trust)');
      return {
        assertion: 'REAL deployReady.createDeployReadyReader: a release whose recorded MANIFEST.sha256 digest disagrees with the actual bytes is refused wholesale (latestCandidate() → null, no partial activation, no guessed SHA); a matching release yields a candidate.',
        drivenModules: ['deploy/deployReady.ts#createDeployReadyReader (readBreaking/manifestDigestFor digest verification)'],
      };
    } finally { rmSync(root, { recursive: true, force: true }); }
  },

  'unknown-verb': async () => {
    // The REAL protocol.schema.json wall (assertRequestValid, driven through helperClient.invoke): a verb
    // outside the movement:235 union fails the schema `oneOf` closed, so invoke returns protocol-invalid
    // and sends NO request (the invoke POST count stays 0). No store is touched (none is constructed).
    const { fetch, invokePosts } = helperFetch(acceptedReceipt());
    const client = createHelperClient({ origin: HELPER_ORIGIN, fetch, now: () => 0 });
    const bogus = { verb: 'rollback', sourceCommit: TARGET_SHA, attestationDigest: ATTEST_DIGEST, requestRef: REQUEST_REF } as unknown as HelperRequest;
    const result = await client.invoke(bogus, { idempotencyKey: 'unknown-verb-1' });
    if (result.ok) throw new Error('an unknown verb was accepted');
    if (result.code !== 'protocol-invalid') throw new Error(`expected protocol-invalid, got ${result.code}`);
    if (invokePosts() !== 0) throw new Error('an unknown verb still sent a request');
    return {
      assertion: 'REAL deploy/helper/protocolCheck.assertRequestValid via helperClient.invoke: a verb outside the movement:235 union fails the protocol.schema.json oneOf closed → protocol-invalid, no request sent (0 invoke POSTs), no store write.',
      drivenModules: ['deploy/helper/protocolCheck.ts#assertRequestValid', 'deploy/contracts.ts#encodeHelperRequest', 'deploy/helperClient.ts#invoke'],
    };
  },

  'unknown-field': async () => {
    // Both directions of the REAL schema wall. An OUTBOUND request carrying an extra field fails
    // assertRequestValid (additionalProperties:false) → protocol-invalid, no request. An INBOUND receipt
    // carrying an extra key fails assertReceiptValid inside transport → protocol-invalid, never stored.
    const outbound = helperFetch(acceptedReceipt());
    const outClient = createHelperClient({ origin: HELPER_ORIGIN, fetch: outbound.fetch, now: () => 0 });
    const extraField = { ...deployRequest(), extra: 'x' } as unknown as HelperRequest;
    const outResult = await outClient.invoke(extraField, { idempotencyKey: 'unknown-field-out' });
    if (outResult.ok || outResult.code !== 'protocol-invalid') throw new Error('an extra request field was not refused protocol-invalid');
    if (outbound.invokePosts() !== 0) throw new Error('an extra request field still sent a request');

    const inbound = helperFetch(acceptedReceipt({ signature: 'deadbeef' }));
    const inClient = createHelperClient({ origin: HELPER_ORIGIN, fetch: inbound.fetch, now: () => 0 });
    const inResult = await inClient.invoke(deployRequest(), { idempotencyKey: 'unknown-field-in' });
    if (inResult.ok) throw new Error('a receipt with an extra key was accepted');
    if (inResult.code !== 'protocol-invalid') throw new Error(`expected protocol-invalid for extra receipt key, got ${inResult.code}`);
    return {
      assertion: 'REAL protocolCheck.assertRequestValid + assertReceiptValid (protocol.schema.json additionalProperties:false, both directions): an extra request field fails closed with no request sent; an extra receipt key (e.g. a signature-shaped field) fails closed as protocol-invalid and is never stored.',
      drivenModules: ['deploy/helper/protocolCheck.ts#assertRequestValid', 'deploy/helper/protocolCheck.ts#assertReceiptValid', 'deploy/contracts.ts#decodeHelperReceipt'],
    };
  },

  'repeat-key': async () => {
    // The REAL helperClient idempotency cache: the same verb+idempotencyKey returns the identical original
    // result and opens NO second request (the invoke POST count stays 1 across two invokes).
    const { fetch, invokePosts } = helperFetch(acceptedReceipt());
    const client = createHelperClient({ origin: HELPER_ORIGIN, fetch, now: () => 0 });
    const first = await client.invoke(deployRequest(), { idempotencyKey: 'repeat-1' });
    const second = await client.invoke(deployRequest(), { idempotencyKey: 'repeat-1' });
    if (!first.ok || !second.ok) throw new Error('a legitimate accepted deploy was refused');
    if (first !== second) throw new Error('the repeated key returned a different result object');
    if (invokePosts() !== 1) throw new Error(`the repeated key opened a second request (${invokePosts()} POSTs)`);
    return {
      assertion: 'REAL helperClient.invoke idempotency cache: a repeat of the same verb+idempotencyKey returns the identical original receipt and opens no second request (exactly 1 invoke POST across two invokes).',
      drivenModules: ['deploy/helperClient.ts#createHelperClient.invoke (idempotent replay)'],
    };
  },

  'cooldown': async () => {
    // The REAL movement:235 one-deploy-plus-five-minute cooldown: a SECOND deploy (a distinct key, so not
    // an idempotent replay) within DEPLOY_COOLDOWN_MS is refused helper-refused and opens NO second
    // request — the slot is consumed before transport, so no swap can begin.
    const { fetch, invokePosts } = helperFetch(acceptedReceipt());
    let clock = 1_000_000;
    const client = createHelperClient({ origin: HELPER_ORIGIN, fetch, now: () => clock });
    const first = await client.invoke(deployRequest(), { idempotencyKey: 'cooldown-1' });
    if (!first.ok) throw new Error('the first deploy was refused');
    clock += 60_000; // two minutes < five-minute cooldown
    const second = await client.invoke(deployRequest(), { idempotencyKey: 'cooldown-2' });
    if (second.ok) throw new Error('a second deploy inside the cooldown was accepted');
    if (second.code !== 'helper-refused') throw new Error(`expected helper-refused, got ${second.code}`);
    if (invokePosts() !== 1) throw new Error(`the cooled-down deploy still sent a request (${invokePosts()} POSTs)`);
    return {
      assertion: 'REAL helperClient cooldown (DEPLOY_COOLDOWN_MS): a second deploy under a distinct key within five minutes is refused helper-refused and sends no second request (1 invoke POST total) — no swap begins.',
      drivenModules: ['deploy/helperClient.ts#createHelperClient.invoke (movement:235 cooldown)'],
    };
  },

  'stale-revision': async () => {
    // The REAL control-store CAS: a transition pinned to an outdated expectedRevision is refused
    // dashboard-side with reason:"conflict" (surfaced 409 revision-changed) BEFORE any helper is
    // constructed, and the stored record's state and revision are left untouched.
    const store = createInMemoryControlPlaneStore();
    const created = createRequestedDeployment(store);
    const ref = created.deploymentRef;
    const stale = store.transitionDeployment('system', ref, {
      expectedRevision: created.revision + 99, // an outdated / wrong revision
      expectedState: 'requested', nextState: 'parked',
      idempotencyKey: `stale:${ref}`,
      patch: { blockers: [], progress: { kind: 'parked', attemptRef: null, since: TS, detail: null } },
    });
    if (stale.ok) throw new Error('a stale-revision transition was accepted');
    if (stale.reason !== 'conflict') throw new Error(`expected conflict, got ${stale.reason}`);
    const after = store.listDeployments().find((d) => d.deploymentRef === ref);
    if (!after || after.state !== 'requested' || after.revision !== created.revision) {
      throw new Error('the stored deployment was mutated despite the stale refusal');
    }
    return {
      assertion: 'REAL control/store.transitionDeployment CAS: a transition pinned to an outdated expectedRevision returns reason:"conflict" (dashboard-side 409 revision-changed) with no helper invoked and the stored state/revision unchanged.',
      drivenModules: ['control/store.ts#transitionDeployment (revision CAS)'],
    };
  },

  'active-pty': async () => {
    // Two real facts. (1) The REAL action resolver: a pre-swap deployment with live blocking PTYs offers
    // ONLY close-ptys-and-continue. (2) The REAL closePtysAndContinue: a closeAndWait timeout (a non-ok
    // close) refuses pty-not-confirmed and NEVER calls the store, so the revision is untouched.
    const ptyId = `pty-${'0'.repeat(32)}`;
    const action = resolveDeploymentAction({
      state: 'parked', deploymentRef: 'deployment-1', blockingPtyIds: [ptyId], abortRequestedAt: null, breaking: false,
    });
    if (action.mutating?.verb !== 'close-ptys-and-continue') {
      throw new Error(`a blocked deployment offered ${String(action.mutating?.verb)}, not close-ptys-and-continue`);
    }
    let transitionCalls = 0;
    const result = await closePtysAndContinue(
      {
        store: { transitionDeployment: () => { transitionCalls += 1; throw new Error('store must not be called on refusal'); } },
        liveSessions: { listLiveSessionIds: () => [ptyId] },
        closeSessions: async () => ({ ok: false, refusal: 'internal', detail: 'closeAndWait timed out' }),
        now: () => TS,
      },
      { deploymentRef: 'deployment-1', expectedRevision: 1, sessionIds: [ptyId] },
    );
    if (result.ok) throw new Error('an unconfirmed pty close advanced the deployment');
    if (result.refusal !== 'pty-not-confirmed') throw new Error(`expected pty-not-confirmed, got ${result.refusal}`);
    if (transitionCalls !== 0) throw new Error('the store was called despite the pty-not-confirmed refusal');
    return {
      assertion: 'REAL actionResolver.resolveDeploymentAction + deploy/quiescence.closePtysAndContinue: a live-PTY deployment offers only close-ptys-and-continue, and a closeAndWait timeout refuses pty-not-confirmed without ever calling the store (revision untouched).',
      drivenModules: ['inbox/deploymentContracts.ts#resolveDeploymentAction', 'deploy/quiescence.ts#closePtysAndContinue'],
    };
  },

  'failed-swap': async () => {
    // The REAL store lands a swap failure in `failed` with the error retained (edges only permit
    // failed→acknowledged), and the REAL action resolver offers ONLY Acknowledge on a failed record —
    // never a fabricated success.
    const store = createInMemoryControlPlaneStore();
    const created = createRequestedDeployment(store);
    const ref = created.deploymentRef;
    const parked = advanceDeployment(store, ref, created.revision, 'requested', 'parked', {
      blockers: [], progress: { kind: 'parked', attemptRef: null, since: TS, detail: null },
    });
    const swapping = advanceDeployment(store, ref, parked.revision, 'parked', 'swapping', {
      blockers: [], progress: { kind: 'swapping', attemptRef: null, since: TS, detail: null },
    });
    const failed = advanceDeployment(store, ref, swapping.revision, 'swapping', 'failed', {
      error: 'swap failed: activation symlink refused',
      terminalOutcome: { kind: 'failed', at: TS, by: 'system' },
    });
    if (failed.state !== 'failed') throw new Error(`expected failed, got ${failed.state}`);
    if (failed.error !== 'swap failed: activation symlink refused') throw new Error('the swap error was not retained');
    const action = resolveDeploymentAction({
      state: 'failed', deploymentRef: ref, blockingPtyIds: [], abortRequestedAt: null, breaking: false,
    });
    if (action.mutating?.verb !== 'acknowledge') throw new Error(`a failed deployment offered ${String(action.mutating?.verb)}, not acknowledge`);
    if (action.mutating.t3 !== false) throw new Error('Acknowledge must be operator-gated, not T3');
    return {
      assertion: 'REAL control/store.transitionDeployment + actionResolver.resolveDeploymentAction: an injected swap failure lands the record in `failed` with the error retained, and the only control offered is (non-T3) Acknowledge — no success is fabricated.',
      drivenModules: ['control/store.ts#transitionDeployment', 'inbox/deploymentContracts.ts#resolveDeploymentAction'],
    };
  },

  'rollback': async () => {
    // A rollback is a movement §2.5 transition, NEVER an Inbox verb. The REAL actionResolver rejects
    // `rollback` as an unknown mutating verb, and the REAL DeploymentService.abort refuses any state
    // outside requested|parked (409 abort-not-allowed) — so no Inbox Abort can ever effect a rollback.
    let rejectedUnknownVerb = false;
    try { assertKnownMutatingVerb('rollback'); } catch { rejectedUnknownVerb = true; }
    if (!rejectedUnknownVerb) throw new Error('the resolver accepted `rollback` as a mutating verb');
    // The direct-Abort predicate refuses the swap-family states (never abortable) per movement:115.
    for (const state of ['waiting-confirmation', 'swapping', 'resuming'] as const) {
      const attempt = resolveAbortAttempt(state);
      if (attempt.allowed || attempt.status !== 409) throw new Error(`a direct Abort at ${state} was not refused 409`);
    }
    const store = createInMemoryControlPlaneStore();
    const service = new DeploymentService({ store, now: () => new Date(TS) });
    let abortRefused = false;
    try { service.abort(`deploy-ready:${TARGET_SHA}`, 1, 'swapping'); } catch (error) {
      abortRefused = error instanceof Error && /abort-not-allowed/.test(error.message);
    }
    if (!abortRefused) throw new Error('DeploymentService.abort did not refuse a swapping-state abort');
    return {
      assertion: 'REAL actionResolver.assertKnownMutatingVerb + resolveAbortAttempt + DeploymentService.abort: `rollback` is not an Inbox mutating verb; direct Abort is refused 409 at waiting-confirmation/swapping/resuming; and the service refuses abort outside requested|parked — a rollback (movement §2.5) is never reachable as an Inbox Abort.',
      drivenModules: ['inbox/actionResolver.ts#assertKnownMutatingVerb', 'inbox/actionResolver.ts#resolveAbortAttempt', 'deploy/deploymentService.ts#abort'],
    };
  },

  'misleading-symlink': async () => {
    // The REAL release reader's containment guard: a release sidecar that is a symlink escaping the
    // resolved release root is refused by readContained (realpathSync + contained), so latestCandidate()
    // reports UNAVAILABLE (null) rather than reading an out-of-root file and fabricating a SHA. A normal
    // tree yields a candidate (positive control).
    const root = mkdtempSync(join(tmpdir(), 'p5-symlink-'));
    try {
      const legit = createDeployReadyReader({ currentPath: writeReleaseTree(join(root, 'ok')) }).latestCandidate();
      if (legit === null) throw new Error('a normal release tree did not yield a candidate');
      const escapeRoot = writeReleaseTree(join(root, 'evil'), { escapeVersionSidecar: true, escapeTargetDir: join(root, 'outside') });
      if (!lstatSync(join(escapeRoot, 'VERSION')).isSymbolicLink()) {
        throw new Error('the OS did not create a symlink; cannot exercise the containment refusal');
      }
      const escaped = createDeployReadyReader({ currentPath: escapeRoot }).latestCandidate();
      if (escaped !== null) throw new Error('an escaping sidecar symlink yielded a candidate (a wrong SHA)');
      return {
        assertion: 'REAL deployReady.createDeployReadyReader containment guard (realpathSync + contained): a release VERSION sidecar symlinked outside the resolved release root is refused → latestCandidate() reports unavailable (null), never an out-of-root/wrong SHA; a normal tree yields a candidate.',
        drivenModules: ['deploy/deployReady.ts#createDeployReadyReader (readContained/contained symlink-escape refusal)'],
      };
    } finally { rmSync(root, { recursive: true, force: true }); }
  },
};

// ---------------------------------------------------------------------------------------------------
// Attack runner + isolation + artifact writer.
// ---------------------------------------------------------------------------------------------------

function liveWorktreeRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

interface WorktreeSnapshot { head: string; status: string }

function snapshotWorktree(root: string): WorktreeSnapshot {
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    status: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }),
  };
}

/** The artifact dir must be gitignored `.artifacts/**` and never a git-tracked path in the live tree. */
export function assertArtifactDirIsolated(artifactDir: string, liveRoot: string): void {
  const resolved = resolve(artifactDir);
  const artifactsRoot = join(resolve(liveRoot), 'dashboard', '.artifacts');
  const withinDashboard = join(resolve(liveRoot), 'dashboard') === process.cwd()
    ? join(process.cwd(), '.artifacts') : artifactsRoot;
  const isUnder = (child: string, parent: string): boolean => {
    const c = resolve(child); const p = resolve(parent);
    return c === p || c.startsWith(p + sep) || c.startsWith(`${p}/`);
  };
  if (!isUnder(resolved, withinDashboard) && !isUnder(resolved, artifactsRoot)
    && !/[/\\]\.artifacts[/\\]/.test(resolved + sep)) {
    throw new P5AttackIsolationError(`--artifact-dir must live under the gitignored .artifacts/ tree, got ${resolved}`);
  }
}

/**
 * Run one attack. Writes `<artifactDir>/<id>.json`; when the artifact dir's basename is the attack id
 * (the plan §9 per-case `--artifact-dir .artifacts/p5-attacks/<case>` convention) the same artifact is
 * ALSO mirrored FLAT into the parent so `assertP5GateResults --attack-root .artifacts/p5-attacks` (which
 * reads the parent flatly for `<id>.json`) finds all twelve. Both paths are gitignored `.artifacts/`.
 */
export async function runP5Attack(
  id: P5AttackId, artifactDir: string, options: { assertIsolated?: boolean } = {},
): Promise<P5AttackResult> {
  const liveRoot = options.assertIsolated ? liveWorktreeRoot() : null;
  if (options.assertIsolated && liveRoot) assertArtifactDirIsolated(artifactDir, liveRoot);
  const before = options.assertIsolated && liveRoot ? snapshotWorktree(liveRoot) : null;

  const resolvedDir = resolve(artifactDir);
  mkdirSync(resolvedDir, { recursive: true });
  const artifactPath = join(resolvedDir, `${id}.json`);

  let passed = false;
  let assertion = '';
  let drivenModules: string[] = [];
  try {
    const outcome = await ATTACK_PROBES[id]();
    assertion = outcome.assertion;
    drivenModules = outcome.drivenModules;
    passed = assertion.trim().length > 0 && drivenModules.length > 0;
  } catch (error) {
    assertion = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
    passed = false;
  }

  const result: P5AttackResult = { id, passed, assertion, artifactPath, drivenModules };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(artifactPath, serialized);
  if (basename(resolvedDir) === id) {
    writeFileSync(join(dirname(resolvedDir), `${id}.json`), serialized);
  }

  if (options.assertIsolated && liveRoot && before) {
    const after = snapshotWorktree(liveRoot);
    if (after.head !== before.head) throw new P5AttackIsolationError(`live worktree HEAD changed: ${before.head} -> ${after.head}`);
    if (after.status !== before.status) throw new P5AttackIsolationError('live worktree git status changed — the attack wrote outside .artifacts/');
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------
// CLI dispatcher: `--attack <case>` runs the §9 attack harness; otherwise the §8 browser lifecycle.
// ---------------------------------------------------------------------------------------------------

export interface P5AttackCliArgs {
  readonly attack: P5AttackId;
  readonly artifactDir: string;
  readonly assertIsolated: boolean;
}

export function parseP5AttackCliArgs(argv: readonly string[]): P5AttackCliArgs {
  let attack: P5AttackId | null = null;
  let artifactDir: string | null = null;
  let assertIsolated = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P5LifecycleUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--attack': {
        const v = needValue();
        if (!isP5AttackId(v)) throw new P5LifecycleUsageError(`unknown attack: ${v} (one of ${P5_ATTACK_IDS.join(', ')})`);
        attack = v;
        break;
      }
      case '--artifact-dir': artifactDir = needValue(); break;
      case '--assert-isolated': assertIsolated = true; break;
      default: throw new P5LifecycleUsageError(`unknown flag: ${arg}`);
    }
  }
  if (attack === null) throw new P5LifecycleUsageError('--attack <case> is required');
  if (artifactDir === null) throw new P5LifecycleUsageError('--artifact-dir <dir> is required');
  return { attack, artifactDir, assertIsolated };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = (line: string): void => { process.stderr.write(`${line}\n`); };
  const argv = process.argv.slice(2);
  if (argv.includes('--attack')) {
    void (async () => {
      try {
        const args = parseP5AttackCliArgs(argv);
        const result = await runP5Attack(args.attack, args.artifactDir, { assertIsolated: args.assertIsolated });
        log(`attack ${result.id}: ${result.passed ? 'PASS' : 'FAIL'} — ${result.assertion}`);
        process.exitCode = result.passed ? 0 : 1;
      } catch (error) {
        log(error instanceof Error ? error.message : String(error));
        process.exitCode = P5_LIFECYCLE_EXIT.usage;
      }
    })();
  } else {
    try {
      const options = parseP5FixtureLifecycleArgs(argv);
      void runP5FixtureLifecycle(options, defaultP5FixtureLifecycleDeps(log))
        .then((code) => { process.exitCode = code; });
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      process.exitCode = P5_LIFECYCLE_EXIT.usage;
    }
  }
}

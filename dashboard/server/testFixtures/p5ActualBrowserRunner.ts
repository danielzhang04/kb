/**
 * P5 W6.1/W6.4 — the browser matrix runner for the §8 Inbox deployment + asset-pull proofs.
 *
 * The P5 analogue of {@link file://./p4ActualBrowserRunner.ts}: every browser matrix runs light/dark,
 * keyboard-only, reduced motion, and 375/768/1440 widths; each artifact records fixture kind, scenario,
 * commit, viewport, and timestamp (plan §8). This module owns the P5 matrix enumeration, the P5 Inbox
 * scenario set (the four-source envelope plus the deployment / asset-pull / deployment-escalation arms),
 * and the artifact envelope; the §8 command runs it under {@link runP5FixtureLifecycle} so a fixture
 * server is always up first and torn down after.
 *
 * The matrix is a pure function so the enumeration (its completeness) is proven without a real browser,
 * and the per-cell capture seam is injected so the suite exercises a failing cell without launching
 * Chromium. The REAL capture reuses the PROVEN P3 CDP driver verbatim, exactly as the P4 runner does.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLoopbackCertificate } from './p3LoopbackTls.ts';
import {
  assessReachedTheApp, defaultExecutableInspector, defaultLaunchCdpBrowser, resolveSpkiPin,
  type ActualBrowserFactory, type CertificateReader, type ExecutableInspector,
} from './p3ActualBrowserRunner.ts';

/** design:522 fixes exactly two widths for P5 — desktop (1440) and 720 px [P5-C40, plan §8 line 380]. */
export const P5_VIEWPORT_WIDTHS = [1440, 720] as const;
export const P5_THEMES = ['light', 'dark'] as const;
export type P5Theme = (typeof P5_THEMES)[number];

/** The seven §8 browser scenarios (plan §8 lines 388-394). `bounded` vs `real` is the fixture kind. */
export const P5_SCENARIOS = [
  'deployment-action-matrix',
  'asset-pull-digest',
  'pty-quiescence-refusal',
  't3-missing-ceremony',
  'health-bounded-probe-failure',
  'home-health-live-release',
  'no-deploy-destination',
] as const;
export type P5Scenario = (typeof P5_SCENARIOS)[number];

export function isP5Scenario(value: string): value is P5Scenario {
  return (P5_SCENARIOS as readonly string[]).includes(value);
}

/** The fixture kind each §8 row runs against — `bounded` (UI/projection) or `real` (registered ports). */
export const P5_FIXTURE_KINDS = ['bounded', 'real'] as const;
export type P5FixtureKind = (typeof P5_FIXTURE_KINDS)[number];
export function isP5FixtureKind(value: string): value is P5FixtureKind {
  return (P5_FIXTURE_KINDS as readonly string[]).includes(value);
}

/** The §8-line-388..394 mapping of scenario → the fixture kind its row runs against. */
export const P5_SCENARIO_FIXTURE: Readonly<Record<P5Scenario, P5FixtureKind>> = {
  'deployment-action-matrix': 'bounded',
  'asset-pull-digest': 'bounded',
  'pty-quiescence-refusal': 'real',
  't3-missing-ceremony': 'real',
  'health-bounded-probe-failure': 'real',
  'home-health-live-release': 'real',
  'no-deploy-destination': 'bounded',
};

// ---------------------------------------------------------------------------------------------------
// P5 Inbox fixture data — the four-source envelope and the three new item kinds, in their wire shapes.
// The §8 browser matrix renders these; the suite additionally asserts each shape against the documented
// contract so the harness cannot serve a lookalike the real client would refuse.
// ---------------------------------------------------------------------------------------------------

/** The P4 `SourceState` union, VERBATIM (`unavailable|timeout|overflow|invalid`, `stale`) [P5-C48]. */
export type P5SourceErrorCode = 'unavailable' | 'timeout' | 'overflow' | 'invalid';
export type P5SourceState =
  | { readonly status: 'verified'; readonly revision: string; readonly verifiedAt: string; readonly stale?: true }
  | { readonly status: 'failed'; readonly revision?: string; readonly verifiedAt?: string; readonly errorCode: P5SourceErrorCode; readonly stale: boolean };

function itemId(prefix: string, ref: string): string {
  return createHash('sha256').update(`${prefix}\u0000${ref}`, 'utf8').digest('hex');
}
function contentHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
}

const DEPLOY_REF = 'deployment:12';
const DEPLOY_READY_REF = `deploy-ready:${'a'.repeat(40)}`;
const INTENT_REF = `assetpull-${'b'.repeat(32)}`;
const MANIFEST_DIGEST = 'c'.repeat(64);

/** One deployment arm item — at most one mutating control is a UI concern; the wire item carries state. */
export const P5_DEPLOYMENT_ITEM = {
  kind: 'deployment' as const,
  id: itemId('deployment', DEPLOY_REF),
  createdAt: '2026-08-25T12:00:00.000Z',
  revision: DEPLOY_REF,
  subject: { deploymentRef: DEPLOY_REF },
  title: 'Deploy 0123456789ab — parked',
  state: 'parked' as const,
  blockingPtyIds: [] as readonly string[],
};

/** The derived deploy-ready projection — no record, so `blockingPtyIds` is empty by construction. */
export const P5_DEPLOY_READY_ITEM = {
  kind: 'deployment' as const,
  id: itemId('deployment', DEPLOY_READY_REF),
  createdAt: '2026-08-25T12:01:00.000Z',
  revision: `deploy-ready:${'d'.repeat(64)}`,
  subject: { deploymentRef: DEPLOY_READY_REF },
  title: `Deploy ready: ${'a'.repeat(12)}`,
  state: 'deploy-ready' as const,
  blockingPtyIds: [] as readonly string[],
};

export const P5_ASSET_PULL_ITEM = {
  kind: 'asset-pull' as const,
  id: itemId('asset-pull', INTENT_REF),
  createdAt: '2026-08-25T12:02:00.000Z',
  revision: contentHash(INTENT_REF, 'failed', '2'),
  subject: { intentRef: INTENT_REF, runRef: 'run-2026-08-25', manifestDigest: MANIFEST_DIGEST },
  title: 'Pull assets for run-2026-08-25',
  state: 'failed' as const,
};

export const P5_DEPLOYMENT_ESCALATION_ITEM = {
  kind: 'deployment-escalation' as const,
  id: itemId('deployment-escalation', DEPLOY_REF),
  createdAt: '2026-08-25T12:03:00.000Z',
  revision: contentHash(DEPLOY_REF, '13', '2026-08-25T12:20:00.000Z'),
  subject: { deploymentRef: DEPLOY_REF },
  title: 'Deploy swap deadline expired at 2026-08-25T12:20:00.000Z',
  swapDeadlineAt: '2026-08-25T12:20:00.000Z',
};

export interface P5InboxEnvelope {
  readonly items: readonly Record<string, unknown>[];
  readonly revision: string;
  readonly sources: {
    readonly pr: P5SourceState;
    readonly escalation: P5SourceState;
    readonly deployment: P5SourceState;
    readonly assetPull: P5SourceState;
  };
}

const VERIFIED = (revision: string): P5SourceState =>
  ({ status: 'verified', revision, verifiedAt: '2026-08-25T12:00:00.000Z' });

/** The ten `ux-rules:3` rail destinations — NO deploy, deploys, or learnings entry [plan §8 line 401]. */
export const P5_RAIL_DESTINATIONS = [
  'home', 'inbox', 'schedules', 'terminal', 'agents', 'workflows', 'tasks', 'projects', 'files', 'health',
] as const;

/** The one injected activation `home-health-live-release` pins: Home chip and Health release row show it. */
export const P5_LIVE_ACTIVATION = {
  sha: 'a'.repeat(40),
  activatedAt: '2026-08-25T11:30:00.000Z',
  generatedAt: '2026-08-25T12:00:00.000Z',
} as const;

/**
 * The per-scenario fixture profile the §8 matrix drives. Each carries the four-source Inbox envelope its
 * boot needs plus the scenario-specific expectation the browser asserts (plan §8 lines 388-401). The two
 * source-failure scenarios still carry all four source states in the canonical fold order [P5-C31].
 */
export interface P5ScenarioProfile {
  readonly scenario: P5Scenario;
  readonly fixtureKind: P5FixtureKind;
  readonly surface: 'inbox' | 'health' | 'home' | 'rail';
  readonly inbox: P5InboxEnvelope;
  readonly railDestinations: readonly string[];
  /** Present only for `home-health-live-release`: the SHA Home's chip and Health's release row share. */
  readonly liveRelease: { readonly sha: string; readonly activatedAt: string; readonly generatedAt: string } | null;
  /** True when the scenario asserts `/deploy` + `/deploys` are 404 and absent from the rail. */
  readonly noDeployDestination: boolean;
  readonly assertsBullet: string;
}

const ALL_VERIFIED = {
  pr: VERIFIED('pr-1'), escalation: VERIFIED('esc-1'),
  deployment: VERIFIED('dep-1'), assetPull: VERIFIED('ap-1'),
} as const;

function inboxEnvelope(items: readonly Record<string, unknown>[], sources: P5InboxEnvelope['sources'], tag: string): P5InboxEnvelope {
  return { items, revision: contentHash(tag), sources };
}

export function p5ScenarioProfile(scenario: P5Scenario): P5ScenarioProfile {
  const base = {
    scenario, fixtureKind: P5_SCENARIO_FIXTURE[scenario], railDestinations: [...P5_RAIL_DESTINATIONS],
    liveRelease: null as P5ScenarioProfile['liveRelease'], noDeployDestination: false,
  };
  switch (scenario) {
    case 'deployment-action-matrix':
      return {
        ...base, surface: 'inbox',
        inbox: inboxEnvelope([P5_DEPLOYMENT_ITEM, P5_DEPLOY_READY_ITEM, P5_DEPLOYMENT_ESCALATION_ITEM], ALL_VERIFIED, 'deployment-action-matrix'),
        assertsBullet: 'every deployment state shows exactly the one state-valid action; the movement:254 split on one deploy-ready subject (Deploy when breaking:false, Confirm when breaking:true); no Decline control anywhere.',
      };
    case 'asset-pull-digest':
      return {
        ...base, surface: 'inbox',
        inbox: inboxEnvelope([P5_ASSET_PULL_ITEM], ALL_VERIFIED, 'asset-pull-digest'),
        assertsBullet: 'asset pull/retry act against the pinned manifestDigest (never taken from subject text); the digest is a 64-hex pin.',
      };
    case 'pty-quiescence-refusal':
      return {
        ...base, surface: 'inbox',
        inbox: inboxEnvelope([P5_DEPLOYMENT_ITEM], ALL_VERIFIED, 'pty-quiescence-refusal'),
        assertsBullet: '409 pty-set-changed and 409 pty-not-confirmed on the real store CAS + quiescence action; only close-ptys-and-continue is offered when blocked.',
      };
    case 't3-missing-ceremony':
      return {
        ...base, surface: 'inbox',
        inbox: inboxEnvelope([P5_DEPLOY_READY_ITEM], ALL_VERIFIED, 't3-missing-ceremony'),
        assertsBullet: '403 ceremony-unavailable on a direct call to a T3 deploy endpoint without a ceremony (disabled control in the UI, server refusal on the wire).',
      };
    case 'health-bounded-probe-failure':
      return {
        ...base, surface: 'health',
        inbox: inboxEnvelope([], ALL_VERIFIED, 'health-bounded-probe-failure'),
        assertsBullet: 'Health degrades exactly one row under each of three injected probe faults within the 2500 ms ceiling; every other row stays ready.',
      };
    case 'home-health-live-release':
      return {
        ...base, surface: 'home', liveRelease: P5_LIVE_ACTIVATION,
        inbox: inboxEnvelope([], ALL_VERIFIED, 'home-health-live-release'),
        assertsBullet: "Home's chip SHA equals Health's daemon-machine release-row SHA (one injected activation); <ago> derives from generatedAt and does not drift; neither surface changes when the checkout HEAD moves.",
      };
    case 'no-deploy-destination':
      return {
        ...base, surface: 'rail', noDeployDestination: true,
        inbox: inboxEnvelope([], ALL_VERIFIED, 'no-deploy-destination'),
        assertsBullet: 'the rail renders exactly the ten ux-rules:3 destinations with no Deploy/Learnings entry; /deploy and /deploys render not-found and GET /api/deploy + /api/deploys return 404.',
      };
    default:
      return assertNeverScenario(scenario);
  }
}

function assertNeverScenario(scenario: never): never {
  throw new Error(`unknown P5 scenario ${JSON.stringify(scenario)}`);
}

// ---------------------------------------------------------------------------------------------------
// Matrix enumeration + artifact envelope — the P4 shape, re-owned for P5.
// ---------------------------------------------------------------------------------------------------

export interface MatrixCell {
  readonly theme: P5Theme;
  readonly keyboardOnly: boolean;
  readonly reducedMotion: boolean;
  readonly width: number;
}

/** The full light/dark × keyboard-only × reduced-motion × {375,768,1440} matrix, in a stable order. */
export function enumerateMatrix(): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const theme of P5_THEMES) {
    for (const keyboardOnly of [false, true]) {
      for (const reducedMotion of [false, true]) {
        for (const width of P5_VIEWPORT_WIDTHS) {
          cells.push({ theme, keyboardOnly, reducedMotion, width });
        }
      }
    }
  }
  return cells;
}

export interface CellCaptureInput extends MatrixCell {
  readonly url: string;
}

export interface CellCapture {
  readonly reachedApp: boolean;
  readonly consoleErrors: readonly string[];
  readonly appRootHash: string;
}

export type CellCaptureFn = (input: CellCaptureInput) => Promise<CellCapture>;

export interface P5BrowserRunOptions {
  readonly fixtureKind: string;
  readonly scenario: string;
  readonly commit: string;
  readonly originUrl: string;
  readonly artifactDir: string;
  readonly cells?: readonly MatrixCell[];
}

export interface MatrixArtifact extends MatrixCell {
  readonly fixtureKind: string;
  readonly scenario: string;
  readonly commit: string;
  readonly timestamp: string;
  readonly reachedApp: boolean;
  readonly consoleErrors: readonly string[];
  readonly appRootHash: string;
  readonly passed: boolean;
}

export const P5_BROWSER_EXIT = { ok: 0, usage: 2, cellFailed: 65 } as const;

export class P5BrowserUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P5BrowserUsageError';
  }
}

export interface P5BrowserDeps {
  capture: CellCaptureFn;
  now: () => Date;
  writeArtifact?: (path: string, contents: string) => void;
  log?: (line: string) => void;
}

/** Run every matrix cell, writing one artifact per cell plus a summary. A cell that never reached the
 *  app or logged a console error fails the whole run (exit 65). */
export async function runP5BrowserMatrix(options: P5BrowserRunOptions, deps: P5BrowserDeps): Promise<number> {
  const write = deps.writeArtifact ?? ((path: string, contents: string) => writeFileSync(path, contents));
  const log = deps.log ?? (() => undefined);
  mkdirSync(resolve(options.artifactDir), { recursive: true });

  const artifacts: MatrixArtifact[] = [];
  let anyFailed = false;
  for (const cell of options.cells ?? enumerateMatrix()) {
    const capture = await deps.capture({ ...cell, url: options.originUrl });
    const passed = capture.reachedApp && capture.consoleErrors.length === 0;
    if (!passed) anyFailed = true;
    const artifact: MatrixArtifact = {
      ...cell,
      fixtureKind: options.fixtureKind,
      scenario: options.scenario,
      commit: options.commit,
      timestamp: deps.now().toISOString(),
      reachedApp: capture.reachedApp,
      consoleErrors: capture.consoleErrors,
      appRootHash: capture.appRootHash,
      passed,
    };
    artifacts.push(artifact);
    const name = `${cell.theme}-${cell.width}-${cell.keyboardOnly ? 'kbd' : 'mouse'}-${cell.reducedMotion ? 'reduced' : 'motion'}.json`;
    write(join(resolve(options.artifactDir), name), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  write(join(resolve(options.artifactDir), 'matrix.json'), `${JSON.stringify({ options, cells: artifacts.length, artifacts }, null, 2)}\n`);
  log(`browser matrix: ${artifacts.length} cells, ${anyFailed ? 'FAILED' : 'all passed'}`);
  return anyFailed ? P5_BROWSER_EXIT.cellFailed : P5_BROWSER_EXIT.ok;
}

export interface P5BrowserCliArgs {
  readonly matrix: 'all';
  readonly artifactDir: string;
  readonly originUrl: string;
  readonly fixtureKind: string;
  readonly scenario: P5Scenario;
  readonly commit: string;
  readonly browserExecutable: string | null;
  readonly maxCells: number | null;
}

export function parseP5BrowserCliArgs(argv: readonly string[]): P5BrowserCliArgs {
  let artifactDir: string | null = null;
  let originUrl = 'https://127.0.0.1:4521';
  let fixtureKind: string | null = null;
  let scenario: P5Scenario = 'deployment-action-matrix';
  let commit = 'unknown';
  let browserExecutable: string | null = null;
  let maxCells: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P5BrowserUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--matrix': { const v = needValue(); if (v !== 'all') throw new P5BrowserUsageError('only --matrix all is supported'); break; }
      case '--artifact-dir': artifactDir = needValue(); break;
      case '--origin': originUrl = needValue(); break;
      // `--fixture` (bounded|real) and `--fixture-kind` are accepted equivalently; the artifact records it.
      case '--fixture':
      case '--fixture-kind': {
        const v = needValue();
        if (!isP5FixtureKind(v)) throw new P5BrowserUsageError('--fixture must be bounded or real');
        fixtureKind = v;
        break;
      }
      case '--scenario': {
        const v = needValue();
        if (!isP5Scenario(v)) throw new P5BrowserUsageError(`--scenario must be one of: ${P5_SCENARIOS.join(', ')}`);
        scenario = v;
        break;
      }
      case '--commit': commit = needValue(); break;
      case '--browser-executable': browserExecutable = needValue(); break;
      case '--max-cells': {
        const parsed = Number.parseInt(needValue(), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) throw new P5BrowserUsageError('--max-cells must be a positive integer');
        maxCells = parsed;
        break;
      }
      default: throw new P5BrowserUsageError(`unknown flag: ${arg}`);
    }
  }
  if (artifactDir === null) throw new P5BrowserUsageError('--artifact-dir is required');
  // Unspecified fixture kind defaults to the scenario's §8-mapped kind so the artifact is honest.
  return {
    matrix: 'all', artifactDir, originUrl, fixtureKind: fixtureKind ?? P5_SCENARIO_FIXTURE[scenario],
    scenario, commit, browserExecutable, maxCells,
  };
}

/* ------------------------------------------------------------------------------------------------ *
 * The REAL browser capture — reuses the PROVEN P3 driver verbatim, exactly as the P4 runner does.
 * ------------------------------------------------------------------------------------------------ */

export interface P5RealBrowserDeps {
  launch?: ActualBrowserFactory;
  readCertificate?: CertificateReader;
  inspect?: ExecutableInspector;
  now?: () => Date;
  writeArtifact?: (path: string, contents: string) => void;
  timeoutMs?: number;
  log?: (line: string) => void;
}

function toP3Cell(cell: MatrixCell): {
  id: string; theme: P5Theme; viewport: { width: number; height: number };
  inputMode: 'pointer' | 'keyboard-only';
} {
  return {
    id: `${cell.theme}-${cell.width}-${cell.keyboardOnly ? 'kbd' : 'mouse'}-${cell.reducedMotion ? 'reduced' : 'motion'}`,
    theme: cell.theme,
    viewport: { width: cell.width, height: 900 },
    inputMode: cell.keyboardOnly ? 'keyboard-only' : 'pointer',
  };
}

/**
 * Parse, resolve the SPKI pin (a run that cannot pin an HTTPS origin does not launch), launch ONE real
 * browser, drive the (optionally capped) matrix, and tear the browser down. Never throws for an expected
 * failure — every path returns an exit code.
 */
export async function mainP5ActualBrowserRunner(
  argv: readonly string[], deps: P5RealBrowserDeps = {},
): Promise<number> {
  const log = deps.log ?? (() => undefined);
  let args: P5BrowserCliArgs;
  try {
    args = parseP5BrowserCliArgs(argv);
  } catch (error) {
    if (error instanceof P5BrowserUsageError) { log(`[p5-browser] ${error.message}`); return P5_BROWSER_EXIT.usage; }
    throw error;
  }
  const inspect = deps.inspect ?? defaultExecutableInspector;
  if (args.browserExecutable === null) {
    log('[p5-browser] --browser-executable is required (no discovery, no PATH lookup)');
    return P5_BROWSER_EXIT.usage;
  }
  if (args.browserExecutable !== resolve(args.browserExecutable)) {
    log('[p5-browser] --browser-executable must be an absolute path');
    return P5_BROWSER_EXIT.usage;
  }
  const verdict = inspect(args.browserExecutable);
  if (verdict !== 'ok') { log(`[p5-browser] --browser-executable is ${verdict}: ${args.browserExecutable}`); return P5_BROWSER_EXIT.usage; }

  const readCertificate = deps.readCertificate ?? readLoopbackCertificate;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  let spkiPin: string | null;
  try {
    spkiPin = resolveSpkiPin(args.originUrl, readCertificate);
  } catch (error) {
    log(`[p5-browser] ${error instanceof Error ? error.message : String(error)}`);
    return P5_BROWSER_EXIT.cellFailed;
  }
  if (spkiPin !== null) log(`[p5-browser] pinning the fixture SPKI ${spkiPin} for ${args.originUrl}`);

  const launch = deps.launch ?? defaultLaunchCdpBrowser;
  const browser = await launch({ executable: args.browserExecutable, timeoutMs, spkiPin });
  try {
    const capture: CellCaptureFn = async (input) => {
      const observation = await browser.runCell(toP3Cell(input), {
        origin: args.originUrl, entryPath: '/', viewPath: '/', clickPath: [],
      });
      const reached = assessReachedTheApp(observation.dom);
      return {
        reachedApp: reached.marker !== null && reached.signs.length === 0,
        consoleErrors: observation.consoleErrors,
        appRootHash: createHash('sha256').update(observation.appRootHtml, 'utf8').digest('hex'),
      };
    };
    const cells = args.maxCells === null ? enumerateMatrix() : enumerateMatrix().slice(0, args.maxCells);
    return await runP5BrowserMatrix(
      {
        fixtureKind: args.fixtureKind, scenario: args.scenario, commit: args.commit,
        originUrl: args.originUrl, artifactDir: args.artifactDir, cells,
      },
      { capture, now: deps.now ?? (() => new Date()), writeArtifact: deps.writeArtifact, log },
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void mainP5ActualBrowserRunner(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
    .then((code) => { process.exitCode = code; });
}

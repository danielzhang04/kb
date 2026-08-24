/**
 * P3 section 8 — the ACTUAL browser runner.
 *
 * jsdom cannot green this checklist: the rows are about a real viewport, a real focus ring, a real
 * WebSocket and a real paint. So this module drives a REAL Chromium-family browser over the DevTools
 * protocol and records an artifact set per matrix cell.
 *
 * Two refusals define it:
 *
 *  - The browser binary is supplied EXPLICITLY (`--browser-executable`). There is no discovery, no PATH
 *    lookup and no "try the usual places": a proof that silently picks up whatever browser happens to be
 *    installed proves nothing about the browser it claims to have run. An absent, missing, non-file or
 *    non-executable path exits 64.
 *  - A console error in any cell fails the whole run. A page that logged an error while the screenshot
 *    looked fine is exactly the defect this matrix exists to catch.
 *
 * W6.6f added the three guards the first matrix run was missing, and which let it certify 32 copies of
 * Chrome's `NET::ERR_CERT_AUTHORITY_INVALID` interstitial as a passing dashboard:
 *
 *  1. PIN-SCOPED TRUST. The fixture mints a self-signed loopback certificate and publishes its public
 *     PEM (`p3LoopbackTls.ts`). The runner hashes that certificate's SubjectPublicKeyInfo and launches
 *     the browser with `--ignore-certificate-errors-spki-list=<hash>`, so exactly ONE key is trusted for
 *     this run and every other certificate still fails. Blanket `--ignore-certificate-errors` is never
 *     passed; an unavailable PEM or unhashable certificate refuses to launch at all (65).
 *  2. REACHED-THE-APP. A page that loads "cleanly" is not evidence that the app loaded: the interstitial
 *     loads cleanly too. Every cell must show the app marker and must show none of the interstitial
 *     signs, or it fails with reason `not-the-app` and the run exits non-zero.
 *  3. DISTINCTNESS. The four `p3-*` scenarios serve different payloads, so identical app roots ACROSS
 *     scenario boundaries mean the evidence is a recycled page rather than four rendered dashboards.
 *     Each run records its per-cell app-root hashes and compares them against the sibling scenarios'
 *     recorded runs. Identical cells WITHIN one scenario are fine — two themes can render the same DOM.
 *
 * Playwright is not a dependency of this package and adding one for a proof command is not on the table,
 * so the transport is the raw WebSocket client that `p3RealPtySmokeClient.ts` already owns, pointed at
 * the browser's `/json/version` debugger endpoint.
 *
 * Exit codes: 0 every cell passed - 64 usage - 65 a cell failed (console error, not-the-app, an
 * unpinnable fixture certificate, or a cross-scenario distinctness clash) - 67 a bounded wait expired.
 */
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  accessSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openRawWebSocket } from './p3RealPtySmokeClient.ts';
import type { RawWebSocket } from './p3RealPtySmokeClient.ts';
import { readLoopbackCertificate } from './p3LoopbackTls.ts';

export const BROWSER_EXIT = { ok: 0, usage: 64, failed: 65, timeout: 67 } as const;
export type BrowserExitCode = (typeof BROWSER_EXIT)[keyof typeof BROWSER_EXIT];

export class BrowserRunnerFailure extends Error {
  readonly code: BrowserExitCode;

  constructor(code: BrowserExitCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BrowserRunnerFailure';
  }
}

export const BROWSER_THEMES = ['dark', 'light'] as const;
export type BrowserTheme = (typeof BROWSER_THEMES)[number];
export const BROWSER_INPUT_MODES = ['pointer', 'keyboard-only'] as const;
export type BrowserInputMode = (typeof BROWSER_INPUT_MODES)[number];
export interface BrowserViewport { width: number; height: number }

export interface MatrixCell {
  /** Stable, filesystem-safe cell name; also the artifact sub-directory. */
  id: string;
  theme: BrowserTheme;
  viewport: BrowserViewport;
  inputMode: BrowserInputMode;
}

/**
 * Theme outermost, then viewport, then input mode. The order is part of the contract because the
 * artifact directory is read as a sequence when a cell fails: "the first failure was dark/720/keyboard"
 * is only meaningful if the walk is deterministic.
 */
export function enumerateBrowserMatrix(
  themes: readonly BrowserTheme[],
  viewports: readonly BrowserViewport[],
  inputModes: readonly BrowserInputMode[],
): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const theme of themes) {
    for (const viewport of viewports) {
      for (const inputMode of inputModes) {
        cells.push({
          id: `${theme}-${viewport.width}x${viewport.height}-${inputMode}`,
          theme, viewport, inputMode,
        });
      }
    }
  }
  return cells;
}

/* ------------------------------------------------------------------------------------------------ *
 * Argv
 * ------------------------------------------------------------------------------------------------ */

export interface P3ActualBrowserRunnerArgs {
  browserExecutable: string;
  origin: string;
  themes: BrowserTheme[];
  viewports: BrowserViewport[];
  inputModes: BrowserInputMode[];
  artifactDir: string;
  /** Derived from the artifact directory, never a flag: the matrix commands encode it in the path. */
  scenario: string;
  /**
   * Visited FIRST, for its `Set-Cookie` only. The p3 fixtures scope every session listing to a browser
   * session ref, so a matrix that navigates straight to `/` holds no ref, is shown an empty list by all
   * four scenarios, and records four identical pages — evidence about the shell, not about the payloads
   * under test. Entering as context A is what makes the scenarios differ in the browser at all.
   */
  entryPath: string;
  /**
   * Visited SECOND, and the page every artifact is recorded from. The §8 checklist rows are terminal
   * rows (mounted, owns the viewport, collapses the rail at 720 px), so the default lands there rather
   * than on Home.
   */
  viewPath: string;
  /** Accessible names clicked after the view loads, for scenarios the URL grammar cannot deep-link. */
  clickPath: string[];
  /** Scenario-specific literal text the recorded DOM must contain. */
  requiredText: string[];
  timeoutMs: number;
}

/** How the runner decides a path is a usable browser binary. Injected so the suite needs no real one. */
export type ExecutableInspector = (path: string) => 'ok' | 'missing' | 'not-a-file' | 'not-executable';

export const defaultExecutableInspector: ExecutableInspector = (path) => {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return 'missing';
  }
  if (!stats.isFile()) return 'not-a-file';
  try {
    accessSync(path, fsConstants.X_OK);
  } catch {
    return 'not-executable';
  }
  return 'ok';
};

const DEFAULT_BROWSER_TIMEOUT_MS = 30_000;
/** The p1 fixture's context entries: a 302 to `/` carrying that context's Secure session-ref cookie. */
export const CONTEXT_A_ENTRY = '/fixture/context-a';
export const CONTEXT_B_ENTRY = '/fixture/context-b';
export const DEFAULT_ENTRY_PATH = CONTEXT_A_ENTRY;
export const DEFAULT_VIEW_PATH = '/?view=terminal';

/**
 * Where each §8 scenario actually DIFFERS, and therefore where its artifacts must be recorded.
 *
 * The first matrix recorded all four scenarios at `/`, which is Home — a surface none of them vary.
 * The result was four byte-identical evidence sets that proved only that the shell renders. Each
 * scenario now visits the view that shows its own payload:
 *
 *  - the two terminal scenarios differ in `/api/runtime/capabilities` + `/api/pty/sessions`, both
 *    rendered by the Terminal workspace;
 *  - the run scenario differs in the run's attempt sessions. `src/nav/stack.ts` has no `run:` URL
 *    entity (the URL grammar is closed to agent/workflow/card), so the runner opens the Workflows
 *    roster and CLICKS through to the run — the click is recorded in the cell's result.json;
 *  - the isolation scenario's difference IS the second principal, so it enters as context B and looks
 *    at the same Terminal workspace: B must be shown none of A's sessions.
 */
export interface ScenarioNavigation {
  entryPath: string;
  viewPath: string;
  /** Accessible names to click, in order, after the view loads. Recorded per cell. */
  clickPath: string[];
  /**
   * Literal text the recorded page MUST contain — the scenario's own payload, not the shell's. Without
   * it a cell can reach the app, click cleanly, log nothing, and still be showing an empty list because
   * the fixture never authorized it. This is the assertion that catches that.
   */
  requiredText: string[];
}

export const P3_SCENARIO_NAVIGATION: Readonly<Record<string, ScenarioNavigation>> = {
  // pty:false renders the bounded diagnostic, LITERALLY including the broker reason.
  'p3-terminal-empty-unavailable': {
    entryPath: CONTEXT_A_ENTRY, viewPath: '/?view=terminal', clickPath: [],
    requiredText: ['Terminal unavailable', 'kb-shell-broker socket is not listening', 'pty:false'],
  },
  // Context A owns four server-named sessions; the first in server order proves the listing arrived.
  'p3-terminal-named-sessions': {
    entryPath: CONTEXT_A_ENTRY, viewPath: '/?view=terminal', clickPath: [],
    requiredText: ['shell · kb'],
  },
  // No `run:` URL entity exists, so the roster is navigated by pointer to the run's Live tab.
  'p3-run-attempt-sessions': {
    entryPath: CONTEXT_A_ENTRY, viewPath: '/?view=workflows', clickPath: ['Video Run', 'Live'],
    requiredText: ['Video Run detail', 'workflow-live'],
  },
  // Context B is a STRANGER: it must reach the same workspace and be shown none of A's sessions.
  'p3-controller-isolation': {
    entryPath: CONTEXT_B_ENTRY, viewPath: '/?view=terminal', clickPath: [],
    requiredText: ['Start a session'],
  },
};

export function scenarioNavigation(scenario: string): ScenarioNavigation {
  return P3_SCENARIO_NAVIGATION[scenario]
    ?? { entryPath: DEFAULT_ENTRY_PATH, viewPath: DEFAULT_VIEW_PATH, clickPath: [], requiredText: [] };
}

export function parseP3ActualBrowserRunnerArgs(
  argv: readonly string[],
  inspect: ExecutableInspector = defaultExecutableInspector,
): P3ActualBrowserRunnerArgs {
  let browserExecutable: string | null = null;
  let origin: string | null = null;
  let artifactDir: string | null = null;
  let themesRaw: string | null = null;
  let viewportsRaw: string | null = null;
  let inputModesRaw: string | null = null;
  let entryPathFlag: string | null = null;
  let viewPathFlag: string | null = null;
  let timeoutMs = DEFAULT_BROWSER_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const takeValue = (): string => {
      if (value === undefined || value.startsWith('--')) {
        throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `${flag} needs a value`);
      }
      index += 1;
      return value;
    };
    switch (flag) {
      case '--browser-executable': browserExecutable = takeValue(); break;
      case '--origin': origin = takeValue(); break;
      case '--themes': themesRaw = takeValue(); break;
      case '--viewports': viewportsRaw = takeValue(); break;
      case '--input-modes': inputModesRaw = takeValue(); break;
      case '--artifact-dir': artifactDir = takeValue(); break;
      case '--entry-path': entryPathFlag = takeValue(); break;
      case '--view-path': viewPathFlag = takeValue(); break;
      case '--timeout-ms': timeoutMs = Number.parseInt(takeValue(), 10); break;
      default: throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `unknown flag ${flag}`);
    }
  }

  if (browserExecutable === null || browserExecutable.length === 0) {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--browser-executable is required (no discovery, no PATH lookup)');
  }
  if (browserExecutable !== resolvePath(browserExecutable)) {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--browser-executable must be an absolute path');
  }
  const verdict = inspect(browserExecutable);
  if (verdict !== 'ok') {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `--browser-executable is ${verdict}: ${browserExecutable}`);
  }

  if (origin === null) throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--origin is required');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `--origin is not a URL: ${origin}`);
  }
  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `--origin must be http(s): ${origin}`);
  }
  if (artifactDir === null || artifactDir.length === 0) {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--artifact-dir is required');
  }

  const themes = (themesRaw ?? 'dark,light').split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (themes.length === 0) throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--themes needs at least one theme');
  for (const theme of themes) {
    if (!BROWSER_THEMES.includes(theme as BrowserTheme)) {
      throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `--themes: unknown theme ${theme}`);
    }
  }

  const viewportParts = (viewportsRaw ?? '1440x900,720x900')
    .split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (viewportParts.length === 0) throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--viewports needs at least one size');
  const viewports: BrowserViewport[] = [];
  for (const part of viewportParts) {
    const match = /^(\d{2,5})x(\d{2,5})$/.exec(part);
    if (match === null) throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `--viewports: ${part} is not WIDTHxHEIGHT`);
    viewports.push({ width: Number(match[1]), height: Number(match[2]) });
  }

  const inputModes = (inputModesRaw ?? 'pointer,keyboard-only')
    .split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (inputModes.length === 0) throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--input-modes needs at least one mode');
  for (const mode of inputModes) {
    if (!BROWSER_INPUT_MODES.includes(mode as BrowserInputMode)) {
      throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `--input-modes: unknown mode ${mode}`);
    }
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new BrowserRunnerFailure(BROWSER_EXIT.usage, '--timeout-ms must be a positive integer');
  }
  // The scenario decides where its evidence is recorded; the flags stay available as an override.
  const navigation = scenarioNavigation(basename(artifactDir));
  const entryPath = entryPathFlag ?? navigation.entryPath;
  const viewPath = viewPathFlag ?? navigation.viewPath;
  for (const [flag, value] of [['--entry-path', entryPath], ['--view-path', viewPath]] as const) {
    // Same-origin only: a path that could carry its own origin would silently record a different site.
    if (!value.startsWith('/') || value.startsWith('//')) {
      throw new BrowserRunnerFailure(BROWSER_EXIT.usage, `${flag} must be an origin-relative path: ${value}`);
    }
  }

  return {
    browserExecutable,
    origin: `${parsedOrigin.protocol}//${parsedOrigin.host}`,
    themes: themes as BrowserTheme[],
    viewports,
    inputModes: inputModes as BrowserInputMode[],
    artifactDir,
    scenario: basename(artifactDir),
    entryPath,
    viewPath,
    clickPath: navigation.clickPath,
    requiredText: navigation.requiredText,
    timeoutMs,
  };
}

/* ------------------------------------------------------------------------------------------------ *
 * (1) Pin-scoped trust
 *
 * The fixture's certificate is self-signed and minted per process, so no trust store will ever accept
 * it. The two honest options are "install a CA" (a machine-wide change for a test) and "trust exactly
 * this key for exactly this browser process". Chromium implements the second directly:
 * `--ignore-certificate-errors-spki-list` takes base64 SHA-256 digests of SubjectPublicKeyInfo DER and
 * waives certificate errors for those keys ONLY. Every other certificate — including a real
 * machine-in-the-middle on the same port — still fails, which is the property blanket
 * `--ignore-certificate-errors` throws away.
 * ------------------------------------------------------------------------------------------------ */

/** Base64 SHA-256 over the certificate's SubjectPublicKeyInfo DER — Chromium's SPKI pin format. */
export function spkiSha256Base64(certificatePem: string): string {
  const certificate = new X509Certificate(certificatePem);
  const spkiDer = certificate.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spkiDer).digest('base64');
}

/** Reads the PEM a fixture published for `port`, or null. Injected so the suite needs no fixture. */
export type CertificateReader = (port: number) => string | null;

/**
 * The pin for an origin, or null when the origin is plain HTTP (nothing to pin). Throws 65 rather than
 * degrading to an untrusted launch: a runner that cannot pin must not run at all.
 */
export function resolveSpkiPin(origin: string, readCertificate: CertificateReader): string | null {
  const target = new URL(origin);
  if (target.protocol !== 'https:') return null;
  const port = target.port === '' ? 443 : Number(target.port);
  const pem = readCertificate(port);
  if (pem === null || pem.trim().length === 0) {
    throw new BrowserRunnerFailure(
      BROWSER_EXIT.failed,
      `no fixture certificate published for ${origin}: refusing to launch a browser that could only reach it by ignoring certificate errors`,
    );
  }
  try {
    return spkiSha256Base64(pem);
  } catch (error) {
    throw new BrowserRunnerFailure(
      BROWSER_EXIT.failed,
      `the certificate published for ${origin} yielded no SPKI hash: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * (2) Reached-the-app
 *
 * `#root` alone is not the marker: the built `index.html` ships an empty `<div id="root">`, so a page
 * whose module graph never executed still carries it. The marker is the element the React tree's own
 * shell renders INSIDE that root, which exists only after `App` mounted.
 * ------------------------------------------------------------------------------------------------ */

/** What a cell must show to count as the dashboard. Rendered by `App` (src/App.tsx). */
export const APP_MARKER = 'div#root > div.app-shell';
/** What a cell must NOT show. Chrome's certificate interstitial carries all three. */
export const NOT_THE_APP_SIGNS = ['Privacy error', 'NET::ERR', 'id="details-button"'] as const;

export interface ReachedTheAppVerdict {
  /** The marker found, or null when the app never rendered. Recorded in the cell's result.json. */
  marker: string | null;
  /** Interstitial signs present in the DOM. Any of them fails the cell. */
  signs: string[];
}

export function assessReachedTheApp(dom: string): ReachedTheAppVerdict {
  const signs = NOT_THE_APP_SIGNS.filter((sign) => dom.includes(sign));
  const hasRoot = /<div\b[^>]*\bid="root"/.test(dom);
  // `class="app-shell"` and `class="app-shell app-shell--rail"` both count; `app-shelf` does not.
  const hasShell = /<div\b[^>]*\bclass="app-shell(?:["\s]|--)/.test(dom);
  return { marker: hasRoot && hasShell ? APP_MARKER : null, signs: [...signs] };
}

/* ------------------------------------------------------------------------------------------------ *
 * (3) Cross-scenario distinctness
 * ------------------------------------------------------------------------------------------------ */

export interface ScenarioDigest {
  scenario: string;
  /** cell id -> SHA-256 of the app root's innerHTML. */
  cellHashes: Record<string, string>;
}

function digestSignature(digest: ScenarioDigest): string {
  const entries = Object.entries(digest.cellHashes)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * A message when another scenario produced byte-identical app roots, else null. Two different `p3-*`
 * scenarios serve different payloads, so identical roots mean the artifacts are the same page recorded
 * four times — the exact class of defect the W6.6 matrix shipped.
 */
export function findScenarioClash(current: ScenarioDigest, others: readonly ScenarioDigest[]): string | null {
  if (Object.keys(current.cellHashes).length === 0) return null;
  const mine = digestSignature(current);
  for (const other of others) {
    if (other.scenario === current.scenario) continue;
    if (digestSignature(other) === mine) {
      return `scenario ${current.scenario} produced app roots byte-identical to ${other.scenario}: the artifacts are one recycled page, not four rendered dashboards`;
    }
  }
  return null;
}

/** Reads the digests recorded by the OTHER scenarios that share this artifact root. */
export type SiblingDigestReader = (artifactDir: string, scenario: string) => ScenarioDigest[];

const defaultReadSiblingDigests: SiblingDigestReader = (artifactDir, scenario) => {
  const absolute = resolvePath(artifactDir);
  const parent = dirname(absolute);
  const self = basename(absolute);
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const digests: ScenarioDigest[] = [];
  for (const name of names) {
    if (name === self) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(parent, name, 'result.json'), 'utf8'));
    } catch {
      continue; // not a recorded scenario directory
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as { scenario?: unknown; cellHashes?: unknown };
    if (typeof record.scenario !== 'string' || record.scenario === scenario) continue;
    if (typeof record.cellHashes !== 'object' || record.cellHashes === null) continue;
    digests.push({ scenario: record.scenario, cellHashes: record.cellHashes as Record<string, string> });
  }
  return digests;
};

/* ------------------------------------------------------------------------------------------------ *
 * The browser port
 * ------------------------------------------------------------------------------------------------ */

export interface CellObservation {
  /** PNG bytes. Written verbatim; never re-encoded. */
  screenshot: Buffer;
  dom: string;
  /** `#root`'s innerHTML, or '' when the app root never existed. The distinctness guard hashes THIS. */
  appRootHtml: string;
  trace: { requests: string[]; websockets: string[] };
  keyboardNote: string;
  /** Accessible names this cell actually clicked, in order. Recorded so the path is auditable. */
  clicked: string[];
  /** Accessible names the click path asked for and could not find. Any of them fails the cell. */
  clickFailures: string[];
  consoleErrors: string[];
}

/** Where one cell navigates: the entry that establishes identity, then the page that is recorded. */
export interface CellTarget {
  origin: string;
  entryPath: string;
  viewPath: string;
  clickPath: string[];
}

export interface ActualBrowser {
  runCell(cell: MatrixCell, target: CellTarget): Promise<CellObservation>;
  close(): Promise<void>;
}

export type ActualBrowserFactory = (input: {
  executable: string;
  timeoutMs: number;
  /** The single SubjectPublicKeyInfo hash this browser process may waive certificate errors for. */
  spkiPin: string | null;
}) => Promise<ActualBrowser>;

export type CellFailureReason = 'not-the-app' | 'click-failed' | 'missing-evidence' | 'console-error';

export interface CellResult {
  cell: string;
  theme: BrowserTheme;
  viewport: string;
  inputMode: BrowserInputMode;
  ok: boolean;
  /** The app marker this cell showed, or null when it never reached the app. */
  marker: string | null;
  /** Interstitial signs found in the DOM. Non-empty means the cell recorded an error page. */
  notTheAppSigns: string[];
  failureReason: CellFailureReason | null;
  clicked: string[];
  clickFailures: string[];
  /** Required scenario text that was absent. Non-empty means the page rendered the wrong payload. */
  missingText: string[];
  appRootHash: string;
  consoleErrors: string[];
  screenshotBytes: number;
  keyboardNote: string;
}

export interface BrowserRunReport {
  code: BrowserExitCode;
  scenario: string;
  cells: CellResult[];
  /** Published for the sibling scenarios' distinctness guard. */
  cellHashes: Record<string, string>;
  /** Which sibling scenarios this run was compared against, and the clash if there was one. */
  distinctness: { comparedWith: string[]; clash: string | null };
  message: string;
}

export interface P3ActualBrowserRunnerDeps {
  launch?: ActualBrowserFactory;
  writeArtifact?: (path: string, contents: Buffer | string) => void;
  ensureDir?: (path: string) => void;
  readCertificate?: CertificateReader;
  readSiblingDigests?: SiblingDigestReader;
  log?: (line: string) => void;
}

const defaultEnsureDir = (path: string): void => { mkdirSync(path, { recursive: true }); };
const defaultWriteArtifact = (path: string, contents: Buffer | string): void => { writeFileSync(path, contents); };

export async function runP3ActualBrowserMatrix(
  args: P3ActualBrowserRunnerArgs,
  deps: P3ActualBrowserRunnerDeps = {},
): Promise<BrowserRunReport> {
  const launch = deps.launch ?? defaultLaunchCdpBrowser;
  const ensureDir = deps.ensureDir ?? defaultEnsureDir;
  const writeArtifact = deps.writeArtifact ?? defaultWriteArtifact;
  const readCertificate = deps.readCertificate ?? readLoopbackCertificate;
  const readSiblingDigests = deps.readSiblingDigests ?? defaultReadSiblingDigests;
  const log = deps.log ?? (() => {});

  const cells = enumerateBrowserMatrix(args.themes, args.viewports, args.inputModes);
  // Before anything is launched: either this run can pin the fixture's key, or it does not run.
  const spkiPin = resolveSpkiPin(args.origin, readCertificate);
  if (spkiPin !== null) log(`[p3-browser] pinning the fixture SPKI ${spkiPin} for ${args.origin}`);
  ensureDir(args.artifactDir);
  const browser = await launch({ executable: args.browserExecutable, timeoutMs: args.timeoutMs, spkiPin });
  const results: CellResult[] = [];
  const cellHashes: Record<string, string> = {};
  let failure: string | null = null;
  try {
    for (const cell of cells) {
      const observation = await browser.runCell(cell, {
        origin: args.origin, entryPath: args.entryPath, viewPath: args.viewPath, clickPath: args.clickPath,
      });
      const cellDir = join(args.artifactDir, cell.id);
      ensureDir(cellDir);
      writeArtifact(join(cellDir, 'screenshot.png'), observation.screenshot);
      writeArtifact(join(cellDir, 'dom.html'), observation.dom);
      writeArtifact(join(cellDir, 'trace.json'), `${JSON.stringify(observation.trace, null, 2)}\n`);
      writeArtifact(join(cellDir, 'keyboard.txt'), `${observation.keyboardNote}\n`);

      const verdict = assessReachedTheApp(observation.dom);
      const reachedTheApp = verdict.marker !== null && verdict.signs.length === 0;
      const appRootHash = createHash('sha256').update(observation.appRootHtml, 'utf8').digest('hex');
      cellHashes[cell.id] = appRootHash;
      const missingText = args.requiredText.filter((text) => !observation.dom.includes(text));
      const failureReason: CellFailureReason | null = !reachedTheApp
        ? 'not-the-app'
        : observation.clickFailures.length > 0 ? 'click-failed'
          : missingText.length > 0 ? 'missing-evidence'
            : observation.consoleErrors.length > 0 ? 'console-error' : null;
      const ok = failureReason === null;
      const result: CellResult = {
        cell: cell.id,
        theme: cell.theme,
        viewport: `${cell.viewport.width}x${cell.viewport.height}`,
        inputMode: cell.inputMode,
        ok,
        marker: verdict.marker,
        notTheAppSigns: verdict.signs,
        failureReason,
        clicked: observation.clicked,
        clickFailures: observation.clickFailures,
        missingText,
        appRootHash,
        consoleErrors: observation.consoleErrors,
        screenshotBytes: observation.screenshot.length,
        keyboardNote: observation.keyboardNote,
      };
      results.push(result);
      writeArtifact(join(cellDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
      log(`[p3-browser] ${cell.id} ${ok ? `ok (${verdict.marker ?? 'no marker'})` : `FAILED ${failureReason}`}`);
      if (!ok && failure === null) {
        // The remaining cells still run: a matrix that stops at the first red hides whether the defect
        // is one cell or all eight, which is the question the artifact set exists to answer.
        const detail = failureReason === 'not-the-app'
          ? [verdict.marker === null ? `no ${APP_MARKER}` : null, ...verdict.signs].filter((part) => part !== null).join(' + ')
          : failureReason === 'click-failed'
            ? `no element with accessible name ${observation.clickFailures.join(', ')}`
            : failureReason === 'missing-evidence'
              ? `the page never rendered ${missingText.join(', ')}`
              : observation.consoleErrors.join(' | ');
        failure = `${cell.id} (${failureReason}): ${detail}`;
      }
    }
  } finally {
    await browser.close();
  }

  // The distinctness guard runs on the finished matrix, against the scenarios recorded beside it.
  const siblings = readSiblingDigests(args.artifactDir, args.scenario);
  const clash = findScenarioClash({ scenario: args.scenario, cellHashes }, siblings);
  if (clash !== null && failure === null) failure = clash;

  const code = failure === null ? BROWSER_EXIT.ok : BROWSER_EXIT.failed;
  const report: BrowserRunReport = {
    code,
    scenario: args.scenario,
    cells: results,
    cellHashes,
    distinctness: { comparedWith: siblings.map((sibling) => sibling.scenario), clash },
    message: failure === null
      ? `${results.length} cells reached ${APP_MARKER} with zero console errors`
      : `failed: ${failure}`,
  };
  writeArtifact(join(args.artifactDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/* ------------------------------------------------------------------------------------------------ *
 * The default CDP driver
 * ------------------------------------------------------------------------------------------------ */

interface CdpConnection {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  events: Record<string, unknown>[];
  close(): void;
}

async function openCdp(webSocketDebuggerUrl: string, timeoutMs: number): Promise<CdpConnection> {
  const socket: RawWebSocket = await openRawWebSocket({ url: webSocketDebuggerUrl, handshakeTimeoutMs: timeoutMs });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const events: Record<string, unknown>[] = [];
  let pumping = true;
  const pump = async (): Promise<void> => {
    while (pumping && !socket.isClosed()) {
      let raw: string;
      try {
        raw = await socket.next(timeoutMs);
      } catch {
        break;
      }
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof message !== 'object' || message === null) continue;
      const record = message as Record<string, unknown>;
      if (typeof record.id === 'number') {
        const waiter = pending.get(record.id);
        pending.delete(record.id);
        if (waiter === undefined) continue;
        if (record.error !== undefined) waiter.reject(new BrowserRunnerFailure(BROWSER_EXIT.failed, JSON.stringify(record.error)));
        else waiter.resolve((record.result ?? {}) as Record<string, unknown>);
      } else if (typeof record.method === 'string') {
        events.push(record);
      }
    }
    for (const waiter of pending.values()) {
      waiter.reject(new BrowserRunnerFailure(BROWSER_EXIT.failed, 'CDP connection closed'));
    }
    pending.clear();
  };
  void pump();

  return {
    events,
    send(method, params = {}, sessionId) {
      nextId += 1;
      const id = nextId;
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId !== undefined) payload.sessionId = sessionId;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BrowserRunnerFailure(BROWSER_EXIT.timeout, `CDP ${method} exceeded ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        socket.send(JSON.stringify(payload));
      });
    },
    close(): void {
      pumping = false;
      socket.close();
    },
  };
}

async function fetchDebuggerUrl(port: number, deadline: number): Promise<string> {
  for (;;) {
    if (Date.now() > deadline) {
      throw new BrowserRunnerFailure(BROWSER_EXIT.timeout, 'browser never published a DevTools endpoint');
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const body = (await response.json()) as { webSocketDebuggerUrl?: unknown };
        if (typeof body.webSocketDebuggerUrl === 'string') return body.webSocketDebuggerUrl;
      }
    } catch {
      // The browser is still coming up; the deadline above is the only bound that matters.
    }
    await new Promise<void>((settle) => { const t = setTimeout(settle, 150); t.unref?.(); });
  }
}

/**
 * A REAL pointer click on the element whose accessible name matches, or null when there is none.
 * The name is resolved in the page (aria-label, else trimmed text) and the click is dispatched through
 * `Input.dispatchMouseEvent` at the element's centre — a synthetic `.click()` would bypass exactly the
 * hit-testing and pointer handling the browser matrix exists to exercise.
 */
async function clickByAccessibleName(
  cdp: CdpConnection, sessionId: string, name: string,
): Promise<{ x: number; y: number } | null> {
  const located = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const wanted = ${JSON.stringify(name)};
      const nameOf = (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\\s+/g, ' ').trim();
      const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"], [role="row"], [role="listitem"]'));
      const match = nodes.find((el) => nameOf(el) === wanted) ?? nodes.find((el) => nameOf(el).includes(wanted));
      if (!match) return null;
      match.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = match.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true,
  }, sessionId);
  const point = (located.result as { value?: unknown } | undefined)?.value as { x?: unknown; y?: unknown } | null;
  if (point === null || typeof point?.x !== 'number' || typeof point.y !== 'number') return null;
  const at = { x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 };
  await cdp.send('Input.dispatchMouseEvent', { ...at, type: 'mouseMoved', buttons: 0 }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { ...at, type: 'mousePressed' }, sessionId);
  await cdp.send('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased' }, sessionId);
  return { x: point.x, y: point.y };
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((settle) => { const timer = setTimeout(settle, ms); timer.unref?.(); });

/**
 * Launch the SUPPLIED binary with a private profile and a fixed debugging port, then drive one page per
 * matrix cell. Trust is PIN-SCOPED: the only certificate error this browser process waives is one whose
 * SubjectPublicKeyInfo hashes to the fixture's published key. Blanket `--ignore-certificate-errors` is
 * never passed — it would green the TLS row against literally any certificate, and (as W6.6 proved the
 * hard way) its absence without a pin just records the interstitial instead.
 */
export const defaultLaunchCdpBrowser: ActualBrowserFactory = async ({ executable, timeoutMs, spkiPin }) => {
  const debugPort = 9222 + (process.pid % 500);
  const profile = mkdtempSync(join(tmpdir(), 'kb-p3-browser-'));
  const child = spawn(executable, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    ...(spkiPin === null ? [] : [`--ignore-certificate-errors-spki-list=${spkiPin}`]),
  ], { stdio: 'ignore', shell: false });

  const url = await fetchDebuggerUrl(debugPort, Date.now() + timeoutMs);
  const cdp = await openCdp(url, timeoutMs);

  return {
    async runCell(cell, { origin, entryPath, viewPath, clickPath }): Promise<CellObservation> {
      const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const targetId = String(target.targetId);
      const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const sessionId = String(attached.sessionId);
      const before = cdp.events.length;

      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Log.enable', {}, sessionId);
      await cdp.send('Network.enable', {}, sessionId);
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: cell.theme }],
      }, sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: cell.viewport.width, height: cell.viewport.height, deviceScaleFactor: 1, mobile: false,
      }, sessionId);
      // Identity first: the entry sets the browser-session-ref cookie and redirects to `/`. Its own
      // load is NOT the evidence, so nothing is asserted about it; the recorded page is the next one.
      await cdp.send('Page.navigate', { url: `${origin}${entryPath}` }, sessionId);
      await sleep(400);
      await cdp.send('Page.navigate', { url: `${origin}${viewPath}` }, sessionId);
      // A BOUNDED wait for the app to mount, then a fixed paint slice. The wait never decides the
      // verdict: when it expires the cell is still recorded and `assessReachedTheApp` fails it, so an
      // interstitial produces an artifact set that says `not-the-app` rather than a hang.
      const mountedBy = Date.now() + Math.min(timeoutMs, 15_000);
      for (;;) {
        const probe = await cdp.send('Runtime.evaluate', {
          expression: 'document.querySelector("#root > .app-shell") !== null', returnByValue: true,
        }, sessionId);
        if ((probe.result as { value?: unknown } | undefined)?.value === true) break;
        if (Date.now() >= mountedBy) break;
        await sleep(150);
      }
      await sleep(500);

      // The click path runs BEFORE the keyboard traversal, so keyboard-only cells tab through the
      // surface the scenario is actually about rather than the roster that led to it.
      const clicked: string[] = [];
      const clickFailures: string[] = [];
      for (const name of clickPath) {
        const point = await clickByAccessibleName(cdp, sessionId, name);
        if (point === null) { clickFailures.push(name); break; }
        clicked.push(name);
        await sleep(600);
      }

      let keyboardNote = 'pointer: no keyboard traversal requested';
      if (cell.inputMode === 'keyboard-only') {
        for (let press = 0; press < 5; press += 1) {
          await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
        }
        const focused = await cdp.send('Runtime.evaluate', {
          expression: 'document.activeElement ? `${document.activeElement.tagName}#${document.activeElement.id}` : "none"',
          returnByValue: true,
        }, sessionId);
        const value = (focused.result as { value?: unknown } | undefined)?.value;
        keyboardNote = `after 5 Tab presses focus is ${typeof value === 'string' ? value : 'unknown'}`;
      }

      const dom = await cdp.send('Runtime.evaluate', {
        expression: 'document.documentElement.outerHTML', returnByValue: true,
      }, sessionId);
      const appRoot = await cdp.send('Runtime.evaluate', {
        expression: 'document.getElementById("root") ? document.getElementById("root").innerHTML : ""',
        returnByValue: true,
      }, sessionId);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);

      const fresh = cdp.events.slice(before);
      const consoleErrors: string[] = [];
      const requests: string[] = [];
      const websockets: string[] = [];
      for (const event of fresh) {
        const params = (event.params ?? {}) as Record<string, unknown>;
        if (event.method === 'Runtime.consoleAPICalled' && params.type === 'error') {
          consoleErrors.push(JSON.stringify(params.args ?? []));
        }
        if (event.method === 'Runtime.exceptionThrown') consoleErrors.push(JSON.stringify(params.exceptionDetails ?? {}));
        if (event.method === 'Log.entryAdded') {
          const entry = (params.entry ?? {}) as Record<string, unknown>;
          // The URL is part of the error: "404 (Not Found)" with no subject is unactionable evidence.
          if (entry.level === 'error') {
            const where = typeof entry.url === 'string' && entry.url.length > 0 ? ` [${entry.url}]` : '';
            consoleErrors.push(`${String(entry.text ?? '')}${where}`);
          }
        }
        if (event.method === 'Network.requestWillBeSent') {
          const request = (params.request ?? {}) as Record<string, unknown>;
          requests.push(String(request.url ?? ''));
        }
        if (event.method === 'Network.webSocketCreated') websockets.push(String(params.url ?? ''));
      }

      await cdp.send('Target.closeTarget', { targetId });
      const domValue = (dom.result as { value?: unknown } | undefined)?.value;
      const appRootValue = (appRoot.result as { value?: unknown } | undefined)?.value;
      return {
        screenshot: Buffer.from(String(shot.data ?? ''), 'base64'),
        dom: typeof domValue === 'string' ? domValue : '',
        appRootHtml: typeof appRootValue === 'string' ? appRootValue : '',
        trace: { requests, websockets },
        keyboardNote,
        clicked,
        clickFailures,
        consoleErrors,
      };
    },
    async close(): Promise<void> {
      try {
        await cdp.send('Browser.close');
      } catch {
        // A browser that already went away needs no closing; the kill below is the backstop.
      }
      cdp.close();
      child.kill();
    },
  };
};

/** Never throws: every failure becomes its exit code. */
export async function mainP3ActualBrowserRunner(
  argv: readonly string[],
  deps: P3ActualBrowserRunnerDeps & { inspect?: ExecutableInspector } = {},
): Promise<BrowserExitCode> {
  const log = deps.log ?? (() => {});
  try {
    const args = parseP3ActualBrowserRunnerArgs(argv, deps.inspect ?? defaultExecutableInspector);
    const report = await runP3ActualBrowserMatrix(args, deps);
    log(`[p3-browser] ${report.message}`);
    return report.code;
  } catch (error) {
    if (error instanceof BrowserRunnerFailure) {
      log(`[p3-browser] ${error.message}`);
      return error.code;
    }
    log(`[p3-browser] ${error instanceof Error ? error.message : String(error)}`);
    return BROWSER_EXIT.failed;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void mainP3ActualBrowserRunner(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
    .then((code) => { process.exitCode = code; });
}

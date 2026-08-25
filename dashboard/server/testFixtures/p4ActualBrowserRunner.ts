/**
 * P4 W6.4 — the browser matrix runner for the §8 Inbox proofs.
 *
 * Every browser matrix runs light/dark, keyboard-only, reduced motion, and 375/768/1440 widths; each
 * artifact records fixture kind, scenario, commit, viewport, and timestamp (plan §8). This module owns
 * the matrix enumeration and the artifact envelope; the §8 command runs it under
 * {@link runP4FixtureLifecycle} so a fixture server is always up first and torn down after.
 *
 * The matrix is a pure function so the enumeration (its completeness — no theme, width, or a11y axis
 * dropped) is proven without a real browser, and the per-cell capture seam is injected so the suite can
 * exercise a failing cell (a console error fails the whole run) without launching Chromium.
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
import { P4_SCENARIOS, type P4Scenario } from './p4FixtureServer.ts';

export const P4_VIEWPORT_WIDTHS = [375, 768, 1440] as const;
export const P4_THEMES = ['light', 'dark'] as const;
export type P4Theme = (typeof P4_THEMES)[number];

export interface MatrixCell {
  readonly theme: P4Theme;
  readonly keyboardOnly: boolean;
  readonly reducedMotion: boolean;
  readonly width: number;
}

/** The full light/dark × keyboard-only × reduced-motion × {375,768,1440} matrix, in a stable order. */
export function enumerateMatrix(): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const theme of P4_THEMES) {
    for (const keyboardOnly of [false, true]) {
      for (const reducedMotion of [false, true]) {
        for (const width of P4_VIEWPORT_WIDTHS) {
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
  /** App marker that proves the app loaded (not a TLS interstitial). */
  readonly reachedApp: boolean;
  /** Any console errors observed; a nonempty list fails the whole run. */
  readonly consoleErrors: readonly string[];
  /** A hash of the app root, to compare distinctness across scenarios. */
  readonly appRootHash: string;
}

export type CellCaptureFn = (input: CellCaptureInput) => Promise<CellCapture>;

export interface P4BrowserRunOptions {
  readonly fixtureKind: string;
  readonly scenario: string;
  readonly commit: string;
  readonly originUrl: string;
  readonly artifactDir: string;
  /**
   * The cells to run. Defaults to the full {@link enumerateMatrix}; a bounded proof run passes a slice
   * (e.g. one cell) so a real browser cell can be certified without the whole 24-cell matrix.
   */
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

export const P4_BROWSER_EXIT = { ok: 0, usage: 2, cellFailed: 65 } as const;

export class P4BrowserUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P4BrowserUsageError';
  }
}

export interface P4BrowserDeps {
  capture: CellCaptureFn;
  now: () => Date;
  writeArtifact?: (path: string, contents: string) => void;
  log?: (line: string) => void;
}

/**
 * Run every matrix cell, writing one artifact per cell plus a summary. A cell that never reached the app
 * or logged a console error fails the whole run (exit 65).
 */
export async function runP4BrowserMatrix(
  options: P4BrowserRunOptions,
  deps: P4BrowserDeps,
): Promise<number> {
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
  return anyFailed ? P4_BROWSER_EXIT.cellFailed : P4_BROWSER_EXIT.ok;
}

export interface P4BrowserCliArgs {
  readonly matrix: 'all';
  readonly artifactDir: string;
  readonly originUrl: string;
  readonly fixtureKind: string;
  readonly scenario: P4Scenario;
  readonly commit: string;
  /**
   * The browser binary, supplied EXPLICITLY (no PATH lookup, no discovery), exactly like the P3 runner.
   * Optional in the parse so the pure-enumeration commands still parse; required by the real run below.
   */
  readonly browserExecutable: string | null;
  /** Cap the number of matrix cells actually driven; null runs the whole matrix. */
  readonly maxCells: number | null;
}

export function parseP4BrowserCliArgs(argv: readonly string[]): P4BrowserCliArgs {
  let artifactDir: string | null = null;
  let originUrl = 'https://127.0.0.1:4421';
  let fixtureKind = 'bounded';
  let scenario: P4Scenario = 'pr-escalation-states';
  let commit = 'unknown';
  let browserExecutable: string | null = null;
  let maxCells: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P4BrowserUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--matrix': { const v = needValue(); if (v !== 'all') throw new P4BrowserUsageError('only --matrix all is supported'); break; }
      case '--artifact-dir': artifactDir = needValue(); break;
      case '--origin': originUrl = needValue(); break;
      case '--fixture-kind': fixtureKind = needValue(); break;
      case '--scenario': {
        const v = needValue();
        if (!P4_SCENARIOS.includes(v as P4Scenario)) {
          throw new P4BrowserUsageError(`--scenario must be one of: ${P4_SCENARIOS.join(', ')}`);
        }
        scenario = v as P4Scenario;
        break;
      }
      case '--commit': commit = needValue(); break;
      case '--browser-executable': browserExecutable = needValue(); break;
      case '--max-cells': {
        const parsed = Number.parseInt(needValue(), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) throw new P4BrowserUsageError('--max-cells must be a positive integer');
        maxCells = parsed;
        break;
      }
      default: throw new P4BrowserUsageError(`unknown flag: ${arg}`);
    }
  }
  if (artifactDir === null) throw new P4BrowserUsageError('--artifact-dir is required');
  return { matrix: 'all', artifactDir, originUrl, fixtureKind, scenario, commit, browserExecutable, maxCells };
}

/* ------------------------------------------------------------------------------------------------ *
 * The REAL browser capture — a per-cell reached-the-app verdict from a real Chromium-family browser.
 *
 * It reuses the PROVEN P3 driver verbatim: `defaultLaunchCdpBrowser` launches the supplied binary with
 * pin-scoped trust (`--ignore-certificate-errors-spki-list=<pin>`, never blanket), drives one page per
 * cell over the DevTools protocol, and returns the DOM, the app-root HTML and every console error. This
 * runner maps that observation onto the P4 {@link CellCapture}: the app marker is `div#root >
 * div.app-shell` (`assessReachedTheApp`), the same marker the P4 fixture server's shell page mounts.
 * ------------------------------------------------------------------------------------------------ */

export interface P4RealBrowserDeps {
  /** The browser factory; defaults to the P3 CDP launcher. Injected so the suite needs no real browser. */
  launch?: ActualBrowserFactory;
  readCertificate?: CertificateReader;
  inspect?: ExecutableInspector;
  now?: () => Date;
  writeArtifact?: (path: string, contents: string) => void;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/** Map a P4 matrix cell to the P3 driver's cell shape (theme + viewport + input mode). */
function toP3Cell(cell: MatrixCell): {
  id: string; theme: P4Theme; viewport: { width: number; height: number };
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
export async function mainP4ActualBrowserRunner(
  argv: readonly string[], deps: P4RealBrowserDeps = {},
): Promise<number> {
  const log = deps.log ?? (() => undefined);
  let args: P4BrowserCliArgs;
  try {
    args = parseP4BrowserCliArgs(argv);
  } catch (error) {
    if (error instanceof P4BrowserUsageError) { log(`[p4-browser] ${error.message}`); return P4_BROWSER_EXIT.usage; }
    throw error;
  }
  const inspect = deps.inspect ?? defaultExecutableInspector;
  if (args.browserExecutable === null) {
    log('[p4-browser] --browser-executable is required (no discovery, no PATH lookup)');
    return P4_BROWSER_EXIT.usage;
  }
  if (args.browserExecutable !== resolve(args.browserExecutable)) {
    log('[p4-browser] --browser-executable must be an absolute path');
    return P4_BROWSER_EXIT.usage;
  }
  const verdict = inspect(args.browserExecutable);
  if (verdict !== 'ok') { log(`[p4-browser] --browser-executable is ${verdict}: ${args.browserExecutable}`); return P4_BROWSER_EXIT.usage; }

  const readCertificate = deps.readCertificate ?? readLoopbackCertificate;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  let spkiPin: string | null;
  try {
    spkiPin = resolveSpkiPin(args.originUrl, readCertificate);
  } catch (error) {
    log(`[p4-browser] ${error instanceof Error ? error.message : String(error)}`);
    return P4_BROWSER_EXIT.cellFailed;
  }
  if (spkiPin !== null) log(`[p4-browser] pinning the fixture SPKI ${spkiPin} for ${args.originUrl}`);

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
    return await runP4BrowserMatrix(
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
  void mainP4ActualBrowserRunner(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
    .then((code) => { process.exitCode = code; });
}

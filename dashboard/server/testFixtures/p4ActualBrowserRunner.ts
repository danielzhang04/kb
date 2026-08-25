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
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  for (const cell of enumerateMatrix()) {
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
  readonly scenario: string;
  readonly commit: string;
}

export function parseP4BrowserCliArgs(argv: readonly string[]): P4BrowserCliArgs {
  let artifactDir: string | null = null;
  let originUrl = 'https://127.0.0.1:4421';
  let fixtureKind = 'bounded';
  let scenario = 'pr-escalation-states';
  let commit = 'unknown';
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
      case '--scenario': scenario = needValue(); break;
      case '--commit': commit = needValue(); break;
      default: throw new P4BrowserUsageError(`unknown flag: ${arg}`);
    }
  }
  if (artifactDir === null) throw new P4BrowserUsageError('--artifact-dir is required');
  return { matrix: 'all', artifactDir, originUrl, fixtureKind, scenario, commit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stderr.write('p4ActualBrowserRunner requires an explicit browser-capture seam; drive runP4BrowserMatrix.\n');
  process.exitCode = P4_BROWSER_EXIT.usage;
}

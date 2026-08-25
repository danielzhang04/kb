/**
 * P6 W6.3 — the §8 browser matrix runner for the two-daemon and placement-chip proofs.
 *
 * Every browser matrix runs light/dark, keyboard-only, reduced motion, and 375/768/1440 widths; each
 * artifact records fixture kind, scenario, commit, viewport, and timestamp (plan §8). This module owns the
 * P6 matrix enumeration and the artifact envelope. The matrix is a PURE function so its completeness is
 * proven without a real browser, and the per-cell capture seam is injected so the suite exercises a failing
 * cell without launching Chromium. The real capture reuses the proven P3 CDP driver verbatim (like the P4/P5
 * runners); here we only guarantee the enumeration, the artifact shape, and the exit semantics.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const P6_THEMES = ['light', 'dark'] as const;
export type P6Theme = (typeof P6_THEMES)[number];
export const P6_VIEWPORT_WIDTHS = [375, 768, 1440] as const;
export type P6ViewportWidth = (typeof P6_VIEWPORT_WIDTHS)[number];
export const P6_INTERACTION_MODES = ['pointer', 'keyboard-only'] as const;
export type P6InteractionMode = (typeof P6_INTERACTION_MODES)[number];
export const P6_MOTION_MODES = ['default-motion', 'reduced-motion'] as const;
export type P6MotionMode = (typeof P6_MOTION_MODES)[number];

/** The two §8 browser scenarios (plan §8 table). `two-daemon` runs against the two-daemon fixture; the
 *  `placement-chip` scenario runs against the reused p1 bounded browser fixture. */
export const P6_SCENARIOS = ['two-daemon', 'placement-chip'] as const;
export type P6Scenario = (typeof P6_SCENARIOS)[number];
export function isP6Scenario(value: string): value is P6Scenario {
  return (P6_SCENARIOS as readonly string[]).includes(value);
}

export const P6_FIXTURE_KINDS = ['two-daemon', 'bounded'] as const;
export type P6FixtureKind = (typeof P6_FIXTURE_KINDS)[number];
export const P6_SCENARIO_FIXTURE: Readonly<Record<P6Scenario, P6FixtureKind>> = {
  'two-daemon': 'two-daemon',
  'placement-chip': 'bounded',
};

export interface MatrixCell {
  readonly scenario: P6Scenario;
  readonly theme: P6Theme;
  readonly width: P6ViewportWidth;
  readonly interaction: P6InteractionMode;
  readonly motion: P6MotionMode;
}

/** Every theme × width × interaction × motion cell for one scenario — the full §8 matrix. */
export function enumerateMatrix(scenario: P6Scenario): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const theme of P6_THEMES) {
    for (const width of P6_VIEWPORT_WIDTHS) {
      for (const interaction of P6_INTERACTION_MODES) {
        for (const motion of P6_MOTION_MODES) {
          cells.push({ scenario, theme, width, interaction, motion });
        }
      }
    }
  }
  return cells;
}

export interface CellCapture {
  readonly ok: boolean;
  readonly consoleErrors: readonly string[];
  readonly note?: string;
}
export type CellCaptureFn = (cell: MatrixCell) => Promise<CellCapture>;

export interface MatrixArtifact extends MatrixCell {
  readonly fixtureKind: P6FixtureKind;
  readonly commit: string;
  readonly timestamp: string;
  readonly ok: boolean;
  readonly consoleErrors: readonly string[];
  readonly note?: string;
}

export const P6_BROWSER_EXIT = { ok: 0, usage: 2, cellFailed: 65 } as const;
export type P6BrowserExitCode = (typeof P6_BROWSER_EXIT)[keyof typeof P6_BROWSER_EXIT];

export interface P6BrowserRunOptions {
  readonly scenario: P6Scenario;
  readonly artifactDir: string;
  readonly commit: string;
  readonly now: () => Date;
}

export interface P6BrowserDeps {
  readonly capture: CellCaptureFn;
  readonly writeArtifact?: (path: string, contents: string) => void;
  readonly ensureDir?: (path: string) => void;
  readonly log?: (line: string) => void;
}

/** Run the whole matrix for a scenario, writing one artifact per cell. Any failing cell (a capture that
 *  is not ok, or that recorded a console error) yields the `cellFailed` exit code. */
export async function runP6BrowserMatrix(options: P6BrowserRunOptions, deps: P6BrowserDeps): Promise<P6BrowserExitCode> {
  const write = deps.writeArtifact ?? ((path: string, contents: string) => writeFileSync(path, contents));
  const ensureDir = deps.ensureDir ?? ((path: string) => { mkdirSync(path, { recursive: true }); });
  const log = deps.log ?? (() => {});
  const dir = resolve(options.artifactDir);
  ensureDir(dir);
  const fixtureKind = P6_SCENARIO_FIXTURE[options.scenario];
  let failed = 0;
  for (const cell of enumerateMatrix(options.scenario)) {
    const capture = await deps.capture(cell);
    const ok = capture.ok && capture.consoleErrors.length === 0;
    const artifact: MatrixArtifact = {
      ...cell, fixtureKind, commit: options.commit, timestamp: options.now().toISOString(),
      ok, consoleErrors: capture.consoleErrors, ...(capture.note ? { note: capture.note } : {}),
    };
    const name = `${cell.scenario}-${cell.theme}-${cell.width}-${cell.interaction}-${cell.motion}.json`;
    write(join(dir, name), `${JSON.stringify(artifact, null, 2)}\n`);
    if (!ok) { failed += 1; log(`[p6-browser] cell failed: ${name}: ${capture.consoleErrors.join('; ') || capture.note || 'not ok'}`); }
  }
  if (failed > 0) { log(`[p6-browser] ${failed} cell(s) failed`); return P6_BROWSER_EXIT.cellFailed; }
  log(`[p6-browser] ${enumerateMatrix(options.scenario).length} cells passed for ${options.scenario}`);
  return P6_BROWSER_EXIT.ok;
}

export class P6BrowserUsageError extends Error {
  constructor(message: string) { super(message); this.name = 'P6BrowserUsageError'; }
}

export interface P6BrowserCliArgs {
  readonly scenario: P6Scenario;
  readonly artifactDir: string;
  readonly browserExecutable: string;
  readonly originVm: string | null;
  readonly originDesktop: string | null;
  readonly origin: string | null;
}

export function parseP6BrowserCliArgs(argv: readonly string[]): P6BrowserCliArgs {
  let scenario: P6Scenario = 'two-daemon';
  let artifactDir: string | null = null;
  let browserExecutable: string | null = null;
  let originVm: string | null = null;
  let originDesktop: string | null = null;
  let origin: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    const needValue = (): string => {
      if (value === undefined || value.startsWith('--')) throw new P6BrowserUsageError(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--scenario': { const v = needValue(); if (!isP6Scenario(v)) throw new P6BrowserUsageError(`unknown scenario ${v}`); scenario = v; break; }
      case '--matrix': { const v = needValue(); if (v !== 'all') throw new P6BrowserUsageError('only --matrix all is supported'); break; }
      case '--artifact-dir': artifactDir = needValue(); break;
      case '--browser-executable': browserExecutable = needValue(); break;
      case '--origin-vm': originVm = needValue(); break;
      case '--origin-desktop': originDesktop = needValue(); break;
      case '--origin': origin = needValue(); break;
      default: throw new P6BrowserUsageError(`unknown or incomplete argument: ${String(arg)}`);
    }
  }
  if (artifactDir === null) throw new P6BrowserUsageError('--artifact-dir is required');
  if (browserExecutable === null) throw new P6BrowserUsageError('--browser-executable is required (no discovery, no PATH lookup)');
  if (scenario === 'two-daemon' && (originVm === null || originDesktop === null)) {
    throw new P6BrowserUsageError('the two-daemon scenario requires --origin-vm and --origin-desktop');
  }
  if (scenario === 'placement-chip' && origin === null) {
    throw new P6BrowserUsageError('the placement-chip scenario requires --origin');
  }
  return { scenario, artifactDir, browserExecutable, originVm, originDesktop, origin };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The real capture requires a reviewed browser executable and the proven P3 CDP driver; that path is
  // exercised by W6.5's §8 command, not here. Running this module bare validates its arguments and refuses
  // rather than silently launching nothing.
  try {
    parseP6BrowserCliArgs(process.argv.slice(2));
    process.stderr.write('[p6-browser] real CDP capture is wired by the §8 command; run it there\n');
    process.exitCode = P6_BROWSER_EXIT.ok;
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = P6_BROWSER_EXIT.usage;
  }
}

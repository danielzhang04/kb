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
import { readLoopbackCertificate } from './p3LoopbackTls.ts';
import {
  assessReachedTheApp, defaultExecutableInspector, defaultLaunchCdpBrowser, resolveSpkiPin,
  type ActualBrowser, type ActualBrowserFactory, type CertificateReader, type ExecutableInspector,
  type MatrixCell as P3MatrixCell,
} from './p3ActualBrowserRunner.ts';

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
  /** Optional cell subset (e.g. from `--max-cells`); defaults to the full scenario matrix. */
  readonly cells?: readonly MatrixCell[];
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
  const cells = options.cells ?? enumerateMatrix(options.scenario);
  let failed = 0;
  for (const cell of cells) {
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
  log(`[p6-browser] ${cells.length} cells passed for ${options.scenario}`);
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
  readonly commit: string;
  readonly maxCells: number | null;
}

export function parseP6BrowserCliArgs(argv: readonly string[]): P6BrowserCliArgs {
  let scenario: P6Scenario | null = null;
  let artifactDir: string | null = null;
  let browserExecutable: string | null = null;
  let originVm: string | null = null;
  let originDesktop: string | null = null;
  let origin: string | null = null;
  let commit = 'unknown';
  let maxCells: number | null = null;
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
      case '--commit': commit = needValue(); break;
      case '--max-cells': {
        const parsed = Number.parseInt(needValue(), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) throw new P6BrowserUsageError('--max-cells must be a positive integer');
        maxCells = parsed;
        break;
      }
      default: throw new P6BrowserUsageError(`unknown or incomplete argument: ${String(arg)}`);
    }
  }
  if (artifactDir === null) throw new P6BrowserUsageError('--artifact-dir is required');
  if (browserExecutable === null) throw new P6BrowserUsageError('--browser-executable is required (no discovery, no PATH lookup)');
  // Plan §8 line 468 never passes `--scenario` to this runner for the placement-chip command — only
  // `--origin` — while the two-daemon command (line 467) never passes it either and relies on
  // `--origin-vm`/`--origin-desktop`. So an OMITTED `--scenario` is inferred from which origin flags
  // were actually given, rather than always defaulting to `two-daemon`: `--origin` alone (no
  // `--origin-vm`/`--origin-desktop`) means placement-chip; anything else keeps the prior default.
  const resolvedScenario: P6Scenario = scenario
    ?? (origin !== null && originVm === null && originDesktop === null ? 'placement-chip' : 'two-daemon');
  if (resolvedScenario === 'two-daemon' && (originVm === null || originDesktop === null)) {
    throw new P6BrowserUsageError('the two-daemon scenario requires --origin-vm and --origin-desktop');
  }
  if (resolvedScenario === 'placement-chip' && origin === null) {
    throw new P6BrowserUsageError('the placement-chip scenario requires --origin');
  }
  return { scenario: resolvedScenario, artifactDir, browserExecutable, originVm, originDesktop, origin, commit, maxCells };
}

/* ------------------------------------------------------------------------------------------------ *
 * The REAL browser capture — reuses the PROVEN P3 CDP driver verbatim, exactly as the P5 runner does.
 *
 * Before this, `main` was a STUB: it parse-validated its arguments, printed "run it there", and wrote no
 * artifacts. This section drives a real Edge/Chromium over CDP against the live fixture origin the §8
 * command brought up: it navigates each matrix cell, records whether the app shell mounted
 * (`assessReachedTheApp`) and every console error, writes one artifact per cell, and fails the run (exit
 * `cellFailed`) on any cell that did not reach the app or logged a console error.
 * ------------------------------------------------------------------------------------------------ */

/** The UI origin Edge navigates for a scenario: the Desktop daemon's local UI for `two-daemon`, and the
 *  bounded fixture origin for `placement-chip`. Both are the origins the §8 commands pass. */
function originForScenario(args: P6BrowserCliArgs): string {
  if (args.scenario === 'two-daemon') {
    // Both daemons are up; the Desktop origin is the one that carries the local placement UI + read proxy.
    return args.originDesktop ?? args.originVm ?? '';
  }
  return args.origin ?? '';
}

/** A p6 matrix cell → the p3 driver's cell shape. Reduced-motion is recorded in the p6 artifact but not
 *  emulated at the CDP level (the p3 driver has no reduced-motion knob), exactly as the p5 runner folds it. */
function toP3Cell(cell: MatrixCell): P3MatrixCell {
  return {
    id: `${cell.theme}-${cell.width}-${cell.interaction}-${cell.motion}`,
    theme: cell.theme,
    viewport: { width: cell.width, height: 900 },
    inputMode: cell.interaction === 'keyboard-only' ? 'keyboard-only' : 'pointer',
  };
}

/* ------------------------------------------------------------------------------------------------ *
 * W6.3 fix-round — the `placement-chip` scenario's DOM bullets (plan §8 "Bounded browser fixture" proof
 * row): the host chip reading the persisted `executionHost`, a Desktop-placed run rendering the Desktop
 * chip, and a `no-complete-placement` launch showing the closed refusal copy with no queued row. Before
 * this, EVERY p6 scenario's cell passed on reached-app + zero console errors alone — the proof row's
 * three claims were never checked against a rendered DOM. Each function below is a pure string/regex
 * check, the same idiom as P5's `evaluateP5ScenarioBullet` (`p5ActualBrowserRunner.ts`), so a wrong DOM
 * provably fails it without launching a browser (see this file's `.test.ts`).
 * ------------------------------------------------------------------------------------------------ */

export interface BulletVerdict {
  readonly ok: boolean;
  readonly detail: string;
}

function extractRunV3Header(dom: string): string {
  const match = /<header class="run-v3__header">[\s\S]*?<\/header>/.exec(dom);
  return match ? match[0] : '';
}

/** RunDetail's host chip (`src/views/RunDetail.tsx:333`) renders `{state} · {owner} ·
 *  {VM|Desktop}` — the LAST middot-delimited segment is the chip, read straight off the run's persisted
 *  `executionHost`. Matching only the segment immediately before `</p>` matters: the owner name can
 *  itself contain "VM" (e.g. "Placement Chip VM"), so a naive substring search would false-positive. */
export function assertHostChip(dom: string, expected: 'VM' | 'Desktop'): BulletVerdict {
  const header = extractRunV3Header(dom);
  if (header === '') return { ok: false, detail: 'RunDetail did not mount: no <header class="run-v3__header"> in the DOM' };
  const match = /·\s*(VM|Desktop)\s*<\/p>/.exec(header);
  const shown = match?.[1] ?? null;
  return { ok: shown === expected, detail: `RunDetail header host chip shows ${shown ?? 'nothing'}; expected ${expected}` };
}

/** `Workflows.tsx`'s launch refusal: a 409 `no-complete-placement` sets `launchStatus` to the RAW error
 *  string (`body.error ?? 'Launch refused'`), rendered as `<span role="status">no-complete-placement</span>`
 *  — and because the client never optimistically inserts a run, the Live section's activeRuns list stays
 *  the empty-state `<p class="entity-note">` (plan §3.2: no Run row is ever created for this outcome). */
export function assertNoCompletePlacementRefusal(dom: string): BulletVerdict {
  const refusalCopyShown = /role="status"[^>]*>\s*no-complete-placement\s*</.test(dom);
  const noQueuedRow = !dom.includes('class="entity-list"') && !dom.includes('Placement chip run');
  const emptyStateShown = dom.includes('class="entity-note"') && dom.includes('Never run');
  return {
    ok: refusalCopyShown && noQueuedRow && emptyStateShown,
    detail: `refusal-copy-shown=${refusalCopyShown}, no-queued-row=${noQueuedRow}, empty-state-shown=${emptyStateShown}`,
  };
}

/** Accessible-name click paths into the `p6-placement-chip` fixture's three workflows (plan §8 line 468;
 *  fixture data in `p1BrowserFixture.ts`). Names are matched by substring (`p3ActualBrowserRunner.ts`'s
 *  `clickByAccessibleName`), so each is chosen to be a unique substring of exactly one roster card / row. */
const PLACEMENT_CHIP_OPEN_VM_RUN = ['Placement Chip VM', 'Placement chip run'] as const;
const PLACEMENT_CHIP_OPEN_DESKTOP_RUN = ['Placement Chip Desktop', 'Placement chip run'] as const;
const PLACEMENT_CHIP_REFUSE_LAUNCH = ['Placement Chip Refused', 'Run now'] as const;

/**
 * Chromium's Log domain reports EVERY HTTP response with status >= 400 to the console — "Failed to load
 * resource: the server responded with a status of …" — regardless of whether the page handles it (this
 * scenario's launch DOES: it reads `body.error` and renders the refusal copy, with no thrown exception).
 * That browser-level echo is not evidence of anything wrong; it is the unavoidable side effect of making
 * the refusal a REAL network round-trip rather than faking the DOM. So exactly this one, exactly-matched
 * line — this scenario's own fixture URL and status, nothing broader — is excluded from the "unexpected
 * console errors" gate. No other console error, from any of the three navigations, is ever filtered.
 */
const EXPECTED_REFUSAL_NETWORK_LOG =
  /^Failed to load resource: the server responded with a status of 409 \(Conflict\) \[.*\/api\/workflows\/placement-chip-refused\/launch\]$/;

/** The `placement-chip` scenario's per-cell capture: THREE navigations (VM run, Desktop run, refused
 *  launch), because no single view proves all three plan-§8 bullets at once. A cell fails on any
 *  reached-app miss, any click-path failure, any UNEXPECTED console error across all three navigations,
 *  or a false bullet — never on reached-app alone, which is what every p6 scenario's cell checked before
 *  this. */
async function capturePlacementChipCell(browser: ActualBrowser, cell: P3MatrixCell, origin: string): Promise<CellCapture> {
  const navigate = (clickPath: readonly string[]): ReturnType<ActualBrowser['runCell']> =>
    browser.runCell(cell, { origin, entryPath: '/', viewPath: '/?view=workflows', clickPath: [...clickPath] });

  const vm = await navigate(PLACEMENT_CHIP_OPEN_VM_RUN);
  const desktop = await navigate(PLACEMENT_CHIP_OPEN_DESKTOP_RUN);
  const refused = await navigate(PLACEMENT_CHIP_REFUSE_LAUNCH);

  const refusedConsoleErrors = refused.consoleErrors.filter((entry) => !EXPECTED_REFUSAL_NETWORK_LOG.test(entry));
  const consoleErrors = [...vm.consoleErrors, ...desktop.consoleErrors, ...refusedConsoleErrors];
  const clickFailures = [...vm.clickFailures, ...desktop.clickFailures, ...refused.clickFailures];
  const reachedApp = [vm, desktop, refused]
    .map((observation) => assessReachedTheApp(observation.dom))
    .every((verdict) => verdict.marker !== null && verdict.signs.length === 0);

  const vmChip = assertHostChip(vm.dom, 'VM');
  const desktopChip = assertHostChip(desktop.dom, 'Desktop');
  const refusal = assertNoCompletePlacementRefusal(refused.dom);
  const bulletOk = vmChip.ok && desktopChip.ok && refusal.ok;

  const note = `reached-app=${reachedApp}; click-failures=[${clickFailures.join(', ')}]; `
    + `vm-chip: ${vmChip.detail}; desktop-chip: ${desktopChip.detail}; refusal: ${refusal.detail}`;
  return { ok: reachedApp && clickFailures.length === 0 && bulletOk, consoleErrors, note };
}

export interface P6RealBrowserDeps {
  launch?: ActualBrowserFactory;
  readCertificate?: CertificateReader;
  inspect?: ExecutableInspector;
  now?: () => Date;
  writeArtifact?: (path: string, contents: string) => void;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/**
 * Parse, resolve the SPKI pin (a run that cannot pin an HTTPS origin does not launch), launch ONE real
 * browser, drive the (optionally capped) matrix against the live fixture origin, and tear the browser
 * down. Never throws for an expected failure — every path returns an exit code.
 */
export async function mainP6ActualBrowserRunner(
  argv: readonly string[], deps: P6RealBrowserDeps = {},
): Promise<number> {
  const log = deps.log ?? (() => undefined);
  let args: P6BrowserCliArgs;
  try {
    args = parseP6BrowserCliArgs(argv);
  } catch (error) {
    if (error instanceof P6BrowserUsageError) { log(`[p6-browser] ${error.message}`); return P6_BROWSER_EXIT.usage; }
    throw error;
  }

  const inspect = deps.inspect ?? defaultExecutableInspector;
  if (args.browserExecutable !== resolve(args.browserExecutable)) {
    log('[p6-browser] --browser-executable must be an absolute path'); return P6_BROWSER_EXIT.usage;
  }
  const verdict = inspect(args.browserExecutable);
  if (verdict !== 'ok') { log(`[p6-browser] --browser-executable is ${verdict}: ${args.browserExecutable}`); return P6_BROWSER_EXIT.usage; }

  const origin = originForScenario(args);
  const readCertificate = deps.readCertificate ?? readLoopbackCertificate;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  let spkiPin: string | null;
  try {
    spkiPin = resolveSpkiPin(origin, readCertificate);
  } catch (error) {
    log(`[p6-browser] ${error instanceof Error ? error.message : String(error)}`);
    return P6_BROWSER_EXIT.cellFailed;
  }
  if (spkiPin !== null) log(`[p6-browser] pinning the fixture SPKI ${spkiPin} for ${origin}`);

  const launch = deps.launch ?? defaultLaunchCdpBrowser;
  const browser = await launch({ executable: args.browserExecutable, timeoutMs, spkiPin });
  try {
    // `placement-chip` needs three navigations to prove its plan-§8 bullets (see
    // `capturePlacementChipCell`); every other scenario keeps the original reached-app + console-errors
    // check unchanged — this file's docstring already states that is all `two-daemon`'s cell proves.
    const capture: CellCaptureFn = args.scenario === 'placement-chip'
      ? (cell) => capturePlacementChipCell(browser, toP3Cell(cell), origin)
      : async (cell) => {
        const observation = await browser.runCell(toP3Cell(cell), { origin, entryPath: '/', viewPath: '/', clickPath: [] });
        const reached = assessReachedTheApp(observation.dom);
        const reachedApp = reached.marker !== null && reached.signs.length === 0;
        const note = `reached-app=${reachedApp} (${reached.marker ?? 'no app marker'}${reached.signs.length > 0 ? `; signs: ${reached.signs.join(', ')}` : ''}); console-errors=${observation.consoleErrors.length}`;
        return { ok: reachedApp, consoleErrors: observation.consoleErrors, note };
      };
    const cells = args.maxCells === null ? enumerateMatrix(args.scenario) : enumerateMatrix(args.scenario).slice(0, args.maxCells);
    return await runP6BrowserMatrix(
      { scenario: args.scenario, artifactDir: args.artifactDir, commit: args.commit, now: deps.now ?? (() => new Date()), cells },
      { capture, writeArtifact: deps.writeArtifact, log },
    );
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void mainP6ActualBrowserRunner(process.argv.slice(2), { log: (line) => process.stderr.write(`${line}\n`) })
    .then((code) => { process.exitCode = code; });
}

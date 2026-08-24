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
 * Playwright is not a dependency of this package and adding one for a proof command is not on the table,
 * so the transport is the raw WebSocket client that `p3RealPtySmokeClient.ts` already owns, pointed at
 * the browser's `/json/version` debugger endpoint.
 *
 * Exit codes: 0 every cell passed - 64 usage - 65 a cell failed (console error or assertion) -
 * 67 a bounded wait expired.
 */
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { accessSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openRawWebSocket } from './p3RealPtySmokeClient.ts';
import type { RawWebSocket } from './p3RealPtySmokeClient.ts';

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

  return {
    browserExecutable,
    origin: `${parsedOrigin.protocol}//${parsedOrigin.host}`,
    themes: themes as BrowserTheme[],
    viewports,
    inputModes: inputModes as BrowserInputMode[],
    artifactDir,
    scenario: basename(artifactDir),
    timeoutMs,
  };
}

/* ------------------------------------------------------------------------------------------------ *
 * The browser port
 * ------------------------------------------------------------------------------------------------ */

export interface CellObservation {
  /** PNG bytes. Written verbatim; never re-encoded. */
  screenshot: Buffer;
  dom: string;
  trace: { requests: string[]; websockets: string[] };
  keyboardNote: string;
  consoleErrors: string[];
}

export interface ActualBrowser {
  runCell(cell: MatrixCell, origin: string): Promise<CellObservation>;
  close(): Promise<void>;
}

export type ActualBrowserFactory = (input: {
  executable: string;
  timeoutMs: number;
}) => Promise<ActualBrowser>;

export interface CellResult {
  cell: string;
  theme: BrowserTheme;
  viewport: string;
  inputMode: BrowserInputMode;
  ok: boolean;
  consoleErrors: string[];
  screenshotBytes: number;
  keyboardNote: string;
}

export interface BrowserRunReport {
  code: BrowserExitCode;
  scenario: string;
  cells: CellResult[];
  message: string;
}

export interface P3ActualBrowserRunnerDeps {
  launch?: ActualBrowserFactory;
  writeArtifact?: (path: string, contents: Buffer | string) => void;
  ensureDir?: (path: string) => void;
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
  const log = deps.log ?? (() => {});

  const cells = enumerateBrowserMatrix(args.themes, args.viewports, args.inputModes);
  ensureDir(args.artifactDir);
  const browser = await launch({ executable: args.browserExecutable, timeoutMs: args.timeoutMs });
  const results: CellResult[] = [];
  let failure: string | null = null;
  try {
    for (const cell of cells) {
      const observation = await browser.runCell(cell, args.origin);
      const cellDir = join(args.artifactDir, cell.id);
      ensureDir(cellDir);
      writeArtifact(join(cellDir, 'screenshot.png'), observation.screenshot);
      writeArtifact(join(cellDir, 'dom.html'), observation.dom);
      writeArtifact(join(cellDir, 'trace.json'), `${JSON.stringify(observation.trace, null, 2)}\n`);
      writeArtifact(join(cellDir, 'keyboard.txt'), `${observation.keyboardNote}\n`);
      const ok = observation.consoleErrors.length === 0;
      const result: CellResult = {
        cell: cell.id,
        theme: cell.theme,
        viewport: `${cell.viewport.width}x${cell.viewport.height}`,
        inputMode: cell.inputMode,
        ok,
        consoleErrors: observation.consoleErrors,
        screenshotBytes: observation.screenshot.length,
        keyboardNote: observation.keyboardNote,
      };
      results.push(result);
      writeArtifact(join(cellDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
      log(`[p3-browser] ${cell.id} ${ok ? 'ok' : 'FAILED'}`);
      if (!ok && failure === null) {
        // The remaining cells still run: a matrix that stops at the first red hides whether the defect
        // is one cell or all eight, which is the question the artifact set exists to answer.
        failure = `${cell.id}: ${observation.consoleErrors.join(' | ')}`;
      }
    }
  } finally {
    await browser.close();
  }

  const code = failure === null ? BROWSER_EXIT.ok : BROWSER_EXIT.failed;
  const report: BrowserRunReport = {
    code,
    scenario: args.scenario,
    cells: results,
    message: failure === null ? `${results.length} cells passed` : `console errors in ${failure}`,
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
 * Launch the SUPPLIED binary with a private profile and a fixed debugging port, then drive one page per
 * matrix cell. `--ignore-certificate-errors` is deliberately ABSENT: the fixture serves a loopback
 * certificate the browser is pointed at directly, and a runner that disabled certificate checking would
 * quietly green the very TLS row it is meant to prove.
 */
export const defaultLaunchCdpBrowser: ActualBrowserFactory = async ({ executable, timeoutMs }) => {
  const debugPort = 9222 + (process.pid % 500);
  const profile = mkdtempSync(join(tmpdir(), 'kb-p3-browser-'));
  const child = spawn(executable, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
  ], { stdio: 'ignore', shell: false });

  const url = await fetchDebuggerUrl(debugPort, Date.now() + timeoutMs);
  const cdp = await openCdp(url, timeoutMs);

  return {
    async runCell(cell, origin): Promise<CellObservation> {
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
      await cdp.send('Page.navigate', { url: origin }, sessionId);
      // A bounded settle: the fixture is loopback, so a fixed slice is enough for first paint and the
      // initial fetches, and nothing here waits on an unbounded network idle.
      await new Promise<void>((settle) => { const t = setTimeout(settle, 1_500); t.unref?.(); });

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
          if (entry.level === 'error') consoleErrors.push(String(entry.text ?? ''));
        }
        if (event.method === 'Network.requestWillBeSent') {
          const request = (params.request ?? {}) as Record<string, unknown>;
          requests.push(String(request.url ?? ''));
        }
        if (event.method === 'Network.webSocketCreated') websockets.push(String(params.url ?? ''));
      }

      await cdp.send('Target.closeTarget', { targetId });
      const domValue = (dom.result as { value?: unknown } | undefined)?.value;
      return {
        screenshot: Buffer.from(String(shot.data ?? ''), 'base64'),
        dom: typeof domValue === 'string' ? domValue : '',
        trace: { requests, websockets },
        keyboardNote,
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

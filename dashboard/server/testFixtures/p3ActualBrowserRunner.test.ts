import { describe, expect, it } from 'vitest';
import {
  BROWSER_EXIT,
  BrowserRunnerFailure,
  defaultExecutableInspector,
  enumerateBrowserMatrix,
  mainP3ActualBrowserRunner,
  parseP3ActualBrowserRunnerArgs,
  runP3ActualBrowserMatrix,
} from './p3ActualBrowserRunner.ts';
import type {
  ActualBrowser, ActualBrowserFactory, CellObservation, ExecutableInspector, MatrixCell,
} from './p3ActualBrowserRunner.ts';
import { expectUsageRefusal } from './expectUsageRefusal.ts';

const BROWSER = process.platform === 'win32' ? 'C:\\browsers\\msedge.exe' : '/opt/browsers/msedge';
const okInspector: ExecutableInspector = () => 'ok';

function argv(overrides: Record<string, string | null> = {}): string[] {
  const base: Record<string, string | null> = {
    '--browser-executable': BROWSER,
    '--origin': 'https://127.0.0.1:4322',
    '--themes': 'dark,light',
    '--viewports': '1440x900,720x900',
    '--input-modes': 'pointer,keyboard-only',
    '--artifact-dir': '.artifacts/p3-browser/p3-terminal-named-sessions',
    ...overrides,
  };
  const out: string[] = [];
  for (const [flag, value] of Object.entries(base)) {
    if (value === null) continue;
    out.push(flag, value);
  }
  return out;
}

function parse(overrides: Record<string, string | null> = {}, inspect: ExecutableInspector = okInspector) {
  return parseP3ActualBrowserRunnerArgs(argv(overrides), inspect);
}

const expectUsage = (run: () => unknown, fragment: string): void =>
  expectUsageRefusal(run, { failure: BrowserRunnerFailure, code: BROWSER_EXIT.usage, fragment });

describe('parseP3ActualBrowserRunnerArgs', () => {
  it('accepts the section 8 command line and derives the scenario from the artifact directory', () => {
    const args = parse();
    expect(args.browserExecutable).toBe(BROWSER);
    expect(args.origin).toBe('https://127.0.0.1:4322');
    expect(args.themes).toEqual(['dark', 'light']);
    expect(args.viewports).toEqual([{ width: 1440, height: 900 }, { width: 720, height: 900 }]);
    expect(args.inputModes).toEqual(['pointer', 'keyboard-only']);
    expect(args.scenario).toBe('p3-terminal-named-sessions');
  });

  it('refuses an absent --browser-executable rather than discovering one', () => {
    expectUsage(() => parse({ '--browser-executable': null }), 'no discovery, no PATH lookup');
  });

  it('refuses a bare browser name, which would become a PATH lookup', () => {
    expectUsage(() => parse({ '--browser-executable': 'msedge' }), 'absolute path');
  });

  it('refuses a browser path that does not exist', () => {
    expectUsage(() => parse({}, () => 'missing'), 'is missing');
  });

  it('refuses a browser path that is a directory', () => {
    expectUsage(() => parse({}, () => 'not-a-file'), 'is not-a-file');
  });

  it('refuses a browser path that is not executable', () => {
    expectUsage(() => parse({}, () => 'not-executable'), 'is not-executable');
  });

  it('refuses a missing --origin', () => {
    expectUsage(() => parse({ '--origin': null }), '--origin is required');
  });

  it('refuses a non-http origin', () => {
    expectUsage(() => parse({ '--origin': 'ws://127.0.0.1:4322' }), '--origin must be http(s)');
  });

  it('refuses a missing --artifact-dir', () => {
    expectUsage(() => parse({ '--artifact-dir': null }), '--artifact-dir is required');
  });

  it('refuses an unknown theme', () => {
    expectUsage(() => parse({ '--themes': 'dark,sepia' }), 'unknown theme sepia');
  });

  it('refuses a viewport that is not WIDTHxHEIGHT', () => {
    expectUsage(() => parse({ '--viewports': 'desktop' }), 'is not WIDTHxHEIGHT');
  });

  it('refuses an unknown input mode', () => {
    expectUsage(() => parse({ '--input-modes': 'pointer,voice' }), 'unknown mode voice');
  });

  it('refuses an unknown flag', () => {
    expectUsage(() => parseP3ActualBrowserRunnerArgs([...argv(), '--ignore-certificate-errors'], okInspector),
      'unknown flag --ignore-certificate-errors');
  });

  it('refuses a non-positive --timeout-ms', () => {
    expectUsage(() => parse({ '--timeout-ms': '0' }), '--timeout-ms must be a positive integer');
  });

  it('defaultExecutableInspector reports a directory as not-a-file', () => {
    expect(defaultExecutableInspector(process.cwd())).toBe('not-a-file');
    expect(defaultExecutableInspector(`${process.cwd()}/definitely-not-here-p3`)).toBe('missing');
  });
});

describe('enumerateBrowserMatrix', () => {
  it('walks theme, then viewport, then input mode', () => {
    const cells = enumerateBrowserMatrix(
      ['dark', 'light'],
      [{ width: 1440, height: 900 }, { width: 720, height: 900 }],
      ['pointer', 'keyboard-only'],
    );
    expect(cells).toHaveLength(8);
    expect(cells.map((cell) => cell.id)).toEqual([
      'dark-1440x900-pointer', 'dark-1440x900-keyboard-only',
      'dark-720x900-pointer', 'dark-720x900-keyboard-only',
      'light-1440x900-pointer', 'light-1440x900-keyboard-only',
      'light-720x900-pointer', 'light-720x900-keyboard-only',
    ]);
  });
});

/** A fake browser process: it records the cells it was asked for and answers with scripted artifacts. */
function fakeBrowser(errorsForCell: (cell: MatrixCell) => string[] = () => []): {
  launch: ActualBrowserFactory;
  seen: string[];
  closed: () => boolean;
  launchedWith: () => string | null;
} {
  const seen: string[] = [];
  let closed = false;
  let launchedWith: string | null = null;
  const launch: ActualBrowserFactory = async ({ executable }) => {
    launchedWith = executable;
    const browser: ActualBrowser = {
      async runCell(cell: MatrixCell, origin: string): Promise<CellObservation> {
        seen.push(cell.id);
        return {
          screenshot: Buffer.from(`png:${cell.id}`, 'utf8'),
          dom: `<html data-cell="${cell.id}" data-origin="${origin}"></html>`,
          trace: { requests: [`${origin}/api/pty/sessions`], websockets: [`${origin.replace('https', 'wss')}/api/pty`] },
          keyboardNote: `focus after ${cell.inputMode}`,
          consoleErrors: errorsForCell(cell),
        };
      },
      async close(): Promise<void> { closed = true; },
    };
    return browser;
  };
  return { launch, seen, closed: () => closed, launchedWith: () => launchedWith };
}

function recordingSink() {
  const written = new Map<string, string>();
  const dirs: string[] = [];
  return {
    written,
    dirs,
    writeArtifact: (path: string, contents: Buffer | string): void => {
      written.set(path.replaceAll('\\', '/'), typeof contents === 'string' ? contents : contents.toString('utf8'));
    },
    ensureDir: (path: string): void => { dirs.push(path.replaceAll('\\', '/')); },
  };
}

describe('runP3ActualBrowserMatrix', () => {
  it('runs every cell in order against the supplied binary and writes one artifact set per cell', async () => {
    const browser = fakeBrowser();
    const sink = recordingSink();
    const report = await runP3ActualBrowserMatrix(parse(), { launch: browser.launch, ...sink });

    expect(report.code).toBe(BROWSER_EXIT.ok);
    expect(browser.launchedWith()).toBe(BROWSER);
    expect(browser.seen).toEqual([
      'dark-1440x900-pointer', 'dark-1440x900-keyboard-only',
      'dark-720x900-pointer', 'dark-720x900-keyboard-only',
      'light-1440x900-pointer', 'light-1440x900-keyboard-only',
      'light-720x900-pointer', 'light-720x900-keyboard-only',
    ]);
    expect(report.cells.map((cell) => cell.cell)).toEqual(browser.seen);
    const root = '.artifacts/p3-browser/p3-terminal-named-sessions';
    for (const cell of browser.seen) {
      for (const artifact of ['screenshot.png', 'dom.html', 'trace.json', 'keyboard.txt', 'result.json']) {
        expect(sink.written.has(`${root}/${cell}/${artifact}`)).toBe(true);
      }
    }
    expect(sink.written.get(`${root}/dark-720x900-pointer/screenshot.png`)).toBe('png:dark-720x900-pointer');
    expect(JSON.parse(sink.written.get(`${root}/result.json`) ?? '{}')).toMatchObject({
      scenario: 'p3-terminal-named-sessions', code: 0,
    });
    expect(browser.closed()).toBe(true);
  });

  it('fails the run on a console error, still records every cell, and closes the browser', async () => {
    const browser = fakeBrowser((cell) => cell.id === 'dark-720x900-keyboard-only' ? ['TypeError: x is not a function'] : []);
    const sink = recordingSink();
    const report = await runP3ActualBrowserMatrix(parse(), { launch: browser.launch, ...sink });

    expect(report.code).toBe(BROWSER_EXIT.failed);
    expect(report.message).toContain('dark-720x900-keyboard-only');
    expect(report.message).toContain('TypeError');
    expect(browser.seen).toHaveLength(8);
    expect(report.cells.filter((cell) => !cell.ok).map((cell) => cell.cell)).toEqual(['dark-720x900-keyboard-only']);
    expect(browser.closed()).toBe(true);
  });

  it('closes the browser even when a cell throws', async () => {
    let closed = false;
    const launch: ActualBrowserFactory = async () => ({
      async runCell(): Promise<CellObservation> { throw new Error('devtools went away'); },
      async close(): Promise<void> { closed = true; },
    });
    await expect(runP3ActualBrowserMatrix(parse(), { launch, ...recordingSink() })).rejects.toThrow('devtools went away');
    expect(closed).toBe(true);
  });
});

describe('mainP3ActualBrowserRunner', () => {
  it('returns 64 for a refused argv without launching anything', async () => {
    const browser = fakeBrowser();
    const code = await mainP3ActualBrowserRunner(argv({ '--browser-executable': null }), {
      launch: browser.launch, inspect: okInspector, ...recordingSink(),
    });
    expect(code).toBe(BROWSER_EXIT.usage);
    expect(browser.launchedWith()).toBeNull();
  });

  it('returns 0 for a clean matrix and 65 when a cell logged a console error', async () => {
    const clean = fakeBrowser();
    expect(await mainP3ActualBrowserRunner(argv(), { launch: clean.launch, inspect: okInspector, ...recordingSink() }))
      .toBe(BROWSER_EXIT.ok);
    const dirty = fakeBrowser((cell) => cell.id.startsWith('light') ? ['Uncaught (in promise)'] : []);
    expect(await mainP3ActualBrowserRunner(argv(), { launch: dirty.launch, inspect: okInspector, ...recordingSink() }))
      .toBe(BROWSER_EXIT.failed);
  });
});

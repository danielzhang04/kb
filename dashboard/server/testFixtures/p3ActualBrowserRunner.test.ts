import { describe, expect, it } from 'vitest';
import {
  APP_MARKER,
  DEFAULT_ENTRY_PATH,
  DEFAULT_VIEW_PATH,
  CONTEXT_B_ENTRY,
  scenarioNavigation,
  BROWSER_EXIT,
  BrowserRunnerFailure,
  assessReachedTheApp,
  defaultExecutableInspector,
  enumerateBrowserMatrix,
  findScenarioClash,
  mainP3ActualBrowserRunner,
  parseP3ActualBrowserRunnerArgs,
  resolveSpkiPin,
  runP3ActualBrowserMatrix,
  spkiSha256Base64,
} from './p3ActualBrowserRunner.ts';
import type {
  ActualBrowser, ActualBrowserFactory, CellObservation, CellTarget, CertificateReader,
  ExecutableInspector, MatrixCell,
} from './p3ActualBrowserRunner.ts';
import { expectUsageRefusal } from './expectUsageRefusal.ts';
import { createLoopbackTlsMaterial } from './p3LoopbackTls.ts';

const BROWSER = process.platform === 'win32' ? 'C:\\browsers\\msedge.exe' : '/opt/browsers/msedge';
const okInspector: ExecutableInspector = () => 'ok';

/** One real fixture certificate, minted once: every pin test needs the same PEM shape the fixture serves. */
const fixtureCertificate = await createLoopbackTlsMaterial();
const readFixtureCertificate: CertificateReader = () => fixtureCertificate.cert;
const noCertificate: CertificateReader = () => null;

/** A DOM that reached the app, and the interstitial DOM Chrome actually served the W6.6 matrix. */
function appDom(body: string): string {
  return `<html><head><title>kb Mission Control</title></head><body><div id="root"><div class="app-shell">${body}</div></div></body></html>`;
}
const INTERSTITIAL_DOM = '<html><head><title>Privacy error</title></head><body><div id="main-content">'
  + '<p>net::ERR_CERT_AUTHORITY_INVALID</p><p id="error-code">NET::ERR_CERT_AUTHORITY_INVALID</p>'
  + '<button id="details-button">Advanced</button></div></body></html>';

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

  it('defaults to entering as context A and recording the terminal view', () => {
    const args = parse();
    expect(args.entryPath).toBe(DEFAULT_ENTRY_PATH);
    expect(args.viewPath).toBe(DEFAULT_VIEW_PATH);
  });

  it('refuses an entry or view path that is not origin-relative', () => {
    expectUsage(() => parse({ '--entry-path': 'https://evil.example/' }), '--entry-path must be an origin-relative path');
    expectUsage(() => parse({ '--view-path': '//evil.example/' }), '--view-path must be an origin-relative path');
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

/**
 * A fake browser process: it records the cells it was asked for, the SPKI pin it was launched with, and
 * answers with scripted artifacts. `domForCell` defaults to a DOM that reached the app.
 */
function fakeBrowser(
  errorsForCell: (cell: MatrixCell) => string[] = () => [],
  domForCell: (cell: MatrixCell) => string = (cell) => appDom(`shell · kb rendered ${cell.id}`),
): {
  launch: ActualBrowserFactory;
  seen: string[];
  closed: () => boolean;
  launchedWith: () => string | null;
  pinnedWith: () => string | null;
  visited: string[];
} {
  const seen: string[] = [];
  const visited: string[] = [];
  let closed = false;
  let launchedWith: string | null = null;
  let pinnedWith: string | null = null;
  const launch: ActualBrowserFactory = async ({ executable, spkiPin }) => {
    launchedWith = executable;
    pinnedWith = spkiPin;
    const browser: ActualBrowser = {
      async runCell(cell: MatrixCell, { origin, entryPath, viewPath }: CellTarget): Promise<CellObservation> {
        seen.push(cell.id);
        visited.push(`${entryPath} -> ${viewPath}`);
        const dom = domForCell(cell);
        const rootMatch = /<div id="root">([\s\S]*)<\/div><\/body>/.exec(dom);
        return {
          screenshot: Buffer.from(`png:${cell.id}`, 'utf8'),
          dom,
          appRootHtml: rootMatch === null ? '' : rootMatch[1],
          trace: { requests: [`${origin}/api/pty/sessions`], websockets: [`${origin.replace('https', 'wss')}/api/pty`] },
          keyboardNote: `focus after ${cell.inputMode}`,
          clicked: [],
          clickFailures: [],
          consoleErrors: errorsForCell(cell),
        };
      },
      async close(): Promise<void> { closed = true; },
    };
    return browser;
  };
  return {
    launch, seen, visited, closed: () => closed, launchedWith: () => launchedWith, pinnedWith: () => pinnedWith,
  };
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

/** Certificate present, no sibling scenarios on disk: the seams a matrix test should not depend on. */
const isolated = { readCertificate: readFixtureCertificate, readSiblingDigests: () => [] };

describe('runP3ActualBrowserMatrix', () => {
  it('runs every cell in order against the supplied binary and writes one artifact set per cell', async () => {
    const browser = fakeBrowser();
    const sink = recordingSink();
    const report = await runP3ActualBrowserMatrix(parse(), { launch: browser.launch, ...isolated, ...sink });

    expect(report.code).toBe(BROWSER_EXIT.ok);
    expect(browser.launchedWith()).toBe(BROWSER);
    expect(browser.visited[0]).toBe(`${DEFAULT_ENTRY_PATH} -> ${DEFAULT_VIEW_PATH}`);
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
    const report = await runP3ActualBrowserMatrix(parse(), { launch: browser.launch, ...isolated, ...sink });

    expect(report.code).toBe(BROWSER_EXIT.failed);
    expect(report.message).toContain('dark-720x900-keyboard-only');
    expect(report.message).toContain('TypeError');
    expect(browser.seen).toHaveLength(8);
    expect(report.cells.filter((cell) => !cell.ok).map((cell) => cell.cell)).toEqual(['dark-720x900-keyboard-only']);
    expect(report.cells.find((cell) => !cell.ok)?.failureReason).toBe('console-error');
    expect(browser.closed()).toBe(true);
  });

  it('closes the browser even when a cell throws', async () => {
    let closed = false;
    const launch: ActualBrowserFactory = async () => ({
      async runCell(): Promise<CellObservation> { throw new Error('devtools went away'); },
      async close(): Promise<void> { closed = true; },
    });
    await expect(runP3ActualBrowserMatrix(parse(), { launch, ...isolated, ...recordingSink() }))
      .rejects.toThrow('devtools went away');
    expect(closed).toBe(true);
  });

  it('records the app marker in every cell result and in the run report message', async () => {
    const sink = recordingSink();
    const report = await runP3ActualBrowserMatrix(parse(), { launch: fakeBrowser().launch, ...isolated, ...sink });
    expect(report.cells.every((cell) => cell.marker === APP_MARKER)).toBe(true);
    expect(report.message).toContain(APP_MARKER);
    const cellResult = JSON.parse(
      sink.written.get('.artifacts/p3-browser/p3-terminal-named-sessions/dark-1440x900-pointer/result.json') ?? '{}',
    ) as { marker?: unknown; appRootHash?: unknown };
    expect(cellResult.marker).toBe(APP_MARKER);
    expect(typeof cellResult.appRootHash).toBe('string');
  });
});

/* The three W6.6f guards. */

describe('SPKI pinning (guard 1)', () => {
  it('hashes the fixture certificate to a 32-byte base64 SPKI digest and pins the launch to it', async () => {
    const pin = spkiSha256Base64(fixtureCertificate.cert);
    expect(Buffer.from(pin, 'base64')).toHaveLength(32);
    const browser = fakeBrowser();
    await runP3ActualBrowserMatrix(parse(), { launch: browser.launch, ...isolated, ...recordingSink() });
    expect(browser.pinnedWith()).toBe(pin);
  });

  it('resolves no pin for a plain-http origin, which has nothing to pin', () => {
    expect(resolveSpkiPin('http://127.0.0.1:4322', noCertificate)).toBeNull();
  });

  it('refuses to start when the fixture published no PEM, rather than ignoring certificate errors', async () => {
    const browser = fakeBrowser();
    const code = await mainP3ActualBrowserRunner(argv(), {
      launch: browser.launch, inspect: okInspector, readCertificate: noCertificate,
      readSiblingDigests: () => [], ...recordingSink(),
    });
    expect(code).toBe(BROWSER_EXIT.failed);
    expect(browser.launchedWith()).toBeNull();
  });

  it('refuses to start when the published PEM is not a certificate', () => {
    const broken: CertificateReader = () => '-----BEGIN CERTIFICATE-----\nbm90LWEtY2VydA==\n-----END CERTIFICATE-----\n';
    try {
      resolveSpkiPin('https://127.0.0.1:4322', broken);
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserRunnerFailure);
      expect((error as BrowserRunnerFailure).code).toBe(BROWSER_EXIT.failed);
      return;
    }
    throw new Error('expected an unhashable certificate to refuse the launch');
  });
});

describe('reached-the-app assertion (guard 2)', () => {
  it('accepts a rendered app shell and rejects Chrome\'s certificate interstitial', () => {
    expect(assessReachedTheApp(appDom('sidebar'))).toEqual({ marker: APP_MARKER, signs: [] });
    const verdict = assessReachedTheApp(INTERSTITIAL_DOM);
    expect(verdict.marker).toBeNull();
    expect(verdict.signs).toEqual(['Privacy error', 'NET::ERR', 'id="details-button"']);
  });

  it('rejects an empty root: index.html ships one, so it is not evidence the app ran', () => {
    expect(assessReachedTheApp('<html><body><div id="root"></div></body></html>').marker).toBeNull();
  });

  it('rejects an app shell that also carries an interstitial sign', () => {
    const verdict = assessReachedTheApp(appDom('<p>NET::ERR_CERT_AUTHORITY_INVALID</p>'));
    expect(verdict.marker).toBe(APP_MARKER);
    expect(verdict.signs).toEqual(['NET::ERR']);
  });

  it('fails every interstitial cell as not-the-app with a non-zero exit, console silence notwithstanding', async () => {
    // An interstitial logs nothing: this is exactly the run W6.6 certified as eight green cells.
    const browser = fakeBrowser(() => [], () => INTERSTITIAL_DOM);
    const sink = recordingSink();
    const code = await mainP3ActualBrowserRunner(argv(), {
      launch: browser.launch, inspect: okInspector, ...isolated, ...sink,
    });
    expect(code).toBe(BROWSER_EXIT.failed);
    const report = JSON.parse(sink.written.get('.artifacts/p3-browser/p3-terminal-named-sessions/result.json') ?? '{}') as {
      cells?: { ok: boolean; marker: string | null; failureReason: string | null }[];
    };
    expect(report.cells).toHaveLength(8);
    expect(report.cells?.every((cell) => !cell.ok && cell.marker === null && cell.failureReason === 'not-the-app')).toBe(true);
  });
});

describe('per-scenario evidence (guard 2b)', () => {
  it('fails a cell that reached the app but never rendered the scenario payload', async () => {
    // Reaches the app, clicks nothing, logs nothing — and shows an empty list because the fixture
    // never authorized it. Only the scenario's required text catches this.
    const browser = fakeBrowser(() => [], () => appDom('Start a session'));
    const report = await runP3ActualBrowserMatrix(parse(), { launch: browser.launch, ...isolated, ...recordingSink() });
    expect(report.code).toBe(BROWSER_EXIT.failed);
    expect(report.cells.every((cell) => cell.failureReason === 'missing-evidence')).toBe(true);
    expect(report.cells[0]?.missingText).toEqual(['shell · kb']);
  });

  it('gives each p3 scenario the view where it differs', () => {
    expect(scenarioNavigation('p3-terminal-named-sessions').viewPath).toBe('/?view=terminal');
    expect(scenarioNavigation('p3-run-attempt-sessions').clickPath).toEqual(['Video Run', 'Live']);
    expect(scenarioNavigation('p3-controller-isolation').entryPath).toBe(CONTEXT_B_ENTRY);
    expect(scenarioNavigation('not-a-p3-scenario')).toEqual({
      entryPath: DEFAULT_ENTRY_PATH, viewPath: DEFAULT_VIEW_PATH, clickPath: [], requiredText: [],
    });
  });
});

describe('cross-scenario distinctness (guard 3)', () => {
  const hashes = { 'dark-1440x900-pointer': 'aaa', 'light-720x900-pointer': 'bbb' };

  it('allows identical cells within one scenario but fails identical roots across scenarios', () => {
    expect(findScenarioClash({ scenario: 'p3-a', cellHashes: hashes }, [{ scenario: 'p3-a', cellHashes: hashes }]))
      .toBeNull();
    expect(findScenarioClash({ scenario: 'p3-a', cellHashes: hashes }, [{ scenario: 'p3-b', cellHashes: hashes }]))
      .toContain('p3-b');
    expect(findScenarioClash(
      { scenario: 'p3-a', cellHashes: hashes },
      [{ scenario: 'p3-b', cellHashes: { ...hashes, 'light-720x900-pointer': 'ccc' } }],
    )).toBeNull();
  });

  it('fails the run when a sibling scenario recorded byte-identical app roots', async () => {
    // Two scenarios outside the p3 map, so neither carries required text: the ONLY thing that can
    // fail this run is the cross-scenario comparison.
    const clean = fakeBrowser();
    const first = await runP3ActualBrowserMatrix(parse({ '--artifact-dir': '.artifacts/p3-browser/scenario-one' }), {
      launch: clean.launch, ...isolated, ...recordingSink(),
    });
    expect(first.code).toBe(BROWSER_EXIT.ok);

    const twin = fakeBrowser();
    const report = await runP3ActualBrowserMatrix(parse({ '--artifact-dir': '.artifacts/p3-browser/scenario-two' }), {
      launch: twin.launch,
      readCertificate: readFixtureCertificate,
      readSiblingDigests: () => [{ scenario: 'scenario-one', cellHashes: first.cellHashes }],
      ...recordingSink(),
    });
    expect(report.code).toBe(BROWSER_EXIT.failed);
    expect(report.distinctness.clash).toContain('recycled page');
    expect(report.distinctness.comparedWith).toEqual(['scenario-one']);
    // Every cell still passed on its own terms: only the cross-scenario comparison caught it.
    expect(report.cells.every((cell) => cell.ok)).toBe(true);
  });
});

describe('mainP3ActualBrowserRunner', () => {
  it('returns 64 for a refused argv without launching anything', async () => {
    const browser = fakeBrowser();
    const code = await mainP3ActualBrowserRunner(argv({ '--browser-executable': null }), {
      launch: browser.launch, inspect: okInspector, ...isolated, ...recordingSink(),
    });
    expect(code).toBe(BROWSER_EXIT.usage);
    expect(browser.launchedWith()).toBeNull();
  });

  it('returns 0 for a clean matrix and 65 when a cell logged a console error', async () => {
    const clean = fakeBrowser();
    expect(await mainP3ActualBrowserRunner(argv(), {
      launch: clean.launch, inspect: okInspector, ...isolated, ...recordingSink(),
    })).toBe(BROWSER_EXIT.ok);
    const dirty = fakeBrowser((cell) => cell.id.startsWith('light') ? ['Uncaught (in promise)'] : []);
    expect(await mainP3ActualBrowserRunner(argv(), {
      launch: dirty.launch, inspect: okInspector, ...isolated, ...recordingSink(),
    })).toBe(BROWSER_EXIT.failed);
  });
});

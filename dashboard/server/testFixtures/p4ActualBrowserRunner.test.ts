import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  P4_BROWSER_EXIT, P4_VIEWPORT_WIDTHS, enumerateMatrix, mainP4ActualBrowserRunner, parseP4BrowserCliArgs,
  runP4BrowserMatrix,
} from './p4ActualBrowserRunner.ts';
import type { CellCapture, MatrixArtifact, P4BrowserDeps } from './p4ActualBrowserRunner.ts';
import type { ActualBrowser, ActualBrowserFactory, CellObservation } from './p3ActualBrowserRunner.ts';

/** A fake browser that never launches a real process: every cell returns the scripted observation. */
function fakeBrowser(dom: string, consoleErrors: string[] = []): ActualBrowserFactory {
  const observation: CellObservation = {
    screenshot: Buffer.from(''),
    dom,
    appRootHtml: '<div class="app-shell">ok</div>',
    trace: { requests: [], websockets: [] },
    keyboardNote: 'fake',
    clicked: [],
    clickFailures: [],
    consoleErrors,
  };
  const browser: ActualBrowser = {
    runCell: async () => observation,
    close: async () => undefined,
  };
  return async () => browser;
}

describe('enumerateMatrix — full light/dark × a11y × width matrix', () => {
  it('covers every theme, keyboard-only, reduced-motion, and width combination', () => {
    const cells = enumerateMatrix();
    // 2 themes × 2 keyboard × 2 reduced-motion × 3 widths.
    expect(cells).toHaveLength(2 * 2 * 2 * 3);
    expect(new Set(cells.map((c) => c.theme))).toEqual(new Set(['light', 'dark']));
    expect(new Set(cells.map((c) => c.width))).toEqual(new Set(P4_VIEWPORT_WIDTHS));
    expect(cells.some((c) => c.keyboardOnly && c.reducedMotion && c.width === 375)).toBe(true);
    // No duplicate cells.
    const keys = cells.map((c) => `${c.theme}-${c.keyboardOnly}-${c.reducedMotion}-${c.width}`);
    expect(new Set(keys).size).toBe(cells.length);
  });
});

function browserDeps(capture: (n: number) => CellCapture): { deps: P4BrowserDeps; written: Map<string, MatrixArtifact> } {
  const written = new Map<string, MatrixArtifact>();
  let n = 0;
  const deps: P4BrowserDeps = {
    capture: async () => capture(n++),
    now: () => new Date('2026-08-25T00:00:00Z'),
    writeArtifact: (path, contents) => {
      const parsed = JSON.parse(contents);
      if (parsed && typeof parsed === 'object' && 'theme' in parsed) written.set(path, parsed as MatrixArtifact);
    },
    log: () => undefined,
  };
  return { deps, written };
}

describe('runP4BrowserMatrix — artifact envelope + failure semantics', () => {
  const options = {
    fixtureKind: 'bounded', scenario: 'pr-escalation-states', commit: 'abc123',
    originUrl: 'https://127.0.0.1:4421', artifactDir: '/tmp/does-not-matter',
  };

  it('passes when every cell reaches the app with no console errors and stamps the envelope', async () => {
    const { deps, written } = browserDeps(() => ({ reachedApp: true, consoleErrors: [], appRootHash: 'h' }));
    const exit = await runP4BrowserMatrix(options, deps);
    expect(exit).toBe(P4_BROWSER_EXIT.ok);
    expect(written.size).toBe(enumerateMatrix().length);
    const sample = [...written.values()][0];
    expect(sample.fixtureKind).toBe('bounded');
    expect(sample.scenario).toBe('pr-escalation-states');
    expect(sample.commit).toBe('abc123');
    expect(sample.timestamp).toBe('2026-08-25T00:00:00.000Z');
    expect(sample.passed).toBe(true);
  });

  it('fails the whole run when any cell logs a console error', async () => {
    const { deps } = browserDeps((n) => ({
      reachedApp: true, consoleErrors: n === 5 ? ['boom'] : [], appRootHash: 'h',
    }));
    const exit = await runP4BrowserMatrix(options, deps);
    expect(exit).toBe(P4_BROWSER_EXIT.cellFailed);
  });

  it('fails the whole run when a cell never reached the app', async () => {
    const { deps } = browserDeps((n) => ({
      reachedApp: n !== 0, consoleErrors: [], appRootHash: 'h',
    }));
    const exit = await runP4BrowserMatrix(options, deps);
    expect(exit).toBe(P4_BROWSER_EXIT.cellFailed);
  });
});

describe('parseP4BrowserCliArgs', () => {
  it('requires an artifact dir and accepts only --matrix all', () => {
    const parsed = parseP4BrowserCliArgs(['--matrix', 'all', '--artifact-dir', '.artifacts/p4-browser/bounded']);
    expect(parsed.artifactDir).toBe('.artifacts/p4-browser/bounded');
    expect(parsed.browserExecutable).toBeNull();
    expect(parsed.maxCells).toBeNull();
    expect(() => parseP4BrowserCliArgs(['--matrix', 'some'])).toThrow(/only --matrix all/);
    expect(() => parseP4BrowserCliArgs(['--matrix', 'all'])).toThrow(/--artifact-dir/);
  });
  it('parses --browser-executable and a positive --max-cells', () => {
    const parsed = parseP4BrowserCliArgs([
      '--matrix', 'all', '--artifact-dir', 'd', '--browser-executable', '/opt/chrome', '--max-cells', '3',
    ]);
    expect(parsed.browserExecutable).toBe('/opt/chrome');
    expect(parsed.maxCells).toBe(3);
    expect(() => parseP4BrowserCliArgs(['--matrix', 'all', '--artifact-dir', 'd', '--max-cells', '0'])).toThrow(/positive integer/);
  });
});

describe('mainP4ActualBrowserRunner — real wiring against an injected browser', () => {
  it('requires --browser-executable', async () => {
    const code = await mainP4ActualBrowserRunner(['--matrix', 'all', '--artifact-dir', 'd']);
    expect(code).toBe(P4_BROWSER_EXIT.usage);
  });

  it('drives a capped matrix, maps the app marker, and passes when the app is reached', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p4-browser-'));
    const written = new Map<string, MatrixArtifact>();
    const code = await mainP4ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '2',
      ],
      {
        launch: fakeBrowser('<div id="root"><div class="app-shell">ok</div></div>'),
        inspect: () => 'ok',
        now: () => new Date('2026-08-25T00:00:00Z'),
        writeArtifact: (path, contents) => {
          const parsed = JSON.parse(contents);
          if (parsed && typeof parsed === 'object' && 'theme' in parsed) written.set(path, parsed as MatrixArtifact);
        },
      },
    );
    expect(code).toBe(P4_BROWSER_EXIT.ok);
    // Only the two capped cells were driven and recorded.
    expect(written.size).toBe(2);
    expect([...written.values()].every((a) => a.reachedApp && a.passed)).toBe(true);
  });

  it('fails the run when a driven cell reports a console error', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p4-browser-'));
    const code = await mainP4ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '1',
      ],
      {
        launch: fakeBrowser('<div id="root"><div class="app-shell">ok</div></div>', ['boom']),
        inspect: () => 'ok',
        writeArtifact: () => undefined,
      },
    );
    expect(code).toBe(P4_BROWSER_EXIT.cellFailed);
  });

  it('fails when the page never reached the app marker (an interstitial)', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p4-browser-'));
    const code = await mainP4ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '1',
      ],
      {
        launch: fakeBrowser('<div id="root"></div>'),
        inspect: () => 'ok',
        writeArtifact: () => undefined,
      },
    );
    expect(code).toBe(P4_BROWSER_EXIT.cellFailed);
  });
});

import { describe, expect, it } from 'vitest';
import {
  P4_BROWSER_EXIT, P4_VIEWPORT_WIDTHS, enumerateMatrix, parseP4BrowserCliArgs, runP4BrowserMatrix,
} from './p4ActualBrowserRunner.ts';
import type { CellCapture, MatrixArtifact, P4BrowserDeps } from './p4ActualBrowserRunner.ts';

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
    expect(() => parseP4BrowserCliArgs(['--matrix', 'some'])).toThrow(/only --matrix all/);
    expect(() => parseP4BrowserCliArgs(['--matrix', 'all'])).toThrow(/--artifact-dir/);
  });
});

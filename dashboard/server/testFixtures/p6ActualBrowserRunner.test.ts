import { describe, expect, it } from 'vitest';
import {
  P6_BROWSER_EXIT, P6_INTERACTION_MODES, P6_MOTION_MODES, P6_SCENARIOS, P6_THEMES, P6_VIEWPORT_WIDTHS,
  P6BrowserUsageError, enumerateMatrix, parseP6BrowserCliArgs, runP6BrowserMatrix,
  type CellCapture, type MatrixArtifact, type MatrixCell,
} from './p6ActualBrowserRunner.ts';

describe('enumerateMatrix', () => {
  it('covers every theme × width × interaction × motion cell', () => {
    const cells = enumerateMatrix('two-daemon');
    const expected = P6_THEMES.length * P6_VIEWPORT_WIDTHS.length * P6_INTERACTION_MODES.length * P6_MOTION_MODES.length;
    expect(cells).toHaveLength(expected);
    // No duplicate cell.
    const keys = new Set(cells.map((c) => `${c.theme}-${c.width}-${c.interaction}-${c.motion}`));
    expect(keys.size).toBe(expected);
    // Keyboard-only and reduced-motion are both represented.
    expect(cells.some((c) => c.interaction === 'keyboard-only')).toBe(true);
    expect(cells.some((c) => c.motion === 'reduced-motion')).toBe(true);
  });

  it('enumerates both scenarios', () => {
    for (const scenario of P6_SCENARIOS) {
      expect(enumerateMatrix(scenario).every((c) => c.scenario === scenario)).toBe(true);
    }
  });
});

describe('runP6BrowserMatrix', () => {
  function harness(capture: (cell: MatrixCell) => CellCapture) {
    const artifacts = new Map<string, MatrixArtifact>();
    const run = (scenario: 'two-daemon' | 'placement-chip') => runP6BrowserMatrix(
      { scenario, artifactDir: '.artifacts/x', commit: 'abc1234', now: () => new Date('2026-08-25T00:00:00.000Z') },
      {
        capture: async (cell) => capture(cell),
        ensureDir: () => {},
        writeArtifact: (path, contents) => { artifacts.set(path, JSON.parse(contents) as MatrixArtifact); },
        log: () => {},
      },
    );
    return { artifacts, run };
  }

  it('writes one artifact per cell recording fixture kind, commit, viewport, timestamp and exits 0 when all pass', async () => {
    const { artifacts, run } = harness(() => ({ ok: true, consoleErrors: [] }));
    const code = await run('two-daemon');
    expect(code).toBe(P6_BROWSER_EXIT.ok);
    expect(artifacts.size).toBe(enumerateMatrix('two-daemon').length);
    const sample = [...artifacts.values()][0]!;
    expect(sample).toMatchObject({ fixtureKind: 'two-daemon', commit: 'abc1234', timestamp: '2026-08-25T00:00:00.000Z' });
    expect(P6_VIEWPORT_WIDTHS).toContain(sample.width);
  });

  it('exits cellFailed when a cell reports a console error, and still writes its artifact', async () => {
    const { artifacts, run } = harness((cell) => (
      cell.width === 375 && cell.theme === 'dark'
        ? { ok: true, consoleErrors: ['boom'] }
        : { ok: true, consoleErrors: [] }
    ));
    const code = await run('two-daemon');
    expect(code).toBe(P6_BROWSER_EXIT.cellFailed);
    const failed = [...artifacts.values()].filter((a) => !a.ok);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((a) => a.consoleErrors.includes('boom'))).toBe(true);
  });
});

describe('parseP6BrowserCliArgs', () => {
  it('requires --artifact-dir and --browser-executable', () => {
    expect(() => parseP6BrowserCliArgs(['--matrix', 'all'])).toThrow(P6BrowserUsageError);
    expect(() => parseP6BrowserCliArgs(['--artifact-dir', 'd', '--matrix', 'all'])).toThrow(/browser-executable/);
  });

  it('requires both origins for the two-daemon scenario', () => {
    expect(() => parseP6BrowserCliArgs([
      '--browser-executable', 'C:/edge.exe', '--artifact-dir', 'd', '--origin-vm', 'https://127.0.0.1:1',
    ])).toThrow(/origin-desktop/);
  });

  it('parses a complete two-daemon line', () => {
    expect(parseP6BrowserCliArgs([
      '--browser-executable', 'C:/edge.exe', '--origin-vm', 'https://127.0.0.1:1', '--origin-desktop', 'https://127.0.0.1:2',
      '--matrix', 'all', '--artifact-dir', 'd',
    ])).toMatchObject({ scenario: 'two-daemon', originVm: 'https://127.0.0.1:1', originDesktop: 'https://127.0.0.1:2' });
  });

  it('requires --origin for the placement-chip scenario', () => {
    expect(() => parseP6BrowserCliArgs([
      '--scenario', 'placement-chip', '--browser-executable', 'C:/edge.exe', '--artifact-dir', 'd',
    ])).toThrow(/placement-chip scenario requires --origin/);
  });

  // Plan §8 line 468's literal placement-chip command passes `--origin` to this runner and never
  // `--scenario` — so an omitted `--scenario` must infer `placement-chip` from `--origin` alone, not
  // fall through to the `two-daemon` default and then fail for a missing `--origin-vm`/`--origin-desktop`.
  it('infers the placement-chip scenario from --origin alone when --scenario is omitted (plan §8 line 468)', () => {
    expect(parseP6BrowserCliArgs([
      '--browser-executable', 'C:/edge.exe', '--origin', 'https://127.0.0.1:4345', '--matrix', 'all', '--artifact-dir', 'd',
    ])).toMatchObject({ scenario: 'placement-chip', origin: 'https://127.0.0.1:4345', originVm: null, originDesktop: null });
  });

  it('still infers the two-daemon default when neither --origin nor --scenario is given', () => {
    expect(() => parseP6BrowserCliArgs([
      '--browser-executable', 'C:/edge.exe', '--artifact-dir', 'd',
    ])).toThrow(/two-daemon scenario requires --origin-vm and --origin-desktop/);
  });
});

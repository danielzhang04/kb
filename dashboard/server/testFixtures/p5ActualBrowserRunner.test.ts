import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  P5_BROWSER_EXIT, P5_FIXTURE_KINDS, P5_LIVE_ACTIVATION, P5_RAIL_DESTINATIONS, P5_SCENARIOS,
  P5_SCENARIO_FIXTURE, P5_VIEWPORT_WIDTHS, enumerateMatrix, isP5FixtureKind, isP5Scenario,
  mainP5ActualBrowserRunner, p5ScenarioProfile, parseP5BrowserCliArgs, runP5BrowserMatrix,
} from './p5ActualBrowserRunner.ts';
import type { CellCapture, MatrixArtifact, P5BrowserDeps } from './p5ActualBrowserRunner.ts';
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

describe('enumerateMatrix — full light/dark × a11y × width matrix at the two §8 widths', () => {
  it('covers every theme, keyboard-only, reduced-motion, and the two widths (desktop + 720)', () => {
    const cells = enumerateMatrix();
    expect(cells).toHaveLength(2 * 2 * 2 * 2);
    expect(new Set(cells.map((c) => c.theme))).toEqual(new Set(['light', 'dark']));
    expect(new Set(cells.map((c) => c.width))).toEqual(new Set(P5_VIEWPORT_WIDTHS));
    expect([...P5_VIEWPORT_WIDTHS].sort((a, b) => b - a)).toEqual([1440, 720]);
    expect(cells.some((c) => c.keyboardOnly && c.reducedMotion && c.width === 720)).toBe(true);
    const keys = cells.map((c) => `${c.theme}-${c.keyboardOnly}-${c.reducedMotion}-${c.width}`);
    expect(new Set(keys).size).toBe(cells.length);
  });
});

describe('p5ScenarioProfile — the seven §8 scenarios and their plan bullets', () => {
  it('exposes exactly the seven §8 scenarios and two fixture kinds', () => {
    expect([...P5_SCENARIOS]).toEqual([
      'deployment-action-matrix', 'asset-pull-digest', 'pty-quiescence-refusal', 't3-missing-ceremony',
      'health-bounded-probe-failure', 'home-health-live-release', 'no-deploy-destination',
    ]);
    expect([...P5_FIXTURE_KINDS]).toEqual(['bounded', 'real']);
    expect(isP5Scenario('deployment-action-matrix')).toBe(true);
    expect(isP5Scenario('inbox-deployment-arms')).toBe(false);
    expect(isP5FixtureKind('real')).toBe(true);
    expect(isP5FixtureKind('nope')).toBe(false);
  });

  it('every scenario carries the four-source envelope in canonical fold order and a plan bullet', () => {
    for (const scenario of P5_SCENARIOS) {
      const profile = p5ScenarioProfile(scenario);
      expect(Object.keys(profile.inbox.sources).sort()).toEqual(['assetPull', 'deployment', 'escalation', 'pr']);
      expect(profile.fixtureKind).toBe(P5_SCENARIO_FIXTURE[scenario]);
      expect(profile.assertsBullet.length).toBeGreaterThan(0);
      expect(typeof profile.inbox.revision).toBe('string');
    }
  });

  it('deployment-action-matrix projects the deployment + deploy-ready + escalation arms', () => {
    const profile = p5ScenarioProfile('deployment-action-matrix');
    expect(profile.fixtureKind).toBe('bounded');
    expect(profile.inbox.items.map((item) => item.kind)).toEqual(['deployment', 'deployment', 'deployment-escalation']);
  });

  it('asset-pull-digest pins a 64-hex manifestDigest, never taken from subject text', () => {
    const profile = p5ScenarioProfile('asset-pull-digest');
    const item = profile.inbox.items[0] as { subject: { manifestDigest: string } };
    expect(item.subject.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the three real-fixture scenarios map to the real port kind', () => {
    for (const scenario of ['pty-quiescence-refusal', 't3-missing-ceremony', 'health-bounded-probe-failure', 'home-health-live-release'] as const) {
      expect(p5ScenarioProfile(scenario).fixtureKind).toBe('real');
    }
  });

  it('home-health-live-release pins one activation the Home chip and Health release row both show', () => {
    const profile = p5ScenarioProfile('home-health-live-release');
    expect(profile.liveRelease).not.toBeNull();
    expect(profile.liveRelease?.sha).toBe(P5_LIVE_ACTIVATION.sha);
    expect(profile.liveRelease?.generatedAt).toBe(P5_LIVE_ACTIVATION.generatedAt);
  });

  it('no-deploy-destination lists exactly the ten ux-rules:3 destinations with no deploy/deploys/learnings', () => {
    const profile = p5ScenarioProfile('no-deploy-destination');
    expect(profile.noDeployDestination).toBe(true);
    expect(profile.railDestinations).toEqual([...P5_RAIL_DESTINATIONS]);
    expect(profile.railDestinations).toHaveLength(10);
    expect(profile.railDestinations).not.toContain('deploy');
    expect(profile.railDestinations).not.toContain('deploys');
    expect(profile.railDestinations).not.toContain('learnings');
  });
});

function browserDeps(capture: (n: number) => CellCapture): { deps: P5BrowserDeps; written: Map<string, MatrixArtifact> } {
  const written = new Map<string, MatrixArtifact>();
  let n = 0;
  const deps: P5BrowserDeps = {
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

describe('runP5BrowserMatrix — artifact envelope + failure semantics', () => {
  const options = {
    fixtureKind: 'bounded', scenario: 'deployment-action-matrix', commit: 'abc123',
    originUrl: 'https://127.0.0.1:4431', artifactDir: '/tmp/does-not-matter',
  };

  it('passes when every cell reaches the app with no console errors and stamps the envelope', async () => {
    const { deps, written } = browserDeps(() => ({ reachedApp: true, consoleErrors: [], appRootHash: 'h' }));
    const exit = await runP5BrowserMatrix(options, deps);
    expect(exit).toBe(P5_BROWSER_EXIT.ok);
    expect(written.size).toBe(enumerateMatrix().length);
    const sample = [...written.values()][0];
    expect(sample.fixtureKind).toBe('bounded');
    expect(sample.scenario).toBe('deployment-action-matrix');
    expect(sample.commit).toBe('abc123');
    expect(sample.timestamp).toBe('2026-08-25T00:00:00.000Z');
    expect(sample.passed).toBe(true);
  });

  it('fails the whole run when any cell logs a console error', async () => {
    const { deps } = browserDeps((n) => ({ reachedApp: true, consoleErrors: n === 5 ? ['boom'] : [], appRootHash: 'h' }));
    expect(await runP5BrowserMatrix(options, deps)).toBe(P5_BROWSER_EXIT.cellFailed);
  });

  it('fails the whole run when a cell never reached the app', async () => {
    const { deps } = browserDeps((n) => ({ reachedApp: n !== 0, consoleErrors: [], appRootHash: 'h' }));
    expect(await runP5BrowserMatrix(options, deps)).toBe(P5_BROWSER_EXIT.cellFailed);
  });
});

describe('parseP5BrowserCliArgs', () => {
  it('requires an artifact dir, accepts only --matrix all, and validates the scenario', () => {
    const parsed = parseP5BrowserCliArgs(['--matrix', 'all', '--artifact-dir', '.artifacts/p5-browser/bounded']);
    expect(parsed.artifactDir).toBe('.artifacts/p5-browser/bounded');
    expect(parsed.browserExecutable).toBeNull();
    expect(parsed.maxCells).toBeNull();
    // Unspecified fixture kind defaults to the scenario's §8-mapped kind.
    expect(parsed.fixtureKind).toBe('bounded');
    expect(() => parseP5BrowserCliArgs(['--matrix', 'some'])).toThrow(/only --matrix all/);
    expect(() => parseP5BrowserCliArgs(['--matrix', 'all'])).toThrow(/--artifact-dir/);
    expect(() => parseP5BrowserCliArgs(['--matrix', 'all', '--artifact-dir', 'd', '--scenario', 'nope']))
      .toThrow(/--scenario must be one of/);
  });
  it('parses --scenario, --fixture, --browser-executable and a positive --max-cells', () => {
    const parsed = parseP5BrowserCliArgs([
      '--matrix', 'all', '--artifact-dir', 'd', '--scenario', 'home-health-live-release',
      '--fixture', 'real', '--browser-executable', '/opt/chrome', '--max-cells', '3',
    ]);
    expect(parsed.scenario).toBe('home-health-live-release');
    expect(parsed.fixtureKind).toBe('real');
    expect(parsed.browserExecutable).toBe('/opt/chrome');
    expect(parsed.maxCells).toBe(3);
    expect(() => parseP5BrowserCliArgs(['--matrix', 'all', '--artifact-dir', 'd', '--fixture', 'nope'])).toThrow(/bounded or real/);
    expect(() => parseP5BrowserCliArgs(['--matrix', 'all', '--artifact-dir', 'd', '--max-cells', '0'])).toThrow(/positive integer/);
  });
});

describe('mainP5ActualBrowserRunner — real wiring against an injected browser', () => {
  it('requires --browser-executable', async () => {
    expect(await mainP5ActualBrowserRunner(['--matrix', 'all', '--artifact-dir', 'd'])).toBe(P5_BROWSER_EXIT.usage);
  });

  it('drives a capped matrix, maps the app marker, and passes when the app is reached', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p5-browser-'));
    const written = new Map<string, MatrixArtifact>();
    const code = await mainP5ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--scenario', 'deployment-action-matrix',
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
    expect(code).toBe(P5_BROWSER_EXIT.ok);
    expect(written.size).toBe(2);
    expect([...written.values()].every((a) => a.reachedApp && a.passed)).toBe(true);
  });

  it('fails the run when a driven cell reports a console error', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p5-browser-'));
    const code = await mainP5ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '1',
      ],
      { launch: fakeBrowser('<div id="root"><div class="app-shell">ok</div></div>', ['boom']), inspect: () => 'ok', writeArtifact: () => undefined },
    );
    expect(code).toBe(P5_BROWSER_EXIT.cellFailed);
  });

  it('fails when the page never reached the app marker (an interstitial)', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p5-browser-'));
    const code = await mainP5ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '1',
      ],
      { launch: fakeBrowser('<div id="root"></div>'), inspect: () => 'ok', writeArtifact: () => undefined },
    );
    expect(code).toBe(P5_BROWSER_EXIT.cellFailed);
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  P5_BROWSER_EXIT, P5_SCENARIOS, P5_VIEWPORT_WIDTHS, enumerateMatrix, mainP5ActualBrowserRunner,
  p5InboxEnvelope, parseP5BrowserCliArgs, runP5BrowserMatrix,
  P5_ASSET_PULL_ITEM, P5_DEPLOYMENT_ESCALATION_ITEM, P5_DEPLOYMENT_ITEM, P5_DEPLOY_READY_ITEM,
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

describe('enumerateMatrix — full light/dark × a11y × width matrix', () => {
  it('covers every theme, keyboard-only, reduced-motion, and width combination', () => {
    const cells = enumerateMatrix();
    expect(cells).toHaveLength(2 * 2 * 2 * 3);
    expect(new Set(cells.map((c) => c.theme))).toEqual(new Set(['light', 'dark']));
    expect(new Set(cells.map((c) => c.width))).toEqual(new Set(P5_VIEWPORT_WIDTHS));
    expect(cells.some((c) => c.keyboardOnly && c.reducedMotion && c.width === 375)).toBe(true);
    const keys = cells.map((c) => `${c.theme}-${c.keyboardOnly}-${c.reducedMotion}-${c.width}`);
    expect(new Set(keys).size).toBe(cells.length);
  });
});

describe('p5InboxEnvelope — the four-source envelope and the three new item kinds', () => {
  it('every scenario carries all four source states in the canonical fold set', () => {
    for (const scenario of P5_SCENARIOS) {
      const envelope = p5InboxEnvelope(scenario);
      expect(Object.keys(envelope.sources).sort()).toEqual(['assetPull', 'deployment', 'escalation', 'pr']);
      expect(typeof envelope.revision).toBe('string');
    }
  });

  it('the deployment arm projects deployment + deploy-ready + escalation items with the wire shapes', () => {
    const envelope = p5InboxEnvelope('inbox-deployment-arms');
    const kinds = envelope.items.map((item) => item.kind);
    expect(kinds).toEqual(['deployment', 'deployment', 'deployment-escalation']);
    // deploy-ready carries no blocking ids by construction [P5-C59].
    expect(P5_DEPLOY_READY_ITEM.blockingPtyIds).toEqual([]);
    expect(P5_DEPLOY_READY_ITEM.state).toBe('deploy-ready');
    expect(Object.keys(P5_DEPLOYMENT_ITEM).sort())
      .toEqual(['blockingPtyIds', 'createdAt', 'id', 'kind', 'revision', 'state', 'subject', 'title']);
    expect(Object.keys(P5_DEPLOYMENT_ITEM.subject)).toEqual(['deploymentRef']);
    expect(P5_DEPLOYMENT_ESCALATION_ITEM.kind).toBe('deployment-escalation');
    expect(typeof P5_DEPLOYMENT_ESCALATION_ITEM.swapDeadlineAt).toBe('string');
  });

  it('the asset-pull arm projects an asset-pull item pinning intentRef/runRef/manifestDigest', () => {
    const envelope = p5InboxEnvelope('inbox-asset-pull-arms');
    expect(envelope.items.map((item) => item.kind)).toEqual(['asset-pull']);
    expect(Object.keys(P5_ASSET_PULL_ITEM.subject).sort()).toEqual(['intentRef', 'manifestDigest', 'runRef']);
    expect(P5_ASSET_PULL_ITEM.subject.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(P5_ASSET_PULL_ITEM).not.toHaveProperty('blockingPtyIds');
  });

  it('the four-source-health scenario carries a failed source, a stale source, and verified sources', () => {
    const { sources } = p5InboxEnvelope('inbox-four-source-health');
    expect(sources.pr.status).toBe('failed');
    expect(sources.assetPull).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(sources.deployment).toMatchObject({ status: 'verified', stale: true });
    expect(sources.escalation.status).toBe('verified');
    // The error codes stay inside the P4 closed union.
    if (sources.pr.status === 'failed') {
      expect(['unavailable', 'timeout', 'overflow', 'invalid']).toContain(sources.pr.errorCode);
    }
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
    fixtureKind: 'bounded', scenario: 'inbox-deployment-arms', commit: 'abc123',
    originUrl: 'https://127.0.0.1:4521', artifactDir: '/tmp/does-not-matter',
  };

  it('passes when every cell reaches the app with no console errors and stamps the envelope', async () => {
    const { deps, written } = browserDeps(() => ({ reachedApp: true, consoleErrors: [], appRootHash: 'h' }));
    const exit = await runP5BrowserMatrix(options, deps);
    expect(exit).toBe(P5_BROWSER_EXIT.ok);
    expect(written.size).toBe(enumerateMatrix().length);
    const sample = [...written.values()][0];
    expect(sample.fixtureKind).toBe('bounded');
    expect(sample.scenario).toBe('inbox-deployment-arms');
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
    expect(() => parseP5BrowserCliArgs(['--matrix', 'some'])).toThrow(/only --matrix all/);
    expect(() => parseP5BrowserCliArgs(['--matrix', 'all'])).toThrow(/--artifact-dir/);
    expect(() => parseP5BrowserCliArgs(['--matrix', 'all', '--artifact-dir', 'd', '--scenario', 'nope']))
      .toThrow(/--scenario must be one of/);
  });
  it('parses --scenario, --browser-executable and a positive --max-cells', () => {
    const parsed = parseP5BrowserCliArgs([
      '--matrix', 'all', '--artifact-dir', 'd', '--scenario', 'inbox-asset-pull-arms',
      '--browser-executable', '/opt/chrome', '--max-cells', '3',
    ]);
    expect(parsed.scenario).toBe('inbox-asset-pull-arms');
    expect(parsed.browserExecutable).toBe('/opt/chrome');
    expect(parsed.maxCells).toBe(3);
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
        '--scenario', 'inbox-deployment-arms',
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

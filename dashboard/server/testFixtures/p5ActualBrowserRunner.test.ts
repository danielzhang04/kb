import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  P5_BROWSER_EXIT, P5_FIXTURE_KINDS, P5_LIVE_ACTIVATION, P5_RAIL_DESTINATIONS, P5_SCENARIOS,
  P5_SCENARIO_FIXTURE, P5_VIEWPORT_WIDTHS, assertAssetPullDigest, assertDeploymentActionMatrix,
  assertHealthBoundedProbeFailure, assertHomeFallbackActive, assertHomeHealthLiveRelease,
  assertPtyQuiescenceRefusal, assertRailExactlyNineNoDeploy, assertT3MissingCeremony, enumerateMatrix,
  evaluateP5ScenarioBullet, isP5FixtureKind, isP5Scenario, mainP5ActualBrowserRunner, p5ScenarioProfile,
  parseP5BrowserCliArgs, runP5BrowserMatrix,
} from './p5ActualBrowserRunner.ts';
import type { CellCapture, MatrixArtifact, P5BrowserDeps, ScenarioDoms } from './p5ActualBrowserRunner.ts';
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

  it('no-deploy-destination lists exactly the nine destinations with no tasks/deploy/deploys/learnings', () => {
    const profile = p5ScenarioProfile('no-deploy-destination');
    expect(profile.noDeployDestination).toBe(true);
    expect(profile.railDestinations).toEqual([...P5_RAIL_DESTINATIONS]);
    expect(profile.railDestinations).toHaveLength(9);
    expect(profile.railDestinations).not.toContain('tasks');
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

const OK_CAPTURE: CellCapture = { reachedApp: true, consoleErrors: [], appRootHash: 'h', bulletOk: true, bulletDetail: 'ok' };

describe('runP5BrowserMatrix — artifact envelope + failure semantics', () => {
  const options = {
    fixtureKind: 'bounded', scenario: 'deployment-action-matrix', commit: 'abc123',
    originUrl: 'https://127.0.0.1:4431', artifactDir: '/tmp/does-not-matter',
  };

  it('passes when every cell reaches the app with no console errors, the bullet holds, and stamps the envelope', async () => {
    const { deps, written } = browserDeps(() => OK_CAPTURE);
    const exit = await runP5BrowserMatrix(options, deps);
    expect(exit).toBe(P5_BROWSER_EXIT.ok);
    expect(written.size).toBe(enumerateMatrix().length);
    const sample = [...written.values()][0];
    expect(sample.fixtureKind).toBe('bounded');
    expect(sample.scenario).toBe('deployment-action-matrix');
    expect(sample.commit).toBe('abc123');
    expect(sample.timestamp).toBe('2026-08-25T00:00:00.000Z');
    expect(sample.bulletOk).toBe(true);
    expect(sample.passed).toBe(true);
  });

  it('fails the whole run when any cell logs a console error', async () => {
    const { deps } = browserDeps((n) => ({ ...OK_CAPTURE, consoleErrors: n === 5 ? ['boom'] : [] }));
    expect(await runP5BrowserMatrix(options, deps)).toBe(P5_BROWSER_EXIT.cellFailed);
  });

  it('fails the whole run when a cell never reached the app', async () => {
    const { deps } = browserDeps((n) => ({ ...OK_CAPTURE, reachedApp: n !== 0 }));
    expect(await runP5BrowserMatrix(options, deps)).toBe(P5_BROWSER_EXIT.cellFailed);
  });

  // W6.5b: `bulletOk` is a REQUIRED third condition — a cell that reaches the app cleanly with zero
  // console errors but never proves its plan-§8 bullet still fails the whole run (and the artifact
  // records WHY via bulletDetail). Before W6.5b this field did not exist and could not fail anything.
  it('fails the whole run when a cell reaches the app cleanly but its DOM bullet is unproven', async () => {
    const { deps, written } = browserDeps((n) => ({ ...OK_CAPTURE, bulletOk: n !== 3, bulletDetail: n === 3 ? 'the rail rendered a Deploy entry' : 'ok' }));
    expect(await runP5BrowserMatrix(options, deps)).toBe(P5_BROWSER_EXIT.cellFailed);
    const failing = [...written.values()].find((artifact) => !artifact.passed);
    expect(failing?.bulletOk).toBe(false);
    expect(failing?.bulletDetail).toBe('the rail rendered a Deploy entry');
    expect(failing?.reachedApp).toBe(true);
    expect(failing?.consoleErrors).toEqual([]);
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

/** A DOM shaped like the real Inbox render for `deployment-action-matrix`: parked -> Abort, deploy-ready
 *  -> Deploy, escalation -> Inspect only, no Decline. Satisfies `assertDeploymentActionMatrix`. */
const DEPLOYMENT_MATRIX_APP_SHELL = `<div id="root"><div class="app-shell">
  <li data-testid="inbox-deployment-parked"><button data-testid="inbox-deploy-control" data-verb="abort" disabled aria-disabled="true">Abort</button></li>
  <li data-testid="inbox-deployment-deploy-ready"><button data-testid="inbox-deploy-control" data-verb="deploy" disabled aria-disabled="true">Deploy</button></li>
  <li data-testid="inbox-deployment-escalation"></li>
</div></div>`;

describe('mainP5ActualBrowserRunner — real wiring against an injected browser', () => {
  it('requires --browser-executable', async () => {
    expect(await mainP5ActualBrowserRunner(['--matrix', 'all', '--artifact-dir', 'd'])).toBe(P5_BROWSER_EXIT.usage);
  });

  it('drives a capped matrix, maps the app marker, and passes when the app is reached AND the DOM bullet holds', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p5-browser-'));
    const written = new Map<string, MatrixArtifact>();
    const code = await mainP5ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--scenario', 'deployment-action-matrix',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '2',
      ],
      {
        launch: fakeBrowser(DEPLOYMENT_MATRIX_APP_SHELL),
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
    expect([...written.values()].every((a) => a.reachedApp && a.bulletOk && a.passed)).toBe(true);
  });

  // W6.5b non-vacuousness proof: the SAME wiring, reaching the SAME app-shell marker with zero console
  // errors, still FAILS when the DOM never renders the deployment rows the bullet requires — proving
  // `bulletOk` is not a rubber stamp derived from `reachedApp`.
  it('fails the run when the app is reached cleanly but the DOM never proves the deployment-action-matrix bullet', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p5-browser-'));
    const written = new Map<string, MatrixArtifact>();
    const code = await mainP5ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--scenario', 'deployment-action-matrix',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '1',
      ],
      {
        launch: fakeBrowser('<div id="root"><div class="app-shell">ok</div></div>'),
        inspect: () => 'ok',
        writeArtifact: (path, contents) => {
          const parsed = JSON.parse(contents);
          if (parsed && typeof parsed === 'object' && 'theme' in parsed) written.set(path, parsed as MatrixArtifact);
        },
      },
    );
    expect(code).toBe(P5_BROWSER_EXIT.cellFailed);
    const cell = [...written.values()][0];
    expect(cell.reachedApp).toBe(true);
    expect(cell.consoleErrors).toEqual([]);
    expect(cell.bulletOk).toBe(false);
    expect(cell.passed).toBe(false);
  });

  it('fails the run when a driven cell reports a console error', async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kb-p5-browser-'));
    const code = await mainP5ActualBrowserRunner(
      [
        '--matrix', 'all', '--artifact-dir', artifactDir, '--origin', 'http://127.0.0.1:65535',
        '--browser-executable', resolve('/fake/chrome'), '--max-cells', '1',
      ],
      { launch: fakeBrowser(DEPLOYMENT_MATRIX_APP_SHELL, ['boom']), inspect: () => 'ok', writeArtifact: () => undefined },
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

describe('W6.5b — the seven scenarios\' DOM bullet assertions are non-vacuous', () => {
  it('assertRailExactlyNineNoDeploy: passes on the real sidebar markup, fails when Deploy is injected or an entry is missing', () => {
    const goodSidebar = `<nav class="mc-sidebar" aria-label="Primary navigation">${
      P5_RAIL_DESTINATIONS.map((id) => `<button title="${id[0].toUpperCase()}${id.slice(1)}"><span class="mc-nav-item__label">${id[0].toUpperCase()}${id.slice(1)}</span></button>`).join('')
    }</nav>`;
    expect(assertRailExactlyNineNoDeploy(goodSidebar).ok).toBe(true);

    const withDeploy = `<nav class="mc-sidebar" aria-label="Primary navigation">${
      [...P5_RAIL_DESTINATIONS, 'deploy'].map((id) => `<span class="mc-nav-item__label">${id[0].toUpperCase()}${id.slice(1)}</span>`).join('')
    }</nav>`;
    expect(assertRailExactlyNineNoDeploy(withDeploy).ok).toBe(false);

    const missingOne = `<nav class="mc-sidebar" aria-label="Primary navigation">${
      P5_RAIL_DESTINATIONS.slice(0, 8).map((id) => `<span class="mc-nav-item__label">${id[0].toUpperCase()}${id.slice(1)}</span>`).join('')
    }</nav>`;
    expect(assertRailExactlyNineNoDeploy(missingOne).ok).toBe(false);
    expect(assertRailExactlyNineNoDeploy('<div>no sidebar here</div>').ok).toBe(false);
  });

  it('assertHomeFallbackActive: passes when Home is aria-current=page, fails when another destination is active', () => {
    const homeActive = '<nav class="mc-sidebar"><button title="Home" aria-current="page">Home</button></nav>';
    expect(assertHomeFallbackActive(homeActive).ok).toBe(true);
    const inboxActive = '<nav class="mc-sidebar"><button title="Home">Home</button><button title="Inbox" aria-current="page">Inbox</button></nav>';
    expect(assertHomeFallbackActive(inboxActive).ok).toBe(false);
  });

  it('assertDeploymentActionMatrix: passes on the real render shape, fails on a generic app-shell with no rows and on an injected Decline', () => {
    expect(assertDeploymentActionMatrix(DEPLOYMENT_MATRIX_APP_SHELL).ok).toBe(true);
    expect(assertDeploymentActionMatrix('<div id="root"><div class="app-shell">ok</div></div>').ok).toBe(false);
    expect(assertDeploymentActionMatrix(`${DEPLOYMENT_MATRIX_APP_SHELL}<button>Decline</button>`).ok).toBe(false);
    // Same rows, but the parked row's action is wrong (Deploy instead of Abort) — must still fail.
    const wrongVerb = DEPLOYMENT_MATRIX_APP_SHELL.replace('data-verb="abort"', 'data-verb="deploy"');
    expect(assertDeploymentActionMatrix(wrongVerb).ok).toBe(false);
  });

  it('assertAssetPullDigest: passes when the failed row renders Retry with a real 64-hex digest never echoed as copy, fails on a wrong label or a leaked digest', () => {
    const profile = p5ScenarioProfile('asset-pull-digest');
    const digest = (profile.inbox.items[0] as { subject: { manifestDigest: string } }).subject.manifestDigest;
    const good = `<li data-testid="inbox-asset-pull-failed"><button data-testid="inbox-asset-control">Retry</button></li>`;
    expect(assertAssetPullDigest(good, profile).ok).toBe(true);
    const wrongLabel = `<li data-testid="inbox-asset-pull-failed"><button data-testid="inbox-asset-control">Pull home</button></li>`;
    expect(assertAssetPullDigest(wrongLabel, profile).ok).toBe(false);
    const leaked = `<li data-testid="inbox-asset-pull-failed"><button data-testid="inbox-asset-control">Retry</button><p>${digest}</p></li>`;
    expect(assertAssetPullDigest(leaked, profile).ok).toBe(false);
  });

  it('assertPtyQuiescenceRefusal: passes when only close-ptys-and-continue is offered, fails when Abort is also offered or the blocked count is missing', () => {
    const good = '<li data-testid="inbox-deployment-parked"><p>1 live PTY</p><button data-testid="inbox-deploy-control" data-verb="close-ptys-and-continue">Close PTYs and continue</button></li>';
    expect(assertPtyQuiescenceRefusal(good).ok).toBe(true);
    const alsoAbort = good.replace('</li>', '<button data-verb="abort">Abort</button></li>');
    expect(assertPtyQuiescenceRefusal(alsoAbort).ok).toBe(false);
    const noCount = '<li data-testid="inbox-deployment-parked"><button data-testid="inbox-deploy-control" data-verb="close-ptys-and-continue">Close PTYs and continue</button></li>';
    expect(assertPtyQuiescenceRefusal(noCount).ok).toBe(false);
  });

  it('assertT3MissingCeremony: passes when the Deploy control is rendered disabled, fails when it is enabled', () => {
    const disabled = '<li data-testid="inbox-deployment-deploy-ready"><button data-testid="inbox-deploy-control" data-verb="deploy" disabled aria-disabled="true">Deploy</button></li>';
    expect(assertT3MissingCeremony(disabled).ok).toBe(true);
    const enabled = '<li data-testid="inbox-deployment-deploy-ready"><button data-testid="inbox-deploy-control" data-verb="deploy">Deploy</button></li>';
    expect(assertT3MissingCeremony(enabled).ok).toBe(false);
  });

  it('assertHealthBoundedProbeFailure: passes on exactly one degraded row, fails on zero or two', () => {
    const one = '<div data-testid="health-row-error:mcp">Unavailable</div><div data-testid="health-row-cpu">ok</div>';
    expect(assertHealthBoundedProbeFailure(one).ok).toBe(true);
    expect(assertHealthBoundedProbeFailure('<div data-testid="health-row-cpu">ok</div>').ok).toBe(false);
    const two = '<div data-testid="health-row-error:mcp">Unavailable</div><div data-testid="health-row-error:fleet">Unavailable</div>';
    expect(assertHealthBoundedProbeFailure(two).ok).toBe(false);
  });

  it('assertHomeHealthLiveRelease: passes when Home/Health SHAs agree and a second Home fetch renders the SAME ago text, fails on a SHA mismatch or a drifting ago', () => {
    const homeDom = '<section aria-label="Version" class="d13-home__section"><h2>Version</h2><span>VM · aaaaaaaa · just now</span></section>';
    const healthDom = '<div data-testid="health-row-release"><span class="v-health__value-field-label">sha</span><span class="v-health__value-field-data">aaaaaaaa</span></div></li>';
    const doms: ScenarioDoms = { home: homeDom, health: healthDom, homeAgain: homeDom };
    expect(assertHomeHealthLiveRelease(doms).ok).toBe(true);

    const mismatchedHealth = healthDom.replace('aaaaaaaa', 'bbbbbbbb');
    expect(assertHomeHealthLiveRelease({ ...doms, health: mismatchedHealth }).ok).toBe(false);

    const driftedSecondHome = homeDom.replace('just now', '3h ago');
    expect(assertHomeHealthLiveRelease({ ...doms, homeAgain: driftedSecondHome }).ok).toBe(false);
  });

  it('evaluateP5ScenarioBullet: no-deploy-destination requires the rail check AND both route fallbacks', () => {
    const profile = p5ScenarioProfile('no-deploy-destination');
    const sidebar = `<nav class="mc-sidebar" aria-label="Primary navigation">${
      P5_RAIL_DESTINATIONS.map((id) => `<button title="${id[0].toUpperCase()}${id.slice(1)}" aria-current="${id === 'home' ? 'page' : ''}"><span class="mc-nav-item__label">${id[0].toUpperCase()}${id.slice(1)}</span></button>`).join('')
    }</nav>`;
    const good: ScenarioDoms = { main: sidebar, deployRoute: sidebar, deploysRoute: sidebar };
    expect(evaluateP5ScenarioBullet('no-deploy-destination', profile, good).ok).toBe(true);
    // /deploy falls back to something OTHER than Home — must fail even though the rail itself is fine.
    const deployNotHome = sidebar
      .replace('title="Home" aria-current="page"', 'title="Home" aria-current=""')
      .replace('title="Inbox" aria-current=""', 'title="Inbox" aria-current="page"');
    expect(evaluateP5ScenarioBullet('no-deploy-destination', profile, { ...good, deployRoute: deployNotHome }).ok).toBe(false);
  });
});

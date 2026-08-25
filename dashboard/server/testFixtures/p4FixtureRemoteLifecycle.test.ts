import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  P4_ATTACK_IDS, assertLocalRemote, assertSourceRootUnchanged, classifyDurableTarget, cleanup,
  createFixture, decodesAsInboxItem, isEqualOrBeneath, runAttack, runRecordLifecycle, runScheduleBatch,
  selectBatch, snapshotSourceRoot,
} from './p4FixtureRemoteLifecycle.ts';
import type { Fixture } from './p4FixtureRemoteLifecycle.ts';
import { assertP4GateResults } from './assertP4GateResults.ts';

const GIT_ID = {
  GIT_AUTHOR_NAME: 'src', GIT_AUTHOR_EMAIL: 'src@fixtures.local',
  GIT_COMMITTER_NAME: 'src', GIT_COMMITTER_EMAIL: 'src@fixtures.local',
};

/** A minimal, disposable source git repo — the read-only clone source for a fast unit test. */
function minimalSourceRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'p4-src-'));
  const run = (args: string[]) => execFileSync('git', args, { cwd: root, env: { ...process.env, ...GIT_ID } });
  run(['init', '-q']);
  run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(root, 'README.md'), '# source\n');
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'source seed']);
  return root;
}

const trees: string[] = [];
const fixtures: Fixture[] = [];
function newFixture(): Fixture {
  const source = minimalSourceRepo();
  trees.push(source);
  const artifactDir = mkdtempSync(join(tmpdir(), 'p4-art-'));
  trees.push(artifactDir);
  const fixture = createFixture({ sourceRoot: source, cloneMode: 'no-hardlinks-no-local', artifactDir });
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    if (fixture && existsSync(fixture.identity.tempRoot)) {
      try { cleanup(fixture); } catch { /* already gone */ }
    }
  }
  while (trees.length) {
    const tree = trees.pop();
    if (tree) rmSync(tree, { recursive: true, force: true });
  }
});

describe('createFixture — isolation from the live worktree', () => {
  it('refuses http/ssh/scp/file remotes and accepts a local absolute path', () => {
    for (const remote of ['https://x/y.git', 'ssh://g@h/x', 'git@github.com:a/b.git', 'file:///tmp/x']) {
      expect(() => assertLocalRemote(remote)).toThrow(/refused non-local remote/);
    }
    expect(() => assertLocalRemote('/abs/local/path')).not.toThrow();
  });

  it('refuses any clone mode other than no-hardlinks-no-local', () => {
    const source = minimalSourceRepo();
    trees.push(source);
    expect(() => createFixture({ sourceRoot: source, cloneMode: '--shared', artifactDir: source }))
      .toThrow(/only no-hardlinks-no-local/);
    expect(() => createFixture({ sourceRoot: source, cloneMode: '--reference', artifactDir: source }))
      .toThrow(/only no-hardlinks-no-local/);
  });

  it('clones with no alternates, git-common-dir outside the live tree, and all created paths isolated', () => {
    const fixture = newFixture();
    const { identity } = fixture;
    // No alternates file — objects cannot leak into the live store.
    expect(existsSync(join(identity.fixtureRepo, '.git', 'objects', 'info', 'alternates'))).toBe(false);
    // git-common-dir resolves outside the live worktree.
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: identity.fixtureRepo, encoding: 'utf8' }).trim();
    expect(isEqualOrBeneath(join(identity.fixtureRepo, commonDir), identity.sourceRoot)).toBe(false);
    // Every created path is outside the live worktree.
    for (const path of [identity.tempRoot, identity.bareRemote, identity.workerWorktree, identity.controlStore, identity.opsOutbox]) {
      expect(isEqualOrBeneath(path, identity.sourceRoot)).toBe(false);
    }
    // The fixture head is a 40-hex commit tagged as the attested protected-main analogue.
    expect(identity.fixtureHead).toMatch(/^[0-9a-f]{40}$/);
    expect(identity.fixtureTag).toBe('p4-attested-main');
  });

  it('leaves the source-root byte-identical after the full lifecycle', () => {
    const fixture = newFixture();
    const before = snapshotSourceRoot(fixture.identity.sourceRoot);
    runRecordLifecycle(fixture);
    runScheduleBatch(fixture);
    const after = snapshotSourceRoot(fixture.identity.sourceRoot);
    expect(() => assertSourceRootUnchanged(before, after)).not.toThrow();
    expect(after).toEqual(before);
  });
});

describe('record lifecycle — four ordered steps', () => {
  it('publishes proposed, stages exactly target+record@implemented, merges, and retires from ops', () => {
    const fixture = newFixture();
    const result = runRecordLifecycle(fixture);

    // (1) coordination publish receipt + readable proposed.
    expect(result.proposalReceipt.mode).toBe('coordination');
    expect(result.proposalReceipt.branch).toBe('ops');
    expect(result.proposedReadable).toBe(true);

    // (2) the ONE PR stages exactly the target plus the record rewritten to implemented — nothing else.
    expect(result.stagedSet).toEqual([
      'agents/fixture-target.md',
      'docs/proposals/learnings/2026-08-25-lessons-miner-run_01HXYZ-01.md',
    ]);
    expect(result.prBranchRecordStatus).toBe('implemented');
    expect(result.batchId).toMatch(/^learn-[0-9a-f]{24}$/);

    // (3) merge advances fixture main; implemented record present there.
    expect(result.implementedOnMain).toBe(true);
    expect(result.mergeCommit).toMatch(/^[0-9a-f]{40}$/);

    // (4) retire removes the proposed copy from ops; one location at rest; replay is inert.
    expect(result.retireReceipt.branch).toBe('ops');
    expect(result.retiredFromOps).toBe(true);
    expect(result.presentOnMainOnce).toBe(true);
    expect(result.replayOpenedNothing).toBe(true);
    expect(fixture.prRegistry.openCount()).toBe(0);
  });
});

describe('schedule mirror batch', () => {
  it('advances only the first watermark, stamps mirroredAt on covered rows, and a second cycle advances the fourth', () => {
    const fixture = newFixture();
    const result = runScheduleBatch(fixture);
    expect(result.firstBatchAdvanced).toEqual(['sched-a', 'sched-b', 'sched-c']);
    expect(result.fourthPendingBeforeSecond).toBe(true);
    const stamped = result.mirroredAtRows.filter((row) => row.mirroredAt !== null).map((row) => row.id).sort();
    expect(stamped).toEqual(['sched-a', 'sched-b', 'sched-c']);
    expect(result.mirroredAtRows.find((row) => row.id === 'sched-d')?.mirroredAt).toBeNull();
    expect(result.replayOpenedSecondPr).toBe(false);
    expect(result.secondBatchAdvanced).toEqual(['sched-d']);
  });
});

describe('pure wall helpers', () => {
  it('classifies durable targets and rejects traversal/symlink/non-agents paths', () => {
    expect(classifyDurableTarget('agents/fixture-target.md')).toBe('durable');
    expect(classifyDurableTarget('routines/roles/x.md')).toBe('durable');
    for (const bad of ['../x.md', 'agents/../../etc/passwd', '/etc/passwd', 'C:/x.md', 'docs/x.md']) {
      expect(classifyDurableTarget(bad)).toBe('rejected');
    }
  });
  it('rejects a batch with duplicate targets and decodes only PR/escalation subjects', () => {
    expect(() => selectBatch([{ id: 'a', target: 't' }, { id: 'b', target: 't' }])).toThrow(/duplicate target/);
    expect(selectBatch([{ id: 'a', target: 't1' }, { id: 'b', target: 't2' }])).toEqual(['a', 'b']);
    expect(decodesAsInboxItem({ kind: 'run', runId: 'r' })).toBe(false);
    expect(decodesAsInboxItem({ kind: 'pr', number: 1 })).toBe(true);
  });
});

describe('the eleven adversarial attacks', () => {
  for (const id of P4_ATTACK_IDS) {
    it(`refuses: ${id}`, () => {
      const fixture = newFixture();
      const result = runAttack(fixture, id);
      expect(result.id).toBe(id);
      expect(result.passed).toBe(true);
      expect(result.assertion.trim().length).toBeGreaterThan(0);
      expect(existsSync(result.artifactPath)).toBe(true);
      expect(result.fixtureIdentity.fixtureHead).toMatch(/^[0-9a-f]{40}$/);
      expect(result.fixtureIdentity.bareRemote.length).toBeGreaterThan(0);
    });
  }

  it('all eleven produce passing artifacts the gate asserter accepts', { timeout: 120000 }, () => {
    const attackRoot = mkdtempSync(join(tmpdir(), 'p4-attacks-'));
    trees.push(attackRoot);
    for (const id of P4_ATTACK_IDS) {
      const fixture = newFixture();
      // Redirect this attack's artifact into the shared attack root.
      const redirected: Fixture = { ...fixture, identity: { ...fixture.identity, artifactDir: attackRoot } };
      const result = runAttack(redirected, id);
      expect(result.passed).toBe(true);
    }
    const lines: string[] = [];
    const exit = assertP4GateResults(
      { attackRoot, manifestPath: 'server/testFixtures/p4AttackManifest.json', requireExact: 11 },
      { log: (line) => lines.push(line) },
    );
    expect(lines.join('\n')).toContain('P4 gate clean');
    expect(exit).toBe(0);
    expect(readdirSync(attackRoot).filter((f) => f.endsWith('.json'))).toHaveLength(11);
  });

  it('the gate asserter refuses a tampered (passed:false) artifact', { timeout: 120000 }, () => {
    const attackRoot = mkdtempSync(join(tmpdir(), 'p4-attacks-bad-'));
    trees.push(attackRoot);
    for (const id of P4_ATTACK_IDS) {
      const fixture = newFixture();
      const redirected: Fixture = { ...fixture, identity: { ...fixture.identity, artifactDir: attackRoot } };
      runAttack(redirected, id);
    }
    // Tamper one artifact to passed:false.
    const victim = join(attackRoot, `${P4_ATTACK_IDS[0]}.json`);
    const parsed = JSON.parse(readFileSync(victim, 'utf8'));
    parsed.passed = false;
    writeFileSync(victim, JSON.stringify(parsed));
    const lines: string[] = [];
    const exit = assertP4GateResults(
      { attackRoot, manifestPath: 'server/testFixtures/p4AttackManifest.json', requireExact: 11 },
      { log: (line) => lines.push(line) },
    );
    expect(exit).toBe(1);
    expect(lines.join('\n')).toContain('passed is not true');
  });
});

describe('assertP4GateResults — section 7 results mode', () => {
  const manifest = JSON.parse(readFileSync('server/testFixtures/p4AttackManifest.json', 'utf8')) as {
    gateFiles: string[]; attacks: { id: string; suite: string; title: string }[];
  };
  const dashboardRoot = process.cwd();

  function cleanResults(): unknown {
    const testResults = manifest.gateFiles.map((file) => {
      const assertionResults = [{ title: 'runs', fullName: `${file} > runs`, status: 'passed' }];
      // The remote-lifecycle suite additionally owns the eleven attack titles.
      if (file === 'server/testFixtures/p4FixtureRemoteLifecycle.test.ts') {
        for (const attack of manifest.attacks) {
          assertionResults.push({ title: attack.title, fullName: `x > ${attack.title}`, status: 'passed' });
        }
      }
      return { name: join(dashboardRoot, file), status: 'passed', assertionResults };
    });
    return { numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: testResults.length, testResults };
  }

  function runAssert(results: unknown, requireZeroSkips = true): { exit: number; lines: string[] } {
    const lines: string[] = [];
    const files: Record<string, string> = {
      [resolve('server/testFixtures/p4AttackManifest.json')]: readFileSync('server/testFixtures/p4AttackManifest.json', 'utf8'),
      [resolve('.p4-results.json')]: JSON.stringify(results),
    };
    const exit = assertP4GateResults(
      { manifestPath: 'server/testFixtures/p4AttackManifest.json', resultsPath: '.p4-results.json', requireZeroSkips },
      { readFile: (path) => files[path], dashboardRoot, log: (line) => lines.push(line) },
    );
    return { exit, lines };
  }

  it('passes a clean gate covering exactly the manifest files with owned attacks', () => {
    const { exit, lines } = runAssert(cleanResults());
    expect(lines.join('\n')).toContain('P4 gate clean');
    expect(exit).toBe(0);
  });

  it('refuses a skipped test, a missing gate file, and an unrun attack', () => {
    // Skipped test.
    const skipped = cleanResults() as { testResults: { assertionResults: { status: string }[] }[] };
    skipped.testResults[0].assertionResults[0].status = 'skipped';
    expect(runAssert(skipped).exit).toBe(1);

    // Missing gate file: drop one file entirely.
    const missing = cleanResults() as { testResults: unknown[] };
    missing.testResults = missing.testResults.slice(1);
    expect(runAssert(missing).lines.join('\n')).toContain('missing from results');

    // Unrun attack: strip the attack titles from the owning suite.
    const noAttacks = cleanResults() as { testResults: { name: string; assertionResults: { title: string }[] }[] };
    const suite = noAttacks.testResults.find((f) => f.name.endsWith('p4FixtureRemoteLifecycle.test.ts'));
    if (suite) suite.assertionResults = suite.assertionResults.filter((a) => !a.title.startsWith('refuses: '));
    expect(runAssert(noAttacks).lines.join('\n')).toContain("no test titled 'refuses:");
  });

  it('refuses a results run with an extra file not in the manifest gate', () => {
    const extra = cleanResults() as { testResults: { name: string; status: string; assertionResults: unknown[] }[] };
    extra.testResults.push({ name: join(dashboardRoot, 'server/unlisted.test.ts'), status: 'passed', assertionResults: [{ title: 't', status: 'passed' }] });
    expect(runAssert(extra).lines.join('\n')).toContain('not in the manifest gate');
  });
});

describe('cleanup', () => {
  it('removes every created path', () => {
    const fixture = newFixture();
    const { identity } = fixture;
    runScheduleBatch(fixture);
    cleanup(fixture);
    fixtures.pop(); // already cleaned
    for (const path of [identity.tempRoot, identity.bareRemote, identity.workerWorktree, identity.controlStore, identity.opsOutbox]) {
      expect(existsSync(path)).toBe(false);
    }
  });
});

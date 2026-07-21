/**
 * Build-verified behavior of the T7 harness: it is inert at import and REFUSES to run unless the gate is
 * already on AND the operator confirmed a live watched run. The live run itself is human-supervised and is
 * not exercised here (it spawns a real `claude`).
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertAcceptanceGate,
  AcceptanceRefusal,
  setUpThrowawayRepo,
  assertCoordinationRemoteIsolated,
  type ThrowawayRepo,
} from './synthetic-acceptance.ts';

describe('assertAcceptanceGate — the harness refuses to run unless watched + gated', () => {
  it('refuses when the activation gate is off, whatever the args', () => {
    expect(() => assertAcceptanceGate({}, ['--confirm-live'])).toThrow(AcceptanceRefusal);
    expect(() => assertAcceptanceGate({ DASHBOARD_EXECUTION_ACTIVATED: '0' }, ['--confirm-live'])).toThrow(/not "1"/);
  });

  it('refuses when the gate is on but --confirm-live is absent (never runs unattended)', () => {
    expect(() => assertAcceptanceGate({ DASHBOARD_EXECUTION_ACTIVATED: '1' }, [])).toThrow(/--confirm-live/);
  });

  it('passes only when the gate is on AND the run is explicitly confirmed', () => {
    expect(() => assertAcceptanceGate({ DASHBOARD_EXECUTION_ACTIVATED: '1' }, ['--confirm-live'])).not.toThrow();
  });
});

// The isolation seam runs REAL git against temp dirs — no claude, no dashboard, no network. This is the
// build-verified proof that the coordination writes provably cannot reach real state (the fixed HIGH).
describe('setUpThrowawayRepo / assertCoordinationRemoteIsolated — coordination isolation is code-enforced', () => {
  const git = (repo: string, args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const created: string[] = [];
  let sourceRepo: string;
  let iso: ThrowawayRepo;

  beforeAll(() => {
    // A minimal "real" source repo with one commit (its current branch is arbitrary — the clone makes ops).
    sourceRepo = mkdtempSync(join(tmpdir(), 'wave-a-src-'));
    created.push(sourceRepo);
    git(sourceRepo, ['init', '--quiet']);
    git(sourceRepo, ['config', 'user.email', 'src@local']);
    git(sourceRepo, ['config', 'user.name', 'src']);
    writeFileSync(join(sourceRepo, 'README.md'), '# source\n');
    git(sourceRepo, ['add', 'README.md']);
    git(sourceRepo, ['commit', '--quiet', '-m', 'init']);

    iso = setUpThrowawayRepo(sourceRepo);
    created.push(iso.repoRoot, iso.coordinationRemote);
  });

  afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  });

  it('checks the clone out on the local ops branch (the coordination seam requires HEAD==ops)', () => {
    expect(git(iso.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('ops');
  });

  it('re-points the coordination remote at the throwaway bare mirror, NOT the real repo', () => {
    const origin = git(iso.repoRoot, ['remote', 'get-url', 'origin']).trim();
    expect(realpathSync(origin)).toBe(realpathSync(iso.coordinationRemote));
    expect(realpathSync(origin)).not.toBe(realpathSync(sourceRepo));
    // The mirror is a bare repo that already has ops seeded (so `pull --rebase origin ops` has an upstream).
    expect(git(iso.coordinationRemote, ['rev-parse', 'ops']).trim()).toMatch(/^[a-f0-9]{40}$/);
  });

  it('a coordination push lands in the mirror, never the real repo', () => {
    writeFileSync(join(iso.repoRoot, 'queue-note.txt'), 'coordination write\n');
    git(iso.repoRoot, ['add', 'queue-note.txt']);
    git(iso.repoRoot, ['commit', '--quiet', '-m', 'coordination commit']);
    const head = git(iso.repoRoot, ['rev-parse', 'HEAD']).trim();
    git(iso.repoRoot, ['push', '--quiet', 'origin', 'ops']);
    // The mirror's ops now equals the pushed HEAD; the source repo is untouched (still one commit).
    expect(git(iso.coordinationRemote, ['rev-parse', 'ops']).trim()).toBe(head);
    expect(git(sourceRepo, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('assertCoordinationRemoteIsolated: passes for the mirror, REFUSES if origin resolves to the real repo', () => {
    expect(() => assertCoordinationRemoteIsolated(iso.repoRoot, sourceRepo)).not.toThrow();
    // Simulate the dangerous misconfiguration: point origin back at the real repo.
    git(iso.repoRoot, ['remote', 'set-url', 'origin', sourceRepo]);
    expect(() => assertCoordinationRemoteIsolated(iso.repoRoot, sourceRepo)).toThrow(AcceptanceRefusal);
    // Restore isolation so afterAll teardown is clean.
    git(iso.repoRoot, ['remote', 'set-url', 'origin', iso.coordinationRemote]);
  });
});

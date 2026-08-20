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
  pollRunTerminal,
  type ThrowawayRepo,
} from './synthetic-acceptance.ts';
import type { SurfaceContext } from '../http/context.ts';

function ctxReturning(state: string | null): SurfaceContext {
  return {
    controlStore: {
      getRun: () => (state === null
        ? { ok: false as const }
        : { ok: true as const, value: { run: { lifecycle: { kind: state, deployPause: null } } } }),
    },
  } as unknown as SurfaceContext;
}

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

describe('pollRunTerminal — a parked run is an observation stop, not a 20-min dead-spin', () => {
  it('returns waiting-human PROMPTLY (parked runs need a human; never wait out the cap)', async () => {
    const started = Date.now();
    // A generous cap: if waiting-human were NOT a stop, this would spin the full cap before returning.
    const state = await pollRunTerminal(ctxReturning('waiting-human'), 'run-1', 30 * 60_000);
    expect(state).toBe('waiting-human');
    // First-iteration return happens before the 2s poll sleep, so this is effectively instant.
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('returns the terminal state promptly (succeeded)', async () => {
    expect(await pollRunTerminal(ctxReturning('succeeded'), 'run-1', 30 * 60_000)).toBe('succeeded');
  });

  it('still respects the cap for a non-stop state (in-flight run never parked)', async () => {
    // `running` is neither terminal nor a park, so the observer honors the deadline and returns the last
    // observed state — proving the new stop condition did not remove the bounded-wait safety net.
    expect(await pollRunTerminal(ctxReturning('running'), 'run-1', 5)).toBe('running');
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

  // The daemon canonical integrator (canonicalResultIntegrator.ts) prefixes EVERY git op with
  // `-c protocol.allow=never` and whitelists only https/ssh — which also denies the `file` transport. The
  // throwaway coordination remote is a LOCAL bare mirror (a filesystem path → file transport), so without a
  // scoped re-permit the integrator's lineage `push origin HEAD:refs/heads/<branch>` (L569) fails
  // "transport 'file' not allowed" and the run parks at waiting-human. setUpThrowawayRepo re-permits `file`
  // in the throwaway clone+mirror config only; these two tests prove the fix works AND is load-bearing.
  const daemonPrefix = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always'];

  it('lineage publish/fetch under the daemon restrictive prefix succeeds against the throwaway file mirror', () => {
    writeFileSync(join(iso.repoRoot, 'lineage-note.txt'), 'lineage publish\n');
    git(iso.repoRoot, ['add', 'lineage-note.txt']);
    git(iso.repoRoot, ['commit', '--quiet', '-m', 'lineage commit']);
    const head = git(iso.repoRoot, ['rev-parse', 'HEAD']).trim();
    // The exact shape of the previously-failing op (integrator L569) + its paired fetch (L570-572).
    expect(() => git(iso.repoRoot, [...daemonPrefix, 'push', 'origin', 'HEAD:refs/heads/lineage-proof'])).not.toThrow();
    expect(git(iso.coordinationRemote, ['rev-parse', 'lineage-proof']).trim()).toBe(head);
    expect(() => git(iso.repoRoot, [...daemonPrefix, 'fetch', '--no-tags', 'origin',
      'refs/heads/lineage-proof:refs/remotes/origin/lineage-proof'])).not.toThrow();
  });

  it('the file-transport permission is SCOPED — a clone without it still refuses (proving the fix is load-bearing)', () => {
    // Negative control: a fresh clone that did NOT receive `protocol.file.allow=always` reproduces the
    // original failure under the daemon prefix, so the harness config — not some ambient default — is the fix.
    const bare = mkdtempSync(join(tmpdir(), 'wave-a-ctl-mirror-'));
    const plain = mkdtempSync(join(tmpdir(), 'wave-a-ctl-clone-'));
    created.push(bare, plain);
    git(bare, ['init', '--bare', '--quiet']);
    git(sourceRepo, ['clone', '--local', '--no-hardlinks', sourceRepo, plain]);
    git(plain, ['remote', 'set-url', 'origin', bare]);
    let err: unknown;
    try {
      git(plain, [...daemonPrefix, 'push', 'origin', 'HEAD:refs/heads/main']);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message);
    expect(stderr).toMatch(/transport 'file' not allowed/);
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

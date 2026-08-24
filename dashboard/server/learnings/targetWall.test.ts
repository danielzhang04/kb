/**
 * P4 W2 — the Implementer target wall and the P4-C22 kind filter (plan §3.2, §5 W2 row).
 *
 * The wall delegates to `scripts.agent_maintainer.validate_target_path` through an injected bounded
 * process runner (fixed module entry, JSON stdin, JSON stdout — target text is never interpolated
 * into Python source or a shell command) and then performs the durable-classifier/existence checks
 * in TS. The kind filter batches `lesson` AND `agent-improvement` records whose target clears that
 * wall and SKIPS every other record without error and without touching its bytes.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ProposalRecord } from './contracts.ts';
import {
  AGENT_MAINTAINER_WALL_ENTRY,
  pythonWallInvocation,
  selectImplementerBatch,
  validateImplementerTarget,
  type BoundedProcessRequest,
  type PathFacts,
  type TargetWallPorts,
} from './targetWall.ts';

const BASE = 'a'.repeat(40);

function record(overrides: Partial<ProposalRecord> & { id: string }): ProposalRecord {
  return {
    schema: 'kb.learning-proposal/v1',
    kind: 'lesson',
    sourceAgent: 'lessons-miner',
    sourceRun: 'run_01HXYZ',
    createdAt: '2026-08-20T05:30:00Z',
    target: 'agents/fyt-checker.md',
    status: 'proposed',
    batchId: null,
    implementedAt: null,
    evidence: [{ path: 'memory/lessons-miner.md', locator: '2026-08-20 run_01HXYZ' }],
    proposedChange: 'One bounded, testable change.',
    ...overrides,
  };
}

function ports(options: {
  python?: (request: BoundedProcessRequest) => string;
  facts?: (absolute: string) => PathFacts;
} = {}): { ports: TargetWallPorts; python: BoundedProcessRequest[]; stats: string[] } {
  const python: BoundedProcessRequest[] = [];
  const stats: string[] = [];
  return {
    python,
    stats,
    ports: {
      // The fake models the REAL entry's wire shape only; the real subprocess is exercised by the
      // integration suite below. It stays for failure injection the real wall cannot be made to emit.
      runPython: async (request) => {
        python.push(request);
        return options.python
          ? options.python(request)
          : JSON.stringify({ ok: true, normalized: (JSON.parse(request.stdin) as { target: string }).target });
      },
      lstatPath: async (absolute) => {
        stats.push(absolute);
        return options.facts
          ? options.facts(absolute)
          : { exists: true, isFile: true, isSymbolicLink: false };
      },
    },
  };
}

describe('validateImplementerTarget — the Python wall is executed, never interpolated', () => {
  it('sends {repoRoot,target} on JSON stdin to the fixed module entry with shell:false and the documented caps', async () => {
    const harness = ports();
    const result = await validateImplementerTarget('/repo', 'agents/fyt-checker.md', harness.ports);
    expect(result).toEqual({ ok: true, target: 'agents/fyt-checker.md' });
    expect(harness.python).toHaveLength(1);
    const request = harness.python[0]!;
    expect(request.args.at(-1)).toBe(AGENT_MAINTAINER_WALL_ENTRY);
    expect(request.args).toContain('-c');
    expect(request.shell).toBe(false);
    expect(request.timeoutMs).toBe(15_000);
    expect(request.maxStdoutBytes).toBe(1024 * 1024);
    expect(request.maxStderrBytes).toBe(64 * 1024);
    expect(JSON.parse(request.stdin)).toEqual({ repoRoot: '/repo', target: 'agents/fyt-checker.md' });
    // The filesystem probe ran on the resolved target, and on nothing else.
    expect(harness.stats).toEqual([resolve('/repo', 'agents/fyt-checker.md')]);
    // The target never reaches the Python SOURCE or an argv token.
    expect(AGENT_MAINTAINER_WALL_ENTRY).not.toContain('fyt-checker');
    for (const arg of request.args) expect(arg).not.toContain('fyt-checker');
  });

  it('uses the platform argv: py -3 -c on Windows, python3 -c elsewhere, with no shell', () => {
    expect(pythonWallInvocation('win32')).toEqual({ command: 'py', args: ['-3', '-c', AGENT_MAINTAINER_WALL_ENTRY] });
    expect(pythonWallInvocation('linux')).toEqual({ command: 'python3', args: ['-c', AGENT_MAINTAINER_WALL_ENTRY] });
  });

  it('rejects when the Python wall refuses, when its output is not the closed JSON, and when it renormalizes', async () => {
    const refused = await validateImplementerTarget('/repo', 'agents/a.md',
      ports({ python: () => JSON.stringify({ ok: false, code: 'python-wall-rejected', detail: 'TargetWallError: ...' }) }).ports);
    expect(refused).toEqual({ ok: false, reason: 'python-wall-rejected' });
    // An `ok:false` without the wall's own code is an output the entry cannot produce.
    const unknownRefusal = await validateImplementerTarget('/repo', 'agents/a.md',
      ports({ python: () => JSON.stringify({ ok: false, reason: 'not an agent file' }) }).ports);
    expect(unknownRefusal).toEqual({ ok: false, reason: 'python-output-invalid' });
    const garbage = await validateImplementerTarget('/repo', 'agents/a.md', ports({ python: () => 'not json' }).ports);
    expect(garbage).toEqual({ ok: false, reason: 'python-output-invalid' });
    const drifted = await validateImplementerTarget('/repo', 'agents/a.md',
      ports({ python: () => JSON.stringify({ ok: true, normalized: 'agents/other.md' }) }).ports);
    expect(drifted).toEqual({ ok: false, reason: 'python-output-invalid' });
  });

  it('rejects a coordination target, a non-Implementer shape, a nested path, and a missing file', async () => {
    expect(await validateImplementerTarget('/repo', 'memory/lessons-miner.md', ports().ports))
      .toEqual({ ok: false, reason: 'not-durable' });
    expect(await validateImplementerTarget('/repo', 'docs/plans/x.md', ports().ports))
      .toEqual({ ok: false, reason: 'not-implementer-target' });
    expect(await validateImplementerTarget('/repo', 'agents/sub/a.md', ports().ports))
      .toEqual({ ok: false, reason: 'not-implementer-target' });
    expect(await validateImplementerTarget('/repo', 'agents/../etc/passwd.md', ports().ports))
      .toEqual({ ok: false, reason: 'not-implementer-target' });
    expect(await validateImplementerTarget('/repo', 'agents/ghost.md',
      ports({ facts: () => ({ exists: false, isFile: false, isSymbolicLink: false }) }).ports))
      .toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a symlink/reparse point at the target and never asks Python about a structurally bad path', async () => {
    const symlink = ports({ facts: () => ({ exists: true, isFile: true, isSymbolicLink: true }) });
    expect(await validateImplementerTarget('/repo', 'agents/a.md', symlink.ports))
      .toEqual({ ok: false, reason: 'symlink' });
    const structural = ports();
    expect(await validateImplementerTarget('/repo', '/etc/passwd', structural.ports))
      .toEqual({ ok: false, reason: 'not-implementer-target' });
    expect(structural.python).toHaveLength(0);
  });
});

/**
 * The REAL wall. Everything above injects a fake runner; this suite spawns the actual Python entry
 * against `scripts/agent_maintainer.py`, so the argument order, the raise/return contract, and
 * `has_unsafe_link_component` are proved by execution rather than by belief.
 */
describe('the REAL agent_maintainer wall, executed as a subprocess', () => {
  const KB_ROOT = resolve(import.meta.dirname, '../../..');

  /** A bounded runner with the module's own caps — the production port shape, spawned for real. */
  const realRunPython: TargetWallPorts['runPython'] = (request) => new Promise((resolvePromise, reject) => {
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), request.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(out);
      else reject(new Error(`python wall exited ${code}: ${err.slice(0, 400)}`));
    });
    child.stdin.end(request.stdin);
  });

  /** `cwd` is the kb root so `scripts.agent_maintainer` imports; `repoRoot` is the tree under test. */
  const wallPorts = (facts: (absolute: string) => PathFacts): TargetWallPorts => ({
    runPython: (request) => realRunPython({ ...request, cwd: KB_ROOT }),
    lstatPath: async (absolute) => facts(absolute),
  });
  const present = () => ({ exists: true, isFile: true, isSymbolicLink: false });

  it('accepts an agents/ and a routines/roles/ target, returning Python\'s own canonical path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-wall-accept-'));
    mkdirSync(join(root, 'agents'));
    mkdirSync(join(root, 'routines', 'roles'), { recursive: true });
    writeFileSync(join(root, 'agents', 'fyt-checker.md'), '# agent\n', 'utf8');
    expect(await validateImplementerTarget(root, 'agents/fyt-checker.md', wallPorts(present)))
      .toEqual({ ok: true, target: 'agents/fyt-checker.md' });
    expect(await validateImplementerTarget(root, 'routines/roles/dispatcher.md', wallPorts(present)))
      .toEqual({ ok: true, target: 'routines/roles/dispatcher.md' });
  }, 60_000);

  it('refuses a target the wall itself rejects, as python-wall-rejected rather than an invalid output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-wall-refuse-'));
    mkdirSync(join(root, 'agents'));
    // `agents/x.exe.md` clears the TS shape wall but is refused by Python's own permitted-surface rule
    // once the extension check runs; `AGENTS.md` at the root is a one-part path outside the shape.
    const refused = await validateImplementerTarget(root, 'agents/a.md', {
      ...wallPorts(present),
      // Point the wall at a repoRoot whose `agents` is a FILE: the resolved candidate escapes.
      runPython: (request) => realRunPython({
        ...request, cwd: KB_ROOT, stdin: JSON.stringify({ repoRoot: root, target: 'docs/plans/x.md' }),
      }),
    });
    expect(refused).toEqual({ ok: false, reason: 'python-wall-rejected' });
  }, 60_000);

  it('refuses a symlink/junction on a PATH COMPONENT — has_unsafe_link_component actually executes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-wall-link-'));
    mkdirSync(join(root, 'real-agents'));
    writeFileSync(join(root, 'real-agents', 'a.md'), '# agent\n', 'utf8');
    // A directory junction (Windows) / symlink (POSIX) AT the `agents` component. The candidate still
    // resolves INSIDE the allowed root, so only the component walk can refuse it.
    symlinkSync(join(root, 'real-agents'), join(root, 'agents'), 'junction');
    expect(await validateImplementerTarget(root, 'agents/a.md', wallPorts(present)))
      .toEqual({ ok: false, reason: 'python-wall-rejected' });

    // Control: the same tree with a REAL directory at that component is accepted, so the refusal above
    // is the link check and nothing else.
    const control = mkdtempSync(join(tmpdir(), 'kb-wall-control-'));
    mkdirSync(join(control, 'agents'));
    writeFileSync(join(control, 'agents', 'a.md'), '# agent\n', 'utf8');
    expect(await validateImplementerTarget(control, 'agents/a.md', wallPorts(present)))
      .toEqual({ ok: true, target: 'agents/a.md' });
  }, 60_000);
});

describe('selectImplementerBatch — the P4-C22 kind filter', () => {
  it('batches lesson AND agent-improvement, skips every other kind, and leaves skipped records proposed and byte-identical', async () => {
    const lesson = record({ id: 'lessons-miner-run_01HXYZ-01', kind: 'lesson', target: 'agents/a.md' });
    const improvement = record({ id: 'lessons-miner-run_01HXYZ-02', kind: 'agent-improvement', target: 'routines/roles/b.md' });
    const others = (['grade-finding', 'model-audit', 'hygiene', 'context-lifecycle'] as const).map((kind, index) =>
      record({ id: `lessons-miner-run_01HXYZ-0${index + 3}`, kind, target: 'agents/c.md' }));
    const before = JSON.stringify([lesson, improvement, ...others]);
    const result = await selectImplementerBatch([lesson, improvement, ...others], {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch?.records.map((entry) => entry.record.id)).toEqual([
      'lessons-miner-run_01HXYZ-01', 'lessons-miner-run_01HXYZ-02',
    ]);
    expect(result.skipped.map((entry) => [entry.id, entry.reason])).toEqual([
      ['lessons-miner-run_01HXYZ-03', 'records-only-kind'],
      ['lessons-miner-run_01HXYZ-04', 'records-only-kind'],
      ['lessons-miner-run_01HXYZ-05', 'records-only-kind'],
      ['lessons-miner-run_01HXYZ-06', 'records-only-kind'],
    ]);
    for (const entry of [...others, lesson, improvement]) expect(entry.status).toBe('proposed');
    expect(JSON.stringify([lesson, improvement, ...others])).toBe(before);
  });

  it('skips a lesson or agent-improvement whose target is outside the wall — a coordination target is not an error', async () => {
    const coordination = record({ id: 'lessons-miner-run_01HXYZ-01', kind: 'lesson', target: 'memory/lessons-miner.md' });
    const outside = record({ id: 'lessons-miner-run_01HXYZ-02', kind: 'agent-improvement', target: 'scripts/agent_maintainer.py' });
    const missing = record({ id: 'lessons-miner-run_01HXYZ-03', kind: 'lesson', target: 'agents/ghost.md' });
    const result = await selectImplementerBatch([coordination, outside, missing], {
      repoRoot: '/repo',
      baseCommit: BASE,
      implementedAt: '2026-08-20T06:00:00Z',
      ports: ports({ facts: (absolute) => ({ exists: !absolute.includes('ghost'), isFile: !absolute.includes('ghost'), isSymbolicLink: false }) }).ports,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch).toBeNull();
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['not-durable', 'not-implementer-target', 'missing']);
    for (const entry of [coordination, outside, missing]) expect(entry.status).toBe('proposed');
  });

  it('rejects the whole batch on duplicate targets and on a target equal to a proposal-record path', async () => {
    const first = record({ id: 'lessons-miner-run_01HXYZ-01', target: 'agents/a.md' });
    const second = record({ id: 'lessons-miner-run_01HXYZ-02', target: 'agents/a.md' });
    const conflict = await selectImplementerBatch([first, second], {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    });
    expect(conflict).toMatchObject({ ok: false, reason: 'conflicting-targets' });

    const selfTargeting = record({
      id: 'lessons-miner-run_01HXYZ-03',
      target: 'docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-03.md',
    });
    const overlap = await selectImplementerBatch([record({ id: 'lessons-miner-run_01HXYZ-01' }), selfTargeting], {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    });
    // The record path is outside the target wall, so it is skipped rather than colliding.
    expect(overlap.ok).toBe(true);
  });

  it('rejects more than five candidates and returns a no-op batch for zero candidates', async () => {
    const six = Array.from({ length: 6 }, (_value, index) => record({
      id: `lessons-miner-run_01HXYZ-0${index + 1}`, target: `agents/a${index}.md`,
    }));
    // Six ids exceed the two-digit ordinal cap only above 99; the batch cap is what rejects here.
    expect(await selectImplementerBatch(six, {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    })).toMatchObject({ ok: false, reason: 'batch-cap-exceeded' });

    const none = await selectImplementerBatch([], {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    });
    expect(none).toEqual({ ok: true, batch: null, skipped: [] });
  });

  it('derives the batch id, record paths, and sorted relpaths from the validated candidates only', async () => {
    const lesson = record({ id: 'lessons-miner-run_01HXYZ-02', target: 'agents/zeta.md' });
    const improvement = record({ id: 'lessons-miner-run_01HXYZ-01', kind: 'agent-improvement', target: 'agents/alpha.md' });
    const result = await selectImplementerBatch([lesson, improvement], {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.batch) throw new Error('expected a batch');
    expect(result.batch.batchId).toMatch(/^learn-[0-9a-f]{24}$/);
    expect(result.batch.targetPaths).toEqual(['agents/alpha.md', 'agents/zeta.md']);
    expect(result.batch.recordPaths).toEqual([
      'docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-01.md',
      'docs/proposals/learnings/2026-08-20-lessons-miner-run_01HXYZ-02.md',
    ]);
    expect(result.batch.relpaths).toEqual([...result.batch.relpaths].sort());
    expect(new Set(result.batch.relpaths)).toEqual(new Set([...result.batch.targetPaths, ...result.batch.recordPaths]));
    // A skipped record never contributes a path, and the id set drives the batch id deterministically.
    const again = await selectImplementerBatch([improvement, lesson], {
      repoRoot: '/repo', baseCommit: BASE, implementedAt: '2026-08-20T06:00:00Z', ports: ports().ports,
    });
    expect(again.ok && again.batch?.batchId).toBe(result.batch.batchId);
  });
});

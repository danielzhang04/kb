import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commitPreparedCoordination,
  isCoordinationPath,
  prepareCoordination,
  publishPreparedCoordinationCommit,
  type GitRunner,
} from './branch.ts';
import {
  fsyncPath,
  recoverUnspooledCoordinationCommits,
  spoolCoordinationCommit,
  type SpoolInput,
} from './outbox.ts';

const parent = 'a'.repeat(40);
const commit = 'b'.repeat(40);
const path = 'memory/worker.md';

function fixtureSpool(overrides: Partial<SpoolInput> & { parents?: string } = {}): SpoolInput {
  const spoolRoot = mkdtempSync(join(tmpdir(), 'outbox-fixture-'));
  const parents = overrides.parents ?? parent;
  const runGit: GitRunner = async (_root, args) => {
    if (args[0] === 'diff-tree') return `${path}\0`;
    if (args[0] === 'rev-list') return `${commit} ${parents}\n`;
    if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
    if (args[0] === 'update-ref') return '';
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  return {
    repoRoot: '/repo',
    spoolRoot,
    commit,
    paths: [path],
    runGit,
    isCoordinationPath,
    ...overrides,
  };
}

describe('coordination outbox', () => {
  it('spools an exact coordination commit and publishes the manifest last', async () => {
    const spoolRoot = mkdtempSync(join(tmpdir(), 'outbox-'));
    const runGit: GitRunner = async (_root, args) => {
      if (args[0] === 'diff-tree') return `${path}\0`;
      if (args[0] === 'rev-list') return `${commit} ${parent}\n`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };
    const manifest = await spoolCoordinationCommit({
      repoRoot: '/repo',
      spoolRoot,
      commit,
      paths: [path],
      runGit,
      isCoordinationPath,
      now: () => new Date('2026-08-11T12:00:00Z'),
    });
    const manifests = readdirSync(join(spoolRoot, 'ready')).filter((name) => name.endsWith('.json'));
    expect(manifests).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(spoolRoot, 'ready', manifests[0]), 'utf8'))).toEqual(manifest);
    expect(existsSync(join(spoolRoot, 'ready', `${manifest.id}.bundle`))).toBe(true);
    expect(manifest.id).toBe(manifest.commit);
    expect(manifest.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a merge commit by its parent shape before diagnosing its empty diff', async () => {
    const merge = fixtureSpool({ parents: `${parent} ${'c'.repeat(40)}`, paths: [] });
    merge.runGit = async (_root, args) => {
      if (args[0] === 'rev-list') return `${commit} ${parent} ${'c'.repeat(40)}\n`;
      if (args[0] === 'diff-tree') return '';
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };
    await expect(spoolCoordinationCommit(merge))
      .rejects.toThrow(/single parent/);
  });

  it('refuses a non-canonical timestamp', async () => {
    await expect(spoolCoordinationCommit(fixtureSpool({ now: () => new Date(Number.NaN) })))
      .rejects.toThrow(/timestamp/);
  });

  it('invokes the fsync seam on the non-win32 durability branch', () => {
    const calls: Array<string | number> = [];
    fsyncPath('/durable/item', {
      platform: 'linux',
      open: (path) => { calls.push(path); return 41; },
      fsync: (fd) => { calls.push(fd); },
      close: (fd) => { calls.push(fd); },
    });
    expect(calls).toEqual(['/durable/item', 41, 41]);
  });

  it('recovers a commit left after git commit but before spool publication', async () => {
    const calls: string[][] = [];
    const spoolRoot = mkdtempSync(join(tmpdir(), 'recover-'));
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      if (args.join(' ') === 'rev-parse --verify refs/kb-outbox/spooled') return `${parent}\n`;
      if (args[0] === 'rev-list' && args[1] === '--reverse') return `${commit}\n`;
      if (args[0] === 'rev-list' && args[1] === '--parents') return `${commit} ${parent}\n`;
      if (args[0] === 'diff-tree') return `${path}\0`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };
    await recoverUnspooledCoordinationCommits({
      repoRoot: '/repo',
      spoolRoot,
      runGit: runner,
      isCoordinationPath,
    });
    expect(calls).toContainEqual(['update-ref', 'refs/kb-outbox/spooled', commit, parent]);
  });

  it('writes Python-compatible ASCII-only canonical JSON for non-ASCII paths', async () => {
    const nonAsciiPath = 'memory/caf\u00e9-\u6f22-\u{1f600}.md';
    const input = fixtureSpool({ paths: [nonAsciiPath] });
    input.runGit = async (_root, args) => {
      if (args[0] === 'diff-tree') return `${nonAsciiPath}\0`;
      if (args[0] === 'rev-list') return `${commit} ${parent}\n`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    };

    const manifest = await spoolCoordinationCommit(input);

    const manifestBytes = readFileSync(join(input.spoolRoot, 'ready', `${commit}.json`));
    expect(manifestBytes.toString('utf8')).toBe(
      `{"bundleSha256":"${manifest.bundleSha256}","commit":"${commit}","createdAt":"${manifest.createdAt}","id":"${commit}","parent":"${parent}","paths":["memory/caf\\u00e9-\\u6f22-\\ud83d\\ude00.md"],"schema":"kb.ops-outbox/v1"}\n`,
    );
  });

  it('refuses invalid commit and parent ids before handing them to git revision arguments', async () => {
    let diffTreeCalls = 0;
    const invalidCommit = fixtureSpool({ commit: '--not-an-object' });
    invalidCommit.runGit = async (_root, args) => {
      if (args[0] === 'diff-tree') diffTreeCalls += 1;
      return '';
    };
    await expect(spoolCoordinationCommit(invalidCommit)).rejects.toThrow(/full object id/);
    expect(diffTreeCalls).toBe(0);

    let bundleCalls = 0;
    const invalidParent = fixtureSpool();
    invalidParent.runGit = async (_root, args) => {
      if (args[0] === 'diff-tree') return `${path}\0`;
      if (args[0] === 'rev-list') return `${commit} not-an-object\n`;
      if (args[0] === 'bundle') bundleCalls += 1;
      return '';
    };
    await expect(spoolCoordinationCommit(invalidParent)).rejects.toThrow(/parent.*full object id/);
    expect(bundleCalls).toBe(0);
  });

  it('names the refused commit and offending path', async () => {
    await expect(spoolCoordinationCommit(fixtureSpool({ paths: ['docs/not-coordination.md'] })))
      .rejects.toThrow(`outbox commit ${commit} contains a non-coordination path: docs/not-coordination.md`);
  });

  it('does not attempt network operations through prepare, commit, publish, and recovery in outbox mode', async () => {
    const outboxRoot = mkdtempSync(join(tmpdir(), 'outbox-no-network-'));
    let anchor = parent;
    let head = parent;
    const calls: string[][] = [];
    const runner: GitRunner = async (_root, args) => {
      calls.push(args);
      if (['fetch', 'pull', 'push'].includes(args[0])) throw new Error('NETWORK LEAK');
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (command === 'diff --cached --name-only -z' || command.startsWith('status ')) return '';
      if (command === 'rev-parse HEAD') return `${head}\n`;
      if (command === 'rev-parse --verify refs/kb-outbox/spooled') return `${anchor}\n`;
      if (command === `rev-list --reverse ${anchor}..HEAD`) return anchor === head ? '' : `${head}\n`;
      if (command === `rev-list --parents -n 1 ${commit}`) return `${commit} ${parent}\n`;
      if (args[0] === 'diff-tree') return `${path}\0`;
      if (args[0] === 'add') return '';
      if (args[0] === 'commit') { head = commit; return ''; }
      if (args[0] === 'bundle') { writeFileSync(args[2], 'bundle'); return ''; }
      if (args[0] === 'update-ref' && args[1] === 'refs/kb-outbox/spooled') { anchor = args[2]; return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git command: ${command}`);
    };

    await prepareCoordination('/repo', runner, 'outbox', outboxRoot);
    await commitPreparedCoordination('/repo', path, { runGit: runner, publication: 'outbox', outboxRoot });
    await publishPreparedCoordinationCommit('/repo', commit, {
      runGit: runner, relpaths: [path], publication: 'outbox', outboxRoot,
    });
    await recoverUnspooledCoordinationCommits({ repoRoot: '/repo', spoolRoot: outboxRoot, runGit: runner, isCoordinationPath });

    expect(calls.some((args) => ['fetch', 'pull', 'push'].includes(args[0]))).toBe(false);
    expect(anchor).toBe(commit);
  });

  it('repairs a crash between the bundle and manifest renames before advancing the anchor', async () => {
    const spoolRoot = mkdtempSync(join(tmpdir(), 'outbox-crash-'));
    const ready = join(spoolRoot, 'ready');
    mkdirSync(ready, { recursive: true });
    writeFileSync(join(ready, `${commit}.bundle`), 'partial bundle');
    writeFileSync(join(spoolRoot, `${commit}.json.tmp`), '{"partial":true}\n');
    let advanced = false;
    const runner: GitRunner = async (_root, args) => {
      const command = args.join(' ');
      if (command === 'rev-parse --verify refs/kb-outbox/spooled') return `${parent}\n`;
      if (command === `rev-list --reverse ${parent}..HEAD`) return `${commit}\n`;
      if (command === `rev-list --parents -n 1 ${commit}`) return `${commit} ${parent}\n`;
      if (args[0] === 'diff-tree') return `${path}\0`;
      if (args[0] === 'bundle') { writeFileSync(args[2], 'recovered bundle'); return ''; }
      if (args[0] === 'update-ref' && args[1] === 'refs/kb-outbox/spooled') { advanced = true; return ''; }
      if (args[0] === 'update-ref') return '';
      throw new Error(`unexpected git command: ${command}`);
    };

    await recoverUnspooledCoordinationCommits({ repoRoot: '/repo', spoolRoot, runGit: runner, isCoordinationPath });

    expect(existsSync(join(spoolRoot, `${commit}.json.tmp`))).toBe(false);
    expect(existsSync(join(ready, `${commit}.json`))).toBe(true);
    expect(readFileSync(join(ready, `${commit}.bundle`), 'utf8')).toBe('recovered bundle');
    expect(advanced).toBe(true);
  });
});

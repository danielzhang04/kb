import { describe, expect, it } from 'vitest';

import {
  BROKER_RUNTIME_POLICY,
  FdPinnedPathError,
  LINUX_CHILD_ENV_KEYS,
  type PinnedIdentity,
  buildBrokerLaunch,
  pinBrokerLaunch,
  resolveLinuxRoot,
  validateRelativeCwd,
} from './fdPinnedPaths.ts';

/** Linux O_PATH: the flag the walk retries a symlink component with. */
const O_PATH = 0x20_0000;

describe('fdPinnedPaths', () => {
  it('pins the two exact roots and the runtime-state policy', () => {
    expect(resolveLinuxRoot('repo')).toBe('/var/lib/kb/ops');
    expect(resolveLinuxRoot('worktrees')).toBe('/var/lib/kb-shell/worktrees');
    expect(BROKER_RUNTIME_POLICY).toEqual({
      runtimeDirectory: '/run/kb-shell',
      runtimeDirectoryMode: 0o700,
      statePath: '/run/kb-shell/state.json',
      stateOwner: 'kb-shell:kb-shell',
      stateMode: 0o600,
      readOnlyPaths: ['/var/lib/kb/ops', '/var/lib/kb-shell/home'],
      readWritePaths: ['/var/lib/kb-shell/worktrees'],
      inaccessiblePaths: ['/var/lib/kb/state', '/opt/kb-releases', '/var/lib/kb-activation'],
    });
  });

  it('rejects traversal, absolute paths, denied roots, controls, and unsafe path segments', () => {
    expect(validateRelativeCwd('safe/nested')).toBe('safe/nested');
    for (const value of ['../state', '/root', 'C:\\Windows', '\\\\host\\share', 'a//b', 'a/./b',
      'a/../b', 'a/CON', 'a/trailing.', 'a/trailing ', 'a\u0000b', '\u202e']) {
      expect(() => validateRelativeCwd(value)).toThrow(FdPinnedPathError);
    }
  });

  it('owns the closed recipe-to-argv table and minimal child environment', () => {
    const claude = buildBrokerLaunch({
      launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5',
      toolPolicyId: 'standard', sandbox: 'claude-policy', resumeRef: 'resume-1',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    expect(claude.executable).toBe('/var/lib/kb-shell/home/.local/bin/claude');
    expect(claude.args).toEqual([
      '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--model', 'claude-sonnet-4-5', '--resume', 'resume-1', '--allowedTools',
      'Read,Write,Edit,Bash', '--permission-mode', 'acceptEdits',
    ]);

    const codex = buildBrokerLaunch({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6',
      toolPolicyId: 'standard', sandbox: 'codex-workspace-write',
    }, 'worktrees', 'run-1', { cols: 100, rows: 30 });
    expect(codex.args).toEqual([
      'exec', '-', '--json', '--model', 'gpt-5.6', '-s', 'workspace-write',
      '-c', 'approval_policy=never', '-c', 'forced_login_method="chatgpt"',
      '-c', 'mcp_servers={}', '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"', '--cd', '/var/lib/kb-shell/worktrees/run-1',
    ]);
    expect(Object.keys(codex.env).sort()).toEqual([...LINUX_CHILD_ENV_KEYS].sort());
    expect(codex.env).not.toHaveProperty('TOKEN');
    expect(() => buildBrokerLaunch({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6-evil',
      toolPolicyId: 'standard', sandbox: 'codex-workspace-write',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 })).toThrow('approved model');
  });

  it('opens every component relative to pinned dirfds, accepts 02770 worktrees, and launches only proc fds', async () => {
    const opened: string[] = [];
    const identities = new Map<number, PinnedIdentity>();
    let nextFd = 10;
    const fakeFs = {
      open(path: string, _flags: number): number {
        opened.push(path);
        const fd = nextFd++;
        const leaf = path.split('/').at(-1);
        const worktree = leaf === 'worktrees';
        const run = leaf === 'run-1';
        const file = leaf === 'bash';
        identities.set(fd, { dev: 1n, ino: BigInt(fd), uid: worktree ? 1001 : run ? 1000 : 0,
          gid: worktree || run ? 1000 : 0, mode: file ? 0o100755 : worktree || run ? 0o042770 : 0o040755,
          kind: file ? 'file' : 'directory' });
        return fd;
      },
      identity(fd: number) { return identities.get(fd)!; },
      identityAt(_path: string, expected: PinnedIdentity) { return expected; },
      readlink() { throw new Error('not a symlink'); },
      read() { return Buffer.from([0x7f, 0x45, 0x4c, 0x46]); },
      close() {},
    };
    const pinned = await pinBrokerLaunch(buildBrokerLaunch({ launcher: 'shell', mode: 'interactive', model: null,
      toolPolicyId: 'shell-default', sandbox: 'interactive' }, 'worktrees', 'run-1', { cols: 80, rows: 24 }),
    { rootUid: 0, shellUid: 1000, shellGid: 1000, dashboardUid: 1001, dashboardGid: 1001 }, fakeFs);
    expect(opened[0]).toBe('/');
    expect(opened.slice(1).every((value) => value === '/' || value.startsWith('/proc/self/fd/'))).toBe(true);
    expect(pinned.launch.executable).toMatch(/^\/proc\/self\/fd\/\d+$/);
    expect(pinned.launch.cwd).toMatch(/^\/proc\/self\/fd\/\d+$/);
    await pinned.close();
  });

  it('follows a policy-valid symlink but refuses one swapped between the O_PATH pin and its use', async () => {
    const readlinks: string[] = [];
    const symlinkRechecks: string[] = [];
    // `run-1` is a symlink: O_NOFOLLOW|O_DIRECTORY fails with ELOOP, and only the O_PATH retry
    // succeeds — returning a symlink fd whose identity the walk must verify before it is used.
    const makeFake = (swap: 'symlink-swapped' | 'symlink-valid' | 'ancestor') => {
      let nextFd = 20;
      const identities = new Map<number, PinnedIdentity>();
      return {
        open(path: string, flags: number): number {
          const symlinkComponent = swap !== 'ancestor' && path.endsWith('/run-1');
          if (symlinkComponent && (flags & O_PATH) === 0) {
            throw Object.assign(new Error('symlink'), { code: 'ELOOP' });
          }
          const fd = nextFd++;
          const file = path.endsWith('/bash');
          const worktree = path.endsWith('/worktrees');
          const directory = path.endsWith('/run-1') || path.endsWith('/target');
          identities.set(fd, symlinkComponent
            // the pinned O_PATH fd: a symlink owned by kb-shell inside the 02770 worktree root
            ? { dev: 1n, ino: BigInt(fd), uid: 1000, gid: 1000, mode: 0o120777, kind: 'other' }
            : { dev: 1n, ino: BigInt(fd), uid: worktree ? 1001 : directory ? 1000 : 0,
              gid: worktree || directory ? 1000 : 0,
              mode: file ? 0o100755 : worktree || directory ? 0o042770 : 0o040755,
              kind: file ? 'file' : 'directory' });
          return fd;
        },
        identity(fd: number) { return identities.get(fd)!; },
        identityAt(path: string, expected: PinnedIdentity) {
          if (path.endsWith('/run-1')) symlinkRechecks.push(path);
          // the parent-anchored lstat of the symlink resolves to a different inode: a real swap
          if (swap === 'symlink-swapped' && path.endsWith('/run-1')) return { ...expected, ino: expected.ino + 1n };
          return swap === 'ancestor' && path === '/var/lib' ? { ...expected, ino: expected.ino + 1n } : expected;
        },
        readlink(path: string) {
          readlinks.push(path);
          if (!path.endsWith('/run-1')) throw new Error('not a symlink');
          return '/var/lib/kb-shell/worktrees/target';
        },
        read() { return Buffer.from([0x7f, 0x45, 0x4c, 0x46]); }, close() {},
      };
    };
    const launch = buildBrokerLaunch({ launcher: 'shell', mode: 'interactive', model: null,
      toolPolicyId: 'shell-default', sandbox: 'interactive' }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    const ids = { rootUid: 0, shellUid: 1000, shellGid: 1000, dashboardUid: 1001, dashboardGid: 1001 };

    await expect(pinBrokerLaunch(launch, ids, makeFake('symlink-swapped')))
      .rejects.toThrow('pinned symlink identity changed');
    await expect(pinBrokerLaunch(launch, ids, makeFake('ancestor')))
      .rejects.toThrow('pinned ancestor identity changed');

    const pinned = await pinBrokerLaunch(launch, ids, makeFake('symlink-valid'));
    expect(pinned.launch.cwd).toMatch(/^\/proc\/self\/fd\/\d+$/);
    // the link contents and its identity recheck both go through the pinned parent dirfd,
    // never through the full pathname the walk started from
    expect(readlinks.every((value) => value.startsWith('/proc/self/fd/'))).toBe(true);
    expect(symlinkRechecks.length).toBeGreaterThan(0);
    expect(symlinkRechecks.every((value) => value.startsWith('/proc/self/fd/'))).toBe(true);
    await pinned.close();
  });
});

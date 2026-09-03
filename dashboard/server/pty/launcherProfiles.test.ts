import { describe, expect, it } from 'vitest';

import {
  codexSandboxMode,
  toolCapArgv,
  WORKFLOW_EXECUTION_PROFILES,
} from '../control/workflowProfiles.ts';
import { buildBrokerLaunch } from './fdPinnedPaths.ts';
import type { LaunchRecipe, SessionHostRequest } from './contracts.ts';
import {
  CODEX_CONFIGURATION_PINS,
  CURRENT_PROCESS_SERVICE_SID,
  createWindowsChildEnv,
  createWindowsPathPinInspector,
  deriveWindowsLauncherPaths,
  mapWindowsLaunchRecipe,
  pinWindowsLauncher,
  WindowsPlatformUnsupportedError,
  type WindowsPathPinInspector,
  type WindowsPinnedPath,
} from './launcherProfiles.ts';

const environment = {
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\service',
  APPDATA: 'C:\\Users\\service\\AppData\\Roaming',
  ProgramFiles: 'C:\\Program Files',
  TEMP: 'C:\\Temp',
  PATH: 'ignored',
  ANTHROPIC_API_KEY: 'never-copy-me',
  RANDOM_VALUE: 'never-copy-me-either',
};

const baseRequest = (recipe: LaunchRecipe): SessionHostRequest => ({
  operationKey: `op-${'a'.repeat(64)}`,
  principal: { operator: 'operator-a', browserSessionRef: 'browser-a' },
  recipe,
  rootId: 'worktrees',
  relativeCwd: 'agent-one',
  cols: 100,
  rows: 30,
});

describe('Windows launcher profiles', () => {
  it('derives every launcher from the exact service-identity root', () => {
    expect(deriveWindowsLauncherPaths(environment)).toEqual({
      shell: 'C:\\Windows\\System32\\cmd.exe',
      claude: 'C:\\Users\\service\\.local\\bin\\claude.exe',
      codexShim: 'C:\\Users\\service\\AppData\\Roaming\\npm\\codex.cmd',
      codexEntry: 'C:\\Users\\service\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      node: 'C:\\Program Files\\nodejs\\node.exe',
    });
    expect(() => deriveWindowsLauncherPaths({ ...environment, SystemRoot: undefined })).toThrow();
  });

  it('builds a minimal child environment through the credential deny-list backstop', () => {
    expect(createWindowsChildEnv(environment, { cols: 91, rows: 27 })).toEqual({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\service',
      TERM: 'xterm-256color',
      COLUMNS: '91',
      LINES: '27',
    });
  });

  it('maps Claude headless through the exported policy and read-scope builders', () => {
    const launch = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'claude',
      mode: 'headless-json',
      model: 'claude-sonnet-4-5',
      toolPolicyId: 'implementation',
      sandbox: 'claude-policy',
      resumeRef: 'resume-1',
    }), {
      environment,
      rootPath: 'C:\\worktrees',
      claudeProfiles: [{ id: 'implementation', allowedTools: ['Read', 'Edit'] }],
      claudeScopes: { implementation: { readScope: ['orgs'], writeScope: ['dashboard'] } },
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    expect(launch.value.file).toBe('C:\\Users\\service\\.local\\bin\\claude.exe');
    expect(launch.value.args).toEqual([
      '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--settings', expect.stringContaining('Read(/memory/**)'),
      '--model', 'claude-sonnet-4-5', '--resume', 'resume-1',
      '--tools', 'Read,Edit', '--strict-mcp-config',
      '--allowedTools', 'Read,Edit', '--permission-mode', 'default',
    ]);
  });

  /**
   * ONE CAP, TWO LAUNCHERS. The Linux broker and the Windows launcher compose claude argv separately,
   * so the tool cap is exactly the kind of thing that lands on one side only - which is how
   * `--allowedTools` came to be the sole "cap" on both while capping nothing. Both read `toolCapArgv`
   * from the same importless leaf, and this drives every server-owned profile through both.
   */
  it.each(WORKFLOW_EXECUTION_PROFILES)('caps profile $id identically on both claude launchers', (profile) => {
    const windows = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'claude', mode: 'headless-json', model: 'claude-sonnet-4-5',
      toolPolicyId: profile.id, sandbox: 'claude-policy',
    }), { environment, rootPath: 'C:\\worktrees', claudeProfiles: [profile] });
    expect(windows.ok).toBe(true);
    if (!windows.ok) return;
    const linux = buildBrokerLaunch({
      launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
      toolPolicyId: profile.id, sandbox: 'claude-policy',
    }, 'worktrees', 'run-1', { cols: 80, rows: 24 }).args;

    const capSlice = (args: readonly string[]): readonly string[] =>
      args.slice(args.indexOf('--tools'), args.indexOf('--allowedTools'));
    expect(capSlice(windows.value.args)).toEqual(toolCapArgv(profile.allowedTools));
    expect(capSlice(linux)).toEqual(capSlice(windows.value.args));
    // The cap is a real subset of the built-in set, never the CLI's "all tools" escape hatch.
    expect(windows.value.args[windows.value.args.indexOf('--tools') + 1]).not.toBe('default');
  });

  it('maps Codex fresh and resume recipes to the one pinned argv table', () => {
    const fresh = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'producer',
      sandbox: 'codex-workspace-write',
    }), { environment, rootPath: 'C:\\worktrees' });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.value.file).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(fresh.value.args).toEqual([
      'C:\\Users\\service\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      'exec', '-', '--json', '--model', 'gpt-5.4', '-s', 'workspace-write',
      ...CODEX_CONFIGURATION_PINS, '--cd', 'C:\\worktrees\\agent-one',
    ]);

    const resumed = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'producer',
      sandbox: 'codex-workspace-write', resumeRef: 'thread-1',
    }), { environment, rootPath: 'C:\\worktrees' });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.args).toEqual([
      'C:\\Users\\service\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      'exec', 'resume', 'thread-1', '-', '--json', '-c', 'model=gpt-5.4',
      '-c', 'sandbox_mode="workspace-write"', ...CODEX_CONFIGURATION_PINS,
    ]);
    expect(resumed.value.args).not.toContain('--cd');
    // `exec resume` takes no `-s` flag at all; the mode rides the config key that flag sets.
    expect(resumed.value.args).not.toContain('-s');
  });

  /**
   * THE CODEX CAP, ported from the Linux broker (5996b9c6, `buildBrokerLaunch` in
   * pty/fdPinnedPaths.ts). Codex takes no `--allowedTools`, so before this the profile name selected
   * NOTHING that reached a Windows child: `-s workspace-write` was a hardcoded literal and
   * `checker-readonly` and `producer` produced byte-identical argv, both with `approval_policy=never`.
   * The review stages of orgs/faceless-youtube/workflows/iteration-loop-demo.md declare
   * `workflowProfile: checker-readonly` with work orders reading "Read only ... Never edit the
   * artifact" — on this machine, the one the fleet actually runs on, they launched with unattended
   * write and command execution across the worktree, held read-only by prose alone.
   */
  it('derives the Codex sandbox from the named profile on every branch', () => {
    const sandboxFor = (toolPolicyId: string, branch: 'fresh' | 'resume' | 'interactive'): string => {
      const launch = mapWindowsLaunchRecipe(baseRequest({
        launcher: 'codex', mode: branch === 'interactive' ? 'interactive' : 'headless-json',
        model: 'gpt-5.4', toolPolicyId, sandbox: 'codex-workspace-write',
        ...(branch === 'resume' ? { resumeRef: 'thread-1' } : {}),
      }), { environment, rootPath: 'C:\\worktrees' });
      expect(launch.ok).toBe(true);
      if (!launch.ok) throw new Error(`refused ${toolPolicyId}/${branch}`);
      const { args } = launch.value;
      const flag = args.indexOf('-s');
      if (flag !== -1) return args[flag + 1] as string;
      // `exec resume` has no `-s`, so it spells the same answer as the config key that flag sets.
      const pinned = args.find((entry, index) => args[index - 1] === '-c' && entry.startsWith('sandbox_mode='));
      expect(pinned).toBeDefined();
      return (pinned as string).slice('sandbox_mode='.length).replaceAll('"', '');
    };

    // The two ends of the table, on all three branches, which may never disagree with each other.
    for (const branch of ['fresh', 'resume', 'interactive'] as const) {
      expect(sandboxFor('checker-readonly', branch)).toBe('read-only');
      expect(sandboxFor('producer', branch)).toBe('workspace-write');
    }
    // Every server-owned profile, on every branch, and the SAME verdict the shared derivation gives —
    // `danger-full-access` is unreachable from the Windows launcher under any of them.
    for (const profile of WORKFLOW_EXECUTION_PROFILES) {
      const mode = codexSandboxMode(profile.allowedTools);
      expect(['read-only', 'workspace-write']).toContain(mode);
      for (const branch of ['fresh', 'resume', 'interactive'] as const) {
        expect(sandboxFor(profile.id, branch)).toBe(mode);
      }
    }
  });

  /**
   * Codex is last-wins on `-c`, so `CODEX_CONFIGURATION_PINS` — `approval_policy=never`,
   * `mcp_servers={}`, `sandbox_workspace_write.network_access=false`, `web_search="disabled"` — is only
   * un-overridable while it is the LAST `-c` group in argv. Deriving the sandbox added a
   * `-c sandbox_mode=` to the resume branch, which is exactly the kind of edit that can slide in after
   * the pins.
   */
  it('keeps the pinned Codex configuration last in every Windows Codex branch', () => {
    const branches = [
      { mode: 'headless-json', resumeRef: undefined, trailing: ['--cd', 'C:\\worktrees\\agent-one'] },
      { mode: 'headless-json', resumeRef: 'thread-1', trailing: [] },
      { mode: 'interactive', resumeRef: undefined, trailing: ['-C', 'C:\\worktrees\\agent-one'] },
    ] as const;
    for (const branch of branches) {
      for (const toolPolicyId of ['checker-readonly', 'producer']) {
        const launch = mapWindowsLaunchRecipe(baseRequest({
          launcher: 'codex', mode: branch.mode, model: 'gpt-5.4', toolPolicyId,
          sandbox: 'codex-workspace-write', ...(branch.resumeRef ? { resumeRef: branch.resumeRef } : {}),
        }), { environment, rootPath: 'C:\\worktrees' });
        expect(launch.ok).toBe(true);
        if (!launch.ok) return;
        const { args } = launch.value;
        // Only `--cd`/`-C <cwd>` may follow the pins, and nothing else may.
        const tail = branch.trailing.length === 0 ? args : args.slice(0, -branch.trailing.length);
        expect(tail.slice(-CODEX_CONFIGURATION_PINS.length)).toEqual([...CODEX_CONFIGURATION_PINS]);
        expect(args.slice(args.length - branch.trailing.length)).toEqual([...branch.trailing]);
        // Every `-c` the branch adds of its own sits BEFORE the pins.
        const lastPin = args.lastIndexOf('web_search="disabled"');
        expect(args.slice(lastPin + 1).some((value) => value === '-c')).toBe(false);
      }
    }
  });

  /**
   * FAILING CLOSED. `POLICY_RE` only says the id is spellable on the wire; `research-v2` passes it and
   * names nothing server-owned. Carrying on with a default would mean handing the more permissive
   * sandbox to exactly the ids nobody approved, so the launch is refused instead — the same verdict
   * `buildBrokerLaunch`'s membership test reaches on Linux.
   */
  it('refuses a Codex recipe naming a spellable but non-server-owned profile', () => {
    expect('research-v2').toMatch(/^[a-z][a-z0-9-]{0,63}$/);
    for (const mode of ['headless-json', 'interactive'] as const) {
      for (const resumeRef of [undefined, 'thread-1'] as const) {
        expect(mapWindowsLaunchRecipe(baseRequest({
          launcher: 'codex', mode, model: 'gpt-5.4', toolPolicyId: 'research-v2',
          sandbox: 'codex-workspace-write', ...(resumeRef ? { resumeRef } : {}),
        }), { environment, rootPath: 'C:\\worktrees' }))
          .toEqual({ ok: false, refusal: 'invalid-request', detail: null });
      }
    }
    // An injected table is refused the same way: a profile absent from it does not fall back.
    expect(mapWindowsLaunchRecipe(baseRequest({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'producer',
      sandbox: 'codex-workspace-write',
    }), {
      environment, rootPath: 'C:\\worktrees',
      claudeProfiles: [{ id: 'checker-readonly', allowedTools: ['Read', 'Glob', 'Grep'] }],
    })).toEqual({ ok: false, refusal: 'invalid-request', detail: null });
  });

  it('refuses invalid closed recipe combinations', () => {
    const result = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'shell', mode: 'headless-json', model: null, toolPolicyId: 'interactive',
      sandbox: 'interactive',
    }), { environment, rootPath: 'C:\\worktrees' });
    expect(result).toEqual({ ok: false, refusal: 'invalid-request', detail: null });
  });

  it.each(['..', '.', 'nested\\..', 'nested\\child', 'C:\\outside', '\\\\server\\share', 'con'])
  ('refuses unsafe or non-portable relative cwd %j', (relativeCwd) => {
    const result = mapWindowsLaunchRecipe({ ...baseRequest(shellRecipe()), relativeCwd }, {
      environment,
      rootPath: 'C:\\worktrees',
    });
    expect(result).toEqual({ ok: false, refusal: 'invalid-request', detail: null });
  });

  it('holds every executable chain pin across spawn and rejects a changed file id', async () => {
    const pinned: string[] = [];
    const released: string[] = [];
    let changedPath: string | null = null;
    const launch = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'producer',
      sandbox: 'codex-workspace-write',
    }), { environment, rootPath: 'C:\\worktrees' });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const result = await pinWindowsLauncher(launch.value, {
      async pin(path) {
        pinned.push(path);
        return {
          path,
          fileId: `volume:${pinned.length}`,
          canonicalPath: path,
          ownerSid: 'S-1-5-18',
          unsafeWriteAce: false,
          async currentFileId() { return changedPath === path ? 'replacement' : `volume:${pinned.indexOf(path) + 1}`; },
          async close() { released.push(path); },
        };
      },
      async readText() { return '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*'; },
    }, 'S-1-5-21-service', 'win32');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pinned).toContain('C:\\Program Files\\nodejs\\node.exe');
    expect(pinned).toContain('C:\\Users\\service\\AppData\\Roaming\\npm\\codex.cmd');
    expect(pinned).toContain('C:\\Users\\service\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js');
    for (const path of pinned) {
      changedPath = path;
      await expect(result.value.recheck(), `replacement barrier for ${path}`).resolves.toBe(false);
    }
    changedPath = null;
    await expect(result.value.recheck()).resolves.toBe(true);
    await result.value.release();
    expect(released).toEqual([...pinned].reverse());
  });

  it('refuses an unsafe owner or write ACE and releases all earlier pins', async () => {
    const launch = mapWindowsLaunchRecipe(baseRequest(shellRecipe()), {
      environment,
      rootPath: 'C:\\worktrees',
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const released: string[] = [];
    const result = await pinWindowsLauncher(launch.value, {
      async pin(path) {
        return {
          path,
          fileId: path,
          canonicalPath: path,
          ownerSid: path === launch.value.file ? 'S-1-5-32-545' : 'S-1-5-18',
          unsafeWriteAce: false,
          async currentFileId() { return path; },
          async close() { released.push(path); },
        };
      },
      async readText() { return ''; },
    }, 'S-1-5-21-service', 'win32');
    expect(result).toEqual({ ok: false, refusal: 'launcher-unavailable', detail: null });
    expect(released).toContain(launch.value.file);
  });

  it.each([
    '\\\\server\\share',
    '\\\\.\\C:\\repo',
    '\\\\?\\C:\\repo',
  ])('refuses a non-local approved root %j', (rootPath) => {
    const result = mapWindowsLaunchRecipe(baseRequest(shellRecipe()), { environment, rootPath });
    expect(result).toEqual({ ok: false, refusal: 'invalid-request', detail: null });
  });

  it('refuses an 8.3 alias after comparing the pinned canonical long path', async () => {
    const launch = mapWindowsLaunchRecipe(baseRequest(shellRecipe()), {
      environment,
      rootPath: 'C:\\WORKTR~1',
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const result = await pinWindowsLauncher(launch.value, {
      async pin(path) {
        return {
          path,
          fileId: path,
          canonicalPath: path.replace('WORKTR~1', 'worktrees'),
          ownerSid: 'S-1-5-18',
          unsafeWriteAce: false,
          async currentFileId() { return path; },
          async close() {},
        };
      },
      async readText() { return ''; },
    }, 'S-1-5-21-service', 'win32');
    expect(result).toEqual({ ok: false, refusal: 'unsafe-root', detail: null });
  });

  it('refuses a reparse-point component beneath the approved cwd root', async () => {
    const launch = mapWindowsLaunchRecipe(baseRequest(shellRecipe()), {
      environment,
      rootPath: 'C:\\worktrees',
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const result = await pinWindowsLauncher(launch.value, {
      async pin(path) {
        if (path.endsWith('agent-one')) throw new Error('reparse point');
        return {
          path,
          fileId: path,
          canonicalPath: path,
          ownerSid: 'S-1-5-18',
          unsafeWriteAce: false,
          async currentFileId() { return path; },
          async close() {},
        };
      },
      async readText() { return ''; },
    }, 'S-1-5-21-service', 'win32');
    expect(result).toEqual({ ok: false, refusal: 'unsafe-root', detail: null });
  });

  // W1d: no `platform` argument is passed here, so the pin speaks for the real machine on both
  // platforms. On win32 the real Win32 inspector pins the live cmd chain; off win32 the inspector
  // cannot be constructed at all and the pin refuses closed without consulting one.
  it('pins the real cmd chain with no-delete-sharing handles and native ACL checks', async () => {
    const onWindows = process.platform === 'win32';
    const liveEnvironment = process.env as Record<string, string | undefined>;
    const launch = mapWindowsLaunchRecipe({ ...baseRequest(shellRecipe()), relativeCwd: '' }, {
      environment: onWindows ? liveEnvironment : environment,
      rootPath: onWindows ? process.cwd() : 'C:\\worktrees',
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) throw new Error('the shell recipe must map on both platforms');
    const systemRoot = (onWindows ? liveEnvironment.SystemRoot : environment.SystemRoot) as string;
    const cmdChain = {
      ...launch.value,
      validationPaths: launch.value.validationPaths.filter((path) =>
        path.toLocaleLowerCase('en-US').startsWith(systemRoot.toLocaleLowerCase('en-US'))),
    };
    expect(cmdChain.validationPaths.length).toBeGreaterThan(0);

    const touched: string[] = [];
    const unreachable: WindowsPathPinInspector = {
      async pin(path) { touched.push(path); throw new Error('off win32 nothing may be pinned'); },
      async readText(path) { touched.push(path); return ''; },
    };
    const construct = (): WindowsPathPinInspector => createWindowsPathPinInspector();
    if (onWindows) expect(construct()).toMatchObject({ pin: expect.any(Function) });
    else expect(construct).toThrow(WindowsPlatformUnsupportedError);
    const inspector = onWindows ? construct() : unreachable;

    const inspected: WindowsPinnedPath[] = [];
    for (const path of onWindows ? cmdChain.validationPaths : []) {
      const pin = await inspector.pin(path);
      inspected.push(pin);
      expect(pin).toMatchObject({ path, unsafeWriteAce: false });
    }
    expect(inspected.length).toBe(onWindows ? cmdChain.validationPaths.length : 0);
    for (const pin of inspected.reverse()) await pin.close();

    const pinned = await pinWindowsLauncher(
      cmdChain,
      inspector,
      CURRENT_PROCESS_SERVICE_SID,
    );
    expect(pinned).toMatchObject(onWindows
      ? { ok: true }
      : { ok: false, refusal: 'launcher-unavailable', detail: null });
    if (pinned.ok) {
      await expect(pinned.value.recheck()).resolves.toBe(true);
      await pinned.value.release();
    }
    // Off win32 the refusal precedes the inspector entirely: no path was pinned or read.
    expect(touched).toEqual([]);
  });

  it('refuses to pin on a non-win32 platform without touching the inspector', async () => {
    const touched: string[] = [];
    const launch = mapWindowsLaunchRecipe(baseRequest(shellRecipe()), {
      environment, rootPath: 'C:\\worktrees',
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) throw new Error('the shell recipe must map');
    const result = await pinWindowsLauncher(launch.value, {
      async pin(path) { touched.push(path); throw new Error('unreachable'); },
      async readText(path) { touched.push(path); return ''; },
    }, 'S-1-5-21-service', 'linux');
    expect(result).toEqual({ ok: false, refusal: 'launcher-unavailable', detail: null });
    expect(touched).toEqual([]);
  });
});

function shellRecipe(): LaunchRecipe {
  return { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'interactive', sandbox: 'interactive' };
}

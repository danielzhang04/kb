import { describe, expect, it } from 'vitest';

import type { LaunchRecipe, SessionHostRequest } from './contracts.ts';
import {
  CODEX_CONFIGURATION_PINS,
  CURRENT_PROCESS_SERVICE_SID,
  createWindowsChildEnv,
  createWindowsPathPinInspector,
  deriveWindowsLauncherPaths,
  mapWindowsLaunchRecipe,
  pinWindowsLauncher,
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
      '--allowedTools', 'Read,Edit', '--permission-mode', 'default',
    ]);
  });

  it('maps Codex fresh and resume recipes to the one pinned argv table', () => {
    const fresh = mapWindowsLaunchRecipe(baseRequest({
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'codex-default',
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
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'codex-default',
      sandbox: 'codex-workspace-write', resumeRef: 'thread-1',
    }), { environment, rootPath: 'C:\\worktrees' });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.args).toEqual([
      'C:\\Users\\service\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      'exec', 'resume', 'thread-1', '-', '--json', '-c', 'model=gpt-5.4',
      ...CODEX_CONFIGURATION_PINS,
    ]);
    expect(resumed.value.args).not.toContain('--cd');
    expect(resumed.value.args).not.toContain('-s');
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
      launcher: 'codex', mode: 'headless-json', model: 'gpt-5.4', toolPolicyId: 'codex-default',
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
    }, 'S-1-5-21-service');
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
    }, 'S-1-5-21-service');
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
    }, 'S-1-5-21-service');
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
    }, 'S-1-5-21-service');
    expect(result).toEqual({ ok: false, refusal: 'unsafe-root', detail: null });
  });

  it('pins the real cmd chain with no-delete-sharing handles and native ACL checks', async () => {
    const liveEnvironment = process.env as Record<string, string | undefined>;
    const launch = mapWindowsLaunchRecipe({ ...baseRequest(shellRecipe()), relativeCwd: '' }, {
      environment: liveEnvironment,
      rootPath: process.cwd(),
    });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    const systemRoot = liveEnvironment.SystemRoot as string;
    const cmdChain = {
      ...launch.value,
      validationPaths: launch.value.validationPaths.filter((path) =>
        path.toLocaleLowerCase('en-US').startsWith(systemRoot.toLocaleLowerCase('en-US'))),
    };
    const inspector = createWindowsPathPinInspector();
    const inspected = [];
    for (const path of cmdChain.validationPaths) {
      const pin = await inspector.pin(path);
      inspected.push(pin);
      expect(pin).toMatchObject({ path, unsafeWriteAce: false });
    }
    for (const pin of inspected.reverse()) await pin.close();
    const pinned = await pinWindowsLauncher(
      cmdChain,
      inspector,
      CURRENT_PROCESS_SERVICE_SID,
    );
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    await expect(pinned.value.recheck()).resolves.toBe(true);
    await pinned.value.release();
  });
});

function shellRecipe(): LaunchRecipe {
  return { launcher: 'shell', mode: 'interactive', model: null, toolPolicyId: 'interactive', sandbox: 'interactive' };
}

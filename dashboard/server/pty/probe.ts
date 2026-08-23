import { access } from 'node:fs/promises';

import type {
  PtyCapabilityProbe, PtyProbeReason, PublicPtyCapability, SessionLauncher,
} from './contracts.ts';
import {
  createWindowsLauncherProbeProfile,
  deriveWindowsLauncherPaths,
  pinWindowsLauncher,
  type WindowsLaunchRecipeOptions,
  type WindowsPathPinInspector,
} from './launcherProfiles.ts';

type NodePtySurface = { spawn: (...args: never[]) => unknown };
type LauncherProbeResult =
  | { ok: true; launchers: SessionLauncher[] }
  | { ok: false; reason?: 'shell-unavailable' | 'root-policy-invalid' | 'launcher-unavailable' };

export type WindowsPtyProbeOptions = {
  now?: () => Date;
  epochId: string;
  /**
   * The host platform this probe speaks for. Defaults to the running platform; a unit test that
   * simulates a Windows machine through injected seams declares `'win32'` explicitly. Any other
   * value means there is no local Windows PTY to load, so the probe refuses before touching one.
   */
  platform?: NodeJS.Platform;
  environment?: Record<string, string | undefined>;
  roots?: { repo: string; worktrees: string };
  pathInspector?: WindowsPathPinInspector;
  serviceSid?: string;
  launchOptions?: Omit<WindowsLaunchRecipeOptions, 'environment' | 'rootPath'>;
  loadNodePty?: () => Promise<NodePtySurface | null>;
  accessPath?: (path: string) => Promise<void>;
  probeLaunchers?: () => Promise<LauncherProbeResult>;
  probeRoots?: () => Promise<boolean>;
};

async function defaultLoadNodePty(): Promise<NodePtySurface | null> {
  try {
    const loaded = await import('node-pty');
    return typeof loaded.spawn === 'function' ? loaded as unknown as NodePtySurface : null;
  } catch {
    return null;
  }
}

async function defaultProbeLaunchPolicy(
  options: WindowsPtyProbeOptions,
): Promise<LauncherProbeResult> {
  const environment = options.environment ?? process.env;
  const roots = options.roots;
  const inspector = options.pathInspector;
  if (roots === undefined || inspector === undefined || !options.serviceSid) {
    return { ok: false, reason: 'root-policy-invalid' };
  }
  const paths = deriveWindowsLauncherPaths(environment);
  const accessPath = options.accessPath ?? access;
  try { await accessPath(paths.shell); } catch { return { ok: false, reason: 'shell-unavailable' }; }
  const launchers: SessionLauncher[] = ['shell'];
  try { await accessPath(paths.claude); launchers.push('claude'); } catch { /* optional */ }
  try {
    await Promise.all([accessPath(paths.codexShim), accessPath(paths.codexEntry), accessPath(paths.node)]);
    launchers.push('codex');
  } catch { /* optional */ }

  for (const rootPath of [roots.repo, roots.worktrees]) {
    for (const launcher of launchers) {
      const profile = createWindowsLauncherProbeProfile(launcher, environment, rootPath);
      if (!profile.ok) return { ok: false, reason: 'root-policy-invalid' };
      const pinned = await pinWindowsLauncher(
        profile.value, inspector, options.serviceSid, options.platform ?? process.platform,
      );
      if (!pinned.ok) {
        return { ok: false, reason: pinned.refusal === 'unsafe-root'
          ? 'root-policy-invalid'
          : 'launcher-unavailable' };
      }
      try {
        if (!await pinned.value.recheck()) return { ok: false, reason: 'launcher-unavailable' };
      } finally {
        await pinned.value.release();
      }
    }
  }
  return { ok: true, launchers };
}

function unavailable(reason: PtyProbeReason, checkedAt: string): PtyCapabilityProbe {
  return {
    available: false, host: 'desktop', transport: 'local-node-pty',
    reason, detail: null, checkedAt,
  };
}

/** A closed Windows capability probe which runs the same pin/ACL/file-id validator as launch. */
export async function probeWindowsPty(options: WindowsPtyProbeOptions): Promise<PtyCapabilityProbe> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  // A Windows PTY cannot exist off win32: refuse closed before loading node-pty or reaching any
  // Win32 API. `node-pty-unavailable` is the union member for "no local PTY binding here".
  if ((options.platform ?? process.platform) !== 'win32') {
    return unavailable('node-pty-unavailable', checkedAt);
  }
  let nodePty: NodePtySurface | null;
  try {
    nodePty = await (options.loadNodePty ?? defaultLoadNodePty)();
  } catch {
    return unavailable('node-pty-unavailable', checkedAt);
  }
  if (nodePty === null || typeof nodePty.spawn !== 'function') {
    return unavailable('node-pty-unavailable', checkedAt);
  }
  if (options.probeRoots !== undefined) {
    try {
      if (!await options.probeRoots()) return unavailable('root-policy-invalid', checkedAt);
    } catch {
      return unavailable('root-policy-invalid', checkedAt);
    }
  }
  let launchers: LauncherProbeResult;
  try {
    launchers = await (options.probeLaunchers?.() ?? defaultProbeLaunchPolicy(options));
  } catch {
    return unavailable('launcher-unavailable', checkedAt);
  }
  if (!launchers.ok) return unavailable(launchers.reason ?? 'shell-unavailable', checkedAt);
  if (launchers.launchers[0] !== 'shell') return unavailable('shell-unavailable', checkedAt);
  return {
    available: true, host: 'desktop', transport: 'local-node-pty',
    launchers: [...new Set(launchers.launchers)], roots: ['repo', 'worktrees'],
    epochId: options.epochId, checkedAt,
  };
}

export function toPublicPtyCapability(probe: PtyCapabilityProbe): PublicPtyCapability {
  if (!probe.available) {
    return { pty: false, diagnostic: {
      reason: probe.reason, detail: probe.detail, checkedAt: probe.checkedAt,
    } };
  }
  return {
    pty: true, host: probe.host, launchers: [...probe.launchers], roots: [...probe.roots],
    checkedAt: probe.checkedAt,
  };
}

export const probeWindowsSessionHost = probeWindowsPty;

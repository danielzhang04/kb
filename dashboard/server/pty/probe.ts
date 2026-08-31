import { access } from 'node:fs/promises';

import type {
  DroppedLauncher, PtyCapabilityProbe, PtyProbeReason, PublicPtyCapability, SessionLauncher,
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
  | { ok: true; launchers: SessionLauncher[]; dropped?: DroppedLauncher[] }
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

  // A launcher whose own tree cannot be pinned is DROPPED, exactly as a launcher whose files are
  // absent is dropped above: `claude`/`codex` are optional, so an unpinnable optional tree must not
  // take the shell (and with it the whole terminal) down with it. What is never dropped is a ROOT
  // refusal — `unsafe-root` says the approved root itself is writable by an untrusted principal,
  // which is true for every launcher, so the probe fails closed for the whole host. The advertised
  // set is therefore exactly the set that pinned; capability can never name a launcher the pin
  // validator refuses, and launch re-pins the same paths anyway.
  //
  // A drop is never SILENT. Every refusal is recorded against its launcher and travels out with the
  // available probe, because "the terminal offers shell only" and "someone put a write ACE on your
  // Claude binary" are different truths and the operator has no other way to tell them apart.
  const refused = new Map<SessionLauncher, DroppedLauncher['refusal']>();
  for (const rootPath of [roots.repo, roots.worktrees]) {
    for (const launcher of launchers) {
      if (refused.has(launcher)) continue;
      const drop = (refusal: DroppedLauncher['refusal']): LauncherProbeResult | null => {
        if (launcher === 'shell') return { ok: false, reason: 'launcher-unavailable' };
        refused.set(launcher, refusal);
        return null;
      };
      const profile = createWindowsLauncherProbeProfile(launcher, environment, rootPath);
      if (!profile.ok) {
        // Only a bad approved root or a missing service root reaches here; for the shell that is the
        // root policy itself, for an optional launcher it is that launcher's own missing service root.
        if (launcher === 'shell') return { ok: false, reason: 'root-policy-invalid' };
        refused.set(launcher, 'launcher-profile-invalid');
        continue;
      }
      const pinned = await pinWindowsLauncher(
        profile.value, inspector, options.serviceSid, options.platform ?? process.platform,
      );
      if (!pinned.ok) {
        if (pinned.refusal === 'unsafe-root') return { ok: false, reason: 'root-policy-invalid' };
        const refusal = drop('launcher-unavailable');
        if (refusal !== null) return refusal;
        continue;
      }
      let rechecked: boolean;
      try {
        rechecked = await pinned.value.recheck();
      } finally {
        await pinned.value.release();
      }
      if (!rechecked) {
        // The launcher's file identity moved between pin and recheck: a swap under our own handles.
        const refusal = drop('launcher-changed');
        if (refusal !== null) return refusal;
      }
    }
  }
  const advertised = launchers.filter((launcher) => !refused.has(launcher));
  const dropped: DroppedLauncher[] = [...refused].map(([launcher, refusal]) => ({ launcher, refusal }));
  return dropped.length === 0
    ? { ok: true, launchers: advertised }
    : { ok: true, launchers: advertised, dropped };
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
  const dropped = launchers.dropped ?? [];
  return {
    available: true, host: 'desktop', transport: 'local-node-pty',
    launchers: [...new Set(launchers.launchers)], roots: ['repo', 'worktrees'],
    epochId: options.epochId, checkedAt,
    ...(dropped.length === 0 ? {} : { droppedLaunchers: dropped }),
  };
}

const PUBLIC_DETAIL_MAX_BYTES = 160;
const PUBLIC_DETAIL_ENCODER = new TextEncoder();

/**
 * P3 §3's detail rule is enforced HERE, at the publish boundary, not only in the browser decoder: a
 * host detail becomes one line of at most 160 UTF-8 bytes or nothing at all, so an oversized or
 * multi-line detail from a real host probe never crosses the wire into a log or a devtools pane.
 * Truncation stops on a whole code point, so the published bytes are always valid UTF-8.
 */
export function sanitizePublicPtyDetail(detail: string | null): string | null {
  if (detail === null) return null;
  const singleLine = detail.replace(/[\r\n]+/g, ' ').trim();
  if (singleLine === '') return null;
  if (PUBLIC_DETAIL_ENCODER.encode(singleLine).length <= PUBLIC_DETAIL_MAX_BYTES) return singleLine;
  let bytes = 0;
  let truncated = '';
  for (const character of singleLine) {
    const size = PUBLIC_DETAIL_ENCODER.encode(character).length;
    if (bytes + size > PUBLIC_DETAIL_MAX_BYTES) break;
    bytes += size;
    truncated += character;
  }
  return truncated === '' ? null : truncated;
}

export function toPublicPtyCapability(probe: PtyCapabilityProbe): PublicPtyCapability {
  if (!probe.available) {
    return { pty: false, diagnostic: {
      reason: probe.reason, detail: sanitizePublicPtyDetail(probe.detail), checkedAt: probe.checkedAt,
    } };
  }
  // The drop record crosses the publish boundary as the CLOSED pair it already is — launcher id plus
  // refusal code, no path, no ACL, no SID — so a tampered launcher is visible to the operator without
  // handing the browser (or a log) the attacker's own filenames.
  const dropped = probe.droppedLaunchers ?? [];
  return {
    pty: true, host: probe.host, launchers: [...probe.launchers], roots: [...probe.roots],
    checkedAt: probe.checkedAt,
    ...(dropped.length === 0
      ? {}
      : { droppedLaunchers: dropped.map(({ launcher, refusal }) => ({ launcher, refusal })) }),
  };
}

export const probeWindowsSessionHost = probeWindowsPty;

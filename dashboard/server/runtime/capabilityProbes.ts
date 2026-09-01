// P6 W6.3: the CONCRETE implementations of `capabilitySources.ts`'s five injected probe ports. That
// module has existed since W3 with the port shape and the fail-closed overlay but no implementation, so
// every advertisement carried `runtimeHostCapabilities`' closed defaults — no skills, both CLIs `missing`.
// That is not merely conservative: `placement/requirements.ts` derives a `clis` requirement from every
// assigned agent's declared `runtime`, so a permanently-`missing` advertisement makes EVERY agent and
// workflow launch refuse `409 no-complete-placement` even once a host is advertising.
//
// Every probe here answers about THIS host and nothing else. Where the daemon has no honest host-level
// signal (connectors, gpu) the probe returns explicit emptiness with the reason, rather than inventing
// one — a fabricated `ready` is worse than a `missing`, because it routes work to a host that cannot run it.
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { LINUX_CLI_LAUNCHERS } from '../pty/fdPinnedPaths.ts';
import { deriveWindowsLauncherPaths } from '../pty/launcherProfiles.ts';
import { indexSkills } from '../registry/skills.ts';
import { CANONICAL_ID, MAX_FILESYSTEM_ROOTS, MAX_SKILLS, type CliStatus } from '../placement/contracts.ts';
import { CLOSED_CLIS } from './capabilities.ts';
import type { CapabilitySourcePorts } from './capabilitySources.ts';
import type { PublicPtyCapability } from '../pty/contracts.ts';

/** `fs.promises.access`, injectable so a test drives a host layout it does not have to create. */
export type AccessPort = (path: string, mode?: number) => Promise<void>;

/**
 * Every file that must be reachable for ONE CLI launcher to work, per platform. This is deliberately the
 * launcher's own path set, not a PATH lookup: `pty/fdPinnedPaths.ts` and `pty/launcherProfiles.ts` both
 * exec an absolute pinned path and never consult PATH, so a PATH-resolved `claude` would advertise
 * `ready` for a binary the daemon would never run. Windows mirrors `pty/probe.ts:57-65` exactly, where
 * `codex` needs the shim, the package entry point, AND node — it is launched as `node codex.js`.
 * `null` means "this host's launcher layout could not even be derived", which is a closed answer.
 */
export function cliLauncherPaths(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): { readonly claude: readonly string[]; readonly codex: readonly string[] } | null {
  if (platform !== 'win32') {
    return { claude: [LINUX_CLI_LAUNCHERS.claude], codex: [LINUX_CLI_LAUNCHERS.codex] };
  }
  try {
    const paths = deriveWindowsLauncherPaths(env);
    return { claude: [paths.claude], codex: [paths.codexShim, paths.codexEntry, paths.node] };
  } catch {
    // A service environment missing SystemRoot/USERPROFILE/APPDATA cannot name its launchers at all.
    return null;
  }
}

/**
 * `ready` iff every file that launcher execs is present and executable; `missing` otherwise.
 *
 * `login-required` is never emitted: the daemon has no way to observe a CLI's auth state without running
 * it, and `match()` treats `login-required` exactly like `missing` anyway, so guessing would add a
 * distinction with no consumer. A logged-out CLI therefore advertises `ready` and fails at run time —
 * the same failure the launcher already surfaces, not a new one this probe introduced.
 */
export async function probeCliStatuses(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  access?: AccessPort;
}): Promise<{ claude: CliStatus; codex: CliStatus }> {
  const paths = cliLauncherPaths(options.platform ?? process.platform, options.env ?? process.env);
  if (paths === null) return { ...CLOSED_CLIS };
  const accessPath = options.access ?? access;
  const reachable = async (files: readonly string[]): Promise<CliStatus> => {
    try {
      // X_OK is a no-op on Windows (it degrades to an existence check), which is the same question
      // `pty/probe.ts` asks there.
      await Promise.all(files.map((file) => accessPath(file, fsConstants.X_OK)));
      return 'ready';
    } catch {
      return 'missing';
    }
  };
  const [claude, codex] = await Promise.all([reachable(paths.claude), reachable(paths.codex)]);
  return { claude, codex };
}

/** Sorted, unique, canonical, bounded — the exact shape `decodeHostAdvertisement` will accept. */
function canonicalIdList(values: readonly string[], max: number): string[] {
  const unique = [...new Set(values.filter((value) => CANONICAL_ID.test(value)))].sort();
  // Truncation, not refusal: a host with 300 skills must still advertise, and this list is a capability
  // claim — advertising fewer skills than are installed can only make placement more conservative.
  return unique.slice(0, max);
}

/**
 * The skills this host actually carries, from the repo catalog under the daemon's own `repoRoot`, via
 * the EXISTING scanner (`registry/skills.ts`) rather than a second directory walk. The slug (the
 * `skills/<tier>/<slug>/` directory name) is the id; a slug outside the canonical charset is dropped
 * rather than allowed to throw the whole beat.
 */
export function probeRepoSkills(
  repoRoot: string,
  indexer: (root: string) => { items: ReadonlyArray<{ slug: string }> } = indexSkills,
): string[] {
  return canonicalIdList(indexer(repoRoot).items.map((item) => item.slug), MAX_SKILLS);
}

/**
 * The symbolic filesystem roots this host can actually open a session in — the composed PTY capability's
 * OWN `roots`, read off its discriminant exactly as `pty` is. A host with no terminal can start no
 * session, so it grants no root: the closed branch is empty, never a guess about what exists on disk.
 */
export function probeFilesystemRoots(pty: PublicPtyCapability): string[] {
  return pty.pty ? canonicalIdList(pty.roots, MAX_FILESYSTEM_ROOTS) : [];
}

export interface CapabilityProbeOptions {
  repoRoot: string;
  /** The ONE composition-time PTY probe result; roots are read off it, never re-derived. */
  pty: PublicPtyCapability;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  access?: AccessPort;
  indexSkillsFor?: (root: string) => { items: ReadonlyArray<{ slug: string }> };
}

/**
 * The production port set handed to `probeAdvertisementCapabilities`. All five ports are supplied
 * explicitly — including the two that are constant — so the advertisement's emptiness is a stated
 * answer with a reason attached, not the accident of an unwired port.
 */
export function productionCapabilitySourcePorts(options: CapabilityProbeOptions): CapabilitySourcePorts {
  return {
    probeClis: async () => probeCliStatuses({
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.access ? { access: options.access } : {}),
    }),
    probeSkills: async () => probeRepoSkills(
      options.repoRoot,
      options.indexSkillsFor ?? indexSkills,
    ),
    probeFilesystemRoots: async () => probeFilesystemRoots(options.pty),
    // EXPLICIT emptiness, not an unwired port. A connector is MCP wiring the CLI loads per project from
    // `orgs/<project>/.claude/settings.json` (`registry/connections.ts` reads exactly that) — it is not
    // something this host provides, so the host cannot honestly claim it. Advertising the union of every
    // project's declared servers would claim capability the daemon does not own. No agent or workflow in
    // the repo declares `connectors` today, so the requirement side is empty too and nothing is blocked;
    // when one does, the answer is a real host-side connector probe, not this list.
    probeConnectors: async () => [],
    // EXPLICIT emptiness: there is no GPU on either host and no `gpu` declaration source anywhere —
    // `placement/requirements.ts` hard-codes `gpu: overrides.gpu ?? false` because no agent or workflow
    // field names one, so nothing can require it and a probe would have no consumer.
    probeGpu: async () => false,
  };
}

// P6 W6.3: the CONCRETE implementations of `capabilitySources.ts`'s five injected probe ports. That
// module has existed since W3 with the port shape and the fail-closed overlay but no implementation, so
// every advertisement carried `runtimeHostCapabilities`' closed defaults — no skills, both CLIs `missing`.
// That is not merely conservative: `placement/requirements.ts` derives a `clis` requirement from every
// assigned agent's declared `runtime`, so a permanently-`missing` advertisement makes EVERY agent and
// workflow launch refuse `409 no-complete-placement` even once a host is advertising.
//
// Every value here answers about THIS host and nothing else. Where the daemon has no honest host-level
// signal (connectors, gpu) the port returns explicit emptiness with the reason, rather than inventing
// one — a fabricated `ready` is worse than a `missing`, because it routes work to a host that cannot run it.
import { indexSkills } from '../registry/skills.ts';
import { CANONICAL_ID, MAX_FILESYSTEM_ROOTS, MAX_SKILLS, type CliStatus } from '../placement/contracts.ts';
import { CLOSED_CLIS } from './capabilities.ts';
import type { CapabilitySourcePorts } from './capabilitySources.ts';
import type { PublicPtyCapability } from '../pty/contracts.ts';

/**
 * CLI readiness read off the composed PTY capability's OWN `launchers` — never a filesystem probe of the
 * daemon's own. This is the only honest source available here, because on each platform `launchers` was
 * already resolved by the party that will actually run the binary:
 *
 *  - Linux: the broker resolved it, and the broker runs AS `kb-shell`. The daemon (`kb-dashboard`) cannot
 *    answer this question itself — `/var/lib/kb-shell/home` is mode 0700 `kb-shell` by DELIBERATE design
 *    (`deploy/install_pty_broker.py`), so an `fs.access` from the daemon returns EACCES for an installed
 *    CLI and would advertise `missing` forever. It would also be answering "can kb-dashboard exec this"
 *    when the question is "can kb-shell exec this".
 *  - Windows: `pty/probe.ts` already ran the launcher-path access probes as the daemon's own user, which
 *    IS the principal that launches there.
 *
 * GRANULARITY CONSEQUENCE on Linux, by design and worth knowing: `pty/brokerProbe.ts` accepts the broker
 * only when its launcher set is EXACTLY `shell,claude,codex`; anything else is a
 * `broker-identity-mismatch` and the whole PTY capability comes back unavailable. So a VM either has the
 * full launcher set (both CLIs `ready`) or no terminal at all (both `missing`) — a partial CLI install is
 * not a state the VM can be in. Windows is genuinely per-launcher: `claude` and `codex` are optional there
 * and are dropped individually, so a desktop CAN advertise one and not the other.
 *
 * `login-required` is never emitted: nothing observable to the daemon distinguishes a logged-out CLI from
 * a logged-in one, and `match()` treats `login-required` exactly like `missing`, so guessing would add a
 * distinction with no consumer.
 */
export function advertisedCliStatuses(pty: PublicPtyCapability): { claude: CliStatus; codex: CliStatus } {
  // No terminal means no launcher probe ran at all, so there is nothing to claim. This CONSUMES the
  // probed capability; the discriminant decides, exactly as it does for `pty` itself.
  if (!pty.pty) return { ...CLOSED_CLIS };
  const launchers = pty.launchers;
  return {
    claude: launchers.includes('claude') ? 'ready' : 'missing',
    codex: launchers.includes('codex') ? 'ready' : 'missing',
  };
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
 *
 * This is the ONE remaining filesystem read in the advertisement path, and it reads the daemon's own
 * checkout — none of the cross-principal permission problem that rules out probing the CLI binaries.
 */
export function probeRepoSkills(
  repoRoot: string,
  indexer: (root: string) => { items: ReadonlyArray<{ slug: string }> } = indexSkills,
): string[] {
  return canonicalIdList(indexer(repoRoot).items.map((item) => item.slug), MAX_SKILLS);
}

/**
 * `probeRepoSkills` plus the one distinction an operator cannot otherwise make: a catalog that is ABSENT
 * (ENOENT — this deployment ships no skills) versus one that is present but UNREADABLE (EACCES/EPERM —
 * skills are installed and INVISIBLE, silently narrowing placement). Both degrade to an empty list, so
 * only the message differs; the composition root decides whether to log it.
 */
export function probeSkillsWithDiagnostics(
  repoRoot: string,
  indexer: (root: string) => { items: ReadonlyArray<{ slug: string }> } = indexSkills,
): { skills: string[]; refusal: string | null } {
  try {
    return { skills: probeRepoSkills(repoRoot, indexer), refusal: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    const detail = code === 'EACCES' || code === 'EPERM'
      ? `skills catalog under ${repoRoot} is present but UNREADABLE (${code}) — installed skills are invisible to placement`
      : `skills catalog under ${repoRoot} could not be read (${code ?? 'unknown'})`;
    return { skills: [], refusal: detail };
  }
}

/**
 * The symbolic filesystem roots this host can actually open a session in — the composed PTY capability's
 * OWN `roots`, read off its discriminant exactly as the CLI statuses are. A host with no terminal can
 * start no session, so it grants no root: the closed branch is empty, never a guess about what is on disk.
 */
export function probeFilesystemRoots(pty: PublicPtyCapability): string[] {
  return pty.pty ? canonicalIdList(pty.roots, MAX_FILESYSTEM_ROOTS) : [];
}

export interface CapabilityProbeOptions {
  repoRoot: string;
  /** The ONE composition-time PTY probe result. CLIs and roots are read off it, never re-derived. */
  pty: PublicPtyCapability;
  indexSkillsFor?: (root: string) => { items: ReadonlyArray<{ slug: string }> };
  /** Called once per composition when the skills catalog could not be read; production logs it. */
  onSkillsRefusal?: (detail: string) => void;
}

/**
 * The production port set handed to `probeAdvertisementCapabilities`. All five ports are supplied
 * explicitly — including the two that are constant — so the advertisement's emptiness is a stated
 * answer with a reason attached, not the accident of an unwired port.
 */
export function productionCapabilitySourcePorts(options: CapabilityProbeOptions): CapabilitySourcePorts {
  return {
    probeClis: async () => advertisedCliStatuses(options.pty),
    probeSkills: async () => {
      const probed = probeSkillsWithDiagnostics(options.repoRoot, options.indexSkillsFor ?? indexSkills);
      if (probed.refusal !== null) options.onSkillsRefusal?.(probed.refusal);
      return probed.skills;
    },
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

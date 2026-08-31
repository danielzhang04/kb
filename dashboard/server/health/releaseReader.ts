// Dashboard v3 P5 — W4 Health release reader (§3.5). Fed by the SAME activation port Home uses
// (`home/project.ts#ActivationReaderPort`) — never a checkout or filesystem read of its own. Bounded by
// the shared `withBudget` wrapper at the §3.5 `release` budget (1000 ms); a timeout, throw, or malformed
// value degrades only this row. No spend field is present.
import { isCommitSha, isDigestSha256 } from '../write/durableManifest.ts';
import type { UnavailableRow } from './service.ts';
import type { ReleaseRow, ReleaseRowValue } from './probeBudget.ts';
import { withBudget, type SchedulerPort } from './machineReaders.ts';

/**
 * A superset of `home/project.ts#ActivationReaderPort`: the same fields plus the two extra ones
 * `ReleaseRow` needs (`archiveSha256`, `rollbackAvailable`). One shared instance built at composition
 * (W6.1 [P5-C30]) can satisfy both this port and Home's — Health never constructs a second reader or
 * touches a checkout path.
 */
export interface ReleaseActivationPort {
  readActivation(): Promise<{
    revision: string;
    label: string;
    sha: string;
    activatedAt: string;
    archiveSha256: string;
    rollbackAvailable: boolean;
  }>;
}

type Activation = Awaited<ReturnType<ReleaseActivationPort['readActivation']>>;

function isValidActivation(value: Activation): boolean {
  return typeof value === 'object' && value !== null
    && isCommitSha(value.sha)
    && isDigestSha256(value.archiveSha256)
    && typeof value.activatedAt === 'string' && value.activatedAt.length > 0
    && typeof value.rollbackAvailable === 'boolean';
}

function unavailableDaemonMachineRow(reason: 'timeout' | 'unavailable' | 'invalid', observedAt: string): UnavailableRow<'daemon-machine'> {
  return { kind: 'unavailable', key: 'error:daemon-machine', label: 'Unavailable', value: { status: 'unavailable', reason }, observedAt, source: 'error' };
}

/** The `ReleaseRow`, bounded at the §3.5 `release` budget. Never reads a checkout path — the injected
 *  activation port is the only input. */
export async function readReleaseRow(
  port: ReleaseActivationPort,
  now: () => string,
  scheduler?: SchedulerPort,
): Promise<ReleaseRow | UnavailableRow<'daemon-machine'>> {
  const observedAt = now();
  const result = await withBudget('release', () => port.readActivation(), { scheduler, validate: isValidActivation });
  if (!result.ok) return unavailableDaemonMachineRow(result.reason, observedAt);
  const { sha, archiveSha256, activatedAt, rollbackAvailable } = result.value;
  const value: ReleaseRowValue = { sha, archiveSha256, activatedAt, rollbackAvailable };
  return { kind: 'release', key: 'release', label: 'Release', value, observedAt, source: 'release' };
}

import type { AttentionEnvelope, RunRow, ScheduleOccurrence } from '../control/p2Contracts.ts';
import type { HomeResponse, HomeSections, RecentOutcomesSectionResult } from './contracts.ts';

export interface VersionedHomeSource<T> {
  read(): Promise<{ revision: string; data: T }>;
}

/** Narrow installed-release seam shared by Home now and the W6.5 Health composition later. */
export interface ActivationReaderPort {
  readActivation(): Promise<{ revision: string; label: string; sha: string; activatedAt: string }>;
}

export interface HomeProjectionPorts {
  runningNow: VersionedHomeSource<readonly RunRow[]>;
  attention: VersionedHomeSource<AttentionEnvelope>;
  inboxCount: VersionedHomeSource<number>;
  nextSchedules: VersionedHomeSource<readonly ScheduleOccurrence[]>;
  activation: ActivationReaderPort;
  recentRuns: VersionedHomeSource<readonly RunRow[]>;
}

type ReadResult<T> = { ok: true; revision: string; data: T } | { ok: false };

async function read<T>(source: VersionedHomeSource<T>): Promise<ReadResult<T>> {
  try {
    const result = await source.read();
    return { ok: true, revision: result.revision, data: result.data };
  } catch {
    return { ok: false };
  }
}

type RecentOutcomes = Extract<RecentOutcomesSectionResult, { state: 'ready' }>['data']['outcomes'];

function recentOutcomes(runs: readonly RunRow[]): RecentOutcomes {
  return runs
    .filter((run): run is RunRow & { outcome: NonNullable<RunRow['outcome']>; completedAt: string } => run.outcome !== null && run.completedAt !== null)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.runRef.localeCompare(right.runRef))
    .slice(0, 10)
    .map(({ runRef, title, completedAt, outcome }) => ({ runRef, title, completedAt, outcome }));
}

/** Projects only source-owned Home data into the closed, ordered D13 response. */
export async function projectHome(ports: HomeProjectionPorts): Promise<HomeResponse> {
  const [running, attention, inbox, schedules, outcomes] = await Promise.all([
    read(ports.runningNow), read(ports.attention), read(ports.inboxCount), read(ports.nextSchedules), read(ports.recentRuns),
  ]);

  let activation: Awaited<ReturnType<ActivationReaderPort['readActivation']>> | null = null;
  try {
    activation = await ports.activation.readActivation();
  } catch {
    // The release reader is intentionally narrow. Its failure affects only the chip.
  }

  const runningSection: HomeSections[0] = running.ok
    ? { state: 'ready', data: { section: 'running-now', runs: [...running.data] } }
    : { state: 'unavailable', reason: 'attention-unavailable' };
  const attentionSection: HomeSections[1] = !attention.ok
    ? { state: 'unavailable', reason: 'attention-unavailable' }
    : !inbox.ok
      ? { state: 'unavailable', reason: 'inbox-unavailable' }
      : {
          state: 'ready',
          data: {
            section: 'attention-counts',
            agents: Object.values(attention.data.agents).reduce((total, count) => total + count, 0),
            workflows: Object.values(attention.data.workflows).reduce((total, count) => total + count, 0),
            inbox: inbox.data,
          },
        };
  const schedulesSection: HomeSections[2] = schedules.ok
    ? { state: 'ready', data: { section: 'next-schedules', occurrences: [...schedules.data].sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor)).slice(0, 3) } }
    : { state: 'unavailable', reason: 'schedules-unavailable' };
  const versionSection: HomeSections[3] = activation
    ? { state: 'ready', data: { section: 'version', label: activation.label, sha: activation.sha, activatedAt: activation.activatedAt } }
    : { state: 'unavailable', reason: 'release-unavailable' };
  const outcomesSection: HomeSections[4] = outcomes.ok
    ? { state: 'ready', data: { section: 'recent-outcomes', outcomes: recentOutcomes(outcomes.data) } }
    : { state: 'unavailable', reason: 'outcomes-unavailable' };
  const sections: HomeSections = [runningSection, attentionSection, schedulesSection, versionSection, outcomesSection];
  const revisions = [
    running.ok ? running.revision : 'unavailable:running',
    attention.ok ? attention.revision : 'unavailable:attention',
    inbox.ok ? inbox.revision : 'unavailable:inbox',
    schedules.ok ? schedules.revision : 'unavailable:schedules',
    activation?.revision ?? 'unavailable:release',
    outcomes.ok ? outcomes.revision : 'unavailable:outcomes',
  ];

  return { revision: `home:${revisions.join(':')}`, sections };
}

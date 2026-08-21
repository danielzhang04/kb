import type { RunnableRef, RunOutcome, RunRow, ScheduleOccurrence } from '../control/p2Contracts.ts';

export type HomeUnavailableReason = 'attention-unavailable' | 'inbox-unavailable' | 'schedules-unavailable' | 'release-unavailable' | 'outcomes-unavailable';
export type HomeSectionResult<T> = { state: 'ready'; data: T } | { state: 'unavailable'; reason: HomeUnavailableReason };

export type RunningNowSectionResult = HomeSectionResult<{ section: 'running-now'; runs: RunRow[] }>;
export type AttentionCountsSectionResult = HomeSectionResult<{
  section: 'attention-counts';
  agents: number;
  workflows: number;
  inbox: number;
}>;
export type NextSchedulesSectionResult = HomeSectionResult<{ section: 'next-schedules'; occurrences: ScheduleOccurrence[] }>;
export type VersionSectionResult = HomeSectionResult<{ section: 'version'; label: string; sha: string; activatedAt: string }>;
export type RecentOutcomesSectionResult = HomeSectionResult<{
  section: 'recent-outcomes';
  outcomes: Array<Pick<RunRow, 'runRef' | 'title' | 'completedAt'> & { outcome: RunOutcome }>;
}>;

/** D13 order: running, linked counts, next schedules, version, then recent outcomes. */
export type HomeSections = readonly [
  RunningNowSectionResult,
  AttentionCountsSectionResult,
  NextSchedulesSectionResult,
  VersionSectionResult,
  RecentOutcomesSectionResult,
];

export interface HomeResponse {
  revision: string;
  sections: HomeSections;
}

export type ScheduleOwnerIntegrityRow = {
  kind: "integrity";
  key: `schedule-owner:${string}`;
  value: { status: "error"; code: "schedule-owner-unresolvable"; owner: RunnableRef };
  observedAt: string;
  source: "schedule-store";
};

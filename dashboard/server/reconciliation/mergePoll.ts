// P4 §3.4 / §7.1 — the READ-ONLY merge-poll PR resolver. It replaces the deleted
// `write/mergeGateReconciler.ts`: instead of walking a card to `done` through a direct card mutation, it
// only READS pull-request merge status over ambient `gh` and, when a tracked PR has merged, drives THE
// ONE reconciliation publisher. A merged schedule-mirror PR yields a `mirror-merged` intent plus a
// PR-cache invalidation; a merged Implementer batch PR yields the `learning-record-retire` publisher
// action [P4-C13]. Merge polling itself NEVER mutates — every effect flows through the publisher, so this
// module imports no filesystem-write, git, card-mutation, or outbox-publish capability at all.
import {
  RECONCILIATION_INTENT_SCHEMA, reconciliationIdempotencyKey,
} from './contracts.ts';
import type { MirrorMergedIntent, ReconciliationResult } from './contracts.ts';
import type { LearningRecordRetireInput } from './publisher.ts';
import type { ReconciliationPublisher } from './realPorts.ts';
import { isCommitSha } from '../write/durableManifest.ts';
import type { ScheduleMirrorBatch } from '../schedules/mirrorContracts.ts';

/** The composition-time repository pin [P4-C35]; only PRs on this repo are ever resolved. */
export interface RepoPin {
  readonly owner: string;
  readonly repo: string;
}

/** What a read of one PR's merge state yields. `mergeCommit`/`mergedAt` are set only when merged. */
export interface MergedPrStatus {
  readonly merged: boolean;
  readonly mergeCommit: string | null;
  readonly mergedAt: string | null;
}

/**
 * A read-only PR merge-status reader over ambient `gh` (the credential is never read/printed/copied).
 * `null` means UNKNOWN (gh absent, a timeout, a parse fault) — the resolver leaves the PR alone, exactly
 * as the old reconciler left a gate OPEN on an unknown read (fail toward surfacing, never toward a write).
 */
export type PrMergeReader = (pr: { owner: string; repo: string; number: number }) => Promise<MergedPrStatus | null>;

/** One Implementer batch PR the resolver may confirm merged, plus the records its merge supersedes. */
export interface ImplementerBatchRef {
  readonly batchId: string;
  readonly recordPaths: readonly string[];
  readonly pr: { readonly owner: string; readonly repo: string; readonly number: number };
}

export interface MergePollDeps {
  readonly repoPin: RepoPin;
  /** Read-only PR merge status over ambient `gh`. */
  readonly gh: PrMergeReader;
  /** The single open schedule-mirror batch, or `null` — read from the control store. */
  readonly readOpenMirrorBatch: () => Promise<ScheduleMirrorBatch | null>;
  /** The open Implementer batch PRs whose merge would retire records (W6.3 supplies the real source). */
  readonly readOpenImplementerBatches: () => Promise<readonly ImplementerBatchRef[]>;
  /** Current ops HEAD — the base the `mirror-merged` intent and the retire commit pin. */
  readonly readSourceRevision: () => Promise<string>;
  /** Current control-store document revision. */
  readonly readStoreRevision: () => string;
  /** THE ONE reconciliation publisher — the resolver's only card/schedule mutation path. */
  readonly publish: ReconciliationPublisher;
  /** The learning-record-retire action — the resolver's only record-deletion path. */
  readonly retire: (input: LearningRecordRetireInput) => Promise<ReconciliationResult>;
  /** Invalidate the cached PR projection so a merged PR leaves the open list on the next read. */
  readonly invalidatePr: () => void;
  readonly now?: () => string;
}

export interface MergePollOutcome {
  /** Batch ids of mirror PRs confirmed merged and published as `mirror-merged` this poll. */
  readonly mirrorsMerged: readonly string[];
  /** Batch ids whose Implementer PR merged and whose records were retired this poll. */
  readonly recordsRetired: readonly string[];
  /** How many PR-cache invalidations this poll issued. */
  readonly invalidations: number;
}

/** True only for a PR whose owner/repo equal the composition-time pin — never a subject-supplied repo. */
function matchesPin(pr: { owner: string; repo: string }, pin: RepoPin): boolean {
  return pr.owner === pin.owner && pr.repo === pin.repo;
}

function buildMirrorMergedIntent(input: {
  batch: ScheduleMirrorBatch;
  pr: { owner: string; repo: string; number: number };
  mergeCommit: string;
  mergedAt: string;
  sourceRevision: string;
  storeRevision: string;
}): MirrorMergedIntent {
  const draft: MirrorMergedIntent = {
    schema: RECONCILIATION_INTENT_SCHEMA,
    kind: 'mirror-merged',
    actor: 'system-sweeper',
    idempotencyKey: '',
    expectedSourceRevision: input.sourceRevision,
    expectedStoreRevision: input.storeRevision,
    exactTargets: [],
    batchId: input.batch.id,
    pr: { owner: input.pr.owner, repo: input.pr.repo, number: input.pr.number, mergeCommit: input.mergeCommit },
    mergedAt: input.mergedAt,
  };
  return { ...draft, idempotencyKey: reconciliationIdempotencyKey(draft) };
}

/**
 * Resolve every tracked PR once. The single open mirror batch (in `pr-open` with a pinned PR) is checked
 * first, then each open Implementer batch. A merged read drives the publisher / retire action and
 * invalidates the PR cache; an unmerged or unknown read changes nothing. Never mutates directly.
 */
export async function resolveMergedPullRequests(deps: MergePollDeps): Promise<MergePollOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const mirrorsMerged: string[] = [];
  const recordsRetired: string[] = [];
  let invalidations = 0;

  const batch = await deps.readOpenMirrorBatch();
  if (batch !== null && batch.state === 'pr-open' && batch.pr !== undefined && matchesPin(batch.pr, deps.repoPin)) {
    const status = await deps.gh(batch.pr);
    if (status !== null && status.merged && isCommitSha(status.mergeCommit)) {
      const sourceRevision = await deps.readSourceRevision();
      const intent = buildMirrorMergedIntent({
        batch,
        pr: batch.pr,
        mergeCommit: status.mergeCommit,
        mergedAt: status.mergedAt ?? now(),
        sourceRevision,
        storeRevision: deps.readStoreRevision(),
      });
      await deps.publish(intent, { authenticatedTaskAction: false });
      mirrorsMerged.push(batch.id);
      deps.invalidatePr();
      invalidations += 1;
    }
  }

  for (const impl of await deps.readOpenImplementerBatches()) {
    if (!matchesPin(impl.pr, deps.repoPin)) continue;
    const status = await deps.gh(impl.pr);
    if (status === null || !status.merged || !isCommitSha(status.mergeCommit)) continue;
    const sourceRevision = await deps.readSourceRevision();
    await deps.retire({
      batchId: impl.batchId,
      baseCommit: sourceRevision,
      mergeCommit: status.mergeCommit,
      mergedAt: status.mergedAt ?? now(),
      recordPaths: impl.recordPaths,
      expectedSourceRevision: sourceRevision,
      expectedStoreRevision: deps.readStoreRevision(),
    });
    recordsRetired.push(impl.batchId);
    deps.invalidatePr();
    invalidations += 1;
  }

  return { mirrorsMerged, recordsRetired, invalidations };
}

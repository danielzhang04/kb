import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ReconciliationConflictError, reconciliationIdempotencyKey,
} from './contracts.ts';
import type {
  CardTransitionIntent, ReconciliationIntent, ScheduleMirrorIntent,
} from './contracts.ts';
import { scheduleMirrorOperationKey } from '../write/durableManifest.ts';
import { scheduleMirrorBatchId } from '../schedules/mirrorContracts.ts';
import { portConformanceSuite } from './publisher.ts';
import type { ReconciliationSourcePort } from './publisher.ts';
import {
  createDurableRetirePort, createLearningRecordRetire, createReconciliationPublisher,
  createReconciliationRealPorts,
} from './realPorts.ts';
import type { LearningRecordRetireRequest } from './publisher.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { stagingGit } from '../testFixtures/stagingGit.ts';
import { makeSurfaceContext } from '../http/surface.ts';

const CARD_SHA = 'a'.repeat(64);
const MIRROR_WATERMARK = { revision: 7, digest: 'd'.repeat(64) } as const;
const MIRROR_BATCH_ID = scheduleMirrorBatchId(MIRROR_WATERMARK);

function seal<T extends ReconciliationIntent>(draft: T): T {
  return { ...draft, idempotencyKey: reconciliationIdempotencyKey(draft) };
}

function cardIntent(overrides: Partial<CardTransitionIntent> = {}): CardTransitionIntent {
  return seal({
    schema: 'kb.reconciliation-intent/v1', kind: 'card-transition', actor: 'system-sweeper',
    idempotencyKey: '', expectedSourceRevision: 'src-1', expectedStoreRevision: 'store-1',
    exactTargets: ['queue/inbox/card-1.md'], cardId: 'queue/inbox/card-1.md',
    expectedCardSha256: CARD_SHA, fromState: 'inbox', toState: 'done',
    ...overrides,
  } as CardTransitionIntent);
}

const SAMPLE_MANIFEST: ScheduleMirrorIntent['manifest'] = {
  schema: 'kb.durable-path-manifest/v1',
  operationKey: scheduleMirrorOperationKey(MIRROR_BATCH_ID),
  purpose: 'schedule-mirror',
  baseCommit: 'b'.repeat(40),
  relpaths: ['HEARTBEAT.md'],
};

function realPorts() {
  return createReconciliationRealPorts({
    repoRoot: mkdtempSync(join(tmpdir(), 'recon-repo-')),
    store: createInMemoryControlPlaneStore(),
    stateRoot: mkdtempSync(join(tmpdir(), 'recon-state-')),
  });
}

describe('createReconciliationRealPorts — port conformance (note 7)', () => {
  it('every real effect port refuses a request the publisher never minted with 403', async () => {
    const ports = realPorts();
    const results = await portConformanceSuite(
      { cards: ports.cards, outbox: ports.outbox, durable: ports.durable, mirror: ports.mirror },
      { intent: cardIntent(), manifest: SAMPLE_MANIFEST },
    );
    expect(results.map((entry) => entry.port).sort()).toEqual(['cards', 'durable', 'mirror', 'outbox']);
    for (const result of results) {
      expect(result).toMatchObject({ refusedUnauthorized: true, detail: 'refused with OpsBypassError (403)' });
    }
  });
});

describe('createReconciliationRealPorts — cards TOCTOU re-check (note 8) and no double-apply (note 9)', () => {
  it('a real card transaction re-reads the card under the lock and refuses stale bytes, staging nothing', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'recon-repo-'));
    mkdirSync(join(repoRoot, 'queue', 'inbox'), { recursive: true });
    // The card on disk carries DIFFERENT bytes than the (stale) snapshot reports — a concurrent ops
    // write landed between the unlocked snapshot and the locked mutation.
    writeFileSync(join(repoRoot, 'queue', 'inbox', 'card-1.md'), 'changed on disk since the snapshot\n');

    const gitCalls: string[][] = [];
    const runGit = stagingGit({ branch: 'ops', onCall: (_repo, args) => gitCalls.push(args) });
    let pyCalls = 0;
    const ports = createReconciliationRealPorts({
      repoRoot,
      store: createInMemoryControlPlaneStore(),
      stateRoot: mkdtempSync(join(tmpdir(), 'recon-state-')),
      runGit,
      runPy: () => { pyCalls += 1; return { exitCode: 0, stdout: '{}', stderr: '' }; },
    });
    // The publisher's pre-check passes (the snapshot reports the expected sha); the cards port catches
    // the drift INSIDE the transaction.
    const staleSource: ReconciliationSourcePort = {
      async snapshot() {
        return {
          sourceRevision: 'src-1', storeRevision: 'store-1', cardSha256: CARD_SHA,
          escalationCardPath: null, currentMirrorWatermark: null,
        };
      },
    };
    const publisher = createReconciliationPublisher({ ...ports, source: staleSource });

    await expect(publisher(cardIntent(), { authenticatedTaskAction: false }))
      .rejects.toBeInstanceOf(ReconciliationConflictError);
    // The cards.py executor was never reached, and no commit was made — the transaction staged nothing.
    expect(pyCalls).toBe(0);
    expect(gitCalls.some((args) => args[0] === 'commit')).toBe(false);
    expect(gitCalls.some((args) => args[0] === 'add')).toBe(false);
  });
});

describe('reconciliation publisher composition on the surface context', () => {
  it('composes exactly one publisher, reachable on the context', () => {
    const ctx = makeSurfaceContext({ controlStore: createInMemoryControlPlaneStore() });
    expect(typeof ctx.reconciliationPublisher).toBe('function');
    // Composed once per context: the same reference across reads.
    expect(ctx.reconciliationPublisher).toBe(ctx.reconciliationPublisher);
  });
});

// --- Learning-record retire real ports [P4-C13] --------------------------------------------------

const RETIRE_RECORD = 'docs/proposals/learnings/2026-08-24-run_01HXYZ-01.md';
const RETIRE_BATCH = 'learn-0123456789abcdef01234567';
const RETIRE_MERGE = 'e'.repeat(40);
const RETIRE_HEAD = '1'.repeat(40);

/** A git runner modelling the ops coordination checkout for a retire: ops branch, HEAD == baseCommit,
 *  proven merge (merge-base exits 0), and the staged deletions the retire's exact-set proof reads. */
function retireGit(onCall: (args: string[]) => void) {
  return (_repoRoot: string, args: string[]): string => {
    onCall(args);
    const joined = args.join(' ');
    if (joined === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
    if (joined === 'rev-parse HEAD') return `${RETIRE_HEAD}\n`;
    if (joined === 'diff --cached --name-status -z') return `D\0${RETIRE_RECORD}\0`;
    return '';
  };
}

describe('createDurableRetirePort / createLearningRecordRetire — coordination delete [P4-C13]', () => {
  it('the real durable retire port refuses a request the publisher never minted (note 7)', async () => {
    const port = createDurableRetirePort({
      repoRoot: mkdtempSync(join(tmpdir(), 'retire-repo-')),
      store: createInMemoryControlPlaneStore(),
      stateRoot: mkdtempSync(join(tmpdir(), 'retire-state-')),
    });
    const forged: LearningRecordRetireRequest = {
      idempotencyKey: `learning-record-retire:${RETIRE_BATCH}:${RETIRE_MERGE}`,
      exactTargets: [RETIRE_RECORD], batchId: RETIRE_BATCH, baseCommit: RETIRE_HEAD,
      mergeCommit: RETIRE_MERGE, mergedAt: '2026-08-24T00:00:00Z', recordPaths: [RETIRE_RECORD],
    };
    await expect(port.retireLearningRecords(forged)).rejects.toThrow(/not minted by the reconciliation publisher/);
  });

  it('deletes the superseded record once through the durable coordination path; an exact replay is a no-op', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'retire-repo-'));
    mkdirSync(join(repoRoot, 'docs', 'proposals', 'learnings'), { recursive: true });
    const recordAbs = join(repoRoot, RETIRE_RECORD);
    writeFileSync(recordAbs, 'status: proposed\n');
    const calls: string[][] = [];
    const retire = createLearningRecordRetire({
      repoRoot, store: createInMemoryControlPlaneStore(),
      stateRoot: mkdtempSync(join(tmpdir(), 'retire-state-')),
      runGit: retireGit((args) => calls.push(args)),
    });
    const input = {
      batchId: RETIRE_BATCH, baseCommit: RETIRE_HEAD, mergeCommit: RETIRE_MERGE,
      mergedAt: '2026-08-24T00:00:00Z', recordPaths: [RETIRE_RECORD],
      expectedSourceRevision: RETIRE_HEAD, expectedStoreRevision: 'store-1',
    };

    const first = await retire(input);
    expect(first.outcome).toBe('applied');
    expect(existsSync(recordAbs)).toBe(false); // the record was deleted from ops
    // The publisher proved the merge itself before any staging.
    const joined = calls.map((c) => c.join(' '));
    expect(joined).toContain('fetch origin main');
    expect(joined).toContain(`merge-base --is-ancestor ${RETIRE_MERGE} origin/main`);
    const stagedProofs = calls.filter((c) => c.join(' ') === 'diff --cached --name-status -z').length;

    const replay = await retire(input);
    expect(replay).toEqual(first);
    // The durable path was NOT re-entered — no second exact-set proof ran, so nothing was deleted twice.
    const stagedProofsAfter = calls.filter((c) => c.join(' ') === 'diff --cached --name-status -z').length;
    expect(stagedProofsAfter).toBe(stagedProofs);
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  createReconciliationPublisher, createReconciliationRealPorts,
} from './realPorts.ts';
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

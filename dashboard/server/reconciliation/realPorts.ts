// P4 W6.2 (step 1): the REAL publisher port set + composition. W4 built `publishReconciliationIntent`
// against injected ports and backed them with in-memory fakes; this module builds the eight real ports
// over `control/store.ts`, `write/branch.ts`, and `write/cardRespond.ts`, and binds them into one
// `ReconciliationPublisher`. It is ADDITIVE: `makeSurfaceContext` composes the publisher and exposes it
// on the surface context, but no caller is cut over yet (the four heredocs stay live). W4's suites run
// unchanged against the fakes; W6.2's `realPorts.test.ts` runs `portConformanceSuite` against each REAL
// port so a port that omits `assertReconciliationPublisher` is a RED test, never a silent ops-bypass hole.
//
// The three CAS notes the W4 review left for W6.2 are satisfied HERE, not in the publisher:
//   note 7 — every real effect port calls `assertReconciliationPublisher(request)` FIRST, so a request
//            the publisher never minted is refused 403 before any git/store effect runs.
//   note 8 — the `source.snapshot()` read is NOT locked with the effect, so the `cards` port re-reads
//            the card bytes INSIDE the ops transaction (after the reconciling pull) and refuses a stale
//            card with 409, closing the TOCTOU window between snapshot and mutation.
//   note 9 — the `cards` port never double-applies: a re-run after a crash finds the card bytes already
//            moved (they no longer equal `expectedCardSha256`) and refuses rather than re-appending; the
//            landed-effect result is returned by the reconciler, not by re-running the effect.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  assertReconciliationPublisher, publishReconciliationIntent, retireLearningRecords,
} from './publisher.ts';
import type {
  CardMutationPort, DurablePublisherPort, DurableRetirePort, LearningRecordRetireInput,
  MirrorCompletionPort, OpsOutboxPort, PreparedReconcilerPort, ReconciliationClock,
  ReconciliationEffectResult, ReconciliationPublisherPorts, ReconciliationRequestContext,
  ReconciliationSourcePort, ReconciliationSourceSnapshot,
} from './publisher.ts';
import {
  ReconciliationConflictError,
} from './contracts.ts';
import type {
  EscalationCardIntent, ReconciliationAuditRecord, ReconciliationIntent, ReconciliationReceiptPort,
  ReconciliationResult,
} from './contracts.ts';
import type { ControlPlaneStore } from '../control/store.ts';
import type { ReconciliationAuditSink } from './audit.ts';
import { sha256Hex } from '../write/durableManifest.ts';
import type { RouteDurableReceipt } from '../write/durableManifest.ts';
import { buildLearningRecordRetireManifest } from '../write/durableManifestService.ts';
import {
  commitPreparedCoordination, createPersistentRouteReceipts, defaultGitRunner, prepareCoordination,
  resolveBaseCommit, routeDurable,
} from '../write/branch.ts';
import type { GitRunner, RouteReceiptStore } from '../write/branch.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { executeCardMutation as runCardMutationScript } from '../write/cardRespond.ts';
import type { PyRunner } from '../write/launch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';

/** A publisher whose ports are already bound; step 2's callers invoke it with just an intent + context. */
export type ReconciliationPublisher = (
  intent: ReconciliationIntent,
  context: ReconciliationRequestContext,
) => Promise<ReconciliationResult>;

/**
 * Bind the eight ports into one publisher. A thin partial application of
 * `publishReconciliationIntent` — never a second copy of its CAS/receipt logic — so W4's file stays the
 * single reconciliation authority and this composition adds no parallel implementation.
 */
export function createReconciliationPublisher(ports: ReconciliationPublisherPorts): ReconciliationPublisher {
  return (intent, context) => publishReconciliationIntent(intent, ports, context);
}

export interface ReconciliationRealPortDeps {
  /** The canonical ops worktree (`SurfaceContext.repoRoot`). */
  readonly repoRoot: string;
  /** The durable control-plane store — receipts, store revision, and mirror merge/watermark. */
  readonly store: ControlPlaneStore;
  /** Dashboard-owned runtime state root; the reconciliation audit trail lives under it. */
  readonly stateRoot: string;
  readonly runGit?: GitRunner;
  readonly runPy?: PyRunner;
  readonly now?: () => string;
  readonly coordinationPublication?: CoordinationPublication;
  readonly outboxRoot?: string;
}

// --- File-backed reconciliation audit trail ------------------------------------------------------

interface StoredAuditLine {
  readonly ref: string;
  readonly record: ReconciliationAuditRecord;
}

/**
 * A durable, append-only reconciliation audit trail (one JSON object per line under `stateRoot`). It is
 * the real backing for BOTH `ReconciliationAuditSink` (the publisher appends every outcome here) and the
 * `reconciler` port (a `prepared`-receipt reconcile reads it to learn whether the effect already
 * landed). Appends serialize on an in-process tail so two concurrent publishes never interleave a line.
 */
export class FileReconciliationAudit implements ReconciliationAuditSink {
  private readonly path: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(stateRoot: string) {
    this.path = join(stateRoot, 'reconciliation-audit.jsonl');
  }

  private read(): StoredAuditLine[] {
    if (!existsSync(this.path)) return [];
    const lines: StoredAuditLine[] = [];
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (line.length === 0) continue;
      lines.push(JSON.parse(line) as StoredAuditLine);
    }
    return lines;
  }

  async append(record: ReconciliationAuditRecord): Promise<string> {
    const ref = `recon-audit:${sha256Hex(JSON.stringify(record))}`;
    const line = `${JSON.stringify({ ref, record })}\n`;
    const run = this.tail.then(() => {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, line);
      return ref;
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async find(idempotencyKey: string, outcome: ReconciliationAuditRecord['outcome']): Promise<string | null> {
    const hit = this.read().find(
      (line) => line.record.idempotencyKey === idempotencyKey && line.record.outcome === outcome,
    );
    return hit?.ref ?? null;
  }

  /** The landed result for a reconciled `prepared` receipt, or `null` when no completed record exists. */
  findCompleted(idempotencyKey: string, requestSha256: string): ReconciliationResult | null {
    const hit = this.read().find((line) => line.record.idempotencyKey === idempotencyKey
      && line.record.intentSha256 === requestSha256
      && (line.record.outcome === 'applied' || line.record.outcome === 'no-op'));
    if (hit === undefined) return null;
    return { outcome: hit.record.outcome as ReconciliationResult['outcome'], revision: hit.record.newSourceRevision };
  }
}

// --- Escalation card rendering (provisional; W6.2's escalation caller finalizes the schema) --------

/**
 * The server-derived escalation card path: deterministic in the escalation's dedup identity
 * (`escalation:<kind>:<ref>`), so the Sweeper's read and the publisher's read of the SAME fact agree or
 * the publisher refuses with 409. This is the ONE authoritative source of an escalation's target.
 */
function deriveEscalationCardPath(intent: EscalationCardIntent): string {
  const identity = sha256Hex(`${intent.source.kind}${String.fromCharCode(0)}${intent.source.ref}`).slice(0, 16);
  return `queue/inbox/escalation-${identity}.md`;
}

/** A minimal governed escalation card body. The exact schema is finalized by step 2's escalation caller
 *  and its tests; step 1 only needs a real, committable artifact for the wired-but-uncalled port. */
function renderEscalationCard(intent: EscalationCardIntent, cardId: string, createdAt: string): string {
  return [
    '---',
    `id: ${cardId}`,
    'state: inbox',
    'action: wake-me',
    'owner: dashboard-supervisor',
    `created: ${createdAt}`,
    `source: ${intent.source.kind}:${intent.source.ref}`,
    '---',
    '',
    `# ${intent.title}`,
    '',
    intent.reason,
    '',
  ].join('\n');
}

// --- Real port set -------------------------------------------------------------------------------

/**
 * Build the eight real ports plus `receipts`. Each effect port asserts the publisher grant FIRST
 * (note 7); `cards` re-checks the card bytes inside the ops transaction (notes 8/9). Nothing here calls
 * the publisher — `createReconciliationPublisher` binds these into the composed publisher the surface
 * exposes for step 2.
 */
export function createReconciliationRealPorts(deps: ReconciliationRealPortDeps): ReconciliationPublisherPorts {
  const runGit = deps.runGit ?? defaultGitRunner;
  const now = deps.now ?? (() => new Date().toISOString());
  const publication = deps.coordinationPublication ?? 'direct';
  const audit = new FileReconciliationAudit(deps.stateRoot);
  const storeRevision = (): string => String(deps.store.getControlDocumentMetadata().documentRevision);
  const cardAbsolutePath = (cardId: string): string => join(deps.repoRoot, cardId);
  const cardSha256OnDisk = (cardId: string): string | null => {
    const abs = cardAbsolutePath(cardId);
    // A byte-accurate sha256 of the card file, so the CAS matches the Sweeper's digest of the same bytes.
    return existsSync(abs) ? createHash('sha256').update(readFileSync(abs)).digest('hex') : null;
  };

  const source: ReconciliationSourcePort = {
    async snapshot(intent: ReconciliationIntent): Promise<ReconciliationSourceSnapshot> {
      const sourceRevision = await resolveBaseCommit(deps.repoRoot, runGit);
      const cardSha256 = intent.kind === 'card-transition' ? cardSha256OnDisk(intent.cardId) : null;
      const escalationCardPath = intent.kind === 'escalation-card' ? deriveEscalationCardPath(intent) : null;
      const currentMirrorWatermark = intent.kind === 'schedule-mirror'
        ? await deps.store.readMergedScheduleMirrorWatermark()
        : null;
      return {
        sourceRevision,
        storeRevision: storeRevision(),
        cardSha256,
        escalationCardPath,
        currentMirrorWatermark,
      };
    },
  };

  const cards: CardMutationPort = {
    async executeCardMutation(request): Promise<ReconciliationEffectResult> {
      assertReconciliationPublisher(request); // note 7
      return withOpsTransaction(async () => {
        // Reconcile the shared ops checkout first, then re-read the card under the lock: the source
        // snapshot was taken without a lock, so the bytes may have moved since.
        await prepareCoordination(deps.repoRoot, runGit, publication, deps.outboxRoot);
        const observed = cardSha256OnDisk(request.cardId);
        if (observed !== request.expectedCardSha256) {
          // note 8 (stale bytes since the snapshot) AND note 9 (a re-run after a landed effect sees the
          // moved card here and refuses rather than re-applying it).
          throw new ReconciliationConflictError(request.idempotencyKey, 'card bytes changed before the mutation');
        }
        const { paths } = await runCardMutationScript(
          {
            // `intent.cardId` is the repo-relative card PATH (`queue/<state>/<id>.md`) — the same value
            // `cardSha256OnDisk` and `exactTargets` use. `cardRespond`'s CARD_RESPOND_SCRIPT globs by the
            // BARE id (`queue/**/<id>.md`), so hand it the basename without its `.md`; a transition then
            // relocates the file and the script returns both the old and new paths for staging.
            cardId: request.cardId.replace(/^.*\//, '').replace(/\.md$/, ''),
            // Forward the write payload verbatim (R1): absent = pure transition (blockless, body unchanged);
            // present = append `write.block` under `## write.section` before the state walk.
            ...(request.write === undefined ? {} : { section: request.write.section, block: request.write.block }),
            transitions: request.fromState === request.toState ? [] : [request.toState],
            claimOwner: null,
          },
          { repoRoot: deps.repoRoot, runPy: deps.runPy },
        );
        await commitPreparedCoordination(deps.repoRoot, paths[0]!, {
          alsoStage: paths.slice(1),
          runGit,
          publication,
          outboxRoot: deps.outboxRoot,
        });
        const revision = await resolveBaseCommit(deps.repoRoot, runGit);
        return { revision, receipt: revision, storeRevision: storeRevision() };
      });
    },
  };

  const outbox: OpsOutboxPort = {
    async publishOpsOutbox(request): Promise<ReconciliationEffectResult> {
      assertReconciliationPublisher(request); // note 7
      const intent = request.intent as EscalationCardIntent;
      const cardPath = request.exactTargets[0]!; // publisher already recomputed it against the source
      const cardId = cardPath.replace(/^.*\//, '').replace(/\.md$/, '');
      return withOpsTransaction(async () => {
        await prepareCoordination(deps.repoRoot, runGit, publication, deps.outboxRoot);
        const abs = cardAbsolutePath(cardPath);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, renderEscalationCard(intent, cardId, now()));
        await commitPreparedCoordination(deps.repoRoot, cardPath, {
          runGit,
          publication,
          outboxRoot: deps.outboxRoot,
        });
        const revision = await resolveBaseCommit(deps.repoRoot, runGit);
        return { revision, receipt: cardPath, storeRevision: storeRevision() };
      });
    },
  };

  const durable: DurablePublisherPort = {
    async routeDurable(request): Promise<{ readonly revision: string; readonly receipt: RouteDurableReceipt }> {
      assertReconciliationPublisher(request); // note 7
      const published = await routeDurable(deps.repoRoot, request.manifest, {
        runGit,
        publication,
        outboxRoot: deps.outboxRoot,
      });
      if (published.mode === 'coordination') {
        return { revision: published.commit, receipt: { mode: 'coordination', branch: published.branch, commit: published.commit } };
      }
      return { revision: published.branch, receipt: { mode: 'pr', branch: published.branch, pr: published.pr } };
    },
  };

  const mirror: MirrorCompletionPort = {
    async completeMirrorMerge(request): Promise<ReconciliationEffectResult> {
      assertReconciliationPublisher(request); // note 7
      const batch = await deps.store.readOpenScheduleMirrorBatch();
      if (batch === null || batch.id !== request.batchId) {
        throw new ReconciliationConflictError(request.idempotencyKey, 'no open mirror batch matches this merge');
      }
      const { updatedRowIds } = await deps.store.applyScheduleMirrorMerge({ batch, mirroredAt: request.mergedAt });
      const revision = await resolveBaseCommit(deps.repoRoot, runGit);
      return {
        revision,
        receipt: request.pr.mergeCommit,
        storeRevision: storeRevision(),
        ...(updatedRowIds.length === 0 ? { noop: true } : {}),
      };
    },
  };

  const reconciler: PreparedReconcilerPort = {
    async findCompleted(idempotencyKey, requestSha256) {
      return audit.findCompleted(idempotencyKey, requestSha256);
    },
  };

  const clock: ReconciliationClock = { now };

  // Resolve the store's receipt port LAZILY: composition (`makeSurfaceContext`) must stay side-effect
  // free for every context — including tests that inject a partial control-store stub — and step 1 never
  // calls the publisher, so the store method is only reached once step 2 actually publishes an intent.
  let receiptsPort: ReconciliationReceiptPort | null = null;
  const resolveReceipts = (): ReconciliationReceiptPort =>
    (receiptsPort ??= deps.store.reconciliationReceiptPort());
  const receipts: ReconciliationReceiptPort = {
    read: (key) => resolveReceipts().read(key),
    prepare: (receipt) => resolveReceipts().prepare(receipt),
    publish: (receipt) => resolveReceipts().publish(receipt),
  };

  return {
    receipts,
    source,
    cards,
    outbox,
    durable,
    mirror,
    reconciler,
    audit,
    clock,
  };
}

// --- Learning-record retire (the coordination-delete effect the merge poll drives) [P4-C13] ---------

/**
 * The REAL durable retire port: it asserts the ops-bypass wall (note 7) then deletes the superseded
 * proposed records through THE ONE durable publisher's `learning-record-retire` coordination purpose —
 * proven-merge-only, all-deletions, restore-on-failure — reusing `write/branch.ts#routeDurable` and never
 * a second publish path. Its own persistent operation-key receipt store makes a `prepared`-receipt
 * reconcile return the prior coordination commit rather than deleting twice.
 */
export function createDurableRetirePort(deps: ReconciliationRealPortDeps): DurableRetirePort {
  const runGit = deps.runGit ?? defaultGitRunner;
  const publication = deps.coordinationPublication ?? 'direct';
  const receipts: RouteReceiptStore = createPersistentRouteReceipts(deps.stateRoot);
  return {
    async retireLearningRecords(request): Promise<ReconciliationEffectResult> {
      assertReconciliationPublisher(request); // note 7 — refuses any request the publisher never minted
      const manifest = buildLearningRecordRetireManifest({
        batchId: request.batchId,
        baseCommit: request.baseCommit,
        implementedAt: request.mergedAt,
        targetPaths: [],
        recordPaths: request.recordPaths,
        mergeCommit: request.mergeCommit,
        merged: true,
      });
      const published = await routeDurable(deps.repoRoot, manifest, {
        runGit,
        publication,
        outboxRoot: deps.outboxRoot,
        receipts,
        retire: {
          batchId: request.batchId,
          recordPaths: [...request.recordPaths],
          mergeCommit: request.mergeCommit,
          merged: true,
        },
      });
      if (published.mode !== 'coordination') {
        throw new ReconciliationConflictError(request.idempotencyKey, 'a learning-record-retire must publish in coordination mode');
      }
      return { revision: published.commit, receipt: published.commit };
    },
  };
}

/**
 * Compose the learning-record-retire action over the real durable retire port and the store's two-phase
 * receipt. The merge-poll resolver calls the returned function on a confirmed batch-PR merge; nothing
 * else may. The receipt port is resolved lazily so composition stays side-effect free (as in the main
 * real-port builder).
 */
export function createLearningRecordRetire(
  deps: ReconciliationRealPortDeps,
): (input: LearningRecordRetireInput) => Promise<ReconciliationResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const retire = createDurableRetirePort(deps);
  let receiptsPort: ReconciliationReceiptPort | null = null;
  const resolveReceipts = (): ReconciliationReceiptPort =>
    (receiptsPort ??= deps.store.reconciliationReceiptPort());
  const receipts: ReconciliationReceiptPort = {
    read: (key) => resolveReceipts().read(key),
    prepare: (receipt) => resolveReceipts().prepare(receipt),
    publish: (receipt) => resolveReceipts().publish(receipt),
  };
  return (input) => retireLearningRecords(input, { receipts, retire, clock: { now } });
}

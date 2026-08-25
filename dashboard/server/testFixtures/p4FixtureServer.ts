/**
 * P4 W6.4 — the in-memory fixtures the isolated remote-lifecycle proof mounts around a real bare git
 * remote: a fixture control store (schedule rows + mirror watermarks), a fixture ops outbox (the
 * append-only durable coordination log), and a fake AUTHENTICATED PR registry (the `gh`-shaped surface
 * the Implementer/mirror open PRs against). None of these touch the network, the live control plane, or
 * a real GitHub — every effect is a value in this process, so the lifecycle can be replayed and every
 * refusal exercised without a credential or a live ref.
 *
 * Security shape mirrored from the production contracts this fixture stands in for:
 *  - The ops outbox is written ONLY through {@link FixtureOpsOutbox.publishAsPublisher}; a direct
 *    `append` outside the publisher is refused ({@link OpsBypassRefused}) and audited, so the §9
 *    `ops-bypass` and `direct-sweeper-writes` attacks have a real wall to hit.
 *  - The control store is CAS-guarded: a mutation pinned to a stale revision conflicts, so a replayed or
 *    racing mirror cannot double-apply (§9 `replayed-changed-intents`, `mirror-watermark-races`).
 *  - The PR registry mints a 40-hex merge commit only for a PR whose base is the fixture `main` and
 *    whose staged set the caller declares; it never merges the live feature branch or live `main`.
 */

/** A canonical 40-hex commit id. The PR registry mints these; the harness never accepts a short id. */
export type CommitId = string;

export function isFortyHex(value: unknown): value is CommitId {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

/** Every created/written path the fixture owns, so isolation can be asserted against the live worktree. */
export interface FixtureIdentity {
  /** The read-only clone source — expected to be the live worktree; never written. */
  readonly sourceRoot: string;
  /** The temp root under which every created path lives. */
  readonly tempRoot: string;
  /** The non-bare fixture working clone. */
  readonly fixtureRepo: string;
  /** The local BARE remote the producers push to. */
  readonly bareRemote: string;
  /** The worker worktree derived from the tagged fixture commit. */
  readonly workerWorktree: string;
  /** The fixture control store file. */
  readonly controlStore: string;
  /** The fixture ops outbox file. */
  readonly opsOutbox: string;
  /** The artifact directory for this run. */
  readonly artifactDir: string;
  /** The tagged "attested protected-main" commit the whole proof derives from. */
  readonly fixtureHead: CommitId;
  /** The tag name on {@link fixtureHead}. */
  readonly fixtureTag: string;
}

// ---------------------------------------------------------------------------------------------------
// Fixture ops outbox — the append-only durable coordination log, publisher-only.
// ---------------------------------------------------------------------------------------------------

export class OpsBypassRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsBypassRefused';
  }
}

export interface OpsEvent {
  /** Idempotency key; a replay with the same key returns the recorded receipt, never a second append. */
  readonly key: string;
  readonly purpose: 'learning-proposal' | 'learning-record-retire' | 'schedule-mirror';
  /** The ops HEAD this coordination write commits against; a stale base is refused by the caller. */
  readonly base: CommitId;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OpsReceipt {
  readonly mode: 'coordination';
  readonly branch: 'ops';
  readonly key: string;
  readonly commit: CommitId;
}

/** An audited refusal of a direct-write attempt, so the §9 attacks can assert one was recorded. */
export interface OpsAuditEntry {
  readonly kind: 'refused-direct-write' | 'refused-stale-base';
  readonly detail: string;
}

export class FixtureOpsOutbox {
  private readonly events: OpsEvent[] = [];
  private readonly receipts = new Map<string, OpsReceipt>();
  private readonly audit: OpsAuditEntry[] = [];
  private headCommit: CommitId;
  /** Only a call routed through {@link publishAsPublisher} may append. */
  private insidePublisher = false;

  constructor(initialHead: CommitId) {
    if (!isFortyHex(initialHead)) throw new Error('ops outbox requires a 40-hex initial head');
    this.headCommit = initialHead;
  }

  head(): CommitId {
    return this.headCommit;
  }

  auditLog(): readonly OpsAuditEntry[] {
    return this.audit;
  }

  log(): readonly OpsEvent[] {
    return this.events;
  }

  /** The ONLY legal append path. Idempotent on `key`; refuses a stale base. */
  publishAsPublisher(event: OpsEvent, mintCommit: () => CommitId): OpsReceipt {
    const existing = this.receipts.get(event.key);
    if (existing) return existing;
    if (event.base !== this.headCommit) {
      this.audit.push({ kind: 'refused-stale-base', detail: `${event.key} pinned ${event.base}` });
      throw new OpsBypassRefused(`stale base for ${event.key}: expected ${this.headCommit}`);
    }
    this.insidePublisher = true;
    try {
      this.events.push(event);
      const commit = mintCommit();
      this.headCommit = commit;
      const receipt: OpsReceipt = { mode: 'coordination', branch: 'ops', key: event.key, commit };
      this.receipts.set(event.key, receipt);
      return receipt;
    } finally {
      this.insidePublisher = false;
    }
  }

  /** A direct append — the shape a Sweeper or an ops-bypass attempt would use. Always refused/audited. */
  appendDirect(event: OpsEvent): never {
    if (!this.insidePublisher) {
      this.audit.push({ kind: 'refused-direct-write', detail: `direct append of ${event.key}` });
      throw new OpsBypassRefused(`direct ops write refused: ${event.key}`);
    }
    // Unreachable from outside the publisher; retained so the guard's meaning is explicit.
    throw new OpsBypassRefused('appendDirect is never a publish path');
  }
}

// ---------------------------------------------------------------------------------------------------
// Fixture control store — schedule rows with mirror watermarks and CAS.
// ---------------------------------------------------------------------------------------------------

export interface ScheduleRow {
  readonly id: string;
  /** Monotonic per-row revision, bumped on each mutation. */
  readonly revision: number;
  /** The mirror revision the row was last covered by, or 0 before any mirror. */
  readonly lastMirrorRevision: number;
  /** The UTC second a covering mirror last merged, or null. */
  readonly mirroredAt: string | null;
}

export class ScheduleCasConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleCasConflict';
  }
}

export interface MirrorBatch {
  /** The collection revision this batch mirrors; frozen for the batch's life. */
  readonly targetRevision: number;
  /** The rows covered when the batch opened, by id. */
  readonly coveredRowIds: readonly string[];
  /** Each covered row's per-row revision at open time; the watermark advances to exactly these. */
  readonly coveredRevisionAtOpen: ReadonlyMap<string, number>;
}

/**
 * The fixture control store. `scheduleMirrorRevision` is the collection watermark; a pre-P4 document
 * that lacks it reads as 0 and gains it on first mirror with no version bump [P4-C37 shape].
 */
export class FixtureControlStore {
  private rows = new Map<string, ScheduleRow>();
  private collectionRevision = 0;
  private scheduleMirrorRevision = 0;
  private openBatch: MirrorBatch | null = null;

  snapshot(): { rows: readonly ScheduleRow[]; collectionRevision: number; scheduleMirrorRevision: number } {
    return {
      rows: [...this.rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
      collectionRevision: this.collectionRevision,
      scheduleMirrorRevision: this.scheduleMirrorRevision,
    };
  }

  /** Create-or-mutate a row under CAS. `expectRevision` must equal the row's current revision (0 for new). */
  mutate(id: string, expectRevision: number): ScheduleRow {
    const current = this.rows.get(id);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectRevision) {
      throw new ScheduleCasConflict(`row ${id}: expected revision ${expectRevision}, have ${currentRevision}`);
    }
    this.collectionRevision += 1;
    const next: ScheduleRow = {
      id,
      revision: currentRevision + 1,
      lastMirrorRevision: current?.lastMirrorRevision ?? 0,
      mirroredAt: current?.mirroredAt ?? null,
    };
    this.rows.set(id, next);
    return next;
  }

  hasOpenBatch(): boolean {
    return this.openBatch !== null;
  }

  /**
   * Open the single mirror batch. A second open while one is live is refused (§3.5 one-open-batch).
   * A row is covered iff it has changed since its last mirror (`revision > lastMirrorRevision`); each
   * covered row's revision is frozen at open time so a mutation during the batch is not falsely mirrored.
   */
  openMirrorBatch(): MirrorBatch {
    if (this.openBatch) throw new ScheduleCasConflict('a mirror batch is already open');
    const covered = [...this.rows.values()]
      .filter((row) => row.revision > row.lastMirrorRevision)
      .sort((a, b) => a.id.localeCompare(b.id));
    this.openBatch = {
      targetRevision: this.collectionRevision,
      coveredRowIds: covered.map((row) => row.id),
      coveredRevisionAtOpen: new Map(covered.map((row) => [row.id, row.revision])),
    };
    return this.openBatch;
  }

  /**
   * Confirm the open batch merged at `mergeCommit`, advancing each covered row's watermark to exactly
   * its revision at open time and stamping `mirroredAt` on those rows (§3.5, row-bounded). A row mutated
   * during the batch stays pending for the next cycle. Returns the ids that advanced.
   */
  confirmMirrorMerge(mergeCommit: CommitId, mergedAt: string): readonly string[] {
    if (!isFortyHex(mergeCommit)) throw new Error('mirror merge requires a 40-hex commit');
    const batch = this.openBatch;
    if (!batch) throw new ScheduleCasConflict('no open mirror batch to confirm');
    const advanced: string[] = [];
    for (const id of batch.coveredRowIds) {
      const row = this.rows.get(id);
      if (!row) continue;
      const revisionAtOpen = batch.coveredRevisionAtOpen.get(id) ?? row.revision;
      this.rows.set(id, { ...row, lastMirrorRevision: revisionAtOpen, mirroredAt: mergedAt });
      advanced.push(id);
    }
    this.scheduleMirrorRevision = Math.max(this.scheduleMirrorRevision, batch.targetRevision);
    this.openBatch = null;
    return advanced.sort();
  }
}

// ---------------------------------------------------------------------------------------------------
// Fake authenticated PR registry — the `gh`-shaped surface, in memory.
// ---------------------------------------------------------------------------------------------------

export interface FakePrRecord {
  readonly id: number;
  readonly branch: string;
  readonly base: 'main';
  /** The exact set of repository-relative paths this PR stages. */
  readonly stagedSet: readonly string[];
  state: 'open' | 'merged';
  /** The 40-hex merge commit, once merged. */
  mergeCommit: CommitId | null;
  /** Whether the PR still shows in Inbox; a merged PR leaves Inbox. */
  inInbox: boolean;
}

export class FakePrRegistry {
  private readonly prs: FakePrRecord[] = [];
  private nextId = 1;

  /** Open ONE PR against fixture `main`. The base is fixed; there is no live-branch target. */
  open(branch: string, stagedSet: readonly string[]): FakePrRecord {
    const record: FakePrRecord = {
      id: this.nextId,
      branch,
      base: 'main',
      stagedSet: [...stagedSet].sort(),
      state: 'open',
      mergeCommit: null,
      inInbox: true,
    };
    this.nextId += 1;
    this.prs.push(record);
    return record;
  }

  /** Merge an open PR, minting its merge commit and dropping it from Inbox. Idempotent. */
  merge(id: number, mintCommit: () => CommitId): FakePrRecord {
    const record = this.prs.find((pr) => pr.id === id);
    if (!record) throw new Error(`no fixture PR ${id}`);
    if (record.state === 'merged') return record;
    record.state = 'merged';
    record.mergeCommit = mintCommit();
    record.inInbox = false;
    return record;
  }

  all(): readonly FakePrRecord[] {
    return this.prs;
  }

  openCount(): number {
    return this.prs.filter((pr) => pr.state === 'open').length;
  }
}

// P4 section 3.4 System Sweeper. The Sweeper is read-only BY CONSTRUCTION, not by convention: it
// takes exactly ONE runtime import — of the W0 contracts module — alongside three type-only import
// statements over that module and two other pure W0 contract modules (four import statements over
// three modules in total), its port object is typed `SweeperPorts<T>`, which admits only a `readSnapshot`
// member and collapses to `never` for anything else, and it returns intents that somebody else must
// publish. It reads a snapshot, derives at most `MAX_SWEEPER_INTENTS` deduplicated intents across
// the four closed kinds under per-kind reservations, and — when its own read fails — returns one
// failure-stable supervisor escalation rather than reporting the failure itself.
//
// SCOPE OF THE READ-ONLY CLAIM: it is about THIS module's own capability. `./contracts.ts` is a
// runtime dependency and pulls in `write/durableManifest.ts` (which uses `node:crypto`), so the
// resolved module graph is not effect-free in the strictest sense; what the wall guarantees is that
// the Sweeper holds no effect port and can reach no effect API of its own.
import {
  MAX_SWEEPER_INTENTS, RECONCILIATION_INTENT_SCHEMA, SWEEPER_KIND_RESERVATIONS,
  reconciliationExactTargets, reconciliationIdempotencyKey, sha256Hex,
} from './contracts.ts';
import type {
  CardBlockSection, EscalationCardIntent, EscalationSourceKind, ReconciliationIntent, SweeperPorts,
} from './contracts.ts';
// Type-only, and only the two pure W0 contract modules the intent union itself is built from.
// The Sweeper takes no runtime dependency on either, and none of them carries an effect.
import type { DurablePathManifest } from '../write/durableManifest.ts';
import type { ScheduleMirrorWatermark } from '../schedules/mirrorContracts.ts';

// --- Credential wall over the free-form fields ----------------------------------------------------

/**
 * Credential SHAPES scrubbed out of the two free-form fields the Sweeper puts into an intent
 * (`title`, `reason`) at CONSTRUCTION, before the intent is sealed and hashed. A snapshot-read
 * failure message routinely carries a git/HTTP URL, and a tokenized remote URL would otherwise
 * reach the published escalation card body. Literal patterns on purpose (the P2 "greps are
 * evidence" rule), single-line and bounded, in the same style as the W3 timeline scrubber.
 *
 * This is a credential scrubber, not a sensitivity filter: it proves "no recognized credential
 * shape", never "safe to publish".
 */
const SWEEPER_SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/g,
  /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g,
  /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*)[^\s,'"}]+/gi,
];

/** Max characters kept from a free-form field; longer text is truncated with an ellipsis. */
const MAX_FREE_FORM_CHARS = 500;

/** Scrubs credential shapes, collapses to a single line, and bounds the length. */
export function sweeperSafeText(value: string): string {
  let clean = value.replace(/\s+/g, ' ').trim();
  clean = clean.replace(SWEEPER_SECRET_PATTERNS[0]!, '[token redacted]');
  clean = clean.replace(SWEEPER_SECRET_PATTERNS[1]!, '[token redacted]');
  clean = clean.replace(SWEEPER_SECRET_PATTERNS[2]!, '[token redacted]');
  clean = clean.replace(SWEEPER_SECRET_PATTERNS[3]!, '[token redacted]');
  clean = clean.replace(SWEEPER_SECRET_PATTERNS[4]!, '$1[redacted]@');
  clean = clean.replace(SWEEPER_SECRET_PATTERNS[5]!, '$1[redacted]');
  return clean.length > MAX_FREE_FORM_CHARS ? `${clean.slice(0, MAX_FREE_FORM_CHARS)}…` : clean;
}

export interface SweeperCardDrift {
  readonly cardId: string;
  /** `null` when the Sweeper could not pin the card's bytes; such a card is skipped. */
  readonly cardSha256: string | null;
  readonly fromState: string;
  readonly toState: string;
  readonly section?: CardBlockSection;
  readonly block?: string;
}

export interface SweeperEscalationDrift {
  readonly source: { readonly kind: EscalationSourceKind; readonly ref: string; readonly createdAt: string };
  readonly title: string;
  readonly reason: string;
  readonly related: { readonly runRef?: string; readonly stopEvent?: string };
  /**
   * The server-derived escalation card path, or `null` when it is derived at publish time. The
   * AUTHORITATIVE source of this fact is the publisher's own
   * `ReconciliationSourceSnapshot.escalationCardPath`; this is the Sweeper's read of the same fact,
   * and a disagreement refuses the intent with 409 rather than publishing to either path.
   */
  readonly cardPath: string | null;
}

export interface SweeperMirrorDrift {
  readonly batchId: string;
  readonly targetWatermark: ScheduleMirrorWatermark;
  readonly manifest: DurablePathManifest;
}

export interface SweeperMergedMirror {
  readonly batchId: string;
  readonly pr: { readonly owner: string; readonly repo: string; readonly number: number; readonly mergeCommit: string };
  readonly mergedAt: string;
}

export interface SweeperSnapshot {
  readonly sourceRevision: string;
  readonly storeRevision: string;
  readonly cards: readonly SweeperCardDrift[];
  readonly escalations: readonly SweeperEscalationDrift[];
  readonly mirrorDrift: SweeperMirrorDrift | null;
  readonly mergedMirrors: readonly SweeperMergedMirror[];
}

/** The Sweeper's whole capability: one read. Any other member collapses `SweeperPorts` to never. */
export interface SweeperReadPorts {
  readSnapshot(): Promise<SweeperSnapshot>;
}

export interface SweeperContext {
  /** Per-fire reference. Diagnostic only: it is deliberately NOT an input to any dedup key. */
  readonly sweeperRef: string;
  /**
   * Fire-INDEPENDENT identity of what this Sweeper sweeps (its schedule/instance id). Together with
   * the failure class it forms the dedup identity of the failure escalation, so a flapping Sweeper
   * re-derives ONE key across fires and restarts instead of one card per fire.
   */
  readonly subjectRef: string;
  readonly now: string;
  readonly fallbackRevisions: { readonly sourceRevision: string; readonly storeRevision: string };
  readonly failureCardPath: string | null;
}

export interface SweeperOutcome {
  readonly intents: readonly ReconciliationIntent[];
  readonly failed: boolean;
  /** `true` when the per-kind cap dropped at least one derived intent this fire. */
  readonly truncated: boolean;
}

function seal<T extends ReconciliationIntent>(draft: T, cardPath?: string): T {
  const targeted = { ...draft, exactTargets: reconciliationExactTargets(draft, cardPath) } as T;
  return { ...targeted, idempotencyKey: reconciliationIdempotencyKey(targeted) };
}

function cardIntents(snapshot: SweeperSnapshot): ReconciliationIntent[] {
  const intents: ReconciliationIntent[] = [];
  for (const card of snapshot.cards) {
    if (card.cardSha256 === null) continue;
    intents.push(seal({
      schema: RECONCILIATION_INTENT_SCHEMA,
      kind: 'card-transition',
      actor: 'system-sweeper',
      idempotencyKey: '',
      expectedSourceRevision: snapshot.sourceRevision,
      expectedStoreRevision: snapshot.storeRevision,
      exactTargets: [],
      cardId: card.cardId,
      expectedCardSha256: card.cardSha256,
      fromState: card.fromState,
      toState: card.toState,
      ...(card.section === undefined ? {} : { section: card.section }),
      ...(card.block === undefined ? {} : { block: sweeperSafeText(card.block) }),
    } as ReconciliationIntent));
  }
  return intents;
}

function escalationIntents(snapshot: SweeperSnapshot): ReconciliationIntent[] {
  return snapshot.escalations.map((drift) => seal({
    schema: RECONCILIATION_INTENT_SCHEMA,
    kind: 'escalation-card',
    actor: 'system-sweeper',
    idempotencyKey: '',
    expectedSourceRevision: snapshot.sourceRevision,
    expectedStoreRevision: snapshot.storeRevision,
    exactTargets: [],
    source: drift.source,
    title: sweeperSafeText(drift.title),
    reason: sweeperSafeText(drift.reason),
    related: drift.related,
  } as ReconciliationIntent, drift.cardPath ?? undefined));
}

function mirrorIntents(snapshot: SweeperSnapshot): ReconciliationIntent[] {
  const intents: ReconciliationIntent[] = [];
  if (snapshot.mirrorDrift !== null) {
    intents.push(seal({
      schema: RECONCILIATION_INTENT_SCHEMA,
      kind: 'schedule-mirror',
      actor: 'system-sweeper',
      idempotencyKey: '',
      expectedSourceRevision: snapshot.sourceRevision,
      expectedStoreRevision: snapshot.storeRevision,
      exactTargets: [],
      batchId: snapshot.mirrorDrift.batchId,
      targetWatermark: snapshot.mirrorDrift.targetWatermark,
      manifest: snapshot.mirrorDrift.manifest,
    } as ReconciliationIntent));
  }
  for (const merged of snapshot.mergedMirrors) {
    intents.push(seal({
      schema: RECONCILIATION_INTENT_SCHEMA,
      kind: 'mirror-merged',
      actor: 'system-sweeper',
      idempotencyKey: '',
      expectedSourceRevision: snapshot.sourceRevision,
      expectedStoreRevision: snapshot.storeRevision,
      exactTargets: [],
      batchId: merged.batchId,
      pr: merged.pr,
      mergedAt: merged.mergedAt,
    } as ReconciliationIntent));
  }
  return intents;
}

/**
 * The dedup identity of a Sweeper execution failure: the failure CLASS (error name plus its
 * message with variable runs normalized away) bound to the fire-independent subject. Digits are
 * normalized so a timestamp, a port number, or an attempt counter inside the message cannot mint a
 * new escalation card on every fire.
 */
export function sweeperFailureRef(subjectRef: string, error: unknown): string {
  const name = error instanceof Error && error.name.length > 0 ? error.name : 'UnknownError';
  const message = sweeperSafeText(error instanceof Error ? error.message : String(error));
  const failureClass = `${name}:${message.replace(/\d+/g, '#').slice(0, 200)}`;
  return sha256Hex(`${failureClass}\u0000${subjectRef}`);
}

/**
 * One deduplicated `dashboard-supervisor` escalation for a Sweeper execution failure. The key is
 * `escalation:sweeper-failure:<sha256 of failure class + subject>` — failure-stable, NEVER the
 * per-fire reference, so repeated fires of the same failure collapse onto one card.
 */
export function sweeperFailureEscalation(context: SweeperContext, error: unknown): EscalationCardIntent {
  const reason = sweeperSafeText(error instanceof Error ? error.message : String(error));
  return seal({
    schema: RECONCILIATION_INTENT_SCHEMA,
    kind: 'escalation-card',
    actor: 'dashboard-supervisor',
    idempotencyKey: '',
    expectedSourceRevision: context.fallbackRevisions.sourceRevision,
    expectedStoreRevision: context.fallbackRevisions.storeRevision,
    exactTargets: [],
    source: {
      kind: 'sweeper-failure',
      ref: sweeperFailureRef(context.subjectRef, error),
      createdAt: context.now,
    },
    title: 'System Sweeper execution failed',
    reason: reason.length === 0 ? 'unknown Sweeper failure' : reason,
    related: {},
  } as EscalationCardIntent, context.failureCardPath ?? undefined) as EscalationCardIntent;
}

/** Drops repeated drift so one fire never emits the same idempotency key twice. */
export function dedupeReconciliationIntents(
  intents: readonly ReconciliationIntent[],
  seen: Set<string> = new Set<string>(),
): readonly ReconciliationIntent[] {
  const unique: ReconciliationIntent[] = [];
  for (const intent of intents) {
    if (seen.has(intent.idempotencyKey)) continue;
    seen.add(intent.idempotencyKey);
    unique.push(intent);
  }
  return unique;
}

/**
 * Applies `MAX_SWEEPER_INTENTS` with per-kind reserved slots, so a fire with hundreds of drifting
 * cards can never starve the escalation and mirror tails. Unused reservations spill to the other
 * kinds in group order; `truncated` reports that at least one derived intent was dropped.
 */
function capByKind(
  groups: readonly (readonly ReconciliationIntent[])[],
  reservations: readonly number[],
): { readonly intents: readonly ReconciliationIntent[]; readonly truncated: boolean } {
  const taken = groups.map((group, index) => Math.min(group.length, reservations[index] ?? 0));
  let spare = MAX_SWEEPER_INTENTS - taken.reduce((total, count) => total + count, 0);
  for (let index = 0; index < groups.length && spare > 0; index += 1) {
    const extra = Math.min(spare, groups[index]!.length - taken[index]!);
    taken[index] = taken[index]! + extra;
    spare -= extra;
  }
  const intents = groups.flatMap((group, index) => group.slice(0, taken[index]!));
  const truncated = groups.some((group, index) => group.length > taken[index]!);
  return { intents, truncated };
}

/**
 * Reads the snapshot and derives intents. It applies none of them: the returned intents are inert
 * until the one server-owned publisher accepts them.
 */
export async function runSweeper<T extends SweeperReadPorts>(
  ports: SweeperPorts<T>,
  context: SweeperContext,
): Promise<SweeperOutcome> {
  let snapshot: SweeperSnapshot;
  try {
    snapshot = await (ports as SweeperReadPorts).readSnapshot();
  } catch (error) {
    return { intents: [sweeperFailureEscalation(context, error)], failed: true, truncated: false };
  }
  const seen = new Set<string>();
  const groups = [
    dedupeReconciliationIntents(cardIntents(snapshot), seen),
    dedupeReconciliationIntents(escalationIntents(snapshot), seen),
    dedupeReconciliationIntents(mirrorIntents(snapshot), seen),
  ];
  const capped = capByKind(groups, [
    SWEEPER_KIND_RESERVATIONS.cards,
    SWEEPER_KIND_RESERVATIONS.escalations,
    SWEEPER_KIND_RESERVATIONS.mirrors,
  ]);
  return { intents: capped.intents, failed: false, truncated: capped.truncated };
}

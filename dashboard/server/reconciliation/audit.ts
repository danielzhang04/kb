// P4 section 3.4 reconciliation audit. An audit record is built by the server from the closed
// fields of the intent plus the revisions/paths/receipt the publisher observed — never from
// worker- or operator-supplied prose, and never carrying a secret. Free-form intent payload
// (`block`, `title`, `reason`, `related`) is deliberately NOT copied here: the record identifies an
// intent by its canonical hash, so the trail stays complete without echoing its body.
import { reconciliationIntentSha256 } from './contracts.ts';
import type { ReconciliationAuditRecord, ReconciliationIntent } from './contracts.ts';

/** Thrown when a value destined for the audit trail carries a credential-shaped token. */
export class AuditSecretError extends Error {
  readonly status = 500;
  readonly field: string;
  constructor(field: string) {
    super(`reconciliation audit refused: ${field} carries a credential-shaped value`);
    this.name = 'AuditSecretError';
    this.field = field;
  }
}

/**
 * Credential shapes that must never reach the trail. These are literal patterns on purpose — the
 * P2 rule "greps are evidence" forbids obfuscating them — and they are reported as allowed hits.
 *
 * SCOPE: this is a last-ditch refusal over the closed record's own fields (revisions, paths, keys,
 * timestamps, receipt, PR owner/repo), NOT redaction and NOT a wall over free-form prose — the
 * record deliberately carries none. Free-form `title`/`reason`/`block` are scrubbed where they are
 * BUILT (`sweeper.ts`) and where they are rendered into a card (W6.2). The patterns are
 * literal-prefix only, so a split or re-encoded token passes; that is acceptable precisely because
 * the fields reaching here are server-derived.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /ghp_[A-Za-z0-9]{16,}/,
  /github_pat_[A-Za-z0-9_]{16,}/,
  /sk-ant-[A-Za-z0-9_-]{16,}/,
  /ANTHROPIC_API_KEY/,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/,
];

export interface ReconciliationAuditSink {
  /** Appends the record and returns its durable audit reference. */
  append(record: ReconciliationAuditRecord): Promise<string>;
  /**
   * The audit ref of an already-appended record for this key and outcome, or `null`.
   *
   * The publisher's reconcile-prepared path uses it so one effect is audited EXACTLY once: after a
   * crash between the audit append and the receipt CAS, the replay finds the earlier record and
   * advances the receipt against it instead of appending a second `applied` row for one effect.
   */
  find(idempotencyKey: string, outcome: ReconciliationAuditRecord['outcome']): Promise<string | null>;
}

export interface ReconciliationAuditInput {
  readonly intent: ReconciliationIntent;
  readonly oldSourceRevision: string;
  readonly newSourceRevision: string;
  readonly oldStoreRevision: string;
  readonly newStoreRevision: string;
  readonly exactTargets: readonly string[];
  readonly publisherReceipt: string | null;
  readonly pr: { readonly owner: string; readonly repo: string; readonly number: number } | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: ReconciliationAuditRecord['outcome'];
}

function assertNoSecret(field: string, value: unknown): void {
  if (typeof value !== 'string') return;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) throw new AuditSecretError(field);
  }
}

/** Builds the closed audit record of section 3.4 and refuses any secret-bearing string. */
export function buildReconciliationAuditRecord(input: ReconciliationAuditInput): ReconciliationAuditRecord {
  const record: ReconciliationAuditRecord = {
    actor: input.intent.actor,
    intentKind: input.intent.kind,
    idempotencyKey: input.intent.idempotencyKey,
    intentSha256: reconciliationIntentSha256(input.intent),
    oldSourceRevision: input.oldSourceRevision,
    newSourceRevision: input.newSourceRevision,
    oldStoreRevision: input.oldStoreRevision,
    newStoreRevision: input.newStoreRevision,
    exactTargets: [...input.exactTargets],
    publisherReceipt: input.publisherReceipt,
    pr: input.pr === null ? null : { owner: input.pr.owner, repo: input.pr.repo, number: input.pr.number },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    outcome: input.outcome,
  };
  for (const [field, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => { assertNoSecret(`${field}[${index}]`, entry); });
      continue;
    }
    if (value !== null && typeof value === 'object') {
      for (const [nested, nestedValue] of Object.entries(value)) assertNoSecret(`${field}.${nested}`, nestedValue);
      continue;
    }
    assertNoSecret(field, value);
  }
  return record;
}

/** Builds the record and appends it, returning the sink's audit reference. */
export async function appendReconciliationAudit(
  sink: ReconciliationAuditSink,
  input: ReconciliationAuditInput,
): Promise<string> {
  return sink.append(buildReconciliationAuditRecord(input));
}

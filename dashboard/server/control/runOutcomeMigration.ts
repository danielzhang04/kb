import type { ArchivedFrom, RunIdentityFields, RunOutcome } from './p2Contracts.ts';
import type { RunLifecycleKind } from './runLifecycle.ts';

type OutcomeFields = Pick<RunIdentityFields, 'terminalOutcome' | 'completedAt' | 'archivedFrom'>;
type TerminalLifecycle = 'succeeded' | 'failed' | 'stopped';
type ArchiveState = ArchivedFrom;

export interface LegacyOutcomeEvent { createdAt: string; }
export interface LegacyOutcomeHumanRequest {
  requestRef: string;
  runRef: string;
  updatedAt: string;
  response: {
    requestRevision: number;
    decision: string;
    respondedBy: string;
    idempotencyKey: string;
    response: string | null;
    respondedAt: string;
  } | null;
}
export interface LegacyOutcomeMutationReceipt { createdAt?: string; claimedAt?: string; updatedAt?: string; recordedAt?: string; }
export interface LegacyArchiveAudit {
  ts: string;
  action: string;
  target: string | undefined;
  result: string | undefined;
  detail: Record<string, unknown> | undefined;
}

export interface LegacyRunOutcomeInput {
  runRef: string;
  subject: string;
  location: string;
  lifecycle: RunLifecycleKind;
  updatedAt: string;
  version: number;
  archiveOperationKey: string | null;
  humanRequests: readonly LegacyOutcomeHumanRequest[];
  events: readonly LegacyOutcomeEvent[];
  mutationReceipts: readonly LegacyOutcomeMutationReceipt[];
  auditRows: readonly LegacyArchiveAudit[];
  existing?: OutcomeFields | null;
  existingInvalid?: boolean;
}

export type RunOutcomeResolution =
  | { ok: true; value: OutcomeFields }
  | { ok: false; reason: 'archive-audit-required' | 'archive-audit-ambiguous' | 'terminal-order-unproven' | 'invalid-timestamp' | 'outcome-mismatch'; candidates: string[] };

export interface RunOutcomeMigrationError {
  runRef: string;
  location: string;
  fieldsSeen: string[];
  candidates: string[];
  reasons: Array<Extract<RunOutcomeResolution, { ok: false }>['reason']>;
}

export interface RunOutcomeMigrationReport {
  migration: 'migrateRunOutcomeV1';
  total: number;
  migrated: number;
  errors: RunOutcomeMigrationError[];
  truncated: boolean;
}

export interface RunOutcomeMigrationResult {
  items: Array<{ runRef: string; location: string; value: OutcomeFields }>;
  report: RunOutcomeMigrationReport;
}

const terminalOutcomes: Record<TerminalLifecycle, RunOutcome> = { succeeded: 'ok', failed: 'failed', stopped: 'stopped' };

function isIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function terminalAutoClose(input: LegacyRunOutcomeInput, lifecycle: TerminalLifecycle): { present: boolean; value: string | null } {
  const candidates = input.humanRequests.filter((request) => request.response?.decision === 'auto-closed'
    || request.response?.idempotencyKey.startsWith('auto-close:terminal:'));
  const values = candidates
    .filter((request) => request.runRef === input.runRef && request.response !== null
      && request.response.decision === 'auto-closed'
      && request.response.idempotencyKey === `auto-close:terminal:${lifecycle}:${input.runRef}:${request.requestRef}`
      && request.updatedAt === request.response.respondedAt)
    .map((request) => request.response!.respondedAt);
  return {
    present: candidates.length > 0,
    value: candidates.length === 1 && values.length === 1 && isIso(values[0])
      && Date.parse(values[0]) <= Date.parse(input.updatedAt) ? values[0] : null,
  };
}

function hasLaterEvidence(input: LegacyRunOutcomeInput, terminalAt: string): boolean {
  const terminalMs = Date.parse(terminalAt);
  const receiptTimes = input.mutationReceipts.flatMap((receipt) => [
    receipt.createdAt, receipt.claimedAt, receipt.updatedAt, receipt.recordedAt,
  ].filter((value): value is string => value !== undefined));
  return input.events.some((event) => !isIso(event.createdAt) || Date.parse(event.createdAt) > terminalMs)
    || receiptTimes.some((value) => !isIso(value) || Date.parse(value) > terminalMs);
}

function directTerminal(input: LegacyRunOutcomeInput, lifecycle: TerminalLifecycle): RunOutcomeResolution {
  if (!isIso(input.updatedAt)) return { ok: false, reason: 'invalid-timestamp', candidates: [] };
  const autoClose = terminalAutoClose(input, lifecycle);
  if (autoClose.present && autoClose.value === null) return { ok: false, reason: 'terminal-order-unproven', candidates: [] };
  const completedAt = autoClose.value ?? input.updatedAt;
  if (hasLaterEvidence(input, completedAt)) return { ok: false, reason: 'terminal-order-unproven', candidates: [] };
  return { ok: true, value: { terminalOutcome: terminalOutcomes[lifecycle], completedAt, archivedFrom: null } };
}

function archiveAudits(input: LegacyRunOutcomeInput): LegacyArchiveAudit[] {
  return input.auditRows.filter((row) => row.action === 'control-run-archive-authorize'
    && row.target === input.runRef
    && row.result === `authorized:${input.archiveOperationKey}`
    && row.detail?.runOwnerSubject === input.subject
    && row.detail?.runVersion === input.version - 1
    && typeof row.detail?.runState === 'string');
}

function isArchiveState(value: unknown): value is ArchiveState {
  return value === 'succeeded' || value === 'failed' || value === 'stopped' || value === 'interrupted' || value === 'waiting-human';
}

function archivedTerminal(input: LegacyRunOutcomeInput): RunOutcomeResolution {
  if (!isIso(input.updatedAt)) return { ok: false, reason: 'invalid-timestamp', candidates: [] };
  const audits = input.archiveOperationKey === null ? [] : archiveAudits(input);
  if (audits.length === 0) return { ok: false, reason: 'archive-audit-required', candidates: [] };
  if (audits.length !== 1) return { ok: false, reason: 'archive-audit-ambiguous', candidates: audits.map((row) => row.ts).sort() };
  if (!isIso(audits[0].ts) || Date.parse(audits[0].ts) > Date.parse(input.updatedAt)) {
    return { ok: false, reason: 'terminal-order-unproven', candidates: [] };
  }
  const state = audits[0].detail?.runState;
  if (!isArchiveState(state)) return { ok: false, reason: 'archive-audit-required', candidates: [] };
  if (state === 'interrupted') return { ok: true, value: { terminalOutcome: 'interrupted', completedAt: input.updatedAt, archivedFrom: state } };
  if (state === 'waiting-human') return { ok: true, value: { terminalOutcome: 'abandoned', completedAt: input.updatedAt, archivedFrom: state } };
  const autoClose = terminalAutoClose(input, state);
  const completedAt = autoClose.value;
  if (!autoClose.present || completedAt === null || Date.parse(completedAt) >= Date.parse(input.updatedAt) || hasLaterEvidence(input, completedAt)) {
    return { ok: false, reason: 'terminal-order-unproven', candidates: [] };
  }
  return { ok: true, value: { terminalOutcome: terminalOutcomes[state], completedAt, archivedFrom: state } };
}

function equalFields(left: OutcomeFields, right: OutcomeFields): boolean {
  return left.terminalOutcome === right.terminalOutcome && left.completedAt === right.completedAt && left.archivedFrom === right.archivedFrom;
}

export function resolveLegacyRunOutcome(input: LegacyRunOutcomeInput): RunOutcomeResolution {
  if (input.existingInvalid) return { ok: false, reason: 'outcome-mismatch', candidates: [] };
  const resolved = input.lifecycle === 'succeeded' || input.lifecycle === 'failed' || input.lifecycle === 'stopped'
    ? directTerminal(input, input.lifecycle)
    : input.lifecycle === 'archived'
      ? archivedTerminal(input)
      : { ok: true as const, value: { terminalOutcome: null, completedAt: null, archivedFrom: null } };
  if (!resolved.ok || input.existing == null) return resolved;
  return equalFields(resolved.value, input.existing)
    ? resolved
    : { ok: false, reason: 'outcome-mismatch', candidates: [] };
}

function fieldsSeen(): string[] {
  return ['archiveOperationKey', 'lifecycle', 'updatedAt'];
}

export function migrateRunOutcomes(inputs: readonly LegacyRunOutcomeInput[], limit = 100): RunOutcomeMigrationResult {
  const items: RunOutcomeMigrationResult['items'] = [];
  const errors: RunOutcomeMigrationError[] = [];
  for (const input of inputs) {
    const resolved = resolveLegacyRunOutcome(input);
    if (resolved.ok) items.push({ runRef: input.runRef, location: input.location, value: resolved.value });
    else errors.push({ runRef: input.runRef, location: input.location, fieldsSeen: fieldsSeen(), candidates: resolved.candidates, reasons: [resolved.reason] });
  }
  errors.sort((left, right) => left.runRef.localeCompare(right.runRef) || left.location.localeCompare(right.location));
  return {
    items,
    report: {
      migration: 'migrateRunOutcomeV1', total: inputs.length, migrated: items.length,
      errors: errors.slice(0, limit), truncated: errors.length > limit,
    },
  };
}

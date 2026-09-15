// P6 W5 §3.5: the report state machine. Reports drive the SAME transitions the VM-local execution path
// uses — there is no host-report-only lifecycle and no second projection. `gate-opened` OPENS a
// `HumanRequest` through `ReportStorePort#openHumanRequest`; the port carries NO method that could
// resolve one, so a host literally cannot burn a T3 ceremony from this file — the human-response route
// is the operator's alone [§3.6]. A gate whose title/prompt the store would reject is refused `400`
// here, before the event append and the sequence bump. A second `completed`/`failed` on an already-terminal run refuses
// `409 run-already-terminal` and leaves `terminalOutcome`/`completedAt` untouched; an out-of-sequence
// report refuses `409 report-out-of-order` with NO state change. The exact-key wall is W0's
// `decodeReportRequest` — this file adds no field of its own to the wire body.
//
// This file NEVER imports `control/store.ts`; all state lives behind the injected `ReportStorePort`.
import { ContractDecodeError, decodeReportRequest } from '../api/v1/contracts.ts';
import type { ReportKind, ReportRequest } from '../api/v1/contracts.ts';
import type { HostKind, PlacementLease } from './contracts.ts';
import type { HumanRequestKind } from '../control/types.ts';

export type RunTerminalOutcome = 'ok' | 'failed' | 'stopped' | 'interrupted' | 'abandoned';

export interface RunTerminalState {
  readonly terminalOutcome: RunTerminalOutcome | null;
  readonly completedAt: string | null;
}

export interface OpenHumanRequestInput {
  readonly runRef: string;
  readonly stageRef: string | null;
  readonly kind: HumanRequestKind;
  readonly title: string;
  readonly prompt: string;
  readonly createdAt: string;
}

/**
 * The report store's whole surface. Deliberately has NO `respondHumanRequest`/`resolve*` method: a
 * report can open a gate but this port gives it no way to ever close one [§3.5, §3.6].
 */
export interface ReportStorePort {
  getLease(runRef: string): Promise<PlacementLease | undefined>;
  getRunTerminalState(runRef: string): Promise<RunTerminalState>;
  currentAdvertisedCapabilityHash(hostId: HostKind): Promise<string | undefined>;
  appendReportEvent(runRef: string, kind: ReportKind, payload: Record<string, unknown>, sequence: number): Promise<void>;
  bumpLeaseSequence(runRef: string, sequence: number): Promise<void>;
  markTerminal(runRef: string, outcome: 'ok' | 'failed', completedAt: string): Promise<void>;
  openHumanRequest(input: OpenHumanRequestInput): Promise<{ readonly requestRef: string }>;
}

export interface SubmitReportInput {
  readonly runRef: string;
  readonly hostId: HostKind;
  readonly body: unknown;
  readonly nowIso: string;
}

export type SubmitReportRefusal =
  | { readonly ok: false; readonly status: 400; readonly code: 'unknown-key'; readonly field: string }
  | { readonly ok: false; readonly status: 403; readonly code: 'wrong-host' }
  | { readonly ok: false; readonly status: 409; readonly code: 'lease-expired' }
  | { readonly ok: false; readonly status: 409; readonly code: 'capability-lost' }
  | {
      readonly ok: false; readonly status: 409; readonly code: 'run-already-terminal';
      readonly terminalOutcome: RunTerminalOutcome; readonly completedAt: string | null;
    }
  | { readonly ok: false; readonly status: 409; readonly code: 'report-out-of-order' };

export type SubmitReportOutcome =
  | { readonly ok: true; readonly requestRef?: string }
  | SubmitReportRefusal;

/**
 * `gate-opened` maps to the ordinary `input` human-request channel by default. A report MAY name a
 * T3 gate kind (`approval`/`review`/`governance-refusal`) via `payload.gateRequestKind`; anything else
 * is refused before any store write rather than silently downgraded to `input`.
 */
const GATE_REQUEST_KINDS: readonly HumanRequestKind[] = ['input', 'approval', 'review', 'intervention', 'governance-refusal'];

/**
 * The gate title/prompt acceptance test, mirrored from the store's `createHumanRequest`
 * (`control/store.ts`: `validNonEmpty(title, MAX_TITLE)` / `validNonEmpty(prompt, MAX_LONG_TEXT)`).
 * Mirrored rather than imported because this file never imports the store; the mirror is safe in one
 * direction only, and that is the direction it is used in — text this predicate accepts but the store
 * would not is the only drift that could still throw, and both bounds here are the store's own.
 */
const MAX_GATE_TITLE_CHARS = 240;
const MAX_GATE_PROMPT_CHARS = 64 * 1024;
function validGateText(value: string, max: number): boolean {
  return value.trim().length > 0 && value.length <= max && !value.includes('\0');
}

function decodeOrRefuse(body: unknown): { ok: true; value: ReportRequest } | { ok: false; refusal: SubmitReportRefusal } {
  try {
    return { ok: true, value: decodeReportRequest(body) };
  } catch (err) {
    if (err instanceof ContractDecodeError) {
      return { ok: false, refusal: { ok: false, status: 400, code: 'unknown-key', field: err.field } };
    }
    throw err;
  }
}

/**
 * Submit a report. Order: decode (exact-key wall) -> terminal-state check (catches a duplicate
 * `completed`/`failed` even if the lease is already gone) -> lease/host/expiry/capability checks ->
 * sequence check -> apply. Every refusal branch returns before any `port` write.
 */
export async function submitReport(port: ReportStorePort, input: SubmitReportInput): Promise<SubmitReportOutcome> {
  const decoded = decodeOrRefuse(input.body);
  if (!decoded.ok) return decoded.refusal;
  const report = decoded.value;

  const terminal = await port.getRunTerminalState(input.runRef);
  if (terminal.terminalOutcome !== null) {
    return {
      ok: false, status: 409, code: 'run-already-terminal',
      terminalOutcome: terminal.terminalOutcome, completedAt: terminal.completedAt,
    };
  }

  const lease = await port.getLease(input.runRef);
  if (!lease) return { ok: false, status: 409, code: 'lease-expired' };
  if (lease.hostId !== input.hostId) return { ok: false, status: 403, code: 'wrong-host' };
  if (Date.parse(lease.expiresAt) <= Date.parse(input.nowIso)) return { ok: false, status: 409, code: 'lease-expired' };
  if (lease.revision !== report.expectedLeaseRevision) return { ok: false, status: 409, code: 'lease-expired' };

  const currentHash = await port.currentAdvertisedCapabilityHash(input.hostId);
  if (currentHash !== undefined && currentHash !== lease.capabilityHash) {
    return { ok: false, status: 409, code: 'capability-lost' };
  }

  if (report.sequence !== lease.lastReportSequence + 1) {
    return { ok: false, status: 409, code: 'report-out-of-order' };
  }

  if (report.kind === 'gate-opened') {
    const rawGateKind = report.payload.gateRequestKind;
    let gateKind: HumanRequestKind;
    if (rawGateKind === undefined) {
      gateKind = 'input';
    } else if ((GATE_REQUEST_KINDS as readonly unknown[]).includes(rawGateKind)) {
      gateKind = rawGateKind as HumanRequestKind;
    } else {
      // A defined-but-invalid gateRequestKind is a clean refusal, not a throw: this branch runs
      // before any port write, same as every other exact-key refusal in this file (W5b fix #2).
      return { ok: false, status: 400, code: 'unknown-key', field: 'payload.gateRequestKind' };
    }
    const title = typeof report.payload.title === 'string' ? report.payload.title : `Gate for ${input.runRef}`;
    const prompt = typeof report.payload.prompt === 'string' ? report.payload.prompt : '';
    // The gate text is validated HERE, before the event append and the sequence bump — not left to the
    // store. `openHumanRequest` is the LAST of this branch's three writes and the store refuses an empty
    // title/prompt, so a prompt-less `gate-opened` that got this far would append an event, consume the
    // sequence, open no gate, and throw: the host then retries at a sequence the lease has already
    // advanced past and gets `409 report-out-of-order` forever. Same refusal shape as the
    // `gateRequestKind` wall above, and like it, before any port write (W5b fix #2).
    if (!validGateText(prompt, MAX_GATE_PROMPT_CHARS)) {
      return { ok: false, status: 400, code: 'unknown-key', field: 'payload.prompt' };
    }
    if (!validGateText(title, MAX_GATE_TITLE_CHARS)) {
      return { ok: false, status: 400, code: 'unknown-key', field: 'payload.title' };
    }
    const stageRef = typeof report.payload.stageRef === 'string' ? report.payload.stageRef : null;
    await port.appendReportEvent(input.runRef, report.kind, report.payload, report.sequence);
    await port.bumpLeaseSequence(input.runRef, report.sequence);
    const { requestRef } = await port.openHumanRequest({
      runRef: input.runRef, stageRef, kind: gateKind, title, prompt, createdAt: input.nowIso,
    });
    return { ok: true, requestRef };
  }

  await port.appendReportEvent(input.runRef, report.kind, report.payload, report.sequence);
  await port.bumpLeaseSequence(input.runRef, report.sequence);

  if (report.kind === 'completed') await port.markTerminal(input.runRef, 'ok', input.nowIso);
  else if (report.kind === 'failed') await port.markTerminal(input.runRef, 'failed', input.nowIso);

  return { ok: true };
}

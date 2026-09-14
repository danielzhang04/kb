import { useEffect, useRef, useState } from 'react';
import { GenSourceRead } from './GenSourceRead.tsx';

export interface StudioGenPlan { schema: 'figment/studio-gen-plan@1'; id: string; status: 'prepared'; creator: 'creator-001'; stage: 'gen'; runCount: 1; declaredCeilingUsd: number; planSha256: string; }
export type PreparationAvailability = 'available' | 'busy' | 'at-capacity' | 'maintenance-required' | 'unavailable';
interface GenExecutionReceipt { startedUtc: string; finishedUtc: string; terminationVerified: boolean | null; outputCount: number; preflightEstimateUsd: number; estimatedActualUsd: number | null; failure: 'bootstrap' | 'run' | null; }
type GenExecutionState = { status: 'unavailable'; reason: 'evidence-unavailable' }
  | { status: 'recorded'; planSha256: string; creator: 'creator-001'; stage: 'gen';
      execution: 'no-stage-record' | 'recorded-running' | 'recorded-failed' | 'recorded-completed';
      liveness: 'unknown' | null; quality: 'not-assessed'; declaredCeilingUsd: number; maxMinutes: number;
      receipt: GenExecutionReceipt | null };
export interface RecordedSlot { briefId: string; briefSha256: string; slotIndex: number; role: string; kind: 'persona'; taxonomyType: string; }
type AssignmentState = { status: 'recorded'; recordKind: 'planning-snapshot'; currentSourceRevalidated: false; slots: RecordedSlot[] }
  | { status: 'unavailable'; reason: 'evidence-unavailable' | 'outside-content-authority-root' };
export interface StudioGenPlansResponse { schema: 'figment/studio-gen-plans@2' | 'figment/studio-gen-plans@3'; requestScope: string; plans: StudioGenPlan[]; preparation: PreparationAvailability; executionRecords: Array<{ id: string; planSha256: string; state: GenExecutionState }>; assignmentRecords: Array<{ id: string; planSha256: string; state: AssignmentState }>; }
interface PendingRecord { requestScope: string; key: string; }
type PendingRead = { kind: 'missing' } | { kind: 'valid'; record: PendingRecord } | { kind: 'blocked' };
type PendingState = { kind: 'unknown' } | { kind: 'none' } | { kind: 'same'; key: string } | { kind: 'blocked'; message: string };
type Inventory = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: StudioGenPlansResponse; token?: string; fetchImpl: typeof fetch; ownerGeneration: number };
interface Ticket { epoch: number; }

const PLANS_URL = '/api/figment/studio/gen-plans';
const PLAN_URL = '/api/figment/studio/gen-plan';
const STORAGE_KEY = 'figment.studio.genPlan.pending.v1';
const PENDING_SCHEMA = 'figment/studio-gen-plan-pending@1';
const PENDING_MAX_CHARS = 512;
const GET_MAX_CHARS = 65536;
const POST_MAX_CHARS = 16384;
const KEY_RE = /^[0-9a-f]{48}$/;
const PLAN_KEYS = ['declaredCeilingUsd', 'creator', 'id', 'planSha256', 'runCount', 'schema', 'stage', 'status'].sort();
const PLANS_KEYS = ['executionRecords', 'plans', 'preparation', 'requestScope', 'schema'];
const EXECUTION_KEYS = ['creator', 'declaredCeilingUsd', 'execution', 'liveness', 'maxMinutes', 'planSha256', 'quality', 'receipt', 'stage', 'status'];
const RECEIPT_KEYS = ['estimatedActualUsd', 'failure', 'finishedUtc', 'outputCount', 'preflightEstimateUsd', 'startedUtc', 'terminationVerified'];
const PENDING_KEYS = ['key', 'requestScope', 'schema'];
const GET_UNAVAILABLE = 'Studio generation plans are unavailable.';
const PREPARE_UNAVAILABLE = 'Generation plan preparation is unavailable. A current selected checkpoint and source authority are required before a plan can be prepared.';
const STORAGE_BLOCKED = 'A generation plan request could not be recorded. Preparation is blocked until it can be.';
const PENDING_UNREADABLE = 'A stored generation plan request could not be read. Preparation is blocked and the stored request has been left in place.';
const PENDING_FOREIGN = 'A stored generation plan request belongs to a different operator or workspace. Preparation is blocked and the stored request has been left in place.';
const CLEAR_FAILED = 'The generation plan was prepared, but its pending request record could not be cleared. New preparation is blocked; resuming replays the same request.';
const AVAILABILITY_COPY: Record<PreparationAvailability, string> = {
  'available': 'Local preparation checks passed. Checkpoint and source authority are checked when preparation runs.',
  'busy': 'Another preparation is in progress. Refresh status once it finishes.',
  'at-capacity': 'At capacity: two prepared plans already exist. New preparation is disabled; a pending request can still be resumed.',
  'maintenance-required': 'Maintenance is required before new plans can be prepared. A pending request can still be resumed.',
  'unavailable': 'Local preparation is unavailable.',
};
const RESUMABLE: ReadonlySet<PreparationAvailability> = new Set(['available', 'at-capacity', 'maintenance-required']);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => { const actual = Object.keys(value).sort(); return actual.length === keys.length && actual.every((key, index) => key === keys[index]); };
const isAvailability = (value: unknown): value is PreparationAvailability => typeof value === 'string' && Object.prototype.hasOwnProperty.call(AVAILABILITY_COPY, value);
const authHeaders = (token?: string): Record<string, string> => token ? { authorization: `Bearer ${token}` } : {};

export function validStudioGenPlan(value: unknown): StudioGenPlan | null {
  if (!object(value) || !exactKeys(value, PLAN_KEYS)) return null;
  const valid = value.schema === 'figment/studio-gen-plan@1' && typeof value.id === 'string' && /^[0-9a-f-]{36}$/.test(value.id) && value.status === 'prepared' && value.creator === 'creator-001' && value.stage === 'gen' && value.runCount === 1
    && typeof value.declaredCeilingUsd === 'number' && Number.isFinite(value.declaredCeilingUsd) && value.declaredCeilingUsd >= 0 && value.declaredCeilingUsd <= 50 && isSha256(value.planSha256);
  return valid ? { schema: 'figment/studio-gen-plan@1', id: value.id as string, status: 'prepared', creator: 'creator-001', stage: 'gen', runCount: 1, declaredCeilingUsd: value.declaredCeilingUsd as number, planSha256: value.planSha256 as string } : null;
}

function validExecutionState(value: unknown, plan: StudioGenPlan): GenExecutionState | null {
  if (!object(value)) return null;
  if (value.status === 'unavailable') return exactKeys(value, ['reason', 'status']) && value.reason === 'evidence-unavailable'
    ? { status: 'unavailable', reason: 'evidence-unavailable' } : null;
  const finite = (item: unknown, maximum: number): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= maximum;
  const date = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 40 && Number.isFinite(Date.parse(item));
  if (!exactKeys(value, EXECUTION_KEYS) || value.status !== 'recorded' || value.planSha256 !== plan.planSha256
    || value.creator !== plan.creator || value.stage !== plan.stage || value.quality !== 'not-assessed'
    || value.declaredCeilingUsd !== plan.declaredCeilingUsd || !finite(value.declaredCeilingUsd, 50) || value.declaredCeilingUsd <= 0
    || !finite(value.maxMinutes, 840) || !Number.isInteger(value.maxMinutes) || value.maxMinutes <= 0) return null;
  const execution = value.execution;
  if (execution !== 'no-stage-record' && execution !== 'recorded-running' && execution !== 'recorded-failed' && execution !== 'recorded-completed') return null;
  let receipt: GenExecutionReceipt | null = null;
  if (value.receipt !== null) {
    const raw = value.receipt;
    if (!object(raw) || !exactKeys(raw, RECEIPT_KEYS) || !date(raw.startedUtc) || !date(raw.finishedUtc)
      || Date.parse(raw.finishedUtc) < Date.parse(raw.startedUtc) || !finite(raw.outputCount, 128) || !Number.isInteger(raw.outputCount)
      || !finite(raw.preflightEstimateUsd, value.declaredCeilingUsd) || raw.preflightEstimateUsd <= 0
      || (raw.estimatedActualUsd !== null && !finite(raw.estimatedActualUsd, 50))
      || (raw.terminationVerified !== null && typeof raw.terminationVerified !== 'boolean')
      || (raw.failure !== null && raw.failure !== 'bootstrap' && raw.failure !== 'run')) return null;
    receipt = { startedUtc: raw.startedUtc, finishedUtc: raw.finishedUtc, outputCount: raw.outputCount,
      preflightEstimateUsd: raw.preflightEstimateUsd, estimatedActualUsd: raw.estimatedActualUsd,
      terminationVerified: raw.terminationVerified, failure: raw.failure };
  }
  if (execution === 'no-stage-record' || execution === 'recorded-running') {
    if (receipt !== null || value.liveness !== 'unknown') return null;
  } else if (execution === 'recorded-completed') {
    if (receipt === null || value.liveness !== null || receipt.terminationVerified !== true || receipt.failure !== null
      || receipt.outputCount < 3 || receipt.outputCount > 96 || receipt.outputCount % 3 !== 0) return null;
  } else if (receipt === null ? value.liveness !== 'unknown' : value.liveness !== null || receipt.failure === null) return null;
  return { status: 'recorded', planSha256: plan.planSha256, creator: 'creator-001', stage: 'gen', execution,
    liveness: receipt === null ? 'unknown' : null, quality: 'not-assessed', declaredCeilingUsd: value.declaredCeilingUsd,
    maxMinutes: value.maxMinutes, receipt };
}

function validAssignmentState(value: unknown, seen: Set<string>): AssignmentState | null {
  if (!object(value)) return null;
  if (value.status === 'unavailable') return exactKeys(value, ['reason', 'status'])
    && (value.reason === 'evidence-unavailable' || value.reason === 'outside-content-authority-root')
    ? { status: 'unavailable', reason: value.reason } : null;
  if (!exactKeys(value, ['currentSourceRevalidated', 'recordKind', 'slots', 'status']) || value.status !== 'recorded'
    || value.recordKind !== 'planning-snapshot' || value.currentSourceRevalidated !== false || !Array.isArray(value.slots) || value.slots.length > 64) return null;
  const slots: RecordedSlot[] = [];
  for (const row of value.slots) {
    if (!object(row) || !exactKeys(row, ['briefId', 'briefSha256', 'kind', 'role', 'slotIndex', 'taxonomyType'])
      || typeof row.briefId !== 'string' || row.briefId.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.briefId)
      || !isSha256(row.briefSha256) || typeof row.slotIndex !== 'number' || !Number.isInteger(row.slotIndex) || row.slotIndex < 1 || row.slotIndex > 16
      || typeof row.role !== 'string' || row.role.length < 1 || row.role.length > 80 || /[\u0000-\u001f\u007f]/.test(row.role)
      || row.kind !== 'persona' || typeof row.taxonomyType !== 'string' || !/^[A-Z][A-Z0-9-]{0,15}$/.test(row.taxonomyType)) return null;
    const key = `${row.briefId}:${row.briefSha256}:${row.slotIndex}`;
    if (seen.has(key) || seen.size >= 64) return null;
    seen.add(key);
    slots.push({ briefId: row.briefId, briefSha256: row.briefSha256, slotIndex: row.slotIndex, role: row.role, kind: 'persona', taxonomyType: row.taxonomyType });
  }
  return { status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, slots };
}
function validPlansResponse(value: unknown): StudioGenPlansResponse | null {
  if (!object(value) || (value.schema !== 'figment/studio-gen-plans@2' && value.schema !== 'figment/studio-gen-plans@3')
    || !exactKeys(value, value.schema === 'figment/studio-gen-plans@3' ? ['assignmentRecords', ...PLANS_KEYS] : PLANS_KEYS)
    || !isSha256(value.requestScope) || !isAvailability(value.preparation)) return null;
  if (!Array.isArray(value.plans) || value.plans.length > 2) return null;
  const plans: StudioGenPlan[] = [];
  for (const item of value.plans) {
    const decoded = validStudioGenPlan(item);
    if (decoded === null || plans.some((plan) => plan.id === decoded.id)) return null;
    plans.push(decoded);
  }
  if (!Array.isArray(value.executionRecords) || value.executionRecords.length !== plans.length) return null;
  const executionRecords: StudioGenPlansResponse['executionRecords'] = [];
  for (const [index, item] of value.executionRecords.entries()) {
    const plan = plans[index];
    if (!object(item) || !exactKeys(item, ['id', 'planSha256', 'state']) || item.id !== plan.id || item.planSha256 !== plan.planSha256) return null;
    const state = validExecutionState(item.state, plan);
    if (state === null) return null;
    executionRecords.push({ id: plan.id, planSha256: plan.planSha256, state });
  }
  const assignmentRecords: StudioGenPlansResponse['assignmentRecords'] = [];
  if (value.schema === 'figment/studio-gen-plans@2') {
    for (const plan of plans) assignmentRecords.push({ id: plan.id, planSha256: plan.planSha256, state: { status: 'unavailable', reason: 'evidence-unavailable' } });
  } else {
    if (!Array.isArray(value.assignmentRecords) || value.assignmentRecords.length !== plans.length) return null;
    const seen = new Set<string>();
    for (const [index, row] of value.assignmentRecords.entries()) {
      const plan = plans[index];
      if (!object(row) || !exactKeys(row, ['id', 'planSha256', 'state']) || row.id !== plan.id || row.planSha256 !== plan.planSha256) return null;
      const state = validAssignmentState(row.state, seen);
      if (state === null) return null;
      assignmentRecords.push({ id: plan.id, planSha256: plan.planSha256, state });
    }
  }
  return { schema: value.schema, requestScope: value.requestScope as string, plans, preparation: value.preparation as PreparationAvailability, executionRecords, assignmentRecords };
}

function executionCopy(state: GenExecutionState): string {
  if (state.status === 'unavailable') return 'Recorded execution status is unavailable.';
  switch (state.execution) {
    case 'no-stage-record': return 'No stage record; attempt history is unknown.';
    case 'recorded-running': return 'Recorded running; current liveness is unknown.';
    case 'recorded-failed': return 'Recorded failure.';
    case 'recorded-completed': return 'Recorded completion; media quality has not been assessed.';
  }
}

async function boundedJson(response: Response, maxChars: number): Promise<unknown> {
  try {
    const text = await response.text();
    return text.length > maxChars ? null : JSON.parse(text) as unknown;
  } catch { return null; }
}

// Anything present but unreadable is reported as blocked, never as missing, so it is never overwritten.
function readPending(): PendingRead {
  let raw: string | null;
  try { raw = sessionStorage.getItem(STORAGE_KEY); } catch { return { kind: 'blocked' }; }
  if (raw === null) return { kind: 'missing' };
  if (typeof raw !== 'string' || raw.length > PENDING_MAX_CHARS) return { kind: 'blocked' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { kind: 'blocked' }; }
  if (!object(parsed) || !exactKeys(parsed, PENDING_KEYS) || parsed.schema !== PENDING_SCHEMA || !isSha256(parsed.requestScope) || typeof parsed.key !== 'string' || !KEY_RE.test(parsed.key)) return { kind: 'blocked' };
  return { kind: 'valid', record: { requestScope: parsed.requestScope as string, key: parsed.key as string } };
}

const matches = (read: PendingRead, record: PendingRecord): boolean => read.kind === 'valid' && read.record.requestScope === record.requestScope && read.record.key === record.key;

function pendingFor(scope: string): PendingState {
  const read = readPending();
  if (read.kind === 'missing') return { kind: 'none' };
  if (read.kind === 'blocked') return { kind: 'blocked', message: PENDING_UNREADABLE };
  return read.record.requestScope === scope ? { kind: 'same', key: read.record.key } : { kind: 'blocked', message: PENDING_FOREIGN };
}

// Only called after readPending() reported missing; the record is verified by read-back before any POST.
function writePending(record: PendingRecord): boolean {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: PENDING_SCHEMA, requestScope: record.requestScope, key: record.key })); } catch { return false; }
  return matches(readPending(), record);
}

// Removes only the exact record; a different or unreadable record is left untouched.
function clearPending(record: PendingRecord): 'cleared' | 'absent' | 'changed' | 'failed' {
  const current = readPending();
  if (current.kind === 'missing') return 'absent';
  if (current.kind === 'blocked') return 'failed';
  if (!matches(current, record)) return 'changed';
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { return 'failed'; }
  return readPending().kind === 'missing' ? 'cleared' : 'failed';
}

function newKey(): string {
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function StudioGenPlans({ token, fetchImpl, onOpenRecordedSlot }: { token?: string; fetchImpl: typeof fetch; onOpenRecordedSlot?: (target: RecordedSlot) => void }) {
  const [inventory, setInventory] = useState<Inventory>({ status: 'loading' });
  const [pending, setPending] = useState<PendingState>({ kind: 'unknown' });
  const [preparePending, setPreparePending] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<StudioGenPlan | null>(null);
  // epoch changes on every auth/fetch change and unmount (StrictMode-safe); getSeq orders GETs; inFlight is the synchronous one-intent guard.
  const epoch = useRef(0);
  const getSeq = useRef(0);
  const inFlight = useRef<Ticket | null>(null);
  const owner = useRef({ token, fetchImpl, generation: 0 });
  if (owner.current.token !== token || owner.current.fetchImpl !== fetchImpl) {
    owner.current = { token, fetchImpl, generation: owner.current.generation + 1 };
    epoch.current += 1;
    inFlight.current = null;
  }
  const renderOwner = owner.current;
  const [displayOwner, setDisplayOwner] = useState(renderOwner);

  const loadInventory = (activeEpoch: number): void => {
    if (owner.current !== renderOwner || epoch.current !== activeEpoch) return;
    const seq = ++getSeq.current;
    setInventory({ status: 'loading' });
    const current = (): boolean => owner.current === renderOwner && epoch.current === activeEpoch && getSeq.current === seq;
    void fetchImpl(PLANS_URL, { headers: authHeaders(token) }).then(async (response) => {
      const decoded = response.ok ? validPlansResponse(await boundedJson(response, GET_MAX_CHARS)) : null;
      if (!current()) return;
      if (decoded === null) { setInventory({ status: 'failed' }); return; }
      setInventory({ status: 'ready', data: decoded, token, fetchImpl, ownerGeneration: renderOwner.generation });
      setPending(pendingFor(decoded.requestScope));
    }).catch(() => { if (current()) setInventory({ status: 'failed' }); });
  };

  useEffect(() => {
    setDisplayOwner(renderOwner);
    const activeEpoch = ++epoch.current;
    inFlight.current = null;
    setPreparePending(false); setPrepareError(null); setPrepared(null); setPending({ kind: 'unknown' });
    loadInventory(activeEpoch);
    return () => { epoch.current += 1; inFlight.current = null; };
  }, [token, fetchImpl, renderOwner]); // A new owner generation must load even if credentials return to earlier values.

  const release = (ticket: Ticket): boolean => {
    if (owner.current !== renderOwner || epoch.current !== ticket.epoch || inFlight.current !== ticket) return false;
    inFlight.current = null;
    setPreparePending(false);
    return true;
  };

  const submit = (ticket: Ticket, record: PendingRecord): void => {
    if (owner.current !== renderOwner || epoch.current !== ticket.epoch || inFlight.current !== ticket) return;
    if (!matches(readPending(), record)) {
      const derived = pendingFor(record.requestScope);
      setPending(derived.kind === 'none' ? { kind: 'blocked', message: STORAGE_BLOCKED } : derived);
      release(ticket);
      return;
    }
    setPreparePending(true);
    void fetchImpl(PLAN_URL, { method: 'POST', headers: { ...authHeaders(token), 'Idempotency-Key': record.key, 'X-Figment-Intent-Scope': record.requestScope } }).then(async (response) => {
      const plan = response.ok ? validStudioGenPlan(await boundedJson(response, POST_MAX_CHARS)) : null;
      if (owner.current !== renderOwner || epoch.current !== ticket.epoch || inFlight.current !== ticket) return;
      if (plan === null) { setPrepareError(PREPARE_UNAVAILABLE); return; }
      setPrepared(plan);
      if (clearPending(record) === 'failed') { setPending({ kind: 'same', key: record.key }); setPrepareError(CLEAR_FAILED); }
    }).catch(() => { if (owner.current === renderOwner && epoch.current === ticket.epoch && inFlight.current === ticket) setPrepareError(PREPARE_UNAVAILABLE); })
      .finally(() => { if (release(ticket)) loadInventory(ticket.epoch); });
  };

  // Only an inventory fetched with this render's exact token/fetchImpl may gate a dispatch or the display; a token/fetchImpl
  // change invalidates it until a fresh GET completes, even if the passive epoch-bump effect has not run yet.
  const currentInventory = (): StudioGenPlansResponse | null =>
    owner.current === renderOwner && inventory.status === 'ready' && inventory.token === token && inventory.fetchImpl === fetchImpl
      && inventory.ownerGeneration === renderOwner.generation ? inventory.data : null;

  const prepareNew = (): void => {
    const data = currentInventory();
    if (inFlight.current !== null || data === null || data.preparation !== 'available' || pending.kind !== 'none') return;
    const ticket: Ticket = { epoch: epoch.current };
    inFlight.current = ticket;
    const scope = data.requestScope;
    setPrepareError(null); setPrepared(null);
    const before = pendingFor(scope);
    if (before.kind !== 'none') { setPending(before); release(ticket); return; }
    let key: string;
    try { key = newKey(); } catch { setPrepareError(PREPARE_UNAVAILABLE); release(ticket); return; }
    const record = { requestScope: scope, key };
    if (!writePending(record)) {
      const derived = pendingFor(scope);
      setPending(derived.kind === 'none' ? { kind: 'blocked', message: STORAGE_BLOCKED } : derived);
      release(ticket);
      return;
    }
    setPending({ kind: 'same', key });
    submit(ticket, record);
  };

  const resume = (): void => {
    const data = currentInventory();
    if (inFlight.current !== null || data === null || pending.kind !== 'same' || !RESUMABLE.has(data.preparation)) return;
    const ticket: Ticket = { epoch: epoch.current };
    inFlight.current = ticket;
    setPrepareError(null);
    submit(ticket, { requestScope: data.requestScope, key: pending.key });
  };

  const refresh = (): void => {
    if (owner.current !== renderOwner || inFlight.current !== null || inventory.status === 'loading') return;
    loadInventory(epoch.current);
  };

  const ready = currentInventory();
  const canPrepareNew = ready !== null && ready.preparation === 'available' && pending.kind === 'none' && !preparePending;
  const canResume = ready !== null && pending.kind === 'same' && RESUMABLE.has(ready.preparation) && !preparePending;

  if (displayOwner !== renderOwner) return <section className="figment__preview"><h2>Prepare generation plan</h2><p role="status">Checking preparation status…</p></section>;

  const assignments = (state: AssignmentState): React.JSX.Element => state.status === 'unavailable'
    ? <p>{state.reason === 'outside-content-authority-root' ? 'This legacy plan is outside the content-assignment root.' : 'Recorded assignment evidence is unavailable.'}</p>
    : <div><p>Matching records in the bounded current inventory. Sources and image approval were not revalidated.</p>
      {state.slots.length === 0 ? <p>No matching assignment records in this inventory.</p> : <ul>{state.slots.map((slot) => <li key={`${slot.briefId}:${slot.briefSha256}:${slot.slotIndex}`}>
        Recorded planning assignment: {slot.briefId} · revision {slot.briefSha256.slice(0, 12)} · slot {slot.slotIndex}: {slot.role}
        {onOpenRecordedSlot ? <button type="button" className="mc-btn" aria-label={`View ${slot.briefId} slot ${slot.slotIndex}`} onClick={() => { if (currentInventory() !== null && owner.current === renderOwner) onOpenRecordedSlot(slot); }}>View brief slot</button> : null}
      </li>)}</ul>}</div>;

  return <section className="figment__preview">
    <h2>Prepare generation plan</h2>
    <p>Prepares one local generation plan only. It requires a current selected checkpoint and source authority; it does not launch a run or create an approval.</p>
    {inventory.status === 'loading' ? <p className="figment__notice">Checking preparation status…</p> : null}
    {ready ? <p className="figment__notice">Preparation status: {AVAILABILITY_COPY[ready.preparation]}</p> : null}
    {inventory.status === 'failed' ? <p className="figment__reader-error" role="alert">{GET_UNAVAILABLE}</p> : null}
    {pending.kind === 'blocked' ? <p className="figment__reader-error" role="alert">{pending.message}</p> : null}
    {pending.kind === 'same' ? <p className="figment__notice">A generation plan request is already pending. Resuming replays the same request; it never creates a second one.</p> : null}
    {pending.kind === 'same'
      ? <button type="button" className="mc-btn" onClick={resume} disabled={!canResume}>{preparePending ? 'Preparing generation plan…' : 'Resume preparation request'}</button>
      : <button type="button" className="mc-btn" onClick={prepareNew} disabled={!canPrepareNew}>{preparePending ? 'Preparing generation plan…' : 'Prepare generation plan'}</button>}
    <button type="button" className="mc-btn" onClick={refresh} disabled={inventory.status === 'loading' || preparePending}>Refresh status</button>
    {prepareError ? <p className="figment__reader-error" role="alert">{prepareError}</p> : null}
    {prepared ? <p role="status">{prepared.creator} · {prepared.stage} · one prepared run · declared ${prepared.declaredCeilingUsd.toFixed(2)} · plan {prepared.planSha256.slice(0, 12)}</p> : null}
    {ready && ready.plans.length ? <div className="figment__plans">
      <p className="figment__notice">Stored plan summaries are recorded snapshots, not live validity checks.</p>
      {ready.plans.map((plan, index) => <article className="figment__plan" key={plan.id}><h2>{plan.creator} · {plan.stage}</h2><p>{plan.status} · one prepared run · declared ${plan.declaredCeilingUsd.toFixed(2)} · plan {plan.planSha256.slice(0, 12)}</p><p>{executionCopy(ready.executionRecords[index].state)}</p>{assignments(ready.assignmentRecords[index].state)}<GenSourceRead key={`${plan.id}:${plan.planSha256}`} planId={plan.id} planSha256={plan.planSha256} requestScope={ready.requestScope} ownerGeneration={renderOwner.generation} token={token} fetchImpl={fetchImpl} /></article>)}
    </div> : null}
  </section>;
}

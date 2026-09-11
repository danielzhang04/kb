import { useEffect, useRef, useState } from 'react';

export interface StudioGenPlan { schema: 'figment/studio-gen-plan@1'; id: string; status: 'prepared'; creator: 'creator-001'; stage: 'gen'; runCount: 1; declaredCeilingUsd: number; planSha256: string; }
export type PreparationAvailability = 'available' | 'busy' | 'at-capacity' | 'maintenance-required' | 'unavailable';
export interface StudioGenPlansResponse { schema: 'figment/studio-gen-plans@1'; requestScope: string; plans: StudioGenPlan[]; preparation: PreparationAvailability; }
interface PendingRecord { requestScope: string; key: string; }
type PendingRead = { kind: 'missing' } | { kind: 'valid'; record: PendingRecord } | { kind: 'blocked' };
type PendingState = { kind: 'unknown' } | { kind: 'none' } | { kind: 'same'; key: string } | { kind: 'blocked'; message: string };
type Inventory = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: StudioGenPlansResponse; token?: string; fetchImpl: typeof fetch };
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
const PLANS_KEYS = ['plans', 'preparation', 'requestScope', 'schema'];
const PENDING_KEYS = ['key', 'requestScope', 'schema'];
const GET_UNAVAILABLE = 'Studio generation plans are unavailable.';
const PREPARE_UNAVAILABLE = 'Generation plan preparation is unavailable. A current selected checkpoint and source authority are required before a plan can be prepared.';
const STORAGE_BLOCKED = 'A generation plan request could not be recorded. Preparation is blocked until it can be.';
const PENDING_UNREADABLE = 'A stored generation plan request could not be read. Preparation is blocked and the stored request has been left in place.';
const PENDING_FOREIGN = 'A stored generation plan request belongs to a different operator or workspace. Preparation is blocked and the stored request has been left in place.';
const CLEAR_FAILED = 'The generation plan was prepared, but its pending request record could not be cleared. New preparation is blocked; resuming replays the same request.';
const AVAILABILITY_COPY: Record<PreparationAvailability, string> = {
  'available': 'Preparation is available.',
  'busy': 'Another preparation is in progress. Refresh status once it finishes.',
  'at-capacity': 'At capacity: two prepared plans already exist. New preparation is disabled; a pending request can still be resumed.',
  'maintenance-required': 'Maintenance is required before new plans can be prepared. A pending request can still be resumed.',
  'unavailable': 'Preparation is unavailable. A current selected checkpoint and source authority are required.',
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

function validPlansResponse(value: unknown): StudioGenPlansResponse | null {
  if (!object(value) || !exactKeys(value, PLANS_KEYS) || value.schema !== 'figment/studio-gen-plans@1' || !isSha256(value.requestScope) || !isAvailability(value.preparation)) return null;
  if (!Array.isArray(value.plans) || value.plans.length > 2) return null;
  const plans: StudioGenPlan[] = [];
  for (const item of value.plans) {
    const decoded = validStudioGenPlan(item);
    if (decoded === null || plans.some((plan) => plan.id === decoded.id)) return null;
    plans.push(decoded);
  }
  return { schema: 'figment/studio-gen-plans@1', requestScope: value.requestScope as string, plans, preparation: value.preparation as PreparationAvailability };
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

export function StudioGenPlans({ token, fetchImpl }: { token?: string; fetchImpl: typeof fetch }) {
  const [inventory, setInventory] = useState<Inventory>({ status: 'loading' });
  const [pending, setPending] = useState<PendingState>({ kind: 'unknown' });
  const [preparePending, setPreparePending] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<StudioGenPlan | null>(null);
  // epoch changes on every auth/fetch change and unmount (StrictMode-safe); getSeq orders GETs; inFlight is the synchronous one-intent guard.
  const epoch = useRef(0);
  const getSeq = useRef(0);
  const inFlight = useRef<Ticket | null>(null);

  const loadInventory = (activeEpoch: number): void => {
    const seq = ++getSeq.current;
    setInventory({ status: 'loading' });
    const current = (): boolean => epoch.current === activeEpoch && getSeq.current === seq;
    void fetchImpl(PLANS_URL, { headers: authHeaders(token) }).then(async (response) => {
      const decoded = response.ok ? validPlansResponse(await boundedJson(response, GET_MAX_CHARS)) : null;
      if (!current()) return;
      if (decoded === null) { setInventory({ status: 'failed' }); return; }
      setInventory({ status: 'ready', data: decoded, token, fetchImpl });
      setPending(pendingFor(decoded.requestScope));
    }).catch(() => { if (current()) setInventory({ status: 'failed' }); });
  };

  useEffect(() => {
    const activeEpoch = ++epoch.current;
    inFlight.current = null;
    setPreparePending(false); setPrepareError(null); setPrepared(null); setPending({ kind: 'unknown' });
    loadInventory(activeEpoch);
    return () => { epoch.current += 1; inFlight.current = null; };
  }, [token, fetchImpl]); // loadInventory closes over exactly this render's token/fetchImpl.

  const release = (ticket: Ticket): boolean => {
    if (inFlight.current !== ticket) return false;
    inFlight.current = null;
    setPreparePending(false);
    return true;
  };

  const submit = (ticket: Ticket, record: PendingRecord): void => {
    if (!matches(readPending(), record)) {
      const derived = pendingFor(record.requestScope);
      setPending(derived.kind === 'none' ? { kind: 'blocked', message: STORAGE_BLOCKED } : derived);
      release(ticket);
      return;
    }
    setPreparePending(true);
    void fetchImpl(PLAN_URL, { method: 'POST', headers: { ...authHeaders(token), 'Idempotency-Key': record.key, 'X-Figment-Intent-Scope': record.requestScope } }).then(async (response) => {
      const plan = response.ok ? validStudioGenPlan(await boundedJson(response, POST_MAX_CHARS)) : null;
      if (inFlight.current !== ticket) return;
      if (plan === null) { setPrepareError(PREPARE_UNAVAILABLE); return; }
      setPrepared(plan);
      if (clearPending(record) === 'failed') { setPending({ kind: 'same', key: record.key }); setPrepareError(CLEAR_FAILED); }
    }).catch(() => { if (inFlight.current === ticket) setPrepareError(PREPARE_UNAVAILABLE); })
      .finally(() => { if (release(ticket)) loadInventory(ticket.epoch); });
  };

  // Only an inventory fetched with this render's exact token/fetchImpl may gate a dispatch or the display; a token/fetchImpl
  // change invalidates it until a fresh GET completes, even if the passive epoch-bump effect has not run yet.
  const currentInventory = (): StudioGenPlansResponse | null =>
    inventory.status === 'ready' && inventory.token === token && inventory.fetchImpl === fetchImpl ? inventory.data : null;

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
    if (inFlight.current !== null || inventory.status === 'loading') return;
    loadInventory(epoch.current);
  };

  const ready = currentInventory();
  const canPrepareNew = ready !== null && ready.preparation === 'available' && pending.kind === 'none' && !preparePending;
  const canResume = ready !== null && pending.kind === 'same' && RESUMABLE.has(ready.preparation) && !preparePending;

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
      {ready.plans.map((plan) => <article className="figment__plan" key={plan.id}><h2>{plan.creator} · {plan.stage}</h2><p>{plan.status} · one prepared run · declared ${plan.declaredCeilingUsd.toFixed(2)} · plan {plan.planSha256.slice(0, 12)}</p></article>)}
    </div> : null}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { decodeGenSourceReadInventory, decodeGenSourceReadResult, parseGenSourceJson } from '../../shared/figmentGenSourceRead.ts';
import type { GenSourceReadInventory, GenSourceReadResult } from '../../shared/figmentGenSourceRead.ts';

export interface GenSourceReadProps {
  planId: string;
  planSha256: string;
  requestScope: string;
  ownerGeneration: number;
  token?: string;
  fetchImpl?: typeof fetch;
}

const INVENTORY_URL = '/api/figment/studio/gen-source-reads';
const checkUrl = (planId: string): string => `/api/figment/studio/gen-plans/${encodeURIComponent(planId)}/source-check`;
const GET_MAX_CHARS = 8192;
const POST_MAX_CHARS = 8192;
const GET_TIMEOUT_MS = 30_000;
const POST_TIMEOUT_MS = 150_000;

const GET_UNAVAILABLE = 'Source availability status is unavailable.';
const NOT_CONFIGURED = 'Source checking is not configured for this plan.';
const BUSY_COPY = 'Another source check is in progress. Refresh once it finishes.';
const QUARANTINED_COPY = 'Checking is unavailable until an operator reviews the previous check.';
const POST_UNAUTHORIZED = 'This check could not be authorized. Sign in again and retry.';
const POST_UNAVAILABLE = 'Source checking is unavailable.';
const POST_BUSY = 'Another source check is in progress. Refresh once it finishes.';
const POST_NEEDS_ATTENTION = 'This check needs operator attention after an earlier process ended in an uncertain state.';
const POST_IDENTITY_MISMATCH = 'The source check was rejected because the plan identity did not match. Refresh and retry.';
const POST_TIMEOUT_COPY = 'The check timed out waiting for a response. The server may still be working; there will be no automatic retry. You may check again.';

interface Identity {
  planId: string;
  planSha256: string;
  requestScope: string;
  ownerGeneration: number;
  token?: string;
  fetchImpl: typeof fetch;
}

const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.planId === b.planId && a.planSha256 === b.planSha256 && a.requestScope === b.requestScope
  && a.ownerGeneration === b.ownerGeneration && a.token === b.token && a.fetchImpl === b.fetchImpl;

type InventoryState =
  | { generation: number; status: 'loading' }
  | { generation: number; status: 'failed' }
  | { generation: number; status: 'ready'; data: GenSourceReadInventory };

interface Ticket { generation: number; }

const authHeaders = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

async function boundedText(response: Response, maxChars: number, signal: AbortSignal): Promise<string | null> {
  const body = response.body;
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (signal.aborted) { void reader.cancel().catch(() => undefined); return null; }
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > maxChars) { void reader.cancel().catch(() => undefined); return null; }
      }
      text += decoder.decode();
      return text.length > maxChars ? null : text;
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    if (signal.aborted) return null;
    return text.length > maxChars ? null : text;
  } catch {
    return null;
  }
}

function decodeFixedErrorCode(value: unknown): 'identity-mismatch' | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'error') return null;
  return record.error === 'identity-mismatch' ? 'identity-mismatch' : null;
}

export function GenSourceRead({ planId, planSha256, requestScope, ownerGeneration, token, fetchImpl }: GenSourceReadProps) {
  const resolvedFetch = fetchImpl ?? fetch;
  const identity: Identity = { planId, planSha256, requestScope, ownerGeneration, token, fetchImpl: resolvedFetch };

  const ownerRef = useRef<{ identity: Identity; generation: number; getController: AbortController | null; postController: AbortController | null; getTimer: ReturnType<typeof setTimeout> | null; postTimer: ReturnType<typeof setTimeout> | null }>({
    identity, generation: 0, getController: null, postController: null, getTimer: null, postTimer: null,
  });
  if (!sameIdentity(ownerRef.current.identity, identity)) {
    if (ownerRef.current.getTimer !== null) clearTimeout(ownerRef.current.getTimer);
    if (ownerRef.current.postTimer !== null) clearTimeout(ownerRef.current.postTimer);
    ownerRef.current.getController?.abort();
    ownerRef.current.postController?.abort();
    ownerRef.current = { identity, generation: ownerRef.current.generation + 1, getController: null, postController: null, getTimer: null, postTimer: null };
  }
  const currentGeneration = ownerRef.current.generation;

  const [inventory, setInventory] = useState<InventoryState>({ generation: currentGeneration, status: 'loading' });
  const [checkPending, setCheckPending] = useState<number | null>(null);
  const [checkError, setCheckError] = useState<{ generation: number; message: string } | null>(null);
  const [result, setResult] = useState<{ generation: number; data: GenSourceReadResult } | null>(null);

  const postTicket = useRef<Ticket | null>(null);

  const loadInventory = (generation: number): void => {
    const controller = new AbortController();
    ownerRef.current.getController = controller;
    const isCurrent = (): boolean => ownerRef.current.generation === generation && ownerRef.current.getController === controller;
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      ownerRef.current.getController = null;
      if (ownerRef.current.getTimer === timer) ownerRef.current.getTimer = null;
      setInventory({ generation, status: 'failed' });
      controller.abort();
    }, GET_TIMEOUT_MS);
    ownerRef.current.getTimer = timer;
    setInventory({ generation, status: 'loading' });
    void Promise.resolve()
      .then(() => {
        if (!isCurrent() || controller.signal.aborted) throw { error: 'stale' } as const;
        return resolvedFetch(INVENTORY_URL, { headers: authHeaders(token), credentials: 'same-origin', signal: controller.signal });
      })
      .then(async (response) => {
        if (!isCurrent()) return;
        if (!response.ok) { setInventory({ generation, status: 'failed' }); return; }
        const text = await boundedText(response, GET_MAX_CHARS, controller.signal);
        if (!isCurrent()) return;
        if (text === null) { setInventory({ generation, status: 'failed' }); return; }
        let parsed: unknown;
        try { parsed = parseGenSourceJson(text, GET_MAX_CHARS); } catch { setInventory({ generation, status: 'failed' }); return; }
        if (!isCurrent()) return;
        const decoded = decodeGenSourceReadInventory(parsed);
        if (decoded === null) { setInventory({ generation, status: 'failed' }); return; }
        setInventory({ generation, status: 'ready', data: decoded });
      })
      .catch(() => { if (isCurrent()) setInventory({ generation, status: 'failed' }); })
      .finally(() => {
        clearTimeout(timer);
        if (ownerRef.current.getTimer === timer) ownerRef.current.getTimer = null;
        if (ownerRef.current.getController === controller) ownerRef.current.getController = null;
      });
  };

  useEffect(() => {
    const generation = ownerRef.current.generation;
    postTicket.current = null;
    setCheckPending(null);
    setCheckError(null);
    setResult(null);
    loadInventory(generation);
    return () => {
      if (ownerRef.current.generation !== generation) return;
      if (ownerRef.current.getTimer !== null) { clearTimeout(ownerRef.current.getTimer); ownerRef.current.getTimer = null; }
      if (ownerRef.current.postTimer !== null) { clearTimeout(ownerRef.current.postTimer); ownerRef.current.postTimer = null; }
      const getController = ownerRef.current.getController;
      const postController = ownerRef.current.postController;
      ownerRef.current.getController = null;
      ownerRef.current.postController = null;
      postTicket.current = null;
      getController?.abort();
      postController?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, planSha256, requestScope, ownerGeneration, token, resolvedFetch]);

  const currentInventory = (): GenSourceReadInventory | null =>
    inventory.generation === currentGeneration && inventory.status === 'ready' ? inventory.data : null;
  const currentResult = (): GenSourceReadResult | null =>
    result !== null && result.generation === currentGeneration ? result.data : null;
  const currentCheckPending = checkPending === currentGeneration;
  const currentCheckErrorText = checkError !== null && checkError.generation === currentGeneration ? checkError.message : null;
  const inventoryStatus = inventory.generation === currentGeneration ? inventory.status : 'loading';

  const ready = currentInventory();
  const entry = ready?.entries.find((item) => item.id === planId && item.planSha256 === planSha256) ?? null;

  let disabledReason: string | null = null;
  if (ready !== null) {
    if (!ready.configured) disabledReason = NOT_CONFIGURED;
    else if (entry === null) disabledReason = NOT_CONFIGURED;
    else if (ready.availability === 'busy') disabledReason = BUSY_COPY;
    else if (ready.availability === 'quarantined') disabledReason = QUARANTINED_COPY;
  }

  const refresh = (): void => {
    if (inventoryStatus === 'loading' || currentCheckPending) return;
    setResult(null);
    setCheckError(null);
    loadInventory(currentGeneration);
  };

  const check = (): void => {
    if (ready === null || entry === null || disabledReason !== null || currentCheckPending || postTicket.current !== null) return;
    const generation = currentGeneration;
    const ticket: Ticket = { generation };
    postTicket.current = ticket;
    const controller = new AbortController();
    ownerRef.current.postController = controller;
    const isCurrent = (): boolean => postTicket.current === ticket && ownerRef.current.generation === generation;
    const setError = (message: string): void => setCheckError({ generation, message });
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      postTicket.current = null;
      if (ownerRef.current.postController === controller) ownerRef.current.postController = null;
      if (ownerRef.current.postTimer === timer) ownerRef.current.postTimer = null;
      setError(POST_TIMEOUT_COPY);
      setCheckPending((current) => (current === generation ? null : current));
      controller.abort();
    }, POST_TIMEOUT_MS);
    ownerRef.current.postTimer = timer;
    setCheckPending(generation);
    setCheckError(null);
    setResult(null);

    void Promise.resolve()
      .then(() => {
        if (!isCurrent() || controller.signal.aborted) throw { error: 'stale' } as const;
        return resolvedFetch(checkUrl(planId), {
          method: 'POST',
          headers: {
            ...authHeaders(token),
            'X-Figment-Plan-Sha256': planSha256,
            'X-Figment-Request-Scope': requestScope,
          },
          credentials: 'same-origin',
          signal: controller.signal,
        });
      })
      .then(async (response) => {
        if (!isCurrent()) return;
        if (response.status === 401) { setError(POST_UNAUTHORIZED); return; }
        if (response.status === 409) {
          const text = await boundedText(response, POST_MAX_CHARS, controller.signal);
          if (!isCurrent()) return;
          if (text !== null) {
            try {
              const parsed = parseGenSourceJson(text, POST_MAX_CHARS);
              if (decodeFixedErrorCode(parsed) === 'identity-mismatch') { setError(POST_IDENTITY_MISMATCH); return; }
            } catch { /* fall through to busy */ }
          }
          setError(POST_BUSY);
          return;
        }
        if (response.status === 423) { setError(POST_NEEDS_ATTENTION); return; }
        if (!response.ok) {
          const text = await boundedText(response, POST_MAX_CHARS, controller.signal);
          if (!isCurrent()) return;
          if (text !== null) {
            try {
              const parsed = parseGenSourceJson(text, POST_MAX_CHARS);
              if (decodeFixedErrorCode(parsed) === 'identity-mismatch') { setError(POST_IDENTITY_MISMATCH); return; }
            } catch { /* fall through to generic */ }
          }
          setError(POST_UNAVAILABLE);
          return;
        }
        const text = await boundedText(response, POST_MAX_CHARS, controller.signal);
        if (!isCurrent()) return;
        if (text === null) { setError(POST_UNAVAILABLE); return; }
        let parsed: unknown;
        try { parsed = parseGenSourceJson(text, POST_MAX_CHARS); } catch { setError(POST_UNAVAILABLE); return; }
        if (!isCurrent()) return;
        const decoded = decodeGenSourceReadResult(parsed, planId, planSha256);
        if (decoded === null) { setError(POST_UNAVAILABLE); return; }
        setResult({ generation, data: decoded });
      })
      .catch(() => {
        if (isCurrent()) setError(POST_UNAVAILABLE);
      })
      .finally(() => {
        clearTimeout(timer);
        if (ownerRef.current.postTimer === timer) ownerRef.current.postTimer = null;
        if (ownerRef.current.postController === controller) ownerRef.current.postController = null;
        if (postTicket.current === ticket) { postTicket.current = null; setCheckPending((current) => (current === generation ? null : current)); }
      });
  };

  const activeResult = currentResult();
  const canCheck = ready !== null && entry !== null && disabledReason === null && !currentCheckPending;

  return <section className="figment__preview">
    <h2>Source check</h2>
    <p>A manual, past-only observation of the source used to prepare this plan. It grants no launch, quality, or approval authority, and it is not automatically retried.</p>
    {inventoryStatus === 'loading' ? <p className="figment__notice" role="status">Checking source availability…</p> : null}
    {inventoryStatus === 'failed' ? <p className="figment__reader-error" role="alert">{GET_UNAVAILABLE}</p> : null}
    {disabledReason ? <p className="figment__notice">{disabledReason}</p> : null}
    <button type="button" className="mc-btn" onClick={check} disabled={!canCheck} aria-label="Check current source">
      {currentCheckPending ? 'Checking source…' : 'Check current source'}
    </button>
    <button type="button" className="mc-btn" onClick={refresh} disabled={inventoryStatus === 'loading' || currentCheckPending}>Refresh status</button>
    {currentCheckErrorText ? <p className="figment__reader-error" role="alert">{currentCheckErrorText}</p> : null}
    {activeResult ? <article className="figment__plan">
      <p role="status">Source checked at {activeResult.checkedAtUtc}</p>
      <p className="figment__notice">Files may have changed since this check. This does not grant launch, quality or approval.</p>
      <p>Source plan digest: {activeResult.digests.sourcePlanSha256.slice(0, 12)}</p>
      <ul>
        {activeResult.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
      </ul>
    </article> : null}
  </section>;
}

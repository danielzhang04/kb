import { useEffect, useRef, useState } from 'react';
import {
  decodeVideoRulingInventory,
  decodeVideoRulingResult,
} from '../../shared/figmentVideoRuling';
import type {
  DerivedOutcome,
  VideoRulingAvailability,
  VideoRulingCriteria,
  VideoRulingInventory,
  VideoRulingResult,
} from '../../shared/figmentVideoRuling';

const INVENTORY_URL = '/api/figment/video-rulings';
const readUrl = (id: string): string => `/api/figment/video-rulings/${encodeURIComponent(id)}/read`;
const GET_MAX_CHARS = 4096;
const POST_MAX_CHARS = 16384;

const GET_UNAVAILABLE = 'Video review claims are unavailable.';
const CHECK_UNAVAILABLE = 'The recorded review could not be read.';
const CHECK_CONFLICT = 'Another video review check is in progress. Refresh status once it finishes.';
const CHECK_NEEDS_ATTENTION = 'This check needs operator attention after an earlier process ended in an uncertain state.';
const EMPTY_COPY = 'No video review claims are configured.';

const AVAILABILITY_COPY: Record<VideoRulingAvailability, string> = {
  'available': 'Video review claims are available.',
  'busy': 'Another check is in progress. Refresh once it finishes.',
  'quarantined': 'Video review claims are quarantined and cannot be checked right now.',
};

const OUTCOME_COPY: Record<DerivedOutcome, string> = {
  'reported_pass': 'Reported pass',
  'reported_fail': 'Reported failure',
  'reported_incomplete': 'Reported review incomplete',
};

type RequestOwner = { token?: string; fetchImpl: typeof fetch };

type Inventory =
  | ({ status: 'loading' } & RequestOwner)
  | ({ status: 'failed' } & RequestOwner)
  | ({ status: 'ready'; data: VideoRulingInventory } & RequestOwner);

type CheckError = { message: string } & RequestOwner;

interface Ticket { epoch: number; }

const authHeaders = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

async function boundedJson(response: Response, maxChars: number): Promise<unknown> {
  try {
    const text = await response.text();
    return text.length > maxChars ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

const CRITERIA_LABELS: ReadonlyArray<{ key: keyof VideoRulingCriteria; label: string }> = [
  { key: 'playbackObservation', label: 'Playback observation' },
  { key: 'correspondenceReview', label: 'Correspondence review' },
  { key: 'temporalReview', label: 'Temporal review' },
  { key: 'detailCropReview', label: 'Detail crop review' },
  { key: 'templateFitReview', label: 'Template fit review' },
  { key: 'audioPresenceClaim', label: 'Audio presence claim' },
  { key: 'audioLicensingReview', label: 'Audio licensing review' },
  { key: 'audioMixSyncReview', label: 'Audio mix and sync review' },
];

const VALUE_COPY: Record<string, string> = {
  'watched_full': 'Watched in full',
  'not_watched': 'Not watched',
  'pass': 'Pass',
  'fail': 'Fail',
  'incomplete': 'Incomplete',
  'not_applicable': 'Not applicable',
  'present': 'Present',
  'absent': 'Absent',
  'unassessed': 'Unassessed',
};

export function VideoRulingRead({ token, fetchImpl }: { token?: string; fetchImpl: typeof fetch }) {
  const [inventory, setInventory] = useState<Inventory>({ status: 'loading', token, fetchImpl });
  const [selectedId, setSelectedId] = useState<string>('');
  const [checkPending, setCheckPending] = useState<RequestOwner | null>(null);
  const [checkError, setCheckError] = useState<CheckError | null>(null);
  const [result, setResult] = useState<{ data: VideoRulingResult; token?: string; fetchImpl: typeof fetch } | null>(null);

  // epoch changes on every auth/fetch change and unmount (StrictMode-safe); getSeq orders GETs; inFlight is the synchronous one-intent guard.
  const epoch = useRef(0);
  const getSeq = useRef(0);
  const inFlight = useRef<Ticket | null>(null);

  const loadInventory = (activeEpoch: number): void => {
    const seq = ++getSeq.current;
    setInventory({ status: 'loading', token, fetchImpl });
    const current = (): boolean => epoch.current === activeEpoch && getSeq.current === seq;
    void fetchImpl(INVENTORY_URL, { headers: authHeaders(token) })
      .then(async (response) => {
        const decoded = response.ok ? decodeVideoRulingInventory(await boundedJson(response, GET_MAX_CHARS)) : null;
        if (!current()) return;
        if (decoded === null) { setInventory({ status: 'failed', token, fetchImpl }); return; }
        setInventory({ status: 'ready', data: decoded, token, fetchImpl });
        setSelectedId((existing) => (decoded.ids.includes(existing) ? existing : decoded.ids[0] ?? ''));
      })
      .catch(() => { if (current()) setInventory({ status: 'failed', token, fetchImpl }); });
  };

  useEffect(() => {
    const activeEpoch = ++epoch.current;
    inFlight.current = null;
    setCheckPending(null);
    setCheckError(null);
    setResult(null);
    setSelectedId('');
    loadInventory(activeEpoch);
    return () => { epoch.current += 1; inFlight.current = null; };
  }, [token, fetchImpl]); // loadInventory closes over exactly this render's token/fetchImpl.

  // Only an inventory fetched with this render's exact token/fetchImpl may gate a dispatch or the display; a token/fetchImpl
  // change invalidates it until a fresh GET completes, even if the passive epoch-bump effect has not run yet.
  const ownsCurrentProps = (owner: RequestOwner): boolean => owner.token === token && owner.fetchImpl === fetchImpl;

  const currentInventory = (): VideoRulingInventory | null =>
    inventory.status === 'ready' && ownsCurrentProps(inventory) ? inventory.data : null;

  const currentResult = (): VideoRulingResult | null =>
    result !== null && ownsCurrentProps(result) ? result.data : null;

  const currentInventoryStatus = ownsCurrentProps(inventory) ? inventory.status : null;
  const currentCheckPending = checkPending !== null && ownsCurrentProps(checkPending);
  const currentCheckError = checkError !== null && ownsCurrentProps(checkError) ? checkError.message : null;

  const refresh = (): void => {
    if (currentInventoryStatus === 'loading' || currentCheckPending) return;
    setResult(null);
    setCheckError(null);
    loadInventory(epoch.current);
  };

  const selectId = (id: string): void => {
    if (currentCheckPending) return;
    setSelectedId(id);
    setResult(null);
    setCheckError(null);
  };

  const check = (): void => {
    const data = currentInventory();
    if (inFlight.current !== null || data === null || data.availability !== 'available' || !selectedId) return;
    const ticket: Ticket = { epoch: epoch.current };
    inFlight.current = ticket;
    const requestedId = selectedId;
    const requestToken = token;
    const requestFetchImpl = fetchImpl;
    setCheckPending({ token: requestToken, fetchImpl: requestFetchImpl });
    setCheckError(null);
    setResult(null);
    const ticketIsCurrent = (): boolean => inFlight.current === ticket && epoch.current === ticket.epoch;
    const setRequestError = (message: string): void => setCheckError({ message, token: requestToken, fetchImpl: requestFetchImpl });
    void requestFetchImpl(readUrl(requestedId), { method: 'POST', headers: authHeaders(requestToken) })
      .then(async (response) => {
        if (!ticketIsCurrent()) return;
        if (response.status === 409) { setRequestError(CHECK_CONFLICT); return; }
        if (response.status === 423) { setRequestError(CHECK_NEEDS_ATTENTION); return; }
        if (!response.ok) { setRequestError(CHECK_UNAVAILABLE); return; }
        const decoded = decodeVideoRulingResult(await boundedJson(response, POST_MAX_CHARS), requestedId);
        if (!ticketIsCurrent()) return;
        if (decoded === null) { setRequestError(CHECK_UNAVAILABLE); return; }
        setResult({ data: decoded, token: requestToken, fetchImpl: requestFetchImpl });
      })
      .catch(() => { if (ticketIsCurrent()) setRequestError(CHECK_UNAVAILABLE); })
      .finally(() => { if (ticketIsCurrent()) { inFlight.current = null; setCheckPending(null); } });
  };

  const ready = currentInventory();
  const activeResult = currentResult();
  const canCheck = ready !== null && ready.availability === 'available' && !!selectedId && !currentCheckPending;

  return <section className="figment__preview">
    <h2>Video review claims</h2>
    <p>These are self-reported review claims bound to recorded evidence. They are not observed playback, an authenticated author, an accepted quality determination, or a publication approval.</p>
    {currentInventoryStatus === 'loading' ? <p className="figment__notice">Checking video review claims…</p> : null}
    {currentInventoryStatus === 'failed' ? <p className="figment__reader-error" role="alert">{GET_UNAVAILABLE}</p> : null}
    {ready ? <p className="figment__notice">{AVAILABILITY_COPY[ready.availability]}</p> : null}
    {ready && ready.ids.length === 0 ? <p className="figment__notice">{EMPTY_COPY}</p> : null}
    {ready && ready.ids.length > 0 ? <div className="figment__plans">
      <label htmlFor="figment-video-ruling-id">Configured claim</label>
      <select
        id="figment-video-ruling-id"
        value={selectedId}
        disabled={currentCheckPending}
        onChange={(event) => selectId(event.target.value)}
      >
        {ready.ids.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <button type="button" className="mc-btn" onClick={check} disabled={!canCheck}>
        {currentCheckPending ? 'Checking recorded review…' : 'Check recorded review'}
      </button>
    </div> : null}
    <button type="button" className="mc-btn" onClick={refresh} disabled={currentInventoryStatus === 'loading' || currentCheckPending}>Refresh status</button>
    {currentCheckError ? <p className="figment__reader-error" role="alert">{currentCheckError}</p> : null}
    {activeResult ? <article className="figment__plan">
      <h2>{activeResult.id}</h2>
      <p role="status">{OUTCOME_COPY[activeResult.derivedOutcome]}</p>
      <ul>
        {CRITERIA_LABELS.map(({ key, label }) => {
          const value = activeResult.criteria[key];
          return <li key={key}>{label}: {VALUE_COPY[value] ?? value}</li>;
        })}
      </ul>
      <p>Subject evidence hash: {activeResult.subjectSha256}</p>
      <p>Ruling evidence hash: {activeResult.rulingSha256}</p>
      <ul>
        {activeResult.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
      </ul>
    </article> : null}
  </section>;
}

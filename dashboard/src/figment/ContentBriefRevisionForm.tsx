import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { decodeFigmentContentBriefRevisionResult } from '../../shared/figmentContentBriefRevision';
import type { FigmentContentBriefRevisionResult } from '../../shared/figmentContentBriefRevision';

const REVISION_URL = '/api/figment/studio/content-brief-revisions';
const RESPONSE_MAX_CHARS = 4_096;
const MAX_BRIEF_ID = 128;
const MAX_SLUG = 105;
const MAX_TEXT = 4_096;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const INVALID_FIELDS = 'Enter a valid base, date, slug, hypothesis, and intended metric.';
const INVALID_REQUEST = 'The revision request was rejected before publication. Review the fields and try again.';
const SESSION_REQUIRED = 'Your session cannot create this local revision.';
const BASE_UNAVAILABLE = 'The selected base is no longer available. Refresh recorded briefs.';
const WRITE_BLOCKED = 'Another write or a rate limit blocked this request. Nothing was sent again automatically.';
const CONFLICT = 'A revision with that ID already exists. Inspect recorded briefs. This does not prove that an earlier request created it.';
const AMBIGUOUS = 'The request ended without a trustworthy result. A local revision may have been created. Inspect recorded briefs before deciding what to do. Sending it again is not known to be safe.';

export interface ContentBriefRevisionBase {
  briefId: string;
  briefDate: string;
}

type RequestOwner = {
  token?: string;
  fetchImpl: typeof fetch;
  baseBriefId: string;
};

type Feedback =
  | ({ kind: 'success'; data: FigmentContentBriefRevisionResult } & RequestOwner)
  | ({ kind: 'invalid' | 'session' | 'rate'; message: string } & RequestOwner)
  | ({ kind: 'not-found' | 'conflict' | 'ambiguous'; message: string } & RequestOwner);

interface Ticket {
  epoch: number;
  owner: RequestOwner;
  controller: AbortController;
}

const authHeaders = (token?: string): Record<string, string> => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

const normalizedId = (value: string, max: number): boolean =>
  value.length >= 1 && value.length <= max && wellFormed(value) && ID.test(value);

function canonicalDate(value: string): boolean {
  if (!DATE.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

const revisionText = (value: string): boolean =>
  value.length >= 1 && value.length <= MAX_TEXT && value === value.trim()
  && wellFormed(value) && !CONTROL.test(value);

const sameOwner = (left: RequestOwner, right: RequestOwner): boolean =>
  left.token === right.token && left.fetchImpl === right.fetchImpl
  && left.baseBriefId === right.baseBriefId;

function parseSuccessfulResponse(
  text: string,
  expectedBriefId: string,
): FigmentContentBriefRevisionResult | null {
  if (text.length > RESPONSE_MAX_CHARS) return null;
  try {
    return decodeFigmentContentBriefRevisionResult(JSON.parse(text) as unknown, expectedBriefId);
  } catch {
    return null;
  }
}

export function ContentBriefRevisionForm({
  bases,
  token,
  fetchImpl,
  onRefreshRequested,
}: {
  bases: readonly ContentBriefRevisionBase[];
  token?: string;
  fetchImpl: typeof fetch;
  onRefreshRequested: () => void;
}) {
  const [selectedBaseId, setSelectedBaseId] = useState(() => bases[0]?.briefId ?? '');
  const [briefDate, setBriefDate] = useState('');
  const [slug, setSlug] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [intendedMetric, setIntendedMetric] = useState('');
  const [pending, setPending] = useState<RequestOwner | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [publicationLocked, setPublicationLocked] = useState(false);

  const basesKey = JSON.stringify(bases.map((base) => [base.briefId, base.briefDate]));
  const selectedAvailable = bases.some((base) => base.briefId === selectedBaseId);
  const effectiveBaseId = selectedAvailable ? selectedBaseId : (bases[0]?.briefId ?? '');
  const epoch = useRef(0);
  const inFlight = useRef<Ticket | null>(null);
  const displaced = useRef<Ticket | null>(null);
  const publicationLock = useRef(false);
  const refreshIntent = useRef(false);
  const availableBaseIds = useRef<ReadonlySet<string>>(new Set());
  const currentOwner = useRef<RequestOwner>({ token, fetchImpl, baseBriefId: effectiveBaseId });
  availableBaseIds.current = new Set(bases.map((base) => base.briefId));
  currentOwner.current = { token, fetchImpl, baseBriefId: effectiveBaseId };

  useEffect(() => {
    const displacedTicket = displaced.current;
    displaced.current = null;
    if (displacedTicket !== null) {
      setPending(null);
      setFeedback({ kind: 'ambiguous', message: AMBIGUOUS, token, fetchImpl, baseBriefId: effectiveBaseId });
      publicationLock.current = true;
      setPublicationLocked(true);
      setValidationError(null);
    } else {
      setPending((current) => current !== null && sameOwner(current, currentOwner.current) ? current : null);
      setFeedback((current) => {
        if (current !== null && sameOwner(current, currentOwner.current)) return current;
        return publicationLock.current
          ? { kind: 'ambiguous', message: AMBIGUOUS, token, fetchImpl, baseBriefId: effectiveBaseId }
          : null;
      });
      setValidationError(null);
    }
    return () => {
      epoch.current += 1;
      const ticket = inFlight.current;
      if (ticket !== null) {
        ticket.controller.abort();
        inFlight.current = null;
        displaced.current = ticket;
      }
    };
  }, [token, fetchImpl]);

  useEffect(() => {
    if (bases.some((base) => base.briefId === selectedBaseId)) return;
    const nextBaseId = bases[0]?.briefId ?? '';
    const ticket = inFlight.current;
    epoch.current += 1;
    if (ticket !== null) ticket.controller.abort();
    inFlight.current = null;
    displaced.current = null;
    setSelectedBaseId(nextBaseId);
    setPending(null);
    setFeedback(ticket === null && !publicationLock.current ? null : {
      kind: 'ambiguous', message: AMBIGUOUS, token, fetchImpl, baseBriefId: nextBaseId,
    });
    if (ticket !== null) {
      publicationLock.current = true;
      setPublicationLocked(true);
    }
    setValidationError(null);
  }, [basesKey, selectedBaseId, token, fetchImpl]);

  const ownerMatches = (owner: RequestOwner): boolean => sameOwner(owner, currentOwner.current);
  const currentPending = selectedAvailable && pending !== null && ownerMatches(pending);
  const currentFeedback = feedback !== null && ownerMatches(feedback) ? feedback : null;

  const selectBase = (baseBriefId: string): void => {
    if (baseBriefId === selectedBaseId) return;
    const ticket = inFlight.current;
    epoch.current += 1;
    if (ticket !== null) ticket.controller.abort();
    inFlight.current = null;
    displaced.current = null;
    setSelectedBaseId(baseBriefId);
    setPending(null);
    setFeedback(ticket === null && !publicationLock.current ? null : {
      kind: 'ambiguous', message: AMBIGUOUS, token, fetchImpl, baseBriefId,
    });
    if (ticket !== null) {
      publicationLock.current = true;
      setPublicationLocked(true);
    }
    setValidationError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (inFlight.current !== null || currentPending || publicationLocked || publicationLock.current) return;
    const selected = bases.find((base) => base.briefId === selectedBaseId);
    const briefId = `${briefDate}-creator-001-${slug}`;
    if (selected === undefined || !normalizedId(selected.briefId, MAX_BRIEF_ID)
      || !canonicalDate(briefDate) || !normalizedId(slug, MAX_SLUG)
      || !normalizedId(briefId, MAX_BRIEF_ID) || !revisionText(hypothesis)
      || !revisionText(intendedMetric)) {
      setValidationError(INVALID_FIELDS);
      return;
    }

    const owner: RequestOwner = { token, fetchImpl, baseBriefId: selected.briefId };
    const controller = new AbortController();
    const ticket: Ticket = { epoch: ++epoch.current, owner, controller };
    inFlight.current = ticket;
    setPending(owner);
    setFeedback(null);
    setValidationError(null);
    setRefreshRequested(false);
    const ticketIsCurrent = (): boolean => inFlight.current === ticket
      && epoch.current === ticket.epoch && sameOwner(ticket.owner, currentOwner.current)
      && availableBaseIds.current.has(ticket.owner.baseBriefId);
    const setOwnedFeedback = (next: Feedback): void => {
      if (!ticketIsCurrent()) return;
      setFeedback(next);
      if (next.kind === 'success' || next.kind === 'not-found'
        || next.kind === 'conflict' || next.kind === 'ambiguous') {
        publicationLock.current = true;
        setPublicationLocked(true);
      }
    };
    const body = JSON.stringify({
      baseBriefId: selected.briefId,
      briefDate,
      slug,
      hypothesis,
      intendedMetric,
    });

    let request: Promise<Response>;
    try {
      request = fetchImpl(REVISION_URL, {
        method: 'POST',
        headers: authHeaders(token),
        body,
        signal: controller.signal,
      });
    } catch {
      setOwnedFeedback({ ...owner, kind: 'ambiguous', message: AMBIGUOUS });
      inFlight.current = null;
      setPending(null);
      return;
    }
    void request.then(async (response) => {
      if (!ticketIsCurrent()) return;
      if (!response.ok) {
        if (response.status === 400 || response.status === 413) {
          setOwnedFeedback({ ...owner, kind: 'invalid', message: INVALID_REQUEST });
        } else if (response.status === 401 || response.status === 403) {
          setOwnedFeedback({ ...owner, kind: 'session', message: SESSION_REQUIRED });
        } else if (response.status === 404) {
          setOwnedFeedback({ ...owner, kind: 'not-found', message: BASE_UNAVAILABLE });
        } else if (response.status === 409) {
          setOwnedFeedback({ ...owner, kind: 'conflict', message: CONFLICT });
        } else if (response.status === 429) {
          setOwnedFeedback({ ...owner, kind: 'rate', message: WRITE_BLOCKED });
        } else {
          setOwnedFeedback({ ...owner, kind: 'ambiguous', message: AMBIGUOUS });
        }
        return;
      }
      const text = await response.text();
      if (!ticketIsCurrent()) return;
      const decoded = parseSuccessfulResponse(text, briefId);
      setOwnedFeedback(decoded === null
        ? { ...owner, kind: 'ambiguous', message: AMBIGUOUS }
        : { ...owner, kind: 'success', data: decoded });
    }).catch(() => {
      setOwnedFeedback({ ...owner, kind: 'ambiguous', message: AMBIGUOUS });
    }).finally(() => {
      if (ticketIsCurrent()) {
        inFlight.current = null;
        setPending(null);
      }
    });
  };

  const requestRefresh = (): void => {
    if (refreshIntent.current) return;
    refreshIntent.current = true;
    setRefreshRequested(true);
    onRefreshRequested();
  };

  const update = (setter: (value: string) => void) => (value: string): void => {
    setter(value);
    setValidationError(null);
  };

  return <section className="figment__preview" aria-label="Content brief revision">
    <h2>Create a local content brief revision</h2>
    <p>Create a new local planning revision.</p>
    <p>The selected base stays unchanged, and the server checks its current inputs first.</p>
    <p>This does not create media or publish content to a platform.</p>
    {bases.length === 0 ? <p className="figment__notice">No recorded creator-001 content briefs are available.</p> : <form className="figment__plans" onSubmit={submit}>
      <label htmlFor="figment-content-brief-base">Base brief</label>
      <select
        id="figment-content-brief-base"
        value={selectedBaseId}
        disabled={currentPending}
        onChange={(event) => selectBase(event.target.value)}
      >
        {bases.map((base) => <option key={`${base.briefId}:${base.briefDate}`} value={base.briefId}>
          {base.briefId} · {base.briefDate}
        </option>)}
      </select>
      <label htmlFor="figment-content-brief-date">Revision date</label>
      <input
        id="figment-content-brief-date"
        type="date"
        required
        value={briefDate}
        disabled={currentPending}
        onChange={(event) => update(setBriefDate)(event.target.value)}
      />
      <label htmlFor="figment-content-brief-slug">Slug</label>
      <input
        id="figment-content-brief-slug"
        required
        maxLength={MAX_SLUG}
        value={slug}
        disabled={currentPending}
        onChange={(event) => update(setSlug)(event.target.value)}
      />
      <label htmlFor="figment-content-brief-hypothesis">Hypothesis</label>
      <textarea
        id="figment-content-brief-hypothesis"
        required
        maxLength={MAX_TEXT}
        value={hypothesis}
        disabled={currentPending}
        onChange={(event) => update(setHypothesis)(event.target.value)}
      />
      <label htmlFor="figment-content-brief-metric">Intended metric</label>
      <textarea
        id="figment-content-brief-metric"
        required
        maxLength={MAX_TEXT}
        value={intendedMetric}
        disabled={currentPending}
        onChange={(event) => update(setIntendedMetric)(event.target.value)}
      />
      {!publicationLocked ? <button type="submit" className="mc-btn" disabled={currentPending || !selectedAvailable}>
        {currentPending ? 'Creating local planning revision…' : 'Create local planning revision'}
      </button> : null}
    </form>}
    {validationError ? <p className="figment__reader-error" role="alert">{validationError}</p> : null}
    {currentFeedback && currentFeedback.kind !== 'success'
      ? <p className="figment__reader-error" role="alert">{currentFeedback.message}</p> : null}
    {currentFeedback?.kind === 'success' ? <article className="figment__plan">
      <h2>Local planning revision created: {currentFeedback.data.briefId}.</h2>
      <p role="status">Brief hash: {currentFeedback.data.briefSha256}</p>
      <p>This is a local planning record only. It does not approve media or publish content to a platform.</p>
    </article> : null}
    {currentFeedback && publicationLocked ? <button
      type="button"
      className="mc-btn"
      disabled={refreshRequested}
      onClick={requestRefresh}
    >Refresh recorded briefs</button> : null}
  </section>;
}

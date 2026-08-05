/**
 * D2.7 — the vibe-code chat box's client view. A chat box that streams a REAL
 * `claude --print --output-format stream-json` session back live — a **live prompt with fleet reach
 * (RCE-equivalent)**, so this view is gated end-to-end exactly like `Control.tsx`'s `LaunchControls`
 * (D2.6): governed at point of action through the app's ONE unlock, and it NEVER spawns anything itself — it only POSTs the
 * prompt (bearer session token attached) to the governed server endpoint that wraps
 * `server/vibe/session.ts#spawnVibe` (preamble-gated, WebAuthn-session-gated, rate-limited, audited;
 * see that module for the full gate chain). No route is wired by this file — mounting the endpoint
 * behind `spawnVibe` is a later task's job, same caveat as `Editor.tsx`'s `defaultSave`; a 404 just
 * surfaces as an ordinary refused-spawn outcome, same as any other server error.
 *
 * `stream` is injectable (mirrors `Editor.tsx`'s `SaveFn` DI) so component tests never touch a real
 * network or a real `claude` process — they drive the chat box purely through a fake `stream` fn.
 *
 * Rendering reuses the EXISTING `Timeline` view (D0.7) rather than reimplementing turn/step
 * rendering — the live-tail Control view and this vibe-code session render turns through the same
 * component, fed by the same shared `TimelineModel`/`foldRecords` fold.
 */
import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { foldRecords } from '../lib/timelineModel';
import type { TimelineModel } from '../lib/timelineModel';
import { parseRecord } from '../../server/planeB/record';
import type { TranscriptRecord } from '../../server/planeB/record';
import { Timeline } from './Timeline';
import { useSession } from '../lib/sessionContext';

export interface VibeStreamOutcome {
  ok: boolean;
  status?: number;
  reason?: string;
}

/** Streams one vibe-code prompt: POSTs it, feeds every folded delta to `onDelta`, resolves with the
 *  terminal outcome. `signal` wires the Stop control through to an aborted fetch. */
export type VibeStreamFn = (
  prompt: string,
  sessionToken: string | undefined,
  onDelta: (model: TimelineModel) => void,
  signal: AbortSignal,
) => Promise<VibeStreamOutcome>;

/**
 * Default stream: POST `{ prompt }` to `/api/vibe` (bearer session token attached), then read the
 * response body as it arrives, splitting complete stream-json lines and parsing each with the SAME
 * `parseRecord` the server-side tailer uses (D0.3) — never a second ad-hoc JSON-line parser. Each
 * batch of newly-completed lines is folded (via the shared `foldRecords`, D0.7) into the accumulated
 * `TimelineModel` and handed to `onDelta`.
 */
export const defaultVibeStream: VibeStreamFn = async (prompt, sessionToken, onDelta, signal) => {
  let res: Response;
  try {
    res = await fetch('/api/vibe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({ prompt }),
      signal,
    });
  } catch {
    return signal.aborted ? { ok: false, reason: 'stopped' } : { ok: false, reason: 'request failed' };
  }

  if (!res.ok || !res.body) {
    let reason = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { reason?: string; problems?: string[] };
      if (body.reason) reason = body.reason;
      else if (body.problems?.length) reason = body.problems.join('; ');
    } catch {
      /* non-JSON error body — fall through to the status-derived reason above */
    }
    return { ok: false, status: res.status, reason };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const records: TranscriptRecord[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    let sawRecord = false;
    for (const line of lines) {
      const rec = parseRecord(line);
      if (rec) {
        records.push(rec);
        sawRecord = true;
      }
    }
    if (sawRecord) onDelta(foldRecords(records));
  }
  return { ok: true };
};

export interface VibeProps {
  stream?: VibeStreamFn;
}

type Status = 'idle' | 'running' | 'stopped' | 'error';

const EMPTY: TimelineModel = { turns: [] };

/** The vibe-code chat box: prompt in, live folded timeline out. Governed at point of action — a send
 *  on a locked tab runs the app's ONE passkey ceremony first and fails closed if it is refused. */
export function Vibe({ stream = defaultVibeStream }: VibeProps): React.JSX.Element {
  const { requireSession } = useSession();
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<TimelineModel>(EMPTY);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (status === 'running' || prompt.trim() === '') return;
      const sessionToken = (await requireSession())?.token;
      if (!sessionToken) {
        setStatus('error');
        setError('the dashboard is locked — nothing was sent');
        return;
      }
      setStatus('running');
      setError(null);
      setModel(EMPTY);
      const controller = new AbortController();
      abortRef.current = controller;

      const outcome = await stream(prompt, sessionToken, setModel, controller.signal);

      const wasStopped = controller.signal.aborted;
      abortRef.current = null;
      if (wasStopped) return; // Stop already set status to 'stopped'; don't clobber it.
      if (outcome.ok) {
        setStatus('idle');
      } else {
        setStatus('error');
        setError(outcome.reason ?? `refused${outcome.status ? ` (${outcome.status})` : ''}`);
      }
    },
    [prompt, requireSession, status, stream],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('stopped');
  }, []);

  return (
    <section className="vibe" aria-label="Vibe-code chat">
      <h2>Vibe-code chat</h2>
      <p className="vibe__warning" role="note">
        Live prompt with fleet reach — every message spawns a real <code>claude</code> session against
        the kb (RCE-equivalent power). Session-gated, preamble/STOP-gated, rate-limited, and
        independently audited.
      </p>
      <form aria-label="Vibe prompt" onSubmit={(e) => void onSubmit(e)}>
        <textarea
          aria-label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={status === 'running'}
        />
        <button type="submit" disabled={status === 'running' || prompt.trim() === ''}>
          {status === 'running' ? 'Running…' : 'Send'}
        </button>
        <button type="button" onClick={onStop} disabled={status !== 'running'}>
          Stop
        </button>
      </form>
      {status === 'stopped' ? (
        <p data-testid="vibe-status" role="status">
          stopped
        </p>
      ) : null}
      {error ? (
        <p data-testid="vibe-status" role="alert">
          refused: {error}
        </p>
      ) : null}
      <Timeline model={model} />
    </section>
  );
}

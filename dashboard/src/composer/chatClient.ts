/**
 * C1 — Composer's chat client. Extends the `Vibe.tsx#defaultVibeStream` pattern (an injectable stream fn
 * so component tests never touch a real network or `claude` process) with the one thing multi-turn needs:
 * a `resumeId` round-trip. It POSTs `{ prompt, resumeId }` to the governed `/api/composer/turn` endpoint
 * (bearer session token attached), reads the server's TYPED NDJSON frames, and returns the CLI session id
 * carried by the `session` frame so the caller threads it into the next turn.
 *
 * Unlike the vibe client (which re-parses raw stream-json records), the Composer server folds server-side
 * and emits typed frames — {type:'session'|'delta'|'stderr'|'exit'} — so this client reads FRAMES: the
 * `delta` frames already carry a folded `TimelineModel`, and the `session` frame is a server construct
 * with no stream-json record equivalent, so a frame reader is the only shape that can observe it.
 */
import type { TimelineModel } from '../lib/timelineModel';

export interface ComposerStreamOutcome {
  ok: boolean;
  status?: number;
  reason?: string;
  /** The CLI session id captured this turn; feed it back as the next turn's `resumeId`. */
  resumeId?: string;
}

/** Streams one Composer turn: POSTs `{ prompt, resumeId }`, feeds each folded delta to `onDelta`, resolves
 *  with the terminal outcome (carrying the captured `resumeId`). `signal` wires Stop through to abort. */
export type ComposerStreamFn = (
  prompt: string,
  resumeId: string | undefined,
  sessionToken: string | undefined,
  onDelta: (model: TimelineModel) => void,
  signal: AbortSignal,
) => Promise<ComposerStreamOutcome>;

interface Frame {
  type?: string;
  model?: TimelineModel;
  sessionId?: string;
  chunk?: string;
  code?: number;
}

export const defaultComposerStream: ComposerStreamFn = async (prompt, resumeId, sessionToken, onDelta, signal) => {
  let res: Response;
  try {
    res = await fetch('/api/composer/turn', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      // Omit `resumeId` entirely on the first turn — the server treats its absence as "start fresh".
      body: JSON.stringify(resumeId ? { prompt, resumeId } : { prompt }),
      signal,
    });
  } catch {
    return signal.aborted ? { ok: false, reason: 'stopped' } : { ok: false, reason: 'request failed' };
  }

  if (!res.ok || !res.body) {
    let reason = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as { reason?: string; problems?: string[] };
      if (errBody.reason) reason = errBody.reason;
      else if (errBody.problems?.length) reason = errBody.problems.join('; ');
    } catch {
      /* non-JSON error body — fall through to the status-derived reason above */
    }
    return { ok: false, status: res.status, reason };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let captured: string | undefined;
  const stderr: string[] = [];
  let exitCode: number | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        let frame: Frame;
        try {
          frame = JSON.parse(line) as Frame;
        } catch {
          continue; // a malformed frame never crashes the turn (mirrors the vibe client's line handling)
        }
        if (frame.type === 'session' && typeof frame.sessionId === 'string') captured = frame.sessionId;
        else if (frame.type === 'delta' && frame.model) onDelta(frame.model);
        else if (frame.type === 'stderr' && typeof frame.chunk === 'string') stderr.push(frame.chunk);
        else if (frame.type === 'exit' && typeof frame.code === 'number') exitCode = frame.code;
      }
    }
  } catch {
    return signal.aborted ? { ok: false, reason: 'stopped' } : { ok: false, reason: 'response stream failed' };
  }

  const stderrReason = stderr.join('').trim();
  if (stderrReason !== '') {
    const exitSuffix = exitCode !== undefined && exitCode !== 0 ? ` (exit ${exitCode})` : '';
    return { ok: false, reason: `${stderrReason}${exitSuffix}`, resumeId: captured };
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return { ok: false, reason: `composer process exited with code ${exitCode}`, resumeId: captured };
  }
  return { ok: true, resumeId: captured };
};

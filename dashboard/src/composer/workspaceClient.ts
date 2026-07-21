import type { TimelineModel } from '../lib/timelineModel';

export type ComposerSessionState = 'open' | 'archived';
export type ComposerTurnState = 'running' | 'complete' | 'stopped' | 'failed' | 'interrupted';

export interface ComposerTurn {
  turnId: string;
  prompt: string;
  state: ComposerTurnState;
  model: TimelineModel | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** Immutable declaration identity captured when this Composer workspace was opened for an agent. */
export interface ComposerAgentTarget {
  id: string;
  path: string;
  sourceHash: string;
}

export interface ComposerSession {
  composerRef: string;
  title: string;
  state: ComposerSessionState;
  createdAt: string;
  updatedAt: string;
  sourceComposerRef: string | null;
  agent: ComposerAgentTarget | null;
  turns: ComposerTurn[];
}

export interface CreateComposerSessionInput {
  title?: string;
  /** Server resolves this declaration and persists its path + source revision; the browser never invents it. */
  agentId?: string;
}

export interface ComposerStreamOutcome {
  ok: boolean;
  status?: number;
  reason?: string;
}

export type ComposerStreamFn = (
  composerRef: string,
  prompt: string,
  sessionToken: string | undefined,
  onDelta: (model: TimelineModel) => void,
  signal: AbortSignal,
) => Promise<ComposerStreamOutcome>;

type FetchLike = typeof fetch;

function authHeaders(sessionToken: string, json = false): HeadersInit {
  return {
    authorization: `Bearer ${sessionToken}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

async function failure(response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await response.json()) as { detail?: string; reason?: string; error?: string };
    detail = body.detail ?? body.reason ?? body.error ?? '';
  } catch {
    // Status is still enough to fail closed.
  }
  return new Error(detail ? `${response.status}: ${detail}` : `request failed (${response.status})`);
}

export async function listComposerSessions(sessionToken: string, fetchImpl: FetchLike = fetch): Promise<ComposerSession[]> {
  const response = await fetchImpl('/api/composer/sessions', { headers: authHeaders(sessionToken) });
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { sessions?: ComposerSession[] };
  return Array.isArray(body.sessions) ? body.sessions : [];
}

export async function createComposerSession(
  sessionToken: string,
  input: CreateComposerSessionInput = {},
  fetchImpl: FetchLike = fetch,
): Promise<ComposerSession> {
  const response = await fetchImpl('/api/composer/sessions', {
    method: 'POST',
    headers: authHeaders(sessionToken, true),
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await failure(response);
  return ((await response.json()) as { session: ComposerSession }).session;
}

export async function getComposerSession(
  composerRef: string,
  sessionToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ComposerSession> {
  const response = await fetchImpl(`/api/composer/sessions/${encodeURIComponent(composerRef)}`, {
    headers: authHeaders(sessionToken),
  });
  if (!response.ok) throw await failure(response);
  return ((await response.json()) as { session: ComposerSession }).session;
}

async function sessionAction(
  composerRef: string,
  action: 'fork' | 'archive' | 'restore',
  sessionToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ComposerSession> {
  const response = await fetchImpl(`/api/composer/sessions/${encodeURIComponent(composerRef)}/${action}`, {
    method: 'POST',
    headers: authHeaders(sessionToken, true),
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await failure(response);
  return ((await response.json()) as { session: ComposerSession }).session;
}

export const forkComposerSession = (
  composerRef: string,
  sessionToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ComposerSession> => sessionAction(composerRef, 'fork', sessionToken, fetchImpl);

export const archiveComposerSession = (
  composerRef: string,
  sessionToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ComposerSession> => sessionAction(composerRef, 'archive', sessionToken, fetchImpl);

export const restoreComposerSession = (
  composerRef: string,
  sessionToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ComposerSession> => sessionAction(composerRef, 'restore', sessionToken, fetchImpl);

interface StreamFrame {
  type?: string;
  model?: TimelineModel;
  chunk?: string;
  code?: number | null;
}

/** Stream one turn. The only durable identity crossing the browser boundary is composerRef. */
export const defaultComposerStream: ComposerStreamFn = async (
  composerRef,
  prompt,
  sessionToken,
  onDelta,
  signal,
) => {
  let response: Response;
  try {
    response = await fetch(`/api/composer/sessions/${encodeURIComponent(composerRef)}/turns`, {
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

  if (!response.ok || !response.body) return { ok: false, status: response.status, reason: (await failure(response)).message };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const stderr: string[] = [];
  let exitCode: number | null | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame: StreamFrame;
        try {
          frame = JSON.parse(line) as StreamFrame;
        } catch {
          continue;
        }
        if (frame.type === 'delta' && frame.model) onDelta(frame.model);
        else if (frame.type === 'stderr' && typeof frame.chunk === 'string') stderr.push(frame.chunk);
        else if (frame.type === 'exit') exitCode = typeof frame.code === 'number' ? frame.code : null;
      }
    }
  } catch {
    return signal.aborted ? { ok: false, reason: 'stopped' } : { ok: false, reason: 'response stream failed' };
  }

  const stderrReason = stderr.join('').trim();
  if (stderrReason) return { ok: false, reason: stderrReason };
  if (typeof exitCode === 'number' && exitCode !== 0) return { ok: false, reason: `composer exited with code ${exitCode}` };
  return { ok: true };
};

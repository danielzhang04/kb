/**
 * `lib/agentClient` — the read-only agent-detail client (U12).
 *
 * Two things are pinned here, both of which used to be every caller's problem:
 *
 *  1. THE DECLARATION TYPE MATCHES THE WIRE. `server/agents/routes.ts` has always sent the six
 *     complex-agent fields U3 added; the DTO did not say so, so the Agent Management panel widened the
 *     type locally and every other reader stayed blind to them. A local widening describes the wire
 *     for exactly one file, which is how two readers of one endpoint end up disagreeing about it.
 *
 *  2. A FAILED READ CARRIES ITS REASON. The client used to throw a bare `Error` with the status baked
 *     into a string, so a caller that needed to tell "this agent has no declaration" (404) from "the
 *     declaration is broken" (422) from "the read failed" had to wrap `fetch` and read the body the
 *     client was about to discard. The thrown error now carries status, kind, and the server's own
 *     problem object — and it is still an `Error`, so existing `catch` sites are unaffected.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AgentDetailFailure,
  fetchAgentDetail,
  fetchSystemWorkers,
  isAgentDetailFailure,
  type AgentDetailDto,
} from './agentClient';

/** A complete declaration as the server sends one — the six U3 fields included. */
const DETAIL: AgentDetailDto = {
  id: 'ladder-architect',
  declaration: {
    path: 'agents/ladder-architect.md',
    source: 'agents-declaration',
    instructions: '## Operating instructions',
    defaultProfile: 'worker:claude:claude-opus-5',
    allowedProfiles: ['worker:claude:claude-opus-5'],
    tools: ['Read', 'Grep'],
    knowledgeSource: ['memory/ladder-architect.md'],
    autonomyTier: 'T2',
    skills: ['inspector'],
    whatItReplaces: 'a manual promotion review',
    buildsOn: ['codex-worker'],
  },
  codebases: [],
  workflows: [],
  howItRuns: null,
};

function okOnce(payload: unknown): typeof fetch {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch;
}

function failOnce(status: number, body: unknown = {}): typeof fetch {
  return vi.fn(async () => ({ ok: false, status, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchAgentDetail', () => {
  it('encodes the id into the path and returns the server projection verbatim', async () => {
    const fetchImpl = okOnce(DETAIL);
    const detail = await fetchAgentDetail('a/b agent', fetchImpl);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/agents/a%2Fb%20agent');
    expect(detail).toEqual(DETAIL);
  });

  it('carries the six U3 declaration fields the server has always sent', async () => {
    const detail = await fetchAgentDetail('ladder-architect', okOnce(DETAIL));
    // Typed access — this block is a compile-time assertion as much as a runtime one.
    expect(detail.declaration?.tools).toEqual(['Read', 'Grep']);
    expect(detail.declaration?.knowledgeSource).toEqual(['memory/ladder-architect.md']);
    expect(detail.declaration?.autonomyTier).toBe('T2');
    expect(detail.declaration?.skills).toEqual(['inspector']);
    expect(detail.declaration?.whatItReplaces).toBe('a manual promotion review');
    expect(detail.declaration?.buildsOn).toEqual(['codex-worker']);
  });

  it('treats an undeclared field as NULL, never as an error or an empty list', async () => {
    const bare: AgentDetailDto = {
      ...DETAIL,
      declaration: {
        ...DETAIL.declaration!,
        tools: null,
        knowledgeSource: null,
        autonomyTier: null,
        skills: null,
        whatItReplaces: null,
        buildsOn: null,
      },
    };
    const detail = await fetchAgentDetail('legacy', okOnce(bare));
    expect(detail.declaration?.tools).toBeNull();
    expect(detail.declaration?.autonomyTier).toBeNull();
    // Null is the ORDINARY state today, so it must not be smoothed into `[]` — a declared-but-empty
    // tool list and an undeclared one are different facts about the agent file.
    expect(detail.declaration?.skills).not.toEqual([]);
  });

  it('404 ⇒ no-declaration: the daemon answered correctly, this id simply has no declaration file', async () => {
    const error = await fetchAgentDetail('ghost', failOnce(404, { error: 'not-found' })).catch((e: unknown) => e);
    expect(isAgentDetailFailure(error)).toBe(true);
    const failure = error as AgentDetailFailure;
    expect(failure.kind).toBe('no-declaration');
    expect(failure.status).toBe(404);
    expect(failure.declarationProblem).toBeNull();
    expect(failure.problemText).toBeNull();
  });

  it('422 ⇒ invalid, carrying the server problem OBJECT and a file-qualified sentence', async () => {
    const body = {
      error: 'agent-declaration-invalid',
      declaration: { id: 'broken', source: 'agents/broken.md', problem: 'malformed-frontmatter' },
    };
    const error = (await fetchAgentDetail('broken', failOnce(422, body)).catch((e: unknown) => e)) as AgentDetailFailure;
    expect(error.kind).toBe('invalid');
    expect(error.status).toBe(422);
    // The wire shape is an object, not a sentence — a caller that wants the object gets the object.
    expect(error.declarationProblem).toEqual({ id: 'broken', source: 'agents/broken.md', problem: 'malformed-frontmatter' });
    expect(error.problemText).toBe('agents/broken.md: malformed-frontmatter');
  });

  it('anything else ⇒ error, and a non-JSON failure body is still a failure', async () => {
    const five = (await fetchAgentDetail('x', failOnce(500)).catch((e: unknown) => e)) as AgentDetailFailure;
    expect(five.kind).toBe('error');
    expect(five.status).toBe(500);

    const broken = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('not json');
      },
    })) as unknown as typeof fetch;
    const thrown = (await fetchAgentDetail('x', broken).catch((e: unknown) => e)) as AgentDetailFailure;
    expect(thrown.kind).toBe('error');
    expect(thrown.declarationProblem).toBeNull();
  });

  it('is still an Error, so callers that only ever catch keep working unchanged', async () => {
    const error = await fetchAgentDetail('ghost', failOnce(404)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('404');
  });

  it('isAgentDetailFailure refuses an unrelated error — the network case must stay distinguishable', () => {
    expect(isAgentDetailFailure(new Error('offline'))).toBe(false);
    expect(isAgentDetailFailure(null)).toBe(false);
    expect(isAgentDetailFailure('404')).toBe(false);
  });
});

describe('fetchSystemWorkers', () => {
  it('reads the system-worker roster and throws a plain failure on a non-2xx', async () => {
    expect(await fetchSystemWorkers(okOnce([{ id: 'codex', runtime: 'codex' }]))).toEqual([
      { id: 'codex', runtime: 'codex' },
    ]);
    await expect(fetchSystemWorkers(failOnce(503))).rejects.toThrow(/system worker request failed/);
  });
});

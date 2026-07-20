/**
 * C4 — the deploy dispatcher. `deploy(plan, sessionToken, fetch)` maps a VALIDATED DeployPlan (from the C2
 * registry) to the EXISTING governed write endpoint — /api/write/launch for a Task, /api/write/save for a
 * durable Skill/Workflow/Project — and surfaces the governed outcome legibly. It writes no files, chooses
 * no branch, and re-implements no gate: it is a thin client fetch layer over already-merged infrastructure.
 *
 * These tests drive a FAKE fetch throughout — no real network, no real server. They pin the request
 * contract (endpoint, bearer header, exact serialized body) and the outcome mapping (success shape,
 * refusal passthrough, the synchronous fail-closed nudge that must never call fetch).
 */
import { describe, expect, it, vi } from 'vitest';
import { deploy } from './deploy';
import { toDeploy } from './artifactTypes';
import type { DeployPlan } from './artifactTypes';

/** A fake JSON `fetch` response (the write endpoints reply with a single JSON body, not a stream). */
function jsonResponse(body: unknown, opts: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** The parsed body + init of the Nth recorded fetch call. */
function callBody(fetchMock: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[n][1].body as string) as Record<string, unknown>;
}

const TASK_PLAN: DeployPlan = toDeploy('task', {
  project: 'kb',
  action: 'draft',
  target: 'docs/x.md',
  riskTier: 'T1',
  body: 'do the thing',
});

const SKILL_PLAN: DeployPlan = toDeploy('skill', {
  name: 'My Skill',
  description: 'does a thing',
  body: '# steps',
});

const PROJECT_PLAN: DeployPlan = toDeploy('project', { name: 'demo', date: '2026-07-17' });

// C7.5 — an agent plan is a single durable relpath (agents/<slug>.md), endpoint 'save'. It rides the SAME
// governed save path as skill/workflow/project — deploy.ts is UNCHANGED; this pins that wiring.
const AGENT_PLAN: DeployPlan = toDeploy('agent', {
  id: 'research-worker',
  role: 'work',
  runtime: 'claude',
  model: 'claude-sonnet-5',
  description: 'Volume worker for kb-ops housekeeping cards.',
  body: '# Agent: research-worker\n',
});

describe('deploy dispatcher', () => {
  it('task_deploys_via_launch_endpoint', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({
        ok: true,
        cardId: '01J',
        cardPath: 'queue/01J.md',
        runner: { status: 'triggered', owner: 'codex-worker', task: 'kb-codex-runner' },
      })),
    );

    const result = await deploy(TASK_PLAN, 'tok-1', fetchMock);

    // Endpoint + governed convention: bearer header, JSON content-type, the exact launchFields payload
    // LaunchControls sends — {project, action, target, riskTier, body}.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/write/launch');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
    expect(callBody(fetchMock)).toEqual({
      project: 'kb',
      action: 'draft',
      target: 'docs/x.md',
      riskTier: 'T1',
      body: 'do the thing',
    });
    expect(result).toEqual({
      ok: true,
      kind: 'task',
      cardId: '01J',
      cardPath: 'queue/01J.md',
      runner: { status: 'triggered', owner: 'codex-worker', task: 'kb-codex-runner' },
    });
  });

  it('skill_deploys_via_save_endpoint_durable', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true, target: 'PR #42 → main' })),
    );

    const result = await deploy(SKILL_PLAN, 'tok-2', fetchMock);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/write/save');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-2');
    const body = callBody(fetchMock);
    expect(body.relpath).toBe('skills/learned/my-skill/SKILL.md');
    expect(body.content).toBe(SKILL_PLAN.content);
    // A commit message is composed from the plan kind + relpath (the server defaults it otherwise).
    expect(typeof body.message).toBe('string');
    expect(body.message as string).toContain('skill');
    expect(body.message as string).toContain('skills/learned/my-skill/SKILL.md');
    // Success surfaces the durable target (branch/PR info) the save endpoint returns.
    expect(result).toEqual({ ok: true, kind: 'skill', target: 'PR #42 → main' });
  });

  it('agent_deploys_via_save_endpoint_durable', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true, target: 'claude/agent-research-worker → PR to main' })),
    );

    const result = await deploy(AGENT_PLAN, 'tok-a', fetchMock);

    // An agent plan rides the EXISTING /api/write/save durable path unchanged — {relpath, content, message},
    // bearer header, and NO workBranch (asserted globally below).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/write/save');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-a');
    const body = callBody(fetchMock);
    expect(body.relpath).toBe('agents/research-worker.md');
    expect(body.content).toBe(AGENT_PLAN.content);
    // The declared file the registry commits carries runner-bound: false (never true).
    expect(body.content as string).toContain('runner-bound: false');
    expect(typeof body.message).toBe('string');
    expect(body.message as string).toContain('agent');
    expect(body.message as string).toContain('agents/research-worker.md');
    // Success surfaces the durable target (branch/PR info) the save endpoint returns.
    expect(result).toEqual({ ok: true, kind: 'agent', target: 'claude/agent-research-worker → PR to main' });
  });

  it('no_session_is_a_synchronous_nudge_no_fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));

    const result = await deploy(SKILL_PLAN, undefined, fetchMock);

    // Fail-closed exactly like LaunchControls: no token → a nudge to authenticate, and fetch is NEVER called.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeUndefined();
      expect(result.reason).toMatch(/passkey|sign in|session/i);
    }
  });

  it('save_refusal_surfaces_reason', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: 'save-refused', reason: 'path escapes repo' }, { ok: false, status: 400 })),
    );

    const result = await deploy(SKILL_PLAN, 'tok', fetchMock);

    expect(result).toEqual({ ok: false, status: 400, error: 'save-refused', reason: 'path escapes repo' });
  });

  it('save_refusal_surfaces_409_approval_locked_shape', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: 'approval-locked', reason: 'card under active approval' }, { ok: false, status: 409 })),
    );

    const result = await deploy(SKILL_PLAN, 'tok', fetchMock);

    // The 409 approval-locked shape used elsewhere passes through status + error code + reason unchanged.
    expect(result).toEqual({ ok: false, status: 409, error: 'approval-locked', reason: 'card under active approval' });
  });

  it('launch_refusal_surfaces_reason', async () => {
    // The launch endpoint's refusal body carries the reason under `error` (routes.ts), with an optional
    // `detail` — the dispatcher must surface that as the human reason, not an empty string.
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: 'fleet-frozen', detail: 'STOP present' }, { ok: false, status: 503 })),
    );

    const result = await deploy(TASK_PLAN, 'tok', fetchMock);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.reason).toBe('fleet-frozen');
    }
  });

  it('never_sends_workBranch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, target: 't' })));

    // Assert the SERIALIZED body of every write — the server owns the branch; a client-supplied workBranch
    // targeting main/ops is hard-403'd, so we must never send the key at all.
    for (const plan of [TASK_PLAN, SKILL_PLAN, PROJECT_PLAN, AGENT_PLAN]) {
      fetchMock.mockClear();
      await deploy(plan, 'tok', fetchMock);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(callBody(fetchMock)).not.toHaveProperty('workBranch');
    }
  });

  it('followups_returned_not_autofired', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, target: 'PR → main' })));

    const result = await deploy(PROJECT_PLAN, 'tok', fetchMock);

    // v1 deploys the PRIMARY file only — exactly one save fires (the _index.md), never N saves.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(callBody(fetchMock).relpath).toBe(PROJECT_PLAN.relpath);
    // The three sibling files ride back in the result untouched for the UI to offer as subsequent saves.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.followUps).toEqual(PROJECT_PLAN.followUps);
  });
});

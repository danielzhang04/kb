/**
 * #2 Inbox — cardRespond.ts unit tests: the (state, action, verb) authorization matrix (planResponse)
 * and respondToCard's refusal short-circuit + op composition (recording fake PyRunner, no real py).
 */
import { describe, expect, it, vi } from 'vitest';
import { planResponse, respondToCard } from './cardRespond.ts';
import type { PyRunner } from './launch.ts';

const ISO = '2026-07-19T12:00:00.000Z';

describe('planResponse', () => {
  it('allows reply only for an input inbox card and names the expected shape otherwise', () => {
    const ok = planResponse('inbox', 'needs-input:choose', 'reply', 'hi', ISO);
    expect(ok).toMatchObject({ ok: true, plan: { section: 'Feedback', transitions: [], claimOwner: null } });
    expect(ok.ok && ok.plan.block).toBe('Reply from operator (2026-07-19T12:00:00.000Z):\nhi');
    expect(planResponse('inbox', 'wake-me:x', 'reply', 'hi', ISO).ok).toBe(false);
    expect(planResponse('inbox', 'research:topic', 'reply', 'hi', ISO).ok).toBe(false);
  });

  it('maps resolve to the right section + transitions per card state', () => {
    expect(planResponse('inbox', 'wake-me:runner', 'resolve', 'm', ISO)).toMatchObject({
      ok: true, plan: { section: 'Result', transitions: ['working', 'done'], claimOwner: 'human-operator' },
    });
    expect(planResponse('blocked', 'route:unknown', 'resolve', 'm', ISO)).toMatchObject({
      ok: true, plan: { section: 'Feedback', transitions: ['inbox'], claimOwner: null },
    });
    expect(planResponse('halted', 'research:atlas', 'resolve', 'm', ISO)).toMatchObject({
      ok: true, plan: { section: 'Result', transitions: [], claimOwner: null },
    });
    expect(planResponse('working', 'build:site', 'resolve', 'm', ISO).ok).toBe(false);
    expect(planResponse('approvals', 'deploy:prod', 'resolve', 'm', ISO).ok).toBe(false);
  });
});

describe('respondToCard', () => {
  it('refuses an illegal combo without preparing the write or spawning a subprocess', async () => {
    const prepareWrite = vi.fn();
    const runPy = vi.fn();
    const outcome = await respondToCard(
      { cardId: 'c1', state: 'working', action: 'build:site', verb: 'resolve', message: 'm', iso: ISO },
      { repoRoot: '/repo', runPy: runPy as unknown as PyRunner, prepareWrite },
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'not-allowed' });
    expect(prepareWrite).not.toHaveBeenCalled();
    expect(runPy).not.toHaveBeenCalled();
  });

  it('prepares the write before running cards.py and returns the parsed paths on success', async () => {
    const calls: string[] = [];
    const prepareWrite = vi.fn(async () => { calls.push('prepare'); });
    const runPy: PyRunner = (_repo, _code, jsonArg) => {
      calls.push('py');
      const op = JSON.parse(jsonArg) as { cardId: string };
      return { exitCode: 0, stdout: JSON.stringify({ id: op.cardId, state: 'done', paths: ['queue/inbox/c1.md', 'queue/done/c1.md'] }), stderr: '' };
    };
    const outcome = await respondToCard(
      { cardId: 'c1', state: 'inbox', action: 'wake-me:x', verb: 'resolve', message: 'm', iso: ISO },
      { repoRoot: '/repo', runPy, prepareWrite },
    );
    expect(outcome).toEqual({ ok: true, cardId: 'c1', state: 'done', paths: ['queue/inbox/c1.md', 'queue/done/c1.md'] });
    expect(calls).toEqual(['prepare', 'py']);
  });

  it('reports a card-op-failure when cards.py exits non-zero', async () => {
    const runPy: PyRunner = () => ({ exitCode: 1, stdout: '', stderr: 'illegal transition' });
    const outcome = await respondToCard(
      { cardId: 'c1', state: 'inbox', action: 'wake-me:x', verb: 'resolve', message: 'm', iso: ISO },
      { repoRoot: '/repo', runPy, prepareWrite: async () => {} },
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'card-op-failed', detail: 'illegal transition' });
  });
});

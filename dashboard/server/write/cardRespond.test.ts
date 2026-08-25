/**
 * #2 Inbox — cardRespond.ts unit tests: the (state, action, verb) authorization matrix (planResponse)
 * and respondToCard's refusal short-circuit + op composition (recording fake PyRunner, no real py).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CARD_RESPOND_SCRIPT, CardOpError, executeCardMutation, planResponse, respondToCard } from './cardRespond.ts';
import { runPythonSync } from '../runtime/python.ts';
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

/**
 * T4 — the extracted cards.py executor the merge-gate reconciler reuses. respondToCard is now
 * planResponse -> executeCardMutation, so the tests above are the behavior-unchanged regression for the
 * respond path; these lock the extracted executor's own contract (plain success shape + CardOpError).
 */
describe('executeCardMutation', () => {
  it('prepares before running cards.py and returns the parsed {id,state,paths}', async () => {
    const calls: string[] = [];
    const prepareWrite = vi.fn(async () => { calls.push('prepare'); });
    const runPy: PyRunner = (_repo, _code, jsonArg) => {
      calls.push('py');
      const op = JSON.parse(jsonArg) as { cardId: string; section: string; transitions: string[]; claimOwner: string | null };
      expect(op).toMatchObject({ cardId: 'c1', section: 'Result', transitions: ['working', 'done'], claimOwner: 'human-operator' });
      return { exitCode: 0, stdout: JSON.stringify({ id: op.cardId, state: 'done', paths: ['queue/inbox/c1.md', 'queue/done/c1.md'] }), stderr: '' };
    };
    const result = await executeCardMutation(
      { cardId: 'c1', section: 'Result', block: 'note', transitions: ['working', 'done'], claimOwner: 'human-operator' },
      { repoRoot: '/repo', runPy, prepareWrite },
    );
    expect(result).toEqual({ id: 'c1', state: 'done', paths: ['queue/inbox/c1.md', 'queue/done/c1.md'] });
    expect(calls).toEqual(['prepare', 'py']);
  });

  it('sends a pure-transition op (no section, empty block) when neither is supplied', async () => {
    let sent: { section: unknown; block: unknown } | null = null;
    const runPy: PyRunner = (_repo, _code, jsonArg) => {
      const op = JSON.parse(jsonArg) as { cardId: string; section: unknown; block: unknown };
      sent = { section: op.section, block: op.block };
      return { exitCode: 0, stdout: JSON.stringify({ id: op.cardId, state: 'inbox', paths: ['queue/inbox/c1.md'] }), stderr: '' };
    };
    const result = await executeCardMutation(
      { cardId: 'c1', transitions: ['inbox'], claimOwner: null },
      { repoRoot: '/repo', runPy, prepareWrite: async () => {} },
    );
    expect(sent).toEqual({ section: null, block: '' });
    expect(result).toEqual({ id: 'c1', state: 'inbox', paths: ['queue/inbox/c1.md'] });
  });

  it('throws CardOpError on a non-zero cards.py exit and on a prepare failure', async () => {
    const failPy: PyRunner = () => ({ exitCode: 1, stdout: '', stderr: 'illegal transition' });
    await expect(executeCardMutation(
      { cardId: 'c1', section: 'Result', block: 'n', transitions: [], claimOwner: null },
      { repoRoot: '/repo', runPy: failPy, prepareWrite: async () => {} },
    )).rejects.toBeInstanceOf(CardOpError);

    const okPy: PyRunner = () => ({ exitCode: 0, stdout: '{}', stderr: '' });
    await expect(executeCardMutation(
      { cardId: 'c1', section: 'Result', block: 'n', transitions: [], claimOwner: null },
      { repoRoot: '/repo', runPy: okPy, prepareWrite: async () => { throw new Error('pull failed'); } },
    )).rejects.toThrow(/could not prepare coordination write: pull failed/);
  });
});

/**
 * The real CARD_RESPOND_SCRIPT against the real scripts/cards.py in a hermetic queue. This is what
 * proves the pure-transition support: a blockless op must walk the card through the state ladder while
 * leaving its body byte-for-byte unchanged — the reconciliation publisher's `cards` port passes an empty
 * block for every legal transition that records no operator text, and the old script injected a spurious
 * empty `## Result` there. A non-empty block still appends its section exactly as before.
 */
describe('CARD_RESPOND_SCRIPT (real cards.py)', () => {
  const repoRoot = resolve(process.cwd(), '..');

  function hermeticQueue(): { dir: string; runScript: (op: unknown) => { id: string; state: string; paths: string[] } } {
    const dir = mkdtempSync(join(tmpdir(), 'card-respond-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(join(repoRoot, 'scripts', 'cards.py'), join(dir, 'scripts', 'cards.py'));
    return {
      dir,
      runScript: (op) => {
        const stdout = runPythonSync(['-c', CARD_RESPOND_SCRIPT, JSON.stringify(op)], { cwd: dir, platformRoot: dir });
        return JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() as string) as { id: string; state: string; paths: string[] };
      },
    };
  }

  function mintInboxCard(dir: string, cardId: string): void {
    runPythonSync(['-c', [
      'import sys',
      'from pathlib import Path',
      'sys.path.insert(0, "scripts")',
      'import cards',
      'c = cards.new_card("proj", "research:x", "target-x", "T1", body="## Work order\\n\\ndo it\\n")',
      `c.meta["id"] = "${cardId}"`,
      'cards.claim(c, "human-operator")',
      'cards.save(c, Path("queue"))',
    ].join('\n')], { cwd: dir, platformRoot: dir });
  }

  it('walks a blockless op inbox -> working -> done and leaves the body unchanged', () => {
    const { dir, runScript } = hermeticQueue();
    try {
      mintInboxCard(dir, 'pure-transition-1');
      const out = runScript({ cardId: 'pure-transition-1', section: null, block: '', transitions: ['working', 'done'], claimOwner: null });
      expect(out.state).toBe('done');
      expect(out.paths).toEqual(['queue/inbox/pure-transition-1.md', 'queue/done/pure-transition-1.md']);
      const body = readFileSync(join(dir, 'queue', 'done', 'pure-transition-1.md'), 'utf8');
      expect(body).not.toContain('## Result');
      expect(body).not.toContain('## Feedback');
      expect(body).toContain('## Work order');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still appends the named section when a non-empty block is supplied', () => {
    const { dir, runScript } = hermeticQueue();
    try {
      mintInboxCard(dir, 'with-block-1');
      const out = runScript({ cardId: 'with-block-1', section: 'Result', block: 'resolved note', transitions: ['working', 'done'], claimOwner: 'human-operator' });
      expect(out.state).toBe('done');
      const body = readFileSync(join(dir, 'queue', 'done', 'with-block-1.md'), 'utf8');
      expect(body).toContain('## Result');
      expect(body).toContain('resolved note');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

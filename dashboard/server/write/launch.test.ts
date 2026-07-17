/**
 * D2.6 — governed card launch / rerun-as-depends-on. Every test injects a fake `PreambleRunner` and
 * `PyRunner` (see `launch.ts`'s module docstring for why: `scripts/cards.py` is a MODULE, not a CLI,
 * and no test here ever shells a real `py` binary or touches a real `queue/` tree — fully hermetic).
 */
import { describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  buildRerunBody,
  launchCard,
  rerunAsDependsOn,
  CARD_OP_SCRIPT,
} from './launch.ts';
import type { LaunchDeps, PyRunResult, PyRunner, SessionInput } from './launch.ts';
import type { PreambleRunner } from './preambleGate.ts';

const SECRET = Buffer.from('launch-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}

function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}

/** Records every invocation so tests can assert exactly what would have been shelled (or wasn't). */
function recordingPyRunner(result: PyRunResult): { runner: PyRunner; calls: Array<{ code: string; jsonArg: string }> } {
  const calls: Array<{ code: string; jsonArg: string }> = [];
  const runner: PyRunner = (_repoRoot, code, jsonArg) => {
    calls.push({ code, jsonArg });
    return result;
  };
  return { runner, calls };
}

function validSession(): SessionInput {
  const { token } = mintSession('operator-1', SESSION_CONFIG);
  return { token, config: SESSION_CONFIG };
}

function baseDeps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    repoRoot: '/repo',
    runPreamble: okPreamble(),
    runPy: recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"new-card-id","path":"queue/inbox/new-card-id.md"}\n',
      stderr: '',
    }).runner,
    ...overrides,
  };
}

describe('launchCard / rerunAsDependsOn — preamble gate (runs first, spawns nothing on failure)', () => {
  it('refuses to launch/rerun when STOP is present — no scripts/cards.py-shelling subprocess is spawned', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
    const deps = baseDeps({ runPreamble: frozenPreamble('STOP file present — fleet is frozen'), runPy });

    const launchResult = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1' },
      validSession(),
      deps,
    );
    expect(launchResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['STOP file present — fleet is frozen'],
    });

    const rerunResult = rerunAsDependsOn('orig-card-id', 'please retry with X', validSession(), deps);
    expect(rerunResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['STOP file present — fleet is frozen'],
    });

    // The load-bearing assertion: STOP-frozen must spawn NOTHING, not even the cards.py module shell.
    expect(calls).toHaveLength(0);
  });

  it('refuses to launch when ANTHROPIC_API_KEY is set or the budget is exceeded — no subprocess spawned', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });

    const apiKeyDeps = baseDeps({
      runPreamble: frozenPreamble('ANTHROPIC_API_KEY is set — would silently bill to API; unset it'),
      runPy,
    });
    const apiKeyResult = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1' },
      validSession(),
      apiKeyDeps,
    );
    expect(apiKeyResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['ANTHROPIC_API_KEY is set — would silently bill to API; unset it'],
    });

    const budgetDeps = baseDeps({
      runPreamble: frozenPreamble('daily budget breached: $6.00 >= $5.00'),
      runPy,
    });
    const budgetResult = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1' },
      validSession(),
      budgetDeps,
    );
    expect(budgetResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['daily budget breached: $6.00 >= $5.00'],
    });

    expect(calls).toHaveLength(0);
  });
});

describe('launchCard / rerunAsDependsOn — WebAuthn session gate (checked only after the preamble passes)', () => {
  it('rejects launch/rerun without a WebAuthn session', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
    const deps = baseDeps({ runPy });
    const noSession: SessionInput = { token: null, config: SESSION_CONFIG };

    const launchResult = launchCard({ project: 'kb', action: 'demo', target: '.', riskTier: 'T1' }, noSession, deps);
    expect(launchResult.ok).toBe(false);
    if (!launchResult.ok) expect(launchResult.reason).toBe('unauthenticated');

    const rerunResult = rerunAsDependsOn('orig-card-id', 'feedback', noSession, deps);
    expect(rerunResult.ok).toBe(false);
    if (!rerunResult.ok) expect(rerunResult.reason).toBe('unauthenticated');

    expect(calls).toHaveLength(0);
  });

  it('rejects an expired/tampered session token the same way as a missing one', () => {
    const deps = baseDeps();
    const expiredConfig: SessionConfig = { secret: SECRET, now: () => 0, ttlMs: 1 };
    const { token } = mintSession('operator-1', expiredConfig);
    const laterSession: SessionInput = { token, config: { secret: SECRET, now: () => 1_000_000 } };

    const result = launchCard({ project: 'kb', action: 'demo', target: '.', riskTier: 'T1' }, laterSession, deps);
    expect(result).toEqual({ ok: false, reason: 'unauthenticated', detail: 'expired' });
  });
});

describe('launchCard — governed dispatch (shells scripts/cards.py; no raw queue/ write)', () => {
  it('shells scripts/cards.py; no raw queue/ write', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"abc123","path":"queue/inbox/abc123.md"}\n',
      stderr: '',
    });
    const deps = baseDeps({ runPy });

    const result = launchCard(
      { project: 'kb', action: 'demo-thing', target: 'docs/x.md', riskTier: 'T2', body: '## Work order\n\ndo it\n' },
      validSession(),
      deps,
    );

    expect(result).toEqual({ ok: true, cardId: 'abc123', cardPath: 'queue/inbox/abc123.md' });

    // Exactly one subprocess call, and it is the governed CARD_OP_SCRIPT — which imports
    // scripts/cards.py as a module and calls cards.new_card/cards.save — never a direct fs write.
    expect(calls).toHaveLength(1);
    expect(calls[0].code).toBe(CARD_OP_SCRIPT);
    expect(CARD_OP_SCRIPT).toContain('import cards');
    expect(CARD_OP_SCRIPT).toContain('cards.save(card, queue_root)');
    const payload = JSON.parse(calls[0].jsonArg);
    expect(payload).toMatchObject({
      kind: 'new',
      project: 'kb',
      action: 'demo-thing',
      target: 'docs/x.md',
      riskTier: 'T2',
    });
  });

  it('surfaces a card-op failure (non-zero exit) instead of pretending success', () => {
    const { runner: runPy } = recordingPyRunner({ exitCode: 1, stdout: '', stderr: 'ValidationError: bad tier' });
    const deps = baseDeps({ runPy });
    const result = launchCard({ project: 'kb', action: 'x', target: '.', riskTier: 'T1' }, validSession(), deps);
    expect(result).toEqual({ ok: false, reason: 'card-op-failed', detail: 'ValidationError: bad tier' });
  });
});

describe('rerunAsDependsOn — rerun files depends-on card w/ feedback in ## Evidence', () => {
  // NAMED-TEST NOTE (flagged deviation — see launch.ts module docstring for the full rationale):
  // the plan text titles this test "...feedback in ## Evidence". governance/card-schema.md — the
  // single normative body-sections list — documents a DEDICATED "## Feedback" section for exactly
  // this (steer text on a requeue/rerun), and reserves "## Evidence" for free text from UNTRUSTED
  // SOURCES. This test keeps the plan's literal title for traceability but asserts against the
  // schema-documented "## Feedback" section, which is what the implementation actually does.
  it('rerun files depends-on card w/ feedback in ## Evidence', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"rerun-1","path":"queue/inbox/rerun-1.md"}\n',
      stderr: '',
    });
    const deps = baseDeps({ runPy });

    const result = rerunAsDependsOn('orig-card-id', 'try again with the smaller batch size', validSession(), deps);

    expect(result).toEqual({ ok: true, cardId: 'rerun-1', cardPath: 'queue/inbox/rerun-1.md' });
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].jsonArg);
    expect(payload.kind).toBe('rerun');
    expect(payload.cardId).toBe('orig-card-id');

    // Feedback is inert data: it lands in ## Feedback (per card-schema.md), blockquoted like
    // ## Evidence, and depends-on is expressed via cardId — never parsed as action/target/risk-tier.
    expect(payload.body).toContain('## Feedback');
    expect(payload.body).not.toContain('## Evidence');
    expect(payload.body).toContain('> try again with the smaller batch size');
  });

  it('buildRerunBody blockquotes multi-line feedback and preserves blank lines as bare ">"', () => {
    const body = buildRerunBody('orig-1', 'line one\n\nline two');
    expect(body).toContain('## Feedback');
    expect(body).toContain('> line one');
    expect(body).toContain('>\n> line two');
  });
});

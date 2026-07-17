/**
 * D2.4 — `driveVerify` shells the correct verifier per channel via an injected `PyRunner` (the same DI
 * shape `write/launch.ts` uses), fully hermetic — no test here shells a real `py` binary or touches a
 * real `queue/` tree.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  driveVerify,
  listPending,
  SIGNED_VERIFY_SCRIPT,
  POSSESSION_VERIFY_SCRIPT,
  WEBAUTHN_VERIFY_SCRIPT,
} from './inbox.ts';
import type { DriveVerifyDeps, VerifiedCardView } from './inbox.ts';
import type { PyRunner, PyRunResult } from '../write/launch.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { ParsedCard } from '../planeA/cards.ts';

/** Records every invocation so tests can assert exactly what would have been shelled (or wasn't). */
function recordingPyRunner(
  result: PyRunResult,
): { runner: PyRunner; calls: Array<{ repoRoot: string; code: string; jsonArg: string }> } {
  const calls: Array<{ repoRoot: string; code: string; jsonArg: string }> = [];
  const runner: PyRunner = (repoRoot, code, jsonArg) => {
    calls.push({ repoRoot, code, jsonArg });
    return result;
  };
  return { runner, calls };
}

const EMPTY_LEDGERS: PlaneAIndex['ledgers'] = {
  dispatch: { count: 0, cards: 0, byProject: {} },
  cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
  grades: { count: 0, rows: [] },
  activity: { count: 0, rows: [] },
};

function card(id: string, riskTier: string): ParsedCard {
  return {
    meta: { id, project: 'kb', action: 'demo', target: '.', 'risk-tier': riskTier, owner: null, state: 'approvals' },
    body: '',
  };
}

describe('driveVerify — fleet signed/possession channels (module interface, never a CLI subcommand)', () => {
  it('driveVerify invokes the fleet verifier via the module interface (python -c), never a nonexistent CLI subcommand, and never writes queue/ directly', () => {
    const { runner, calls } = recordingPyRunner({ exitCode: 0, stdout: '{"ok":true,"reason":"ok"}\n', stderr: '' });
    const deps: DriveVerifyDeps = { repoRoot: '/repo', runPy: runner };

    const outcome = driveVerify('queue/approvals/card-1.md', 'signed', deps);

    expect(outcome).toEqual({ ok: true, reason: 'ok' });
    expect(calls).toHaveLength(1);

    // The shelled command IS the documented module interface: `import sys; sys.path.insert(0,
    // 'scripts'); import approvals; ...` — never the nonexistent `approvals.py verify_signed_approval`
    // CLI subcommand (approvals.py has no argparse CLI at all).
    expect(calls[0].code).toBe(SIGNED_VERIFY_SCRIPT);
    expect(calls[0].code).toContain('sys.path.insert(0, "scripts")');
    expect(calls[0].code).toContain('import approvals');
    expect(calls[0].code).toContain('approvals.verify_signed_approval(');
    expect(calls[0].code).not.toMatch(/approvals\.py\s+verify_signed_approval/);

    // Never a raw queue/ write: no cards.py import/save, no direct file-open in the shelled script.
    expect(calls[0].code).not.toContain('import cards');
    expect(calls[0].code).not.toContain('cards.save');
    expect(calls[0].code).not.toContain('open(');

    expect(JSON.parse(calls[0].jsonArg)).toEqual(['queue/approvals/card-1.md', '/repo']);
  });

  it('the possession channel drives approvals.verify_telegram_approval via the same module interface', () => {
    const { runner, calls } = recordingPyRunner({ exitCode: 0, stdout: '{"ok":false,"reason":"nope"}\n', stderr: '' });
    const deps: DriveVerifyDeps = { repoRoot: '/repo', runPy: runner };

    const outcome = driveVerify('queue/approvals/card-2.md', 'possession', deps);

    expect(outcome).toEqual({ ok: false, reason: 'nope' });
    expect(calls[0].code).toBe(POSSESSION_VERIFY_SCRIPT);
    expect(calls[0].code).toContain('approvals.verify_telegram_approval(');
    expect(calls[0].code).not.toMatch(/approvals\.py\s+verify_telegram_approval/);
  });

  it('surfaces a non-zero exit as a rejection instead of pretending success', () => {
    const { runner } = recordingPyRunner({ exitCode: 1, stdout: '', stderr: 'boom' });
    const outcome = driveVerify('queue/approvals/card-1.md', 'signed', { repoRoot: '/repo', runPy: runner });
    expect(outcome).toEqual({ ok: false, reason: 'boom' });
  });

  it('fails closed on unparseable verifier stdout rather than defaulting to accept', () => {
    const { runner } = recordingPyRunner({ exitCode: 0, stdout: 'not json at all', stderr: '' });
    const outcome = driveVerify('queue/approvals/card-1.md', 'signed', { repoRoot: '/repo', runPy: runner });
    expect(outcome.ok).toBe(false);
  });
});

describe('driveVerify — WebAuthn channel (D2.3 verifier + pinned-content execute)', () => {
  it('a WebAuthn-channel card drives scripts/webauthn_verify.py and the pinned-content execute', () => {
    const pinnedCard: VerifiedCardView = {
      id: 'card-3',
      action: 'demo',
      target: 'docs/x.md',
      riskTier: 'T3',
      owner: 'claude-m1',
      body: '## Work order\n\ndo it\n',
    };
    const { runner, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: `${JSON.stringify({ ok: true, reason: 'ok', card: pinnedCard })}\n`,
      stderr: '',
    });
    const execute = vi.fn();
    const deps: DriveVerifyDeps = { repoRoot: '/repo', runPy: runner, execute };

    const outcome = driveVerify('queue/approvals/card-3.md', 'webauthn', deps);

    expect(outcome).toEqual({ ok: true, reason: 'ok', card: pinnedCard });
    expect(calls[0].code).toBe(WEBAUTHN_VERIFY_SCRIPT);
    expect(calls[0].code).toContain('import webauthn_verify');
    expect(calls[0].code).toContain('webauthn_verify.verify_webauthn_approval(');

    // The D2.3 verifier ran (asserted above) AND, on ok, the executor runs against the EXACT pinned
    // card view the verifier returned — never a re-read of the working tree.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(pinnedCard);
  });

  it('never triggers the execute on a rejected WebAuthn verify', () => {
    const { runner } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"ok":false,"reason":"signature does not verify against the pinned public key"}\n',
      stderr: '',
    });
    const execute = vi.fn();
    const outcome = driveVerify('queue/approvals/card-3.md', 'webauthn', { repoRoot: '/repo', runPy: runner, execute });

    expect(outcome).toEqual({ ok: false, reason: 'signature does not verify against the pinned public key' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('never triggers execute for the fleet channels, even on an ok result carrying a card', () => {
    const pinnedCard: VerifiedCardView = { id: 'x', action: 'a', target: 't', riskTier: 'T1', owner: null, body: '' };
    const { runner } = recordingPyRunner({
      exitCode: 0,
      stdout: `${JSON.stringify({ ok: true, reason: 'ok', card: pinnedCard })}\n`,
      stderr: '',
    });
    const execute = vi.fn();
    const outcome = driveVerify('queue/approvals/card-1.md', 'signed', { repoRoot: '/repo', runPy: runner, execute });

    expect(outcome.ok).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('listPending', () => {
  it('ranks T3 before T2 before T1, ties broken by id', () => {
    const index: PlaneAIndex = {
      cards: { approvals: [card('b', 'T1'), card('a', 'T3'), card('c', 'T2'), card('a2', 'T3')] },
      ledgers: EMPTY_LEDGERS,
      orgStates: [],
    };
    expect(listPending(index).map((c) => c.meta.id)).toEqual(['a', 'a2', 'c', 'b']);
  });

  it('returns an empty list when there is no approvals bucket', () => {
    const index: PlaneAIndex = { cards: {}, ledgers: EMPTY_LEDGERS, orgStates: [] };
    expect(listPending(index)).toEqual([]);
  });
});

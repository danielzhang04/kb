/**
 * D2.6 — preamble gate. All tests inject a fake `PreambleRunner` (never a real `py`/STOP file/env)
 * so the suite is hermetic regardless of the host machine's actual fleet state.
 */
import { describe, expect, it } from 'vitest';
import { assertFleetRunnable } from './preambleGate';
import type { PreambleRunResult, PreambleRunner } from './preambleGate';

function fakeRunner(result: PreambleRunResult): PreambleRunner {
  return () => result;
}

describe('assertFleetRunnable', () => {
  it('is ok when the shelled preamble exits 0 ("PREAMBLE OK")', () => {
    const runner = fakeRunner({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
    const result = assertFleetRunnable('/repo', runner);
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it('refuses when STOP is present (parses the "PREAMBLE FAIL: ..." line)', () => {
    const runner = fakeRunner({
      exitCode: 2,
      stdout: 'PREAMBLE FAIL: STOP file present — fleet is frozen\n',
      stderr: '',
    });
    const result = assertFleetRunnable('/repo', runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual(['STOP file present — fleet is frozen']);
    }
  });

  it('refuses when ANTHROPIC_API_KEY is set or the budget is exceeded (kept as one opaque message — see', () => {
    // scripts/preamble.py's own ANTHROPIC_API_KEY message embeds a literal "; ", which makes a naive
    // split of its "; ".join(problems) output ambiguous; assertFleetRunnable deliberately does not
    // attempt to split it back into separate entries (see the doc comment on assertFleetRunnable).
    const runner = fakeRunner({
      exitCode: 2,
      stdout:
        'PREAMBLE FAIL: ANTHROPIC_API_KEY is set — would silently bill to API; unset it; daily budget breached: $6.00 >= $5.00\n',
      stderr: '',
    });
    const result = assertFleetRunnable('/repo', runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        'ANTHROPIC_API_KEY is set — would silently bill to API; unset it; daily budget breached: $6.00 >= $5.00',
      ]);
    }
  });

  it('falls back to stderr/exit-code framing when stdout carries no recognizable FAIL line', () => {
    const runner = fakeRunner({ exitCode: 1, stdout: '', stderr: 'boom: python crashed' });
    const result = assertFleetRunnable('/repo', runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual(['boom: python crashed']);
    }
  });

  it('passes repoRoot through to the injected runner unchanged', () => {
    const seen: string[] = [];
    const runner: PreambleRunner = (repoRoot) => {
      seen.push(repoRoot);
      return { exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' };
    };
    assertFleetRunnable('/some/repo/root', runner);
    expect(seen).toEqual(['/some/repo/root']);
  });
});

/**
 * D3.1 MED mitigation — M6: the host's Factor C subprocess invocation. Hermetic (injected runner; no real
 * `py`). Proves: the assertion travels via STDIN JSON (never argv), the one-line `{ok,reason}` is parsed,
 * and every failure mode (non-zero exit, unparseable output, spawn error, ok-without-exit-0) fails closed.
 */
import { describe, expect, it } from 'vitest';
import { makePtyAssertionVerifier, PTY_VERIFY_SCRIPT } from './ptyAssertionVerify.ts';
import type { PtyVerifyRunner } from './ptyAssertionVerify.ts';
import type { PtyAssertion } from './ptyProtocol.ts';

const ASSERTION: PtyAssertion = {
  credentialId: 'cred-1',
  authenticatorData: 'YXV0aA',
  clientDataJSON: 'Y2RhdGE',
  signature: 'c2ln',
};
const CHALLENGE = 'WyJrYi1wdHktb3BlbiIsImRHVnpkQzF1YjI1alpRIl0';

/** A runner that records what it was asked to run and returns a canned result. */
function recordingRunner(result: { exitCode: number; stdout: string; stderr: string }) {
  const calls: Array<{ repoRoot: string; script: string; stdinJson: string }> = [];
  const runner: PtyVerifyRunner = (repoRoot, script, stdinJson) => {
    calls.push({ repoRoot, script, stdinJson });
    return result;
  };
  return { runner, calls };
}

describe('makePtyAssertionVerifier — invocation contract', () => {
  it('passes the assertion via STDIN JSON (never argv) and includes the expected challenge + repoRoot', () => {
    const rr = recordingRunner({ exitCode: 0, stdout: '{"ok":true,"reason":"ok"}', stderr: '' });
    const verify = makePtyAssertionVerifier({ repoRoot: '/repo', runPy: rr.runner });
    const out = verify({ expectedChallenge: CHALLENGE, assertion: ASSERTION });

    expect(out).toEqual({ ok: true, reason: 'ok' });
    expect(rr.calls).toHaveLength(1);
    // The fixed -c script is used (no interpolation of the assertion into it).
    expect(rr.calls[0].script).toBe(PTY_VERIFY_SCRIPT);
    // The assertion + challenge + repoRoot are all in the STDIN payload — NOT the script text.
    const payload = JSON.parse(rr.calls[0].stdinJson);
    expect(payload).toEqual({
      expectedChallenge: CHALLENGE,
      credentialId: 'cred-1',
      authenticatorData: 'YXV0aA',
      clientDataJSON: 'Y2RhdGE',
      signature: 'c2ln',
      repoRoot: '/repo',
    });
    expect(rr.calls[0].script).not.toContain('cred-1'); // secret never in the script/argv
  });

  it('parses the LAST stdout line as the verdict (tolerates leading noise)', () => {
    const rr = recordingRunner({ exitCode: 0, stdout: 'warn: something\n{"ok":true,"reason":"ok"}\n', stderr: '' });
    const verify = makePtyAssertionVerifier({ repoRoot: '/repo', runPy: rr.runner });
    expect(verify({ expectedChallenge: CHALLENGE, assertion: ASSERTION })).toEqual({ ok: true, reason: 'ok' });
  });
});

describe('makePtyAssertionVerifier — fail-closed', () => {
  it('a non-zero exit with a rejection line is a rejection (reason preserved)', () => {
    const rr = recordingRunner({
      exitCode: 1,
      stdout: '{"ok":false,"reason":"signed challenge does not match the host-issued nonce (replay?)"}',
      stderr: '',
    });
    const verify = makePtyAssertionVerifier({ repoRoot: '/repo', runPy: rr.runner });
    const out = verify({ expectedChallenge: CHALLENGE, assertion: ASSERTION });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/host-issued nonce/);
  });

  it('unparseable stdout (garbage) fails closed', () => {
    const rr = recordingRunner({ exitCode: 0, stdout: 'not json at all', stderr: 'boom' });
    const verify = makePtyAssertionVerifier({ repoRoot: '/repo', runPy: rr.runner });
    const out = verify({ expectedChallenge: CHALLENGE, assertion: ASSERTION });
    expect(out.ok).toBe(false);
  });

  it('a spawn error (empty stdout, non-zero exit) fails closed', () => {
    const rr = recordingRunner({ exitCode: 127, stdout: '', stderr: 'py: not found' });
    const verify = makePtyAssertionVerifier({ repoRoot: '/repo', runPy: rr.runner });
    const out = verify({ expectedChallenge: CHALLENGE, assertion: ASSERTION });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not found|no parseable output/);
  });

  it('a forged ok:true that did NOT exit 0 is NOT trusted (fail closed)', () => {
    const rr = recordingRunner({ exitCode: 1, stdout: '{"ok":true,"reason":"ok"}', stderr: '' });
    const verify = makePtyAssertionVerifier({ repoRoot: '/repo', runPy: rr.runner });
    expect(verify({ expectedChallenge: CHALLENGE, assertion: ASSERTION }).ok).toBe(false);
  });
});

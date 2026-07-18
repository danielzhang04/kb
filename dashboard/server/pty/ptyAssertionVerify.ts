/**
 * D3.1 MED mitigation — M6: the kb-fleet host's Factor C verifier invocation. Shells the NEW Python
 * host-side verifier (`scripts/pty_host_assertion_verify.py`) as a subprocess, mirroring the established
 * `driveVerify` PyRunner pattern (`dashboard/server/approvals/inbox.ts`) — the SAME pinned `py -3`
 * interpreter the fleet already uses for `scripts/preamble.py` and the D2.3 card verifier.
 *
 * TWO deliberate hardening choices over `driveVerify`:
 *   1. The assertion travels via STDIN JSON, NEVER argv — so it never lands in the process table and
 *      dodges arg-length/escaping. The `-c` script itself is a fixed, non-interpolated constant.
 *   2. Fail-closed on EVERYTHING: a non-zero exit whose stdout is unparseable, an empty/absent stdout
 *      (spawn error), or a `{ok:true}` claim that did not exit 0 are all treated as a REJECTION.
 *
 * The Python side reuses the frozen `webauthn_verify` primitives by import (one audited crypto + one
 * credential-store anchor). The subprocess runner is injectable so the whole invocation — including every
 * fail-closed branch — is tested hermetically without a real `py` binary.
 */
import { execFileSync } from 'node:child_process';
import type { PtyAssertion } from './ptyProtocol.ts';
import type { PtyAssertionVerifier } from './hostPipeServer.ts';

/** Raw result of one `py -3 -c <script>` run (stdin-fed). */
export interface PtyVerifyRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `py -3 -c <script>` under `repoRoot`, feeding `stdinJson` on STDIN. Injected for hermetic tests. */
export type PtyVerifyRunner = (repoRoot: string, script: string, stdinJson: string) => PtyVerifyRunResult;

/**
 * The fixed `-c` payload: put `scripts/` on `sys.path` and delegate to the verifier module's stdin
 * `_main` (which reads one JSON assertion payload from STDIN and prints one `{"ok","reason"}` line).
 * Contains NO interpolated input — the only variable data, the assertion, arrives entirely via STDIN.
 */
export const PTY_VERIFY_SCRIPT = `
import sys
sys.path.insert(0, "scripts")
import pty_host_assertion_verify as m
raise SystemExit(m._main())
`.trim();

/** Default runner: shells `py -3 -c <script>` with the assertion payload on STDIN. */
export const defaultPtyVerifyRunner: PtyVerifyRunner = (repoRoot, script, stdinJson) => {
  try {
    const stdout = execFileSync('py', ['-3', '-c', script], {
      cwd: repoRoot,
      input: stdinJson,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    };
  }
};

export interface PtyAssertionVerifierDeps {
  repoRoot: string;
  runPy?: PtyVerifyRunner;
}

/**
 * Build the host-side Factor C verifier the pipe server injects. Returns a SYNC `PtyAssertionVerifier`
 * (the subprocess is sync, like `driveVerify`) that fails closed on any non-zero exit / unparseable
 * output / spawn error. The assertion is passed to the subprocess via STDIN JSON only.
 */
export function makePtyAssertionVerifier(deps: PtyAssertionVerifierDeps): PtyAssertionVerifier {
  const runPy = deps.runPy ?? defaultPtyVerifyRunner;
  return ({ expectedChallenge, assertion }): { ok: boolean; reason: string } => {
    const payload = JSON.stringify({
      expectedChallenge,
      credentialId: assertion.credentialId,
      authenticatorData: assertion.authenticatorData,
      clientDataJSON: assertion.clientDataJSON,
      signature: assertion.signature,
      repoRoot: deps.repoRoot,
    } satisfies StdinPayload);

    const res = runPy(deps.repoRoot, PTY_VERIFY_SCRIPT, payload);
    const line = res.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
    let parsed: { ok?: unknown; reason?: unknown };
    try {
      parsed = JSON.parse(line) as { ok?: unknown; reason?: unknown };
    } catch {
      return { ok: false, reason: res.stderr.trim() || 'pty verifier produced no parseable output (fail closed)' };
    }
    // Fail closed: an ok:true that did not exit 0 is not trusted.
    const ok = parsed.ok === true && res.exitCode === 0;
    return { ok, reason: typeof parsed.reason === 'string' ? parsed.reason : 'pty verifier gave no reason' };
  };
}

/** The exact stdin payload shape the Python `_main` consumes (documented for parity). */
interface StdinPayload {
  expectedChallenge: string;
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  repoRoot: string;
}

/** Re-export for the pipe server so callers pass a concrete assertion without importing the protocol type. */
export type { PtyAssertion };

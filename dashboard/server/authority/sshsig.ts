/**
 * SSHSIG verification for the human-approval channel — the ONLY module here that spawns a process.
 * See docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §4.2.
 *
 * Same discipline as scripts/promote_vm_outbox.py#require_instruction_approval (:480): the message
 * goes in on stdin, the signature is handed over as a file because `ssh-keygen -Y verify` has no
 * stdin mode for it, and a verification counts as good ONLY on exit 0 AND empty stderr AND an
 * ANCHORED stdout token. `ssh-keygen` prints "Good ... signature" on stdout and diagnostics on
 * stderr, so any stderr output at all means something happened that we did not model — refuse.
 *
 * No shell. Absolute binary path with a PATH fallback for non-Linux dev hosts. Minimal env, so
 * nothing is read from a user ssh config. Bounded time and output.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SSH_KEYGEN = process.platform === 'linux' ? '/usr/bin/ssh-keygen' : 'ssh-keygen';
const TIMEOUT_MS = 5_000;
const MAX_BUFFER = 64 * 1024;

export interface SshsigVerifyInput {
  payload: Buffer;
  /** The armored `-----BEGIN SSH SIGNATURE-----` block, verbatim. */
  signature: string;
  allowedSigners: string;
  principal: string;
  namespace: string;
}

export interface SshsigVerifier {
  verify(input: SshsigVerifyInput): Promise<boolean>;
}

function goodToken(namespace: string, principal: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^Good "${escape(namespace)}" signature for ${escape(principal)}\\b`);
}

export const defaultSshsigVerifier: SshsigVerifier = {
  async verify(input) {
    let dir = '';
    try {
      dir = mkdtempSync(join(tmpdir(), 'kb-approval-'));
      const sigPath = join(dir, 'approval.sig');
      writeFileSync(sigPath, input.signature, { encoding: 'utf8', mode: 0o600 });
      const args = ['-Y', 'verify', '-f', input.allowedSigners, '-I', input.principal,
        '-n', input.namespace, '-s', sigPath];
      const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
        const child = execFile(SSH_KEYGEN, args, {
          timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        }, (error, out, err) => done({
          code: error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0,
          stdout: String(out), stderr: String(err),
        }));
        child.stdin?.end(input.payload);
      });
      if (code !== 0) return false;
      if (stderr.trim() !== '') return false;
      return goodToken(input.namespace, input.principal).test(stdout.trim());
    } catch {
      return false;                                    // spawn failure, missing binary, write failure
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
  },
};

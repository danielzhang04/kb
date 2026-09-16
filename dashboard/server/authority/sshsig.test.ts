import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultSshsigVerifier } from './sshsig.ts';

let dir = '';
let allowed = '';
let sshKeygenAvailable = true;
const MESSAGE = Buffer.from('{"schema":"kb.human-approval/v1"}', 'utf8');

function sign(namespace: string, keyName = 'good'): string {
  const file = join(dir, `${namespace}-${keyName}.msg`);
  writeFileSync(file, MESSAGE);
  execFileSync('ssh-keygen', ['-Y', 'sign', '-f', join(dir, keyName), '-n', namespace, file]);
  return readFileSync(`${file}.sig`, 'utf8');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kb-sshsig-'));
  try {
    for (const name of ['good', 'other']) {
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', name, '-f', join(dir, name)]);
    }
    allowed = join(dir, 'allowed_signers');
    writeFileSync(allowed, `kb-ops-approver ${readFileSync(join(dir, 'good.pub'), 'utf8').trim()}\n`);
  } catch {
    // ssh-keygen is absent from this host's PATH — skip the suite loudly rather than weakening it.
    sshKeygenAvailable = false;
  }
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const base = () => ({ payload: MESSAGE, allowedSigners: allowed, principal: 'kb-ops-approver', namespace: 'kb-human-approval' });

describe('sshsig verifier', () => {
  it('accepts a signature from the allowed signer under the right namespace', async () => {
    if (!sshKeygenAvailable) { console.warn('ssh-keygen not found on PATH; skipping sshsig verifier tests'); return; }
    expect(await defaultSshsigVerifier.verify({ ...base(), signature: sign('kb-human-approval') })).toBe(true);
  });
  it('rejects a key that is not an allowed signer', async () => {
    if (!sshKeygenAvailable) return;
    expect(await defaultSshsigVerifier.verify({ ...base(), signature: sign('kb-human-approval', 'other') })).toBe(false);
  });
  it('rejects the outbox instruction namespace', async () => {
    if (!sshKeygenAvailable) return;
    expect(await defaultSshsigVerifier.verify({ ...base(), signature: sign('kb-ops-instructions') })).toBe(false);
  });
  it('rejects a wrong principal', async () => {
    if (!sshKeygenAvailable) return;
    expect(await defaultSshsigVerifier.verify({ ...base(), principal: 'someone-else', signature: sign('kb-human-approval') })).toBe(false);
  });
  it('rejects a tampered payload', async () => {
    if (!sshKeygenAvailable) return;
    const signature = sign('kb-human-approval');
    expect(await defaultSshsigVerifier.verify({ ...base(), payload: Buffer.from('{}'), signature })).toBe(false);
  });
  it('rejects garbage in the signature slot', async () => {
    if (!sshKeygenAvailable) return;
    expect(await defaultSshsigVerifier.verify({ ...base(), signature: 'not a signature' })).toBe(false);
  });
  it('rejects an unreadable allowed-signers path', async () => {
    if (!sshKeygenAvailable) return;
    expect(await defaultSshsigVerifier.verify({ ...base(), allowedSigners: join(dir, 'missing'), signature: sign('kb-human-approval') })).toBe(false);
  });
});

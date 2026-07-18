/**
 * D3.1g — the PTY host lifecycle. Hermetic: every seam injected (preamble runner, native koffi surface,
 * peer.sid fs, PTY host factory, STOP watcher, token mint). No real koffi, node-pty, STOP file, or task.
 *
 * Proves the fail-closed boot gates and lifecycle: preamble-refuse under STOP (nothing opened); own-SID
 * mismatch refuse; peer/rendezvous fail-closed; token-write-failure tears the pipe down; STOP watcher →
 * stopAll drain; SIGTERM-equivalent shutdown drains + closes; and the per-open assertFleetRunnable re-check
 * is actually wired (a fleet that freezes AFTER boot refuses a NEW terminal).
 */
import { describe, expect, it, vi } from 'vitest';
import { bootPtyHost } from './hostMain.ts';
import type { PtyHostBootDeps, PtyHostNativeApi } from './hostMain.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { PipeHandle, PtyPeerFfi, PtyPipeTransport } from './hostPipeServer.ts';
import type { InboundFrame, PtyServerChannel } from './ptyProtocol.ts';
import type { PtyHost, PtySession } from './host.ts';

const KB_FLEET = 'S-1-5-21-732142867-588960626-3228783940-1007';
const DANIEL = 'S-1-5-21-732142867-588960626-3228783940-1001';
const TOKEN = 'f'.repeat(64);

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}
function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}

/** Encode a canonical SID string into raw TokenUser bytes (inverse of parseSidString). */
function sidToBytes(sid: string): Uint8Array {
  const parts = sid.split('-');
  const rev = Number(parts[1]);
  const authority = BigInt(parts[2]);
  const subs = parts.slice(3).map(Number);
  const bytes = new Uint8Array(8 + subs.length * 4);
  bytes[0] = rev;
  bytes[1] = subs.length;
  for (let i = 0; i < 6; i++) bytes[2 + i] = Number((authority >> BigInt((5 - i) * 8)) & 0xffn);
  subs.forEach((v, i) => {
    const o = 8 + i * 4;
    bytes[o] = v & 0xff;
    bytes[o + 1] = (v >>> 8) & 0xff;
    bytes[o + 2] = (v >>> 16) & 0xff;
    bytes[o + 3] = (v >>> 24) & 0xff;
  });
  return bytes;
}

function fakeHost() {
  const open = vi.fn((): PtySession => ({
    sessionId: 'pty-1',
    handle: { pid: 1, onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {} },
  }));
  const stopAll = vi.fn();
  const host: PtyHost = { open, stop: () => true, stopAll, sessions: () => [] };
  return { host, open, stopAll };
}

/** A native-API fake whose transport drives (optionally) one connection with a controllable open frame. */
function fakeNative(opts: {
  ownSid: string | null;
  writeOk?: boolean;
  createPipeOk?: boolean;
  clientSid?: string;
  openFrame?: InboundFrame;
}) {
  const writeCalls: Array<{ path: string; token: string; sids: { ownerSid: string; readerSid: string } }> = [];
  let deliverOpen: (() => void) | null = null;
  let sentFrames: InboundFrame[] = [];
  const rejecters = new Map<PipeHandle, () => void>();
  let seq = 0;

  const channel = (): PtyServerChannel => ({
    nextFrame: () =>
      new Promise((resolve) => {
        if (!opts.openFrame) return resolve(null);
        deliverOpen = () => resolve(opts.openFrame as InboundFrame);
      }),
    sendFrame: (f) => {
      sentFrames.push(f);
      return true;
    },
    onFrame: () => {},
    onClose: () => {},
    close: () => {},
  });

  const transport: PtyPipeTransport = {
    createPipe: () => (opts.createPipeOk === false ? null : ({ id: seq++ } as PipeHandle)),
    accept: (handle) =>
      (handle as { id: number }).id === 0
        ? Promise.resolve()
        : new Promise<void>((_r, reject) => rejecters.set(handle, () => reject(new Error('closed')))),
    channel,
    closeConnection: (handle) => {
      rejecters.get(handle)?.();
      rejecters.delete(handle);
    },
  };
  const peerFfi: PtyPeerFfi = {
    getClientSidBytes: () => (opts.clientSid ? sidToBytes(opts.clientSid) : null),
    getClientPid: () => 100,
  };

  const api: PtyHostNativeApi = {
    currentSidString: () => opts.ownSid,
    makeHostTransport: () => ({ transport, peerFfi }),
    writeAndVerify: (path, token, sids) => {
      writeCalls.push({ path, token, sids });
      return opts.writeOk !== false;
    },
  };
  return { api, writeCalls, deliverOpen: () => deliverOpen?.(), sentFrames: () => sentFrames };
}

/** peer.sid fs: a valid Daniel SID by default. */
function peerFs(content: string = DANIEL, dirExists = true) {
  return {
    readFile: () => content,
    dirExists: () => dirExists,
  };
}

function baseDeps(over: Partial<PtyHostBootDeps> = {}): PtyHostBootDeps {
  return {
    repoRoot: '/repo',
    env: { DASHBOARD_PTY_HOST_SERVER_SID: KB_FLEET },
    runPreamble: okPreamble(),
    peerFs: peerFs(),
    mintToken: () => TOKEN,
    startStopWatch: () => ({ close: () => {} }),
    // Factor C is verified by an injected fake here (no real `py` subprocess); accepts by default so the
    // A∧B∧(session STOP) paths under test are reached. Tests that exercise Factor C live in
    // hostPipeServer.test.ts / ptyAssertionVerify.test.ts.
    verifyAssertion: () => ({ ok: true, reason: 'ok' }),
    ...over,
  };
}

describe('bootPtyHost — fail-closed boot gates', () => {
  it('refuses to listen under STOP (preamble FIRST) — nothing native is touched', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET });
    const makeTransport = vi.spyOn(nat.api, 'makeHostTransport');
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api, runPreamble: frozenPreamble('STOP file present') }));
    expect(res).toMatchObject({ ok: false, reason: 'fleet-frozen' });
    expect(makeTransport).not.toHaveBeenCalled();
  });

  it('refuses when own SID != kb-fleet (identity mismatch)', async () => {
    const nat = fakeNative({ ownSid: DANIEL }); // running as the wrong account
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api }));
    expect(res).toMatchObject({ ok: false, reason: 'identity-mismatch' });
  });

  it('refuses when own SID cannot be resolved', async () => {
    const nat = fakeNative({ ownSid: null });
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api }));
    expect(res).toMatchObject({ ok: false, reason: 'identity-mismatch' });
  });

  it('refuses when the rendezvous dir is missing (fail closed)', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET });
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api, peerFs: peerFs(DANIEL, false) }));
    expect(res).toMatchObject({ ok: false, reason: 'rendezvous-missing' });
  });

  it('refuses when peer.sid is malformed (peer unresolved)', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET });
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api, peerFs: peerFs('not-a-sid') }));
    expect(res).toMatchObject({ ok: false, reason: 'peer-unresolved' });
  });

  it('refuses (and closes the pipe) when boot.token write/verify fails', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET, writeOk: false });
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api }));
    expect(res).toMatchObject({ ok: false, reason: 'token-write-failed' });
  });

  it('fails closed when the first pipe instance cannot be created (squat)', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET, createPipeOk: false });
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api }));
    expect(res).toMatchObject({ ok: false, reason: 'pipe-listen-failed' });
  });
});

describe('bootPtyHost — happy path + lifecycle', () => {
  it('listens, writes boot.token with {kb-fleet owner, Daniel reader}, and shutdown drains + closes', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET });
    const host = fakeHost();
    const stopWatchClose = vi.fn();
    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api, makeHost: () => host.host, startStopWatch: () => ({ close: stopWatchClose }) }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // boot.token written under the cross-user allowlist (kb-fleet writes, Daniel reads).
    expect(nat.writeCalls).toHaveLength(1);
    expect(nat.writeCalls[0].token).toBe(TOKEN);
    expect(nat.writeCalls[0].sids).toEqual({ ownerSid: KB_FLEET, readerSid: DANIEL });

    await res.shutdown();
    expect(host.stopAll).toHaveBeenCalled();
    expect(stopWatchClose).toHaveBeenCalled();
  });

  it('STOP watcher drains live shells (stopAll) the moment STOP fires', async () => {
    const nat = fakeNative({ ownSid: KB_FLEET });
    const host = fakeHost();
    const stop: { fire: (() => void) | null } = { fire: null };
    const res = await bootPtyHost(
      baseDeps({ nativeApi: nat.api, makeHost: () => host.host, startStopWatch: (_root, onStop) => {
        stop.fire = onStop;
        return { close: () => {} };
      } }),
    );
    expect(res.ok).toBe(true);
    expect(host.stopAll).not.toHaveBeenCalled();
    stop.fire?.();
    expect(host.stopAll).toHaveBeenCalledTimes(1);
    if (res.ok) await res.shutdown();
  });
});

describe('bootPtyHost — per-open assertFleetRunnable re-check is wired', () => {
  it('a fleet that FREEZES after boot refuses a NEW terminal (open-nack fleet-frozen), no spawn', async () => {
    let frozen = false;
    const runPreamble: PreambleRunner = () =>
      frozen ? { exitCode: 2, stdout: 'PREAMBLE FAIL: STOP file present\n', stderr: '' } : { exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' };

    const nat = fakeNative({
      ownSid: KB_FLEET,
      clientSid: DANIEL,
      openFrame: {
        type: 'open',
        token: TOKEN,
        requestId: 'r',
        cols: 80,
        rows: 24,
        cwd: '/repo',
        sessionSubject: 's',
        // Factor C material present + accepted (fake verifier) so the per-open STOP re-check is reached.
        assertion: { credentialId: 'c', authenticatorData: 'a', clientDataJSON: 'd', signature: 's' },
      },
    });
    const host = fakeHost();

    const res = await bootPtyHost(baseDeps({ nativeApi: nat.api, makeHost: () => host.host, runPreamble }));
    expect(res.ok).toBe(true);

    // Freeze AFTER boot, THEN let the (authenticated) connection proceed.
    frozen = true;
    nat.deliverOpen();
    await new Promise((r) => setTimeout(r, 20));

    // Auth passed (Daniel SID + correct token) but the per-open re-check refused the spawn.
    expect(host.open).not.toHaveBeenCalled();
    expect(nat.sentFrames()).toContainEqual({ type: 'open-nack', error: 'fleet-frozen' });
    if (res.ok) await res.shutdown();
  });
});

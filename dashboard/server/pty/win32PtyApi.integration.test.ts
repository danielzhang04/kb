/**
 * D3.1e/f — REAL Windows integration for the native cross-user PTY surface (koffi). Same box / same user,
 * so the cross-user checks are exercised with `ownerSid == peerSid == expectedServerSid == this test user's
 * SID` — the genuine kb-fleet↔Daniel split is only reachable at the human gate. Skipped off win32.
 *
 * NOTE ON THE CLIENT OPEN HANDSHAKE: `PtyClientChannel.requestSync` blocks the event loop (bounded) while
 * it waits for the ack. In PRODUCTION the host is a SEPARATE process, so that is fine; but SAME-PROCESS it
 * would deadlock (the server's async loop cannot run while the client blocks). So here we exercise the
 * duplex via the ASYNC `sendFrame`/`onFrame` path (both directions, no blocking) — which is exactly what
 * the persistent stream uses after the open. The blocking `requestSync` round-trip is proven end-to-end at
 * the human gate; its pure logic is covered hermetically in `hostClient.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { loadWin32PtyApi } from './win32PtyApi.ts';
import { parseSidString } from '../../../broker/win32Sid.ts';
import type { PtyServerChannel, InboundFrame } from './ptyProtocol.ts';

const onWin32 = process.platform === 'win32';
let seq = 0;
const uniquePipe = (): string => `\\\\.\\pipe\\kb-pty-it-${process.pid}-${Date.now()}-${seq++}`;

describe.skipIf(!onWin32)('win32PtyApi REAL integration (koffi)', () => {
  it('resolves this process own SID', () => {
    const sid = loadWin32PtyApi().currentSidString();
    expect(sid).toMatch(/^S-1-\d/);
  });

  it('writeAndVerify writes the token under the cross-user SD, read-back-verifies, and the token is readable', () => {
    const api = loadWin32PtyApi();
    const own = api.currentSidString();
    expect(own).toBeTruthy();
    const path = join(tmpdir(), `kb-pty-boot-${process.pid}-${Date.now()}.token`);
    const token = 'a'.repeat(64);
    try {
      const ok = api.writeAndVerify(path, token, { ownerSid: own as string, readerSid: own as string });
      expect(ok).toBe(true);
      expect(readFileSync(path, 'utf-8')).toBe(token);
    } finally {
      try {
        rmSync(path, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('createPipe builds the cross-user pipe (Medium-label read-back passes)', () => {
    const api = loadWin32PtyApi();
    const own = api.currentSidString() as string;
    const { transport } = api.makeHostTransport({ ownerSid: own, peerSid: own });
    const name = uniquePipe();
    const handle = transport.createPipe(name, true);
    expect(handle).not.toBeNull();
    transport.closeConnection(handle);
  });

  it('a SECOND first-instance create on the same name fails closed (FIRST_PIPE_INSTANCE squat defense)', () => {
    const api = loadWin32PtyApi();
    const own = api.currentSidString() as string;
    const { transport } = api.makeHostTransport({ ownerSid: own, peerSid: own });
    const name = uniquePipe();
    const first = transport.createPipe(name, true);
    expect(first).not.toBeNull();
    try {
      const second = transport.createPipe(name, true);
      expect(second).toBeNull();
    } finally {
      transport.closeConnection(first);
    }
  });

  it('connectAndVerifyServer ACCEPTS when the server SID == expected (our own)', async () => {
    const api = loadWin32PtyApi();
    const own = api.currentSidString() as string;
    const { transport } = api.makeHostTransport({ ownerSid: own, peerSid: own });
    const name = uniquePipe();
    const server = transport.createPipe(name, true);
    const acceptP = transport.accept(server);
    const client = api.connectAndVerifyServer(name, own);
    expect(client).not.toBeNull();
    await acceptP;
    client?.close();
    transport.closeConnection(server);
  });

  it('connectAndVerifyServer ABORTS when the server SID != expected (anti-squat), returns null', async () => {
    const api = loadWin32PtyApi();
    const own = api.currentSidString() as string;
    const { transport } = api.makeHostTransport({ ownerSid: own, peerSid: own });
    const name = uniquePipe();
    const server = transport.createPipe(name, true);
    const acceptP = transport.accept(server);
    // A SID that is definitely not this process → mismatch → null (token would never be sent).
    const client = api.connectAndVerifyServer(name, 'S-1-5-21-111111111-222222222-333333333-4444');
    expect(client).toBeNull();
    // The server accept may still be pending (client aborted after connect); tear it down.
    transport.closeConnection(server);
    await acceptP.catch(() => {});
  });

  it('impersonation yields the CALLER SID, and the async duplex streams both directions', async () => {
    const api = loadWin32PtyApi();
    const own = api.currentSidString() as string;
    const { transport, peerFfi } = api.makeHostTransport({ ownerSid: own, peerSid: own });
    const name = uniquePipe();
    const server = transport.createPipe(name, true);
    const acceptP = transport.accept(server);
    const client = api.connectAndVerifyServer(name, own);
    expect(client).not.toBeNull();
    await acceptP;

    const serverCh: PtyServerChannel = transport.channel(server);

    // client → server: send an open frame (async write); server reads it via nextFrame.
    client!.sendFrame({ type: 'open', token: 't', requestId: 'r', cols: 80, rows: 24, cwd: '/', sessionSubject: 's' });
    const first = await serverCh.nextFrame(3000);
    expect(first?.type).toBe('open');

    // Impersonation reads the client token bound to THIS connection → the caller (our own) SID.
    const bytes = peerFfi.getClientSidBytes(server);
    expect(bytes).not.toBeNull();
    expect(parseSidString(bytes as Uint8Array)).toBe(own);

    // server → client: stream a data frame; the client receives it via onFrame.
    const got: InboundFrame[] = [];
    const received = new Promise<void>((resolve) => {
      client!.onFrame((f) => {
        got.push(f);
        if (f.type === 'data') resolve();
      });
    });
    serverCh.sendFrame({ type: 'data', data: 'hello-from-host' });
    await received;
    expect(got.find((f) => f.type === 'data')).toEqual({ type: 'data', data: 'hello-from-host' });

    client!.close();
    serverCh.close();
    transport.closeConnection(server);
  });
});

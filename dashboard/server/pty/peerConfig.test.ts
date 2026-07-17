/**
 * D3.1b — peerConfig.ts peer-SID resolver (pure, fs-injected). RED-first.
 *
 * The host learns WHO its authorized peer is by reading a Daniel-write-only `peer.sid` in the rendezvous
 * directory (design Point 1). The file's DACL makes its provenance OS-guaranteed; this module only
 * parses/validates the content. It MUST fail closed on anything it cannot positively confirm to be a
 * single well-formed `S-1-5-…` SID — never a permissive default, never "authorize own SID", never
 * "authorize any user". The fs reader is injected so these tests touch no real filesystem.
 */
import { describe, expect, it } from 'vitest';
import { resolvePeerSid, resolveRendezvousDir, peerSidPath } from './peerConfig.ts';
import type { PeerConfigFs } from './peerConfig.ts';

const KB_FLEET_SID = 'S-1-5-21-732142867-588960626-3228783940-1007';
const DANIEL_SID = 'S-1-5-21-732142867-588960626-3228783940-1001';
const DIR = 'C:\\ProgramData\\kb\\pty-host';

/** A fake fs whose `readFile` returns a canned value or throws (absent), and whose dir always exists
 *  unless overridden. */
function fakeFs(content: string | Error, dirExists = true): PeerConfigFs {
  return {
    readFile(_path: string): string {
      if (content instanceof Error) throw content;
      return content;
    },
    dirExists(_path: string): boolean {
      return dirExists;
    },
  };
}

describe('resolvePeerSid', () => {
  it('reads a valid S-1-5-… SID', () => {
    const r = resolvePeerSid({ fs: fakeFs(DANIEL_SID), dir: DIR, ownSid: KB_FLEET_SID });
    expect(r).toEqual({ ok: true, peerSid: DANIEL_SID });
  });

  it('tolerates a trailing newline / surrounding whitespace (single logical line)', () => {
    const r = resolvePeerSid({ fs: fakeFs(`  ${DANIEL_SID}\r\n`), dir: DIR, ownSid: KB_FLEET_SID });
    expect(r).toEqual({ ok: true, peerSid: DANIEL_SID });
  });

  it('FAILS CLOSED when the file is absent (read throws)', () => {
    const r = resolvePeerSid({ fs: fakeFs(new Error('ENOENT')), dir: DIR, ownSid: KB_FLEET_SID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unreadable|absent/i);
  });

  it('FAILS CLOSED on empty / whitespace-only content', () => {
    expect(resolvePeerSid({ fs: fakeFs(''), dir: DIR, ownSid: KB_FLEET_SID }).ok).toBe(false);
    expect(resolvePeerSid({ fs: fakeFs('   \r\n'), dir: DIR, ownSid: KB_FLEET_SID }).ok).toBe(false);
  });

  it('FAILS CLOSED on a malformed (non-SID) string', () => {
    expect(resolvePeerSid({ fs: fakeFs('not-a-sid'), dir: DIR, ownSid: KB_FLEET_SID }).ok).toBe(false);
    expect(resolvePeerSid({ fs: fakeFs('S-1'), dir: DIR, ownSid: KB_FLEET_SID }).ok).toBe(false);
    expect(resolvePeerSid({ fs: fakeFs('S-1-5-21-abc-1001'), dir: DIR, ownSid: KB_FLEET_SID }).ok).toBe(false);
  });

  it('FAILS CLOSED on multi-line content (more than one non-empty line)', () => {
    const r = resolvePeerSid({ fs: fakeFs(`${DANIEL_SID}\n${KB_FLEET_SID}`), dir: DIR, ownSid: KB_FLEET_SID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/multi|line/i);
  });

  it("NEVER returns the host's OWN SID (a peer.sid equal to own SID is rejected, not authorized)", () => {
    const r = resolvePeerSid({ fs: fakeFs(KB_FLEET_SID), dir: DIR, ownSid: KB_FLEET_SID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/own/i);
  });

  it('never returns a permissive default on any failure (result is always the error sentinel)', () => {
    for (const bad of ['', 'garbage', KB_FLEET_SID, `${DANIEL_SID}\n${DANIEL_SID}`]) {
      const r = resolvePeerSid({ fs: fakeFs(bad), dir: DIR, ownSid: KB_FLEET_SID });
      expect(r.ok).toBe(false);
      // A failed resolve must not leak ANY peerSid field.
      expect(r).not.toHaveProperty('peerSid');
    }
  });
});

describe('resolveRendezvousDir', () => {
  it('returns the default dir when it exists', () => {
    const r = resolveRendezvousDir({ fs: fakeFs('', true) });
    expect(r).toEqual({ ok: true, dir: DIR });
  });

  it('honors an override dir', () => {
    const r = resolveRendezvousDir({ fs: fakeFs('', true), dir: 'D:\\alt\\pty-host' });
    expect(r).toEqual({ ok: true, dir: 'D:\\alt\\pty-host' });
  });

  it('FAILS CLOSED when the directory does not exist', () => {
    const r = resolveRendezvousDir({ fs: fakeFs('', false) });
    expect(r.ok).toBe(false);
  });
});

describe('peerSidPath', () => {
  it('joins the dir with peer.sid using a backslash', () => {
    expect(peerSidPath(DIR)).toBe(`${DIR}\\peer.sid`);
  });
});

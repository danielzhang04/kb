/**
 * D3.1d — rendezvous token-exchange logic (fs-injected). RED-first.
 *
 * The HOST mints the per-boot token (reusing the Broker's `mintBootToken`) and writes it to
 * `boot.token`; the DAEMON reads it FRESH on every open (never caches) and presents it. This tests the
 * two pure pieces: the mint, and the daemon-side fresh-read resolver. The load-bearing D-2 fix is that a
 * missing/short token file FAILS CLOSED — there is NO `randomUUID()` fallback that would fabricate a
 * token which can only ever mismatch silently. The native ACL'd write + Medium-label read-back verify is
 * a Phase 2 seam; here everything is fs-injected and hermetic.
 */
import { describe, expect, it } from 'vitest';
import { mintHostBootToken, readBootTokenFresh, MIN_BOOT_TOKEN_LEN } from './rendezvousToken.ts';
import type { TokenFileReader } from './rendezvousToken.ts';

/** A fake reader returning canned content or throwing (absent file). Records each call so we can prove
 *  the daemon reads FRESH (once per resolve) rather than caching. */
function fakeReader(content: string | Error): { reader: TokenFileReader; calls: number } {
  const state = { calls: 0 };
  const reader: TokenFileReader = (_path: string) => {
    state.calls += 1;
    if (content instanceof Error) throw content;
    return content;
  };
  return {
    reader,
    get calls() {
      return state.calls;
    },
  };
}

const VALID = 'f'.repeat(MIN_BOOT_TOKEN_LEN);

describe('mintHostBootToken', () => {
  it('mints a 256-bit (64 hex char) token, matching the reused broker mintBootToken shape', () => {
    const t = mintHostBootToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t.length).toBe(MIN_BOOT_TOKEN_LEN);
  });

  it('mints a fresh, unpredictable token each call', () => {
    expect(mintHostBootToken()).not.toBe(mintHostBootToken());
  });
});

describe('readBootTokenFresh', () => {
  it('returns the CURRENT token from the file (fresh read)', () => {
    const f = fakeReader(VALID);
    const r = readBootTokenFresh({ read: f.reader, path: 'C:\\ProgramData\\kb\\pty-host\\boot.token' });
    expect(r).toEqual({ ok: true, token: VALID });
  });

  it('reads FRESH every call (no caching) — a host restart that re-mints is picked up', () => {
    let current = VALID;
    const reader: TokenFileReader = () => current;
    const path = 'C:\\ProgramData\\kb\\pty-host\\boot.token';
    expect(readBootTokenFresh({ read: reader, path })).toEqual({ ok: true, token: VALID });
    current = 'a'.repeat(MIN_BOOT_TOKEN_LEN);
    expect(readBootTokenFresh({ read: reader, path })).toEqual({ ok: true, token: current });
  });

  it('tolerates a trailing newline the writer may add', () => {
    const r = readBootTokenFresh({ read: () => `${VALID}\r\n`, path: 'p' });
    expect(r).toEqual({ ok: true, token: VALID });
  });

  it('FAILS CLOSED when the file is absent (read throws) — no fabricated fallback', () => {
    const r = readBootTokenFresh({ read: () => { throw new Error('ENOENT'); }, path: 'p' });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('token');
  });

  it('FAILS CLOSED on empty content', () => {
    expect(readBootTokenFresh({ read: () => '', path: 'p' }).ok).toBe(false);
    expect(readBootTokenFresh({ read: () => '   \n', path: 'p' }).ok).toBe(false);
  });

  it('FAILS CLOSED on a too-short token', () => {
    expect(readBootTokenFresh({ read: () => 'abc', path: 'p' }).ok).toBe(false);
    expect(readBootTokenFresh({ read: () => 'f'.repeat(MIN_BOOT_TOKEN_LEN - 1), path: 'p' }).ok).toBe(false);
  });

  it('FAILS CLOSED on a non-hex token (a randomUUID fallback shape is rejected, not accepted)', () => {
    // A UUID is 36 chars with dashes — the exact fabricated fallback the D-2 fix removes. Even if the
    // token file somehow held one, it must be rejected, never accepted as a token.
    const r = readBootTokenFresh({ read: () => '123e4567-e89b-12d3-a456-426614174000', path: 'p' });
    expect(r.ok).toBe(false);
  });

  it('NEVER fabricates a token on any failure (result is always the error sentinel)', () => {
    for (const bad of ['', 'short', 'g'.repeat(MIN_BOOT_TOKEN_LEN)]) {
      const r = readBootTokenFresh({ read: () => bad, path: 'p' });
      expect(r.ok).toBe(false);
      expect(r).not.toHaveProperty('token');
    }
  });
});

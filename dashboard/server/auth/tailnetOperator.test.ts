import { describe, expect, it } from 'vitest';
import { createTailnetOperatorAuth } from './tailnetOperator.ts';
import { OPERATOR_SUBJECT } from './operator.ts';
import type { TailnetConfig } from './mode.ts';

const CONFIG: TailnetConfig = { host: 'kb.command.ts.net', proxyUid: 0, operatorLogin: 'daniel.zhang.t1@gmail.com' };

/** `/proc/net/tcp` as captured on the live VM: the peer of :4317 <- :52994 is root-owned tailscaled. */
const SERVE_TABLE = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:10DD 0100007F:CF32 01 00000000:00000000 00:00000000 00000000   999        0 2746714 1 0 20 4 31 10 -1
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 02:000002FE 00000000     0        0 2747946 2 0 20 4 30 10 -1
`;

/** The same connection shape, but the peer is owned by the dashboard's own unprivileged user — i.e.
 *  a governed worker (or anything else local) talking straight to 127.0.0.1:4317. */
const DIRECT_LOCAL_TABLE = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:10DD 0100007F:CF32 01 00000000:00000000 00:00000000 00000000   999        0 2746714 1 0 20 4 31 10 -1
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 02:000002FE 00000000   999        0 2747946 2 0 20 4 30 10 -1
`;

const SERVE_HEADERS = {
  host: 'kb.command.ts.net',
  'tailscale-user-login': 'daniel.zhang.t1@gmail.com',
  'tailscale-user-name': 'Daniel Zhang',
  'x-forwarded-proto': 'https',
};

function request(overrides: {
  headers?: Record<string, string | string[] | undefined>;
  socket?: Partial<{ remoteAddress: string; remotePort: number; localAddress: string; localPort: number }>;
} = {}) {
  return {
    headers: overrides.headers ?? SERVE_HEADERS,
    socket: {
      remoteAddress: '127.0.0.1', remotePort: 0xcf32, localAddress: '127.0.0.1', localPort: 4317,
      ...overrides.socket,
    },
  };
}

function auth(table: string, config: TailnetConfig = CONFIG) {
  return createTailnetOperatorAuth(config, { readTables: () => [table] });
}

describe('createTailnetOperatorAuth', () => {
  it('authenticates a serve-proxied request as the operator and attributes the tailnet identity', () => {
    expect(auth(SERVE_TABLE).authenticate(request())).toEqual({
      ok: true,
      subject: OPERATOR_SUBJECT,
      attribution: { login: 'daniel.zhang.t1@gmail.com', name: 'Daniel Zhang' },
    });
  });

  it('REJECTS a direct local connection that forges the Tailscale identity headers', () => {
    // The headers are byte-identical to a genuine serve request. Only the peer's OS owner differs.
    expect(auth(DIRECT_LOCAL_TABLE).authenticate(request())).toEqual({ ok: false, reason: 'untrusted-peer' });
  });

  it('REJECTS a serve-proxied request that carries no tailnet identity (the Funnel case)', () => {
    const { 'tailscale-user-login': _omitted, ...headers } = SERVE_HEADERS;
    expect(auth(SERVE_TABLE).authenticate(request({ headers })))
      .toEqual({ ok: false, reason: 'no-tailnet-identity' });
  });

  it('REJECTS an identity outside an explicit operator allowlist', () => {
    const scoped = { ...CONFIG, operatorLogin: 'someone.else@example.com' };
    expect(auth(SERVE_TABLE, scoped).authenticate(request())).toEqual({ ok: false, reason: 'identity-not-allowed' });
  });

  it('accepts the allowlisted identity when the allowlist is set', () => {
    const scoped = { ...CONFIG, operatorLogin: 'daniel.zhang.t1@gmail.com' };
    expect(auth(SERVE_TABLE, scoped).authenticate(request())).toMatchObject({ ok: true });
  });

  it('REJECTS a cross-site browser request — ambient auth needs no cookie to be replayed', () => {
    const headers = { ...SERVE_HEADERS, 'sec-fetch-site': 'cross-site' };
    expect(auth(SERVE_TABLE).authenticate(request({ headers }))).toEqual({ ok: false, reason: 'cross-site' });
  });

  it('allows same-origin and none, and allows the header being absent (WebSocket / curl)', () => {
    for (const site of ['same-origin', 'none']) {
      expect(auth(SERVE_TABLE).authenticate(request({ headers: { ...SERVE_HEADERS, 'sec-fetch-site': site } })))
        .toMatchObject({ ok: true });
    }
    expect(auth(SERVE_TABLE).authenticate(request())).toMatchObject({ ok: true });
  });

  it('REJECTS a non-loopback peer outright', () => {
    expect(auth(SERVE_TABLE).authenticate(request({ socket: { remoteAddress: '100.89.73.118' } })))
      .toEqual({ ok: false, reason: 'untrusted-peer' });
  });

  it('REJECTS a 127/8 peer that is not exactly 127.0.0.1 — no address inside 127/8 is trusted wholesale', () => {
    // The source-address spoof binds 127.0.0.2. Even before the /proc 4-tuple match, the tightened
    // loopback check refuses any 127/8 address other than the exact bind address.
    expect(auth(SERVE_TABLE).authenticate(request({ socket: { remoteAddress: '127.0.0.2' } })))
      .toEqual({ ok: false, reason: 'untrusted-peer' });
  });

  it('SECURITY: rejects the source-address spoof end to end', () => {
    // The attacker's accepted connection has remoteAddress 127.0.0.2; the /proc table carries both its
    // own uid-999 row and tailscaled's genuine uid-0 row on the same port pair. The full-4-tuple match
    // selects only the attacker's own row → untrusted-peer, even with perfect identity headers.
    const spoofTable = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   6: 0100007F:10DD 0200007F:CF32 01 00000000:00000000 00:00000000 00000000   999        0 1 1 0 20 4 31 10 -1
   7: 0200007F:CF32 0100007F:10DD 01 00000000:00000000 00:00000000 00000000   999        0 2 1 0 20 4 30 10 -1
   8: 0100007F:CF32 0100007F:10DD 01 00000000:00000000 02:000002FE 00000000     0        0 3 1 0 20 4 30 10 -1
`;
    expect(auth(spoofTable).authenticate(request({ socket: { remoteAddress: '127.0.0.2' } })))
      .toEqual({ ok: false, reason: 'untrusted-peer' });
  });

  it('REJECTS when the peer socket cannot be located at all', () => {
    expect(auth('').authenticate(request())).toEqual({ ok: false, reason: 'untrusted-peer' });
  });

  it('honours a non-root trusted proxy uid', () => {
    expect(auth(DIRECT_LOCAL_TABLE, { ...CONFIG, proxyUid: 999 }).authenticate(request()))
      .toMatchObject({ ok: true });
  });

  it('omits the display name from attribution when serve does not send one', () => {
    const { 'tailscale-user-name': _omitted, ...headers } = SERVE_HEADERS;
    expect(auth(SERVE_TABLE).authenticate(request({ headers }))).toEqual({
      ok: true, subject: OPERATOR_SUBJECT, attribution: { login: 'daniel.zhang.t1@gmail.com' },
    });
  });

  it('REJECTS a malformed or absurdly long login rather than attributing it', () => {
    for (const login of ['', '   ', 'has space@x.com', `${'a'.repeat(400)}@x.com`]) {
      expect(auth(SERVE_TABLE).authenticate(request({ headers: { ...SERVE_HEADERS, 'tailscale-user-login': login } })))
        .toEqual({ ok: false, reason: 'no-tailnet-identity' });
    }
  });

  it('takes only the first value of a repeated identity header', () => {
    const headers = { ...SERVE_HEADERS, 'tailscale-user-login': ['daniel.zhang.t1@gmail.com', 'attacker@evil'] };
    expect(auth(SERVE_TABLE).authenticate(request({ headers }))).toMatchObject({
      ok: true, attribution: { login: 'daniel.zhang.t1@gmail.com' },
    });
  });
});

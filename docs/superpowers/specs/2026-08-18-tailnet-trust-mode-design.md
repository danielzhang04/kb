# Tailnet-trust always-on mode — design

Status: approved design (Daniel, 2026-08-18), implemented on `claude/tailnet-trust`.
Scope: `dashboard/server` auth + activation seam, `deploy/` env contract.

## 1. Why

The kb dashboard on the Hetzner VM is reachable only at `https://kb.tail82dd4f.ts.net`, published by
`tailscale serve` (tailnet-only, no Funnel) proxying to `http://127.0.0.1:4317`. The tailnet is a
single-human network. On that deployment the WebAuthn sign-in ceremony authenticates the same person the
tailnet already authenticated, and the passkey-gated execution unlock latch means the fleet is disarmed
after every daemon restart until a human opens a browser and taps a key. Both are ceremony, not security.

Tailnet-trust mode removes the ceremony on that deployment ONLY, as an explicit second mode. The Windows
desktop deployment keeps the passkey stack unchanged.

## 2. Modes

`DASHBOARD_AUTH_MODE` selects the mode. It is resolved once, at the composition root.

| | `win32-desktop` (absent / `win32-desktop`) | `tailnet` |
|---|---|---|
| Operator authentication | WebAuthn passkey assertion → short-TTL HMAC session bearer/cookie | the request's transport: it arrived through the trusted `tailscale serve` peer |
| Session ceremony | sign-in required, 5-min TTL, re-assert on expiry | none; a session is minted server-side per request from the proven transport |
| `/api/auth/*` ceremonies | live | still registered, but inert: no `DASHBOARD_RP_ORIGIN` → `503 webauthn-unconfigured`; no credentials → `401` |
| Origin allowlist source | `DASHBOARD_RP_ORIGIN` (+ `DASHBOARD_DEV_ORIGIN`) | `https://<DASHBOARD_TAILNET_HOST>` only (no dev origin — ambient auth) |
| Execution latch at boot | `locked` (unless `DASHBOARD_EXECUTION_ACTIVATED=1` → `env-override`) | `unlocked`, `source: 'tailnet'` |
| Queue bridge | starts only on a `passkey`-sourced unlock | starts at daemon boot |
| Emergency brake | latch lock route, `STOP` file | `STOP` file, `systemctl stop kb-dashboard` — both non-interactive; the lock route still works |
| Platform | any | Linux only — the daemon refuses to start in `tailnet` mode elsewhere |

`win32-desktop` is the default: an absent `DASHBOARD_AUTH_MODE` reproduces today's behavior byte for byte.
Any value other than the two literals is a boot error (fail closed, never a silent fallback).

## 3. Trust boundary

### 3.1 The threat the mode creates

`tailscale serve` terminates TLS and proxies to `127.0.0.1:4317`. That listener is reachable by **every
local process**, including the governed workers the daemon itself spawns. If "arrived on the loopback
listener" were the trust signal, any local process — a compromised worker, a `claude` child, anything
running as `kb-dashboard` — could `curl 127.0.0.1:4317` with a forged `Tailscale-User-Login` header and
hold full operator authority. Header presence alone is worthless; the headers are attacker-writable on a
direct connection.

### 3.2 The mechanism: loopback peer UID

The daemon distinguishes a serve-proxied connection from a direct local connection by resolving the
**owning UID of the peer socket** and requiring it to be the trusted proxy's UID.

`tailscaled` runs as root. The dashboard runs as `kb-dashboard` (uid 999). Measured on the live VM while a
request traversed serve:

```
# /proc/net/tcp
6: 0100007F:10DD 0100007F:CF32 01 ...   uid 999   <- the daemon's accepted socket
8: 0100007F:CF32 0100007F:10DD 01 ...   uid   0   <- tailscaled's client socket
```

For a connection the daemon has accepted, the peer's socket is the row whose *local* endpoint EQUALS the
connection's remote endpoint and whose *remote* endpoint EQUALS the connection's local endpoint — the FULL
4-tuple, addresses included. Its `uid` column is the owning UID. `/proc/net/tcp` and `/proc/net/tcp6` are
world-readable and network-namespace wide, so the unprivileged daemon can perform this lookup with no
capability, no helper, and no IPC.

A forging local process running as `kb-dashboard` (or any non-root user) produces a peer row with its own
UID and is rejected. A root process could pass — but a root process on this host already owns the daemon,
its state root, and its unit file; it is outside the threat model by construction.

**The 4-tuple must be matched in full, not just the port pair** (fixed after adversarial review; the
original code matched ports + "both endpoints are some loopback address"). Exploit: an unprivileged process
binds `127.0.0.2:P` on the SAME source port `P` that `tailscaled` is using for a concurrent genuine
connection, then connects to `127.0.0.1:4317`. Its own client row (`0200007F:P`, uid = attacker) and
tailscaled's genuine client row (`0100007F:P`, uid 0) then BOTH carry the port pair `(P, 4317)`; matching on
ports alone returned tailscaled's uid 0 → full operator bypass. Requiring the peer's local endpoint to
EQUAL the connection's real remote address (`127.0.0.2`) selects only the attacker's own uid-999 row, so
root is denied. `peerUid.ts#ipToProcHex` renders the connection's real addresses into the kernel's
little-endian `/proc` hex (IPv4, IPv6, `::ffff:` mapped) for that exact comparison, and
`tailnetOperator.ts` accepts a peer address only when it is EXACTLY `127.0.0.1`/`::1`/`::ffff:127.0.0.1`
(not any `127.*`).

Rules, all fail-closed:

- The socket's own remote and local addresses must each be exactly loopback (`127.0.0.1`/`::1`/mapped).
- Exactly one `/proc/net/tcp{,6}` row must match the FULL 4-tuple (both addresses and both ports), in state
  `ESTABLISHED` (`01`). Zero rows, multiple rows, an unparsable address/table, or an unreadable `/proc` →
  reject.
- The matched row's UID must equal `DASHBOARD_TAILNET_PROXY_UID` (default `0`).

### 3.3 The second lock: identity headers must be present

Peer-UID alone is **not** sufficient. If Funnel were ever enabled on this node, requests from the public
internet would also arrive through root-owned `tailscaled` — and Tailscale does **not** attach identity
headers to Funnel requests. Peer-UID alone would then authenticate an anonymous internet client as the
operator.

So the mode requires *both*:

1. peer UID == trusted proxy UID, **and**
2. a well-formed `Tailscale-User-Login` header on the request.

Requirement 2 is what makes Funnel traffic (and any other identity-less path through tailscaled)
indistinguishable from a rejection. It is a security control, not decoration.

**`DASHBOARD_TAILNET_OPERATOR` is REQUIRED** (Daniel ruling, 2026-08-18): `Tailscale-User-Login` must
equal exactly the one pinned operator login, and the daemon refuses to boot if it is unset. This is
fail-closed for a reason specific to this VM: a second reviewer confirmed tailnet membership there is
root-equivalent (passwordless sudo), so "any tailnet principal is the operator" would be a standing
privilege grant to every node on the tailnet. There is no "any identity" mode.

### 3.4 The third lock: cross-site request forgery

Tailnet-mode auth is *ambient* — it needs no cookie and no token, so `credentials: 'omit'` does not protect
it. Any page the operator's browser loads could `fetch('https://kb.tail82dd4f.ts.net/api/...')`, and that
request would traverse serve and satisfy 3.2 and 3.3. The origin guard is therefore load-bearing in a way
it was not before, and it stays fully enforced in this mode against `https://<DASHBOARD_TAILNET_HOST>`.

Added in this mode only, as defence in depth: a request whose `Sec-Fetch-Site` header is **present** and is
neither `same-origin` nor `none` is rejected. Absent is allowed — WebSocket handshakes and non-browser
clients (curl from a tailnet device, the operator's phone) do not send it, and those must keep working.

### 3.5 Verified empirically

Probed on the live VM (2026-08-18), read-only, by capturing the loopback hop of a real request through the
production serve listener:

```
Host: kb.tail82dd4f.ts.net
Tailscale-Headers-Info: https://tailscale.com/s/serve-headers
Tailscale-User-Login: daniel.zhang.t1@gmail.com
Tailscale-User-Name: Daniel Zhang
Tailscale-User-Profile-Pic: https://lh3.googleusercontent.com/...
X-Forwarded-For: 100.89.73.118
X-Forwarded-Host: kb.tail82dd4f.ts.net
X-Forwarded-Proto: https
```

`tailscale serve` on this node (tailscaled 1.102.2) **does** inject identity headers. The degraded
"authenticated-as-operator without attribution" design is therefore NOT what ships: attribution is real,
and header presence can be required as a security control per 3.3. Serve config confirmed tailnet-only:
`https://kb.tail82dd4f.ts.net (tailnet only) |-- / proxy http://127.0.0.1:4317`; no Funnel.

`X-Forwarded-*` values are recorded for context only and are never an authentication input.

## 4. The seam

Three changes to core logic, no per-route special cases, no duplicated auth path.

**(a) Auth middleware.** `SessionConfig` gains an optional `operatorAuth` field, and
`http/middleware.ts#resolveSession(req, sessionConfig, presentedToken?)` becomes the single function that
decides either mode:

- `operatorAuth` absent → today's code path exactly (verify the bearer/cookie via `verifySession`).
- present → run the operator authenticator; on success **mint** a real session with `mintSession`.

Because the minted value is a genuine signed session, every downstream consumer works unchanged:
`verifiedSession(req)?.claims.sub`, the `sessionToken` threaded into launches, and the gate modules that
independently re-verify with `verifySession` (`floor`, `vibe`, `launch`, `governedSave`, `workflowRun`,
`cardRouting`, `routingOverride`). No route file is edited.

Two callers reach `resolveSession`:

- `requireSession` — the preHandler all eight governed registration sites already call with
  `ctx.sessionConfig`, so the mode reaches them through the object they already receive.
- `pty/route.ts` — its WebSocket `preValidation`, its WS connection handler, and `requireBearerOwner`.
  These read their credential straight off the request (the bearer rides the WS **subprotocol**, because an
  upgrade has no preHandler stash to inherit), so they must consult the seam directly. Folding them in
  removed three hand-rolled copies of token-then-verify rather than adding any. WebSocket upgrades are
  therefore authenticated identically to HTTP by the same peer proof: `@fastify/websocket` hands the
  handler the real Fastify request, whose `socket` is the live TCP connection the proof reads. Without
  this the Terminal view would have been dead in tailnet mode.

`presentedToken` exists for that subprotocol bearer. It is IGNORED in `tailnet` mode in both directions: a
bogus token still succeeds behind a proven peer, and a plausible one cannot rescue an unproven one.

**(b) Latch initial state.** `createExecutionLatch` boot-arms in `tailnet` mode with `source: 'tailnet'`,
alongside the existing `env-override` boot-arm. The unlock grant it mints authorizes
`buildActivatedExecution`, so `DASHBOARD_EXECUTION_ACTIVATED` stays `0` in the unit.

**(c) Bridge autostart.** `surface.ts`'s `onChange` starts the queue bridge for `source === 'passkey' ||
source === 'tailnet'`. `env-override` still does not start it (headless test behavior preserved).

Supporting: `resolveAllowedOrigins` reads the tailnet host in tailnet mode; `start()` asserts the boot
invariants; the `source` union widens to include `'tailnet'` in `activation.ts`, `control/routes.ts`, and
the client's `controlClient.ts` parser (which would otherwise drop the posture as unrecognized).

**Break-glass recovery (Daniel ruling, 2026-08-18):** `authorizedLegacyRecoveryExecution` and
`authorizedFailedRunReconciliationGrant` — two one-off historical repair paths bound to a 2026-08-01
incident — MOVE to the mode seam via `isOperatorUnlockSource(source)`, accepting `source === 'passkey'`
OR `source === 'tailnet'`. Under tailnet mode they take the same pinned operator identity as every other
governed action, so break-glass stays usable on the VM; they stay passkey-gated in win32 mode. The
headless `env-override` arm is still refused, so recovery is operator-only and no mode switch opens a new
bypass (post-ruling the tailnet operator is a single pinned identity).

## 5. Boot validation (fail closed)

In `tailnet` mode `start()` refuses to listen unless all hold:

- `process.platform === 'linux'` — the peer-UID mechanism is `/proc`-based and has no win32 equivalent.
- the bind host is a loopback literal (`127.0.0.1` / `::1` / `localhost`) — the listener must stay behind
  serve; a `0.0.0.0` bind would expose ambient-auth endpoints to anything that can route to the node.
- `DASHBOARD_TAILNET_HOST` is set and is a bare hostname — it is the origin allowlist, and an empty
  allowlist would 403 everything anyway, but silently.
- `DASHBOARD_TAILNET_OPERATOR` is set and non-blank — the single pinned operator identity (required).
- `DASHBOARD_RP_ORIGIN` and `DASHBOARD_WEBAUTHN_CREDENTIALS` are ABSENT — defense in depth beyond the
  unit's ExecStartPre closed set: if both were present, a passkey unlock could flip the latch source
  `tailnet`→`passkey` and re-open the recovery paths under the wrong authorization.
- `DASHBOARD_TAILNET_PROXY_UID`, if set, parses as a non-negative integer.

An unknown `DASHBOARD_AUTH_MODE` value is a boot error in every mode.

## 6. Env contract

| Variable | `win32-desktop` | `tailnet` |
|---|---|---|
| `DASHBOARD_AUTH_MODE` | absent or `win32-desktop` | `tailnet` (required) |
| `DASHBOARD_TAILNET_HOST` | unused | required, e.g. `kb.tail82dd4f.ts.net` |
| `DASHBOARD_TAILNET_OPERATOR` | unused | **required** — the single pinned operator login |
| `DASHBOARD_TAILNET_PROXY_UID` | unused | optional, default `0` |
| `DASHBOARD_DEV_ORIGIN` | optional localhost dev origin | **must not be set** (ambient auth: it would grant operator authority to any page on it) |
| `DASHBOARD_RP_ORIGIN` | required for any governed route | **must not be set** |
| `DASHBOARD_WEBAUTHN_CREDENTIALS` | required to mint a session | **must not be set** |
| `DASHBOARD_EXECUTION_ACTIVATED` | `0` | `0` — arming comes from the mode, not this gate |

The VM is a tailnet deployment, so `deploy/` is updated to that contract as a closed set, not widened to
allow both:

- `deploy/systemd/kb-dashboard.service` carries `DASHBOARD_AUTH_MODE=tailnet`; `bootstrap_vm.py` injects
  `DASHBOARD_TAILNET_HOST` and `DASHBOARD_TAILNET_OPERATOR` (the latter defaulting to
  `daniel.zhang.t1@gmail.com`, overridable via `--tailnet-operator`), replacing the former
  `--rp-origin` / `--webauthn-credentials` injection.
- `validate_vm_runtime.py`: `DASHBOARD_AUTH_MODE`, `DASHBOARD_TAILNET_HOST`, and
  `DASHBOARD_TAILNET_OPERATOR` are in the required `EXPECTED_UNIT_ENV` set (only `DASHBOARD_TAILNET_PROXY_UID`
  is optional); `DASHBOARD_RP_ORIGIN`, `DASHBOARD_WEBAUTHN_CREDENTIALS`, and `DASHBOARD_DEV_ORIGIN` are in
  NEITHER set, so a unit still carrying any of them FAILS the closed-set check. The WebAuthn credential
  shape-validator and its `SANCTIONED_PUBLIC_KEY_ENV` exemption are deleted rather than left orphaned —
  with no sanctioned public-key env name remaining, `CREDENTIAL_ENV_NAME` applies without exception.

This deliberately makes the live VM's current unit (which carries `DASHBOARD_RP_ORIGIN` and
`DASHBOARD_WEBAUTHN_CREDENTIALS`) invalid; that drift is exactly what this mode retires. Cutover requires
re-provisioning the unit — it is not a hot toggle.

## 7. Audit attribution

Every audit row already carries `owner` = the session subject. In tailnet mode the minted session's subject
is the operator id (`operator`), so existing rows are unchanged in shape. The Tailscale identity is recorded
alongside as attribution:

- `Tailscale-User-Login` → the attributed login (required, see 3.3)
- `Tailscale-User-Name` → display name, when present

These are attribution only. They never select the subject, never widen authority, and are never an
authentication input — the transport proof in 3.2/3.3 is.

## 8. Failure modes

| Condition | Result |
|---|---|
| Direct `curl 127.0.0.1:4317` with forged `Tailscale-User-*` | `403 forbidden`, reason `untrusted-peer` |
| Source-address spoof (`127.0.0.2:P` colliding with tailscaled's port `P`) | `403 forbidden`, reason `untrusted-peer` (4-tuple selects the attacker's own uid) |
| Peer UID lookup finds no / multiple rows, unparsable address, or `/proc` unreadable | `403 forbidden`, reason `untrusted-peer` |
| Through serve but no `Tailscale-User-Login` (e.g. Funnel) | `403 forbidden`, reason `no-tailnet-identity` |
| `Tailscale-User-Login` not equal to `DASHBOARD_TAILNET_OPERATOR` | `403 forbidden`, reason `identity-not-allowed` |
| Cross-site fetch (`Sec-Fetch-Site: cross-site`) | `403 forbidden`, reason `cross-site` |
| Wrong `Origin` / `Host` | `403` from the unchanged origin guard, before auth runs |
| `tailnet` mode on win32, non-loopback bind, missing host/operator, or a stale RP/WebAuthn env | daemon refuses to start |
| Unknown `DASHBOARD_AUTH_MODE` | daemon refuses to start |
| Latch build fails at boot | daemon starts LOCKED (existing `construct` failure path); nothing half-wired |

## 9. What `win32-desktop` keeps

Everything. `auth/webauthn.ts`, `auth/credentialStore.ts`, `auth/challenge.ts`, `auth/routes.ts`,
`auth/session.ts`'s mint/verify, the origin guard, the rate limiters, `requireSession`'s bearer path, and
the passkey-gated unlock route are untouched and remain the only path when `DASHBOARD_AUTH_MODE` is absent.
The two historical repair gates keep requiring a passkey unlock in win32 mode (they merely also accept the
tailnet operator when that mode is active). No file is deleted from that stack. The single addition to its
surface is the optional, unset `operatorAuth` field on `SessionConfig`.

## 10. Residual risks (for the adversarial reviewer)

1. **Root-equivalence.** Any root process can impersonate serve. Accepted: root already owns the host.
2. **Funnel is defended by header presence, not by configuration.** If a future tailscaled ever attached
   identity headers to Funnel traffic, lock 3.3 would weaken. Serve config should stay asserted tailnet-only
   out of band.
3. **Ambient auth + top-level GET navigation.** A cross-site top-level navigation sends no `Origin` and no
   `Sec-Fetch-Site: cross-site` in older browsers, so a GET could execute. Reads are idempotent and the
   response is not readable cross-origin, but this is the thinnest remaining edge.
4. **Per-request session mint** costs one HMAC + 16 random bytes per request. Measured as negligible, but it
   is a new per-request cost on every governed route.
5. **Shared rate-limit bucket.** Behind serve every request's socket peer is `127.0.0.1`, so all requests
   share one throttle bucket — a self-DoS ceiling only, given the single pinned operator. `trustProxy` must
   never be enabled for auth (the loopback peer-owner proof is the boundary), only ever for rate-limiting.

Resolved since the first review: the source-address spoof (now a full-4-tuple match), the dev-origin
allowlist widening, the dead paid-action approval URL, the missing boot assertion of retired WebAuthn env,
and the attribution keep-alive bleed. `DASHBOARD_TAILNET_OPERATOR` is now required (was residual risk #2).

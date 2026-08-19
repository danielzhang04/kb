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
| Origin allowlist source | `DASHBOARD_RP_ORIGIN` (+ `DASHBOARD_DEV_ORIGIN`) | `https://<DASHBOARD_TAILNET_HOST>` (+ `DASHBOARD_DEV_ORIGIN`) |
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

For a connection the daemon has accepted, the peer's socket is the row whose *local* endpoint is the
connection's remote endpoint and whose *remote* endpoint is the connection's local endpoint. Its `uid`
column is the owning UID. `/proc/net/tcp` and `/proc/net/tcp6` are world-readable and network-namespace
wide, so the unprivileged daemon can perform this lookup with no capability, no helper, and no IPC.

A forging local process running as `kb-dashboard` (or any non-root user) produces a peer row with its own
UID and is rejected. A root process could pass — but a root process on this host already owns the daemon,
its state root, and its unit file; it is outside the threat model by construction.

Rules, all fail-closed:

- The socket's own remote address must be loopback. Non-loopback → reject (the listener is loopback-bound,
  so this is unreachable in practice and is a belt-and-braces assertion).
- Exactly one `/proc/net/tcp{,6}` row must match the 4-tuple, in state `ESTABLISHED` (`01`), with both
  endpoints loopback. Zero rows, multiple rows, an unparsable table, or an unreadable `/proc` → reject.
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

Optional narrowing: when `DASHBOARD_TAILNET_OPERATOR` is set, `Tailscale-User-Login` must equal it. Unset
means any tailnet identity is the operator — which matches the approved design for a single-human tailnet.

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

**(a) Auth middleware.** `SessionConfig` gains an optional `operatorAuth` field. `requireSession` — the one
function all eight registration sites already call with `ctx.sessionConfig` — branches on it:

- absent → today's code path exactly (verify the bearer/cookie via `verifySession`).
- present → run the operator authenticator; on success **mint** a real session with `mintSession` and stash
  it in the same per-request `WeakMap`.

Because the minted value is a genuine signed session, every downstream consumer works unchanged:
`verifiedSession(req)?.claims.sub`, the `sessionToken` threaded into launches, and the gate modules that
independently re-verify with `verifySession`. No route file is edited. The mode reaches all eight sites
through the object they already receive.

**(b) Latch initial state.** `createExecutionLatch` boot-arms in `tailnet` mode with `source: 'tailnet'`,
alongside the existing `env-override` boot-arm. The unlock grant it mints authorizes
`buildActivatedExecution`, so `DASHBOARD_EXECUTION_ACTIVATED` stays `0` in the unit.

**(c) Bridge autostart.** `surface.ts`'s `onChange` starts the queue bridge for `source === 'passkey' ||
source === 'tailnet'`. `env-override` still does not start it (headless test behavior preserved).

Supporting: `resolveAllowedOrigins` reads the tailnet host in tailnet mode; `start()` asserts the boot
invariants; the `source` union widens to include `'tailnet'` in `activation.ts`, `control/routes.ts`, and
the client's `controlClient.ts` parser (which would otherwise drop the posture as unrecognized).

**Deliberately unchanged:** `authorizedLegacyRecoveryExecution` and
`authorizedFailedRunReconciliationGrant` keep their `source === 'passkey'` requirement. Those are two
one-off historical repair paths bound to a specific 2026-08-01 incident, not general execution; they should
not become reachable by a mode switch.

## 5. Boot validation (fail closed)

In `tailnet` mode `start()` refuses to listen unless all hold:

- `process.platform === 'linux'` — the peer-UID mechanism is `/proc`-based and has no win32 equivalent.
- the bind host is a loopback literal (`127.0.0.1` / `::1` / `localhost`) — the listener must stay behind
  serve; a `0.0.0.0` bind would expose ambient-auth endpoints to anything that can route to the node.
- `DASHBOARD_TAILNET_HOST` is set and is a bare hostname — it is the origin allowlist, and an empty
  allowlist would 403 everything anyway, but silently.
- `DASHBOARD_TAILNET_PROXY_UID`, if set, parses as a non-negative integer.

An unknown `DASHBOARD_AUTH_MODE` value is a boot error in every mode.

## 6. Env contract

| Variable | `win32-desktop` | `tailnet` |
|---|---|---|
| `DASHBOARD_AUTH_MODE` | absent or `win32-desktop` | `tailnet` (required) |
| `DASHBOARD_TAILNET_HOST` | unused | required, e.g. `kb.tail82dd4f.ts.net` |
| `DASHBOARD_TAILNET_PROXY_UID` | unused | optional, default `0` |
| `DASHBOARD_TAILNET_OPERATOR` | unused | optional login allowlist (single value) |
| `DASHBOARD_RP_ORIGIN` | required for any governed route | **must not be set** |
| `DASHBOARD_WEBAUTHN_CREDENTIALS` | required to mint a session | **must not be set** |
| `DASHBOARD_EXECUTION_ACTIVATED` | `0` | `0` — arming comes from the mode, not this gate |

The VM is a tailnet deployment, so `deploy/` is updated to that contract as a closed set, not widened to
allow both:

- `deploy/systemd/kb-dashboard.service` carries `DASHBOARD_AUTH_MODE=tailnet`; `bootstrap_vm.py` injects
  `DASHBOARD_TAILNET_HOST` (replacing the `--rp-origin` / `--webauthn-credentials` injection).
- `validate_vm_runtime.py`: `DASHBOARD_AUTH_MODE` and `DASHBOARD_TAILNET_HOST` move into
  `EXPECTED_UNIT_ENV`; `DASHBOARD_RP_ORIGIN` and `DASHBOARD_WEBAUTHN_CREDENTIALS` leave `OPTIONAL_UNIT_ENV`
  entirely, so a unit still carrying them now FAILS the closed-set check. The WebAuthn credential
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
| Peer UID lookup finds no / multiple rows, or `/proc` unreadable | `403 forbidden`, reason `untrusted-peer` |
| Through serve but no `Tailscale-User-Login` (e.g. Funnel) | `403 forbidden`, reason `no-tailnet-identity` |
| `Tailscale-User-Login` not equal to `DASHBOARD_TAILNET_OPERATOR` | `403 forbidden`, reason `identity-not-allowed` |
| Cross-site fetch (`Sec-Fetch-Site: cross-site`) | `403 forbidden`, reason `cross-site` |
| Wrong `Origin` / `Host` | `403` from the unchanged origin guard, before auth runs |
| `tailnet` mode on win32, non-loopback bind, missing tailnet host | daemon refuses to start |
| Unknown `DASHBOARD_AUTH_MODE` | daemon refuses to start |
| Latch build fails at boot | daemon starts LOCKED (existing `construct` failure path); nothing half-wired |

## 9. What `win32-desktop` keeps

Everything. `auth/webauthn.ts`, `auth/credentialStore.ts`, `auth/challenge.ts`, `auth/routes.ts`,
`auth/session.ts`'s mint/verify, the origin guard, the rate limiters, `requireSession`'s bearer path, the
passkey-gated unlock route, and the passkey-only historical repair gates are untouched and remain the
only path when `DASHBOARD_AUTH_MODE` is absent. No file is deleted from that stack. The single addition to
its surface is the optional, unset `operatorAuth` field on `SessionConfig`.

## 10. Residual risks (for the adversarial reviewer)

1. **Root-equivalence.** Any root process can impersonate serve. Accepted: root already owns the host.
2. **Anyone on the tailnet is the operator** unless `DASHBOARD_TAILNET_OPERATOR` is set. This is the
   approved design for a single-human tailnet; it becomes wrong the moment a second node or a shared node
   joins, and the knob exists for that day.
3. **Funnel is defended by header presence, not by configuration.** If a future tailscaled ever attached
   identity headers to Funnel traffic, lock 3.3 would weaken. Serve config should stay asserted tailnet-only
   out of band.
4. **Ambient auth + top-level GET navigation.** A cross-site top-level navigation sends no `Origin` and no
   `Sec-Fetch-Site: cross-site` in older browsers, so a GET could execute. Reads are idempotent and the
   response is not readable cross-origin, but this is the thinnest remaining edge.
5. **Per-request session mint** costs one HMAC + 16 random bytes per request. Measured as negligible, but it
   is a new per-request cost on every governed route.

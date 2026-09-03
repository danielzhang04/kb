/**
 * Deployment auth mode — the ONE switch that selects how an operator is authenticated.
 *
 *   `win32-desktop` (the default, and what an absent `DASHBOARD_AUTH_MODE` means): today's behaviour,
 *      unchanged. A WebAuthn passkey assertion mints a short-TTL session bearer; execution is armed only
 *      by an explicit passkey-sourced unlock.
 *
 *   `tailnet`: the daemon sits behind a tailnet-only `tailscale serve` proxy on a single-human tailnet.
 *      Every request proven to have arrived through that proxy IS the operator — no sign-in, no session
 *      ceremony — and execution is armed at boot. See
 *      `docs/superpowers/specs/2026-08-18-tailnet-trust-mode-design.md`. W47 re-admits ONE constrained
 *      WebAuthn channel on top of that (see {@link TAILNET_PASSKEY_ENV}): it exists solely so a T3
 *      `ceremony: webauthn` item can be signed per governance/risk-tiers.md D2.13. It mints no session,
 *      grants no sign-in, and cannot arm or re-source the execution latch.
 *
 * This module resolves the mode and the tailnet parameters, and holds the BOOT invariants the tailnet
 * mode must satisfy before the daemon is allowed to listen. It deliberately depends on nothing else in
 * the auth stack, so both modes can import it without a cycle.
 *
 * Every resolution here fails CLOSED by throwing: an unknown mode, a missing serve host, or a
 * non-loopback bind must stop the daemon, never degrade it into a weaker posture silently.
 */

/** A configuration fault that must prevent the daemon from starting. */
export class AuthModeError extends Error {}

export type AuthMode = 'win32-desktop' | 'tailnet';

/** What an absent `DASHBOARD_AUTH_MODE` means — today's deployment, bit for bit. */
export const DEFAULT_AUTH_MODE: AuthMode = 'win32-desktop';

/**
 * The single-operator subject every minted session carries, in BOTH modes. Keeping it identical means
 * subject-keyed durable state (Composer workspaces, audit `owner`, run ownership) is continuous across a
 * mode switch — the tailnet identity is recorded as attribution beside it, never as the subject.
 */
export const OPERATOR_SUBJECT = 'operator';

/** A bare hostname: what `tailscale serve` publishes, e.g. `kb.command.ts.net`. No scheme, no path. */
const TAILNET_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

/** Bind addresses that keep the listener behind the proxy. Anything else exposes ambient-auth routes. */
const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * W47: the CONSTRAINED tailnet passkey channel. `DASHBOARD_RP_ORIGIN` +
 * `DASHBOARD_WEBAUTHN_CREDENTIALS` were BLANKET-retired in tailnet mode by the cutover
 * (docs/specs/2026-08-18-cutover-end-state.md:310-333), which made T3 `ceremony: webauthn` items
 * unapprovable on the VM: `resolveCredentials()` reads only that one variable, so `ctx.credentials()`
 * was `[]` by construction and every `respond/challenge` answered `403 ceremony-unavailable`.
 * governance/risk-tiers.md D2.13 says a T3 decision travels a WebAuthn-signed channel ONLY, and the
 * later movement design (docs/specs/2026-08-20-desk-vm-movement-design.md:258,297) settled the
 * browser-ceremony carve-out. So the pair is re-admitted under constraints instead of retired:
 *
 *   - BOTH ABSENT is legal and remains the default posture (today's VM, bit for bit).
 *   - `DASHBOARD_RP_ORIGIN` ALONE is legal: it is the ENROLMENT posture, since the register ceremony
 *     needs an RP origin and is the only way to obtain a credential in the first place. It grants
 *     nothing - an empty store means `ceremonyAvailable` false, T3 challenges 403, `assert/verify` 401.
 *   - `DASHBOARD_WEBAUTHN_CREDENTIALS` ALONE is a boot refusal: no RP origin means no RP-ID, so the
 *     store could never verify anything while still looking provisioned.
 *   - Whenever `DASHBOARD_RP_ORIGIN` is set it must be EXACTLY `https://<tailnet host>`; whenever
 *     `DASHBOARD_WEBAUTHN_CREDENTIALS` is set it must parse to at least one credential.
 *
 * The retirement's ORIGINAL intent is preserved by construction, not by absence: the execution latch
 * in tailnet mode is armed AT BOOT with `source: 'tailnet'` (control/activation.ts:742), and
 * `unlock()` short-circuits on an already-constructed execution (control/activation.ts:748), so a
 * passkey assertion can never flip the latch source tailnet -> passkey nor re-open the two historical
 * passkey-only repair paths. `mode.test.ts` asserts that byte-identically with and without the pair.
 */
const TAILNET_PASSKEY_ENV = {
  origin: 'DASHBOARD_RP_ORIGIN',
  credentials: 'DASHBOARD_WEBAUTHN_CREDENTIALS',
} as const;

/**
 * The reachability gate for the SHIPPED WebAuthn ceremony - an EXHAUSTIVE switch over the closed
 * `AuthMode` union whose `default` arm is a `never` assertion, so a future third auth mode fails to
 * COMPILE rather than being auto-admitted [P5-C23, P5-C45]. It admits the mode only; every caller
 * ALSO requires `credentials().length > 0`, so it never loosens on credential possession. Lives here
 * (not in `control/routes.ts`) so `auth/routes.ts` can report it on `/api/auth/context` without an
 * import cycle; `control/routes.ts` re-exports it for its existing importers.
 */
export function ceremonyModeAdmits(mode: AuthMode): boolean {
  switch (mode) {
    case 'win32-desktop':
    case 'tailnet':
      return true;
    default: {
      const never: never = mode;
      return never;
    }
  }
}

/**
 * Count the credentials `DASHBOARD_WEBAUTHN_CREDENTIALS` provisions, WITHOUT importing
 * `credentialStore.ts` (this module deliberately depends on nothing else in the auth stack). Mirrors
 * `resolveCredentials`'s parse exactly: a non-array, unparseable, or entry-shape-invalid value counts
 * zero, so boot refuses on precisely the values that would leave `ctx.credentials()` empty. It never
 * decodes, logs, or returns key material - only a count.
 */
function countProvisionedCredentials(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;
  let count = 0;
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { id?: unknown; publicKey?: unknown };
    if (typeof candidate.id === 'string' && typeof candidate.publicKey === 'string') count += 1;
  }
  return count;
}

/**
 * Enforce {@link TAILNET_PASSKEY_ENV}'s posture rules (see the table above). Exported for the boot
 * assertion and for direct testing; throws (fails CLOSED) on every violation.
 */
export function assertTailnetPasskeyChannel(
  env: Record<string, string | undefined>,
  tailnetHost: string,
): void {
  const origin = env[TAILNET_PASSKEY_ENV.origin]?.trim() ?? '';
  const credentials = env[TAILNET_PASSKEY_ENV.credentials]?.trim() ?? '';
  if (!origin && !credentials) return;
  // ORIGIN ALONE IS LEGAL, and it is the ENROLMENT posture: the register routes need an RP origin to
  // pin an RP-ID, and there is no way to obtain a credential without first running that ceremony. It
  // grants nothing on its own - the store is empty, so `ceremonyAvailable` is false, every T3 challenge
  // answers `403 ceremony-unavailable`, and `assert/verify` answers 401 with no credential to match.
  // CREDENTIALS ALONE REFUSE: a store with no RP origin can pin no RP-ID, so no assertion could ever
  // verify against it - a silently dead channel that would still report itself provisioned.
  if (credentials && !origin) {
    throw new AuthModeError(
      `tailnet auth mode requires ${TAILNET_PASSKEY_ENV.origin} whenever ${TAILNET_PASSKEY_ENV.credentials} is set `
      + '(a credential store with no RP origin cannot pin an RP-ID, so no assertion could ever verify)',
    );
  }
  const expected = `https://${tailnetHost}`;
  if (origin !== expected) {
    throw new AuthModeError(
      `tailnet auth mode requires ${TAILNET_PASSKEY_ENV.origin} to equal ${expected} exactly (the tailscale serve origin)`,
    );
  }
  if (credentials && countProvisionedCredentials(credentials) < 1) {
    throw new AuthModeError(
      `${TAILNET_PASSKEY_ENV.credentials} must parse to at least one {id, publicKey} credential`,
    );
  }
}

/**
 * P6 §3.3: the SECOND proxy uid, naming the attested `kb-node-proxy` that fronts the node routes on the
 * 8444 `tailscale serve` listener. `requireNodeIdentity` accepts an injected `Tailscale-Node-ID` only from
 * this uid, and the four node routes refuse every other peer. It is a hard REQUIRED env in tailnet mode —
 * an absent value is a boot refusal, never a silent `0` default, because `0` is exactly the value that
 * would let root `tailscale serve` on 443 satisfy the node peer check while nothing strips a client-supplied
 * `Tailscale-Node-ID` [P6-C27, P6-C60].
 */
export function resolveNodeProxyUid(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DASHBOARD_NODE_PROXY_UID?.trim();
  if (!raw) {
    throw new AuthModeError('DASHBOARD_NODE_PROXY_UID is required in tailnet mode (the attested node-proxy uid)');
  }
  const uid = Number(raw);
  if (!Number.isInteger(uid) || uid < 0) {
    throw new AuthModeError('DASHBOARD_NODE_PROXY_UID must be a non-negative integer');
  }
  return uid;
}

export function resolveAuthMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const raw = env.DASHBOARD_AUTH_MODE?.trim();
  if (!raw) return DEFAULT_AUTH_MODE;
  if (raw === 'tailnet' || raw === 'win32-desktop') return raw;
  throw new AuthModeError(`unknown DASHBOARD_AUTH_MODE: ${raw}`);
}

export interface TailnetConfig {
  /** The `tailscale serve` hostname. Its `https://` form is the entire origin allowlist in this mode. */
  host: string;
  /** UID owning the trusted proxy's sockets. `tailscaled` runs as root, so 0 unless deliberately changed. */
  proxyUid: number;
  /**
   * The single operator login — REQUIRED (Daniel, 2026-08-18). `Tailscale-User-Login` must equal it. It is
   * fail-closed for a reason specific to this VM: tailnet membership there is root-equivalent (passwordless
   * sudo), so "any tailnet principal is the operator" would be a standing privilege grant to every node on
   * the tailnet. Pinning one identity closes that.
   */
  operatorLogin: string;
}

export function resolveTailnetConfig(env: Record<string, string | undefined> = process.env): TailnetConfig {
  const host = env.DASHBOARD_TAILNET_HOST?.trim() ?? '';
  if (!TAILNET_HOST_PATTERN.test(host)) {
    throw new AuthModeError('DASHBOARD_TAILNET_HOST must be the bare tailscale serve hostname');
  }
  const rawUid = env.DASHBOARD_TAILNET_PROXY_UID?.trim();
  let proxyUid = 0;
  if (rawUid) {
    proxyUid = Number(rawUid);
    if (!Number.isInteger(proxyUid) || proxyUid < 0) {
      throw new AuthModeError('DASHBOARD_TAILNET_PROXY_UID must be a non-negative integer');
    }
  }
  const operatorLogin = env.DASHBOARD_TAILNET_OPERATOR?.trim();
  if (!operatorLogin) {
    throw new AuthModeError('DASHBOARD_TAILNET_OPERATOR is required in tailnet mode (tailnet membership must not be operator-by-default)');
  }
  return { host, proxyUid, operatorLogin };
}

/**
 * Assert everything the resolved mode requires of this process, and return the mode. Called from
 * `start()` BEFORE the listener is opened, so a misconfigured tailnet daemon refuses to run rather than
 * serving ambient-auth routes on the wrong interface.
 */
export function assertAuthModeBoot(options: {
  bindHost: string;
  env?: Record<string, string | undefined>;
  platform?: string;
}): AuthMode {
  const env = options.env ?? process.env;
  const mode = resolveAuthMode(env);
  if (mode !== 'tailnet') return mode;
  if ((options.platform ?? process.platform) !== 'linux') {
    throw new AuthModeError('tailnet auth mode requires Linux: the peer-owner proof reads /proc/net/tcp');
  }
  if (!LOOPBACK_BIND.has(options.bindHost)) {
    throw new AuthModeError(
      `tailnet auth mode requires a loopback bind behind tailscale serve; refusing to listen on ${options.bindHost}`,
    );
  }
  const { host: tailnetHost, proxyUid: tailnetUid } = resolveTailnetConfig(env);
  // W47: defense in depth beyond the unit's ExecStartPre set, now a CONSTRAINT rather than a
  // retirement. See TAILNET_PASSKEY_ENV: an RP origin pinned to the serve host exactly, so a passkey
  // ceremony can only ever be mounted on the one origin this daemon serves; credentials require it.
  assertTailnetPasskeyChannel(env, tailnetHost);
  // P6 §3.3 [P6-C27, P6-C60, P6-C73]: the whole node-identity fix is the distinctness rule
  //   DASHBOARD_NODE_PROXY_UID ∉ {0, DASHBOARD_TAILNET_PROXY_UID}, with DASHBOARD_TAILNET_PROXY_UID pinned
  // to 0 (root `tailscale serve` is the only operator proxy this tree has, so 0 is the only value its peer
  // check can ever see). A node uid of 0 lets root serve on 443 pass the node peer check while nothing
  // strips an inbound `Tailscale-Node-ID`; equal uids invert it into a total operator lockout. Both are a
  // boot refusal, evaluated here (never in `resolveTailnetConfig`, which stays a pure config read).
  const nodeUid = resolveNodeProxyUid(env);
  if (tailnetUid !== 0) {
    throw new AuthModeError(
      `tailnet auth mode requires DASHBOARD_TAILNET_PROXY_UID=0 (root tailscale serve is the only operator proxy); got ${tailnetUid}`,
    );
  }
  if (nodeUid === 0 || nodeUid === tailnetUid) {
    throw new AuthModeError(
      'DASHBOARD_NODE_PROXY_UID must be distinct from 0 and from DASHBOARD_TAILNET_PROXY_UID',
    );
  }
  return mode;
}

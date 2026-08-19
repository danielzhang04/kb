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
 *      `docs/superpowers/specs/2026-08-18-tailnet-trust-mode-design.md`.
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

/** A bare hostname: what `tailscale serve` publishes, e.g. `kb.tail82dd4f.ts.net`. No scheme, no path. */
const TAILNET_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

/** Bind addresses that keep the listener behind the proxy. Anything else exposes ambient-auth routes. */
const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost']);

/** WebAuthn channels retired by tailnet mode; their presence at boot is a misconfiguration. */
const RETIRED_IN_TAILNET = ['DASHBOARD_RP_ORIGIN', 'DASHBOARD_WEBAUTHN_CREDENTIALS'] as const;

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
  /** Optional single-login allowlist checked against `Tailscale-User-Login`; null = any tailnet identity. */
  operatorLogin: string | null;
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
  return { host, proxyUid, operatorLogin: env.DASHBOARD_TAILNET_OPERATOR?.trim() || null };
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
  // Defense in depth beyond the unit's ExecStartPre closed set: the WebAuthn channel is RETIRED in
  // tailnet mode. If both these were present, a passkey unlock could flip the latch source
  // tailnet->passkey and re-open the two historical passkey-only repair paths. Refuse to start.
  for (const retired of RETIRED_IN_TAILNET) {
    if (env[retired]?.trim()) {
      throw new AuthModeError(`tailnet auth mode retires ${retired}; remove it from the unit before starting`);
    }
  }
  resolveTailnetConfig(env);
  return mode;
}

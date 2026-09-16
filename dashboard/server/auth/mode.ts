/**
 * Deployment auth mode — the ONE switch that selects how an operator is authenticated.
 *
 *   `win32-desktop` (the default, and what an absent `DASHBOARD_AUTH_MODE` means): no ambient operator
 *      proof exists on this transport, so a session bearer is required for every governed request; a
 *      session is minted by `mintSession` and execution is armed only by an explicit unlock.
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

/** A bare hostname: what `tailscale serve` publishes, e.g. `kb.command.ts.net`. No scheme, no path. */
const TAILNET_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

/** Bind addresses that keep the listener behind the proxy. Anything else exposes ambient-auth routes. */
const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost']);

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
  const { proxyUid: tailnetUid } = resolveTailnetConfig(env);
  // T3 (spec §4.2): the ssh-signed human-approval channel's allowed-signers file is REQUIRED in tailnet
  // mode — an absolute path to the root-owned file `sshsig.ts#defaultSshsigVerifier` shells out against.
  // Absent or relative fails boot loudly here rather than letting every `signed`-class route answer
  // 503 at the first request. `deploy/validate_vm_runtime.py#_validate_human_approver_signers` mirrors
  // this same assertion (plus the file's own ownership/mode) against the installed unit.
  const allowedSigners = env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS?.trim() ?? '';
  if (!allowedSigners || !allowedSigners.startsWith('/')) {
    throw new AuthModeError(
      'tailnet auth mode requires DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS to be an absolute path '
      + '(the root-owned allowed-signers file for the kb-ops-approver human-approval channel)',
    );
  }
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

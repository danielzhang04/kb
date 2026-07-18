/**
 * D3.1 — the pinned kb-fleet SID (the PTY host's OWN identity), used on BOTH sides of the cross-user
 * channel:
 *   • hostMain.ts asserts its OWN process SID == this value before it will listen (a host that is not
 *     kb-fleet must not open the pipe).
 *   • the daemon's client transport verifies the pipe SERVER's SID == this value BEFORE presenting the
 *     per-boot token (mutual auth / anti-squat — a squatted pipe owned by another user must not harvest
 *     the token; design Point 4).
 *
 * The value is a stable machine fact (design §Key facts). It is overridable ONLY via an explicit env var
 * so a different box / a rehearsal can pin a different fleet SID; there is no silent fallback that would
 * weaken the identity check. A malformed override throws (fail closed) rather than degrading to "any SID".
 */

/** The kb-fleet account SID on this box (design §Key facts pinned). */
export const KB_FLEET_SID = 'S-1-5-21-732142867-588960626-3228783940-1007';

/** Env override key (rehearsal / alternate box). */
export const FLEET_SID_ENV = 'DASHBOARD_PTY_HOST_SERVER_SID';

const SID_RE = /^S-1-\d+(?:-\d+)+$/;

/**
 * Resolve the expected kb-fleet SID: the env override if present + well-formed, else the pinned constant.
 * Throws on a present-but-malformed override (never silently ignores a bad pin → fail closed).
 */
export function resolveFleetSid(env: Record<string, string | undefined> = process.env): string {
  const override = env[FLEET_SID_ENV]?.trim();
  if (override) {
    if (!SID_RE.test(override)) {
      throw new Error(`${FLEET_SID_ENV} is not a well-formed SID: '${override}'; fail-closed`);
    }
    return override;
  }
  return KB_FLEET_SID;
}

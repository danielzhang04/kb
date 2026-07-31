/**
 * U2 — WebAuthn ceremony + session-mint routes. These are the ONLY routes on the guarded surface that
 * do NOT require a session (gating the session-minting path on a session would be circular). They are
 * still behind the scope's Origin/Host guard and rate-limiter.
 *
 * Flow:
 *   POST /api/auth/register/options  -> registration ceremony options (+ opaque ceremonyId).
 *   POST /api/auth/register/verify   -> verifies a registration response; reports `verified` and, on
 *                                        success, the public-key material a human would provision into
 *                                        `DASHBOARD_WEBAUTHN_CREDENTIALS`. NEVER mints a session and NEVER
 *                                        auto-trusts the credential (enrollment is an out-of-band human
 *                                        step — the fail-closed posture).
 *   POST /api/auth/assert/options    -> login assertion options over the REGISTERED credentials (empty
 *                                        until a passkey is provisioned) (+ opaque ceremonyId).
 *   POST /api/auth/assert/verify     -> verifies a login assertion against the stored credential and, on
 *                                        `verified === true` ONLY (via `mintSessionFromVerifiedAssertion`),
 *                                        mints a short-TTL session bearer. With no registered credential
 *                                        it 401s — the fail-closed reality pre-passkey.
 *
 * The server-issued challenge for each ceremony is stashed in `credentialStore.ts`'s single-use pending
 * store and consumed at verify time, so a verify cannot be replayed against a stale/forged challenge.
 */
import type { FastifyInstance } from 'fastify';
import {
  registrationOptions,
  verifyRegistration,
  assertionOptions,
  verifyAssertion,
} from './webauthn.ts';
import type { WebAuthnUser } from './webauthn.ts';
import { mintSessionFromVerifiedAssertion } from './session.ts';
import { findCredential, rememberChallenge, consumeChallenge } from './credentialStore.ts';
import type { SurfaceContext } from '../http/context.ts';
import { auditFn } from '../http/context.ts';

/** The single-operator identity this daemon mints sessions for (loopback, one human). */
const OPERATOR: WebAuthnUser = { id: 'operator', name: 'operator', displayName: 'kb operator' };

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/**
 * LOW (audit follow-up): every purpose-bound ceremony minted elsewhere on this daemon (e.g.
 * `control/routes.ts`'s execution-unlock, `EXECUTION_UNLOCK_PURPOSE = 'kb.execution-unlock'`)
 * embeds its purpose as a `"kb.<purpose>:<subject>:<random>"` UTF-8 preimage in the challenge
 * before base64url-encoding it, and stashes it in the SAME `credentialStore.ts` pending-challenge
 * map these register/assert routes consume from — there is only one map, keyed by ceremonyId, not
 * by purpose. A generic sign-in ceremony's challenge is always fresh, opaque, random bytes (never
 * built from a "kb." UTF-8 preimage — see `webauthn.ts#assertionOptions`/`registrationOptions`,
 * neither of which is ever given an explicit `challenge`), so this prefix is never legitimately
 * seen here. Without this check, an unlock (or any future purpose-bound) ceremony's `ceremonyId`
 * could be redeemed at these general login/registration routes instead of its intended one — a
 * privilege DOWNGRADE (unlock -> mere sign-in), never an escalation, but still not the ceremony it
 * was minted for. Reject it the same way an unknown/expired ceremony already is, before any
 * credential lookup — this does not change the auth API's response shape.
 */
const NAMESPACED_CHALLENGE_PREFIX = 'kb.';

function isNamespacedChallenge(base64urlChallenge: string): boolean {
  try {
    return Buffer.from(base64urlChallenge, 'base64url').toString('utf8').startsWith(NAMESPACED_CHALLENGE_PREFIX);
  } catch {
    return false;
  }
}

/** Register the auth ceremony routes on an ALREADY-GUARDED scope (origin + rate-limit hooks applied). */
export function registerAuthRoutes(scope: FastifyInstance, ctx: SurfaceContext): void {
  scope.post('/api/auth/register/options', async (_req, reply) => {
    let config;
    try {
      config = ctx.webAuthnConfig();
    } catch {
      return reply.code(503).send({ error: 'webauthn-unconfigured', reason: 'DASHBOARD_RP_ORIGIN is not set' });
    }
    const credentials = ctx.credentials();
    const options = await registrationOptions({ ...OPERATOR, credentials }, config);
    const { ceremonyId } = rememberChallenge(options.challenge);
    return reply.code(200).send({ ceremonyId, options });
  });

  scope.post('/api/auth/register/verify', async (req, reply) => {
    const body = asRecord(req.body);
    const ceremonyId = typeof body.ceremonyId === 'string' ? body.ceremonyId : '';
    const expectedChallenge = consumeChallenge(ceremonyId);
    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'bad-ceremony', reason: 'unknown or expired registration ceremony' });
    }
    if (isNamespacedChallenge(expectedChallenge)) {
      // A purpose-bound ceremony minted for a different route (e.g. execution-unlock) — never a
      // plain registration challenge. See NAMESPACED_CHALLENGE_PREFIX above.
      return reply.code(400).send({ error: 'bad-ceremony', reason: 'challenge is not a registration challenge' });
    }
    let config;
    try {
      config = ctx.webAuthnConfig();
    } catch {
      return reply.code(503).send({ error: 'webauthn-unconfigured', reason: 'DASHBOARD_RP_ORIGIN is not set' });
    }
    let result;
    try {
      result = await verifyRegistration(body.response as never, { expectedChallenge, config });
    } catch (err) {
      return reply.code(400).send({ error: 'registration-failed', reason: err instanceof Error ? err.message : 'invalid response' });
    }
    // Report the material a human provisions into DASHBOARD_WEBAUTHN_CREDENTIALS — never auto-trusted here.
    const info = result.registrationInfo;
    return reply.code(200).send({
      verified: result.verified,
      credential: result.verified && info
        ? {
            id: info.credential.id,
            publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
            counter: info.credential.counter,
          }
        : undefined,
    });
  });

  scope.post('/api/auth/assert/options', async (_req, reply) => {
    let config;
    try {
      config = ctx.webAuthnConfig();
    } catch {
      return reply.code(503).send({ error: 'webauthn-unconfigured', reason: 'DASHBOARD_RP_ORIGIN is not set' });
    }
    const credentials = ctx.credentials();
    const options = await assertionOptions({ credentials }, config);
    const { ceremonyId } = rememberChallenge(options.challenge);
    return reply.code(200).send({ ceremonyId, options });
  });

  scope.post('/api/auth/assert/verify', async (req, reply) => {
    const body = asRecord(req.body);
    const ceremonyId = typeof body.ceremonyId === 'string' ? body.ceremonyId : '';
    const expectedChallenge = consumeChallenge(ceremonyId);
    if (!expectedChallenge) {
      return reply.code(400).send({ error: 'bad-ceremony', reason: 'unknown or expired assertion ceremony' });
    }
    if (isNamespacedChallenge(expectedChallenge)) {
      // A purpose-bound ceremony minted for a different route (e.g. execution-unlock) redeemed
      // here would mint a full sign-in session off a ceremony the operator approved for something
      // narrower — a privilege downgrade, but not the ceremony it was minted for. Refuse it before
      // any credential lookup, same as an unknown ceremony. See NAMESPACED_CHALLENGE_PREFIX above.
      return reply.code(400).send({ error: 'bad-ceremony', reason: 'challenge is not a sign-in challenge' });
    }
    const response = body.response as { id?: unknown } | undefined;
    const credId = response && typeof response.id === 'string' ? response.id : '';
    const credential = findCredential(ctx.credentials(), credId);
    if (!credential) {
      // FAIL-CLOSED: no registered passkey (or none matching) => no session can be minted. This is the
      // exact pre-passkey reality (EXPECTED_CRED_STORE_SHA256=None). No audit/git write on this
      // unauthenticated path — an attacker must not be able to drive unbounded ops commits.
      return reply.code(401).send({ error: 'unauthenticated', reason: 'no registered credential for this assertion' });
    }
    let config;
    try {
      config = ctx.webAuthnConfig();
    } catch {
      return reply.code(503).send({ error: 'webauthn-unconfigured', reason: 'DASHBOARD_RP_ORIGIN is not set' });
    }
    let result;
    try {
      result = await verifyAssertion(body.response as never, { expectedChallenge, credential, config });
    } catch (err) {
      return reply.code(401).send({ error: 'unauthenticated', reason: err instanceof Error ? err.message : 'assertion failed' });
    }
    if (!result.verified) {
      return reply.code(401).send({ error: 'unauthenticated', reason: 'assertion not verified' });
    }
    // Mint ONLY from a positively-verified assertion (throws otherwise — never a speculative mint).
    // INFO: pass the ACTUAL verification result, not a `{ verified: true }` literal, so the mint guard
    // actually guards (defence-in-depth behind the `if (!result.verified)` return above).
    const { token, claims } = mintSessionFromVerifiedAssertion(result, OPERATOR.id, ctx.sessionConfig);
    auditFn(ctx)(ctx.repoRoot, { action: 'auth', owner: OPERATOR.id, result: 'login' }, { runGit: ctx.opsGit, now: ctx.now });
    return reply.code(200).send({ token, expiresAt: claims.exp });
  });
}

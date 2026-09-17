/**
 * `X-KB-Actor` header parsing — T4 [design:4.3].
 *
 * The header is SELF-ASSERTED by the caller (boss session, a dispatched worker, or Daniel's own
 * browser/CLI) and is therefore a RECORD, never an authority input: nothing in this module, and nothing
 * that consumes its output, may use the parsed value to grant, widen, or narrow what a request is allowed
 * to do. It exists so an audit row and a resolved human request can say WHO claimed to act, not to decide
 * whether they were allowed to. `actor.test.ts`'s authority-invariance test pins this directly: the same
 * request with `X-KB-Actor: daniel`, `boss`, `worker:x`, and no header at all must get the identical HTTP
 * status, on both a tagged and an untagged run.
 */

/** `daniel` | `boss` | `worker:<id>` where `<id>` matches `/^[a-z0-9][a-z0-9._-]{0,62}$/` (max 63 chars).
 *  Anything else — absent, malformed, repeated header, wrong case — is `unknown`. */
export type Actor = 'daniel' | 'boss' | `worker:${string}` | 'unknown';

/** The exact (lower-case) header name this module reads. */
export const ACTOR_HEADER = 'x-kb-actor';

const WORKER_ID_RE = /^worker:[a-z0-9][a-z0-9._-]{0,62}$/;

/**
 * Total: every input maps to some {@link Actor}, never throws. A repeated header (Fastify hands back an
 * array for a duplicated header name) is refused outright — there is no "first wins" leniency, because
 * that would let a second, attacker-controlled instance of the header silently coexist with a legitimate
 * one. Case-sensitive and untrimmed-content-sensitive: only the three exact shapes below are ever
 * anything other than `unknown`.
 */
export function parseActor(header: string | string[] | undefined): Actor {
  if (typeof header !== 'string') return 'unknown';
  if (header === 'daniel' || header === 'boss') return header;
  if (WORKER_ID_RE.test(header)) return header as Actor;
  return 'unknown';
}

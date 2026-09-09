# Cloud-pair gallery independent review — 2026-09-09

## Verdict

**READY.** The fixed-root gallery projects the two completed OmniGen2 originals,
binds them to the terminal receipt and both STOP reviews, serves only the requested
hash-bound PNG, and keeps the pair non-promotable and ineligible for training.

## Evidence and trust boundaries

The reader rejects missing or unsafe roots, reparse paths, path traversal, malformed
or deeply nested JSON, oversized records and review documents, changed files, stale
digests, unexpected receipt shapes, duplicate seeds, non-PNG payloads, and dimension
mismatches. It reads through a checked file descriptor and compares file identity
before and after each bounded read. The JSON projection omits private roots, pod IDs,
prompts, uploads, logs, receipt filenames, and embedded workflow data.

The asset endpoint is mounted in the existing authenticated read scope. The server
authentication matrix now proves an unauthenticated request receives 401 and an
authenticated request reaches the route's normal stale-evidence 409. Asset IDs and
SHA-256 values are validated before lookup; successful responses are `image/png`,
`nosniff`, and `no-store`.

The endpoint returns each original PNG byte-for-byte. Those originals may retain
producer-embedded workflow metadata. The implementation and documentation state
that boundary correctly and do not claim sanitized public media or strip evidence.

The descriptor's seed-90210 root observation was corrected to the finding supported
by the bound root review. The more specific face/nose/smile observation remains
attributed only to the independent review. Both review documents are raw-SHA-bound;
their exact paths are pinned to LF in `.gitattributes`, preventing `core.autocrlf=true`
from invalidating a fresh Windows checkout.

## UI and verification

The Asset review view labels root and independent STOP findings separately, states
that the pair is rejected research evidence, and makes no quality, training, or
promotion claim. The lifecycle card now says that it contains lifecycle evidence
only, avoiding conflict with the adjacent completed visual review. A recorded cloud
pair suppresses the unrelated empty-diagnostic message. Object URLs are revoked on
cleanup, aborted requests cannot update stale state, and each failed image gets a
terminal unavailable state.

Independent verification confirmed the descriptor's final receipt digest and both
original PNG byte counts and SHA-256 values. My affected-suite rerun passed **124
tests across three files in 41.24 seconds**. The author then repaired a junction test
whose broad catch could swallow an assertion; the focused reader suite passed all
three cases after that fix. Root's actual asset-route probe served both exact
originals with the expected headers and returned 409 for stale evidence; its record
is MAIN `_private/figment-cloud-gallery-root-verification-20260909.json`.

Dashboard typecheck passed in the implementation verification. No browser surface
was available, so this revision has no screenshot or viewport claim. The route still
performs one redundant full evidence collection before the asset reader repeats the
same bounded validation; with two fixed sub-megabyte images this is optional
performance cleanup and does not block readiness.

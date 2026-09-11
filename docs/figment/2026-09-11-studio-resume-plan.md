# Studio stored plans and request resume

FIGMENT STUDIO RESUME CONTRACT (boss decision, 2026-09-11). This is the next bounded slice after the ec58decf repair acceptance (see [repair checkpoint review](2026-09-11-repair-checkpoint-review.md)). This slice is **in progress, not accepted or tested yet**. It advances recovery by adding read-only plan inventory and durable request-resume; it does **not** claim orphan cleanup, capacity retirement/release, launch, approval, or input editing.

The existing registrar/closure remains the sole preparation owner. Extend it; do not introduce factory wrappers, second stores, or new runners.

## GET /api/figment/studio/gen-plans

Authenticated read. Returns exactly:

```text
{
  schema: 'figment/studio-gen-plans@1',
  requestScope: <64 lower-hex chars>,
  plans: StudioGenPlan[] (<=2),
  preparation: 'available' | 'busy' | 'at-capacity' | 'maintenance-required' | 'unavailable'
}
```

- Plans use the exact existing minimal POST DTO. A plan is not an approval.
- `requestScope = sha256(JSON.stringify(['figment-studio-request-scope@1', resolvedRepoRoot, verifiedSession.claims.sub]))`. It is a nonsecret continuity identifier, not an authorization token.
- Workspace inventory is shared by authorized operator sessions, same as the existing global-to-plan store; no per-user ACL is invented.

Both GET and POST share the same active/`terminationUncertain` state and the same bounded directory scan, preserving the existing POST capacity/order/replay/partial-marker rules. GET writes nothing: no mkdir, spawn, or audit ever occurs on GET.

Preparation status resolution:

| Condition | `preparation` result |
| --- | --- |
| Plans root safely missing | `available`, `plans: []` |
| Unsafe root/script/ledger/links, malformed markers, or a stale plan | `unavailable`, `plans: []` |
| An active run | `busy`, `plans: []` |
| Uncertain termination, or a retained-but-unmarked allocation | `maintenance-required` (only integrity-verified summaries, if any) |
| Two published plans already | `at-capacity` |

Read every returned plan bounded to 64 KiB, verify its exact marker SHA-256, use the existing `summary()`, and order by marker timestamp plus id. Never return raw path, marker, intent, subject, error text, or counts of unsafe entries. GET never deletes, moves, retires, or reclaims plans, and never clears an uncertain-termination state. A GET with a query string or body is rejected with `400`.

GET remains readable through a frozen/degraded fleet. Inherited Origin/session/read-rate limits always apply. The registrar stays inside the existing authenticated child; only this exact GET route is exempted from the child's new-work hook — every mutation still goes through that gate.

## POST (unchanged DTO, optional scope header)

The POST body remains absent, with the existing `Idempotency-Key`. Add an **optional** `X-Figment-Intent-Scope` header: if supplied, it must equal the current `requestScope` before any allocation or replay; a mismatched or malformed value returns a fixed `409 intent-scope-conflict`. Existing controlled clients that omit the header keep their existing behavior. All new browser calls must supply a verified scope. The existing POST DTO and subject-bound intent hash are otherwise unchanged.

## UI: Plans view

On mount, and on auth-token or fetch-impl change, perform a GET using the existing `requestOptions(token)`. Cancel or ignore stale responses.

Durable resume record, stored in `sessionStorage` under `figment.studio.genPlan.pending.v1`:

```text
{ schema: 'figment/studio-gen-plan-pending@1', requestScope, key }
```

- Validate the exact keys, size, hex format, and key regex. Never store token, subject, path, or plan payload.
- Save the record, then read it back, before POST.
- If storage access fails, the record is malformed, or an existing record belongs to a different `requestScope`: block the mutation with fixed, useful error text. No memory-only fallback, and no silent discard or replacement.
- On an unknown GET result, malformed data, or server failure, block new prepare requests.
- An existing pending record for the same scope requires an explicit "Resume preparation" click — never an automatic POST on mount.
- Preserve the same key across `503`, `429`, `409`, network errors, and malformed `200` responses; error copy stays fixed.
- Remove the pending record only after a valid, successful POST. If removal fails, retain the state and the same key; do not start a new intent.
- A token change invalidates `requestScope` until a fresh GET runs. Never let an old async success clear a newer pending record.
- Multiple click guards must use a synchronous ref plus state, so only one intent is ever in flight.
- Re-read storage immediately before POST to catch races; the server's `X-Figment-Intent-Scope` check rejects auth changes.
- Per-tab `sessionStorage` is appropriate. The same pending record across a cloned tab safely replays the same key.

Display: verified stored-plan summaries and status, plus a Refresh-status action. No auto-POST. "New Prepare" is available only when `preparation` is `available`. A same-scope pending record may replay while `at-capacity` or `maintenance-required` (the server still enforces the latch); disable it while `busy` or `unavailable`. Keep the existing offline tester preview. No launch, approval, or cleanup controls, and no claimed capacity recovery — this slice is discovery and request-resume only. Displayed plans/status are graph/metadata authority snapshots, not a live-validity claim.

## Tests

- Exact producer POST -> GET DTO -> restart -> same-intent replay, with no second runner.
- Absent-root GET has zero effect.
- Orphan, uncertain-termination, busy, at-capacity, stale-bytes, symlink, and malformed-marker cases all fail closed.
- Scope mismatch allocates nothing.
- An authenticated frozen/degraded fleet leaves GET visible while POST is refused.
- Origin/session/read-rate limits are preserved; no raw fields leak.
- The existing real default Windows planner fixture extends to a positive GET, then a stale approval still refuses the consumer.
- UI: persist-before-fetch; remount after a lost success still recovers the same key; storage get/set/remove failures and corruption are handled; auth-scope change or a late-arriving fetch causes no key loss; malformed `2xx` and other failures repeat the same intent; no auto-POST; capacity/maintenance states allow no disallowed mutation; error copy is fixed.
- Run the meaningful affected tests plus typecheck/build, an independent Opus code/security review, and a source/browser join review. No provider calls occur.

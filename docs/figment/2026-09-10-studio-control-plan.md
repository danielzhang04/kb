# Studio control decision: durable generation-plan preparation

## Decision

Do not expose a durable Studio plan action until the existing `gen` consumer
revalidates current upstream checkpoint authority. After that prerequisite is
independently reviewed, add one provider-free, governed preparation action:

```text
POST /api/figment/studio/gen-plan
Idempotency-Key: <32-64 random base64url characters>
body: absent
```

The server fixes creator `creator-001`, stage `gen`, and every path, budget and
ledger input. It invokes only the existing planner:

```text
figment_train.py plan --creator creator-001 --stage gen --out <stable server directory> --ledger-dir <configured ledger>
```

It never passes `--skip-pin-verify`, launches a pod, uploads a checkpoint,
creates a ruling, selects a checkpoint, accepts media, or exposes a launch
button. A prepared plan remains only an unreviewed, unlaunched snapshot for the
separately authorized existing `run --stage gen --plan ...` consumer.

The current creator's attributed tester all-cull has no selected checkpoint
([delivery plan:28](2026-09-09-end-to-end-delivery-plan.md#L28)). The action
therefore has no successful real-world input today and must write no fixture
approval to simulate one.

## Source findings that change the first design

`_planned_run` stores absolute manifest and output paths in the plan argv
([figment_train.py:1667](../../orgs/figment/pipeline/figment_train.py#L1667)).
`run_planned_stage` recomputes those argv against the plan's actual directory
and rejects any difference ([figment_train.py:2486](../../orgs/figment/pipeline/figment_train.py#L2486)).
An isolated accepted-checkpoint fixture compiled a real `gen` plan, renamed its
tree, and failed before the fake harness with `planned run field 'argv' no
longer matches the bounded harness command`. Evidence:
`_private/figment-studio-control-plan-probe-20260910-v1/result.json`.

The same fixture deleted the source tester `approval-lineage.json` after a
stable plan was built. `_install_stage_config('gen')` then checked only the
staged checkpoint's bytes ([figment_train.py:2271](../../orgs/figment/pipeline/figment_train.py#L2271))
and reached the non-provider harness seam. A durable plan presently preserves
staged-byte integrity, but does **not** prove current persona, selected
checkpoint, or tester approval remains valid. The probe made no provider call.

`generated_utc` is part of every plan ([figment_train.py:1840](../../orgs/figment/pipeline/figment_train.py#L1840)),
so raw plan SHA-256 cannot be an idempotency key. Pin verification also happens
before checkpoint staging ([figment_train.py:1741](../../orgs/figment/pipeline/figment_train.py#L1741))
and the CLI has only its generic nonzero/`STOP:` interface. The HTTP layer must
not infer a trusted missing-vs-stale checkpoint classification from child text.

## Prerequisite completed before endpoint work

The prerequisite made and independently reviewed a narrow existing-consumer change: before a
`gen` plan's `run_planned_stage` reaches `apply_job`/the harness, reload the
current plan-bound persona and training authority, revalidate the currently
selected tester checkpoint and approval lineage, compare that current projection
with the plan's captured training projection, then retain the existing staged
checkpoint hash check. It must fail before the harness for deleted/replaced
approval, selection, persona, source plan, or checkpoint bytes. It must not
rewrite argv, introduce a runner, or accept historical diagnostic evidence.

The prerequisite needs a real accepted-checkpoint fixture with mutation tests
and an independent security review. Until it exists, the Studio endpoint is
**not ready**; the route cannot claim that later upstream revocation is covered.

## Durable control contract after that prerequisite

Allocate a random opaque `planId` before compilation under the fixed root
`<server-worktree>/_private/figment-studio/gen-plans/<planId>/`; compile directly
there and never rename that tree. After bounded reread of `plan.json` confirms
one `gen` run, a finite ceiling at most $50, and the expected creator/schema,
create `published.json` with exclusive create plus fsync. The marker, written
last, carries only `planId`, raw plan SHA-256, request-key SHA-256, and creation
time. It is the atomic publication boundary; an unmarked directory is not a
plan a later request or UI can retrieve.

The request key is required and canonical-body-free. The server stores only its
SHA-256 in the marker. A matching published marker returns the same bounded DTO;
a key already active returns `429`; a reused key with mismatched marker data
returns `409`. Raw plan hashes are evidence values, never identifiers, because
timestamps make identical source inputs produce distinct plan bytes.

Reserve at most two published plans, 256 MiB per tree, and 512 MiB total across
the fixed root. Check capacity before allocation and measure again before the
marker. The route may remove only its own current, unmarked directory after a
failure; it never auto-deletes a published plan. At capacity it returns a
generic `503 preparation-unavailable` for explicit operator maintenance.

Pass a single configured, server-owned ledger directory to the planner. Validate
it at boot and freeze its absolute value in the plan; neither client data nor a
different worktree's environment may select a ledger, ceiling, or arc cap.

Return only `{schema, id, status:"prepared", creator:"creator-001",
stage:"gen", runCount:1, declaredCeilingUsd, planSha256}`. Never return an argv,
prompt, source paths, checkpoint names/digests, raw plan, pin result, or child
error. A nonzero child, timeout, output cap, unsafe path, malformed output, pin
failure, or current-lineage refusal returns the same generic `503`; no HTTP
contract promises a false `409` classification.

Register inside `registerWriteSurface`'s authenticated child, which already
applies Origin/Host guard, write rate limiting, and `requireSession`
([surface.ts:578](../../dashboard/server/http/surface.ts#L578)). Reapply the
route session prehandler, audit only a newly published marker with the session
subject and opaque id, and use the existing bearer-plus-Origin boundary. No new
server, scheduler, state machine, CSRF scheme, or direct launch route is needed.

## Why not the other small controls

| Choice | Result |
| --- | --- |
| Video candidate/temporal review | Requires a current approved `gen` still; none exists, and video review preparation is separately in design. |
| Rulings UI / `apply-rulings` | Becomes an acceptance authority and can select a checkpoint; defer to a dedicated human decision design. |
| Content-brief preparation | Provider-free and bounded, but the existing hub consumes recorded snapshots only and explicitly does not revalidate sources ([contentBriefs.ts:161](../../dashboard/server/figment/contentBriefs.ts#L161)). It is a good later planning-editor control, not a substitute for the next media producer/consumer boundary. |
| Path-preserving `gen` plan preparation | Reuses the existing producer and future consumer, but only after the explicit current-authority prerequisite above. |

## Implemented preparation scope

The independently reviewed `gen` authority prerequisite landed in `d73d852e`.
This control adds `dashboard/server/figment/studioGenPlan.ts` and its tests,
registers the route only within the existing authenticated write child in
`dashboard/server/http/surface.ts`, and adds prepared/refused text in
`FigmentWorkspace.tsx`. It makes no `index.ts`, pipeline runner, harness,
spend, selection, ruling, or approval-writer change.

The server accepts no body and only a 32–64 character opaque idempotency key.
It allocates a UUID directory before invoking the fixed current planner, reads
at most 64 KiB of `plan.json`, checks the one-`gen` schema and a ceiling no
higher than $50, then writes and syncs a marker last. It limits preparation to
one active child, two published plans, 256 MiB per tree and 512 MiB total. The
child is capped at 30 seconds and 16 KiB output. A failure removes only the
route's own unmarked directory and returns a generic error.

Focused proof covers fixed planner arguments and ledger, no pin-verification
bypass, marker replay and stale-marker conflict, single-flight, capacity,
unsafe entries, generic child failure, Origin/session refusal, and the minimal
prepared-plan UI. The existing pipeline's real accepted-checkpoint producer to
consumer fixture remains the authority proof; the current creator has no
selected checkpoint, so this control does not fabricate one or claim a live
prepared plan.

Test fixed argv with no `--skip-pin-verify`, session/origin refusal before spawn,
request-key reuse/conflict, single flight, link/reparse refusal, marker-last
visibility, capacity/failed-current cleanup, DTO/UI omission, configured ledger
pinning, generic child failures, and the real accepted-checkpoint planner to
consumer join. Run focused tests, the prerequisite mutation suite, typecheck,
build, and independent integration/security review. Fixture success creates no
creator-001 quality, approval, spend, or publish claim.

Sources: [MANDATE.md:49](../../orgs/figment/MANDATE.md#L49),
[stage coverage audit:16](2026-09-10-stage-coverage-audit.md#L16),
[plan preview:140](../../dashboard/server/figment/planPreview.ts#L140), and
[content brief compiler:397](../../orgs/figment/pipeline/content/content_brief.py#L397).

## Current status — 2026-09-11

This Studio control (Windows Job Object execution, stale-authority refusal, capacity/marker handling, and UI request-key retry) is part of the bounded repair diff reviewed and found READY; see the [repair checkpoint review](2026-09-11-repair-checkpoint-review.md) for current test evidence and reviewer scope. This does not claim deployment, launch/review controls, or production quality acceptance.

The design sections above (decision, source findings, prerequisite, durable control contract, and implemented preparation scope) remain the authoritative contract. The "Root verification checkpoint — 2026-09-10" evidence that previously appeared here is superseded and removed; treat it as history from before the 2026-09-11 repair review.

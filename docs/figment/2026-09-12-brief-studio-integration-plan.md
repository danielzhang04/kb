# Brief revision Studio integration plan

This follows acceptance of the standalone route and its real temporary-repository publisher/reader join. It does not authorize an unreviewed shortcut around those checks. The deliverable is an explicit local planning revision in Research, with visible uncertainty after an unsuccessful submission. It does not launch generation or publish content to a platform.

## Server composition

Modify only `dashboard/server/http/context.ts`, `dashboard/server/http/surface.ts`, their focused tests and the exact root `.gitignore` rule needed by the allocation. Add a dedicated optional `figmentContentBriefRunProcess` seam matching the existing contained capture runner; pass it through `makeSurfaceContext` and into the new registrar. Keep production Python resolution and the real collector as defaults. Do not reuse the video-reader seam or introduce an environment bypass.

Mount `registerFigmentStudioContentBrief` inside the existing authenticated Studio child, beside the plan and video-reader registrars. Its POST must inherit origin, operator write-rate, session, new-work admission and fleet preamble checks. Keep its own session pre-handler. Do not add a discovery exemption for this POST or broaden the two existing exact GET exemptions.

Supply the required callback using `auditFn(ctx)`, with action `figment-content-brief-revise`, verified owner, derived brief ID as target, risk tier T1, result `published`, and only base ID plus brief hash as detail. Thread the existing audit git/time options. The callback must be awaited; an audit failure cannot become an HTTP success. This is a record of a local planning revision, not approval of media or external publication. Do not inspect historical audit rows as part of testing.

Ignore exactly `/orgs/figment/content/.studio-revision-active/` so ephemeral edits/recovery are never broadly staged. Do not ignore final brief artifacts or all content. Retention and operator inspection remain meaningful even when the allocation is ignored by Git.

Tests must exercise the real outer guards and registrar over synthetic temporary roots: refused origin/auth/rate/admission/preamble must not allocate or invoke the process; successful fixed publisher/reader fixtures audit exactly once; audit failure returns unavailable and retains recovery. Prove the dedicated seam is used and unrelated video-reader configuration remains independent. Use existing surface test helpers and guarded temporary cleanup; no real git, network, provider or project writes.

## Research form

After server wiring acceptance, author a small isolated form component and independent tests, then mount it in the existing Research panel. Use the current recorded creator-001 briefs as selectable base snapshots. Require date, normalized slug, hypothesis and intended metric; label the operation as creating a new local planning revision. Show that the base is preserved and the server checks current inputs before creating the revision.

Only explicit submit sends POST. Navigation, mount, refresh, token changes and a failed response must never send or retry it automatically. Disable duplicate submission while pending. Ownership of in-flight responses must be tied to the current token, selected base and component lifetime, so a stale completion cannot overwrite newer state. Invalidate or abort old requests without claiming that abort cancels server publication.

Decode only the exact success DTO, with safe normalized ID and lowercase hash. Render fixed user-facing error text, never raw server text, paths or child logs. After any transport loss or ambiguous failure, explain that the outcome is unknown and inspection is required; do not imply a retry is safe. A later existing-ID conflict is not proof that the earlier request succeeded. Display success as local planning creation only, with the returned brief ID/hash and a separate explicit refresh of the recorded inventory.

Test request bounds, explicit-submit behavior, double click, token/base changes, unmount, stale success/failure, malformed/oversized response, server guard refusals, ambiguity messaging and no automatic retry. Reuse accepted request limits; avoid introducing a second semantic compiler. Keep implementation details out of the ordinary form unless needed to understand recovery.

## Acceptance and documentation

Each slice receives independent review before focused execution; preserve failed runs and correct demonstrated defects. Run relevant unit/integration suites, typecheck and build when the UI is composed. Verify the rendered form and one synthetic submit/result journey in the already established isolated local browser setup, with root inspection of saved evidence. Do not repeat the earlier browser experiments or claim live backend/authentication from a mocked preview.

Update the operator guide, tasklist, book current summaries and canonical handoff only with accepted outcomes. A full real operator journey and actual creator media quality remain distinct unfinished requirements.

# Governed brief revision route - implementation plan

The next slice adds one local Studio POST that revises an existing creator-001 planning brief, validates the final pair through the existing Python authority, audits the action and cleans its owned allocation before reporting success. The thin read-only adapter is accepted at `722912f1`: 12/12 focused tests, native exit 0, independent source review and eight unchanged retained inputs. Shared `content_brief.py` remains unchanged.

The route is not implemented or accepted at this planning checkpoint. UI wiring, a usable browser session, actual media, publication and paid operations are separate work.

## Fixed contract

- Endpoint: `POST /api/figment/studio/content-brief-revisions`.
- New registrar: `registerFigmentStudioContentBrief` in `dashboard/server/figment/studioContentBrief.ts`.
- Exact body: `baseBriefId`, `briefDate`, `slug`, `hypothesis`, `intendedMetric`.
- Base ID uses the existing normalized lowercase/hyphen grammar, at most 128 UTF-16 units. Do not invent a mandatory date/creator prefix for an existing base.
- Date is a real ISO date. Slug is normalized lowercase/hyphen text; derived `<date>-creator-001-<slug>` must fit 128 units.
- Both editable text fields are nonempty, already trimmed, well-formed UTF-16 and at most 4,096 units, with no controls.
- Body limit is 65,536 bytes so escaped valid text fits. Malformed body returns fixed 400; oversized body fixed 413; busy 429; absent listed base 404; unavailable collector 503; a safe target already present before launch 409. A racing target during the child is an ambiguous failure, not an inferred conflict or replay.
- Success is exactly `{schema:"figment/studio-content-brief-revision@1",status:"published",briefId,briefSha256}`. No raw request, paths, notes, child output or dependency contents.

## Existing authorities and interfaces

The registrar has its own session pre-handler. Later surface integration must mount it inside the existing authenticated Studio child with origin, write-rate, admission and preamble gates; it is not a discovery-GET exemption. Use the actual `requireSession` and `verifiedSession` exports in `http/middleware.ts`.

Use the current `collectContentBriefs` only to list a creator-001 base. The collector is a snapshot, not current-source proof. The sole publisher remains `content_brief.py --revise-base`; the sole final validator is exposed by accepted `content_brief_read.py`. Do not duplicate either in TypeScript or change the shared compiler pin.

Use the existing `runStudioPlanProcessCapture` and its ownership/timeout/output-limit behavior for two sequential fixed commands, each with `-I -B`, 30-second timeout, 16-KiB combined output cap and hidden window. The first invokes the publisher; the second invokes the reader over the derived final request and brief. Ignore publisher stdout. Decode reader output with fatal UTF-8, an exact schema/key/hash contract and canonical JSON byte equality.

Server/test options follow the reviewed checklist: fixed `repoRoot`, `sessionConfig`, optional existing process/collector/Python resolver/platform/time seams, and required `auditPublished(subject,{baseBriefId,briefId,briefSha256})`. The narrow Python resolver seam defaults to existing `resolvePython`; integration supplies an explicit absolute interpreter. Do not parse a test environment variable in production code. Verify the actual production interpreter separately before describing a working operator journey.

## Ownership and outcome

Acquire the fixed `content/.studio-revision-active` directory with nonrecursive exclusive creation. Keep exact `edits.json` and `recovery.json` files; fsync both before the publisher may start. The recovery record contains only a schema, unclaimed-outcome status, validated base/derived IDs, edits digest and UTC timestamp. It is a durable marker, not a publication claim.

Record and recheck canonical root/directory identities and regular file handle/path identities. Use compatible fields: dev/ino/size/mtime for files, stable dev/ino/realpath for directories. Avoid speculative cross-API ctime checks. Reject foreign, linked, unexpected or changed entries; never recursively delete or scan publisher-owned sibling staging.

Before launch, cleanup may remove only positively owned entries. Once the publisher may have started, every failure is publication-ambiguous until the final validator succeeds. Preserve the fixed allocation and set the in-memory recovery latch on child, validation, audit, identity or cleanup uncertainty. This rule applies even when termination is confirmed. Never recreate a recovery file through an unsafe path.

Keep the allocation through final validation and audit. Await identity-checked, exact-entry, nonrecursive cleanup before success becomes observable. On any failed or uncertain step, retain what remains, return fixed unavailable and require operator inspection. A restart discovers the retained allocation; an in-memory latch alone is insufficient. A client may lose a response after server success, so it must not infer failure or auto-retry. A later conflict does not establish same-request provenance.

## Build and review sequence

1. Author the standalone route and independent unit tests in separate workers. Root reviews complete files; independent source/security review follows before execution.
2. Run focused route tests over frozen named inputs. Preserve first failures and correct only demonstrated defects.
3. Add a real temporary-repository publisher/reader/collector join using the default contained runner and explicit Python. Use synthetic persona/reference bytes, original compiler/template sources, no skips or real project writes. Preserve failed fixtures; verify ownership before successful cleanup.
4. Wire the accepted registrar into the governed surface with dedicated tests. Then add the small explicit-submit Research-panel form and its tests. No automatic POST or retry on navigation/refresh.
5. Verify actual rendering when the browser environment permits it, and update the operator guide and canonical handoff with honest evidence limits.

Supporting local design artifacts: `MAIN/_private/figment-brief-editor-current-gap-design-20260912.md` (SHA `9d6b00c38877f94d87d796123f00ff950c64f7fe1f31363aefa7ccd9bc07d99c`), its independent review, and `figment-brief-route-implementation-checklist-20260912.md`. This plan supersedes conflicting checklist body-limit, base-ID, response-code and recovery-latch details. MAIN is `C:/Users/danie/kb`. The unrelated September 11 input-plan draft remains historical and must not be implemented unchanged.

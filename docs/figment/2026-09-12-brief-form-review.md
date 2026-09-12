# Isolated brief revision form acceptance

The isolated form and shared response decoder are accepted. The form sends one explicit local-planning POST, validates bounded fields, rejects stale responses, preserves uncertainty when publication cannot be confirmed, and offers a separate explicit parent refresh. It is not yet composed into Research or visually accepted.

Root reviewed the complete source and independently authored tests. Independent source review is READY with no findings: `MAIN/_private/figment-content-brief-ui-independent-review-20260912.md`, SHA `a215151a288cdb049d50418b87a46e0a48fec30635a3d4c901245fa08c93d41c`.

Accepted source/test pins:

- `dashboard/shared/figmentContentBriefRevision.ts`: `dc486ccfe24e8ee13e2319e6950e486a68e280094979fbca2b8c7293f7d509ef`.
- `dashboard/src/figment/ContentBriefRevisionForm.tsx`: `65c0b25756f822204c0dac446990207a95585219449e070ed6d39e01795cb49b`.
- `dashboard/src/figment/ContentBriefRevisionForm.test.tsx`: `74066c59108e05cdd0c1ab4ecd9138201308e5db346fde74b2adf60ca35f5441`.
- `dashboard/src/figment/figmentContentBriefRevision.test.ts`: `43d9291130b0dc87a82029046bd88b908abbe61782e34616c68ad6ffc9d923b3`.

The form checks exact current token/fetch/base ownership during render and completion, including immediate base disappearance before passive effects. An epoch and synchronous request guard prevent stale completions and duplicate submits. A mount-lifetime publication lock prevents a repeated POST after success, conflict, missing base or ambiguity; changing fields/base/session does not clear that lock. Abort is client cleanup, with no cancellation or rollback claim. A separate synchronous refresh guard calls the parent exactly once.

The response decoder requires a plain object with exactly the schema, published status, locally expected normalized ID and lowercase SHA-256. The4096-character response limit applies to accepted decoded text after Response.text(), not downloaded bytes. Errors use fixed copy. This client does not duplicate server compilation or current-source validation.

## Verification

One v1 invocation ran09:40:01–09:40:53UTC with native exit0:47/47 actual form cases passed. One subsequent TypeScript noEmit check ran09:41:09–09:41:11UTC, native0. Root parsed the reporter and checked15 unchanged before/after named pins; live retained inputs and the subsequently moved decoder test's preserved pre-run bytes were checked against those pins. Exact four-file pre-run copies remain. This is finite evidence, not full dependency closure.

V1 requested both suites, but the repository's Vitest include list excludes shared/. The reporter contained only the47 form cases. The decoder test was relocated into the existing src/figment discovery path, without changing configuration. Root verified its only content change was the relative import. A single missing-suite v2 run at09:44:25–09:44:27UTC passed16/16 decoder cases, native0, with six unchanged before/after/current inputs independently checked. The form was not rerun. These are63 distinct passing cases across separate invocations, not a combined63-case suite. Typecheck predates the test relocation; the subsequent composition check will cover that path.

Coverage includes exact DTO/ID/hash bounds, malformed and extra-field responses, input limits, exact request/auth/signal, duplicate clicks, StrictMode, fixed status/privacy copy, transport and synchronous fetch failure, explicit refresh, mounted ambiguity and stale resolve/reject across base/token/fetch/list/lifetime changes. A layout-effect observer verifies that stale established results disappear before passive cleanup.

Evidence roots are `MAIN/_private/figment-content-brief-ui-verification-20260912-v1` and `...-v2-decoder`. V1 reporter SHA `6220e2fe01d38d241e896d4404644c7dada1ae3769f01e06e8655fba07e64336`; final receipt SHA `05a637eb5931390eb0e75b4ad48cd4c097783d2cb42aa337c1e834cf3e9e8de1`. V2 reporter SHA `ab5b7b57f84e10fbf69d3abbe828880ba5f746f1ed661fb9f231ed0ec88426cb`.

The worker initially misclassified a still-running v1 command from an interim file/process snapshot. Original notes remain, explicitly superseded by the actual later completion and native0 record; no retry occurred. Before execution, review corrected draft ownership/refresh/synchronous-failure handling and invalid test mocks/selectors. The reviewed pre-fix test candidate is preserved. No product runtime test failed in these two invocations.

Next: compose the accepted component into Research with the existing parent GET owner, independently verify the join, typecheck/build, then inspect the prepared synthetic browser journey. No live backend/authentication, real media, provider, paid action, deployment or external publication is established here. MAIN is `C:/Users/danie/kb`.

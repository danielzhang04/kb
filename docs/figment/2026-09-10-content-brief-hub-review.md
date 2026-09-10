# Content-brief hub review — 2026-09-10

## Verdict

**READY** for the local, read-only content-brief projection and Research-tab
display. This verdict covers only bounded offline planning snapshots. It does
not revalidate a brief's source inputs, create media, publish content, evaluate
audience results, select a checkpoint, or establish any production acceptance.

## Reviewed files

| File | SHA-256 |
| --- | --- |
| `dashboard/server/figment/contentBriefs.ts` | `70c07797a99f7ecc5256397dbb8f174222100cbb7d582a05058c8a2a44e8a804` |
| `dashboard/server/figment/contentBriefs.test.ts` | `1021b495b4db4398a0a6dbb231531930e90596d149f889e94ae60c69d83274ce` |
| `dashboard/server/figment/routes.ts` | `ccdcc36e457db65cbe3b9304111988230ffd044d43f5e57dec51d0d67b4f6095` |
| `dashboard/server/figment/routes.test.ts` | `43c75e9d793fd9b3c49391ab5e9caba06427ec75bec45914c96bc5aa69ffee60` |
| `dashboard/src/figment/FigmentWorkspace.tsx` | `3923a3a979d1497d3fb375600004eded54c6bf673e338dc0a87ab57a56953cac` |
| `dashboard/src/figment/FigmentWorkspace.test.tsx` | `77c92c7dd69532fcc5ea7e0a72b7fb42b72c9114508aa658cd08d6157820a26b` |
| `docs/figment/2026-09-10-content-brief-hub-plan.md` | `f8b7e27a1b4450928b7d55664216fd32f78b9fba8570d0df925cb5ad02552c2a` |

## Findings

The collector reads only the fixed one-level brief inventory, applies bounded
and depth-first JSON validation, rejects links and junctions, and fails closed
on malformed records, approval/publication-bearing keys, and non-null observed
metrics. Its projection intentionally omits citations, hashes, source paths,
and arbitrary record fields. Recorded and empty responses identify planning
snapshots and state that current sources were not revalidated.

The route adds the projection as an optional response field, so older hub
payloads remain readable. The client validates the bounded projection shape and
renders hypotheses as React text, which keeps markup inert.

During review, date-only rendering initially parsed `YYYY-MM-DD` as UTC
midnight and localized it. In America/New_York, that changed `2026-09-08` to
September 7. The final client renders the validated source date directly, and
the regression asserts `2026-09-08` remains visible. This review reran that
targeted UI test successfully:

```text
cd dashboard
npm test -- --run src/figment/FigmentWorkspace.test.tsx -t "renders a recorded brief as inert text"
# 1 file passed; 1 test passed, 29 skipped
```

Author-provided final evidence records 56 passing focused tests across the
three affected suites, passing typecheck and production build, plus a local
read-only hub probe with one brief and 47 research artifacts. The captured
evidence is in `MAIN/_private/figment-content-brief-hub-20260910-v1/phase2-*`.

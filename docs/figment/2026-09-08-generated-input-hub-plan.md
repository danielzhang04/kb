# Generated-input hub plan

## Purpose and boundary

Add one read-only Figment inventory for the four current generated-input
experiments, displayed beside the existing declared `creator-001` references.
It lets an authenticated studio user inspect each candidate's image, immutable
provenance fields, and recorded visual-review observations. It does not create
datasets, change eligibility, write a review, start a job, or treat a visual
review as approval.

The only admitted source is a single server-configured directory:

```text
C:\Users\danie\kb\_private\figment-single-seed-20260908
```

`dashboard/server/index.ts` should accept one optional
`figmentGeneratedInputRoot` and default it from
`DASHBOARD_FIGMENT_GENERATED_INPUT_ROOT`, then pass it to the existing
`registerFigmentRead` registration. The browser supplies no root, path, prompt,
or selector. A missing or unsafe root yields an unavailable empty inventory,
not fallback filesystem discovery.

## Current source contract

The fixed root currently contains these four PNG/provenance pairs among other request artifacts:

| Candidate | PNG SHA-256 | Provenance review status | Training result |
|---|---|---|---|
| `g01-frontal-black-tee-v1` | `6fdcf4aba25a286afbed1872e4d2bc3f4e6ac1e5451e065ce501cf00c69fbe35` | `rejected-as-sufficient-identity-training-input` | unavailable; role wording also fails first-generation validation |
| `g01-wardrobe-only-black-tee-v1` | `e33f2d0c396e4e0f7eed49240271d972d36bdafa2a6f27ef04dcfaaf3cf6f6a2` | `experimental-independently-observed-not-training-approved` | unavailable (`training_eligible: false`) |
| `g01-small-head-turn-charcoal-tee-v1` | `55e60a741ff1e4be78cccde7a807ca8ff9e261cd4b3ab1131bb3060b38961dcb` | `experimental-unreviewed` | unavailable (`training_eligible: false`) |
| `g01-e01-shoulders-up-v1` | `ab8a6830e17ea9d215826f886ac0d654e09e47a6795f2af66289929ce21518a5` | `experimental-unreviewed` | unavailable (`training_eligible: false`) |

The canonical comparison is the existing declared
`orgs/figment/personas/creator-001/anchors/g01.jpg`, SHA-256
`e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed`.
The inventory must compare each provenance record's source hash with the current
fixed g01 bytes before displaying that declared association. It must not infer that a
candidate is an accepted reference or that visual similarity is identity proof.

Each candidate requires a same-stem `.png` and `.provenance.json`. Parse only
`figment/generated-input-experiment@1` records whose `creator` is
`creator-001`, whose `output.file` is that opaque basename, and whose
`output.sha256` equals a freshly bounded hash of the PNG. Project only bounded
fields required for inspection:

```ts
interface GeneratedInput {
  name: string; bytes: number; sha256: string; width: number; height: number;
  sourceReference: string; sourceSha256: string;
  generatedOn: string | null; reviewStatus: string;
  visualReview: { adult_presentation?: string; clothing?: string; identity?: string;
                  realism?: string; coverage?: string; independent_findings?: string; };
}
```

Do not return `operator_approval`, reviewer identities, prompt text, provider
request data, eligibility booleans, or any raw JSON. The review status and
bounded observations are evidence only; the UI has no approval badge or action.

## Small API extension

Add `dashboard/server/figment/generatedInputs.ts` with the same fixed-root
discipline already used by `references.ts` and diagnostic assets:

- Open only the configured root; reject missing roots, symlinks, and Windows
  junction/reparse components before traversal.
- Enumerate at most 34 physical directory entries plus one overflow probe,
  independently of validity. Physical overflow makes both projection and direct
  reads unavailable. Display at most 16 valid pairs, with a validated seventeenth
  pair establishing truncation. Accept PNG only, at most
  8 MiB each and 64 MiB in total; provenance JSON at most 128 KiB. Use bounded
  stable reads, SHA-256, real PNG header dimensions, and the existing 32M-pixel
  ceiling.
- Select membership before opening an image. Ignore malformed, unmatched, or
  hash-mismatched pairs rather than inventing a record. Set `truncated` only
  when more valid directory entries remain beyond the cap.
- The binary reader uses bounded name enumeration and revalidates only the
  requested pair and caller-provided projected SHA. It must not invoke the
  full projection or hash sibling PNGs for each requested image.
  It returns `image/png` with `X-Content-Type-Options: nosniff`; changed or
  missing bytes return stale/not-found, never a substituted image.

Extend the existing `figment/hub@1` projection with:

```ts
generatedInputs: { available: boolean; items: GeneratedInput[]; truncated: boolean }
```

Register one authenticated endpoint under the current Figment read scope:

```text
GET /api/figment/generated-input-assets/:name?sha256=<projection hash>
```

Reuse the current session and same-origin guards already applying to
`/api/figment`, `/reference-assets`, and `/diagnostic-assets`. It receives an
opaque exact PNG basename, never a filesystem path. There are no POST routes.

## UI and tests

Extend the existing `Assets` panel in
`dashboard/src/figment/FigmentWorkspace.tsx`. Keep `Declared persona references`
as its current section and place `Generated-input experiments (unapproved)`
below it. Label this fixed inventory explicitly as `creator-001`, independently of the declared-reference selector. Identify `g01.jpg` as the provisional canonical comparison
with its existing declared-reference label; show the other persona references as
comparators. Then render the fixed inventory thumbnails, filename, dimensions,
declared source reference/hash, review status, and concise visual-review text.
Label `generation.date` as the generation date, not an inferred review date.
Recorded review declarations are snapshots and may precede later independent
reviews in the book; their pending text must not be presented as a universal
current verdict. Use the existing authenticated object-URL fetch pattern, bounded parallel fetch,
and URL cleanup on update/unmount. Do not add buttons that mutate review,
eligibility, datasets, plans, or runs.

Add focused server/UI tests for: authentication and same-origin behavior;
configured-root absence; pair/schema/output-hash mismatch; traversal, symlink,
junction, per-file/aggregate, and exact-17 truncation; stale requested hash and
same-size replacement; no leaked approval/prompt fields; only requested-image
reads; thumbnail URL cleanup; and visible canonical/comparator/unapproved
labels. Use real PNG fixtures and the actual current-record shapes, but do not
present test fixtures as live evidence.

The current implementation target is visibility of the four unavailable
experiments. Creating a candidate, marking it eligible, building a curation
request, or training remains a later separately reviewed capability.

# Local-Comfy rejected-input adopter

`pipeline/expand/adopt_local_comfy_generated_input.py` is an offline evidence
copier for a completed local-Comfy diagnostic. Its default validates and prints
a plan. Only `--import` exclusively publishes one fresh PNG/provenance pair
into the fixed generated-input gallery root. It never starts ComfyUI, calls a provider, writes
an approval, changes eligibility, creates a curation request, or trains a
model.

The adopter reads one root-owned request basename from:

```text
C:\Users\danie\kb\_private\figment-local-comfy-generated-input-requests-20260908
```

The request selects one direct child below the fixed workspace private root and
one safe fresh PNG target below `figment-single-seed-20260908`; it cannot supply
an arbitrary filesystem path. The request must retain the exact raw hashes of
the local manifest, receipt, journal, dispatch marker, fixed640 observer
observation, and current canonical `g01`.

For V3, the request records `generation_date: "2026-09-08"` as root-observed
adoption metadata. The local receipt has no generation timestamp, so the output
provenance labels that basis instead of inventing a provider time. The adopted
record retains the manifest/receipt/journal/dispatch, prompt, workflow,
launcher, and three model hashes alongside its output hash.

Before either plan or import, the adopter requires a real non-reparse private
run root; `figment/local-comfy-input@1`; `diagnostic_only: true`; exactly one
dispatch; completed receipt and journal; verified teardown with no unresolved
process or teardown error; current sole `g01` source binding; a bounded,
decoded 1024-square PNG matching its receipt; and an identity observation that
binds the same PNG before and after observation. The receipt may carry an
established unavailable candidate state (`no face detected` or `multiple faces
detected`), or fixed640 one-face metadata with finite raw anchor cosines. Those
are immutable observation evidence, not an identity verdict, threshold, or
quality decision. It accepts only the fixed rejected status
`rejected-as-same-person-candidate` and `training_eligible: false` from the
root-owned request. Those fields are a declared review snapshot, never an
approval.

The emitted `figment/generated-input-experiment@1` record keeps canonical g01
ancestry. A direct V3 result is explicitly the first generated output from the
sole seed and not an independent view. A future crop request must bind the
canonical original-pixel hash, crop hash and rectangle, and a matching
materialized crop record in the local-Comfy manifest. It remains a crop
derivative, not an independently sourced view or a first-generation identity
positive.

Publication uses exclusive no-overwrite creates. The PNG is written first and
the provenance record is the visibility marker, so a failed second write removes
only the adopter-owned hash-matching PNG. An interruption after the PNG write
and before the marker can leave an unprojected orphan that requires explicit
safe root-owner recovery; it is never presented as a gallery record.

The current generated-input gallery already reads this exact provenance schema
through its fixed root, hash-bound projection and binary endpoint. No route,
auth, or UI expansion is required for the adopter. The gallery projects the
bounded date/status/visual-review fields and does not expose raw prompts or
approval fields. The provenance binds the immutable identity-observation file
SHA-256 but does not copy raw cosine values into the gallery record.

# Gemini image path readiness — 2026-09-08

## Scope and method

This initial non-executing readiness check searched checked-in code and non-secret
documentation, queried only the *presence* of three allowed ambient environment variable names,
and read current Google primary documentation. It did not open any `.env`, secret store, credential
file, browser profile, or account page; no key value was read, copied, or used. No image-generation request, image upload, installation, or spend action was run. A later parent-owned metadata-only GET is recorded below; it did not generate an image.

## What is present

`GEMINI_API_KEY` is present in this process environment. `GOOGLE_API_KEY` and
`GOOGLE_APPLICATION_CREDENTIALS` are absent. Presence is not a validity, entitlement, paid-tier,
or billing check.

There is an existing, tested dashboard server adapter at
`dashboard/server/control/paidActionProviders.ts`:

- Its ambient fallback resolves only `GEMINI_API_KEY`, in the dashboard daemon process, if a
  separate secrets-file path is not configured. The credential stays opaque to the caller.
- Its Gemini transport makes one `POST` to the Developer API `v1beta`
  `models/gemini-3-pro-image:generateContent`, sends inline PNG seed parts followed by prompt text,
  and requests a `2K`, `16:9` image response. It turns an accepted JPEG response into PNG before
  the paid-action service commits it.
- `paidActionService.ts` pins that operation to `gemini-3-pro-image`, reserves 134,000 microdollars
  per request, limits it to four PNG seeds of at most 8 MiB each, and journals its output hash.
  The operation is deliberately named `fyt.gemini-3-pro-image-2k` and its commit namespace is
  `orgs/faceless-youtube/channels/the-second-take/videos/`.

The existing adapter is therefore useful evidence of an ambient-runtime, server-side Gemini
capability. It is **not** a Figment image-generation route: its operation identity, output
namespace, spend-grant flow, and artifact ownership rules belong to Faceless YouTube. Reusing it
for Figment would be a new paid-action capability, rather than a configuration change.

## Figment provenance and provider record

Figment's identity specification calls the source batch `gemini-batch-01`; the research records the
three selected anchors as coming from an external Gemini/Nano-Banana batch. It does not record a
specific original model ID, API version, request, seed, or cost for `g01`. That gap must remain
explicit: `gemini-3-pro-image` would be a documented comparison model, not a demonstrated replay
of g01's original generation.

The canonical Figment g01 is a JPEG. Gemini's documented image-input support permits JPEG, so a
Figment implementation can bind and send that original file directly; it should not add a PNG
conversion solely to reuse the FYT adapter. The initial review found no Figment client or receipt
schema. The later bounded implementation is recorded below.

## Current primary-source record

Google's [Gemini 3 Pro Image model page](https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image)
lists the stable model ID as `gemini-3-pro-image` and supports image and text input with image and
text output. The [image-generation guide](https://ai.google.dev/gemini-api/docs/image-generation)
documents text-and-image-to-image editing and says Gemini 3 Pro Image can take up to five character
references. A proposed comparison should still supply exactly **one**: g01 alone.

Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) currently lists Gemini 3 Pro
Image Standard output at $0.134 for a 1K/2K image and image input at approximately $0.0011 each;
text input is separately priced. The official [thinking guide](https://ai.google.dev/gemini-api/docs/thinking)
states that thinking tokens are billed in addition to output tokens. A read-only model metadata
response for `models/gemini-3-pro-image` recorded `version: 3.0`, a 131,072-token input limit, and
a 32,768-token output limit, which differs from the public model page's 65,536 input limit. That
private response is retained as a separately hash-bound attestation for a later manifest. The present
ambient variable does not reveal billing or entitlement; a paid generation remains unattempted.

## Readiness verdict

**The initial repository state was not ready to execute for Figment.** The ambient credential
presence and existing FYT adapter made a future route technically plausible, but did not supply
Figment-specific spend, artifact, provenance, or admission controls. The bounded Figment-only CLI
added after this analysis implements those controls but remains unexecuted and awaits independent
review plus the root-owned admission/ledger record.

## Bounded comparison specification if a Figment route is later approved

This is a proposal for a future approved implementation, not a request to run it:

| Item | Fixed value |
| --- | --- |
| Provider and model | Gemini Developer API, `gemini-3-pro-image` |
| Input | One canonical g01 JPEG only; no g02/g07, generated candidate, chained edit, web grounding, or needless transcode |
| Output | One `2K`, `16:9` image; one provider attempt; one unique Figment-private artifact path; immutable request/response receipt with source, derived-input, and output hashes |
| Prompt | A bounded clothed-adult, ordinary-room comparison prompt; do not name a real person, request explicit material, or claim exact identity or age |
| Cost discipline | One call only. Reserve $4.60 from the full 131,072-input / 32,768-output / separate 32,768-thinking-token planning basis. This is conservative exposure planning, not a claim that an API parameter is a provider hard-cost cap or that an invoice will equal the reserve. |
| Required controls before any call | A Figment-owned receipt namespace; byte and path bounds; one-call and no-retry enforcement; an existing exact Figment ledger reservation counted once; a hash-bound model-metadata attestation; and the project admission record. |

The result would be an unreviewed comparison input only. It would not replace g01, prove source-model
equivalence, establish identity preservation, or promote any training or production state.

## Implementation update

`orgs/figment/pipeline/expand/gemini_input.py` now supplies the Figment-local client described
above. It defaults to an offline plan, pins canonical g01 and the frozen E01 prompt hash, binds a
whitelisted hash-checked model-metadata attestation, requires one existing $4.60 reservation row
already included in the daily and arc ledger totals, and writes an exclusive pre-dispatch journal
before its single non-redirecting request. It stores returned JPEG or PNG bytes unchanged with a
hash-bound receipt and preserves the full reservation on uncertain outcomes. It does not create a
ledger row, invoke the API during planning, or infer a provider invoice.

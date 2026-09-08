# Local matched diagnostic gallery

Add a small, read-only **Matched diagnostic pairs** section to the existing
Figment Asset review tab. It displays the recorded base and current step-20
images side by side for each fixed seed, together with the two recorded
diagnostic reviews. It is not part of Generated-input experiments and does not
make an image training data, an accepted reference, a quality result, human QA,
or a promotion.

The actual records establish two completed 1024×1024 pairs for seeds
`481516234` and `90210`. The base receipt is
`figment/local-lora-matched-runtime@1`, stage `base`, with no adapter keys; it
is the unconditioned matched comparator. The current receipt is the same schema
at stage `current-20`, binds the base receipt and both base PNG hashes, and
records 2,166 adapter keys. Neither render uses pixel conditioning on `g01`.
The current adapter was trained from the one-source `g01` quality recipe, which
does not turn the displayed base images into `g01` generations or either image
into eligible data.

## Server shape and bindings

Create `dashboard/server/figment/matchedGallery.ts` with:

```ts
interface FigmentMatchedGalleryRoots { base: string; current20: string; }
type MatchedGalleryProjection =
  | { status: 'not-configured' }
  | { status: 'unavailable'; reason: 'evidence-unavailable' }
  | {
      status: 'recorded'; historical: true; notPromotable: true;
      conditioning: 'no-pixel-reference-conditioning';
      pairs: Array<{
        seed: 481516234 | 90210;
        base: Asset; current20: Asset;
        reviews: {
          root: { base: Review; current20: Review };
          independent: { base: Review; current20: Review };
        };
      }>;
    };
```

`Asset` is only `{ assetId, sha256, bytes, width, height }`; it has no output
filename or filesystem path. `Review` contains the recorded disposition and
the seven bounded free-text fields (`realism`, `resemblance_to_g01`, `pose`,
`apparent_adulthood`, `apparent_age_fit`, `clothing`, `defects`). The reader
passes these strings through exactly after size/type validation; it never
summarizes or invents observations.

The two configured values are directory roots only. The reader opens exactly
these children and never enumerates a directory: `receipt.json`,
`review-root.json`, `review-independent.json`, and the two fixed output names
under `output/` (`figment-local-lora-matched_00001_.png` and `_00002_.png`).
Reuse the existing fixed-root safeguards: absolute-root validation, root and
ancestor reparse refusal, realpath containment, regular-file checks, bounded
single reads with post-read stat verification, JSON depth limits, and PNG
signature/dimension checks. Cap each JSON read at 256 KiB, each PNG at 8 MiB,
and the four images together at 32 MiB.

Validate both receipts as complete, non-promotable, verified teardown,
`figment/local-lora-matched-runtime@1`, and their exact stages. Require exactly
two ordered receipt rows: `base-seed-481516234`/`current-20-seed-481516234`
then the corresponding `90210` row, each mapping to its fixed output name,
1024×1024 dimensions, declared byte count, and fresh SHA-256. Reject an extra,
missing, duplicate, reordered, renamed, oversized, reparse, or changed image.
Require base adapter-key count zero and current count 2,166 with zero missing
LoRA-key warnings. Require the current receipt's raw base-receipt SHA and its
per-seed base PNG SHA map to freshly read base records.

For each fixed review file, require
`figment/local-lora-matched-pair-review@1`, its fixed stage and role, a
nonempty reviewer ID, raw receipt SHA binding, `not_promotable: true`,
`human_qa: false`, exactly the two ordered seed/output rows, and exactly one
bounded string observation object for each. Accept and display only the
recorded `continue` or `stop` disposition. The actual records show base root
and independent `continue`, current-20 root `continue`, and current-20
independent `stop`; this disagreement stays visible rather than being resolved
by the server.

Add `matchedGallery` to `FigmentProjection` in `routes.ts`; compose it in the
existing `buildFigmentProjection` and `registerFigmentRead` call. Thread an
optional `figmentMatchedGalleryRoots` through `BuildAppOptions` and two fixed
server environment roots, following the local-training composition pattern.
An absent setting projects `not-configured`; any partial, unsafe, or malformed
setting projects `unavailable`. Do not add a client path parameter or a new
write/action route.

Add one existing-read-scope asset route:

```
GET /api/figment/matched-gallery-assets/:assetId?sha256=<64-lowercase-hex>
```

`assetId` is one of four fixed application identifiers, such as
`base-481516234` and `current-20-90210`, never an output filename or path. The
route re-runs fixed membership/binding validation, opens only the requested
fixed PNG, and requires its fresh hash to match the projection hash. It returns
`image/png`, `nosniff`, and `no-store`; invalid selectors are 404 and stale or
invalid evidence is 409. The route remains inside the existing authenticated
read scope.

## Asset-review UI

Extend `Projection` validation in `FigmentWorkspace.tsx` so absent
`matchedGallery` normalizes to `not-configured`, while malformed nested rows,
hashes, dimensions, review fields, stage/seed combinations, or dispositions
reject the whole hub response. Add a `MatchedGallery` section beside declared
references, generated inputs, and diagnostic assets. For each seed, render a
two-column Base / Current step 20 pair using the existing authenticated
hash-bound image fetch pattern. On narrow screens, stack the two images.

Above the pairs, state: “Matched diagnostic only. Base used no reference pixel
conditioning; current step 20 applies a locally trained adapter and also used
no reference pixel conditioning.” State separately that neither image is a
generated training input, accepted reference, quality result, or promotion.
Show both reviewers' actual per-stage observations in collapsed details, with
their recorded dispositions visible. For the current pair this makes root
`continue` and independent `stop` visible together. Do not show prompts,
checkpoint/header details, receipt/admission identifiers, PIDs, logs, private
paths, source captions, costs, or a “next” control.

## Tests

`matchedGallery.test.ts` should cover the valid fixed four-PNG projection,
redaction, each receipt/review binding, base-to-current binding, exact
stage/seed/name inventory, hash/bytes/dimensions changes, reparse roots or
children, bounded-read mutation, and asset-specific stale/hash refusal.
Extend `routes.test.ts` for composition and the opaque asset route; extend
`index.test.ts` for authenticated configuration and unavailable partial roots.
Extend `FigmentWorkspace.test.tsx` for absent backward compatibility,
malformed-result refusal, two same-seed images, recorded review disagreement,
and exactly four asset requests with no action request. Run these focused files
and dashboard typecheck. A later visual fixture may verify desktop and mobile
pair layout after implementation; it is not a quality review.

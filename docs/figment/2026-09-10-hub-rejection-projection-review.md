# Hub rejection projection review — 2026-09-10

## Verdict

**READY** for the bounded hub projection. This review covers only the four
changed hub files below. It establishes correct projection of a completed,
recorded all-cull tester outcome; it does not create a checkpoint selection,
quality acceptance, deployment result, or provider action.

| File | SHA-256 |
| --- | --- |
| `dashboard/server/figment/cloudExperiment.ts` | `c821d110608060a2cb16b6a487b3c63a45e2009a68fc98454172603a4ad93736` |
| `dashboard/server/figment/cloudExperiment.test.ts` | `60a74277f1b5c5b456a4b8c4cc21efa4855f9929db711fb231726b727fccf0c9` |
| `dashboard/src/figment/FigmentWorkspace.tsx` | `7d125c53fe5ac7635c654d67bbfb929436b89b83b0f4e15fcdfff2b93e32c27d` |
| `dashboard/src/figment/FigmentWorkspace.test.tsx` | `1de6c62ae4246cc09f93e8a3bec2c6515680e3b373338f569821ecb49ce02d9f` |

## Review findings

The collector preserves completed lifecycle evidence when decision evidence is
missing, partial, malformed, stale, or inconsistent: it returns a recorded
completed tester row with `quality: not-reviewed` when there are no decision
records, and `quality: unavailable` when decision evidence is present but
cannot be verified. A complete all-cull chain projects only as
`recorded-rejection`. The UI accepts the two new quality states only for a
completed five-output tester row, labels unavailable evidence as unavailable,
and says that a recorded rejection selected no checkpoint.

The recorded-rejection path binds the configured plan and the current five
receipt outputs to the evaluation subject, then requires the canonical subject
digest in the evaluation, rulings, and both rejection subject copies. It also
requires exact structural equality of the three subject copies, the raw
rulings-file digest, matching decision actor/time, all five ordered culls, and
a `none`/no-replan transition. The regression changes the image evidence in
all three subject copies while retaining a stale shared digest; it now produces
`quality: unavailable`, closing the prior stale-digest acceptance gap.

Canonical hashing follows `lineage.py`'s sorted-key, compact UTF-8 approach.
The Unicode regression pins the `café`/`雪` digest; ordinary integral image-byte
values exercise number handling, and the successful actual V2 collection
confirms the producer's present numeric fields are accepted. Unsupported
numeric representations fail closed. The collector reads only bounded JSON and
file metadata/size for the five listed outputs; it neither reads image bytes
nor projects image paths, prompts, checkpoint contents, uploads, pod data, or
other private payloads.

The review also checks the refusal of an approved directory, an approved-file
marker, and an approved-directory junction. Any such approval-bearing record
makes quality unavailable. The existing `parked` and `verified` review row
labels remain valid only when the complete all-cull chain is present; they do
not imply acceptance.

One availability defect was found during this review and repaired before this
verdict. `jsonCanonicalSubject` originally performed its recursive annotated
parse before `decoded()` applied the shallow 64-level depth check. The new
ordering calls `decoded()` first. The new 20 KB, 10,000-depth fixture is below
the 256 KiB JSON cap and confirms that the annotated recursive parse is never
called; it fails closed as unavailable quality instead.

## Verification

```text
cd dashboard
npm test -- --run server/figment/cloudExperiment.test.ts src/figment/FigmentWorkspace.test.tsx
# 2 files passed, 43 tests passed (before the depth-order repair)

npm test -- --run server/figment/cloudExperiment.test.ts -t "rejects deep tester review JSON before recursive parsing"
# 1 file passed, 1 test passed, 16 skipped (after the repair)
```

Root additionally recorded the final three affected test files as 62 passing
tests in 11.81 seconds after the depth-order repair. A local direct call to the
configured V2 collector returned `status: recorded`, `execution: completed`,
`quality: recorded-rejection`, `outputCount: 5`, and no checkpoints. It read
no image contents.

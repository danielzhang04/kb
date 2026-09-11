# Accepted motion source assignment and later delivery evidence

Status: motion-source adapter and hub projection implemented and locally tested September10; independent review pending. Delivery transformation remains design only. Video terminal authority is implemented and locally tested in `2ef9f36a`, pending independent review. This document grants no new acceptance, transformation, publication or platform permission.

## Smallest next slice

Extend the existing content asset binding path to associate a currently accepted video with a persona `G` slot as **source material only**. Do not introduce a renderer, delivery verdict, orchestrator or account integration. Today `content_asset_binding.py` rejects motion/non-persona slots, and `dashboard/server/figment/contentBriefs.ts` accepts only the closed approved-still shape. Both producer and reader must be changed together and preserve existing still records.

The unreleased v2 source descriptor requires `kind: accepted-video-source`, a root-contained `accepted_video` record path, and its exact lowercase 64-hex `accepted_video_sha256`. The digest must equal the sole validator's accepted-lineage snapshot, so the slot-fit ruling identifies the exact record judged. Earlier v2 rulings without that digest must be regenerated; the v1 still contract is unchanged. Call the sole `video_review.validate_accepted_video` validator. Its current projection returns creator/candidate IDs, movie, approved still, candidate manifest and accepted-lineage snapshots. Creator ID alone is insufficient: recover the hash-bound candidate first-frame provenance and reuse the existing approved-gen source validation/brief-persona-reference join. Revalidate the video and still authority again immediately before publication and compare exact captured projections. Never read an accepted-record status as authority or make a second temporal judge in the content adapter.

Use an explicit versioned assignment contract for motion, with `source-material-only` scope and no delivery-approved boolean. Bind brief/request/template/ruling snapshots, exact slot index/role/taxonomy, attributable slot-fit decision, candidate ID, accepted lineage and source movie bytes. Preserve the old still schema for existing records; the hub must recognize both deliberately and fail closed for unsupported shapes. It should show a recorded source assignment, with current validity rechecked only by a consuming action. The existing snapshot collector does not grant live authority.

## Why source assignment cannot imply delivery fit

The current native candidate is1280x704,16fps,81frames (5.0625seconds). The current reel configuration calls for1080x1920 at30fps with template-specific duration/audio rules. Cropping, letterboxing, retiming, frame interpolation, overlays and audio are creative or signal changes. None is authorized merely by assigning a source, and no template/config change is part of this slice.

A later delivery producer needs separate source-authority, transformation-receipt and output-review records. A declared command explains intent, not proven output behavior. Inspect bounded actual output and record exact inputs, outputs, executable/preset pins, timing and audio properties. Revalidate upstream authority at consumption; immutable historical receipts are not proof of current validity.

For an initial delivery contract, allow observation reuse only for the identical artifact bytes under current source authority, with original attribution retained. A remux is not byte-identical. Semantic stream equivalence would require a separately reviewed canonical full-decode/timestamp/audio contract; do not approximate it using sampled frames, perceptual hashes, equal frame counts, average fps or duration. Unknown and changed output require new affected observations. Technical compatibility never proves identity, adult presentation, clothing, framing quality or full-playback quality.

## Acceptance matrix for the next code slice

| Case | Required behavior |
| --- | --- |
| Real accepted still ? candidate ? assembly/extraction ? video ruling ? persona G brief | Produce one source-only assignment; preserve exact provenance and attribution. |
| Raw movie, historical diagnostic, parked/rejected/partial video decision | Refuse before writing assignment. |
| Same creator ID with different persona or canonical reference | Refuse the identity join. |
| Source approval, candidate, frame, movie or ruling changes during binding | Refuse; preserve existing records. |
| Wrong/duplicate/missing slot or duplicate source identity | Refuse exact slot coverage failure. |
| Symlink/junction, oversized JSON, unknown keys, unsupported version | Refuse bounded preflight. |
| Existing still assignment | Continue existing schema/collector behavior unchanged. |
| Native source assigned to vertical reel | Display source-only status; no fit, crop, retime, audio or publication claim. |
| Malformed motion assignment beside valid brief | Keep brief visible, assignment unavailable. |

After the producer and reader change, run real producer/consumer positive and stale-source negatives, the content and hub suites, typecheck/build, then independent integration/security review. Existing video independent review is still outstanding. Do not relabel the new slice READY based on this design critique.

## Adversarial design feedback

A tools-disabled Sonnet CLI (`claude-sonnet-5`, one response,41.172seconds) proposed the generic evidence split. A separate tools-disabled Opus CLI (`claude-opus-5`, one response,63.891seconds) found contradictions in its no-op reuse, insufficient frame/time equivalence, missing current authority and missing failure publication semantics. Root incorporated these findings and chose the narrower exact-byte rule above. Neither worker received repository source, images, checkpoints, internal notes or the rejected review packets. This was generic design feedback, not independent review of existing code.

Evidence: MAIN/_private/figment-claude-sonnet-delivery-contract-generic-20260910-v1/ and MAIN/_private/figment-claude-opus-delivery-contract-generic-20260910-v1/. Final reported API-equivalent prices are$0.0946048 and$0.261995; subscription accounting is not a RunPod charge or invoice.


## Local implementation evidence

The existing content adapter now accepts v2 motion-source rulings, invokes the sole video validator, joins the underlying approved still against brief identity, and rechecks current authority before writing a v2 source-only assignment. The collector/UI accept the explicit new state while preserving v1 still behavior. Content56PASS before final integration correction; final10motion testsPASS; hub44PASS/typecheck/buildPASS. Exact synthetic producer records passed the real collector. The real CLI join first exposed a too-small duplicate content-parser budget on the full81-frame approval subject; delegating bounded parsing to the sole video validator fixed it. See [whole-plan progress](2026-09-10-whole-plan-progress.md). This remains locally verified, not independently READY or production media acceptance.

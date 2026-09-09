# Generated-input curation gallery — independent review

Date: 2026-09-09

Scope: `dashboard/server/figment/generatedInputs.ts` and its focused test, against the private direct-`g01` curation staging bundle. This review is read-only. It does not assess image quality, dataset acceptance, training quality, or deployment.

## Verdict: READY

No blocking correctness or file-boundary finding was identified in the changed collector. The change makes the existing read-only gallery accept the producer's actual sidecar name and optional generation metadata while preserving fail-closed asset reads.

## Contract checked

The real staging root contains 21 PNG/provenance pairs (42 files). The independent local contract check verified all 21 request entries:

- request schema `figment/single-seed-curation-request@1` and canonical `g01` SHA match;
- every image and sidecar is a regular, non-symlink file;
- every producer record has schema `figment/generated-input-experiment@1`, creator `creator-001`, the canonical `anchors/g01.jpg` source SHA, matching output filename, and a matching image SHA;
- aggregate image bytes are 44,932,387, below the collector's 64 MiB aggregate limit.

The collector allows exactly one sidecar for each image: either `<stem>.provenance.json` or `<image>.png.provenance.json`. It rejects both forms together, missing image/sidecar pairs, malformed optional `generation`, source/hash mismatch, traversal, reparse roots/components, oversized files, and a scan beyond 50 physical entries. The 24-item cap therefore covers the 21 staged derivatives without widening the 8 MiB per-image, 64 MiB aggregate-image, 128 KiB JSON, or 32-million-pixel bounds.

The asset route still requires the projected image SHA and returns only PNG bytes with `nosniff` and `no-store`; it does not expose `training_eligible`, captions, provenance paths, or arbitrary files.

## Verification

- Static source and changed-test review, including caller route compatibility.
- Actual curation staging contract probe: 21 pairs / 42 files / 44,932,387 image bytes, passed.
- `node node_modules/typescript/bin/tsc --noEmit` from `dashboard`: passed.
- Root separately recorded the focused collector test and an actual 21/21 asset/route probe; those runs were not duplicated here.

The gallery remains evidence display. The bounded 20-train/2-eval research decision, the 21 raw unthresholded identity observations, and the current train bootstrap do not establish identity quality, a selected checkpoint, or a production result.

# Figment current state

Updated 2026-09-08 13:13 UTC. The 8 AM Eastern checkpoint was delivered; work continues.
Instagram is deferred. [Canonical handoff](../../handoffs/2026-09-08-figment-async.md).

Studio branch `codex/figment-studio-20260908`, head `b138e9e7`, is pushed to draft
PR179, stacked on foundation PR178. The research book, authenticated studio, actual
offline plan preview, reference/diagnostic galleries, local raw identity observer,
and single-seed curation compiler are built, tested and independently reviewed.

Identity quality remains unresolved. g01 is the provisional canonical seed; g02/g07
are declared comparators. Four generated inputs remain experimental and excluded
from training. The curation compiler passed final 37 curation/lineage checks plus
9 train-first checks, and refused all four real inputs without publishing a dataset
or creating approval/plan records. Earlier 109 Python regression checks preceded the
last boundary repairs. No new trainable dataset has been accepted.

Native raw observer V1 could not detect faces in the ten large paired portraits.
The separately versioned fixed-640 detector path passed 34 parent/independent tests;
its actual 19-input batch detected all candidates and anchors. Receipts and tables
were audited. Raw similarity is uncalibrated evidence, never automatic acceptance.
E01's additional receipt is separate; the original batches remain unchanged.

Video V1 had severe distortion and failed visual review. V2 was coherent for small
motion. V3 produced a stable 81-frame, 1280x704 clip but did not unambiguously perform
the requested head turn and return. All frames/artifacts were verified and reviewed.
These diagnostics do not establish production identity or apparent-age acceptance.

No active RunPod. Recorded compute arc is $37.800385 of $50; today's recorded compute
is $2.110134. The studio runner retains its stricter $10 daily configuration (the ops
checkout currently says $30). No outstanding numeric reservation. Native-agent and
built-in image-generation billing is unknown where the runtime does not expose it.

Current work: the Figment-only Gemini comparison adapter was accepted in 56226790
after 20 parent and 20 independent tests. Its exact source/prompt/metadata bindings,
one-attempt reservation marker, bounded decoding and sanitized receipts are reviewed.
The actual generation command was rejected by automatic approval review BEFORE
process start: exact g01-to-Google export permission is required. A second explicit
async approval question is pending. No image was sent or provider cost incurred; the
$4.60 reservation was released after verifying no dispatch marker/output directory.
The source request/admission and refusal audit remain preserved. No retry or alternate
export while pending. In parallel, the generated-input gallery is accepted in7f158b08 after independent/parent124 checks,
TypeScript checks and a real17-image fixture review. Experimental-training compiler
repairs are undergoing fresh independent review. An existing local ComfyUI CUDA
installation and selected model hashes have been verified; a bounded loopback-only
launcher is being built, without starting it. Canonical-seed adequacy is under review.

The exact existing-LoRA upload still awaits the user's answer after automatic
approval review rejected it. No retry or alternate export. Other work continues.
Keep-awake owner 16580 and supervisor 19564 were alive at 08:52 Eastern, with the
lease armed. No Instagram/account work, production promotion, merge or deployment.

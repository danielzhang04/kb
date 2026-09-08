# Figment current state

Updated 2026-09-08 13:46 UTC. The 8 AM Eastern checkpoint was delivered; work continues.
Instagram is deferred. [Canonical handoff](../../handoffs/2026-09-08-figment-async.md).

Studio branch `codex/figment-studio-20260908`, head `db807f35`, is pushed to draft
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

Current work: accepted experimental-training compiler `f6b5096d` passed 10 parent and
10 independent checks while retaining the established curation/acceptance boundary.
Canonical-seed adequacy audit `83c00054` records g01 retained. Gallery polish
`c264d74f` passed 13 parent UI/typecheck checks and 13 independent UI/typecheck checks,
including desktop and mobile v3 fixture review: 17 images loaded, four generated cards,
and no overflow. The v3 desktop screenshot SHA-256 is
`78c3595d3bc39c16bbb841e44219f70c9b62ab6e9b8b87468f186dbceb5dd892`; mobile is
`9052638f60dbb48aeea6389245e2f06ea8fa44ace315cc72193d49c912d2f73f`.

The accepted local Comfy runner `f03bae3a` reached a bounded baseline v1 attempt under
`C:/Users/danie/kb/_private/figment-local-comfy-baseline-20260908-v1`, then failed
before listener readiness or a prompt POST. Its child PID 33972 exited 1; no dispatch
marker or output image exists. `manifest.json` SHA-256 is
`b1f7ae4efc56f4137f073f7511120847800a94b63c696b60dbdbcbc7aa0048dc`; the journal
records verified teardown. The capped startup log attributes the failure to
`torch._dynamo` cache initialization with no username in the isolated environment.
The owned `TORCHINDUCTOR_CACHE_DIR` fix passed an isolated real import probe and
15 parent checks, and is committed in `fea2ef96`. The second attempt reached server
startup but was stopped before POST: the virtual-environment redirector's PID differed
from its actual Python child. Root verified leaf 41576, wrapper 33680 and conhost 34896
absent after intervention. A default database migration also attempted a shared-install
backup and was denied. Audit `db807f35` preserves both attempts. Exact descendant
creation-time tracking, explicit private database URL and live bounded log flushing
are under repair; a real tiny-server ownership fixture precedes any third image run.
This local failure creates no provider charge, but native-runtime billing remains
unknown rather than zero. Parent and independent focused launcher suites each passed
15 after the runner review; the parent's first default-temp pytest attempt was denied,
then the owned-base-temp rerun passed.

The Figment-only Gemini comparison adapter remains accepted in `56226790`, but its
actual Google export is blocked pending the exact user question; no retry or alternate
export is allowed. The existing LoRA-export question is also pending. There are no
active pods. Recorded compute remains $37.800385 of $50 and today's recorded compute
remains $2.110134. Keep-awake owner 16580 and supervisor 19564 were alive at 09:26
Eastern; keep-awake was reverified alive at 09:44. No Instagram/account work,
production promotion, merge, or deployment. The experimental executor is now being
built against integrity fixtures while an independent worker reviews its design.

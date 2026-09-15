# OmniGen2 local runtime integration — 2026-09-08

The accepted pure planner fixes two 768-square, reference-conditioned images. This design builds the executor around the existing pair engine and immutable Windows process-ownership helper. It is a research comparator; model licensing and image quality remain separate from runtime success.

Opus independently reviewed a bounded source packet and approved the planner. A separate Opus packet proposed engine extension. Root accepted reuse and rejected independent wrapper termination by a watchdog: the observer must only sample and report, and the main runtime must remain the sole owner of tree teardown. The existing helper's `on_discovery` readiness callback supplies cancellation checks without copying its readiness loop. An arbitrary maximum count of hooks is not an architecture criterion; the extensions below have concrete callers and tests.

## Three implementation phases

1. Extend `train/local_lora_pair_engine.py` with closed extra launch arguments, a preparation callback, output decoder, read-only observer, and optional readiness/row deadlines. Preserve the default command and receipt shape for existing callers. Retain discovered identities even when readiness fails. Test default behavior and failure paths using fake processes. Root updates the two callers' literal engine hashes after the final source is reviewed; historical receipts and stopped studies stay immutable.
2. Build an OmniGen2 controller and resource observer. The controller verifies admission, exact model/input/code hashes and graph, creates isolated input/output/temp/user/home/cache locations, stages g01, and supplies the 768-square decoder. The observer receives copies of owned identities, never a process handle or authority to terminate. Test resource sequences, sampler errors, input/graph tampering, output metadata, and failed receipt persistence. No GPU in implementation or tests.
3. Root creates a fresh admission after independent review and tests, rechecks hardware, and executes one two-row probe. Preserve either a receipt or failure; visually inspect successful PNGs against g01 with independent review. No automatic retry, fallback, training, or promotion.

## Fixed inputs and launch

The pure planner pins g01 and the official workflow snapshot, the three verified prepared model files (15,779,025,788 bytes), and the feasibility document. Its one-reference conditioning wires both positive and image-conditioned negative branches to DualCFG; the third branch is plain negative. Image CFG 2.5 deliberately differs from the template's 2, and fixed 768×768 replaces source-derived dimensions. Text CFG 5, Euler/simple 20 steps, and seeds 481516234 and 90210 are fixed.

Use loopback 8190, disabled API/custom nodes/browser, a closed prepared model directory, isolated input directory, reserve VRAM 1.0 GiB, and an in-memory database. No new packages, external nodes, model downloads during execution, or credential-bearing environment. The pre-launch floor is 12 GiB available RAM, 32 GiB commit headroom, 7,500 MiB free VRAM, and 20 GiB free disk. Samples from a prior time do not admit a run.

## Resource and time semantics

Target one-second samples; record actual monotonic timestamps and sampling gaps. Consecutive breach rules: available RAM below 3 GiB twice, commit headroom below 16 GiB twice, owned-tree private bytes above 24 GiB twice, or total GPU memory used above 7,500 MiB three times. Sampling errors fail closed. Page reads are descriptive or explicitly unavailable; paging alone does not stop a run. The observer owns no mutable main-thread process inventory and no termination authority.

Readiness checks have a 180-second deadline, each dispatch a 45-minute deadline, total engine work a 100-minute deadline, and stderr a 16 MiB bound. The main thread checks the observer during readiness and between polling operations, including after HTTP and PNG decoding. A sample or blocking HTTP/Windows/filesystem call can delay observation or cancellation: these are cooperative deadlines, not guaranteed real-time interrupts. Record actual breach, observation, and teardown timing. Do not call a nominal one-second sampler a proven one-second stop.

The feasibility document's 30-second teardown requirement is an acceptance limit, not a hard kill timer: the immutable helper waits up to 15 seconds per owned identity and cannot promise an aggregate 30-second bound. A teardown exceeding 30 seconds fails the run even if eventual exit is verified. Continue verified cleanup and preserve its actual duration. Never launch a competing teardown thread to simulate that guarantee. This clarification must be embedded in the new admission and runtime receipt.

Two distinct PNGs, exact output inventory, embedded admitted graphs, code/input/model bindings, resource records, and verified timely teardown are required for runtime completion. `not_promotable` remains true. Both previous text-conditioned studies are terminal STOP; this design does not reopen their higher checkpoints.

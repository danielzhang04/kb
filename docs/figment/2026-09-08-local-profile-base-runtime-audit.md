# Local profile-base runtime audit - 2026-09-08

## Scope

This audits the separate C3 prompt-profile calibration study designed in the
[matched current-20 follow-up design](2026-09-08-matched20-next-experiment-design.md).
It is not a continuation of the original C2 higher-stage ladder. The study
tested whether a frozen, fully specified positive prompt profile removes the
base-composition confound seen in the minimal-prompt C2 pairs. It ran only
the `profile-base` stage: two base-model PNGs at fixed seeds, no adapter.

Admission: `figment-local-lora-profile-base-20260908-v1`. Nothing here is
human QA, quality acceptance, promotion, or eligibility. The receipt records
`not_promotable: true`.

## Evidence record

| Artifact | SHA-256 |
| --- | --- |
| Receipt (`receipt.json`) | `26e2396b3247730f9124386beb32198fba12930b85fddd18297165e27b7bd44c` |
| Root review (`review-root.json`) | `8e79c86410942edcb406982c3dbc2f2dffdbdfa0e8b15cdb3e409bd7ea9bef65` |
| Independent review (`review-independent.json`) | `952fb76424ddca547a4289951d63424321e84b73bb7768f38bb03d165f135403` |
| Controller source | `e07d8528e165d75ff5330b7bdd8fae767162c5fb0a7abc8d73673c3706a8d6fe` |

Both reviews bind to the receipt hash above. The controller passed 23 root
tests and a verified Opus READY review before execution.

Outputs, both 1024x1024 PNG:

| Row | Seed | Bytes | SHA-256 | Verified graph SHA-256 |
| --- | --- | --- | --- | --- |
| `profile-base-seed-481516234` | 481516234 | 1,394,954 | `4235253ac57bbc22ef1d697fa453f938b38de5ba3946d5f2c8a433fbe91be1e1` | `998ee16868f157920f7be2e42eefc9ef37c0114f4123eacdaa71d1283798d989` |
| `profile-base-seed-90210` | 90210 | 1,415,024 | `00aa9673edb2a9ae6aed1084fcbf977795420f41bbe197d51a649e25dd177ace` | `1183828b9edc5c5dc1c2c07007ecd2571d7680b6ff4adf422c206feb96f0dce0` |

Each PNG carried an embedded full-graph record that the controller compared
automatically against the submitted graph. Pinned inputs in the receipt include
the Comfy commit, base-model, nodes, and stable-diffusion digests, the C1
digest, the planner and manifest digests, the pair-engine and ownership
digests, and the historical C2 base and current-20 receipt and review hashes
as controls. The current-20 checkpoint entry is recorded for provenance only;
`selected_checkpoint` is null and the LoRA-application block shows zero
attached UNet keys, as expected for a base stage.

Runtime: `status: complete` within a 600-second deadline. The receipt records
no total elapsed time, and none is asserted here. The stderr digest is
`ea4dff27aa7e8bd05a78f57c320f6ce302b1442ae9691275d4c2b874f5a11f49`; the
per-prompt stderr timing of 37.34 s is a per-prompt figure, not a run total.

Teardown: the owned wrapper (PID 42260) and its two children (35216, 46524)
are recorded as terminated, with `verified_stopped: true`, no unresolved
processes, no discovery or parent-snapshot error, and empty error lists. The
root reviewer observed all three absent after completion. The C3 execution
session 69443 closed with exit code 0.

## Review outcome

Both reviews recorded disposition `stop`, `human_qa: false`, and
`not_promotable: true`. The design's predetermined base-composition stop rule
applied: both seeds miss head-to-below-waist framing (chest-up or tighter
crops, no elbows or waist) and both miss the requested image-left turn.
Therefore no `profile-current-20` pair was admitted or rendered, and the study
is terminal after the independent review.

Points of agreement:

- Weak or low resemblance to `g01` in both rows, with the subject reading
  older than the intended about-21 adult reference. No exact age is inferred.
- First seed: opaque white printed crew-neck tee, not the requested plain black
  crew-neck; the garbled printed lettering is a typography artifact.
- Second seed: opaque black sleeveless scoop-neck top, not a crew-neck tee.
- Both rows are clothed and opaque. Neither review records an adulthood,
  garment-exposure, or material-anatomy quarantine failure.

Preserved disagreement: on the second seed, the root review records direct
camera gaze; the independent review records eyes raised past the lens. This
stays a disagreement between roles. It is not consensus in either direction
and is not a gaze finding.

Independent record provenance: the sanitized independent JSON documents that
appearance-based ethnicity labels were redacted from the two resemblance
fields, a missing outer closing brace was repaired, and the raw provider
result (`5fa432318cb7836451f6abb953c84cd1b9bc8289e26dc5b849b37b1bfcaa86a1`)
is retained separately. This audit did not read the raw result. The reference
identity remains a fictional adult; no ethnicity categories are used.

## What this does and does not establish

Established: the frozen profile prompt did not remove the base-composition
confound at these two seeds. The runtime, receipt, graph verification, and
teardown path behaved as designed.

Not established: any causal, identity, age, checkpoint, or quality finding.
The study does not reopen current-50, current-final100, or a concise
admission. The completed current-caption 100-step fit remains a runtime
capability only, with no quality promotion.

## Next branch

The next branch is a separately planned local OmniGen2 reference-conditioned
research probe. Its three pinned weights have now been downloaded and verified;
its planner is under review. It has produced no images and has no runtime
record. Qwen3B commercial rights for that stack are unclear and unresolved.
No claim is made that reference conditioning outperforms the LoRA path; that
is the question the probe would be designed to test.

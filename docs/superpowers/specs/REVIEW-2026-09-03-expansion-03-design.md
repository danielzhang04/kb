# REVIEW — expansion-03 design (X3-R), adversarial pass

Reviewer: different model from the design's author (opus). Design under review: commit `1141d2c0`,
`docs/superpowers/specs/2026-09-03-figment-expansion-03-design.md` +
`orgs/figment/pipeline/expand/workflows/klein4b_anchor_variation_api.json`. Read-only review; no repo
file touched except this one.

## Method — what was independently re-verified, not just read

- `SplitSigmasDenoise` (`comfy_extras/nodes_custom_sampler.py`, ComfyUI `v0.20.1` source, fetched live):
  `total_steps = round(steps * denoise)`, output 1 = `sigmas[-(total_steps+1):]` — matches the design's
  §1b claim verbatim, including the 10/14/18-step table at denoise 0.20/0.28/0.35.
- `Flux2Scheduler` (`comfy_extras/nodes_flux.py`, same source): inputs are exactly `steps, width,
  height` — **no denoise input** — confirms the design's central mechanism claim is not invented.
- `GetImageSize`: output 0 = width, output 1 = height — the graph's node `24` wiring
  (`width:["21",0], height:["21",1]`) is wired the right way round.
- Official `Comfy-Org/workflow_templates/templates/image_flux2_klein_image_edit_4b_base.json` (fetched
  live): confirmed it uses `ReferenceLatent + EmptyFlux2LatentImage` (never `VAEEncode → latent_image`),
  `CFGGuider cfg 5`, `Flux2Scheduler steps 20` — matches the design's §1b citation exactly. This is also
  the evidence behind the Boss addendum: the *official* 4B Base edit pattern is full-denoise,
  ReferenceLatent-only — i.e. Mechanism A, not Mechanism B.
- `orgs/figment/research/10sorlabs-package/10_dataset_generator_v2/10sorlabs_dataset_generator_v2.json`
  parsed directly: nodes `789`/`777` (`ReferenceLatent`) really do have `latent: link=null` and feed
  node `788`/`778` (`KSampler`, denoise `0.23`) — confirms the design's "correction to the brief's
  premise" (§0) that the low-denoise pass is a finish pass over a generated frame, not a reference-photo
  edit. Nodes `174`/`676` (`TextEncodeQwenImageEditPlus`, "Remove the clothes of the woman... fully
  naked") are the clothing-removal branch; grepped the whole design doc and the delivered workflow JSON
  for any trace of that text or those node IDs — **none found**. Clean.
- `identity_check.py` source: `--persona/--batch` mode really does resolve `anchor = …/
  persona.identity.references[0]` for every scored image — confirmed by `expansion-02/scores.json`
  itself, which carries one global `"anchor": …/g01.jpg"` field for all 60 rows. The design's "blocking
  scoring defect" (§4) is real, not overstated.
- Anchor image dimensions (parsed JPEG SOF markers directly): `g01.jpg` = 1408×768,
  `g02.jpg`/`g07.jpg` = 768×1376 — matches the design's §6 risk 5 claim about g01 being the only
  landscape anchor.
- `creator-001-expansion-02-shard-01.yaml` (real file is at
  `orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-01.yaml`, not the bare filename
  §1c names): confirmed `uploads`, `seed_fields`, `job_timeout_seconds`/`readiness_timeout_seconds`,
  and 10-jobs-per-shard cap all match the design's harness-contract claims, and confirmed node `5`'s
  negative text in `composite-02.yaml` is byte-identical to the delivered workflow's node `5` — the
  "carries the underage + §4a families" claim is correct.
- Every `class_type` in the delivered graph (`UNETLoader, CLIPLoader, VAELoader, CLIPTextEncode,
  LoadImage, ImageScaleToTotalPixels, VAEEncode, ReferenceLatent, GetImageSize, RandomNoise, CFGGuider,
  Flux2Scheduler, KSamplerSelect, SplitSigmasDenoise, SamplerCustomAdvanced, VAEDecode, SaveImage`) is a
  core ComfyUI node confirmed present in v0.20.1 (via the official template's own node list plus direct
  source fetches for the two load-bearing ones) — `custom_nodes: []` is honest, nothing unlicensed slipped
  in. Wiring is sound end to end: `noise_seed` reachable (node 22), anchor enters as both the initial
  latent (`12`→ via `29`'s low\_sigmas →`26.latent_image`) and `ReferenceLatent #1` (`15`), `text` input
  present (node 4), output size derives dynamically from the real post-scale anchor (node 21).

None of that technical core needed a fix. It is the strongest part of the design and the reviewer found
no fabricated citation or misquoted source anywhere in it.

## Findings

| # | severity | file/§ | finding | concrete fix |
|---|---|---|---|---|
| 1 | **BLOCKING** | design §3 (Pilot) + workflow JSON | The Boss addendum requires the pilot to be 6 cells = 3 Mechanism A (edit-mode, full denoise, the verified `train/workflows/klein4b_multiref_api.json` graph unchanged, prompts ≤25 words in edit grammar) + 3 Mechanism B (this design's img2img graph, denoise ladder), on the SAME three variations (−30° turn, tight crop, wardrobe swap), one pair per anchor — so the comparison is paired. The committed design's §3 pilot (P1–P6) is 6 cells, **all Mechanism B**. There is no Mechanism-A cell, no pairing, and no A/B comparison protocol anywhere in the document. This is exactly the gap the design's own §6 risk 1 flags ("klein 4B Base may not be a competent img2img editor... the official 4B Base edit template uses ReferenceLatent at full denoise, never a partial one") but does not act on. | Rewrite §3 as 3 paired trials, one per anchor: g01/turn −30°, g02/tight crop, g07/wardrobe swap (or any 3-of-3 assignment covering all three variation types once). Run each through **both** mechanisms — Mechanism A on the unmodified `klein4b_multiref_api.json` with a ≤25-word edit-grammar prompt ("the same woman as the reference, identical face; turn her head 30° to the left; same room, same light"), Mechanism B on this design's graph at the variation's assigned denoise rung. 6 renders total, 3 pairs, so the pilot answers "which mechanism" as well as "does either work." |
| 2 | **HIGH** | design §4 (Acceptance) | No per-arm scoring exists. A single "≥4 of 6 cells ≥0.75" bar conflates two different mechanisms and can't tell the operator which one the other 30 cells should run on. | Add an explicit per-arm rollup: report cosine and pass/fail separately for the 3 Mechanism-A cells and the 3 Mechanism-B cells, plus a decision rule (e.g. the arm with the higher pass rate and no operator-eye failure gets the other 30 cells; a tie or double failure means stop and re-cut the ladder/grammar, not silently default to Mechanism B). |
| 3 | **HIGH (confirm, carry forward)** | design §4 + §3 | Per the addendum: is the own-anchor scoring fix a build prerequisite, and is the $0 anchor-vs-anchor calibration specified precisely? Both **are** already correctly present in the committed design (verified against `identity_check.py` source and `scores.json` above) — this is not a content defect. The risk is procedural: with two arms now being compared (finding 1), it is easy for a build agent to read pilot cosines before either gate has actually run. | Carry §4's "Scoring defect… blocking" and §3's "Zero-cost calibration… before the pilot" into the build task list as literal go/no-go steps that must complete before ANY pilot cosine (either arm) is treated as a number, not prose that can be skimmed past. |
| 4 | LOW | design §1c (output size table) | "g01 1392×752 ... g02 and g07 768×1376" is internally inconsistent: g02/g07's native frame (768×1376 = 1.057 MP) is over the `ImageScaleToTotalPixels(megapixels=1.0)` target by almost the same margin as g01's native frame (1408×768 = 1.081 MP), which the table *does* show shrinking. The same node runs on all three images from the same formula: they cannot be right on g01 and unchanged on g02/g07. Does not affect graph correctness — `GetImageSize` (node 21) reads the real post-scale size dynamically, not the documented literal — so this is a doc-accuracy issue, not a build blocker. | Before the build, run `ImageScaleToTotalPixels` once on `g02.jpg`/`g07.jpg` (or read ComfyUI's own logged output size) and correct the table, since §6 risk 5's aspect-spread note to the operator depends on the true numbers. |
| 5 | LOW | design §1c | The manifest cited as "`expansion-02-shard-01.yaml`" doesn't exist under that literal name; the real path is `orgs/figment/pipeline/expand/runs/creator-001-expansion-02-shard-01.yaml`. Its contents were checked and do match every claim the design makes about it (uploads, seed_fields, timeouts, 10-job cap, node-5 negative text). | Cosmetic — spell out the real path so a build agent doesn't search for a file that isn't there. |

## Attack checklist — disposition

1. **Graph validity at v0.20.1** — PASS, fully verified (see Method above). No fabricated node, no dangling type, denoise mechanism named and confirmed correct, output size sane (mod finding 4, cosmetic).
2. **Does the method reproduce the package's step, or is it free generation in disguise?** — The design is honest that it is **not** a port (§0): the package's denoise-0.23 pass is a finish pass over an already-generated frame (verified node-for-node above), not a reference-photo edit, and this design instead puts the anchor on the canvas directly. That correction is accurate and disclosed, not a defect.
3. **Identity risks** — register words (winged liner, lashes, glossy pink-nude lips, jet-black hair) present in every one of the 12 templates via the fixed prefix clause; no banned §4a phrase found in any template text; no profile/back/new-room template (angles list explicitly excludes `profile-l`/`near-back`, confirmed against `persona.yaml`). Whether ±30° holds face at 0.23–0.35 is **unproven and is exactly what finding 1's missing A/B test exists to answer** — the design correctly names this as its own top risk (§6.1) but the pilot as committed doesn't test it against the alternative that would falsify it.
4. **Acceptance** — 0.75 threshold justified against expansion-02's own p75 (verified: p75 ≈0.75 is consistent with the score distribution read above), honestly flagged as provisional pending the $0 calibration (present, finding 3). Cost/time model is a reasonable linear extrapolation; the "12s fixed overhead" line likely double-counts VAE-encode cost already present in the 159 s/cell reference figure (both expansion-02 and this design use the same 3-reference `VAEEncode` pattern), but the absolute pilot cost (~6 min either way) is too small for this to matter.
5. **Licences** — no custom node packs proposed; `custom_nodes: []` matches the graph's all-core node list, consistent with r15/r16's unresolved-licence findings for RES4LYF/FaceBoundingBox. No violation.
6. **Ambiguous-age or unclothed risk** — negative prompt (node 5) carries the underage/adolescent/childlike clauses verbatim from `composite-02.yaml` (verified byte-identical); no positive template asserts an age number (adult read is inherited structurally from the anchor + negative, per §2a, consistent with look-spec-v2 §4c's "never state a bare number" rule); T12 wardrobe clauses are all fully-covering items matching `persona.yaml`'s `wardrobe_families`. No defect found.

## Verdict

**APPROVE WITH FIXES.**

The engineering core — the ComfyUI graph, the partial-denoise mechanism, the module-10 premise
correction, the clothing-removal exclusion, and the scoring-defect diagnosis — is accurate and
independently verified against live ComfyUI v0.20.1 source, the official BFL template, and the raw
package JSON; no fabricated claim was found anywhere in it. What's missing is structural, not
technical: the pilot as committed tests only one of the two candidate mechanisms the Boss addendum
requires be compared, and the acceptance section has no way to report a two-arm result even if the
cells existed. Both are scoped, addressable fixes that don't touch the verified graph itself.

## Three fixes to land before the build

1. **Restructure the pilot to 3 A + 3 B, paired per anchor** (finding 1) — the single blocking gap.
   Mechanism A = unmodified `klein4b_multiref_api.json`, ≤25-word edit-grammar prompts; Mechanism B =
   this design's graph, denoise ladder as already specified.
2. **Add per-arm scoring and a decision rule to §4** (finding 2) so the pilot's output is "which
   mechanism wins," not a single conflated pass/fail count.
3. **Promote both existing prerequisites (own-anchor scoring fix, $0 anchor-vs-anchor calibration)
   into literal go/no-go build steps** (finding 3) — they are already correctly specified in the
   design, but with two arms now in play they must gate both before any cosine number is trusted.

Findings 4–5 are low-severity documentation nits (output-size table, a filename shorthand) — worth a
one-line fix each but not blocking.

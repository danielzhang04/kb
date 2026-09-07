# figment Track-2 — gate before eyes; Qwen-edit bake-off scored; train-first + Path-B diagnostic queued — 2026-09-07

**Topic:** After the operator rejected the Track-1 LoRA board ("close but glossy/older/inconsistent") and then the
Track-2 passport-anchor board ("absolutely not even close … our infrastructure isn't working how it's supposed to"),
the build terminal rebuilt the project around an automated gate: nothing reaches the operator's eyes until a
calibrated identity/age/realism judge passes it. Creator-001 IS anchor g01 (a Gemini AI face, not a photo). The
unsolved core is the reference-to-variation step; every edit-model method plateaus at "same-ish woman, rounder,
older, airbrushed".

### What WORKED (with evidence)
- **Research r20–r25** (committed): fidelity audit, 2026 methods, licence-clean assets, MediaPipe node spike,
  identity-transfer candidates, and r25 "why they can and we can't" — 10sorlabs ships no outputs, admits plastic skin
  and "not one to one" on camera, never starts from an external face; its consistency = hand-tuned LoRA strength +
  FaceDetailer.
- **Plan v2** `docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md` (opus, review folded).
- **Phase A anchor stage** built, opus-reviewed (wrong sha256 pins caught → `train/verify_pins.py` preflight now
  runs before every plan), run live through `figment_train.py run --stage anchor` (first live use of `run`): 18
  candidates, $0.61. SHELVED by ruling (category error), code kept.
- **Phase B1+B3**: half-body-first framing + full-body face-repair pass, skin clause, `identity.look` block in
  persona.yaml (persona rule), advisory scorers.
- **Gate**: `pipeline/identity_gate.py` (facenet own-anchor floor 0.7907, face_px floor; ViT age/NIQE/gloss wired but
  NOT separating) + `pipeline/vlm_judge.py` (headless `claude -p` vision judge; calibrated on 95 images —
  same_person and age_delta separate strangers/drifted LoRA from anchors; skin/gloss/artifacts do not; anchors
  self-score 78–88) + `identity_gate.py run` (plan-independent gate over any image set, same gate.json schema).
  `figment_train.py grade` runs both stages; `apply-rulings` refuses keep on a failed cell without `gate_override`.
- **Gen stage** (D1/D2): native MediaPipe mask → MaskToSEGS → DetailerForEach at the package's FaceDetailer numbers,
  style-LoRA slot (Krea-2 community-licence realism LoRAs), detail-only mode over existing cells; pins verified.
  Launcher now copies bootstrapped LoRAs past its models/loras swap.
- **Harness**: pickle-format model pins rejected by default (diagnostic escape hatch: `diagnostic_non_commercial` +
  per-model `pickle_ack`); chunked uploads; health window; full logs on failure.
- **Bake-off m1** (Qwen-Image-Edit-2511, Lightning removed, 26 steps; arms A = 3 refs + skin LoRA, B = 3 refs no
  LoRA, C = g01 only): 18 cells, pod jm67txnsqfj662, $1.99 (+$0.23 for a first attempt that timed out at 240 s
  cold). Stage-1 facenet: arm B 0.87–0.93 on 5/6 (best), arm A 0.60–0.86 (skin LoRA HURTS identity), arm C
  0.50–0.77 (single ref worst). Judge on the two cells it reached: same_person 55–62, skin 20 → the Qwen plateau.
  Full judge table pending (re-run after the judge fix).

### What Did NOT Work (and why)
- **Passport-anchor swap** — category error: the pipeline reproduces g01; inventing a new face is not the task.
- **Facenet / ViT-age / NIQE / gloss** as gates — do not separate the operator's verdicts (Track-1 cells and Qwen
  edits score 0.92 facenet, same as anchors). Only the vision judge's same_person + age do; its resolution is ~10
  points (anchor pairs score 78–88), so "not close" edits (77) and anchors overlap.
- **Judge run at 4 workers on full-size PNGs** — 185 s per-call timeout hit on 16/18 and failures were cached
  (fixed 189780db: never cache failures, downscale to 1024 px, 600 s, 2 workers).
- **Bake-off job timeout 240 s** — first cold 26-step 3-ref Qwen job exceeds it (fixed 600 s; $0.23 lost).
- **Path-B diagnostic launch** (PuLID-Flux on FLUX.1-dev, research-only, `m3diag_manifest.yaml`) — BLOCKED by the
  session's permission classifier, not by the harness; operator can launch it by hand (command in STATE/README).
- **Skin LoRA `tlennon-ie/qwen-edit-skin` on 2511** — lowers facenet identity (arm A vs B); do not use as-is.

### What Has NOT Been Tried Yet
- **Train-first** (building now: `train/select_training_cells.py` + DOP flag + `train-first` plan stage): Krea-2 LoRA on
  the three anchors + only judge-passing cells (same_person ≥ 80, |age| ≤ 2), DOP on; then tester + judge.
- **Detail-only pass** over the best existing cells (`<id>-tensor-detail.yaml`, D29) — r25 experiment #2.
- **Path-B diagnostic** pod (needs the operator to launch; $3.70).
- Forced-choice / feature-difference judge rubric to sharpen resolution below the 10-point noise floor.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/pipeline/identity_gate.py`, `vlm_judge.py`, `gate.yaml` | DONE | gate v1 + judge; calibration under `personas/creator-001/calibration/` |
| `orgs/figment/pipeline/figment_train.py` | DONE | stages anchor/dataset/smoke/train/tester/gen(+detail); grade/gate/apply-rulings |
| `orgs/figment/pipeline/expand/bakeoff/` | DONE | m1 (run, scored), m3diag (built, not run), summarize.py |
| `orgs/figment/runs/c001-t2/` (gitignored) | DONE | anchor plan+outputs+board, bakeoff/m1 outputs + gate.json + judge/ |
| `orgs/figment/pipeline/train/select_training_cells.py` (+DOP) | WIP | builder in flight |
| `ledgers/cost/figment-2026-09-06.tsv` | DONE | $2.83 day |

### Exact Next Step
Read `orgs/figment/runs/c001-t2/bakeoff/m1/judge/judge.json` (re-run in progress at handoff time) and
`python orgs/figment/pipeline/expand/bakeoff/summarize.py --run orgs/figment/runs/c001-t2/bakeoff/m1/run.json --gate orgs/figment/runs/c001-t2/bakeoff/m1/gate/gate.json`;
if arm B's judge median stays < 80, the edit-model path is exhausted for identity — run the train-first LoRA (once
its manifest lands and dry-runs) and, if the operator launches it, the Path-B diagnostic; compare all three on the
same judge. Only a method whose cells pass the gate feeds the dataset stage.

### Load list
- `orgs/figment/STATE.md` (2026-09-06 section), `orgs/figment/research/r25-why-they-can-and-we-cant.md`, `r24`, `r20`
- `orgs/figment/pipeline/gate.yaml` + `personas/creator-001/calibration/judge-calibration.md`
- `orgs/figment/pipeline/expand/bakeoff/README.md`, `m3diag_README.md`
- `docs/superpowers/plans/2026-09-06-figment-track2-faithful-pipeline.md`
- memory rules: gate-before-eyes; pipeline-not-influencer

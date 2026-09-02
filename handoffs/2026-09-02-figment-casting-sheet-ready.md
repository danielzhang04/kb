# figment casting sheet ready — 2026-09-02

**Topic:** Built the figment AI-persona image pipeline from nothing to a working,
calibrated generator. Ends at a human gate: Daniel picks one of 8 candidate women,
then that face gets a LoRA and becomes the flagship persona.

Branch `claude/figment` (worktree `C:\Users\danie\kb-worktrees\figment`), 20+ commits,
tip `e91a7254`. Nothing merged to main.

### What WORKED (with evidence)

- **Local generation stack** — ComfyUI at `C:\Users\danie\tools\ComfyUI`, own venv,
  torch 2.11.0+cu128, CUDA live on the RTX 4070 8 GB. Confirmed by test renders at
  1024px in ~21s warm, 27% VRAM headroom.
- **Photoreal quality without gloss** — visible pores, natural light, no plastic skin.
  Confirmed across ~150 generated images.
- **Full-body framing** — T2I-Adapter OpenPose skeleton at ControlNet strength 0.6-0.7.
  10/10 genuine head-to-toe. Prompting alone collapses to bust shots (measured, 0/16).
- **True profile** — no ControlNet; IP-Adapter weight 0.4-0.5 with `start_at` 0.80.
  6/6. Three-quarter uses the SAME schedule with milder prompt wording (6/8) — 0.80 is
  a threshold, not a dial.
- **Face rendering at full-body scale** — FaceDetailer, guide_size 768, denoise 0.35,
  bbox_crop_factor 3.0, force_inpaint true. Fixed a previously mangled face; verified
  clean in calibration-proof-v3.
- **Body shape ("slim thick")** — olaz Hourglass Body Shape SDXL LoRA @ **0.6**.
  Reproduced across 3 seeds incl. the exact seed that gave the straight-slim baseline.
  1.0 over-exaggerates. Downloads anonymously from CivitAI (no login).
- **Heritage-noun cascade fix** — heritage as a trailing `(east asian american
  heritage:0.8)` clause instead of a main-clause noun. With the noun in-clause,
  explicitly-specified dark jeans rendered olive on 3/3 seeds; moved out, fixed 3/3.
  This was a root cause of many earlier register failures.
- **Portrait/full-body convergence** — an UNANCHORED portrait prompt falls back to the
  checkpoint's studio-beauty-editorial prior even with "editorial" in the negative.
  Fix: give portraits the same wardrobe + environment anchor as the full-body.
- **LoRA training chain** — end-to-end on RunPod: RTX 3090 community @ $0.22/hr,
  2800 steps at 1024, loss 0.26 to 0.092, 43 min GPU time. Artifact at
  `personas/trial-01/lora/tr1al01woman_v1.safetensors` (170 MB). Pod terminated and
  VERIFIED (DELETE 204, follow-up GET 404). Actual cost $0.95 (see failures below).
- **QA toolkit** — `qa_stamp.py` (three-state fail-closed verdict writer),
  `build_grading_board.py` (offline HTML board, blind mode), `blind_pool.py` (anonymised
  pooling + post-grade reveal). Self-tested end to end incl. failure paths.
- **Casting sheet** — 8 women x (face + body), standardised pose/wardrobe/wall/lighting,
  16/16 passed QA first attempt, zero culls.

### What Did NOT Work (and why)

- **Prompt-only body shaping** — three casting rounds of increasingly detailed build
  descriptions produced no waist-hip contrast. RealVisXL has a strong thin-body prior.
  Weighted clauses (`:1.3`) helped marginally; only the LoRA actually moved it.
- **`bodyproportion.safetensors` / `contourluxe.safetensors`** — produced curve but
  degraded faces and proportions at EVERY weight tested (six A-F experiment renders).
  Abandoned. The olaz LoRA is the replacement precisely because it does not touch faces.
- **`instagram_selfie_sdxl` LoRA** — pushes skin toward gloss at both 0.3 and 0.5.
  Negative result; do not use for texture goals.
- **Hand-drawn OpenPose skeletons** — an agent fabricated them from guessed ratios;
  they encoded wrong proportions and every ControlNet full-body inherited the squash.
  Derive skeletons from real photos via an OpenPose preprocessor instead.
- **"editorial, sharp cheekbones" hardcoded in the workflow templates** — silently
  injected into every generation for six rounds, overriding every brief written on top.
  Removed. Check templates before blaming prompts.
- **Iterating on adjectives** — seven casting rounds cycled through four failure poles
  (generic-soft, hard-editorial, generic-natural, beauty-campaign). The method failed,
  not the architecture. Single-variable grids with fixed seeds fixed it.
- **`npx eromify-mcp`** — package does NOT exist on npm (404, zero registry hits).
  Their own docs' install command. Dependency-confusion shape. Never run it.
- **Eromify MCP/CLI automation** — gated to higher tiers than the $36/yr Builder plan.
  Generation there is manual via their studio.
- **RunPod cost overrun** — billed 260 min against 43 min of real work ($0.95 vs $0.52)
  due to two agent-side bugs: a `set -e` abort on a cosmetic unzip warning, and `-p`
  instead of `-P` for `scp` (silently broke every download while the pod kept billing).
- **Long background bash waits** — the harness reclaims them at ~10 min. Do not rely on
  them; let an agent's own monitor report.
- **Agents parking mid-task** — several ended their turn after queueing work instead of
  blocking. Brief them to block in a wait loop and report ONCE.

### What Has NOT Been Tried Yet

- **Pose/contrapposto for waist definition** — the hypothesised top lever, never tested
  because the olaz LoRA solved it first. Still the likely fix if more curve is wanted.
- **Skin Realism SDXL LoRA** (civitai.com/models/248951, ~359K downloads) — the
  top-rated fix for airbrushed skin. Still gated behind Daniel's CivitAI login.
- **Juggernaut XL** as a base-checkpoint A/B against RealVisXL — considered, not run to
  conclusion.
- **"The Chosen One"** (SIGGRAPH): DINOv2 embed, K-means, cohesion-select as a
  principled replacement for generate-8-and-eyeball casting. Plus FaceScore as an
  automated quality pre-filter.
- **Eromify comparison arm** — $36/yr Builder tier is PAID FOR and unused beyond 4 test
  images. Blind-grading harness is built and waiting.
- **Test 0** — the Instagram distribution-ceiling test. Needs Daniel's professional test
  account + Meta token. Every downstream dollar rests on this untested assumption.
- **Explicit-tier generation** — untested end to end. Per guardrails this is Daniel's to
  run, not the agents'.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/pipeline/GUARDRAILS.md` | DONE | Six hard lines, permission-mode independent |
| `orgs/figment/pipeline/lever-table.md` | DONE | THE calibrated recipe + negative results |
| `orgs/figment/pipeline/aesthetic-recipe.md` | DONE | Register spec + model search |
| `orgs/figment/pipeline/workflows/*.json` | DONE | Production templates, "editorial" removed, FaceDetailer fixed |
| `orgs/figment/pipeline/{qa_stamp,build_grading_board,blind_pool}.py` | DONE | QA toolkit, self-tested |
| `orgs/figment/pipeline/lora-training.md` | DONE | kohya recipe + 8GB analysis |
| `orgs/figment/pipeline/daniel-provisioning.md` | DONE | What Daniel must supply |
| `orgs/figment/research/r1-r10*.md` | DONE | Ten research reports |
| `personas/trial-02/casting-sheet/` | DONE | 16 images awaiting Daniel's pick (UNTRACKED) |
| `personas/trial-01/lora/tr1al01woman_v1.safetensors` | DONE | Proof-of-chain LoRA (UNTRACKED) |
| `personas/` (646 MB) | UNTRACKED | Deliberately not committed — image bulk |

### Exact Next Step

**Daniel picks one of the 8 women in `personas/trial-02/casting-sheet/`.** Agent's picks
were person03 (best identity lock + hourglass), person01 (most exact standardisation),
person06 (most photogenic).

Then, for the chosen woman: build a ~40-image LoRA training set using the calibrated
recipe in `lever-table.md` (balanced angles/distances/lighting/wardrobe, captions
describing only what VARIES, with the trigger token), train on RunPod (~$0.52, 45 min,
chain already proven), and verify identity locks across angles and lighting.

### Load list

- `orgs/figment/pipeline/GUARDRAILS.md`  <- read first, binding
- `orgs/figment/pipeline/lever-table.md` <- the calibrated recipe
- `orgs/figment/pipeline/RESUME.md`
- `orgs/figment/pipeline/aesthetic-recipe.md`
- `orgs/figment/README.md`
- `personas/trial-02/casting-sheet/NOTES.md`
- `orgs/figment/pipeline/daniel-provisioning.md`

# figment anchor-first build handoff — 2026-09-03

**Topic:** One day took figment from an SDXL casting sheet to a live pod pipeline on modern
open-weight models, ran two casting rounds that bracketed the target register, and ended with
the operator's pivot: the first creator starts from HIS reference image, not from prompt
casting. This handoff is the mandate for the terminal that picks up when the reference set
lands: brainstorm, spec, plan, and build the end-to-end system under adversarial review,
overnight, stopping at the first human gate.

Branch `claude/figment` (worktree `C:\Users\danie\kb-worktrees\figment`), tip `48f54c03`,
59 commits ahead of main, nothing merged. `personas/` is untracked by design (image bulk).

## Read this first — the mandate

`orgs/figment/MANDATE.md` is the operator's end goal (nine stages, studio dashboard, standing
research streams, LoRA scope, tier constraint). `orgs/figment/pipeline/GUARDRAILS.md` binds on
top of it. `orgs/figment/pipeline/look-spec-v2.md` §0 carries the operator's taste anchor
(ABG/e-girl glam register) which overrides the study's lighter centre.

### What WORKED (with evidence)

- **RunPod pod harness, HTTP transport** (`orgs/figment/pipeline/pod/runpod_run.py`, 115
  tests): create → bootstrap as container start command → ComfyUI over the RunPod proxy →
  jobs → downloads via `/view` → terminate → verify absence → ledger. Evidence: 7 successful
  live runs (smoke3, arm A 53/54 with the 60-min watchdog firing exactly as designed, arm B
  54/54, probe A/B 12/12 each), every pod terminated+verified, `status`/`probe` show zero
  pods afterwards. Two opus adversarial passes folded in (money-leak, key-leak, correctness).
- **Fail-closed paths proven live**: readiness timeout → watchdog kill (first smoke);
  create-uncertain + empty name scan → `POD STILL RUNNING` banner instead of a false
  "verified" (probe B first attempt; the pod had in fact never been created); placement on a
  denylisted host → 4 bounces then `PLACEMENT FAILED` with every pod verified absent.
- **Model choice**: Z-Image Base = casting/look base (steerable, Instagram-coded), FLUX.2
  klein 4B Base = identity engine (native 1-4 reference `ReferenceLatent` path, Apache-clean;
  r12 §1 verified by sonnet 15/17). Klein renders ~10 years older than Z-Image on identical
  briefs (trial-03 and trial-04 sheets).
- **Research committed**: r11 (modern bases, claim-checked), r12 (identity + tuning paths,
  claim-checked), r13 (10sorlabs site + IG: a solo ComfyUI-tutorial creator whose pipeline is
  ours in miniature — anchor → dataset → LoRA → generate → skin-enhancer → WAN motion; the
  skin-enhancer default is what we turn OFF), look-spec-v2 (opus study of 15 accounts).
- **Scaffolding committed and tested**: calibration grid driver + 7 axes
  (`pipeline/calibrate/`), diffusion-pipe templates + training-pod manifest + identity checker
  (`pipeline/train/`, permissive-licence models only), harness `uploads:`/artifact mode for
  training pods (unreviewed by opus — see Not Tried).
- **Spend**: $1.97 across 17 pods on 2026-09-02 (ledger `ledgers/cost/figment-2026-09-02.tsv`,
  two rows hand-corrected after the accounting fix). Cap $25. Every pod start was gated.

### What Did NOT Work (and why)

- **Prompt casting, twice.** trial-03 (six women × 3 shots × 3 seeds × 2 models) rendered the
  "Instagram baddie" register (contour, bronzer, filled lips, composed smoulder, age 24-30)
  because the prompts literally asked for "soft glam, luminous bronzer, glossy lip, hoops".
  trial-04 (rewritten from look-spec-v2: "almost no makeup, slouched, mid-blink") overshot to
  plain, frumpy, sour, fuller bodies. Neither is the reference set. Lessons: prettiness /
  photogenic quality must be NAMED; body adjectives are weak on both models; colour words are
  taken literally ("blue-black" → blue hair); the operator's real taste is ABG glam (see
  look-spec §0), not the study's averaged "light, self-applied" centre.
- **Calibration grid-01 never ran (5 attempts, ~$0.13).** Secure-cloud host `qvf79yutw3t2`
  refuses anonymous GitHub git (`could not read Username for 'https://github.com'`, rc 128) and
  was the ONLY free secure 4090 for an hour; community host `3kvoag8r0489` had no working CUDA
  driver in-container (ComfyUI v0.20.1 → comfy_kitchen → triton `0 active drivers`) discovered
  only after a 20 GB download. Fixed in harness: host denylist + auto-learned bad hosts,
  ComfyUI tarball fallback, GPU/torch.cuda/comfy-import preflight BEFORE downloads. The grid
  is PARKED: its casting purpose is superseded by the anchor pivot; it remains useful later for
  scene/wardrobe/light calibration.
- **SSH transport** (harness v1-v3): pods have no login key; generating/holding one is out of
  bounds (constitution + hook). Replaced by the HTTP proxy transport. Do not reintroduce SSH.
- **Two concurrent creates in the same second** → one failed with no logged error (now logged).
- **Background bash dispatches** got reaped mid-run; `--follow-up` loses `--cwd`. Use detached
  `Start-Process` + Monitor, fresh dispatch with `--cwd`.
- **`tail -F` in Git Bash** never sees another process's writes on Windows; poll files.
- **Auto-mode classifier** blocked Bash reads/edits of the casting brief mid-session (topic
  sensitivity), not the underlying work. An overnight terminal needs a permission profile the
  operator sets deliberately; file tools (Read/Edit/Write) passed where Bash heredocs did not.

### What Has NOT Been Tried Yet

- **The anchor-first path itself** (MANDATE stages 1-3): klein one-reference expansion of the
  operator's anchor into a balanced multi-view set (r12 §10 first run: 24 cells, ESTIMATE
  $0.11-0.20), identity scoring with `pipeline/train/identity_check.py`, then persona LoRA via
  diffusion-pipe on a training pod using the harness `uploads:`/artifact mode.
- **Opus adversarial review of the harness uploads/artifact code path** (596 lines, commit
  9689691e) — REQUIRED before the first training pod.
- **Register LoRA** from human-selected outputs (r12 §7) and the operator's ABG taste anchor.
- **Register scorer** (numeric distance of generated cells to the reference set) — blocked on
  the operator approving an evaluation-only screenshot cache (GUARDRAILS forbids downloads).
- **Face detailer / consistency / upscale passes** on the new bases (MANDATE stage 5);
  Wan 2.2 image-to-video with the same passes (stage 6).
- **Reference-cohort virality research** and **platform trend research** (MANDATE research
  streams) — nothing started; the inspiration board (artifact 7f30f554) is the seed list.
- **Studio dashboard** on the kb agent architecture (MANDATE) — design question for the spec.
- Test 0 (Instagram reach), Fanvue written confirmation, owned GPU — operator provisioning.

### Current State of Files (all on `claude/figment`)

| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/figment/MANDATE.md` | DONE | Operator end goal; read first |
| `orgs/figment/pipeline/GUARDRAILS.md` | DONE | Binding |
| `orgs/figment/pipeline/look-spec-v2.md` | DONE | 15-account study + operator corrections + ABG taste anchor (§0 wins over §2) |
| `orgs/figment/pipeline/pod/` | DONE | Harness (115 tests), README documents every guarantee; `manifest.example.yaml` |
| `orgs/figment/pipeline/bakeoff/` | DONE | trial-03/04 briefs + manifests (history of the two misses), MANIFESTS.md |
| `orgs/figment/pipeline/calibrate/` | DONE (parked) | grid driver, 7 axes, grid-01 manifests (secure + community) |
| `orgs/figment/pipeline/train/` | DONE (unreviewed) | diffusion-pipe templates, training-pod manifest, identity_check.py, HARNESS-CHANGES.md |
| `orgs/figment/research/r11..r13*.md` | DONE | Bases, identity/tuning, 10sorlabs |
| `personas/trial-03/`, `personas/trial-04/`, `personas/calibration/` | UNTRACKED | 108 + 24 images + run.json records; model baselines |
| `ledgers/cost/figment-2026-09-02.tsv` | DONE | On ops with this handoff |
| `orgs/figment/{_index,STATE,contract}.md` | TODO | Absent; MANDATE.md + this handoff stand in |

### Exact Next Step

When the operator supplies the reference image set (`personas/<creator-slug>/anchor/`): open
an architectural brainstorm (superpowers:brainstorming → spec at
`docs/superpowers/specs/2026-09-xx-figment-creator-001-design.md` → writing-plans) covering
MANDATE stages 1-9 and the dashboard, using 10sorlabs' step order as the skeleton and this
repo's harness as the foundation. Then run the build overnight with these STOP rules: stop at
every human gate (anchor pick, identity grid eye-gate, register proof, batch approval, any
spend above the manifest ceilings, anything explicit-tier); every pod through the harness with
`--max-usd`; adversarial review (opus) before any spend-controlling or identity-scoring code
runs live; codex/claude split by stakes per BOSS.md; model graded by transcript grep.

### Load list

- `orgs/figment/MANDATE.md`
- `orgs/figment/pipeline/GUARDRAILS.md`
- `orgs/figment/pipeline/look-spec-v2.md` (§0 first)
- `orgs/figment/research/r12-identity-and-tuning.md` (§1, §10)
- `orgs/figment/pipeline/pod/README.md`
- `orgs/figment/pipeline/train/README.md` and `HARNESS-CHANGES.md`
- `orgs/figment/research/r13-10sorlabs-ig.md` (the pipeline pattern)
- `orgs/figment/research/w0-decision-board.md` (tier/lane decisions)
- `memory/claude-boss.md` (2026-09-02/03 sections)
- Skills: superpowers:brainstorming, superpowers:writing-plans, dispatch-codex

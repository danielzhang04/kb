# Poyais L24 optimized image-engine bakeoff handoff — 2026-08-06

## Context

Daniel asked which image engines can replace the current Second Take visual-generation path while retaining the actual MacGregor/Poyais house style. This is the optimized follow-up to the governed 2026-08-05 four-wing test that stopped 0/4 engines at STEP1 before any scene generation.

The earlier result was not the final quality verdict. Its style gate treated gradients as forbidden even though the MacGregor canonical and approved swamp plate visibly use controlled soft cel shading and subtle gradients. This run kept the same art style by making the actual canonical/plate authoritative, created neutral pose and expression guides, researched each engine's native prompting conventions, and ran a fixed two-stage bakeoff with one retry maximum per failed stage.

Private inputs were uploaded to a fresh RunPod pod only after Daniel explicitly authorized the MacGregor canonical, swamp plate, neutral guides, prompts, and runners.

## Done

### Durable external project

Everything required to inspect or recreate the run is saved at:

```text
C:\Users\danie\second-take-open-model-bakeoff\optimized-l24
```

Start with:

- `README.md` — complete pod provisioning, setup, execution, download, board rebuild, validation, and teardown runbook
- `artifact-board.html` — 19-image comparison board with all first passes/retries and prompt panels
- `report.md` — concise findings, selections, cost, fairness, and research basis
- `optimized-prompts.json` — exact model-specific STEP1/STEP2 prompts, retry prompts, sizes, and seeds
- `outputs/` — all 14 generated PNGs; the 12 open-model PNGs have JSON metadata neighbors
- `setup-remote.sh`, `run_open_models.py`, `run_hidream.py` — reproducible runners

The project root now also has `C:\Users\danie\second-take-open-model-bakeoff\README.md` routing future terminals to the definitive optimized run and warning that older boards are historical rather than authoritative.

### Final verdict

Only two engines merit replacement work:

1. **OpenAI Chat ImageGen / GPT-Image-2 — production-ready replacement.** Best overall STEP1 and STEP2. It preserved identity, costume, pose, expression, scene style, and integration most consistently.
2. **Qwen-Image-Edit-2511 — viable replacement behind validation gates.** Best open model for MacGregor identity/costume and exact swamp-plate retention. It needs explicit checks for expression, hands, and scene scale.

Do not promote the others:

- **FLUX.2 Klein 4B:** extremely fast, but no STEP1 attempt held both face and crossed-arm pose. STEP2 could reconstruct the pose, but expression control remained unstable.
- **HiDream O1 Image:** clean high-resolution rendering and a usable first STEP1 figure, but both STEP2 attempts ignored the one-third-height instruction and made MacGregor roughly twice the requested scale.

### Attempt-level findings

| Engine | STEP1 | STEP2 | Replacement status |
|---|---|---|---|
| OpenAI GPT-Image-2 | Pass on first attempt | Pass on first attempt | Yes |
| Qwen-Image-Edit-2511 | First: excellent identity/pose/hands, retained canonical smirk. Retry: neutral face, severely malformed hands. First selected. | Both plate-faithful; retry improved root occlusion and scale slightly but remained oversized and inherited the smirk. | Yes, gated |
| FLUX.2 Klein 4B | First erased the face. Retry restored face and lost crossed arms. No passing attempt. | First scene reconstructed crossed arms and nailed scale, but expression became angry. Retry became a chin-thinking crouch. | No |
| HiDream O1 Image | First landed crossed arms and thinking face with ear/hand/cuff drift. Retry lost pose and changed boots. First selected. | First was oversized with nose/ear/angry mouth. Retry improved face but stayed grossly oversized. | No |

### Fairness and seed conclusion

There is no evidence of seed leakage. Seeds were passed only to the local latent-noise generator, never embedded in prompts or reference images.

- STEP1 first/retry seeds: `762761958`, `1672861958`
- STEP2 first/retry seeds: `1907043032`, `953852944`
- Same stage seed sequence for every engine
- One predeclared corrective retry maximum
- No prompt accretion or unlimited cherry-picking
- Historical Gemini L24 baseline was comparison-only and never used as a seed/reference

The failures are ordinary multi-reference control failures: engines trade off identity, pose, expression, hands, and scene scale differently.

### Hosted setup and cost

- RunPod secure L40S 48 GB
- Template `runpod-torch-v280`
- 80 GB container disk; 160 GB network volume at `/workspace`
- Qwen: current Diffusers, 40 steps, true CFG 4, blank negative prompt
- FLUX: 4 distilled steps, guidance 1
- HiDream: official full model, 50 steps, CFG 5, shift 3; known-good repo commit `2c2d29ff729e48f33e41f49edfdbd81d5ac103b4`
- Rental: 03:59:50–05:00:43 UTC, 1.015 hours at $0.99/hour, approximately $1.00
- Pod `jt52dz6tlfgmft` was deleted after all outputs/metadata were downloaded; final `runpodctl pod list` returned `[]`

The first bootstrap attempt hit Ubuntu PEP 668 because it tried global `pip`. The saved setup now uses `/root/open-model-venv` and `/root/hidream-venv`; do not revert that fix.

### Verification

- All 14 output PNGs retained locally.
- All 12 open-model JSON metadata files retained locally.
- Board structural check: 19 image tags, 19 embedded WebP thumbnails, 19 unique full-PNG links, zero missing targets, four prompt sections, zero mojibake hits.
- Python runners and board builder compile.
- Prompt JSON parses.
- Individual source images were reviewed at original resolution.
- In-app browser discovery returned no backend, so the HTML board did not receive live browser-layout QA in this session.

## Remaining

1. Treat the replacement decision as **OpenAI primary / Qwen optional open-model path**. Do not spend integration time on FLUX or HiDream unless a materially newer model changes their control behavior.
2. Before adding Qwen to Forge, design hard validation gates for:
   - neutral versus smug/angry mouth,
   - coherent four-digit hands,
   - required pose retention,
   - character-height ratio and lower-left placement,
   - scene-plate structural similarity.
3. Decide whether the production architecture should use:
   - OpenAI Chat ImageGen as the default with Qwen as a self-hosted fallback, or
   - a human-selectable provider switch for cost/privacy testing.
4. When implementation is authorized, freeze prompts at the final provider boundary and compare them with Forge dry-run output before spending. The prior 2026-08-05 lesson about frozen prompts missing live injections still applies.
5. Open `artifact-board.html` in a browser and perform the one remaining layout/lightbox QA check before presenting it outside the team.
6. This is a findings handoff, not authorization to alter the live Forge provider path or publish any content.

## Gotchas

- The old 2026-08-05 0/4 memory entry remains valid as a record of that governed protocol, but it must not be quoted as the current optimized quality verdict.
- Qwen's first STEP1 looks nearly ideal at a glance; the mouth is the canonical smirk rather than the neutral thinking guide.
- Qwen's corrective STEP1 demonstrates why automated facial compliance cannot be judged independently of hand anatomy.
- FLUX's excellent scene-scale result does not erase its failed STEP1 control contract.
- HiDream silently snaps requested sizes: 1024×1536 became 1664×2496; 1536×864 became 2560×1440. Always record requested and actual dimensions separately.
- `/workspace` can persist on a RunPod network volume, but `/root` environments, clones, and Qwen's `/root/.cache` do not survive pod termination.

## Load list

Read these first on resume:

1. `orgs/faceless-youtube/STATE.md`
2. `orgs/faceless-youtube/contract.md`
3. `orgs/faceless-youtube/channels/the-second-take/dna.md`
4. `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md`
5. `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`
6. `orgs/faceless-youtube/docs/superpowers/specs/2026-07-08-image-generation-rebuild-design.md`
7. External runbook: `C:\Users\danie\second-take-open-model-bakeoff\optimized-l24\README.md`
8. External board: `C:\Users\danie\second-take-open-model-bakeoff\optimized-l24\artifact-board.html`
9. External exact prompts: `C:\Users\danie\second-take-open-model-bakeoff\optimized-l24\optimized-prompts.json`


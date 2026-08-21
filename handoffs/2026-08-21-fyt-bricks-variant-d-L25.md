# Bricks Variant D — L01–L25 generated + analyzed, human decision pending — handoff 2026-08-21

**Topic:** Boss session extended the Variant D trial from L01–L12 to L01–L25 on Daniel's instruction ("use D, author and generate another 13, then analyze"): restored the 16 approved character canonicals the restoration branch had dropped, generated L13–L25 with the Task-3 recipe, ran a blind D-vs-LIKED analysis over all 25, and published a 25-row board. Consumes and replaces `2026-08-21-fyt-bricks-variant-d-board.md` (deleted in this push). Resume = Daniel's verdict on the L01–L25 board; nothing in flight.

All work lives in the STANDALONE CLONE `C:/Users/danie/kb-clones/bricks-arc`, branch **`claude/bricks-variant-vd`** (pushed, tip `da651c6c`). Main kb checkout untouched by this arc (another terminal has it on `claude/dashboard-v3`).

## Daniel's rulings this session (binding)
- L01–L12 board viewed; instruction: continue with D, author + generate L13–L25, then analyze (implicit spend approval for the wave; actual 20 calls $2.68).
- Prior rulings stand (chains where a beat holds the camera; blue/orange disliked as default not banned; occupancy bimodality is the defect; no when/when-not rules; prompts must not grow; exemplar stays).

### What WORKED (with evidence)
- **Registry restore** `04d4dec1` — root cause of the L16–L20 blocker: the variant branches fork from the poyais restoration whose `visual-kit/registry/registry.json` carries 9 characters; the 16 canonicals minted later (`rival-pc` @ `693b0fff`, `drive-maker`, `ibm-suit`, `line-worker`, `terry-johnson`, …) were dropped by the revert while their ref PNGs stayed in `visual-kit/refs/`. Ported from `974ca0e6` (schema identical, 9 originals byte-identical). Forge dry run: L16 seeds `pc-boxy`+`rival-pc` canonicals, L18 seeds `drive-maker` via a STEP-1 figure card. `needed_assets` = `compaq` only. No asset was minted or approved.
- **Wave 2 gen** `ed2b7010` — codex sol/high, 3387 s: 20 calls = 13 shots + 5 single retries (L13 invented labels, L15 shared trunk, L16 foreground dominance, L17 rival acting/scale, L18 card expression) + 2 `drive-maker` figure cards; $2.680 conservative / $0.780 provider. 13/13 verified, holds L13→L14 and L18→L19→L20 built parent-before-delta; SHA-256 provenance in `variant-frames/vd/manifest.json` (now 25 rows, 37 calls, $4.958 cumulative). Ledger rows on ops `ledgers/cost/claude-boss-2026-08-21.tsv` (`34a8fbbb` wave 1, `5578a503` wave 2).
- **Independent Sonnet pixel checks** (transcript-grep verified `claude-sonnet-5`): wave 1 11/12 concur (L04 dissent), wave 2 13/13 concur. Both recorded as "Boss grading note" blocks in `genlog-vd.md`.
- **A1 record consistent** `0494dd28` — fragment mirror 45/45, no-growth table current, max delta 0 vs vb.
- **Blind analysis** `taste-audit/variant-d-L01-L25-analysis.md` (sol, 1332 s, opened 50 frames, 25/25 rows; no numeric imperatives, no winner). Headline observations: 4 valid holds (pc-arrival, retail-shelf, drive-memory, drive-seller) + 2 missed seams (L16→L17, L24→L25); every stage field has a visible light/material cause; occupancy D 0/1/2–3/4–6/7+ = 16/2/2/3/2 vs LIKED 11/8/2/0/4 — D's 4–6 bucket is L18–L20's authored background competition, the 1-figure bucket is where D is thinnest vs LIKED; crowd geometry passes on L08/L09; row preference **LIKED 18 / D 7**; register axes: D crisper and cleaner but flatter (less grain, dust-beam light, mood grade, accent isolation) and more literal where LIKED used a memorable symbol. Weakest D first: L10, L25, L03, L02, L23, L20, L09, L11.
- **Board** `ab59a3c2` + `da651c6c` — `scratchpad/boards/build_vd25_board.py` (reuses helpers from the vpw3 and variant builders), 25 rows D | LIKED, 51 images, 0 missing, 4.8 MB, analysis §1–5 embedded, neutral decision block. Artifact **https://claude.ai/code/artifact/12e75c13-1aa1-44ff-8efc-54f70a74aa6f** (new handle; the A/B/C/D L01–L12 board stays at `53c84a37`).

### What Did NOT Work (and why)
- **First vd25 board rendered only 13 LIKED frames** — the builder inherited `build_vpw3_board.py`'s `allowed=shot_id in LIKED_SHOT_IDS` render gate; fixed in `da651c6c` (the 13 ids are a badge, not a gate). Lesson: when a brief says "adapt builder X", name the rules of X that must NOT carry over.
- **Forge resolves `--out` relative to the org root** — a boss probe with a repo-relative `--out` wrote a stray `orgs/faceless-youtube/orgs/...` spec (cleaned). Use absolute paths.
- **Cumulative D spend $4.96** sits at the $5 figure the plan called a per-wave cap; a third wave needs a fresh explicit cap from Daniel.

### What Has NOT Been Tried Yet
- Daniel's verdict on the 25-row board (keep D / keep D with edits / iterate / revert) and which D changes survive regardless.
- Analysis-suggested repairs if D continues: re-author L16→L17 and L24→L25 as holds; symbolic rather than literal staging for L10, L20, L23, L25; hero-object focus on L11; the L04 dominance fix (retry allowance spent).
- Render-register experiment (grain / dust-beam / painterly grade) — still the dominant viewer-felt gap vs LIKED and doctrine-independent.
- `compaq` canonical (human asset gate) before L36 can seed; L26–L45 gen is authored (45-shot A1) but ungenerated.

### Current State of Files (clone, branch `claude/bricks-variant-vd` @ `da651c6c`)
| File | Status | Notes |
| ---- | ------ | ----- |
| `visual-kit/registry/registry.json` | DONE | 25 characters (16 restored from 974ca0e6) |
| `V/shots.json`, `V/scratchpad/vpw-var/fragment-A1-vd.json`, `plan-vd.md` | DONE | 45-shot A1 under D; 10 single retries folded; mirror exact |
| `V/scratchpad/variant-frames/vd/L01–L25.png` + `manifest.json` | DONE | 25 verified, SHA-256 provenance, 37 calls $4.958 |
| `V/scratchpad/vpw-var/genlog-vd.md`, `spec-vd-*.json`, `retry-vd-*.json`, `figure-verdicts-*.json`, `board-L1*.html` | DONE | both waves + boss grading notes |
| `V/assets/scenes/manifest.json`, `assets/_review/merged.json` | DONE | L01–L25 entries carry D provenance |
| `V/scratchpad/taste-audit/variant-d-blind-review.md` (L01–L12 A/B/C/D), `variant-d-L01-L25-analysis.md` (D vs LIKED) | DONE | blind, neutral |
| `V/scratchpad/boards/build_variant_board.py` + `variant-board.html` (53c84a37), `build_vd25_board.py` + `vd25-board.html` (12e75c13) | DONE | both published |
| `kb-clones/bricks-arc-v{a,b,c}/`, `.pytest-vd-task1-baseline/`, `tmp/pytest-img-go-with-edits/` | TODO | ACL-locked residue; needs an elevated shell |

(`V` = `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`.)

### Exact Next Step
Open https://claude.ai/code/artifact/12e75c13-1aa1-44ff-8efc-54f70a74aa6f, read §5 of the embedded analysis, and reply keep D / keep D with edits (name rows) / iterate (note) / revert — plus which D changes survive regardless. If D continues: fold the two missed seams and the literal-staging rows into a repair wave under a fresh explicit spend cap, then the render-register experiment.

### Load list
- this file; memory `bricks-taste-forensics-arc.md`, `occupancy-middle-ground.md`, `detached-codex-dispatch.md` (personal memory dir)
- clone: `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md`, `variant-d-plan.md`
- clone: `V/scratchpad/taste-audit/variant-d-L01-L25-analysis.md`, `V/scratchpad/vpw-var/genlog-vd.md`, `V/scratchpad/variant-frames/vd/manifest.json`, `V/shots.json`, `V/scratchpad/boards/build_vd25_board.py`
- skills: `dispatch-codex` (detached launch pattern), `save-session`

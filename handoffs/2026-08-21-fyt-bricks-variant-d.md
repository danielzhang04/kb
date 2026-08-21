# Bricks Variant D handoff — 2026-08-21

**Topic:** Fourth doctrine variant (D) for the Bricks L01–L12 board: research → spec (4 adversarial rounds) → plan (3 rounds) → Task 1 doctrine build DONE → Task 2 A1 authored + critic'd → repair round IN FLIGHT → gen → 4-column board. Consumes `2026-08-20-bricks-variant-trial.md` (deleted in this push).

All work lives in the STANDALONE CLONE `C:/Users/danie/kb-clones/bricks-arc`, branch **`claude/bricks-variant-vd`** (pushed, tip `6d279908`; off vb tip `17becaaf`). Main kb checkout untouched by this arc.

## Daniel's rulings this session (binding)
- Chains: where a beat naturally holds the camera; never forced, never overloaded.
- Blue/orange: disliked as a *default*, NOT banned — remove the mechanism "smart and logically".
- Occupancy: bimodal (empty worlds vs 50-person crowds) is the defect; the 1–3-figure middle is missing; "no more when/when-not rules"; crowds of 50 "have no point".
- Exemplar remint: "either/whichever" → kept this round to isolate the doctrine change.
- Prompt length: his hunch was "longer/more confusing" vs the liked era — measured: authored prompts are SHORTER (liked 73 → vb 39 words median) but carry rig recitation + negations; D removes duplication.

### What WORKED (with evidence)
- **Research corpus** (4 forensics, each adversarially reviewed; codex sol) — `V/scratchpad/taste-audit/vd-{chain,palette,occupancy,crowd-density}-forensics*.md` + `crowd-probe/` (5 gens, contact sheet). Headlines: liked run 44 chains (21×2/17×3/6×4), parent-seeded; vb's A1 plan lock pre-enumerated stages ("all other cuts standalone") — author's tightening, not doctrine. Palette off-frames = decorative colour ("convey the era") or a template repeated across stages (vc's teal/tobacco L05–L10); liked-era per-stage palette commitment was dropped by the restoration. Occupancy: all 36 variant frames 0-or-7+ humans vs liked 5/25 in 1–3; authoring-born (no variant authors a pair). Crowds: engine ignores counts ("exactly twelve" → 16–20), lineup exemplar tiles walls and leaks top hat/bonnet when the recitation is trimmed; bounding geometry + empty near zone is the lever (probe A4/A4r).
- **Spec rev 4** `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md` — verdicts `variant-d-spec-adv.md`, `-adv-r2.md`, `variant-d-plan-adv.md` all folded. Four in-place criterion changes; `--fragment` lint contract; strict per-shot no-growth; D-frame provenance; pair transport = backticked prompt tokens (forge never reads `cast`).
- **Plan v3** `variant-d-plan.md` (@ `d95a3040`, 4 tasks / 66 steps, verdict trace at top).
- **Task 1 doctrine build DONE** (`2ad0ccaa`): suites VPW 114 + IG 174 = 288 green (vb baseline 267); zero sweep (literal + paraphrase) clean; diff-check + mojibake clean; forge §2d probe passes (`Kit.prompt_for(..., figures={"crowd": True})` carries the clause; identity/style descriptors byte-identical to vb); `--fragment` verified by the boss on vb's 45-shot file (2 sizing HARDs without flag, 0 with; `fragment scope: covered 293/1628 script words`). Log: `variant-d-task1-log.md`.
- **Task 2a A1 authored under D** (`34e298f5`): 45 shots, 6 holds (`pc-arrival` L05→06, `retail-shelf` L07→08→09, `pc-rivalry`, `drive-seller`, `brick-carton`, `founder-exit`), crowds only L08–L09 bounded beyond the brass rail, 45/45 no-growth ≤0 (median 31 words), lint `--write --fragment` 0 HARD. Record: `V/scratchpad/vpw-var/plan-vd.md`, `fragment-A1-vd.json`, archived `V/shots.pre-vd.json`.
- **Independent critic** (`0b897c87`): `V/scratchpad/vpw-var/critic-vd-A1-findings.md` — **ship-with-edits**, 13 findings; only 3 inside L01–L12 (L12 drive reads external; L04 prose acting → registry pose tokens; L01 hook shares attention). Did NOT flag L07's object-led staging.

### What Did NOT Work (and why)
- **Harness background shells were killed** twice (~15–20 min after turn end, not by Daniel) taking codex trees with them → ~1.5h lost. Fix in force: launch via `Start-Process` detached + `Monitor` on pending markers (memory `detached-codex-dispatch`).
- **sol/xhigh workers timed out** (2700–3300s) when they loaded the synthesis skill / spawned sub-reviewers. Fix: briefs say "no sub-agents, write incrementally, N-minute budget"; salvage via `--follow-up` asking for the verdict as text (read-only; follow-ups lose `--cwd`).
- **Dispatch timeout not enforced**: the Task-1 adversarial reviewer ran 2h23m past its 2400s timeout (stuck looping PowerShell temp-dir setup); killed by `taskkill /T`. Its partial verdict (F2 leftover cast-authority paraphrases, F1 weak test) was fixed by a terra worker. Check `scripts/codex_dispatch.py` timeout path at some point.
- Boss probe pitfalls: Git-Bash `tasklist /FI` reports live pids dead (use `powershell Get-Process`); linting from a temp dir without the channel kit yields 13 spurious "token does not resolve" HARDs.
- Spec rev 1–3 each REJECTED by adversarial review for: quotas in disguise (≥8/12, ≤39 words, zero-pair gate, <20% height), a "never" + lexical crowd lint, palette basis in `notes` only (forge drops notes), `cast` array assumed engine-read. All fixed in rev 4 — do not reintroduce.

### What Has NOT Been Tried Yet
- Task 3 gen L01–L12 and Task 4 board (briefs staged, see Next Step).
- Spec §7 window risk: liked L01–L16 is also 0-or-crowd; if the board is ambiguous on occupancy, extend D only to L01–L18 (or gen L32 `ibm-suit`+`miniscribe-rep` `handshake` as a pair-route demonstration frame, $0.13).
- Open items for Daniel: crowd exemplar remint (bounded cluster, period-neutral dress — probe A3 evidence); style tile (89% orange) A/B; render register (universal unclosed axis); `needed_assets` for `rival-pc`/`drive-maker`/`terry-johnson`/`ibm-suit`/`line-worker` (same canonical gap vb carried).

### Current State of Files (clone, branch `claude/bricks-variant-vd`)
| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md` | DONE | rev 4 |
| `…/variant-d-plan.md` | DONE | v3; Tasks 1–2a executed |
| `…/variant-d-*-adv*.md`, `variant-d-task1-log.md` | DONE | verdicts + build log |
| `…/briefs/brief-task{1,2,3}*.md`, `brief-critic-vd.md` | DONE | worker briefs (resume material) |
| Doctrine stack (VPW SKILL/schema/critics/lint, IG SKILL/build_review_artifact/palette_metrics, grammar, bible, universal, motion-planner, render-builder, tests) | DONE | Task 1, 288 tests |
| `V/shots.json`, `V/scratchpad/vpw-var/plan-vd.md` | **WIP — uncommitted, repair worker mid-edit** | see Next Step |
| `V/scratchpad/vpw-var/fragment-A1-vd.json`, `critic-vd-A1.md`, `critic-vd-A1-findings.md` | DONE | |
| `V/scratchpad/variant-frames/vd/` | TODO | Task 3 output |
| `V/scratchpad/boards/build_variant_board.py` | TODO | add D to VARIANTS (Task 4) |

### Exact Next Step
1. **Check the in-flight repair worker** (Task 2b, codex sol, started 2026-08-21 ~00:05 UTC, 40-min timeout): marker `%LOCALAPPDATA%\kb-codex-dispatch\pending\6a87cce1-322cb7ba.json` (gone = finished); its footer/final message is in `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\d3392573-641c-44b7-b8ea-fed87b1ba25e\scratchpad\detached-brief-task2-repair.md.out`; log `%LOCALAPPDATA%\kb-codex-dispatch\logs\6a87cce1-322cb7ba.jsonl`. It edits `V/shots.json` + `plan-vd.md` (+ `fragment-A1-vd.json`) in the clone. When done: verify `py -3 lint_shots.py <V>/shots.json --fragment` → 0 HARD and the no-growth table still ≤0, then `git commit` on `claude/bricks-variant-vd` ("Task 2b — critic repair"). If it died: re-dispatch `doctrine-recon/briefs/brief-task2-repair.md` (detached, `--cwd` the clone).
2. **Task 3 gen**: dispatch `doctrine-recon/briefs/brief-task3-gen.md` (codex-deep/high, `--cwd` clone, detached, 55 min; cap 24 calls ≈ $3.22 at $0.134). Commit frames + `genlog-vd.md` + `variant-frames/vd/manifest.json`; ledger row on ops.
3. **Task 4 board**: per plan Task 4 — add D to `build_variant_board.py` VARIANTS, blind reviewer applies §3.1–3.4 per shot and *reports* distributions, republish to the SAME artifact URL `https://claude.ai/code/artifact/53c84a37-9623-4ba2-a280-4ba46363b44c` (Artifact tool with `url`), then hand Daniel the link. Board = his judging surface.
4. Cleanup owed: orphaned `kb-clones/bricks-arc-v{a,b,c}` dirs (ACL-locked; `icacls /reset /T` then delete); `.pytest-vd-task1-baseline/` under `image-generation/scripts` (ACL-locked).

### Load list
- this file; memory `bricks-taste-forensics-arc.md`, `occupancy-middle-ground.md`, `detached-codex-dispatch.md` (personal memory dir)
- clone: `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md` (rev 4), `variant-d-plan.md` (Tasks 3–4), `briefs/`
- clone: `V/scratchpad/vpw-var/plan-vd.md`, `critic-vd-A1-findings.md`, `genlog.md` (vb's gen recipe)
- skills: `dispatch-codex` (use the detached launch pattern), `save-session`

# Bricks Variant D — board built, human decision pending — handoff 2026-08-21

**Topic:** Boss session finished the Variant D trial: closed the critic repair (Task 2b), generated + fresh-eyes-reviewed L01–L12 under D (Task 3), built the four-column A/B/C/D board with a blind criterion review and republished it in place (Task 4). Consumes and replaces `2026-08-21-fyt-bricks-variant-d.md` (deleted in this push). Resume = Daniel's board verdict; nothing else is in flight.

All work lives in the STANDALONE CLONE `C:/Users/danie/kb-clones/bricks-arc`, branch **`claude/bricks-variant-vd`** (pushed, tip `37f1b881`). Main kb checkout untouched by this arc.

## Daniel's rulings this session (binding)
- Task 3 spend approved 2026-08-21 (24-call / $3.216 ceiling inside the $5 wave cap). Actual: 17 calls, $2.278 conservative / $0.663 provider-table — ledgered on ops `ledgers/cost/claude-boss-2026-08-21.tsv` (`34a8fbbb`).
- Earlier rulings stand (chains where a beat holds the camera; blue/orange disliked as default, not banned; occupancy bimodality is the defect; no when/when-not rules; prompts must not grow; exemplar stays).

### What WORKED (with evidence)
- **Task 2b critic repair** `a05c2f18` — the overnight worker died mid-run (no `turn.completed`, pid gone), its file edits had landed; a terra fix-up cleared the 2 HARDs it left on L36 (`compaq` token unregistered; `handoff` with one figure → Compaq buyer staged in prose, 32 words vs vb 38) and refreshed 18 stale no-growth rows. Final: lint `--fragment` 0 HARD, 45/45 ≤ vb (max delta 0), fragment mirror 45/45, 13 dispositions (11 fix / 2 elevate; `compaq` + `rival-pc` `drive-maker` `terry-johnson` `ibm-suit` `line-worker` in `needed_assets` — the same canonical gap vb carried).
- **Task 3 gen** `785ad49f` — codex sol/high, 2631 s, vb's exact recipe (`forge.py batch` → `gen --image-size 1K --force`, 16:9). 9 bases + 3 deltas (L06, L08, L09 each after parent verified+promoted) + 5 single retries (L03 corner, L04 middle distance, L08 period clothing, L10 unmarked door, L11 drive silhouette). 12/12 verified, 0 parked; `variant-frames/vd/manifest.json` SHA-256 all match; scene-manifest edits confined to L01–L12; `genlog-vd.md` has the full call/cost record.
- **Independent vision check** (claude-sonnet-5, transcript-grep verified) concurred 11/12; **dissent on L04** (`pc-boxy` still foreground-dominant after its retry) — recorded in `genlog-vd.md` "Boss grading note". No further spend (one-retry rule).
- **Task 4 board** `37f1b881` — `build_variant_board.py` now iterates `VARIANTS` for headers/summary/decision cards (D registry entry exact per plan; honest `frame missing — <reason>` cards; absent-review placeholder; fixture test with parked D/L08 passes). Build JSON: A/B/C/D 12 each, `missing: []`, 4.66 MB.
- **Blind review** `taste-audit/variant-d-blind-review.md` — codex sol, 537 s, opened 48 frames, 12/12 D rows ruled, 5 sections, neutrality grep clean, no winner declared. Occupancy observed: 0 = 9 shots, 1 = 1 (L04), 2–3 = 0, 7+ = 2 (L08–L09). Row preferences: D 7 / B 3 / A 2 / C 0. Weakest D first: L04 (occupancy/dominance), L10 (generic carton), L09 (crowd lingers past causal subject), L02 (wig display reads surreal), L03 (corner reads as detached block). Both seams (L05→06, L07→08→09) hold.
- **Artifact republished in place** — `https://claude.ai/code/artifact/53c84a37-9623-4ba2-a280-4ba46363b44c` (label `variant-d-added`); prior A/B/C URL remains canonical. Republished the existing Bricks Variant Trial Artifact in place; D is now the fourth column, and the prior A/B/C URL remains canonical.

### What Did NOT Work (and why)
- **Overnight repair worker `6a87cce1` died** ~14 min in (log stale, pid gone, marker orphaned) — same harness-kill class as 08-20; its partial edits were sound and salvaged. The next dispatch's orphan sweep published its FAILED card.
- **A `run_in_background` Bash block that itself launched a dispatch with `&`** — worked this time (marker appeared) but is the exact pattern that died before; use `Start-Process` detached for anything expected to outlive the turn.
- **The 08-20 handoff's "1–3-figure middle" hope did not materialise in L01–L12**: D's visible occupancy is still 0-or-crowd (9/1/0/2). The blind reviewer attributes it to the script window (no 1–3-figure subject acts in L01–L12), not the criterion. See spec §7 window risk.

### What Has NOT Been Tried Yet
- Daniel's board verdict (A / B / C / D / iteration note) and the "which individual D changes survive" question.
- Spec §7: extend D to L01–L18 or gen L32 `ibm-suit`+`miniscribe-rep` `handshake` as a pair-route demonstration frame ($0.13) if the board is ambiguous on occupancy.
- Open items carried: crowd exemplar remint (bounded cluster, period-neutral dress); style tile (89% orange) A/B; render register (universal unclosed axis); `needed_assets` for the 6 elevated identities (human asset gate).
- L04 retry-2 is NOT allowed under the plan; a re-author lives in the next wave if D is picked.

### Current State of Files (clone, branch `claude/bricks-variant-vd` @ `37f1b881`)
| File | Status | Notes |
| ---- | ------ | ----- |
| `V/shots.json`, `V/scratchpad/vpw-var/fragment-A1-vd.json`, `plan-vd.md` | DONE | 45-shot A1 under D; mirror exact; no-growth table current |
| `V/scratchpad/variant-frames/vd/L01–L12.png` + `manifest.json` | DONE | 12 verified, SHA-256 provenance |
| `V/scratchpad/vpw-var/genlog-vd.md`, `spec-vd-*.json`, `retry-vd-*.json` | DONE | 17-call record + boss grading note |
| `V/assets/scenes/manifest.json`, `assets/_review/merged.json`, `figure-verdicts-vd-*.json` | DONE | L01–L12 entries only |
| `V/scratchpad/boards/build_variant_board.py`, `variant-board.html` | DONE | 4-column, iterates VARIANTS |
| `V/scratchpad/taste-audit/variant-d-blind-review.md` | DONE | blind review, 106 lines |
| `orgs/faceless-youtube/doctrine-recon/*` (spec rev 4, plan v3, adv verdicts, briefs) | DONE | unchanged this session |
| `kb-clones/bricks-arc-v{a,b,c}/`, `image-generation/scripts/.pytest-vd-task1-baseline/` | TODO | ACL-locked residue; `icacls /reset /T` then delete (not blocking) |

(`V` = `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh`.)

### Exact Next Step
Open the board and reply A, B, C, D, or an iteration note; name which individual D changes should survive regardless. A fresh terminal then makes the pick permanent on the channel doctrine (Task-1 files on `claude/bricks-variant-vd` are the D candidate) and runs the full-length gen.

### Load list
- this file; memory `bricks-taste-forensics-arc.md`, `occupancy-middle-ground.md`, `detached-codex-dispatch.md` (personal memory dir)
- clone: `orgs/faceless-youtube/doctrine-recon/variant-d-spec.md`, `variant-d-plan.md`
- clone: `V/scratchpad/taste-audit/variant-d-blind-review.md`, `V/scratchpad/vpw-var/genlog-vd.md`, `V/scratchpad/variant-frames/vd/manifest.json`, `V/scratchpad/vpw-var/plan-vd.md`, `V/shots.json`, `V/scratchpad/boards/build_variant_board.py`
- skills: `dispatch-codex` (detached launch pattern), `save-session`

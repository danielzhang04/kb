# bricks taste-forensics wave handoff — 2026-08-11

**Topic:** Daniel judged the bricks generations ("a lot of shots got worse") → approved a
taste-forensics + governance-revision wave to FINALIZE the VPW + image-gen pipeline stages.
Spec + plan written and approved, SDD execution started; PAUSED mid-Task-1 fix-loop at Daniel's
request. This SUPERSEDES `2026-08-07-fyt-bricks-6c2-complete.md` (deleted this push): the
R-A..R-E gate is absorbed into this wave (R-A/R-D become elicitation themes, R-B/R-C/R-E resolve
in synthesis), L34/L39 stay parked until the figure-mechanism proposals land, **6c3 minting is
FROZEN until G4 passes**.

**Branch:** `claude/bricks-taste-forensics` @ **41c60e5** (pushed, remote == local), cut from
`claude/bricks-doctrine-reset` @ 2495d8c. Worktree `C:/Users/danie/kb-worktrees/boss-taste-forensics`
— KEEP, active arc. Main checkout sits on `claude/bricks-doctrine-reset` (dirty with 08-03/04
middle-path leftovers — tranche-b.json/notes, pearlman script.md — untouched, not this wave's).

### The two governing documents (read before anything)
- Spec: `orgs/faceless-youtube/docs/superpowers/specs/2026-08-11-bricks-taste-forensics-design.md`
  — goal (finalize, not patch), Daniel's verbatim liked lists for all 3 boards, open 4-defect
  taxonomy, EVERYTHING-on-the-table scope, **rollback-over-addition law**, **read-only until G2**,
  gates G0–G4, $5 validation cap.
- Plan: `orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-bricks-taste-forensics.md`
  — Tasks 0–9. Execution = superpowers:subagent-driven-development; SDD ledger at
  `<worktree>/.superpowers/sdd/2026-08-11-bricks-taste-forensics/progress.md` (GITIGNORED,
  machine-local — briefs, reports, review packages all live there).

### What WORKED (with evidence)
- **Task 0 COMPLETE** (commits 284fcc9 + fix 578678b, review clean after 1 round): beat-map.json
  (72 rows) + generations-index.json (71 entries). Old↔new join is DETERMINISTIC — narration
  word-for-word identical across generations (1632 words, ratio 1.0), only shot boundaries moved.
  Evidence: reviewer independently re-ran the census, 214/214 board captions byte-match.
- **Gen-B discovered**: a third shots.json generation (2026-08-05, commits 8b735ab..52b17ab era,
  248 shots, never batch-rendered). Daniel's "better MiniScribe HQ" = Gen-B id **L81** →
  today's **L83/L84** (audit-arrival beat, inside his liked old L76–88) — NOT L28; a Task-0
  fix-round corrected exactly this misattribution (Critical finding, addressed + re-verified).
  AND Task 1 found Gen-B was partly rendered: `scratchpad/L28-remint-attempt1.png` (dfb6903) is a
  live candidate for the frame Daniel remembers — on elicitation board panel P07.
- **Task 1 built + reviewed + fix-round-1 committed** (73351bc, fix 41c60e5): elicitation boards
  `scratchpad/taste-forensics/elicit-board.html` (+`-2.html`), builder `_build_elicit_board.py`
  (deterministic, byte-identical rebuilds, 35 asserts + 10 die()), `elicit-questions.json`
  Q1–Q49, 13 panels, 72 frames. Opus review: frame fidelity CLEAN (14-frame pixel forensics,
  lightbox↔source dist 0.10–0.73 vs 24–87 control). Fix round applied I1–I4 + 9 minors
  (question de-biasing, "none — nothing wrong" escape, `--board1-url/--board2-url` publish args,
  P12 L92 restored); fixer verified determinism + Q33-only answer_type change.
- Process: fresh-context task reviewers caught a Critical data misattribution and 4 Important
  board-bias defects the implementers missed — the two-stage SDD review loop is earning its cost.

### What Did NOT Work (and why)
- **beat-map.json render paths are NOT reliably the pixels Daniel judged** — 90–92 of 228
  full-board cards mismatch the same-id `_archive-pre-reset/scenes/*.png`; p6b L19/L20 in
  `_archive-pre-regen-2026-08-06/` are old-generation copies (real p6b frames:
  `_archive-pre-restore-2026-08-06/`). Tasks 3/4 MUST consume the builder's board-embed-anchored
  `board_ref`/`best_pool_match` mapping (in `_build_elicit_board.py`), never beat-map paths raw.
- **SendMessage resume of the Task-1 opus implementer failed** ("No transcript found") — long-gap
  resumes of dead subagents are unreliable; the SDD report files are the real persistent memory.
  Fresh fixer + brief + report worked cleanly.
- One old-generation frame (beat L32) survives only at 560×313 board-embed resolution (badged on
  the board; disclosed, not fixable).

### What Has NOT Been Tried Yet
- **IMMEDIATE: Task 1 scoped re-review is NOT yet dispatched.** Fix diff committed 73351bc..41c60e5;
  package already written at `<sdd-dir>/review-73351bc..41c60e5.diff` (32MB — reviewer must probe
  final files, not read it). Dispatch re-review per `<skill>/re-review-prompt.md` pattern: verdict
  I1–I4 + M2–M10 ADDRESSED/NOT, new-breakage-in-fix-diff-only; sonnet tier is fine.
- Then: publish sequence (I4): publish board 2 → rebuild board 1 with `--board2-url <its URL>` →
  publish board 1 → rebuild board 2 with `--board1-url` → republish board 2 (same file path keeps
  URL). Boss commits the URL-carrying rebuilds. Then hand Daniel both URLs → **G0 session**
  (he answers by qid in terminal; record VERBATIM to `taste-forensics/elicit-answers.md`; then
  falsifiable `hypotheses.md` traced to qids; Daniel confirms → G0 locked).
- Then Tasks 3/4/5 in parallel (archaeology sonnet / measurement sonnet / forge routing-trace
  opus — briefs must carry the carried-findings block from the SDD ledger), Task 6 synthesis
  (opus, rollback-over-addition law verbatim in brief), G2 per-proposal ruling, Task 8
  implementation, Task 9 validation mint (~$5 cap).
- M11 (from Task-1 review, deferred): one elicit-questions.json image key is a board ref not a
  path (`board:full-board.html#L29 current best`) — the G0 recorder must tolerate it.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| spec + plan (paths above) | DONE | Daniel-approved incl. his 3 corrections (finalize-goal, rollback law, read-only-until-G2) |
| `scratchpad/taste-forensics/beat-map.json` + `generations-index.json` | DONE | review-clean after fix round; path caveat above |
| `scratchpad/taste-forensics/_build_elicit_board.py` + 2 boards + `elicit-questions.json` | WIP | fix round 1 committed 41c60e5; scoped re-review pending; NOT yet published |
| SDD ledger + briefs/reports | DONE | `<worktree>/.superpowers/sdd/2026-08-11-bricks-taste-forensics/` (gitignored, machine-local — do not lose the worktree) |
| `handoffs/2026-08-07-fyt-bricks-6c2-complete.md` | CONSUMED | deleted this push; recoverable via git |
| L34/L39 parked frames | TODO | untouched in `visual-kit/_staging/`; fix falls out of G2 figure-mechanism proposals |
| 6c2 gate board defect list | PARKED | full Opus review in 08-11 session transcript; board rebuild explicitly out of this wave's scope |

### Exact Next Step
In the arc worktree: dispatch the Task-1 scoped re-review (findings I1–I4, M2–M10; package
`review-73351bc..41c60e5.diff`; verify against final files). If clean → ledger `Task 1: complete`
→ run the I4 publish sequence → give Daniel both board URLs → G0. Boss protocol throughout:
subagents for ALL substantive work, model-grep every grade
(`~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl`), workers never
commit, boss commits per reviewed unit.

### Load list
- this handoff
- the spec, then the plan (paths in "two governing documents")
- `<worktree>/.superpowers/sdd/2026-08-11-bricks-taste-forensics/progress.md` (SDD ledger — full task/fix/carried-findings record)
- `<worktree>/.superpowers/sdd/2026-08-11-bricks-taste-forensics/task-1-report.md` (board inventory + fix report)
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-forensics/elicit-questions.json`
- `memory/claude-boss.md` (2026-08-11 lessons)
- Skills: superpowers:subagent-driven-development (execution protocol), save-session (at next pause)
- Gotchas that still bind: Windows python never MSYS paths; archives/`assets/**`/`_staging` are
  machine-local in the MAIN checkout only; forge only with `--kit .../visual-kit`; STOP-file
  preamble before any work; coordination writes via temp branch → `git push origin <sha>:ops`.

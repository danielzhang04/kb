# codex-image-engine arc handoff — 2026-08-11

**Topic:** New arc: codex-CLI subscription-billed image engine for FYT as a full peer to
gemini-3-pro-image. Phases P0–P3 COMPLETE (probes → spec v2 → 26-task plan, all Daniel-gated);
P4 build STARTED — Task A1 of 26 is mid-fix-loop (round 2 worker was in flight at handoff).
Arc worktree `C:/Users/danie/kb-worktrees/boss-codex-image-engine`, branch
`claude/codex-image-engine` (cut from `claude/bricks-doctrine-reset` 2495d8c — NOT main; the
image-gen skill on main is ~4.7k lines stale). **BRANCH IS UNPUSHED AND MUST NOT BE PUSHED
until history is cleaned — see red box below.**

### ⛔ SECURITY: history cleanup required BEFORE any push
Local commit **03734ba** ("bank P4 probe 1 rollout logs…") committed FULL codex session rollout
logs (~6MB, `p4-probe1-{tempdir,worktree}-rollout.jsonl`) into tracked scratch. Boss scan found
at least one unclassifiable high-entropy base64-like blob (fragment starts `amDCAmBP7V49…`);
the auto-mode classifier blocked even reading its context — treat as secret-shaped, fail
closed. Fix round 2 (ordered, in flight at handoff) replaces them with scrubbed
`custom_tool_call` excerpts (120-char truncation, zero-hit `[A-Za-z0-9+/_-]{120,}` scan
required). **Even after the removal commit, the blobs remain in history.** Before ANY push:
rebase 03734ba (and its removal commit) out — branch is local-only and single-terminal, so
`git rebase --onto 4798499 03734ba <branch>` after the fix lands (verify with
`git log --all --oneline -- '*rollout.jsonl'` that no tracked commit still carries the full
logs), or cherry-pick the good commits onto 4798499. Verify `git log -p --follow` shows no
blob before pushing.

### Daniel's rulings (all binding, all recorded in the spec)
1. Second selectable engine; Gemini default. 2. Probe-first mechanism (codex CLI
`image_gen__imagegen`). 3. Full parity + real batch proof; register must hold the 2D flat era
(he judges the realism-lean calibratable). 4. Register floor **re-ratified in paired form**:
`|ΔM1| ≤ 5` per shot on ≥3/4 corpus shots + M2–M4 within the 23-frame band (supersedes hex-based
M1≥+15 — real Gemini ink varies +0.5..+53.3/shot). 5. Full PEER engine (not a budget lane).
6. Quota: soft cap + ledger, no enforcement. 7. **STANDALONE path: zero forge.py edits in v1**
(other terminals live on the Gemini path); own prompting logic; research-driven. Also: per-shot
engine mixing allowed in v1 (= split runs); L4 post-processing FORBIDDEN (steer or park);
placement = sibling `forge_codex.py` importing forge read-only; test bed = bricks kit
READ-ONLY, outputs to arc staging; $0 API spend forever (codex subscription only; never touch
.env/GEMINI_API_KEY — hard-ceiling guard blocks .env-containing commands).

### What WORKED (with evidence)
- **P1 capability probes (8 gens)** — identity hold STRONG (1–3 seeds, zero bleed), seed cap
  exactly 5 (absolute paths only), aspect ratio-steerable ±0.2–2% (pixel dims never honored),
  no policy refusal on named real figures, PNG output. Evidence:
  `scratch-codex-image-engine/p1-probelog.md` (committed 2b9d2d0), Gate-1 board artifact
  https://claude.ai/code/artifact/aab97b0b-8d95-4fa1-9e5f-f3392866cec2
- **P2b prompting research (9 gens)** — VERBATIM PASS-THROUGH proven (write prompt to file +
  "read exact bytes, do not compose/normalize" incantation; verified byte-for-byte against
  `~/.codex/sessions` rollout logs twice). Codex is FRONT-loaded (head+tail repetition ~4x
  WORSE); dedicated `Avoid:` field = #1 register lever (2–3x); brevity beats bloat (~6x);
  short ordinal seed labels suffice (verbosity not protective); style-transfer w/o content
  leak works. Codex's own tool doctrine found at `~/.codex/skills/.system/imagegen/`.
  Evidence: `scratch-codex-image-engine/p2b-prompting-research.md` (committed 812d60d).
- **Spec v2 approved** (Gate 2 closed): `orgs/faceless-youtube/docs/superpowers/specs/
  2026-08-11-codex-image-engine-design.md` — standalone runner over imported forge library,
  deterministic labeled-field composer, snapshot-diff harvest + rollout-log fidelity audit,
  crop+Lanczos to CANVAS (real Gemini frames measure **1376×768**, not SKILL.md's "~1344×768"),
  ten failure classes, paired register study, Wave-2 in-process integration deferred in §10.
- **26-task plan approved** (Gate 3 closed): `orgs/faceless-youtube/docs/superpowers/plans/
  2026-08-11-codex-image-engine.md` — Phase A probes (≤8 gens) → B fake-binary fixture →
  C forge_codex.py TDD (16 tasks) → D study tooling (built, run only at P5 behind Daniel).
  Subagent-driven execution ruled.
- **Task A1 probe ran** (2 gens): empty-tempdir `--cd` verdict **PARTIAL** — ambient detour
  reduced ~5–6x vs P2b's 24-call/936k-token worst case (now 4–5 calls/133–153k tokens) but NOT
  zeroed; §5.1 full-video quota math must use the measured numbers. Needed deviations, both
  documented in evidence: `shutil.which("codex")` (Windows PATHEXT), `--skip-git-repo-check`
  (codex 0.146.1 refuses untrusted dirs; first attempt failed pre-API at $0).
- **SDD loop discipline held** — task reviewer caught a real Important (gating metric
  `pre_call_tool_calls: 5/4` only re-derivable from unbanked machine-local rollout logs);
  ledger at `.superpowers/sdd/2026-08-11-codex-image-engine/progress.md`.

### What Did NOT Work (and why)
- **Banking FULL rollout logs (fix round 1)** — harness security warning + boss scan found the
  unclassifiable blob; classifier blocked inspection; ruled fail-closed. Full agent-session
  transcripts NEVER go into the tracked repo — scrubbed event excerpts only.
- **`--sandbox read-only` for codex exec** — HANGS past the 4-min ceiling (P2b: killed at ~7min,
  4 live codex.exe children, zero JSONL bytes). Production = `workspace-write` on empty tempdir;
  kills must be process-TREE kills.
- **Porting Gemini prompt prose to codex** — measured worst format (+8.0 R−B vs real +0.5
  same-shot); Gemini's last-instruction weighting actively harms codex output.
- **The pinned hex (+18) as a register target** — poor per-shot proxy (real range +0.5..+53.3);
  caused the floor inversion Daniel re-ratified around.
- **SDD `task-brief` script** — doesn't match this plan's `## Task A1 —` heading style; extract
  briefs with sed ranges instead (A1 = plan lines 92–307 + header 1–91; see ledger dir).
- **codex exec bare argv** — refuses untrusted dirs without `--skip-git-repo-check`; `codex`
  binary is `codex.CMD` (shutil.which needed on Windows).

### What Has NOT Been Tried Yet
- A1 fix round 2 completion + scoped re-review (in flight at handoff — see Next Step).
- Tasks A2–A4 (read-only-hang repro; `exec resume` contract; canvas rows), B1–B2 (fake binary),
  C1–C16 (forge_codex.py), D1–D3 (study tooling). All fully specified in the plan with code.
- The register study itself (P5, 40-gen budget, Daniel-gated), live slice, P6 adversarial
  review, P7 batch proof.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| worktree `kb-worktrees/boss-codex-image-engine` @ `claude/codex-image-engine` | WIP | UNPUSHED; local commits 14bf2e9..03734ba + in-flight fix; KEEP until arc ends |
| `orgs/faceless-youtube/docs/superpowers/specs/2026-08-11-codex-image-engine-design.md` | DONE | spec v2, all 7+ rulings integrated, approved |
| `orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md` | DONE | 26 tasks, approved, SDD-executing |
| `scratch-codex-image-engine/p1-probelog.md`, `p2b-prompting-research.md`, probe evidence, `measure.py`, `gate1-board.html` | DONE | committed; PNGs machine-local (shas in `p1-image-shas.txt`) |
| `scratch-codex-image-engine/gemini-baseline/` (23 frames + SHAS.txt) | DONE | machine-local, uncommitted by design; M2–M4 baseline corpus; re-copy from main checkout bricks assets/scenes if lost |
| `scratch-codex-image-engine/p4_probe.py` + A1 evidence | WIP | mid-fix-loop: full rollout copies being replaced by scrubbed excerpts |
| `.superpowers/sdd/2026-08-11-codex-image-engine/` (ledger, briefs, reports, review pkgs) | WIP | SDD workspace; ledger = recovery map; git-ignored |
| `scripts/forge.py` | DONE | UNTOUCHED — `git diff --exit-code` empty is the arc's standing guarantee |

### Exact Next Step
1. Reconcile A1 fix round 2: `git log --oneline -3` in the worktree. If a commit removing the
   full rollout logs + adding `p4-probe1-*-rollout-excerpt.jsonl` exists, verify the zero-hit
   entropy scan in `task-A1-report.md`'s fix report, then run the scoped re-review
   (re-review-prompt.md, sonnet, FIX_BASE=03734ba) against `review-package`. If NO commit:
   re-issue the fix per the ledger's round-2 entry (full instructions preserved there).
2. **Clean history** per the red box (drop 03734ba's blobs) — before anything else pushes.
3. Close A1 in the ledger, proceed to A2 per the SDD loop (fresh implementer per task,
   sonnet mechanical / opus for C4/C10/C12, model-grep every grade, boss reviews between).
4. Continue continuously through the 26 tasks; stop only for BLOCKED, plan contradictions, or
   the plan's human gates.

### Load list
- This handoff.
- `orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md` (header +
  Global Constraints first; task briefs by sed range).
- `orgs/faceless-youtube/docs/superpowers/specs/2026-08-11-codex-image-engine-design.md`
  (§4 composer, §7 study, §10 deferred wave).
- `.superpowers/sdd/2026-08-11-codex-image-engine/progress.md` (ledger) +
  `task-A1-report.md`.
- `scratch-codex-image-engine/p2b-prompting-research.md` COMPOSER BRIEF section.
- Skills: superpowers:subagent-driven-development (the executing loop);
  memory/claude-boss.md 2026-08-11 lessons.
- Gotchas that bind: boss never delegates to fable; model-grep at
  `~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl`; workers
  never commit outside named paths, never push; bricks terminal may be live in the main
  checkout — never touch `C:/Users/danie/kb` from this arc.

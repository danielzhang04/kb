# PICKUP — visual-consistency + motion overhaul, mid-execution (2026-07-13)

> **▶ RESUME HERE.** A two-plan overhaul of the visual pipeline is being executed via
> **subagent-driven-development** on branch **`feat/visual-consistency-motion-overhaul`**. **Plan 1 is
> 6/6 DONE. Plan 2 is 1/12 done.** Paused by the human at Plan-2 Task-1 review to checkpoint. Resume the
> SDD loop at **Plan 2, Task 2**. Full design: the spec + the two plan docs (paths below).

## What & why
The first full act-1 render (autonomous VPW→motion-planner→image-gen→render) surfaced ~15 consistency +
mechanism defects. We extracted the **generalizable** learnings (not Poyais fixes) into one spec, split
into two disjoint-file plans, and are executing them task-by-task (implementer subagent + review per task).

- **Spec:** `docs/superpowers/specs/2026-07-13-visual-consistency-motion-overhaul.md` (the design + the
  unifying principle: *consistency through reuse + register-appropriate render*; the 6 caught missteps).
- **Plan 1 (render/engine/motion mechanism):** `docs/superpowers/plans/2026-07-13-motion-mechanism-and-render-robustness.md`
- **Plan 2 (visual-authoring consistency):** `docs/superpowers/plans/2026-07-13-visual-authoring-consistency.md`

The two plans edit **disjoint file sets** (P1 = motion-planner + render-builder + engine; P2 = style-bible
+ VPW + image-gen + visual-grammar + registry) and align on ONE shared contract: the scenes manifest
carries `verified:{scene,rig}` (P2 writes it, P1's render gate reads it) and **a layered/hybrid shot has no
`scenes/<id>.png`**.

## Status — the ledger (authoritative; `.superpowers/sdd/progress.md` is git-ignored)
**PLAN 1 — DONE (6/6), all committed on the branch:**
- P1-1 `dc8eda6` — validate cutout animation params + document param shapes (C3)
- P1-2 `00a1d12` — lint guard: a delta-chain base must not be a hybrid (fix #6)
- P1-3 `1918082` — resolve per-cutout VO anchor → shot-relative `start_s` (B2, fix #3)
- P1-4 `08183cd` — scene gate exempts layered/hybrid shots (fix #7)
- P1-5 `27f746c` — engine: cutout anchor start, stamp `slam`, token-driven route dots (B2/B3/B4). tsc+render-spike verified.
- P1-6 `412bcb8` — motion-planner rules: layer-as-default, map-path, per-cutout anchors, posture relax (B0/B1/B4). Camera stays locked.
- Minor follow-ups deferred to the final review: `appear` engine-doc string doesn't yet name `slam`; a `l` loop-var + a `{}`-vs-`set()` comment in build_motion.

**PLAN 2 — 1/12 done:**
- P2-1 `4ea5e47` — stamp scenes-manifest `verified:{scene,rig}` (C1). Verified-stamp mechanics are CORRECT
  and match the render read. **⚠ REVIEW-LATER:** the review found this commit **also bundled the other
  terminal's uncommitted "recurring identifiable GROUPS" work** on `image-generation/SKILL.md` +
  `shots-schema.md` (it was already in the working tree; `git add <path>` swept it in). The groups work is
  legitimate and needs to land — but the commit isn't atomic and the P2-1 report didn't disclose it.
  **Decision needed on review:** keep it bundled (it's real work) or split. Not a blocker for resuming.

## ▶ Resume the SDD loop at Plan 2, Task 2. Remaining Plan-2 tasks:
2. **C2** — device-card background is a `scenes/<id>.png` (a normal scene, number omitted), NOT `plates/`.
3. **A1** — crowd-rig tier (PROMPTED, no asset build): style-bible §1/§3 spec + new §2d clause + VPW/image-gen prompt it. *Human decided: dot eyes + one simple consistent no-teeth mouth.*
4. **Sweep #1** — reconcile §2c so it doesn't force the full rig onto crowd figures (foreground/named keep the full rig; crowd follows the crowd-rig clause).
5. **A2** — recurring-prop lock (per-video prop library slot + a `props[]` array on a shot). **ASSET BUILD + human gate** (prop canonicals).
6. **Sweep #4** — a `prop-` seed must NOT trigger the §2c rig-hold in `forge.py` (+ test).
7. **A3** — casting lint in `lint_shots.py` (+ test).
8. **A4** — expression rework: restrain the default (visual-grammar §1) + kill "push extremity harder" (§6/§7) + review flags over-the-top (§3) + **re-author the 18 `expr-*.png` frames to moderate. ASSET BUILD + human gate — the long pole.**
9. **Sweep #5** — the ordered regen cascade after the expression re-author (frames → posed-characters → scenes). Dependent on Task 8's gate.
10. **B1 (authoring side)** — VPW authors additive beats as shared-`stage` hybrids (reuse the plate).
11. **D1** — per-word delta granularity (VPW).
12. **D2** — reveal staging convention (VPW + visual-grammar).
+ **Final integration check** + the **whole-branch code review** (superpowers:requesting-code-review, most-capable model).

## After both plans
Re-run the pipeline on the act-1 test slug `channels/the-second-take/videos/_poyais-test-act1/` (VPW is not
re-run — its shots.json exists; re-run motion-planner → image-generation [with the crowd-rig, prop-lock,
re-authored expressions] → `build_motion --no-audio --motion-plan`), then **retry the render** and bring it
to the human. The prior retry render is `_poyais-test-act1/assets/final.mp4` (the one whose feedback drove all this).

## How to resume (SDD mechanics)
Skill = `superpowers:subagent-driven-development`. Per task: `bash <SDD>/scripts/task-brief PLAN_FILE N`
→ dispatch a fresh implementer (fresh context, TDD/verify, commits, self-reviews, writes
`.superpowers/sdd/task-N-report.md`) → `bash <SDD>/scripts/review-package BASE HEAD` → dispatch a task
reviewer → fix-loop Critical/Important → append the ledger line. BASE = the commit before the implementer
(currently `4ea5e47`). SDD dir:
`C:/Users/danie/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development`.

## Parallel-terminal cautions (learned this run)
- **Staging an explicit path still commits ALL uncommitted changes in that file** — that's how P2-1 swept
  the other terminal's groups work. Before an implementer commits a file another terminal touched, know
  what else is in it. Still: never `git add -A`; never rewrite history.
- **Uncommitted WIP in the tree that Plan 2 builds on:** `style-bible.md`, `visual-grammar.md`,
  `storytelling-grammar.md` carry the other terminal's (now-landed) groups/consistency edits, still
  uncommitted. Plan-2 Tasks 3/4/8/12 edit these — their commits will include that WIP (expected; the work
  is real). `image-generation/SKILL.md`'s groups portion already committed in `4ea5e47`.
- The `.superpowers/sdd/task-N-*.md` scratch files collide across the two plans' numbering and with a
  different terminal's prior run (music-forge reports appeared in some) — regenerate the brief per task;
  don't trust a stale report file.

## Not done / open
- Plan 2 Tasks 2–12 + integration + whole-branch review.
- The two asset gates (prop canonicals; the 18 re-authored expression frames — bring to the human).
- Review-later: the P2-1 bundling; the deferred Plan-1 Minors.
- Merge `feat/visual-consistency-motion-overhaul` → the working branch when green + the retry passes.

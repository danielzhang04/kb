# Codex image engine — build COMPLETE, P5 register study gate (2026-08-12)

All 26 SDD tasks (Phases A–D) built, adversarially reviewed, and pushed on
`claude/codex-image-engine` @ **633f403**. 146 tests green (125 engine + 21 study),
~24 review-demonstrated defects fixed, forge.py zero-diff across the arc, $0 API spend.
The ONLY remaining step is the P5 register study — human-gated, 40-gen budget.

**Gate artifact (read this first):**
https://claude.ai/code/artifact/0c208d02-31ad-424e-9da3-a0b084017226

## Decisions Daniel owes at P5
1. **Study GO** — ladder = 48 cells / 32 gens of the 40 budget; resumable JSONL banking;
   early-stop abandons a lever whose M1 worsens >3.0; verdict = ratified floor
   (|ΔM1|≤5 on ≥3/4 shots + M2–M4 in 23-frame IQR bands, 3-of-4 per metric).
2. **Session-mode default (§9.3 item 4)** — recommendation: keep `isolated`
   (resume = ~3× uncached input per A3 probe; wall faster; quota pressure).
3. **Ratify spec-silence rulings** — (2:3)/(9:16) canvas rows UNVERIFIED (not promotable);
   upscale-within-tolerance unguarded (native dims in every log row); image-producing
   stall/exec-failure discards the frame; M2 = Sobel + FLAT_RANGE 4/255 spec-verbatim
   (worker retune to 2/255 reversed — would measure the Lanczos resize).

## Load list (fresh session)
- `C:/Users/danie/kb-worktrees/boss-codex-image-engine/.superpowers/sdd/2026-08-11-codex-image-engine/progress.md`
  — the complete task/review/ruling ledger (gitignored, worktree-local).
- `orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md` (plan)
  + `orgs/faceless-youtube/docs/superpowers/specs/2026-08-11-codex-image-engine-design.md` (spec).
- Boss memory: `~/.claude/projects/C--Users-danie-kb/memory/codex-image-engine-arc.md`.

## State facts a resuming session needs
- Arc worktree: `C:/Users/danie/kb-worktrees/boss-codex-image-engine` (branch pushed;
  worktree stays until merge per lease rule). Main checkout untouched on its own branch.
- Engine: `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py`
  (+ test, + `_fake_codex.py` fixture). Study tooling:
  `scratch-codex-image-engine/{study_metrics,study_run}.py` (+tests).
- The 23 gemini-baseline frames + SHAS.txt are MACHINE-LOCAL in
  `scratch-codex-image-engine/gemini-baseline/` — never committed; baseline_table
  fail-closes on sha mismatch.
- P5 wiring: `study_run.py --plan-only` is free; the real run injects `forge_codex.main`
  as generate_fn — L1 = `--register-seed-tile`, L2 = `--format labeled|minimal`,
  L3 = re-normalize L0 frames (0 gens). Ordinary invocation exits 2 until the gate.
- Phase A generation budget stands at 6/8 used; study budget is separate (40).
- Delegation law this arc ran under: codex-only workers (terra default, sol for
  C4/C10/C12 + xhigh reviews), detached Start-Process dispatch + Monitor after three
  external background-shell kills (cause never identified; detachment sidesteps it).

## Done means done
When Daniel rules: run P5 per the plan §P5 section, then Wave-2 promotion questions
(register-seed production path) route through spec §10.

---

## UPDATE 2026-08-12 late: STUDY RAN — STOP-AND-ESCALATE, Daniel's ruling owed

Daniel's "Continue" opened the gate; the study ran to completion the same night.

**Result: the ratified floor FAILED on all four metrics.** Codex inks +14..+38 (M1) vs the
real Gemini baselines' +0.5..+6.2 — the real house register is far cooler than the
style-bible hex implied; codex is also flatter (M2) and much more palette-concentrated
(M3). The L1 style tile is the only lever that materially moves ink; not enough. L44
(single-figure) clears the M1 floor on every lever but fails the M2/M3 bands — no shot
class clears the full floor.

**Escalation packet (side-by-side board with lightbox, scorecard, two outcomes):**
https://claude.ai/code/artifact/37967d78-2d98-42ff-8d11-1dddc4232971
Options per ruling 3 (no post-processing): (a) accept measured difference for a named
shot class, or (b) PARK the engine — recommended. **No further generation until Daniel
rules.**

Spend truth: 24 gens + 1 transport re-issue = 25/40 turns, 4.64M input tokens (83%
cached), ~63 min generation wall, $0 API. Fidelity: 3 mismatch (published+marked), 18
unverifiable, 3 verified. Full paired table + verdict:
`.superpowers/sdd/2026-08-11-codex-image-engine/p5-real-results/` in the arc worktree;
P5 driver committed @ 39731bf.

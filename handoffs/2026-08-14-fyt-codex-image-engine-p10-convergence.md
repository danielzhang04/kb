# codex-image-engine P8→P10 convergence handoff — 2026-08-14

**Topic:** One boss session drove the engine from "P7 near-matches, adoption pending" through:
P8 lever cycle (rejected by Daniel as not production grade) → P9 root-cause investigation +
discriminating probes (all causes closed, no model ceiling) → P10 production-shape composer
rebuild (register CONVERGED). Supersedes handoffs/2026-08-11-fyt-codex-image-engine.md and
2026-08-12-fyt-codex-image-engine-p5-gate.md (both consumed — deleted this commit).

**Branch:** `claude/codex-image-engine` @ **a76acd24** (pushed, remote == local), worktree
`C:/Users/danie/kb-worktrees/boss-codex-image-engine` (KEEP — active arc lease). Session spend:
27 real gens (P8 13 + P9 6 + P10 8), 0 API dollars, all codex subscription.
**Board (all rounds + probe evidence, lightbox):** https://claude.ai/code/artifact/f3591cd3-3179-4790-b3e0-c8635487002d

## THE OPEN GATE (Daniel, asked and unanswered at handoff)

P10 exposed that "match the baselines" and "render the current spec" have diverged: the
gemini-baseline frames predate the 2026-08-06 VPW re-author, and P10 faithfully renders the
CURRENT still_prompts (L50 now commands a green-palette push-toward-viewer scene; L28 tote
bins + plain board). Daniel must pick the equivalence target:
(1) **current spec** → run a small delta round (L33 sign+continuity, L27 pose, ~3 gens) and
proceed to promotion; or (2) **old baselines** → needs a same-spec Gemini↔codex A/B, which
requires Gemini billing restored (also unparks bricks). Also still HELD by Daniel: lettering
doctrine, production adoption ruling (standalone shape already locked by him).

### What WORKED (with evidence)
- **P9 investigation pattern**: 3 parallel read-only adversarial workers (capability research /
  gen-logic diff audit / divergence classification) + 6 cheap discriminating probe gens turned
  "it's just off" into four CLOSED causes. Evidence: probes A1/A2 native M2 0.992/0.980 (gloss
  ceiling killed), C degloss-strip M2 0.365→0.867 (baseline 0.836), B2 plate-as-base lean
  prompt room-MAE 46.2→19.0 (threshold 25), D production-shape best register. Reports:
  arc worktree `.superpowers/sdd/2026-08-11-codex-image-engine/p9-investigation/` + `p9-probes/`.
- **P10 production-shape composer** (`scratch-codex-image-engine/p10_matched.py`, commit
  a76acd24): §2b bible head + forge-slate seed roles (UNMUTATED — place plates/chain parents
  kept, no baseline anchors) + verbatim still_prompt + suffix + hardened Avoid; 2.0-2.4k chars.
  Real 8/8, 0 re-issues; register house-true on every frame (flat, tinted neutrals, no gloss).
- **P8 machinery** (still on branch, superseded for composing but register/fill-mode tooling
  reused): fill-mode registers proved the money-sage fix; 49+126 tests green.
- **Review debt cleared**: fresh-eyes NEEDS-FIXES (2 High/4 Medium) on compose_fn/
  seed_cap_override → all fixed @ 06cc6ef3 (validator, with_style_anchor, lettering allowlist,
  anchor revalidation, banked resume provenance, ink/accent non-exclusive); 164 green.

### What Did NOT Work (and why)
- **P8 hand-contract lever cycling** — Daniel rejected: gloss/color/drift persisted because
  the levers were fighting self-inflicted causes (below), not model limits.
- **Trading continuity seeds for style anchors** (P7/P8) — trimming the place plate for a
  Gemini-baseline anchor (a role production's validator rejects) caused the room drift
  (L33 room-MAE 46 vs Gemini 2.3). Never mutate the forge slate.
- **P6's inverted tonal language** — "gradients required / poster-flat is wrong" globally
  COMMANDED the gloss; Avoid never banned specular/AO. Self-induced, proven by probe C.
- **Delta APPEND** (P8 r2) — appended correction clauses left old facts in place → literal
  prompt contradictions (L35 3-tier AND 4-tier). P10 deltas REPLACE sections by key.
- **Worker-authored non-ASCII literals** — mojibake twice: P8 archived prompts carried
  double-encoded em-dashes to the model, and the P10 worker's mojibake GUARD REGEX was itself
  double-encoded (missed real corruption; boss rewrote in escapes, verified vs the corrupted
  archive). Codex worker toolchain mangles non-ASCII literals — escapes only, boss verifies
  guards against real corrupt artifacts.
- **Fix-worktree suite runs as final verification** — a hardened P6 assert passed in the
  plate-less fix worktree but failed on the arc tip (substitution branch fires only when
  STEP-1 plates are absent from staging). Boss must re-verify on the arc tip; fixed @ 9d97b9ae
  with consistency pins.
- **PowerShell `>` for git patches** — UTF-16 mangling made `git apply` fail; harvest via
  detached-HEAD commit + cherry-pick instead (worked: f0bb5456 → 06cc6ef3).

### What Has NOT Been Tried Yet
- The delta round on P10's two true misses: L33 (MINISCRIBE sign absent, room continuity
  loose despite chain-parent seed — consider plate-as-BASE role wording from probe B2) and
  L27 (pose energy). ~3 gens.
- Same-spec Gemini↔codex A/B (blocked on Gemini billing restore).
- Phase 3+ of the tasklist: promotion into production composer (standalone; lettering HELD),
  batch proof on a regeneration slate, whole-branch review + PR + merge.
- Wave-2 in-process integration (spec §10) — deferred by Daniel's standalone-first ruling.

### Current State of Files (arc branch, all pushed)
| File | Status | Notes |
| ---- | ------ | ----- |
| `claude/codex-image-engine` @ a76acd24 | PUSHED | 10 commits this session: P8 spec/build/registers, review fix round, P9 probes, P10 spec/build |
| scratch `p10_matched.py` + tests + `p10-report.md` | DONE | production-shape composer; boss-fixed mojibake guard |
| scratch `p9_probes.py`, `p8_*`, `p7_*` (post-fix) | DONE | probe drivers + superseded-but-reused machinery |
| engine `forge_codex.py` + tests | DONE | validator + with_style_anchor + 6 review fixes; 132 green; forge.py zero-diff standing |
| worktree `.superpowers/sdd/.../progress.md` | DONE | richest session record (P8→P10, all rulings) — machine-local, do NOT lose the worktree |
| `p8/p9/p10-real-results/` + `p9-investigation/` | DONE | machine-local frames + reports; baselines in scratch gemini-baseline/ (never committed) |
| boss memory `codex-image-engine-arc.md` + MEMORY.md | DONE | resume pointers current through P10 |

### Exact Next Step
Read Daniel's answer to the equivalence-target question (above). If "current spec": dispatch
the L33/L27 delta round via `p10_matched.py --deltas` (REPLACE semantics; author section
replacements, not appends), board, then move tasklist Phase 3 (promotion). If "old baselines":
wait for Gemini billing, then run the same-spec A/B (same still_prompts through forge and
p10_matched, judge side by side). If no answer: do nothing gen-side; the branch is clean.

### Load list
- This handoff.
- Arc worktree `.superpowers/sdd/2026-08-11-codex-image-engine/progress.md` (bottom third:
  P8→P10 entries — the full ruling record).
- `scratch-codex-image-engine/p10-boss-spec.md` (the composer contract) + `p10-report.md`.
- `p9-investigation/r2-genlogic-diff-audit.md` + `r3-adversarial-classification.md` (why the
  design is what it is).
- Boss memory `~/.claude/projects/C--Users-danie-kb/memory/codex-image-engine-arc.md`.
- Skills: dispatch-codex (workers), save-session (next pause).
- Gotchas that bind: boss-only real gens (worker sandbox blocks codex network); detached
  Start-Process dispatch + Monitor (background-shell kills); commits via PowerShell tool;
  never touch the main checkout (bricks terminal may be live); $0 API law (subscription only).

---
id: 6a86a56d-e55dadca
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube
risk-tier: T1
owner: codex-worker
claim-token: 14078d398a16778e
state: done
approval: null
workflow: 01a01de4-9650-7ab2-a768-b0c6151f205d
depends-on: []
variant-group: null
role: work
session-id: 6a86a0e6-61018c64
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: doctrine reconciliation plan — section-level keep/revert/hybrid/delete across the whole stack

You are a codex synthesis worker on the kb fleet. READ-ONLY except your report. Read-only git ok. No network. UTF-8.

WORKING ROOT: C:/Users/danie/kb-clones/bricks-arc/orgs/faceless-youtube

\## Commission (Daniel's words, binding)
"Combining mostly reversions with some modern text. Apply across the board. We shouldn't be trying to layer on function. Analyze past and present versions and edit select parts to achieve better performance like we've seen in the past. This shouldn't just apply to bricks, it should apply to all."

\## Inputs (read all)
- doctrine-recon/era-map.md — the 60-section evidence map (your primary substrate)
- The evidence corpus it cites, especially: channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-audit/{taste-ground-truth,palette-forensics,character-presence-audit,poyais-register-audit,poyais-visual-audit,code-archaeology-3era,prompt-diff-analysis}.md
- The current files themselves where the map's one-liners need verification.

\## Produce: doctrine-recon/reconciliation-plan.md
For EVERY section in the era map (all 60 — including a one-line "KEEP, no change" row for the uncontested ones):
- VERDICT: KEEP-PRESENT / REVERT-to-E<n> / HYBRID (revert base + named modern clause) / DELETE. 
- The exact text move: for reverts, the era sha + the passage to restore (verbatim, trimmed); for hybrids, base + which modern sentence survives and why; for deletes, what disappears.
- EVIDENCE line: the specific finding(s) justifying it. A section with evidence status "none" defaults to KEEP-PRESENT (no speculative edits) unless a layer move applies.
- LAYER move where the map flagged one: what text moves from org skill → channel kit (taste leaking into machinery) or channel kit → org skill (process logic other channels should inherit). Moves are relocations, never duplications.

\## Binding synthesis principles
1. Mostly reversion, some modern: the burden of proof is ON present text where past text has positive evidence. But protect the modern structural wins explicitly: seeded cast + STEP-1 cards, three-state review, HARD no-op delta lint, closed-world poses, wave parallelization, suffix byte-lock, single-writer. Any verdict weakening one of these must say so in a **PROTECTED-WIN IMPACT** line.
2. Structure vs aesthetics: org skills carry era-agnostic process machinery; channel kit carries taste. Aesthetic prescriptions (palette pressure, staging formulas, mood language) in skills are prime delete/relocate candidates.
3. No new function. No new rules. Net line count across the stack must be NEGATIVE — report the estimate per file.
4. Survivorship guard: for every REVERT, state what failure that era's text coexisted with and why the modern protection now covers it (or admit it doesn't — then HYBRID).
5. Cross-channel: every org-skill verdict must be sane for a channel that is NOT the-second-take. Check what other channels/ exist and sanity-note any that would break.
6. Fold in the pending bricks findings as plan consequences, not extra rules: blue-orange (plan-wording + suffix phrase), character collapse (figure-order emphasis), prop-text bake (the engine writes text on prose-named props — if an era's text handled lettering better, that's a section verdict; otherwise flag as open).

\## Also produce (same file, final section)
EXECUTION SKETCH: the apply order (one edit worker, whole stack), the validation battery (VPW lint on ALL existing videos' shots.json across channels + forge/test suites + byte-lock), and the live-test definition (bricks scoped re-pass + L01-L25 regen).

Final message: verdict counts (keep/revert/hybrid/delete), net line estimate per file, the 5 highest-impact moves in one line each, protected-win impacts (should be none — list any), cross-channel break risks. Nothing else.

## Result

Verdict counts: KEEP-PRESENT 44 · REVERT 3 · HYBRID 9 · DELETE 4.

Net line estimate per file:

- `visual-prompt-writer/SKILL.md`: −25
- `critics.md`: −18
- `shots-schema.md`: −10
- `lint_shots.py`: −35
- `image-generation/SKILL.md`: −35
- `forge.py`: −45
- `stamp_review.py`: −15
- `build_review_artifact.py`: −10
- `crop_battery.py`: 0
- `finalize_thumbnail.py`: 0
- `visual-grammar.md`: −24
- `style-bible.md`: −20
- `registry.json`: −8
- `example-shots.md`: −16
- Total: **−261 lines**

Five highest-impact moves:

1. Restore payload-driven composition choice and negative space; remove mandatory three-plane staging.
2. Make authored payload provider-final while preserving exact suffix bytes before it.
3. Replace `warm-biased scene palette` with `locked 2-3 colour scene palette`.
4. Put the existing true-subject/occupancy clause before non-literal choices; reject everyman restoration.
5. Remove Second Take aesthetics from org machinery and make active channel kits their sole home.

Protected-win impacts: none. Seeded cast + STEP-1, three-state review, HARD no-op lint, closed-world poses, wave parallelization, suffix byte-lock, and single-writer stamping remain intact.

Cross-channel break risks: `_test-eng`, `_test-metadata`, and `_test-pipeline` would break if TST flat-cel, crowd, marker, palette, or rig rules remained org-wide. `_TEMPLATE` and test channels lack visual kits, so kitless planning must fail soft while locked generation fails clearly; TST must continue to HARD-fail missing suffixes, required tagged assets, unresolved primitives, or stale review.

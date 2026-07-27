---
name: proxy-judge
description: Stands where the human stands at a pipeline GATE, rendering the acceptance verdict on a finished artifact — v1 judges the LONG-FORM SCRIPT after `humanize`. Use for "judge the script," "would I approve this," "run the acceptance gate," "should this ship" — fresh-eyes accept/revise/reject for any taste-pack channel. A FRESH-CONTEXT subagent judges against the storytelling-grammar + rubric + calibration TRAINING set, writing `judge-verdict.md`. Runs after `long-form-writer`, before voiceover/visuals. NOT for writing/fixing scripts (`long-form-writer`), fact-checking, or editing taste-pack docs.
---

# proxy-judge — the acceptance gate (proxy-me)

A **fresh-context proxy of how the human judges** a finished artifact. It does not replace the in-writer
taste critic (`long-form-writer` Step 3d, which runs subtractively during generation and is left
untouched). It is the **acceptance gate** that stands where the human stands *after* `humanize`.

Design rule (like every skill here): **reads files, writes a file.** No state in the conversation.

Full rationale + the calibration proof: `docs/superpowers/specs/2026-07-09-proxy-judge-story-editor-me-design.md`.

## Invocation

`proxy-judge <slug> [--facet story] [--channel the-second-take] [--mode advisory|blocking]`

- `--facet` default `story` (the only v1 facet; `idea`/`art` reuse this harness once story is proven).
- `--mode` default `advisory` (print the verdict, let the run continue). `blocking` gates the pipeline.

## Procedure

1. **Resolve the taste pack.**
   `python .claude/skills/proxy-judge/scripts/resolve_manifest.py <facet> <channel>`
   → the grammar, rubric, gold, calibration, and gates paths. A missing pack file is a hard error.

2. **Gather the accuracy signal (do not re-derive it).**
   - If `videos/<slug>/research.md` exists (research channels): run the **leash critic** prompt from
     `.claude/skills/long-form-writer/references/critics.md` on the draft, and write its findings to
     `videos/<slug>/leash-findings.md`.
   - If there is no `research.md` (plain-path channels): there is no fact ledger to check — write a
     one-line `leash-findings.md` noting "no research ledger; accuracy not gated" and continue.

3. **Dispatch the judge subagent (fresh context).** Give it `references/judge.md` as its mandate and
   these inputs: the resolved taste pack (the judge reads the **TRAINING** section of the calibration
   set only — NEVER the HELD-OUT section), `leash-findings.md`, and the draft `videos/<slug>/script.md`.
   It writes `videos/<slug>/judge-verdict.md` in the `references/verdict-schema.md` contract.

4. **Act on the verdict by mode.**
   - **advisory:** print the verdict + top redirects; the run continues regardless. (Default; use while
     the human is still in the loop — it pre-screens so the human only looks at greenlit drafts.)
   - **blocking:** `greenlight` → the pipeline proceeds (voiceover / visuals). `revise` → hand the
     ranked redirects back to `long-form-writer` for a targeted pass. `reject` → stop and surface to the
     human. (Use only once the judge has cleared its agreement bar — see `agreement-report.md`.)

## Guardrails (non-negotiable)

- **Never read the HELD-OUT section** of the calibration set — it is the blind-rating answer key.
- **Content preference, not voice** — redirects may be phrased however is clearest.
- **Zero taste-pack writes.** The judge only NAMES an uncodified preference in `proposed_rule_stub`; it
  never edits the grammar/rubric. (Auto-authoring new rules = the v2 self-maintaining loop.)
- **Accuracy is the leash critic's**, folded in — the judge never re-traces `[F-NN]` facts.
- **Leave `long-form-writer` Step 3d untouched.** This is an added gate, not a replacement.

## Files

- Reads: the resolved taste pack (grammar, rubric, gold, `knowledge/proxy-me/<facet>/calibration-set.md`
  TRAINING only), `videos/<slug>/leash-findings.md`, `videos/<slug>/script.md`.
- Writes: `videos/<slug>/judge-verdict.md` (and `leash-findings.md`).
- Helpers: `scripts/resolve_manifest.py`, `scripts/score_agreement.py` (validation), `scripts/lint_calibration.py`.
- Worked example: `references/example-verdict-gold.md` (the gold script, greenlit 35/36).

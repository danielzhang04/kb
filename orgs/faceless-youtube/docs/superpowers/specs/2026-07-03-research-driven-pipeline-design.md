# Research-driven pipeline redesign — design spec

**Date:** 2026-07-03 · **Status:** approved, building · **Trigger:** The Second Take (deeply-informative finance) needs real research + a much stronger long-form scriptwriter; current one-shot idea→script flow can't carry it.

## Goal

Reshape the front + middle of the pipeline so long-form informative videos are (a) gated by a human at the *idea* stage, (b) grounded in real, verified research, and (c) written by a scriptwriter that won't sag or invent facts over 2,500 words. Keep the whole thing **niche-agnostic** — niche is data — while letting a niche opt into a heavier path.

## The reshaped pipeline

```
idea-generator  → topic + angle + payload promise + "the N questions this video must answer" + titles
                  (live topic-scouting default for research niches)
     ↓  [HUMAN GATE — the only gate: pick + edit the idea in idea-backlog.md, mark `picked`]
researcher      → derives a DIRECTED research plan (what to chase / ignore, scope, source bar)
                  → calls the native `deep-research` skill (adversarial fact-check is what earns trust)
                  → writes videos/<slug>/research.md   [runs autonomously, no gate]
     ↓
long-form-writer → outline (from ledger) → section-by-section drafts → editorial pass → humanize
                  → script.md   [accuracy leashed to the ledger — states only what's sourced]
     ↓
shorts-writer   → derives self-contained shorts from the finished long-form + research → shorts/*.md
     ↓
metadata → visuals → voice → render → (compliance/publish/analytics — out of scope here)
```

**Both flows must work.** A niche with `research: none` skips the researcher; `idea-generator → long-form-writer` directly. The long-form writer works with OR without a `research.md`.

## Component contracts

1. **idea-generator (light edit).** For `research: deep` niches, the long-form brief drops the speculative pre-research beat outline and instead emits **provisional angle + payload promise + the key questions the video must answer** (these seed the research plan). Live topic-scouting becomes the default for this channel. Human gate unchanged.

2. **researcher (NEW skill, built via skill-creator).** In: picked brief + dna + niche playbook. Job: (a) *direct* deep-research — turn the brief's questions into a specific plan with scope, exclusions ("skip the famous narrative; find the mechanism + the numbers"), and a source-quality bar (YMYL → primary sources/filings); (b) call `deep-research`; (c) emit `research.md` = **fact ledger (every claim → source + date)** + narrative spine + indict-analogies + myths-to-bust + recommended section outline + open gaps. Autonomous; accuracy is its responsibility, not the human's.

3. **long-form-writer (split from scriptwriter, upgraded).** In: research.md + brief + dna + universal + niche playbook. Process: **outline → section-by-section drafting (small focused generations, each checked vs the ledger) → editorial pass (fresh critic-editors: accuracy-to-ledger, cross-section flow, full-runtime cadence, cliché tells) → revise → humanize.** Output contract unchanged (`script.md` with cues + `Estimated runtime` + beat timestamps) so downstream skills need no changes. **Accuracy leash:** never states a fact the ledger didn't source.

4. **shorts-writer (split from scriptwriter).** In: finished long-form script.md + research.md + dna. Derives self-contained closed-loop shorts from the strongest researched moments; light self-check; publish/bench tagging. Output contract unchanged.

5. **Per-niche wiring.** A `Pipeline` block in `dna.md`: `research: deep|none`, `topic_scouting: live|stored`, `long_form: staged|single`. The Second Take = `deep / live / staged`. Skills read these flags to pick the path.

## Phasing (manage the lift)

- **Phase 1 (now):** dna Pipeline block + idea-generator reposition + researcher skill + long-form-writer as **staged writer + ONE accuracy/quality editor pass** + shorts-writer split + wire The Second Take. Verify both flows.
- **Phase 2 (later):** expand the single editor into the full adversarial critic panel; harden via skill-creator evals.

## Out of scope

compliance-check / publish-queue / analytics tail; the full critic panel; producing a real video. Niche stays data — no per-niche code forks (split is by **format**, long vs short, not by niche).

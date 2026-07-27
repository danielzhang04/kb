# Handoff — proxy-judge ("taste me") + a pipeline-simplification finding (2026-07-09)

**Status: PAUSED by Daniel for later revisit. Do not resume building/tuning/freezing without him.**
All work is committed on branch **`feat/proxy-judge-story-editor-me`** (not merged to master).

Two threads came out of this session. Thread A was the goal; Thread B was an accidental, possibly-bigger finding.

---

## Thread A — "taste me" (the `proxy-judge` skill)

### What it is
A fresh-context proxy of **how Daniel judges** a pipeline artifact, so future runs can be judged by "proxy-me"
instead of Daniel. v1 = the **Story-editor** facet: an acceptance GATE that stands where Daniel stands **after
`humanize`** and renders his **accept/revise/reject** verdict on a long-form `script.md` (+ a `/36` score +
ranked substantive redirects). It imitates his **content preferences, not his voice**. Built on a
**facet-agnostic harness** so `idea`/`art` proxies reuse it later.

Key reframe that shaped it: ~70% of "story-me" already existed in the repo (`watchability-rubric.md`,
`long-form-writer/references/critics.md`, `storytelling-grammar.md` §0 gold + §5 bank). v1 did NOT rebuild
that — it added the missing **acceptance verdict + calibration to Daniel + the uncodified judgments**.

### Where everything lives
- **Spec:** `docs/superpowers/specs/2026-07-09-proxy-judge-story-editor-me-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-09-proxy-judge-story-editor-me.md`
- **Skill:** `.claude/skills/proxy-judge/` (`SKILL.md`, `references/judge.md`, `references/verdict-schema.md`,
  `references/example-verdict-gold.md`, `scripts/{lint_calibration,resolve_manifest,score_agreement}.py` + tests)
- **Taste pack / data:** `knowledge/proxy-me/` (`facets.md`, `README.md`, `story/calibration-set.md`,
  `story/agreement-report.md`, `story/holdout/`)

### What's DONE (Tasks 1–6, all tested)
- 3 stdlib Python helpers (calibration validator, facet resolver, agreement scorer) — plain-`assert` tests
  (repo has no pytest), all green.
- Facet manifest + facet-agnostic wiring; `SKILL.md` with advisory/blocking modes; registered in skills README.
- **Calibration answer key = 41 TRAINING entries:** gold (accept), the §5 before→after bank, 6 real
  git-history transformations (`da8c888`→`7a91439`, first draft → gold), 17 uncodified judgments mined from
  the Poyais session transcripts (CJ-100–116), and 3 session-note prefs from HO-2 (CJ-200–202).
- Judge smoke-proven: greenlit the gold at 35/36.

### The proof (Task 7) + one tuning round (Task 8, partial)
Held-out blind-rating, Daniel vs the judge:

| draft | genuine pipeline output? | Daniel | judge | verdict | substance overlap |
|---|---|---|---|---|---|
| HO-1 = `da8c888` pre-gold Poyais | **YES** (real) | reject (he rebuilt it) | reject 24/36 | ✅ | high (~0.8) |
| HO-2 = Lustig (pre-tune) | **NO** (see Thread B) | revise | revise 34/36 | ✅ | 0.0 |
| HO-3 = Hunt silver (post-tune) | **NO** | revise | revise 31/36 | ✅ | improved (~3 of 9 semantic) |

- **Verdict agreement: 3/3 (100%)** — reliable, including unseen topics.
- **Substance-match is a converging long tail.** Tuning on HO-2's lessons (digestibility/plainness bar,
  hookier hook, quantify-money-in-modern-terms) **demonstrably generalized**: on HO-3 the judge then caught
  the "genuinely" filler and the announced-transition/label-openers it had missed. But each draft surfaces a
  few more micro-preferences → you never hit 100% parity in a session; it converges through use.

### OPEN issues to resume on (do NOT freeze until addressed)
1. **The generalization drafts (HO-2, HO-3) were NOT real pipeline output** — see Thread B. The judge's true
   input is a *post-`critics.md`, post-`humanize`* draft; it was tested partly off-distribution. **The honest
   next step is to validate on ≥1 genuine end-to-end pipeline draft** (idea → researcher/deep-research →
   long-form-writer staged → humanizer, no facts supplied), then judge that. Only HO-1 was genuine.
2. **Round-2 preferences surfaced by HO-3 but NOT yet banked:** use contractions ("didn't" not "did not");
   "corner" as unfamiliar jargon (reinforces the gloss rule the judge missed twice); don't flatly
   meta-explain a term ("that is the phrase for when…" → "which basically means…"); don't overuse a signature
   phrase ("two brothers from Texas"); catch "this is the part that always gets me" self-editorializing.
   (Recorded in `HO-3`'s calibration entry; not yet promoted to TRAINING.)
3. **`score_agreement.py` undercounts** — it matches quotes by exact wording, so the same *issue* flagged via
   different quote spans scores as a miss (HO-3 mechanical recall 0.11 vs ~0.33 real). Upgrade to
   semantic/issue-level matching before trusting the numbers.
4. **Pending close-out decision:** freeze + wire advisory + living-calibration loop (every overrule → new
   entry; the human-in-the-loop seed of the v2 self-maintaining loop) vs. more tuning rounds. Deferred.

### The pattern this proved (worth keeping)
Verdict-reliable now; substance sharpens as Daniel feeds it ratings. The living-calibration loop = the real
mechanism, and it generalizes to `idea`-me / `art`-me by swapping the taste pack only.

---

## Thread B — the accidental finding: near-perfect drafts from almost no pipeline

**The observation (Daniel's):** the HO-2 (Lustig) and HO-3 (silver) drafts were **almost perfect — maybe
better than the current full pipeline produces** — yet they were generated with almost none of the pipeline.

**How they were actually made:** one `general-purpose` subagent, a single prompt telling it to follow
`channels/the-second-take/storytelling-grammar.md`, **with the topic facts handed to it inline**. They
BYPASSED: `idea-generator`, `researcher` / `deep-research`, the `long-form-writer` **staged writers-room**
(spine → casual draft → leash pass → `critics.md` Step 3d → editor), the `humanizer`, and the fact-ledger leash.

**The hypothesis to explore later:** a large part of the pipeline — especially the **staged writers-room** and
possibly the depth of the research stage — may be **over-engineered** relative to a strong single-pass writer
that is simply handed (a) the locked `storytelling-grammar.md` (§0 gold + §5 bank) and (b) a clean set of
facts. If a lean "grammar + facts → one strong pass" writer matches or beats the staged room on craft, a lot
of pipeline complexity (and token cost, and latency) could be cut.

**IMPORTANT caveats before cutting anything (my push-back):**
- **The facts were curated by me.** The research stage doesn't only buy craft — it buys **sourcing, accuracy,
  the fact-ledger leash, YMYL correctness, and defamation-safety**. My shortcut skipped all of that by feeding
  known facts. "Near-perfect" is Daniel's read on **taste/craft**, NOT on accuracy — the Lustig/silver drafts
  were never fact-checked. So the finding is strong for **craft**, and says nothing yet about whether research
  can be thinned.
- The likely real conclusion is narrower and still valuable: **the staged writers-room may be beatable by a
  single strong grammar-guided pass** — the *research/accuracy* stage is a separate question.
- These drafts also never passed `critics.md`, yet read clean — which hints the critic layer's value may be
  smaller than assumed once the grammar is mature. Also worth testing.

**Suggested experiment when we revisit:** a clean A/B on ONE fresh topic — (A) full pipeline
(idea→deep-research→staged writers-room→humanize) vs. (B) lean (deep-research for facts+leadger → ONE
grammar-guided pass). Compare on BOTH craft (blind taste rating) AND accuracy (leash check). That single test
answers "how much of the middle can we cut" without guessing. It also doubles as the Thread-A "real pipeline
draft" validation.

---

## Resume checklist (for whoever picks this up)
1. `git checkout feat/proxy-judge-story-editor-me`; read this file + the spec + `story/agreement-report.md`.
2. Decide the Thread-A close-out (freeze+advisory+bank round-2 vs. more rounds) — but first do the real-pipeline
   validation (issue A-1), which is also the Thread-B experiment (B).
3. If banking round-2 prefs: add them to `calibration-set.md` TRAINING as `session-note` entries, lint, and
   re-judge — but on a genuine pipeline draft, not another approximation.
4. Nothing here is merged to master; the pipeline itself is untouched (proxy-judge is an additive, unwired gate
   in advisory-only — it changes nothing until deliberately invoked).

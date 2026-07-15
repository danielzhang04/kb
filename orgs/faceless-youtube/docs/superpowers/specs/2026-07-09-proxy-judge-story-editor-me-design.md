# proxy-judge — "Story-editor-me" (v1) — Design Spec

**Date:** 2026-07-09
**Status:** Design approved; ready for implementation plan.
**Scope:** v1 = the **Story-editor** facet only. The harness is built facet-agnostic so
`idea` and `art` facets reuse it later, but only Story is built and proven here.

---

## 1. Goal & the honest reframe

**User goal (verbatim intent):** build a proxy of *how Daniel judges the pipeline's output* so future
runs can be judged by "proxy-me" instead of Daniel and get a similarly good result — starting with the
long-form **script** gate. Longer-term: several such proxies ("idea-me", "art-me"), one per facet.

**Reframe that shaped this design:** "Story-editor-me" is already ~70% built in the repo. It must NOT be
rebuilt. What already exists and is reused as-is:

- `channels/<ch>/watchability-rubric.md` — an 18-dimension `/36` scoring instrument with explicit gate
  thresholds. This is Daniel's taste expressed as a rubric.
- `.claude/skills/long-form-writer/references/critics.md` — a **fresh-context taste critic** subagent
  (the "no attachment to the draft" pattern), hunting 10 named flaws against the grammar.
- `channels/<ch>/storytelling-grammar.md` — the voice/story/staging source of truth, incl. **§0 gold
  exemplar** and the **§5 before→after bank** (codified taste transformations).
- The gold Poyais `script.md` — the accept exemplar / answer key.

**The residual gap (what Daniel still does that the above does NOT):**

1. **Verdict, not just defect removal.** `critics.md` is subtractive — it removes *known* tells during
   generation. It never renders the *acceptance decision* (greenlight / send back / kill). Daniel does.
2. **No calibration.** The rubric/critic are self-asserted. Nobody has ever measured whether the
   critic's verdict matches Daniel's on the same script. "Similarly good" is currently unproven.
3. **Uncodified content preferences.** When a draft "reads as vapor," Daniel diagnoses substantive
   problems that are not yet written into the grammar. That residual judgment lives only in past
   sessions, not in any doc.

**v1 therefore is NOT "a judge."** It is: **wrap the existing rubric+critic into a fresh-context
acceptance gate that renders Daniel's verdict, add the uncodified content preferences, and *prove* it
agrees with Daniel** — measured, not asserted.

**Explicitly out of scope for v1** (decided during brainstorming):
- **Feedback-voice imitation.** The judge imitates Daniel's *content preferences* (what is good/bad,
  what to change), NOT his phrasing. Redirects may be worded however is clearest. This makes the proof
  objective (verdict + which-lines agreement) rather than a subjective prose-match.
- **Self-maintaining loop (v2).** When the judge rejects for an uncodified reason it may *name* the gap
  (a stub), but it has **zero write access** to the taste pack. Auto-proposing/authoring new grammar
  rules is deferred to v2, after the judge earns trust.
- **Re-implementing fact-checking.** The judge is the *holistic integrator*: it reads the existing leash
  critic's accuracy findings and folds them into one verdict, but does not re-trace `[F-NN]` facts
  itself. Fact-tracing stays a called tool.
- **idea / art / voice facets.** Harness is designed for them; they are not built here.

---

## 2. Architecture

### 2.1 Shape: shared harness + per-facet taste pack

```
proxy-judge  (project skill — the harness, facet-agnostic)
   │  reads a facet manifest, then dispatches a FRESH-CONTEXT subagent
   ▼
Taste pack (data, not code) — for facet=story:
   • storytelling-grammar.md   (§0 gold + §5 before→after)
   • watchability-rubric.md    (/36 scoring instrument + gate thresholds)
   • gold script.md            (the accept exemplar)
   • calibration-set.md        (NEW — Daniel's labeled judgments; see §4)
```

The subagent is the *whole point*: a separate context window = real "fresh eyes", which the repo already
established is required ("prohibitions self-checked by the same model share its blind spot",
`decisions.md`).

### 2.2 Attach point — an ADDED gate, not a replacement

`critics.md` (the in-writer floor) is left **unchanged**. proxy-judge is a NEW gate standing exactly
where Daniel stands today — after `humanize`:

```
long-form-writer → [critics.md Step 3d: in-writer FLOOR, unchanged] → humanize
                                                                          │
                                                                          ▼
                                                    ★ proxy-judge  ← proxy-DANIEL, the acceptance gate
                                                                          │
                                        greenlight → pipeline continues (voiceover, visuals, …)
                                        revise     → back to long-form-writer with substantive redirects
                                        reject     → stop, surface to human
```

- In an **autonomous** run, this gate is what lets the pipeline proceed without Daniel.
- In a **supervised** run, it pre-screens: Daniel only reviews drafts it greenlit, or adjudicates the
  ones it flags (and each disagreement becomes new calibration data).

Rationale for add-not-merge: `critics.md` removes *known* tells during generation; proxy-judge renders
the *acceptance verdict* after. Different jobs. Keeping the floor intact means we add only the missing
piece and disturb no working machinery.

### 2.3 Placement (project-scoped — never the global `~/.claude`)

- Skill: `faceless-youtube/.claude/skills/proxy-judge/`
- Taste packs + calibration sets: `faceless-youtube/knowledge/proxy-me/<facet>/`
- Per-channel taste docs (grammar, rubric, gold) are resolved via the manifest, not copied.

Matches the project convention ("skills are code, channels are data"; skill names unique to this
project) and inherits the project `CLAUDE.md` context automatically.

---

## 3. The judge I/O contract

**Reads:**
- `videos/<slug>/script.md` — the post-humanize draft under judgment.
- The facet taste pack (grammar, rubric, gold, calibration set).
- The **leash critic's accuracy findings** for this draft (called/consumed, not recomputed).
- `research.md` — only as the leash critic's reference; the judge itself does not re-trace facts.

**Writes:** `videos/<slug>/judge-verdict.md`:

- **Verdict:** `greenlight` | `revise` | `reject`.
- **Score:** the `/36` with per-dimension 0/1/2, auto-flagging any gate violation (a 0 on dimensions
  1/4/8/11/13/14/16/17/18, or total < 30 — the `watchability-rubric.md` gate).
- **Ranked redirects** (most-damaging first): each = the exact offending quote · which rubric
  dimension / grammar rule / calibration preference it violates · one line of why · the substantive
  change wanted (cut / rewrite-toward-X / add color / etc.). **Phrased however is clearest — voice is
  not imitated.**
- **Confidence + calibration anchor:** how sure it is, and which calibration example this draft most
  resembles (grounds the verdict in Daniel's past judgments, not a free-floating opinion).
- **Proposed-rule stub (named, NOT applied):** if it rejects for something not in the grammar, it names
  the gap for the human. Zero write access. A seam toward v2.

**Two locked commitments:**
1. **Advisory + legible.** Every reject is quote-anchored so Daniel can overrule it; the overrule is
   logged as calibration data.
2. **Taste + integration, not fact-tracing.** Accuracy stays with the leash critic; the judge integrates
   its output into the holistic verdict.

---

## 4. Calibration & validation (the make-or-break)

The judge itself is small; the value is entirely in the answer key. To prove proxy-Daniel ≈ Daniel and
to capture his uncodified content preferences, assemble a labeled set:
`(script version → Daniel's verdict → the substantive changes he wanted → what changed)`.

### 4.1 Answer-key sources (decided: clean assets + a bounded dig)

1. **Clean / free:**
   - gold Poyais `script.md` = one `accept`.
   - the §5 before→after "before" lines = line-level `reject + the substantive fix`.
   - the **git history of `script.md`** — each commit is an implicit "not good yet, change *this*".
2. **Bounded transcript dig (repurposed):** a *targeted* harvest of the script-gate moments in the
   session transcripts — scoped to where Daniel reacted to drafts, NOT all 679 MB. Purpose: capture his
   **uncodified content judgments** (the substantive "change this" calls not yet in the grammar). Not
   phrasing/voice — substance.
3. **Held-out generalization set (needs Daniel):** ~5–8 drafts, **including ≥1 non-Poyais topic**, that
   Daniel and proxy-Daniel each judge **blind**; agreement is then measured.

Output of calibration = `knowledge/proxy-me/story/calibration-set.md` (the labeled judgments) that the
judge reads as part of its taste pack.

### 4.2 The "proven" bar

On the held-out set:
- **Verdict agreement** — does it greenlight/revise/reject what Daniel does?
- **Same-lines agreement** — does it flag the same substantive problems on the same lines?

(Feedback-style match is explicitly NOT a criterion.) A concrete pass threshold is set at
implementation time from the held-out results; the harness is only **frozen and replicated** to other
facets after Story clears this bar.

### 4.3 The over-fit risk (must be tested, not assumed)

The entire gold answer key is one topic (Poyais). The repo itself repeatedly flags "not yet validated on
a fresh topic." A judge calibrated only on Poyais will confidently mis-rate other niches. The non-Poyais
draft in the held-out set is the required guard; generalization is a test, not an assumption.

---

## 5. Generalization to other facets (design-only, not built in v1)

Nothing facet-specific lives in the harness. To add a facet later:

- Author its **taste pack** (rubric + gold + grammar) and **calibration set**.
- Point a small **facet manifest** at those files.
- Reuse the same skill + subagent + verdict contract + calibration protocol.

```
facet: story → grammar: channels/<ch>/storytelling-grammar.md
               rubric:  channels/<ch>/watchability-rubric.md
               gold:    videos/2026-07-04-poyais/script.md
               calib:   knowledge/proxy-me/story/calibration-set.md
               gates:   no-0 on {1,4,8,11,13,14,16,17,18}, total ≥ 30
facet: idea  → rubric:  idea-generator payload rubric (exists)
               gold:    Daniel's actual picks/edits in idea-backlog.md
               calib:   knowledge/proxy-me/idea/calibration-set.md
facet: art   → grammar: visual-kit/visual-grammar.md + style-bible gates
               calib:   knowledge/proxy-me/art/calibration-set.md
```

Mirrors the existing `universal.md` law + per-channel dials doctrine, so it reads as native to the repo.

**Proving order (locked):** Story → clears the calibration bar → freeze the harness → idea → art.
Voice-me deprioritized (largely locked already).

---

## 6. Components (for the implementation plan)

1. **`proxy-judge` skill** (`.claude/skills/proxy-judge/SKILL.md`) — resolves the facet manifest, gathers
   the taste pack + the leash critic's findings, dispatches the fresh-context judge subagent, writes
   `judge-verdict.md`. Facet-agnostic.
2. **The judge subagent prompt** (`references/judge.md`) — the holistic acceptance-judge mandate: score
   the `/36`, integrate accuracy findings, apply the calibration preferences, emit the verdict contract
   of §3. Story-parameterized via the manifest.
3. **Facet manifest** (`knowledge/proxy-me/facets.md` or per-facet front-matter) — the pointer table of §5.
4. **Calibration set builder** — the process + output `knowledge/proxy-me/story/calibration-set.md`:
   harvest clean assets + the bounded dig, then run the held-out blind-rating and record agreement.
5. **Verdict schema** — the shape of `judge-verdict.md` (§3).
6. **Wiring** — how the gate slots after `humanize` (a step in `long-form-writer`'s pipeline, or an
   orchestration doc), advisory in supervised mode, blocking in autonomous mode.

## 7. Open items to resolve during planning
- Exact numeric "proven" threshold (set from held-out results).
- Whether the gate is invoked inside `long-form-writer` or as a standalone pipeline step.
- The precise mechanism for the judge to consume the leash critic's findings (re-run it vs. read a
  stored findings file).
- Format/'schema of `calibration-set.md` (how a labeled judgment is represented).

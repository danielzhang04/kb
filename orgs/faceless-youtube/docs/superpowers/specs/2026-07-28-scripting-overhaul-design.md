# Scripting overhaul — Bricks-era voice bar, blind-protocol retirement, writer cultural pull

**Date:** 2026-07-28 · **Approved by:** Daniel (interactive session, all decisions below are his rulings)
**Goal:** research → script in ONE pass produces a script Daniel is happy to take to image gen. The
enemy is the flat, dead, textbook script (the published Poyais failure). Every change below CHANGES or
REMOVES existing functionality — nothing is bolted on as an exception or a "do" list.

## Rulings (Daniel, 2026-07-28)

1. **Blind control/candidate protocol RETIRED.** All "blind fixture" / "blind reader bundle" machinery
   comes out of critics.md and the calibration doc. Acceptance = a fresh full writer run Daniel reviews
   directly. (Reverses the 2026-07-26 blind-validation plan.)
2. **The voice bar becomes `channels/the-second-take/example-scripts.md`** — moved + renamed from
   `long-form-writer/references/personable-calibration.md` (channel data lives with the channel).
   Contents: Daniel's approved MacGregor excerpt (verbatim, 2026-07-28 edit) + a polished Bricks intro
   (gate: Daniel approves the text before it enters the file). The file is designed to grow with more
   approved excerpts; each carries a 2–3 line "what this demonstrates" note. Writers match its energy;
   judges judge against it.
3. **Excerpt cuts are taste verdicts.** Lines Daniel deleted from the MacGregor excerpt are PURGED as
   grammar exemplars: the Bali tourist-cab analogy, "Most people would look at that and become a
   landowner", "See? He is the Madoff of the 1820s", "Even Thomas Jefferson is looking a little
   overpriced", the "Step one in selling a fake country" echo formula, plus non-excerpt legacy quotes
   ("Official Shoemaker to the Princess of Poyais", "Did I mention he'd made a flag?"). All grammar
   inline examples are re-drawn ONLY from the two approved excerpts.
4. **Hook shapes are an OPEN SET.** §2.1 rewords to: the hook's job is intrigue in the door, shape
   free. Named example shapes: the paradox cold-open AND the era drop-in ("We're in the 1980s, home to
   [era icons], and one of the funniest corporate scams you've never heard of" — self-positioning the
   story is legitimate). Other shapes may be invented. What stays dead: outlining the story's beats.
5. **Sanctioned moves (rules reworded, not excepted):** the spoiler wink ("well, the title gives it
   away") joins pre-spoiled tension (§3.6); the doorway line ("Here is the story of that company.") is
   legitimate — §3.4's transition rule keeps only the literary connectors dead ("which brings us to,"
   "little did they know"); the everyman gloss ("these things called hard drives, which are
   basically…") folds into §1.1 contextualize-in-same-breath; the short-punch rule stops catching
   enumeration momentum ("Peru. Chile. Argentina.").
6. **Narrator irreverence widens** per the approved excerpt: "The balls on this guy, huh?",
   Megamind, Jordan Belfort are in-bounds. The universality bar governs: every pull (humor, metaphor,
   phrasing, era anchor) must be something a general viewer instantly understands — the approved
   excerpts are the calibration for that bar. Evergreen-only survives.
7. **Writer cultural-pull capability (NEW, absent today — audited 2026-07-28):** the writer, not the
   researcher, owns cultural material. Inside Step 3a (outline), while building the spine: gather era
   anchors and candidate comparisons/jokes per beat, WebSearch licensed for era texture and for
   sanity-checking that a reference is universally understood. Implemented by CHANGING 3a's text, not
   adding a step/file. The researcher firewall ("does not write the analogies") stands.
8. **Voice dials:** dna.md voiceover config stability 0.25 → 0.20, style 0.4 → 0.6 (more variance +
   expressiveness, Daniel's order). Lock comments rewritten; voice ID stays locked. Values verified
   against `voiceover.py` v3 handling before commit.
9. **Scope:** long-form-writer (SKILL + critics + lint), storytelling-grammar, example-scripts,
   proxy-judge docs, dna.md voice/humor config, shorts-writer sync. Researcher and idea-generator
   untouched tonight.

## Architecture after the change

- `channels/the-second-take/example-scripts.md` — the voice bar (data). Referenced by: grammar header,
  writer SKILL Step 1, all critic prompts, proxy-judge judge.md + facets.md, shorts-writer.
  `personable-calibration.md` is deleted; every reference re-pointed; `test_resolve_manifest.py`
  updated.
- `storytelling-grammar.md` — the craft law (rules + inline examples drawn only from approved
  excerpts). No overlap with the writer SKILL (process) or dna.md (dials/identity).
- `long-form-writer/SKILL.md` — pure process, now including the 3a cultural-pull sweep.
- `critics.md` — enforcement aligned to the reworded grammar so no critic flags a sanctioned move;
  blind-fixture lines removed from all six prompts.

## Acceptance

1. Grep-clean: no `personable-calibration` references, no blind-bundle/blind-fixture text, no purged
   exemplar lines anywhere in scope; `test_resolve_manifest.py` and `test_lint_script.py` pass.
2. A fresh `long-form-writer` run on the existing Bricks research (scratch slug, zero spend, old
   script untouched) produces a script Daniel accepts as hitting the bar. That run is the test of the
   whole exercise.

## Human gates

① Design/spec — PASSED (this doc). ② Bricks exemplar text — Daniel approves before it enters
example-scripts.md. ③ Fresh Bricks script — Daniel reviews.

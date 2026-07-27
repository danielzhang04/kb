# The critic layer (Step 3d) — fresh-eyes review that edits

This is the enforcement layer for the defects a writer **cannot catch in its own prose** — the taste and
voice flaws that survive self-editing because the writer already made the judgment call when it wrote the
line. A blind regen proved it: the writer shipped grandeur buttons and dwell straight through its own editor
pass. Fresh, single-mandate readers with no attachment to the draft catch what the writer structurally can't.

**Scope:** this runs in `long_form: staged` Step 3d, after the leash pass (3c), before humanize (Step 5). It
is deliberately **thin**: four fresh critics (taste, leash, coherence, raw-versus-leashed) + one editor, plus a single capped
writer structural pass when coherence flags a structural hole, plus a mechanical lint. It does NOT re-research;
and it re-does structure only through that one capped writer bounce, which the writer (not the editor) owns.

## Orchestration (one cycle for line-level; at most one structural bounce)

```
draft script.md
  → mechanical lint            (scripts/lint_script.py — deterministic; see below)
  → taste ∥ leash ∥ coherence ∥ raw-vs-leashed  (four parallel subagents; each returns FINDINGS only, edits nothing)
  → route on the coherence critic's [LOCAL]/[STRUCTURAL] tags:
      • only line-level findings (taste + leash + [LOCAL] coherence):
          → editor             (one subagent: applies fixes IN VOICE → revised script + changelog)
      • any [STRUCTURAL] coherence finding:
          → writer structural revision  (one subagent: reworks the sequence/framing of the flagged spans,
            from ALL FOUR findings lists at once, leashed → revised script + changelog)
          → re-verify once     (leash re-read: no invented facts; coherence re-read: the confusion is gone)
  → mechanical lint again      (confirm no new dash/trace; word count still sane)
```

Run the four critics **in parallel** (they're independent), then route on the coherence critic's severity
tags. **One cycle only for line-level edits, and at most ONE structural bounce for coherence** — never loop
critic→edit→critic. If the re-verify still finds the structure confusing, the final lint trips, or a changelog
flags something unresolved, **surface it to the human** instead of spinning.

**Taste and leash are subtractive; coherence is the one additive/structural lane** — a comprehension gap is
usually fixed by building the missing connection into the telling or resequencing, not by cutting, so its
structural findings go to the *writer* (who owns structure), not the *editor* (who only touches flagged lines).

**Everyone reads the bar first:** every agent below receives `storytelling-grammar.md` (the craft rules,
including §3.7 non-linear-but-followable, and the §5 before→after bank) plus the approved
`personable-calibration.md` excerpt. Blind fixtures receive the purpose-built reader bundle instead: approved
brief, research/ledger, the grammar's rules, and that excerpt. They receive no legacy candidate script.

---

## The mechanical lint (not an agent — a script)

`scripts/lint_script.py <script.md>` deterministically flags only what needs no judgment:
- **em/en dashes** (`—` / `–`) anywhere in the file — hard violation.
- **leftover `<!--F-NN-->` traces or outline comments** that must be stripped before ship.
- **word count vs. target runtime** (words ÷ 150 vs. the header's target band) — a heads-up, not a failure.
- **Step cards** only for malformed, duplicate, skipped, or orphaned spoken `Step N:` sequences — hard
  mechanical failures. The lint does not require cards or judge whether a causal mechanism earns one.
- **quotation marks** in VO lines — a non-blocking advisory (reported speech is the default telling mode,
  grammar §4; whether a quote earns its place is the taste critic's call).
- **credibility-padding phrases** (`that part is real`, `he actually did`, `he really did`, `seriously`) as
  non-blocking exact-phrase advisories. Contextual `actually` or `really` is taste-critic territory.

---

## Taste critic

> **You are a ruthless script editor with ONE job: find every place the draft slips out of the channel's
> voice.** You did not write it, you have no attachment to it, and your entire value is catching what the
> writer cannot hear in its own prose. This is a **taste pass — ignore factual accuracy completely** (a
> separate critic owns that).
>
> **Read first, they define the target:** `storytelling-grammar.md` for the craft rules, §1–§2 voice/story
> principles, and §5 before→after bank; then `personable-calibration.md` for the right narrator energy,
> analogy use, chaptering, and delivery. Do not load any legacy script for a blind fixture.
>
> **Hunt for these, and only these. Quote the exact offending text for every finding:**
> 1. **Grandeur / summary buttons** — a beat that ends on a summary, thesis, or profound line instead of a
>    fact or action. Read the LAST sentence of every paragraph: it must land on a concrete noun, name,
>    number, or action. (Tell: "It was just the biggest version of it." / "the fake country and the real ones
>    died the exact same death.")
> 2. **Dwell / harping** — a point restated for emphasis after it already landed; a triple-build of one idea
>    ("what it could be… something even better… a place already finished"); circling back to an irony you've
>    already made. (§2.5)
> 3. **Writerly / literary** — clever-convoluted sentences, aphorisms written to sound deep, any line no real
>    person would say aloud to a friend. (§1.1)
> 4. **Premise over-restatement** — count how many times the core premise recurs across the whole script
>    ("it didn't exist" / "a country that wasn't there"). Past ~2–3, flag the weakest repeats to cut.
> 5. **Jargon** — a term a normal person wouldn't say in conversation, where a plain word exists. (§1.1)
> 6. **Empty signposting or list scaffolding** — flag a label that hides the next action ("this is the part
>    worth slowing down for," "here's the strange part") or labels bare chronology. Do **not** flag an
>    optional `Step N:` that names a sourced causal lever and helps the viewer assemble a real scheme.
> 7. **Flat or educational analogy / dead joke** — flag an analogy that derails the mechanism, repeats a
>    point that already landed, or makes the fact harder to follow; flag a joke that rides no fact or reads
>    dated/cringe. Do **not** use analogy counts or a missing-analogy quota as a finding. (§1.4, §6)
> 8. **Register error** — any joke or wink on a death / human-cost beat (comedy is OFF there, §1.7), or
>    flat, humorless telling of a money-absurdity beat that should run hot (the humor dial in `dna.md`).
> 9. **Lesson / essay close** — a moralizing ending ("it repeats every generation," "and that's why")
>    instead of one earned ironic image. (§3.5)
> 10. **Credibility padding in context** — exact boilerplate phrases are lint advisories; judge contextual
>     `actually` and `really` only when they make the narrator insist on credibility instead of stating the
>     fact. Do not turn this into a word ban. (§1.6)
>
> **NEVER flag these — they are correct and MUST survive (over-cutting is the failure mode):**
> - **Fact-riding deadpan buttons** ("And him? He was fine.") — the GOOD kind (§1.3). Only flag buttons
>   that *summarize or moralize*, never a dry factual aside.
> - **Concrete-detail color** — a name, a number, a vivid image is what makes a beat live; keep it. Flag
>   *repetition*, never *detail* (§2.5).
> - The single earned resonant line at the very end.
>
> **Output** a ranked list, most-damaging first. Each finding: the exact quote · its location · the flaw #
> above · one sentence of why · a concrete suggested fix (rewrite or cut). If a stretch is clean, say so —
> do not invent problems to look thorough. A vague finding is useless; quote exactly.

---

## Leash critic

> **You are a fact-checker with ONE job: verify every claim in the draft traces to the research ledger.** You
> did not write the script and you are not here to judge its style — only its truth. **Read
> `research.md`** (the `[F-NN]` fact ledger and its `Conf:` levels and Open Questions) and the draft.
>
> **Flag, quoting the exact text each time:**
> 1. **Unsourced claim** — any hard factual statement (a name, date, number, event, causal claim) that does
>    not trace to an `[F-NN]`. This is the leash; an unsourced claim is a must-fix.
> 2. **Confidence violation** — a `Conf: low` fact stated flat, with no hedge; or an Open-Question item stated
>    as settled (e.g. a precise death toll, a specific trial venue) where research says to hedge.
> 3. **Invented color** — a vivid detail, quote, or specific that reads great but is not in the ledger. Great
>    prose is not a source; flag it.
> 4. **Contradiction** — anything that states the opposite of, or a distortion of, what the ledger says
>    (e.g. nationality, who did what, the order of events).
>
> For each: the exact quote · the `[F-NN]` it should map to (or "NONE") · the problem · the fix (cut, hedge,
> or which sourced version to use). Do not flag style, pacing, or voice — that's another critic's job.

---

## Raw-versus-leashed critic

> **You are a fresh preservation reader.** Compare the raw casual story pass, the leashed draft, and the
> research ledger. You do not judge general taste or re-fact-check every sentence. Flag only a changed sentence
> where the ledger required a correction that could have been local, but the leash edit also altered unrelated
> rhythm, wording, conversational joints, repetitions, slang, comic cadence, or narrator presence.
>
> A local factual correction is allowed and required. This is not a diff quota: do not flag a changed sentence
> merely because it changed, and do not demand that a non-local correction remain. When a claim cannot be
> fixed locally, the correct result is a writer-facing research-gap flag, not a polished replacement paragraph.
>
> **Output:** each finding gives the raw sentence, leashed sentence, supporting `[F-NN]` or gap, the smallest
> factual correction that was available, and the unrelated voice loss. Return `no preservation finding` when
> the leashed text preserved the raw voice.

---

## Coherence critic (first-time viewer)

> **You are watching this as an average viewer who knows NOTHING about the topic going in, with ONE job: find
> every place the story stops making sense.** You did not write it, and you are not judging its style or its
> facts (other critics own those) — only whether a first-time viewer can follow *what happened* and *how each
> piece connects*.
>
> **Read first:** `storytelling-grammar.md` §3 (structure), especially **§3.7 (non-linear, but followable)**
> and **§3.6 (pre-spoiled endings / withheld payoffs)**, plus `personable-calibration.md`. That is the bar:
> jumping around is GOOD; losing the viewer is the defect. Do not load a legacy script for a blind fixture.
>
> **Flag only genuine, UNEARNED confusion. Quote the exact text and say what a real viewer would ask:**
> 1. **Used-before-introduced** — a person, place, company, or term the story leans on before it has been
>    introduced or explained (viewer: "wait, who/what is that?").
> 2. **Unestablished connection** — two things the story treats as related without ever establishing how
>    (viewer: "what does X have to do with Y?"). This is the big one.
> 3. **Unreconstructable plot** — a stretch where a viewer could not say what actually happened, or in what
>    causal order.
> 4. **Self-contradiction of the story's own logic** — a beat that builds one model, then a later beat that
>    silently negates it and strands the viewer (e.g. "so THAT was the con"… then "the bands were never the con").
>
> **NEVER flag these — they are the channel's craft, and flagging them is the failure mode:**
> - **Non-linearity itself** — cross-cuts, rewinds, dives-and-backtracks, geographical or thread swaps
>   (§3.1/§3.3). A jump is not a defect; only a jump a first-timer *cannot follow* is.
> - **Deliberate withholding / suspense** — a question the story clearly raises and will pay off later (§3.6),
>   including a pre-spoiled ending. A *withheld* answer is good; only an *unestablished* connection is bad.
> - Anything merely "could be richer" or "I'd like more detail." That is not a comprehension failure.
>
> **Tag every finding with its remedy:**
> - **[LOCAL]** — a genuinely isolated fix a single clause solves (one fuzzy referent). The editor can patch it.
> - **[STRUCTURAL]** — the confusion comes from how the story is built, sequenced, or what it establishes and
>   when. **Do NOT propose bolting an explaining sentence onto the front of the confusing beat** — say what
>   needs to be introduced earlier, moved, or reframed. These go back to the writer for a real structural fix.
>
> **Output** a ranked list, most-confusing first. Each finding: the exact quote · the viewer's question · the
> flaw # · **[LOCAL] or [STRUCTURAL]** · the fix (what to introduce/move/reframe, never a patch to paste). If a
> stretch is perfectly followable, say so — do not invent confusion to look thorough. Telling a real hole from
> designed suspense is the entire skill here.

---

## Editor

> **You are the editor. You take the findings lists (taste + leash + any [LOCAL] coherence) plus the draft, and
> you produce the revised script.** You are the one hand that keeps the voice coherent, so you apply *all* the
> line-level fixes yourself rather than letting each critic hack at the prose. (Any **[STRUCTURAL]** coherence
> finding is NOT yours — it goes to the writer structural pass below.)
>
> **Read** `storytelling-grammar.md` (craft rules + §5 bank) and `personable-calibration.md` so your rewrites
> land in the channel's voice. Do not load any legacy script for a blind fixture.
>
> **Rules:**
> - **Touch only flagged lines.** Do not free-write, re-order, or "improve" lines no critic flagged. Your job
>   is surgical.
> - **Fix in voice, don't just delete.** A flagged button becomes a good line (end on the fact/action), not a
>   hole. A flagged dwell collapses to one clean sentence. Preserve the color and the fact-riding wit.
> - **Conflict rule:** if taste says cut a line but leash says it's the only home for a sourced fact, **keep
>   the fact, rewrite the line** so it's no longer a button. Never drop sourced substance to satisfy taste.
> - **Don't introduce new buttons.** After editing, re-read the last sentence of every paragraph you touched;
>   it must end on a fact/action, not a summary.
> - **Leash is absolute:** apply every leash fix (cut/hedge). Never add a detail to "improve" a line.
>
> **Output:** the full revised `script.md` (same header, cues, and Sources), plus a short **changelog** —
> one line per change: what you cut/rewrote and which finding it resolved. If two findings genuinely conflict
> and you can't resolve one, leave the line and note it in the changelog for the human.

---

## Writer structural revision (the [STRUCTURAL] coherence path only)

> **You are the writer, back for ONE targeted structural pass.** The coherence critic found a **[STRUCTURAL]**
> problem: the story, as sequenced, loses a first-time viewer. You also hold the taste and leash findings. Fix
> the structure so the through-line is followable (grammar §3.7) while keeping the voice and staying leashed.
>
> **Read** `storytelling-grammar.md` (craft rules, §1 voice, §3 structure incl. §3.7),
> `personable-calibration.md`, and `research.md` (the ledger). Do not load a legacy script for a blind fixture.
>
> **Rules:**
> - Fix the confusion the way the critic tagged it: **resequence, introduce something earlier, or reframe a
>   beat's role. Do NOT just paste an explaining sentence in front of the confusing part** — if the structure
>   is the problem, change the structure.
> - You may reorder beats, move a connection up front, or rewrite a span, but change only what the coherence
>   finding requires; do not touch clean stretches, and keep the story concluding exactly once, at the end.
> - Apply the taste and leash findings to any lines you touch, in voice. **Leash is absolute:** if making the
>   story connect needs a fact that is not in the ledger, do NOT invent it — flag it in your changelog as a
>   research gap for the human.
> - No em/en dashes; end beats on a fact/action; reported speech stays the default telling mode (grammar §4).
>
> **Output:** the full revised `script.md` + a short **changelog** (what you resequenced/reframed and why, and
> any research gap you hit). This is the ONE structural pass; it is re-verified once, never looped.

---

## Notes for the skill

- On a channel **without** subagents available, run the taste, leash, and coherence passes as three deliberate,
  separate fresh re-reads against the prompts above (still better than one blended pass), then edit — and, if a
  structural coherence hole surfaced, do the one writer structural pass. But prefer real subagents; the fresh
  context is the whole point.
- **Taste and leash are subtractive by design.** If they ever start flattening the voice (cutting good color or
  wit), that's the taste critic over-triggering — loosen its "never flag" list, don't add more flaws to hunt.
- **Coherence is the one additive/structural exception**, and it over-triggers the same way: if it starts
  flagging non-linearity, cross-cuts, or designed suspense as "confusion," tighten its never-flag list. Its
  power to restructure is bounded to the single capped writer bounce; past that, surface to the human.

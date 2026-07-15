# Storytelling Grammar + Skill Restructure — Design Spec

**Date:** 2026-07-07 · **Status:** design, awaiting user review before implementation.

## Problem

The channel's craft docs and pipeline skills accreted as **append-only date-logs**, not structured
knowledge. Concretely:

- **Two grammar docs that overlap and CONTRADICT.** `script-craft-grammar.md` concludes "70–85%
  payload / ~1 joke a min / refuse the comedian persona"; `narrative-register-grammar.md` says
  "comedic, 2–3 a min." A writer reading both gets whiplash; the pipeline defaults to flat, linear
  fact-telling.
- **Dated append-sections masquerading as general rules** (`§A8 added 2026-07-07`, `§B0/B7/B8 added
  2026-07-07`) that are really *Poyais post-mortems* full of one-video specifics ("St Joseph had
  boulevards," "Gregor MacGregor," "Bolívar").
- **Orphaned reference-quotes** ripped from analyzed videos with no context showing how the learning
  applies — they teach a fresh run nothing.
- **`long-form-writer` SKILL.md** has ~8 bolted-on "2026-07-07 correction" bullets in Step 3-shared,
  each pointing at a `§B7/§B8/§A8` in the doc being deleted.
- **Visual skills drifted too:** `visual-prompt-writer`'s "Mental model" says "three things are
  load-bearing" then lists four (append-drift in miniature); load-bearing rules are buried in prose.

## Goals

1. **Rebuild, don't purge.** Preserve EVERY real learning — they were expensive to discover. Cut only
   genuine noise (dated scaffolding, orphaned quotes, duplication, verbose restatement). "Verbose" ≠
   "informative."
2. **One structured grammar doc**, organized by topic, concise + comprehensive, current, non-contradictory.
3. **Correct the register model** to what the reference channels actually do (see Findings).
4. **Fix the linearity failure** with a named cross-cutting/architecture toolkit.
5. **Reconcile every downstream file** to the one doc; emphasize the load-bearing rules.
6. **Restructure the two visual skills** (skill-hygiene, not rewrite) via proper skill tooling.
7. **Build a durable mechanism** so docs never rot back into append-logs.

## Non-goals

- Not changing the pipeline architecture, cost tiers, or the fact-ledger/leash/defamation discipline.
- Not re-researching the reference channels beyond the fresh analysis already done.
- Not touching the LOCKED style-bible or voice lock.

---

## Findings (the fresh analysis this rebuild is built on)

Source: two fresh HeyHistorically videos (Nassau pirate republic; Abd al-Rahman refugee-prince), two
fresh Crayon videos (AI Bubble; Rockefeller), plus a de-duplicated mine of the 13 existing per-video
notes. The three corrections that reshape doctrine:

### F1 — Register is a DIAL set by topic gravity, not a fixed rate. (headline correction)
Measured: Crayon runs **~4–5 witty beats/min on money-absurdity** (AI Bubble) but **~1–2/min and wry on
human-villainy** (Rockefeller); HeyHistorically runs **~4–6/min on absurd systems** and **goes cold on
bodies**. So both old constants were wrong. The rule: **the writer sets the comedic dial by subject
gravity, and kills comedy entirely on human cost.** The Second Take is **storytelling-first** — more
witty/comedic than any pure finance-or-history channel, modeled on HeyHistorically/Crayon *as
storytellers*, without becoming a comedy channel.

### F2 — The linearity fix is a concrete cross-cutting toolkit.
The reference channels are *mostly chronological* yet never read linear, because they (a) impose a
non-chronological organizing FRAME, (b) weave parallel threads, and (c) stage scenes instead of
summarizing. Named mechanics in §1 below.

### F3 — Every best move survives our constraints via reported speech.
Our locks: **third-person only (no "you"), ONE narrator, NO quotes in scripts.** The reference channels
lean hard on second-person and voiced dialogue — but the *scene, irony, and vividness* all survive when
the narrator **characterizes** what was said with attitude instead of quoting/voicing it. This is the
unlock, §3 below.

---

## The merged doc — `channels/the-second-take/storytelling-grammar.md`

Replaces `script-craft-grammar.md` + `narrative-register-grammar.md` (both deleted). Raw
`research/**/char-*.md` notes stay as the evidence archive. Below is the target content, condensed to
portable principles. Reference examples appear ONLY where they show how a principle applies (≤1 each).

### 0. What this channel is
- **Storytelling-first, witty register.** More comedic than any pure finance/history channel; models
  HeyHistorically + Crayon *storytelling*; not a comedy channel.
- **Two locked constraints:** (1) **No second person** — never cast the viewer as "you." (2) **One
  narrator** — no voiced character exchanges; all reported speech; **no quotes in the script.**
- **Our edges we protect (see §5):** payload-first, fact-ledger leash, defamation discipline, and our
  proven craft wins.

### 1. MACRO ARCHITECTURE — design the story; refuse chronology
- **1.1 Organizing frame.** Before outlining, pick a frame that is NOT chronology and force the material
  into it — the frame does double duty (structure + running motif). *E.g. 12 chaotic years told as "four
  presidents of the pirate republic"; a fraud as "the five promises."*
- **1.2 Paradox-hook + rewind.** Cold-open on the sharpest ironic contradiction stated as settled fact
  with the mechanism withheld (never the chronological start); drop the title after the hook; then an
  overt **rewind + dateline reset** ("July 8th, 1839…") is the audible gear-shift into the story. Visible
  seams are part of the voice.
- **1.3 Arc shape — name the reversal.** In one sentence, name the reversal the hook promised ("the thing
  that should have destroyed them made them stronger") and write toward it. No clean reversal → hand off
  to an **analytical framework** at the turn (question → rubric → evidence). Menu of shapes: disaster arc,
  rise-and-fall, question→framework→evidence, one-souring-relationship (for sprawl), escalation-list-as-arc.
- **1.4 Cross-cutting toolkit (the linearity fix).**
  - **Board-state cross-cut** — before the protagonist acts, lay out every faction's *simultaneous*
    position, then drop him in so the move lands with weight. *("While X was in London taking out loans,
    across the world the settlers were stepping off the boat into a swamp.")*
  - **Park-and-cut** — interrupt a rising thread to jump to another, naming the move ("meanwhile, back
    with…"); the parked tension holds.
  - **Ensemble reaction montage** — one triggering event → snap-cut between several actors reacting.
  - **Mirror cross-cut** — place two parallel figures so one reframes the other (the antagonist who is
    secretly the same story as the hero).
  - **Irony cross-cut** — for pre-spoiled endings, intercut one side's obliviousness against the
    gathering disaster.
- **1.5 Plant-and-detonate + spine.** Plant a loaded detail in act one, detonate it at the turn. Bind the
  whole piece with ONE controlling motif — a recurring **epithet** ("the bookkeeper") + an **obsessive
  object** — that tracks the character across time; plant → payoff → invert.
- **1.6 Scene-as-default.** The unit is a staged scene, not a narrated year. Stage the **4–6 highest-charge
  moments** (a showdown, a threat, a negotiation); summarize the connective tissue in a line. Rendered as
  reported speech (§3), never voiced.
- **1.7 Mechanism-assembly + decision-tree.** For "how it worked," install ONE nameable lever per beat
  with the causal signpost said out loud ("here's the crucial part…") so the viewer watches the machine
  get built. For a fork, stage the **costed decision space** (Option A/B/C with real tradeoffs), then
  collapse to what happened — tailor-made for finance.
- **1.8 Emotional contour.** Tone is a designed rollercoaster/sawtooth. **Front-load the silliness so the
  video earns a serious ending; let jokes recede in the last act;** the baseline darkens under the humor.
  Comedy density is inverse to stakes.
- **1.9 Transitions (the seam kit).** Leave zero flat "and then" seams:
  - **Turn-word grammar** — one clause that closes the prior beat and opens the next ("Then things got
    worse." / "Now, back to…").
  - **Exit every beat on an open loop / forward-promise** — a teaser the viewer must stay to collect.
  - **Honest ranked escalation** — "it gets worse" must be followed by something actually worse.
  - **Dates as scene headers**; **value-loaded re-hooks** ("the *real* genius of it"); **fake-out ending**
    (a deliberate wrong ending, then a retract) as a mid-video reset.
- **1.10 Known-outcome tension engines** (our stories are usually pre-spoiled): dramatic irony, comic dread
  (make them wait for a doom we can see), how-badly/how-exactly assembly, micro-suspense inside vignettes.
- **1.11 Exit menu.** Settled story → return to the hook-paradox + a resonant closing note (irony sealed).
  Ongoing story → a suspense triad that refuses to resolve. Also: **where-are-they-now** capsule fates (one
  wry line each), deflate-don't-resolve, bathos button, sequel/loop-hook. Never a tidy "and that's why."
- **1.12 Managing complexity.** Legibility-by-subtraction (skip whole subtopics via assumed knowledge),
  deadpan compression-by-list (only when every fragment is a hard fact and it deflates), name the takeaway
  in ONE flat declarative after the entertaining scene.

### 2. REGISTER — the witty narrator
- **2.1 THE DIAL (headline rule, F1).** Set the comedic dial by topic gravity *before writing*:
  money-absurdity/systemic-farce → hot (~4–5 beats/min); human-villainy/ruin → wry + sparse (~1–2/min);
  **human cost → comedy off entirely.** Not a constant.
- **2.2 The voice.** Fast, wry, hyper-literate; invested; roasts the fools (con-man, market, institution)
  — never the mark or the viewer. Third-person; the only voice.
- **2.3 Joke toolbox (all fact-riding).** (1) anachronistic analogy that *teaches* the mechanism [the
  workhorse]; (2) deadpan undercut / bathos; (3) ironic re-label / euphemism-decode; (4) **comic false
  precision** (exact numbers as deadpan authority — strong for finance); (5) deflate-the-powerful
  pettiness; (6) self-aware/meta narrator honest about gaps in the record; (7) personified
  institution/nation with wants; (8) running gag/callback that *encodes a fact*; (9) historical-irony where
  the fact IS the punchline.
- **2.4 Fact-ride delete-test (iron rule).** Delete the joke → the fact survives (loses stickiness); delete
  the fact → the joke collapses. Structure-bearing jokes carry the mechanism; only light garnish is free.
- **2.5 The humor bar (anti-fake-wit gate).** Clearing the toolbox ≠ funny. A joke ships only if: the
  analogy maps onto a modern thing the viewer INSTANTLY & universally pictures (not a private literary
  metaphor or a coined phrase nobody's heard); plain words, narrator never editorializes its own material
  (state the insane fact flat, let the viewer be amazed); concrete pictures over abstract concepts;
  gloss-or-cut every unfamiliar name/term. SCOPE: surgical gates, not license to plain everything down.
- **2.6 Smart-not-cringe.** Apt analogies, short and abandoned instantly; punch up; trust the audience;
  be honest about liberties; **evergreen only** — no memes/slang that date.
- **2.7 Illustrative devices.** Transparently-hypothetical figures ("somewhere a barber in 1929…"),
  narrator-described in third person, are legitimate comedic/emotional devices — not factual claims, so
  they don't touch the leash — as long as they read as obviously illustrative and real named people stay
  sourced.
- **2.8 Comedy OFF for human cost.** On death/cruelty/ruin, jokes stop, prose goes plain and short. The
  earned tonal drop is where emotion lands. But calibrate to the audience's real stake — a 200-year-old
  con is a curiosity, not a tragedy the viewer grieves; don't over-dwell or turn literary-essayist.

### 3. THE CONSTRAINT RE-ROUTING (no "you" / one narrator / no quotes)
- **Second person → third/impersonal.** "Picture this / your money" → a concrete third-person tableau.
- **Voiced dialogue & quotes → reported speech.** Keep the staged scene; the narrator *characterizes* what
  was said with attitude ("calm as a deacon, he offered a simple choice: sell now, or be crushed"), never
  quotes or ventriloquizes. **No quotes in the script at all.** A paraphrase may not add a detail the
  source doesn't support (leash + defamation intact).
- **Explainer-as-rebuttal-to-a-foil** transfers well: "the usual defense is X — the ledger says
  otherwise" (recast from any commenter/second-person framing).
- **TTS-safe.** Keep jokes that live in fact + framing (they read as natural deadpan on a flat voice);
  anything needing performance timing / voices / SFX → narrator-reported or handed to the visual layer.

### 4. STAGING CRAFT (the vindication lever)
- **Verification-as-content** — dramatize the *act of checking* before each accusation; count corroboration
  out loud; stage the exoneration (clear the obvious suspect where evidence is thin to earn the rest); land
  the payoff on the **system**, not the person (also defamation-safe).
- **Character-first villainy** — open one villain-character beat (documented motive/psychology) so the con
  reads as one person's obsession, not weather.
- **Named human stakes** — ≥1 named/sourced victim, landed straight, humor off.
- **Analogy-as-indictment** — the analogy that explains the mechanism AND exposes its flaw (our sharpest
  single move).
- **Money yardstick** — cost-vs-flip / delta-pair numbers ("25–65¢ to make vs $22,000 to resell";
  "$3 → $12 a barrel") over abstract comparisons.

### 5. WHAT WE KEEP / OUR EDGES (don't erode)
Payload-first; the fact-ledger leash; defamation discipline (present documented facts, let the conclusion
be the viewer's inference); front-loaded forbidden-knowledge thesis; analogy-as-indictment; the
person→system landing; the dry deflate close; sourcing discipline (decline unsourced color). The rebuild
adds delivery + architecture on top of these — it never trades them away.

---

## Downstream file edits (reconcile to the one doc)

1. **`.claude/skills/long-form-writer/SKILL.md`** — collapse the ~8 dated "2026-07-07 correction" bullets
   in Step 3-shared into clean craft prose that points at `storytelling-grammar.md` §-anchors. Outline
   pass (3a) drives off §1 (architecture: frame → hook → reversal → cross-cutting → contour → exit).
   Emphasize the three recurring misses: **the gravity dial (§2.1), the cross-cutting mandate (§1.4),
   reported-speech/no-quotes (§3).** Remove the humor-bar duplication (summarize + point to §2.5). Update
   the two "read the channel grammar docs" bullets (they name both old files) to the one new doc.

2. **`knowledge/research/niche-playbooks/universal.md`** — reconcile §5c (script-craft) + §5d (architecture)
   + §1d-V (register) into the gravity-dial + architecture model, **niche-agnostic** (kill the "1/min
   dry-sprinkle" language; state the dial as "set by topic gravity, channel dna sets the band"). This is
   the cross-niche inheritance — keep it general; channel specifics live in the channel doc.

3. **`channels/the-second-take/watchability-rubric.md`** — retune scored dimensions to the new model:
   architecture (non-chronological frame + cross-cutting present), register-by-gravity (dial correct for
   the topic, comedy off on human cost), reported-speech/no-quotes compliance, transition quality (open-loop
   buttons, no flat seams). Drop stale/second-person dims. Keep it scored.

4. **`.claude/skills/researcher/SKILL.md`** — rename the "Verbatim exchanges & scenes" block to
   **"Reportable scenes & characterization"**: extract material renderable as *reported speech* (what was
   said/done, characterized), NOT verbatim quotes to stage (no quotes in scripts). Add an **architecture
   cues** deliverable: the reversal candidate, an organizing-frame candidate, a plant-and-detonate detail,
   cross-cut pairs (who's doing what simultaneously), and decision-tree forks. Cost tier + leash unchanged.

5. **`.claude/skills/shorts-writer/SKILL.md`** — carry the gravity dial + a mini-arc + reported speech;
   hook = the sharpest paradox or the irony. Light touch.

6. **`channels/the-second-take/dna.md`** — re-lock the register block to the gravity-dial + storytelling-first
   framing (replace any fixed joke-rate). Log the change in `knowledge/decisions.md`.

7. **`index.html`** — bump status/last-updated to reflect the consolidation (per the project's keep-the-
   human-view-current rule).

## Visual skills (skill-hygiene pass — preserve every learning, restructure the form)

Use `superpowers:writing-skills` + `skill-creator` (not hand-editing).

8. **`.claude/skills/visual-prompt-writer/SKILL.md`** — fix the "three things are load-bearing → lists
   four" bug; pull the buried load-bearing rules up where a run will see them (e.g. "populate `ken_burns`
   on every shot — Pattern A ignores `motion_prompt`", the Σ-duration rule); de-date inline rationale
   ("the 2026-07-01 wiring decision" → state the rule, not its history); tighten Step 2.5. Same discipline:
   no learning lost.

9. **`.claude/skills/asset-forge/SKILL.md`** — light: fix the one bloated "build the recurring kit" bullet;
   reconcile the `content-language.md` vs `visual-narration-grammar.md` reference. **Reframe the "locked"
   language:** the style-bible is a normal doc whose *spec values* are the source of truth — asset-forge
   should not *silently* drift them mid-generation (the original intent), but they are deliberately
   editable by a human/curation pass. Drop the "never edit, sacred object" tone.

10. **`channels/the-second-take/visual-kit/style-bible.md` — RESTRUCTURE.** Has unstructured cruft. Clean
    it to the same bar: structured, concise, comprehensive. **Guardrail: preserve the actual spec VALUES
    verbatim** (identity descriptor §2, style-only descriptor §2b, acceptance checklist §3, palette hexes
    §4, seed rules §5) — every existing reference frame was generated against them, so changing a value
    desyncs the refs. Restructure the *form* (headings, prose, dedupe, kill cruft); if a value looks wrong,
    FLAG it, don't change it.

11. **Visual grammar docs — AUDIT then fix if needed.** Read `visual-kit/visual-narration-grammar.md` +
    `content-language.md` for the same disease (append-drift, orphaned dumps, staleness). Restructure only
    if present; report findings either way. (User chose: audit, fix only if needed.)

## Durable structuring mechanism (so this never rots again)

12. **`CLAUDE.md` operating rule** — a concise addition to the operating-rules list: *integrate, don't
    append; write each change into the right section and remove what it supersedes; learnings must be
    GENERAL (portable to a new run), never tied to one video/date; no orphaned examples.* Always in context.

13. **New skill `.claude/skills/curate-doc/`** — a small, niche-agnostic, invokable skill that runs a
    structured restructure-and-dedupe pass on any file/folder: read → map the real learnings → detect
    append-drift / contradiction / orphaned examples / duplication → rewrite structured (preserve all
    information, cut only noise) → report the diff. Built with `skill-creator`.

---

## Execution order + validation

1. Write `storytelling-grammar.md` (everything references it) → delete the two old docs.
2. Reconcile `universal.md`, then `long-form-writer`, `researcher`, `shorts-writer`, `watchability-rubric`,
   `dna.md` to it (parallelizable via subagents, each leashed to this spec).
3. Visual skills (8–10).
4. Mechanism (11–12).
5. Log in `decisions.md`; bump `index.html`.
6. **Validate:** regenerate the Poyais long-form through the rebuilt pipeline and read it — is it
   non-linear (organizing frame + real cross-cutting), witty-by-gravity (dial correct, comedy off on the
   settlers' cost), reported-speech (zero quotes), payload + leash intact? Hold voiceover/render until it
   reads right.

## Risks

- **Over-cut.** Mitigation: this spec embeds the full learning set; execution transcribes + integrates,
  it does not re-decide what's worth keeping.
- **Broken cross-references.** Many files name `script-craft-grammar.md` / `narrative-register-grammar.md`
  by path. Mitigation: grep every reference before deleting; update all to the new doc + §-anchors.
- **universal.md niche-bleed.** Keep The-Second-Take specifics out of the niche-agnostic playbook; only the
  general dial/architecture goes there.

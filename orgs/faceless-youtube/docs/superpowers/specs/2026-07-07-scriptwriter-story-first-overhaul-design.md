# Scriptwriter Overhaul: Story-First, Not Fact-Marching — Design Spec

**Date:** 2026-07-07 · **Status:** design, awaiting user approval before implementation.

## The core diagnosis — why the same problems recur every regen

Every regenerated script has the *same* faults because the writer runs a **formula**, not a creative
process. Three structural causes, each producing a cluster of the user's criticisms:

1. **Research-as-script (not research-as-pool).** The writer treats `research.md` as a checklist to
   *cover*, walking the facts in roughly the research's order and cramming in as many as possible. This
   produces: linear fact-marching; non-additive facts included "because they're there" (the "one historian
   argued he half-believed it" line); the finance mechanics dumped in; over-length.
2. **Section-by-section drafting → summary buttons.** Step 3b writes one beat at a time. A beat written as a
   self-contained unit *ends on a thesis/grandeur sentence* ("it was the same vanity, now the size of a
   nation…", "a five-star listing for a place that had never been built", "hold onto him"). We have banned
   these repeatedly (§2.9); they persist because the *drafting structure* generates them.
3. **Payload/leash/"teach-the-mechanism" pulls the writer into EXPLAINER mode.** The doctrine's emphasis on
   payload + §5b mechanism-teaching + the vindication "how did it clear?" makes the writer lecture (the LSE,
   bond denominations, yields), overriding the casual-story register.

**Conclusion:** adding more rules will not fix this. The rules already exist and are ignored because the
*process and structure* override them. This overhaul changes the **process** and adds **hard gates**.

---

## The slate of changes

Each item: the user's criticism → the mechanical cause (skill location) → the fix. Files: `long-form-writer/
SKILL.md` and `channels/the-second-take/storytelling-grammar.md` (channel law) + niche-agnostic bits to
`universal.md`. All integrated in place, no new sprawl, no em dashes in the prose.

### A. STORY-FIRST PROCESS — research is a pool; write an original story, then leash-check it (the biggest lever)

- **Criticism:** "taking the progression of facts too literally… using those facts in a row to tell a story
  linearly… instead of using that as a pool of facts and writing an original story."
- **Cause:** Step 3a builds "the section-by-section structure from the research's facts + story material"
  and records, per section, "Facts it uses — the specific [F-NN] IDs." That is fact-first out;lining. Step
  3b then drafts each fact-cluster. The leash ("state only sourced facts") is silently read as "state *all*
  the facts."
- **Fix — restructure the process into three explicit passes:**
  1. **STORY pass (new, first):** design the story you'd tell a friend: the frame, the arc, and the events
     worth telling. The story's *coverage* is roughly fine as-is; do NOT cut events to save length. What you
     select is the **level of detail** per beat (not everything the research has on it), **which facts** earn
     a place, and the **order and shape** of the telling. The telling should be **NON-LINEAR**: jump across
     time AND place freely, cross-cutting between MacGregor, the settlers, the king, the exchange (§1.4), and
     out of chronological order where it lands harder (e.g. name the bond's later collapse and MacGregor's
     escape, then cut back to the settlers stepping off the boat into the swamp). The story runs on
     causal/thematic logic, not the calendar. **Work top-down: design the STORY, then its PLOT (the
     non-linear sequence), then break the plot into scenes.** Never build up from fact-clusters. Then draft
     it as **one continuous, casual, spoken story**, voice-first, not fact-by-fact. You are telling a story
     that happens to be true, not summarizing a dossier.
  2. **LEASH pass (second):** now go back and check every factual claim against the ledger. Cut or hedge
     anything unsourced. (This is where accuracy is enforced — *after* the story exists, so the story isn't
     shaped by fact-coverage.)
  3. **TIGHTEN + HUMANIZE pass (third):** kill summary-buttons (C), cut repetition, cut jargon (E), verify
     casual voice (D), run the humanizer, zero em dashes.
- **Reframe the leash explicitly:** the leash is a **ceiling** (you may state only sourced facts), **not a
  floor** (you need not state all of them). A great script uses maybe half the ledger. Discarding facts is
  expected and good.

### B. SELECT, DON'T COVER — every fact must earn its place in the story

- **Criticism:** "there is even a decent case that he believed it… that part doesn't add anything to the
  story"; "I wanted it to filter out the facts and write his own script."
- **Cause:** the Step 3a fact-mapping rewards inclusion; the research's Cast/verification/hedge material
  invites the writer to honor every nuance.
- **Fix:** add a hard **selection rule**: include a fact ONLY if it earns its place in *this* story (it
  advances the plot, lands a laugh, or pays off a setup). A true-but-inert fact (a historian's caveat, a
  denomination, a secondary character) is cut, not honored. Delete-test every sentence: does the *story*
  lose anything? If no, cut it.

### C. KILL THE BEAT-ENDING SUMMARY / GRANDEUR BUTTON — structural, not advisory (hard gate)

- **Criticism:** "I don't want the sort of grandeur closing sentences or summary sentences to each beat…
  I've said this many times… it's still happening." Examples: "it was the same vanity, now the size of a
  nation…", "a five-star listing for a place that had never been built", "hold onto him."
- **Cause:** section-by-section drafting (Step 3b) makes each beat a self-contained mini-essay that resolves
  on a thesis. §2.9 bans it as a *rule* but the *structure* keeps generating it.
- **Fix (three parts):**
  1. **Coarsen the drafting unit** from the isolated beat to a **continuous flowing run of connected scenes**
     (which may cross-cut across time and place, per §1.4), so prose runs *continuously* and scenes hand off
     into each other instead of each closing on a button. (Keeps the anti-sag benefit of not drafting the
     whole script in one generation; removes the button-per-beat artifact.)
  2. **Hard rule:** a beat/paragraph may **never** end on a summary, thesis, or "here's what it all means"
     sentence. It ends on the next action, a concrete fact, or a quick joke, and flows on. The story only
     "concludes" once, at the very end.
  3. **Dedicated de-button gate** in the editor pass + humanize: read the last sentence of every paragraph;
     if it summarizes/editorializes/reaches for grandeur, cut it or fold it forward.

### D. CASUAL-FRIEND REGISTER AS THE PRIMARY DRIVER — more story, more jokes, more fun cuts

- **Criticism:** "more casual, more friendly telling of a story comedic vibe… not a lot of metaphors… not a
  lot of jokes… not a lot of fun cuts." The transition example: not "leave them out on the Atlantic for a
  moment, because back in London" but "in the meantime, back in London, MacGregor was chilling. He was rich,
  and he was about to give the government a loan."
- **Cause:** register rules exist (§2.1/§2.2) but sit among many rules; the writer defaults to competent-
  neutral. Transitions (§1.9) are written literary, not spoken.
- **Fix:** make **"tell it out loud to a smart friend"** the single overriding register test, stated first
  and hardest. Every line and especially every transition must pass it (a friend would never say "leave them
  out on the Atlantic for a moment"; they'd say "meanwhile, back in London, MacGregor's getting rich"). Fold
  the user's worked rewrites into §2.2 as the target voice. Strengthen the density expectation: metaphors and
  jokes are the *texture of the telling*, not occasional garnish; the con-build should be *fun*.
  - **Concrete casual devices to use** (the user's target voice): rhetorical-question transitions answered
    casually ("So how does a fake country's bond end up on the London Stock Exchange? Well, as it turns
    out..."); connective tissue like "as it turns out," "here's the thing," "so anyways," "meanwhile, back in
    London..."; getting into a character's head ("MacGregor probably figured, look, I've got this worthless
    swamp..."); metaphors dropped in mid-telling, never announced ("it was basically the dot-com bubble:
    everyone buying in without checking").
  - **Banned (the AI tells the user keeps flagging):** grandiose summary sentences, and the "the
    weirdest / craziest / strangest thing about this whole situation is..." opener. State the thing; never
    announce how remarkable it is.

### E. STORY, NOT FINANCE-EXPLAINER — cut the mechanism lecture, keep the payload as a story beat

- **Criticism:** "all the shit about the London Stock Exchange and the functions of a bond… do I really need
  to talk about how the London Stock Exchange works?"
- **Cause:** payload-first + §5b "teach the mechanism" + the vindication "how did the bond clear" pushes the
  writer to *explain* finance. But this channel is a **money-STORY**, not a finance explainer (dna + the old
  content-language note).
- **Fix:** reassert **story-first over explainer** in the writer. Keep the payload — but deliver it as ONE
  vivid story beat ("the market was so hungry it bought a fake country's debt and traded it next to the real
  thing"), not a tutorial. Cut bond denominations, yields, and "how an exchange works." The amazing *fact*
  stays; the *mechanics* go. **Tension to confirm (see below).**
- **No lesson, no essay conclusion (reinforces §1.11).** "Payload" is not a moral. The story does NOT
  "illustrate that market forces let con men thrive." It ends the way you'd end it for a friend: a fast
  casual wrap of what happened ("so he skips to France, tries the whole thing again, gets arrested, gets off;
  ends up in Venezuela treated like a hero and dies a decorated general. Poyais never existed, and the people
  who believed in it were the ones who paid for it. Wild."), never a thesis or a takeaway.

### F. STORY ECONOMY — hit each beat and move on; never dwell

- **Criticism:** "it hammers on certain points way too long for no reason" (three paragraphs on what the
  guidebook said); "length isn't necessarily a ceiling. I just don't want it to harp on a point for too long,
  because it's a story"; also the opening repeats the paradox three times.
- **Cause:** the writer treats each beat as a topic to *fully document* (everything the research has on the
  guidebook), and the length-band instruction ("sections sum to target-min × 150") rewards padding.
- **Fix:** the governing rule is **storytelling economy, not a word budget.** A friend telling a story hits
  each beat in a sentence or two, lands the point or the joke, and moves on. The guidebook beat is not three
  paragraphs of contents; it is one move: "so he had a Captain Thomas Strangeways write a gorgeous 350-page
  book about Poyais, its cathedrals, its people, its perfect land. One problem: Strangeways, like Poyais,
  wasn't real." Then move on. Kill repetition (state the hook's paradox once). **Length is a byproduct of
  good economy, not a target:** do not pad to a word count, and do not cut real story to hit one.

### G. METAPHOR WOVEN IN, AND PLACED AT THE REVEAL

- **Criticism:** the "five-star listing" metaphor sits at the end of the guidebook beat as a summary; the
  user wants it *inside* the telling and moved to the *arrival* ("they'd sailed the Atlantic on the promise
  of a five-star resort, and stepped off into swamp").
- **Cause:** §2.9 exists but isn't enforced; the writer places metaphors as beat-closers at the setup.
- **Fix:** strengthen §2.9: the metaphor is the sentence that *tells* the beat, not a bow; and a
  **promise-vs-reality** metaphor lands at the **payoff** (the arrival/collapse), not the setup — the gap is
  the joke, so save it for when the gap is revealed.

---

## The one tension to confirm (E)

The idea's payload promise was "the viewer learns *why* it worked — a hungry market let a confident man
manufacture credit from nothing." Cutting the finance mechanics could look like dropping the payload. It
isn't: **we keep the payload as a story beat** (a fake country's bond traded next to real ones because
everyone was manic and nobody checked) and cut only the *lecture* (denominations, yields, how an exchange
functions). Confirm that's the intent: entertainment-story-first, the "how" delivered as a vivid line, not a
finance lesson. The **term "payload" stays**: it means the concrete, interesting substance the viewer walks
away with (here, the story itself plus the "everyone was manic, nobody checked" insight), delivered as story.
It is NOT a synonym for a moral or a conclusion.

## Validation

After applying: regenerate the Poyais script and check it reads as a casual friend telling an original
story — non-linear, fact-selected (not fact-crammed), no beat-summary buttons, funny, jargon-free, tight,
metaphors woven at the payoff — before moving to metadata/visuals/voice.

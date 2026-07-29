# Story-editor-me — calibration answer key

Daniel's labeled judgments on long-form scripts. Read by the judge (TRAINING section only) and by
`score_agreement.py`. Entry schema + validation: `.claude/skills/proxy-judge/scripts/lint_calibration.py`.

Sources: `gold` (the formerly hand-locked exemplar, re-verdicted 2026-07-28 (reject)), `before-after` (the §5 bank of codified tells),
`git-history` (real transformations Daniel applied from first draft → gold, `da8c888`→`7a91439`),
`transcript-dig` (uncodified judgments mined from sessions), `held-out` (Task-7 blind-rating only).

## TRAINING

```calib
id: CJ-001
source: gold
script_ref: channels/the-second-take/videos/2026-07-04-poyais/script.md
verdict: reject
flagged:
  - quote: (whole script, density and register, not a single line)
    dimension: storytelling-grammar §1.3
    preference: wit and analogy density far too sparse for the current bar
    fix: raise wit/analogy density throughout to match channels/the-second-take/example-scripts.md
notes: Re-verdicted 2026-07-28 by Daniel, by the current bar this script is flat and textbook (boring, boring, boring, terrible, his words); wit and analogy density far too sparse; the voice bar is now channels/the-second-take/example-scripts.md, and this entry teaches what rejection looks like.
```

<!-- §5 before-after bank: the codified tells (storytelling-grammar.md §5) -->

```calib
id: CJ-002
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: undeveloped, unfarmed, barely a soul on them
    dimension: storytelling-grammar §1.1
    preference: literary/essayist phrasing
    fix: plain and short — It was empty jungle. There was nothing there.
notes: Would a person say this out loud to a friend? If not, cut the literary register.
```

```calib
id: CJ-003
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: the mania did the work, not the pitch
    dimension: storytelling-grammar §1.2
    preference: grandeur/summary button ending a beat
    fix: end on the fact or action; land the point inside the telling
notes: Read the last sentence of every paragraph — it must land on a concrete noun/number/action.
```

```calib
id: CJ-004
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: a country that didn't exist
    dimension: storytelling-grammar §1.2
    preference: premise restated over and over (10x)
    fix: say it once, hard, in the hook; then trust the audience
notes: Past ~2-3 recurrences, cut the weakest repeats.
```

```calib
id: CJ-005
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: MacGregor was not some nobody
    dimension: storytelling-grammar §2.1
    preference: outline-then-retell fluff
    fix: cut it; just tell what he was
notes: No throat-clearing that previews the beat instead of being it.
```

```calib
id: CJ-006
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: underwritten by a respectable banking house, in notes of a hundred, paying six percent
    dimension: storytelling-grammar §1.1
    preference: finance jargon a normal person wouldn't say
    fix: he issued government bonds and sold them through a respectable bank, exactly how a real country raises money
notes: Money-story, not a finance tutorial. Say the plain version or cut it.
```

```calib
id: CJ-007
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: not speculators flipping a bond
    dimension: storytelling-grammar §1.4
    preference: educational-concept metaphor the viewer can't instantly picture
    fix: a cultural touchstone the viewer pictures instantly (the dot-com bubble; a five-star resort vs a swamp)
notes: The analogy must map onto something universal and instantly pictured.
```

```calib
id: CJ-008
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: like a tech founder with no product, and like a lottery ticket that already won
    dimension: storytelling-grammar §1.4
    preference: two analogies stacked on one idea
    fix: one, woven in, carrying the explanation
notes: One vivid modern analogy per idea; never double-loaded.
```

```calib
id: CJ-009
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: leave them out on the Atlantic for a moment
    dimension: storytelling-grammar §3.4
    preference: announced/literary transition
    fix: casual signpost (in the meantime, back in London) or a rhetorical-question turn
notes: Spoken connective tissue, never an announced literary seam.
```

```calib
id: CJ-010
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: three full paragraphs recounting every detail of the guidebook
    dimension: storytelling-grammar §2.2
    preference: cramming every sourced fact because it is safe
    fix: select and compress to one vivid beat
notes: research.md is a pool, not a checklist. A great script uses maybe half the ledger.
```

```calib
id: CJ-011
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: the tell never changes; it repeats every generation
    dimension: storytelling-grammar §3.5
    preference: essay/moral close
    fix: end on the story itself, casual and unceremonious, landing an ironic observation (a beautiful country that never existed)
notes: End on the story, never a lesson. Endings are a tone, not a formula (2026-07-28 re-ruling).
```

```calib
id: CJ-012
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: a full paragraph on the cobbler's childhood, his wife, and the children he left behind
    dimension: storytelling-grammar §2.5
    preference: named-victim biography / grief set-piece
    fix: one concrete face in a line, then the aggregate, then move
notes: Human cost lands light and concrete, no grief-milking.
```

```calib
id: CJ-013
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: None of it was there. Not the opera house, not the cathedral, not the bank, not the streets.
    dimension: storytelling-grammar §2.5
    preference: dwell — restating a point already landed for emphasis
    fix: say it once, on the sharpest image, then move
notes: Does the line add a NEW fact/image, or re-emphasize? Cut the second.
```

```calib
id: CJ-014
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: what it could be, something even better, a place already finished
    dimension: storytelling-grammar §1.1
    preference: writerly triple-build of one idea
    fix: one clean line
notes: The rule-of-three writerly build is an AI tell; collapse it.
```

```calib
id: CJ-015
source: before-after
script_ref: storytelling-grammar.md#5
verdict: revise
flagged:
  - quote: the guidebook described the capital in a single flat sentence
    dimension: storytelling-grammar §2.5
    preference: too terse — compressing away the vivid concrete detail
    fix: keep the specific color — the name (St Joseph), the number (20,000), the gold you could wash from the rivers
notes: The opposite failure of dwell. Target the middle — rich in detail, lean on repetition.
```

<!-- git-history: real transformations Daniel applied, first draft (da8c888) -> gold (7a91439) -->

```calib
id: CJ-020
source: git-history
script_ref: 7a91439 vs da8c888 — the hook
verdict: revise
flagged:
  - quote: In the autumn of 1822, a few hundred British families packed up their entire lives and boarded ships bound for the other side of the world.
    dimension: storytelling-grammar §2.1
    preference: the hook drags through chronological setup instead of stating the intrigue and the stakes fast
    fix: open on the intrigue plus the human stakes in ~4 sentences (sold everything, the whole thing was made up, more than half never came home)
notes: Real revision — the meandering opener was replaced with the tight paradox-hook + stakes.
```

```calib
id: CJ-021
source: git-history
script_ref: 7a91439 vs da8c888 — cut meta-frame
verdict: revise
flagged:
  - quote: Now, the comfortable version of this story is what a charming liar, and then we all move on.
    dimension: storytelling-grammar §1.2
    preference: narrator meta-commentary that tells the viewer how to read the story
    fix: cut the interpretive frame; just tell the next beat and let the viewer conclude
notes: The whole "the comfortable version lets everyone off the hook" essayist frame was deleted.
```

```calib
id: CJ-024
source: git-history
script_ref: 7a91439 vs da8c888 — the close
verdict: revise
flagged:
  - quote: In the end, the country was the only thing in the whole story that ever paid a price for not being real.
    dimension: storytelling-grammar §3.5
    preference: a profound essay button at the close
    fix: end on the story's own concrete irony, told plainly (the guidebook still sitting in libraries, anyone can read about the country that never existed)
notes: The clever aphorism close was replaced by the guidebook image. Historical instance; endings are a tone, not a formula (2026-07-28 re-ruling).
```

```calib
id: CJ-025
source: git-history
script_ref: 7a91439 vs da8c888 — length + threads
verdict: revise
flagged:
  - quote: a 1,655-word draft that restates the mania and the paradox across several beats
    dimension: storytelling-grammar §2.2
    preference: over-length via restated/padded beats rather than real story
    fix: compress hard (~1,400 words), then add back a genuine cut thread (the survivors' return, Hastie, the affidavit) instead of filler
notes: The gold is shorter AND richer — cut the dwell, added a real arc.
```

<!-- transcript-dig: uncodified judgments mined from the Poyais iteration sessions (CJ-100+) -->

```calib
id: CJ-100
source: transcript-dig
script_ref: 0201c83b.jsonl:1602 "using that as a pool of facts and then writing an original story"
verdict: revise
flagged:
  - quote: script marches through the research doc's facts in the same order they appear, cramming as many as possible
    dimension: storytelling-grammar §3.1 (macro-architecture)
    preference: The research dossier is a POOL, not a spine. The script must invent its own narrative architecture and must NOT inherit the fact-order of the research doc (two runs producing near-identical plots is the tell).
    fix: Author the story structure independently of the ledger's sequence; pull facts in where the STORY needs them.
notes: The single most-repeated structural complaint across the Poyais loop.
```

```calib
id: CJ-101
source: transcript-dig
script_ref: 0201c83b.jsonl:1658 "not timeline linearity, but the story still makes sense, more casual"
verdict: revise
flagged:
  - quote: strictly chronological, single-location telling
    dimension: storytelling-grammar §3.3 (macro-architecture)
    preference: Deliberately cross-cut across time AND place (settlers mid-Atlantic while MacGregor floats the bond in London; jump to the crash then back). Non-linear reads more casual and engaging than a linear march.
    fix: Draft the STORY first, derive the plot, then break into beats — not beats-first. Allow timeline and location jumps.
notes: He demonstrates the bond-crash / settlers cross-cut himself.
```

```calib
id: CJ-102
source: transcript-dig
script_ref: 3adb231a.jsonl:238 / 0201c83b.jsonl:1630 "three paragraphs about the book, why, that's pointless"
verdict: revise
flagged:
  - quote: three paragraphs detailing exactly what the guidebook said
    dimension: storytelling-grammar §2.2 (proportion)
    preference: Screen time must be PROPORTIONAL to a beat's story importance — a minor side-detail gets a line or two, not paragraphs. The reason is storytelling instinct, not a runtime budget.
    fix: Compress a minor beat to how you'd tell a friend (a fancy book about how great Poyais was, only problem, Poyais wasn't real, move on).
notes: Distinct from cramming — this is disproportionate DWELL-TIME on a low-stakes beat.
```

```calib
id: CJ-103
source: transcript-dig
script_ref: 3adb231a.jsonl:98 "served under Miranda and Bolivar, I don't know who those are, nobody does"
verdict: revise
flagged:
  - quote: names Francisco de Miranda / Simón Bolívar with no gloss
    dimension: storytelling-grammar §1.1
    preference: Any proper noun, title, or term a general viewer won't recognize must get a plain one-line gloss the moment it appears, or be cut. Never assume the audience knows a name.
    fix: e.g. Simón Bolívar, the man who freed half the continent — a plain appositive, or drop it.
notes: Generalized as a rule for any unfamiliar term.
```

```calib
id: CJ-104
source: transcript-dig
script_ref: 3adb231a.jsonl:238 "I don't love the piece one, piece two, piece three"
verdict: revise
flagged:
  - quote: Piece one / Piece two / Piece three section labels; had one distinguishing feature, he didn't exist
    dimension: storytelling-grammar §3.4
    preference: No enumerated or templated section scaffolding, and no formulaic setup-then-reveal framings (X had one distinguishing feature). Sections should flow organically, not be announced by a numbered/label system.
    fix: Replace numbered headers with organic transitions; state the fact plainly (Captain Strangeways, like Poyais, also didn't exist).
notes: He stresses it's not just wording — the enumerated scaffolding itself is the defect.
```

```calib
id: CJ-105
source: transcript-dig
script_ref: 3adb231a.jsonl:316 "hammering on the serious toll too much, way too heavy"
verdict: revise
flagged:
  - quote: extended somber passage on the settler deaths / however gently the numbers are read they land the same place
    dimension: storytelling-grammar §2.5 (register)
    preference: The human-cost beat must stay brief and in the same light, curiosity-driven register, no prolonged solemn swell.
    fix: Deliver the toll compactly; keep the curiosity-first tone; don't sustain a long dark passage.
notes: Different from named-victim biography — this is the dirge-length problem.
```

```calib
id: CJ-106
source: transcript-dig
script_ref: 3adb231a.jsonl:583 "put the metaphor inside the story, not fact fact fact then metaphor"
verdict: revise
flagged:
  - quote: a beat that states the facts, then adds a separate comparison sentence (it was like a five-star hotel with a one-star reality)
    dimension: storytelling-grammar §1.4
    preference: A metaphor/comparison must be woven INTO the narration inline as the sentence that tells what happened — never appended as its own sentence after the facts.
    fix: They signed up for a five-star country with a cathedral and paved roads, and stepped off the boat onto a swamp.
notes: Sharper than §5's woven-analogy row — the anti-pattern is the appended standalone metaphor sentence.
```

```calib
id: CJ-107
source: transcript-dig
script_ref: 6b3ccc54.jsonl:534 "you don't need to say the book mentioned in passing that the rivers ran with gold"
verdict: revise
flagged:
  - quote: the book mentioned almost in passing that the rivers ran with pure gold
    dimension: storytelling-grammar §2.5
    preference: Don't meta-narrate the source document (the book mentions, almost in passing). State the vivid detail directly as part of the world, and select ~3-4 vivid specifics rather than listing ten.
    fix: The rivers ran with pure gold you could scoop out of the sand.
notes: He handed a model paragraph as the target register.
```

```calib
id: CJ-108
source: transcript-dig
script_ref: 3adb231a.jsonl:397 "still a lot of telling telling telling of facts, not storytelling elements"
verdict: revise
flagged:
  - quote: script is fact-telling-dense with low humor/levity frequency
    dimension: storytelling-grammar §1.3
    preference: Raise the density of storytelling texture — the little fun pokey bits, humor, metaphors. The fact-vs-texture balance is tilted too far to straight exposition; add more levity (without overloading bad jokes).
    fix: Increase joke/metaphor frequency toward the reference cadence; keep facts, braid more color through.
notes: Direction is ADD color/humor — the inverse of the usual trim note.
```

```calib
id: CJ-109
source: transcript-dig
script_ref: 3adb231a.jsonl:399 "are we saying Bitcoin's a scam, that's not the path we wanna take"
verdict: revise
flagged:
  - quote: Same con, better graphics. People raise millions on a slick white paper and a token for a product that doesn't exist.
    dimension: storytelling-grammar §3.5
    preference: A modern-parallel closer must be instantly clear AND must not accidentally assert a controversial editorial claim (here, implying crypto is a scam). Confusing or unintended-editorial comparisons are out.
    fix: Cut or replace the crypto-parallel close with a clear, non-editorializing image.
notes: Two faults — unclear (what's a slick white paper) and an unwanted implied claim.
```

```calib
id: CJ-110
source: transcript-dig
script_ref: a3a0bc8b.jsonl:341 "nothing's happening, no information, no curiosity, gunning for an emotional reaction"
verdict: reject
flagged:
  - quote: a short built to trigger an emotional reaction with no information or curiosity hook
    dimension: storytelling-grammar §2.6
    preference: A script must carry information or curiosity as its engine. Chasing a bare emotional reaction with nothing happening and nothing revealed is a hard fail.
    fix: Rebuild around a concrete curiosity/information payload; emotion rides the reveal, it isn't the goal.
notes: Reaction to a shorts draft, stated as a general principle.
```

```calib
id: CJ-111
source: transcript-dig
script_ref: a3a0bc8b.jsonl:341 "reads WAY too cliche, like lines from a bad movie ad script"
verdict: revise
flagged:
  - quote: trailer/ad-style clichéd lines (Hit the window. Hit the window!)
    dimension: storytelling-grammar §1.1
    preference: No movie-trailer or ad-copy cliché lines — stock dramatic filler. Distinct from literary/purple phrasing; this is trailer-voice.
    fix: Cut clichéd dramatic lines; write plain, specific, human narration.
notes: Recurs (entire script still feels very non-human-written).
```

```calib
id: CJ-112
source: transcript-dig
script_ref: 6b3ccc54.jsonl:103 "the hook doesn't have to tell the story, the story can tell the story"
verdict: revise
flagged:
  - quote: a long hook that narrates the whole premise up front
    dimension: storytelling-grammar §2.1
    preference: The hook should be tight — set up the intrigue and pivot into the story (so what happened). It must NOT front-load or tell the whole story; the body carries that.
    fix: Trim the hook to a compact setup plus a pivot line; let the narrative deliver the rest.
notes: Reinforces CJ-020; he rewrote the Poyais hook live as the model shape.
```

```calib
id: CJ-113
source: transcript-dig
script_ref: 0201c83b.jsonl:1012 "I don't want any em dashes in the script"
verdict: revise
flagged:
  - quote: em dashes anywhere in the VO script
    dimension: storytelling-grammar §1.1
    preference: Hard no on em/en dashes in the script (an AI tell the viewer cannot hear). Also caught by the mechanical lint, but it is a real taste absolute.
    fix: Strip all dashes; rephrase into plain sentences carried by periods/commas.
notes: Stated as an absolute, pipeline-wide rule.
```

```calib
id: CJ-114
source: transcript-dig
script_ref: 48865ce8.jsonl:891 "none of the education-first dry narration"
verdict: revise
flagged:
  - quote: overall texture reads as an explainer/educational lecture rather than a story
    dimension: storytelling-grammar §1.1
    preference: The whole-script texture must not read as an educational experience. Story-first, narration-first, colloquial, curiosity/emotion-forward — not fact-after-fact explaining.
    fix: Reshape toward the story-first reference channels (Crayon Capital / HeyHistorically), not education-first dry narration.
notes: A north-star texture judgment repeated across sessions.
```

```calib
id: CJ-115
source: transcript-dig
script_ref: 6b3ccc54.jsonl:517 "the golden one is a little too short, this one gave a little too much color"
verdict: revise
flagged:
  - quote: beats carrying slightly too much descriptive color (vs. the golden reference being slightly too terse)
    dimension: storytelling-grammar §2.5 (color vs. compression)
    preference: There is a middle ground on color — enough vivid detail to engage, not so much that beats bloat. Calibrate to the midpoint between the too-terse golden script and the too-colorful draft.
    fix: Keep the best color, trim where beats over-linger, without falling back on adding more rules.
notes: A dial preference, not binary — the target sits between two named drafts.
```

```calib
id: CJ-116
source: transcript-dig
script_ref: 6b3ccc54.jsonl:151 "don't get bogged down, 12-14 can be 2 beats instead of 3"
verdict: revise
flagged:
  - quote: three consecutive beats spelling out every detail of the settlers' arrival
    dimension: storytelling-grammar §2.2
    preference: Don't get bogged down rendering every scene in full; general-audience engagement beats completeness. Consecutive similar beats should be merged/compressed to keep momentum.
    fix: Collapse over-detailed adjacent beats (3 into 2); keep it moving.
notes: Applies CJ-102's proportion rule to adjacent-beat merging.
```

<!-- session-note: preferences captured from Daniel's HO-2 blind rating (Task 8 tuning). General rules. -->

```calib
id: CJ-200
source: session-note
script_ref: HO-2 rating 2026-07-09 (digestibility)
verdict: revise
flagged:
  - quote: he had no more right to sell it than to sell the moon / been lying for a living for a very long time / could not bring himself to tell a single soul / nobody alive would have the nerve to do / genuinely nervous about the dollar / a completely different level of heat / it had gone up back in 1889
    dimension: storytelling-grammar §1.1
    preference: DIGESTIBILITY BAR (finer than the no-literary rule) — reject mildly clever, indirect, or inflated phrasing that isn't a FULL literary tell but still makes the listener work. Covers stock inflation (a completely different level of heat), filler intensifiers (genuinely, really, actually), writerly clichés (a single soul, nobody alive), overwrought verbs (it had gone up vs it was built), and roundabout comparisons (no more right than to sell the moon). Bar: instantly digestible on first hearing, the plainest way a friend would say it.
    fix: swap the inflated word for the plain one; delete filler intensifiers; unwind the roundabout construction.
notes: The #1 HO-2 gap — the judge scored register 2/2 and PRAISED several of these lines. This bar is stricter than the current grammar.
```

```calib
id: CJ-201
source: session-note
script_ref: HO-2 rating 2026-07-09 (hook)
verdict: revise
flagged:
  - quote: In 1925, a man in Paris sold the Eiffel Tower for scrap metal.
    dimension: storytelling-grammar §2.1
    preference: A hook that is merely correct is not enough — it should be HOOKIER: punchier, and often slightly longer with a beat of vivid, concrete detail that sharpens the intrigue. A flat one-line statement of the premise under-delivers even when it is accurate.
    fix: punch the language and add a vivid detail beat; make the intrigue land harder before pivoting into the story.
notes: Daniel wants the opening optimized for grab, not just accuracy — distinct from the "don't tell the whole story" hook rule (CJ-112).
```

```calib
id: CJ-202
source: session-note
script_ref: HO-2 rating 2026-07-09 (money-in-modern-terms)
verdict: revise
flagged:
  - quote: MISSING — the sum a con/scheme made, and what it is worth today
    dimension: storytelling-grammar §2.2
    preference: QUANTIFY THE MONEY AND MODERNIZE IT. When a story turns on a sum, state the figure AND translate it into today's terms in a casual, concrete way (that much today could buy you X / would be about $Y now) so a general viewer FEELS the scale. Raw period figures alone don't land.
    fix: add a short, casual money-in-today's-terms beat at the point the sum matters.
notes: A payload + accessibility expectation the rubric doesn't currently demand; Daniel raised it unprompted on HO-2.
```

## HELD-OUT (do not train on)

The judge must NEVER read this section. Ground truth = Daniel's verdicts. Judge verdicts live in
`holdout/verdicts/`. Scored by `score_agreement.py`; results in `agreement-report.md`.

```calib
id: HO-1
source: held-out
script_ref: knowledge/proxy-me/story/holdout/HO-1-script.md (= da8c888 first-draft Poyais)
verdict: reject
flagged:
  - quote: In the end, the country was the only thing in the whole story that ever paid a price for not being real.
    dimension: storytelling-grammar §3.5
    preference: essayist aphorism close
    fix: end on the concrete guidebook image
  - quote: Now, the comfortable version of this story is what a charming liar
    dimension: storytelling-grammar §1.2
    preference: narrator meta-commentary frame
    fix: cut it; tell the next beat
  - quote: In the autumn of 1822, a few hundred British families packed up their entire lives
    dimension: storytelling-grammar §2.1
    preference: chronological-drag hook
    fix: intrigue + stakes fast
notes: GROUND TRUTH IS HISTORICAL — Daniel actually rebuilt this draft into the gold (da8c888 -> 7a91439). His verdict = reject/rebuild. This is the answer key, not a fresh rating.
```

```calib
id: HO-2
source: held-out
script_ref: knowledge/proxy-me/story/holdout/HO-2-script.md
verdict: revise
flagged:
  - quote: he had no more right to sell it than to sell the moon
    dimension: storytelling-grammar §1.1
    preference: mildly clever/indirect construction that is harder to digest than it needs to be
    fix: plainer, more immediately digestible phrasing
  - quote: by 1925 he had already been lying for a living for a very long time
    dimension: storytelling-grammar §1.1
    preference: harder to digest than it has to be
    fix: say it plainer
  - quote: It had gone up back in 1889 as a temporary attraction
    dimension: storytelling-grammar §1.1
    preference: overwrought verb where a plain one works
    fix: It was built back in 1889
  - quote: could not bring himself to tell a single soul
    dimension: storytelling-grammar §1.1
    preference: dislikes the mildly writerly cliché (single soul)
    fix: plainer phrasing
  - quote: he did the thing almost nobody alive would have the nerve to do
    dimension: storytelling-grammar §1.1
    preference: overwrought/inflated construction
    fix: plainer
  - quote: running a counterfeiting operation big enough to make the government genuinely nervous about the dollar
    dimension: storytelling-grammar §1.1
    preference: cut filler intensifier (genuinely); plainer stakes
    fix: enough to catch the government's attention
  - quote: And that is a completely different level of heat.
    dimension: storytelling-grammar §1.1
    preference: dislikes the stock/inflated phrasing
    fix: plainer
  - quote: In 1925, a man in Paris sold the Eiffel Tower for scrap metal.
    dimension: storytelling-grammar §2.1
    preference: hook could be hookier, slightly longer and more detailed
    fix: punch it up and add a beat of vivid detail
  - quote: MISSING — the sum Lustig made and a modern-money comparison
    dimension: storytelling-grammar §2.2
    preference: quantify the money the con made AND put it in modern perspective in a casual, concrete way (that much today could buy you X) so the audience feels the scale
    fix: add a casual money-in-today's-terms beat
notes: Daniel's blind rating. Verdict = revise. Concerns cluster on (a) digestibility — plainer, less clever/inflated phrasing throughout, (b) a hookier hook, (c) a MISSING money-in-modern-perspective payload beat.
```

```calib
id: HO-3
source: held-out
script_ref: knowledge/proxy-me/story/holdout/HO-3-script.md
verdict: revise
flagged:
  - quote: two people end up owning a corner of an entire metal
    dimension: storytelling-grammar §1.1
    preference: "corner" is a market term the viewer may not know; unclear/undigestible
    fix: gloss it plainly or cut the jargon
  - quote: answering for the corner they had tried to build
    dimension: storytelling-grammar §1.1
    preference: "corner" again — unclear
    fix: say what they did in plain words
  - quote: This is the part that always gets me.
    dimension: storytelling-grammar §1.2
    preference: narrator self-editorializing (definitely cut)
    fix: just tell the beat
  - quote: But here is the trouble with owning half of something.
    dimension: storytelling-grammar §3.4
    preference: BUT where AND / "as it turns out" fits; label-opener
    fix: And here's the problem / as it turns out, when you own half of something
  - quote: That is the phrase for when your lender calls and says the collateral has cratered
    dimension: storytelling-grammar §1.1
    preference: flatly meta-explaining the term
    fix: which basically means...
  - quote: Which brings us to the part with the fun name.
    dimension: storytelling-grammar §3.4
    preference: weak announced transition (the fun-name idea is fine, the phrasing isn't)
    fix: keep the fun-name beat, better phrasing
  - quote: Wall Street had a genuinely bad few days wondering
    dimension: storytelling-grammar §1.1
    preference: filler intensifier genuinely; plainer
    fix: for a few days there, Wall Street was worried about...
  - quote: The Hunts survived Silver Thursday. But the empire did not really recover.
    dimension: storytelling-grammar §1.1
    preference: use contractions for casual voice (didn't, not did not)
    fix: The Hunts survived Silver Thursday but their empire didn't.
  - quote: two brothers from Texas
    dimension: storytelling-grammar §2.4
    preference: signature phrase overused across the script (repetition)
    fix: vary it; don't repeat the same tag
notes: Daniel's blind rating. Verdict = revise. NEW preferences beyond HO-2 — use contractions; corner as unfamiliar jargon (reinforces gloss); don't flatly meta-explain a term; don't overuse a signature phrase.
```


# Engagement overhaul design

**Date:** 2026-07-22
**Status:** APPROVED — Daniel's ruling is recorded in `knowledge/decisions.md`; Checkpoint 3 is under review
**Branch:** `codex/fyt-engagement-design`, stacked on `codex/fyt-shorts-integration`

## Goal

Make The Second Take feel like a smart, funny person telling an unbelievable true story—not a polished
book report read over stills. The system should create a real relationship with the viewer through a
present narrator, causal storytelling, modern explanatory comparisons, faster cuts, more visual life,
and purposeful audio while keeping the fact leash and consequence restraint.

This document is the review gate before any production skill, schema, token, or video artifact
changes. Poyais remains published and is used only as a zero-spend calibration reference.

## Decisions already supplied by Daniel

- Build the reusable logic first, then run it on **MiniScribe / Bricks**. Use Pearlman second as a
  mixed-tone contrast case. Wells Fargo is out of scope.
- Overhaul the script voice itself. The target is personable, conversational, and fun: the narrator
  reacts to the facts, walks through the scheme plainly, uses recurring current analogies, and may label
  genuine causal steps. Daniel's rough Poyais rewrite is direction, not fact-checked final copy.
- Target **both** a faster, beat-shaped cut pattern and more movement inside shots. Benchmark them by
  reference bucket: animation-heavy work can hold longer because meaningful action changes the frame;
  non-animated work cuts materially faster. Subtle ambient drift does not buy the animation exemption.
- Treat this channel as **mostly stills-based by default**. Meaningful animation is the exception, so
  most passages should inherit the faster stills-bucket cutting pattern.
- Human consequences should be concise and respectful: comedy off, but momentum, music, narration,
  and visual life continue unless a particular beat earns a full stop.
- Review the work at explicit logic, infrastructure, and production checkpoints. No paid generation,
  rendering, or publishing follows merely from approving this design.

## What Poyais actually establishes

| Observation | Reading | Consequence |
| --- | --- | --- |
| 95 final visual stills / 503.7 seconds = **5.30 seconds/still** | The old handoff's 11 seconds/still was arithmetic error. | Increase cuts deliberately by beat, not because of the bad arithmetic. |
| 11.2 cuts/min and 11.3 distinct visuals/min | The aggregate comparison band mixes different visual systems; the result still felt slow. | Match the non-animation bucket's faster cuts whenever meaningful in-shot action is absent. |
| 90.6% dead-frame runtime and 82 frozen stretches of at least 3 seconds | Stillness was the default state, even when the edit cadence was adequate. | Give normal held tableaux subtle life and make true stillness explicit. |
| 32 SFX / 503.7 seconds = 3.81/min | Sparse relative to one reference sample, but compatible with another conservative hypothesis. | Judge semantic beat coverage and unexplained losses, not SFX/min. |
| VO pitch spread was not flat; 10-second energy contour was | The problem is macro-delivery and authored turns, not merely pitch or model choice. | Add sparse delivery direction and audition it before changing channel settings. |
| No retention curve is available | Topic dominance and exact retention prescriptions remain unproven. | Screen angles upstream; do not claim Poyais proves its topic was the main failure. |

## Proposed system

### 1. Angle viability before weighted ranking

Before an idea is scored or researched deeply, the brief must establish:

1. an accountable person or system, a concrete stake, and one dominant open question;
2. a vivid cold-open moment and at least three short, defensible title promises;
3. a specific mechanism, an escalation or reversal, and a plausible relevance bridge; and
4. a differentiated angle against published and backlog work.

A missing element triggers re-angling or rejection. The gate screens for storyability; it does not
predict retention. Research must prove or revise the provisional angle and record failed promises
instead of forcing the script to fulfill them.

`idea-generator` owns four named viability fields in the brief: `accountable_stake_question`,
`cold_open_title_promises`, `mechanism_escalation_relevance`, and `differentiated_against`. The last
field names the compared published or backlog items rather than asserting originality from memory.
`researcher` verifies or revises the first three and records any title or angle promise the evidence
cannot support.

### 2. A narrator who is visibly in the room

The narrator sounds like an informed friend who has just found the most ridiculous true story and cannot
wait to explain how it worked. The energy comes from point of view and causality, not from maximum jokes.

Positive moves:

- Use contractions by default. If the narrator would say `that's`, `he'd`, `wasn't`, or `didn't`, don't
  expand it into formal prose.
- Introduce the person and absurd premise plainly, then permit a brief factual reaction: “Yeah, that's his
  real name,” “which is already a problem,” or “did I mention he made a flag?”
- Use first-person narrator asides and generic audience-facing `you` when they sound natural. Still ban
  casting the viewer as a historical participant, voiced character dialogue, and invented color.
- Let conversational joints stay visible: “So,” “anyway,” “right?”, and a question answered casually may
  connect beats when they do real work. Do not strip them merely because polished prose would.
- Use modern analogies as recurring explanatory tools across distinct beats. The first draft should err
  lively, then the editor removes only comparisons that repeat the same point, derail the story, or make
  the underlying fact harder to understand. Do not impose an analogy cap.
- Permit colloquial language, mild slang, and occasional profanity when it sounds native to the approved
  narrator and sharpens the reaction. Never sprinkle it in as artificial spice, and keep it off human-cost
  beats. Daniel controls that edge through the exemplar and script review.
- Ban credibility-padding sentences such as `That part is real`, `he actually did X`, `he really did X`,
  and `seriously`. State the interesting fact directly. `Real` may still distinguish real money, land, or a
  real name from the fake thing in the story.
- Cut proper names, geography, qualifications, and credentials that don't improve the viewer's mental
  picture or the causal story. Replace them with an accurate familiar scale comparison when that tells the
  story faster. Fact-check the comparison; eight million acres is about Maryland-sized, not Texas-sized.
- Rhetorical questions are judged by function. Flag filler, not causal turns or narrator self-awareness.

The casual story pass is the voice source of truth. The later leash pass makes the smallest local factual
correction possible and must preserve sentence order, conversational joints, repetitions, slang, and comic
rhythm. It may not replace a lively paragraph with a denser documentary explanation merely because that
version sounds more precise. If a claim cannot be fixed locally, flag the beat for the writer instead of
laundering the voice.

The reusable unit is `fact/action -> narrator reaction or explanation -> consequence/next move`. The
reaction cannot introduce a claim absent from the ledger. A hot absurdity stretch with no narrator
presence is a taste finding; joke and analogy counts are not acceptance criteria.

#### Candidate voice calibration excerpt

Daniel's rough passage is the primary calibration source. The version below changes only what the ledger
requires and keeps the loose sentence order, contractions, repeated `so`, direct questions, slang, and
analogy run. It uses 1821 because that's when MacGregor returned to Britain, and Maryland because eight
million acres is nowhere near Texas-sized. It is not a Poyais rewrite order and doesn't replace the
published script:

> So there was this guy, Gregor MacGregor. Yeah, that's his real name. MacGregor was like the Bernie Madoff
> of the 1820s, except Madoff sold securities and MacGregor sold a whole fake country.
>
> So anyway, the year's 1821 and 34-year-old MacGregor had just come back to Britain from fighting in South
> America as a general. This guy was like the Scottish George Washington before he turned to
> the dark side.
>
> While he was out there, MacGregor cut an insane land deal with a local king. All he had to do was fork
> over some rum and jewellery for eight million acres. That's a chunk of land bigger than Maryland for a
> bar tab and a necklace. It's like the Louisiana Purchase on crack. Even Thomas Jefferson is looking a
> little overpriced. Most people would look at that and become a landowner. So he hatches a plot.
>
> **Step 1: Create the Fake Country.**
>
> Step one in selling a fake country: create the fake country. So this guy calls it Poyais, makes himself
> the prince, invents a fake captain named Thomas Strangeways, and puts his name on this gorgeous 355-page
> guidebook. It's like Harry Potter with mortgage paperwork. There's a magical city across the ocean with
> twenty thousand people, an opera house, a cathedral, and rivers running with gold.
>
> But the book is 355 pages long. It's like reading a textbook, you know? You see that many pages and you
> just believe the cover. Wow, that looks so real. Somebody must know what they're talking about. And people
> bought it.
>
> **Step 2: Print Its Money.**
>
> Step two in selling a fake country: print its money. It's not even that MacGregor's the perfect conman.
> People just don't care. It's the dot-com bubble of the 1820s, or it's like the whole NFT scam. Everybody's
> riding the hype train. The hottest new thing sells, and boy is MacGregor's thing hot. I'd move to a country
> with golden rivers too, you know.
>
> So MacGregor gets the Bank of Scotland's official printer to make 5,000 Poyais dollar notes. The Bank of
> Scotland didn't print them. Its official printer did. But normal people don't know the difference, right?
> They see official-looking money from an official-looking printer and assume somebody important checked it.
>
> It's like being a tourist and the guy at the airport says the cab ride is fifty dollars. Maybe that's
> normal. Maybe it's a scam. You don't know, because you just got there. These settlers have the same
> problem, except the guy at the currency desk also invented the country.
>
> So MacGregor gets 250 people to sail for Poyais, and before they leave, he gets them to swap their gold and
> savings for Poyais dollars. Because who'd move to a new country without the local money? See? He is the
> Madoff of the 1820s. Before the ships have even left Britain, he's turned their savings into money he
> made up.

The calibration question is whether the narrator feels alive, present, and excited to explain the scam
while the facts stay followable. Raw and a little messy is preferable to polished and bland. Do not
pre-emptively sand off casual repetitions, direct questions, slang, or multiple comparisons. Edit only
where the energy obscures the mechanism, repeats a joke that already landed, or outruns the ledger.

### 3. Build the scheme in causal, personable chapters

Before prose, each major sequence receives a compact planning card:

`question -> sourced action/mechanism -> narrator angle -> what it enables -> next question`

- Scene two to four sourced turning points or claim-versus-reality pairings. Summarize connective
  tissue; never invent dialogue, motive, or victim detail.
- Make every move cause the next. A viewer should be able to answer, “What did this step buy him, and why
  could the next step happen now?”
- When research supports a genuine multi-lever scheme, allow an opaque chapter card and spoken callback:
  `Step 1: Create the Country`, `Step 2: Print Its Money`, and so on. The script owns the optional spoken
  `Step N` prose. The motion planner owns the matching top-level `cards[]` entry, anchored to an audio-
  director pause immediately before the first post-card line. Cards remain opaque, silent, and static.
  Once a story invokes this device, cover its peer scheme levers sequentially—no orphan `Step 1`, duplicate
  number, or skipped number. This reuses the existing renderer and is not permission to turn every chronology
  into a listicle.
- Give each step a mini-payoff before advancing, then callback to the object or phrase whose meaning has
  changed. Do not merely restate the premise.
- When a story naturally contains withheld proof, use one truthful forward question and close it. This
  often belongs near the middle, but never add a second suspense device merely to hit a position.
- Use one concise sourced consequence beat when earned. Register and restraint create gravity; an
  extended slow passage is neither mandatory nor preferred.

The old rule banning announced parts is superseded for researched scheme-plan stories. Generic chapter
labels, chronology cards, and cards that do not expose a causal mechanism remain failures.

### 4. Sparse delivery direction on the existing voice path

The writer may place an existing v3-compatible marker before a sentence at a real chapter, reveal,
or mood turn: `[emote: curious|knowingly|sternly|sighs|exhales]` or `[aside: dry]`.

- Use markers sparsely at genuine turns; no adjacent markers; punctuation remains the primary rhythm
  tool. Lint marker vocabulary, placement, and adjacency—not a per-chapter count.
- No shouting, laughing, excitement, crying, or volume drama. A consequence beat permits only an
  optional restrained `[emote: sternly]`.
- Keep paragraphs mood-coherent. On v3, dry-run computes and reports the planned request chunks and
  effective settings without making an API call. Prefer a chapter- or mood-turn paragraph when a forced
  seam can land there without creating an undersized chunk; otherwise use the nearest paragraph or
  sentence boundary and flag the seam for the ear gate.
- v2 fallback strips markers. The render engine, motion planner, and audio planner do not infer
  creative decisions from them.
- Any v3 stability change is a one-chapter paid audition and human ear gate, not a global default in
  this implementation checkpoint.

### 5. More cuts

This is a mostly stills-based channel, so cut faster by default. For new long-form plans, start around
2–5 seconds per shot. A hold over roughly 6 seconds needs either a real progressive reveal/animation or a
short legibility/gravity justification recorded in `hold_reason`. Tighten the existing duration-coverage
floor from approximately `runtime / 8` shots to `runtime / 5`; keep real VO-anchor retiming. Lint checks
the floor and the presence of `hold_reason`; the critic judges whether a long hold earned it.

These are starting guidelines, not a quota. The critic checks only three things: slow static holds,
repeated equal hold lengths, and cutting so fast the payload cannot be read. No bucket taxonomy or cadence
profile enters `shots.json`.

### 6. More motion capability

Use the machinery that already exists:

- Give new opted-in videos gentle baseline life through one top-level `baseline_life: true` flag in
  `shots.motion.json`. Store Daniel-approved nonzero values in a separate channel `baseline_life` token
  block; `build_motion` applies those values only when the flag is true. The opted-in baseline covers both
  scene-backed and plate-plus-cutout shots, never placeholders or opaque cards. Absent/false preserves the
  legacy derived motion JSON and frame behavior unchanged.
- Use the existing cutout entrances, paths, reveals, and bobs when a separable object genuinely enters,
  travels, accumulates, or changes on the spoken beat. The critic flags a clearly movement-bearing beat
  that was baked static without a practical or visual reason; it does not demand a layer quota.
- At the motion-plan/build-motion boundary, accept restrained `camera.move: push|pull` on the first shot
  of a stage and map those to the engine's `push-in|pull-back` tokens. Retain the existing `pull` behavior;
  lint move, pan, and intensity, and reject a declaration on a later delta whose stage camera would ignore
  it. Camera movement is punctuation, not a requirement on every shot.
- Keep opaque chapter cards static and preserve normal visual life through concise consequence passages.

No per-shot `living|active|still` schema, semantic-motion accounting, or new motion taxonomy is needed.
Daniel eye-gates the baseline token values and push strength on a local slice before they become the new-
video default.

### 7. Semantic audio coverage instead of an SFX metronome

Candidate beats include a material reveal, concrete number, pivot, visible entrance/draw-on, chapter
turn, punchline, and gravity turn. A fresh-context critic flags only a high-value beat that the proposed
soundscape leaves untreated without a defensible reason. It may accept a bed, visual/VO landing, or
deliberate silence; it does not demand one disposition record for every number or turn.

Coverage may be a transient, element sync, pause, music switch, delivery turn, or deliberate silence.
The four-kind `audio-plan.json` contract remains unchanged, and no permanent coverage ledger becomes
render input. A short serious passage keeps a restrained bed and forward momentum. `dry` remains a rare,
line-specific reveal device, never an automatic human-cost treatment.

After realization, deterministic QA compares authored and resolved cues by kind, music presence,
pause/dry seconds, tails, and anchors. It reports silent drops and unresolved anchors but never adds a
cue. The legacy automatic default bed is excluded from authored-versus-resolved counts.

## Derived QA, never generation targets

Keep the review readout small: script word count and runtime; shot count, average and maximum hold, holds
over 6 seconds, baseline-motion opt-in, authored push/pull moves, and cutout layers; authored, resolved,
and unresolved audio cues by kind. These diagnose the artifact after authorship. No downstream tool adds
jokes, cuts, motion, or sound merely to satisfy a number.

## Validation sequence

### A. Poyais zero-spend calibration

Reuse approved local assets and audio; do not revise or republish Poyais.

1. **Mechanism/absurdity:** L65–L75 (about 4:31–5:23). Compare the current baseline with cuts-only; then
   cuts plus the opted-in gentle baseline life; then cuts plus baseline life plus at most a few restrained
   authored pushes/pulls. Hold VO, audio, approved assets, and existing motivated layers fixed so each
   adjacent comparison adds one axis.
2. **Audio:** on the selected visual treatment, compare the current soundscape with the semantic-coverage
   candidate. Hold the edit and motion fixed.
3. **Consequence guardrail:** L93–L98 (about 6:45–7:15). Confirm that the selected treatment stays
   respectful with comedy off and forward momentum intact; use a static or dry full stop only if Daniel
   prefers it on that line.

Record the selected feel at each comparison. These are local review renders from approved assets, not new
media generation and not upload candidates.

### B. Bricks blind control/candidate

Preserve the old Bricks script as the control. First generate a blind candidate opening through the brick
scheme and audit payoff. For the blind fixture, the fresh writer and critics receive a purpose-built
bundle containing the approved brief, research/ledger, applicable locks, and the approved calibration
excerpt. They receive neither the old Bricks script nor the full Poyais script. Compare:

- fact and title-promise fidelity;
- narrator presence, conversational flow, causal scheme assembly, selective analogies, and callbacks;
- whether optional Step cards clarify actual levers instead of labeling chronology;
- sparse delivery direction and clean v2 fallback; and
- taste, leash, and coherence reviews from fresh contexts.

First present paired scripts and a zero-spend `voiceover.py --dry-run`. As part of Checkpoint 3, dry-run
must compute and emit planned v3/v2 chunk boundaries and effective settings without an API call; only then
does it prove marker parsing, v2 cleanup, and seam placement. After Daniel selects a story direction, apply
the separately approved faster-cut, motion, and audio calibration to this slice. Do not synthesize voice,
generate images, or render the full video until the corresponding human gate.

### C. Pearlman contrast case

After Bricks, use the existing Pearlman brief and research ledger to run the same blind-bundle writer,
fresh-critic, and human comparison protocol on the nonexistent-auditor answering-machine reveal. The test
asks whether the system preserves mixed-tone character comedy without becoming campy or flattening the
consequence beats.

## Checkpoint 3 implementation boundary

Implement in reviewable lane commits so each causal change can be inspected independently:

1. **Selection/story:** idea-generator and researcher contract; long-form-writer skill, critics, and lint;
   channel storytelling grammar, DNA, and watchability rubric. Replace the live “Poyais is the bar for every
   long-form” instructions in both grammar and writer with facet-only reference: Poyais governs fact leash,
   causality, concise consequence, and close; the approved personable exemplar governs narrator presence,
   analogy use, chaptering, and delivery. Permit causal Step cards; narrow the second-person lock to viewer
   role-casting so generic `you` and narrator-I remain allowed; remove analogy-density/auto-zero rules; revise
   question/analogy criticism; default to contractions; add non-blocking exact-phrase advisories for
   credibility-padding forms such as `that part is real` and `seriously`, while leaving contextual
   `actually`/`really` judgments to the taste critic; add a fresh raw-versus-leashed comparison critic that
   flags a changed sentence when a local factual correction was available but the edit also altered unrelated
   rhythm, wording, or narrator presence; lint only malformed/duplicate/skipped/orphan Step sequences; and
   add a blind-fixture reader bundle that substitutes the approved calibration excerpt for every legacy
   full-Poyais-script dependency in the writer and critic fixture path.
2. **Voice:** voiceover skill/contract/script. Add marker whitelist, placement, model-conditional dry-run,
   cleanup, planned-chunk/settings reporting, seam review, and v2 fallback tests. Do not change paid defaults.
3. **Visual cadence:** visual-prompt-writer skill/schema/lint/critic. Tighten the new-video cadence toward
   2–5 seconds, `runtime / 5` coverage, and a `hold_reason` on holds over about 6 seconds.
4. **Motion:** reconcile DNA's stale no-card line with the live opaque-card contract; motion-planner owns
   optional Step `cards[]`, while audio-director owns their co-located pauses. Add plan-level
   `baseline_life: true`, enable a separate block of human-chosen bob/breathe tokens only for opted-in
   videos and on both scene-backed and layered shots, update the critic so supported entrance/travel/reveal
   beats use the existing layer machinery unless there is a stated reason not to, and wire stage-start
   `camera.move: push|pull` through build-motion. Test legacy derived output unchanged; cards opaque/static
   and hard-failing when a normal card lacks its co-located pause; opted-in motion on both scene and layered
   shots; later-stage camera declarations rejected; and both camera directions.
5. **Audio/QA:** audio-director rules/critics, audio-plan documentation/lint, build/checker authored-versus-
   resolved QA join, and focused fixtures. Replace—not supplement—the stale `dry`-on-every-human-cost rule
   in the audio-director skill and critic; the live grammar's music-through-consequence rule is canonical.
   Preserve cue kinds and realization mechanics; do not add a coverage-ledger schema.

Each lane runs its focused suites plus existing smoke/compatibility tests. The complete diff returns for
human review before calibration. No queue-bridge work belongs in this branch.

## Human gates

1. Approve or revise this design and its owner surfaces.
2. Review Checkpoint 3's complete production diff.
3. Select the Poyais cut cadence, motion feel, and audio treatment from zero-spend calibration.
4. Select the Bricks control/candidate direction from scripts and dry-run artifacts.
5. Separately approve one paid voice chapter, any image generation, a full render, and publication.

## Explicitly rejected

- extra images with no beat-level purpose, or claiming that subtle drift/bob substitutes for faster cuts;
- a 12-axis weighted score as a substitute for the viability gate;
- mandatory SFX/min, motion coverage, joke, pause, tag, or pattern-interrupt quotas;
- aggressive or unreviewed camera movement, mandatory layers, or changing legacy renders without opt-in;
- automatic music-off, dry, prolonged slowness, or dead-static visuals for human consequences;
- treating Poyais as proof that its topic or script was the dominant failure;
- adding more prose rules without a gold facet, mechanical checks, fresh-eyes critics, and blind validation;
- mixing the dashboard queue-bridge boot wiring into the FYT creative-logic branch.

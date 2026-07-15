# Watchability Rubric — The Second Take

The scoring instrument for "is this script actually fun to watch, not a monotone fact-dump?"
Built 2026-07-04 from a measured deep-dive on 5 reference channels (full transcripts + audio
loudness/silence analysis via `claude-video-vision` + yt-dlp). Use it two ways: (1) as the target
when writing/hardening `long-form-writer` + `shorts-writer`, and (2) to **score every generated
script** — 0/1/2 per dimension, flag anything scoring <1, and diagnose whether the miss is an
instruction gap, a not-followed rule, or missing doctrine.

> Companion to `reference-channels.md` (the channel board), `storytelling-grammar.md` (the channel's
> single source of truth for how a video is told), and `universal.md` (the niche-agnostic craft
> doctrine). Where a dimension is already in `universal.md`, that's tagged **[covered]**;
> new/underspecified ones are **[gap]**. The § anchors below point into `storytelling-grammar.md`.

## The measured baseline (what the reference channels actually do)

| Channel | Role for us | wpm | Loudness range | Jokes/min | Fact-riding | Cold open |
| --- | --- | --- | --- | --- | --- | --- |
| Crayon Capital | closest model (watchability) | 145 | 3.7 LU (flat) | ~1 | ~85% | stat-barrage → paradox → dated title card |
| Patrick Boyle | YMYL credibility + humor | 145 | flat (by design) | 0.4–0.7 | ~100% | counterintuitive thesis-joke |
| HeyHistorically | the 20–30% playful lift | 144 | 3.1 LU (flat) | higher (history) | high | in-media-res comedic sketch |
| Casually Explained | deadpan register | 233 | 1.8 LU (flat) | ~4–5 | ~60–70% | 2-line cold sketch, no intro |
| Half as Interesting | snap-back aside | 200 | 2.7–3.5 LU (flat) | ~2.5 | ~90% | perform-the-thing, then turn |

**Three convergent, load-bearing findings:**
1. **Loudness is flat everywhere (1.8–3.7 LU).** Nobody manufactures "energy" with volume swings.
   So *not-monotone is a WRITING + PITCH property, never a loudness one.* For our TTS: pick a voice
   with genuine pitch life, don't expect (or fake) volume dynamics, and put the variance in the words.
2. **Near-zero silence; pauses are rare and structural** (HeyHistorically = 5 pauses in 17:47; Casually
   Explained = 1 in 10:14). Wall-to-wall, punctuation carries the rhythm; a bare `[PAUSE]` is spent
   only on a genuine reveal.
3. **~145 wpm is the "explainer" pace** (Crayon, Boyle, HeyHistorically all ~144–145). The 200–233 wpm
   channels are pure-comedy stock-footage formats we are NOT. Confirms the project's 150-wpm constant.

## The rubric (score each 0 / 1 / 2)

**1. Payload density** — a concrete number, name, date, or mechanism in nearly every line. *[covered §1-P]*
2 = almost every line carries a fact · 1 = drifts into vague stretches · 0 = vibes/portent, no payload.

**2. Register & colloquialism — casual, NOT literary** — plain, spoken, contractions, casual "telling-a-friend" register, **zero narrator self-editorializing** (no "the maddening thing," "here's the annoying bit" — see §2.5), zero lecture-voice. **Casual-not-literary (§2.2):** no clever-convoluted backflip sentences, no writerly aphorisms / profound summary-lines, no cliché stock transitions ("which brings us to," "the strangest turn of the whole story"); a casual deadpan button ("He was fine.") is fine, a literary flourish is not. Third-person only (no second-person "you"-casting — that's dim 11). *[gap — no explicit checklist]*
2 = reads like a sharp friend talking, casual all through · 1 = mostly plain but some textbook phrasing, a mood-tag, or a literary/aphoristic line slips in · 0 = essay/lecture register or writerly-clever throughout.

**3. Sentence-length variance (anti-metronome)** — collide long builds with short lines so the rhythm never flatlines. *[covered §1d-V B]*
Target: real variance (stdev ≥ ~7 words), a short AND a long sentence in every paragraph, no 3 same-length in a row.
**Short-punch rule (load-bearing):** a standalone ultra-short line is allowed ONLY when it lands **dry wit or a concrete payoff** — a deadpan reveal, an absurd undercut ("It didn't exist." — the joke is the understatement it pays off). A clipped fragment manufacturing **drama or gravitas with no joke** ("Everything changed." / "The rules were gone." / "For good.") is the AI-cringe/trailer-voice tell (§1d-R) — cut it. And **never stack short fragments in a run** — one earned beat after a long build, never three in a row ("A loan. For a government. Of a country that wasn't there." is the run to avoid).
2 = varied rhythm, and every short punch lands wit/payload · 1 = flat, or a portent-y punch slips in · 0 = metronomic, or stacked dramatic fragments.

**4. Fact-riding humor — REGISTER-BY-GRAVITY dial (headline rule)** — the comedic rate is **not a fixed constant; it is a DIAL set by the topic's gravity** (storytelling-grammar §1.4). Money-absurdity / systemic farce runs **hot** (dense wit); human-villainy / ruin runs **wry and sparse**; **human cost → comedy OFF entirely** (§4). Judge whether the dial is *correct for the beat being scored*, not against a target number. Every joke that ships survives the delete-test (loses information if cut, §6); toolbox = anachronistic-analogy-that-teaches, deadpan undercut, ironic re-label, comic false precision, absurd escalation, bathos (§6); butt is the fool/institution, never the mark or the viewer; **evergreen only, never dating memes** (§6). *[covered §1d-V C/D/F + storytelling-grammar §6]*
**Hot means DENSE with modern analogy, spread through the body (§2.1):** in the hot acts a vivid, instantly-pictured modern comparison should land every beat or two and CARRY the telling, not garnish it. A hot-act stretch that explains a mechanism with ZERO modern analogy is the pipeline's #1 recurring miss (flat fact-telling), and analogies run through the whole body, not one at the end.
**Humor bar (auto-0 on a violation, §2.5):** the analogy must map onto a modern thing the viewer *instantly & universally* pictures (PASS "a startup with no product"); **BANNED** = dead/literary metaphors ("the load-bearing wall of the con") and coined repurposings nobody's heard ("a bug in him"); plain words only, **no narrator self-editorializing** ("the maddening thing"); gloss-or-cut every unfamiliar name/term.
2 = the dial is correct for the topic's gravity (hot where it's absurd, wry where it's villainy, silent on human cost), modern analogy is dense through the hot acts, and every joke clears the humor bar · 1 = dial roughly right but a hot stretch runs analogy-thin or too jokey for its gravity, or a couple empty jokes · 0 = comedy at the wrong gravity (jokes *at* the human cost, or a dry near-humorless read of an absurd story), hot mechanism stretches with no modern analogy at all, a dead metaphor/coinage, or forced/cringe/meme jokes.

**5. Playful framing (the HeyHistorically lift)** — anachronism/modern-slang reframing of dry finance, a lightly-present self-aware narrator, institutions voiced as characters, the "I'm not making this up" honesty beat on absurd-but-true facts. *[gap — the 20–30% ingredient; underspecified in doctrine]*
2 = story feels alive & narrated by a person · 1 = occasional spark · 0 = flat recitation.

**6. Dramatized micro-scene / reenactment** — play a story beat (the con landing, the boardroom lie) as a **narrator-reported micro-scene** (reported speech — never a voiced two-hander; see dim 11) instead of narrating it flat; analogy-as-indictment when a technical bit genuinely needs it. *[covered §5b (analogy); reenactment underspecified — gap]*
2 = story beats are dramatized · 1 = one scene · 0 = flat narration throughout.

**7. Cold-open discipline** — no throat-clearing; value in 7s; stat-barrage→paradox OR in-media-res sketch OR counterintuitive thesis. **Lead the first line with the universal human/absurd/visual grab — NEVER a finance/technical term or the mechanism** (opening on "bonds / yield / securitization" reads as a lecture and gates out everyone who isn't already finance-literate; the mechanism is the *payoff* a beat later, once they're hooked). *[covered §5a]*
2 = grabs in <7s with a jargon-free, universal hook · 1 = slow, or opens on the mechanism · 0 = "hey guys"/setup throat-clearing, or a finance term in line one.

**8. Curiosity-gap / paradox lock that PAYS OFF** — the hook promises a payoff the video actually keeps. *[covered §3]*
2 = promise made + kept · 1 = weak promise · 0 = clickbait gap left open, or no hook.

**9. Pacing & pause discipline** — ~145–150 wpm feel, wall-to-wall, `[PAUSE]` reserved for real reveals; punctuation is the breath score. *[covered §1d-V B + 150-wpm constant; now validated]*
2 = tight, punctuation-driven · 1 = a few dead spots · 0 = choppy or pause-spammy.

**10. Digestibility / segmentation** — each idea ~20–30s, one concrete picture per abstract concept, tangents snap back in one clause ("...anyway"). *[covered §2/§5b]*
2 = never bogs down · 1 = one soggy stretch · 0 = dense homework.

**11. Reported-speech / no-quotes compliance (hard narrator locks)** — the two locked constraints (storytelling-grammar §0/§3): (a) **NO second person** — never casts the viewer as "you"; (b) **ONE narrator, NO quotes** — every dramatized beat is the narrator's *reported speech* (what was said/done, characterized with attitude), with **zero quotation in the script** and no voiced character exchanges / distinct character voices. *[locked in dna + storytelling-grammar §0/§3]*
2 = clean third-person, one narrator, zero quotes, all scenes reported-speech · 1 = one slip · 0 = casts the viewer as "you," quotes a source verbatim, or stages voiced character dialogue.

**12. End on the story, no essay conclusion** — the close is the last ironic story beat (the smallest stake / a realization / a dry button / sealed hook-paradox), then hard-cut. **BANNED: the essay conclusion:** "And that's why…", CTA-inspiration, and the paper-conclusion (a list of historical rhymes A→B→C capped by "the tell never changes / the lesson is X / it repeats every generation," the AI-essay tell; §3.5/§4). The vindication insight is woven into the body, never a closing lesson paragraph. Model the close on the exit menu (deflate/bathos/where-are-they-now/loop; §3.5). *[covered §1d-V E + storytelling-grammar §3.5]*
2 = ends on the story's own irony with a dry button · 1 = tidy but a little preachy · 0 = essay conclusion / summary / CTA / moral lecture / "repeats every generation."

<!-- Dimensions 13-15 = the staging / vindication lever (storytelling-grammar §4). -->

**13. Mechanism-assembly** — a how-it-was-engineered payload is *built one nameable lever per beat* with signposts said out loud ("here's the crucial part…"), so the viewer watches the trick assemble — not narrated smoothly in one pass. *[covered §5c #2 + storytelling-grammar §3.6]*
2 = each lever lands on its own beat, the build is felt · 1 = levers present but compressed · 0 = a smooth summary of "how it worked."

**14. Verification staged (vindication lever)** — the proof is *shown before the accusation* (the match resolving, the trace run), corroboration is counted out loud, and the obvious suspect is exonerated where evidence is thin; the payoff lands on the system, not the person. *[covered §5c #3 + storytelling-grammar §4]*
2 = the viewer watches the bar get cleared · 1 = states a verdict with some sourcing shown · 0 = "analysts say X is guilty," no proving.

**15. Character & light human cost** — the villain is a *person* with documented motive (con reads as one obsession, not weather); the human cost is registered *concretely and fast* (they expected paradise, got a swamp, were turned away, the dream broke, most died) as a light story beat comedy-off, NOT a named-victim biography or milked grief-wall (§4). A named victim is optional light texture, never required, never a personal life-story. *[covered §5c #4 + storytelling-grammar §4]*
2 = a rendered villain + human cost landed light and concrete · 1 = one of the two, or the cost dwelt on too long · 0 = org-chart roles + abstract "$Xm lost," OR a dwelt-on named-victim biography / grief-milking.

<!-- Dimension 16 = macro architecture (storytelling-grammar §1 / universal §5d). -->

**16. Narrative architecture + cross-cutting (the linearity fix)** — the video is *architected*, not told start-to-finish (storytelling-grammar §3): a **non-chronological organizing FRAME** that does double duty as a running motif (§3.1); a hook-entry that is NOT the chronology (paradox-hook → rewind, §3.2); a named reversal / chosen arc-shape (§3.1); **real cross-cutting between parallel threads** — board-state / park-and-cut / mirror / irony cross-cut — instead of finishing one thread then starting the next (§3.3); a controlling motif that pays off/inverts (§2.4); a designed emotional contour (§1.4); and a deliberate exit (§3.5). *[covered §5d + storytelling-grammar §3]*
2 = a non-chronological frame AND at least one real cross-cut weaving parallel threads, motif pays off · 1 = a frame but flat single-thread sequencing (no cross-cutting), or cross-cuts but chronological spine · 0 = a flat chronological retelling, one thread finished before the next begins.

<!-- Dimension 17 = the transitions / seam kit (storytelling-grammar §1.9). -->

**17. Transitions (the seam kit)** — leave **zero flat "and then" seams** (storytelling-grammar §1.9): every beat exits on an **open loop / forward-promise button** the viewer must stay to collect; turn-word grammar closes one beat and opens the next; escalation is honest ("it gets worse" is followed by something actually worse). And **deliver the moment, don't announce it** — no section-opener that labels the *category* of the coming beat ("here's the strange part," "the uncomfortable question," "this is where it becomes a production") and no mechanical scaffolding ("Piece one/two/three…"); open on the *content* — the real question it answers or the next action plainly; constructions are direct, not clever-indirect ("he wasn't a con-man" > "he doesn't read like a con-man"). *[covered storytelling-grammar §1.9]*
2 = every seam is a button or content-driven turn, no flat "and then," no label-openers · 1 = mostly clean but a flat seam, a label-opener, or a beat that exits with no forward pull · 0 = flat "and then" seams throughout, section-openers routinely announce the beat, or numbered-listicle scaffolding.

<!-- Dimension 18 = weave-the-metaphor-in (storytelling-grammar §1.2). -->

**18. Metaphor woven, not appended; no summary bows** — a metaphor CARRIES the beat (it's the sentence that tells what happened), never bolted on at the end as a summary; sections don't end on a thesis/wrap-up sentence; any end-of-beat metaphor clears the humor bar (funny + modern-understandable, §6); the same contrast isn't restated beat after beat. *[covered storytelling-grammar §1.2]*
2 = metaphors woven in, beats end on fact/action, no repetition · 1 = a couple of appended summaries or one over-repeated contrast · 0 = routine fact-fact-then-metaphor bows, or the same point made 3–4 times.

**Scoring:** /36 (18 dimensions × 2). A publishable draft clears **≥30** with **no 0s** on dimensions
1, 4, 8 (payload, register-by-gravity humor, honest hook), **no 0s on 11** (the reported-speech /
no-quotes / no-second-person locks — hard constraints), **no 0 on 17 or 18** (transitions / seam kit;
woven-metaphor / no-summary-bows), and — for money-story documentaries — **no 0s on 13, 14, 16**
(mechanism-assembly, the vindication lever, and the architecture + cross-cutting). Log the score + the
specific miss lines when hardening a skill. The craft behind every dimension lives in
`storytelling-grammar.md` (§ anchors above); 11 is a hard narrator lock, not a gap.

## The delivery note (for `voiceover` / voice-ID pick, not a script dimension)

Since loudness is flat industry-wide, the narrator's *liveliness* must come from **pitch and intonation
variety**, not volume. Pick an ElevenLabs voice with natural pitch life (not a flat news read), and if a
line genuinely needs lift, use expressive tags / `stability` tuning — never a loudness swing. The
script's job is to hand that voice varied sentence lengths + the occasional dramatized line to play.

# Engagement craft — N1b research record (2026-07-21 night)

Input to the engagement-overhaul doctrine fold (see docs/handoffs/2026-07-21-engagement-overhaul-handoff.md
for Daniel's binding feedback). Companion record: the N1a quantitative gap measurement (separate file).
Source tier note: retention percentages are vendor-benchmark tier (directionally consistent, not
peer-reviewed); humor findings are academic-tier; eleven_v3 facts are ElevenLabs' own docs (solid).

**2026-07-22 decision overlay:** the figures below are evidence inputs, not automatic doctrine. Daniel
directed the next design to target both faster, beat-shaped cutting and more movement inside shots. The
12-point selection list is folded into a smaller viability gate, SFX figures are diagnostics rather than
quotas, and human consequence remains concise with comedy off but no automatic slow/static/music-off rule.
The practical implementation stays simple: this is mostly stills-based, so cut faster by default, add a
gentle opted-in baseline life, keep motivated layers, and add restrained push/pull capability. Ambient
drift is helpful but is not a substitute for cuts.

**2026-07-22 script-direction overlay:** delivery improvements do not preserve the old prose as the voice
target. Daniel wants a more personable, fun narrator: visible reactions to facts, casual connective tissue,
recurring modern analogies, causal scheme assembly, and Step cards where the mechanism truly has steps.
Poyais remains a facet exemplar for accuracy, causality, consequence, and close only. Its restrained
narrator presence is not a ceiling. The final doctrine must use a leashed, human-approved positive excerpt
and a blind Bricks candidate, not joke/metaphor counts.

## Headline diagnosis

"Flat reading of a book" has a **measured delivery-layer component; script/topic dominance remains
unproven without retention data**: (1) narrator
tone dynamics — one flat TTS setting for 8 min; "monotonous AI narration → ~35% drop within 45s" is
a named failure; (2) motion within stills — dead-still frames; static holds >4s read as dead air;
(3) audio texture — sparse SFX, no ambient bed. Screen the "content is boring" risk through upstream
story selection/angle before a word is written. The Poyais script is near-gold for register, fact leash,
and mechanism, but not universal gold for hook construction or engagement. Test delivery, faster visual
cadence, motion, and a viable new angle together rather than treating any one as the sole fix.

## Corrections to the handoff's axis framing (load-bearing)

- **Axis 1 arithmetic:** poyais = 95 stills / 504s ≈ **5.3s/still (~11/min)**, not 11 seconds/still.
  It is inside the broad comparison range, but Daniel still wants a faster result. The selected design
  pairs **more cuts, especially in hooks/mechanisms/reveals**, with **motion on held stills + varied holds**.
- **Enforcement gap:** universal.md already prescribes "SFX every 20–30s; music change at act
  boundaries" and "~4–9s/visual" — **poyais shipped below its own written doctrine.** Audit why
  (audio-director/VPW execution), don't just write more rules.

## Key findings (condensed; full cites in the N1b agent report)

- **Mid-video re-engagement hypothesis:** vendor benchmarks report a secondary drop around the middle
  of 10min+ videos. Preserve one truthful 40–60% re-hook with payoff; the original timed
  pattern-interrupt and 25/50/75 peak prescriptions are superseded by beat-shaped, critic-reviewed
  cadence and are not quotas.
- **Scene not summary:** scene the turning points (present-tense set pieces, third-person-safe),
  summarize connective tissue; ladder of abstraction opens concrete → rises, never reverse.
- **Stakes renewal:** Problem-Stack (solve → deeper problem) or per-chapter stakes beat; escalation
  never plateaus; concreteness (one name, one number) lands stakes.
- **Chapters = mini-episodes:** own hook/payoff + micro-teaser into the next; one overarching open
  loop + small loops resolving progressively; never open loops you won't close.
- **Humor (academic tier):** topic-derived humor boosts retention and transfers to the dry passages
  after it; sandwiched between substance beats; timing = the pregnant pause, not volume; forced or
  off-topic humor measurably fails; NO valid "joke every N seconds" number exists.
- **Historical pacing hypothesis (SUPERSEDED operationally):** N1b proposed Ken Burns on 80–100% of
  stills and a 4–6-cut burst every 2–3 minutes. The current design uses a simpler starting rule for new
  plans: generally 2–5 seconds per still, justify holds over roughly 6 seconds, opt into gentle baseline
  life, retain motivated layers, and human-gate restrained pushes/pulls.
- **Historical audio hypothesis (SUPERSEDED operationally):** N1b proposed ~2–5 deliberate SFX/min,
  chapter beds, and at least one drop-to-silence. The approved design keeps these as observations to
  measure, never mandates a rate or silence drop, and gates semantic beat coverage plus the human ear.
- **Story selection ("boring" fix):** 12-point scorecard at selection — nameable villain ·
  protagonist dilemma · concrete sum at stake · escalating irreversible consequence · irony density
  · reversal/comeuppance ending · secrecy framing · one dominant open question · you-bridge ·
  era-resonance · 3+ gripping ≤65-char titles writable · one vivid cold-open moment. Can't name a
  villain, a sum, an open question, and a you-bridge → curious-but-boring, re-angle or kill.

## eleven_v3 mechanics (implementation-ready; engine already has v3 plumbing)

1. v3 GA since 2026-02-02; `model_id: eleven_v3`; ~3,000-char/request; pre-render latency fine for us.
2. **Audio tags** color the text immediately after them until the next sentence break: register-safe
   set = [whispers], [sighs], [exhales], [sternly], [flatly]/[deadpan], [curious], [knowingly];
   BANNED for our locks: [shouts], [laughs], [excited], [crying]. Density ~1–3/chapter, turns only.
3. **Stability must DROP for tags to respond:** Creative/Natural ≈ 0.3–0.45. Robust (≥~0.6) ignores
   tags (behaves like v2). similarity_boost 0.7–0.9, style 0.15–0.3 keeps the narrator's timbre.
4. Punctuation/caps are prosody controls (ellipses = pause; ONE capitalized word for emphasis);
   feed long mood-coherent chunks (v3 unstable <250 chars; our 2,000-char cap is good).
5. **No request stitching on v3** (previous/next_text rejected; engine already omits) → prosody
   resets at chunk seams. Place seams AT chapter/mood turns where a reset is wanted.
6. Fallback if v3 misbehaves on the locked voice: stay v2 + per-chunk settings variation (weaker but
   seam-continuous). Decide by A/B on one chapter.
7. Tone variation = PITCH/breath/pacing via tags — loudness stays flat (the measured 1.8–3.7 LU law
   survives; do not implement "variation" as volume drama).

## Contradictions requiring Daniel's explicit gate (not silently absorbed)

1. **Locked-camera / dead-still law (2026-07-10 directive + 07-08 teardown) vs motion-on-stills:**
   resolved by the 2026-07-22 design: new plans explicitly receive subtle ambient life, but the channel
   remains mostly stills-based and cuts at the faster stills-reference pace. Only meaningful semantic
   animation earns a longer hold; token feel remains a human eye gate.
2. **voiceover-contract stability 0.55–0.65 vs v3 tags needing 0.3–0.45:** make the guidance
   model-conditional (v2 numbers stay for v2); ear-gate the lower-stability v3 read against the
   never-campy bar.
3. **universal §deadpan-aside "every 30–60s":** demote the implied frequency to soft guidance; keep
   the placement rules (topic-derived, sandwiched, gravity dial, off on human cost).
4. General retention literature's second-person/hype advice: REJECTED wholesale (locks are assets;
   the dry register's winners prove it).

## Owner-surface rule-set for the N2 fold

researcher/idea-generator: selection scorecard (rule above) as a hard step before brief-writing.
long-form-writer: first-90s in-medias-res; scene-the-turns; present-tense set pieces (2–4/video);
ladder of abstraction; Problem-Stack stakes renewal; mid-video re-hook at 40–60%; delivery-marking
step (tag the 1–2 lines/chapter that whisper/sigh/deadpan).
storytelling-grammar: chapter-as-mini-episode; loop discipline; humor placement rules (no metronome).
visual-prompt-writer/motion: faster cuts by default, varied holds, a plan-level gentle-life opt-in,
existing motivated layers, and restrained push/pull capability through a human-calibrated path (gate #1).
audio-director: semantic beat-coverage ledger with explicit abstention; restrained bed; no rate quota
or mandatory silence drop; plan-versus-realization audit.
voiceover: v3 migration + tag vocabulary + model-conditional settings + seam-at-chapter chunking
(gate #2); flat-loudness law survives.

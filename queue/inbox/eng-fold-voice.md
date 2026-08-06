---
id: eng-fold-voice
project: faceless-youtube
action: draft:engagement-voice-delta
target: orgs/faceless-youtube/docs/deltas
risk-tier: T2
profile: scanner
owner: dashboard-engine
state: blocked
execution-controller: dashboard
---

## Work order

Author a doctrine-delta document at `orgs/faceless-youtube/docs/deltas/2026-07-22-voice-doctrine.md`.
You write exactly ONE new file and change nothing else. The delta proposes exact text changes for a
human integrator to apply on a review branch.

Context: the channel's first released long-form was measured (2026-07-21). Voice axis verdict: the
narration is NOT pitch-monotone (f0 std 4.86 semitones, 5–95 spread 14.8 st — healthy sentence-level
intonation) but has **no macro-dynamic arc: per-10-second loudness variation is 0.85 dB std across the
whole 8 minutes** — every chunk of the read carries identical energy, which is the measured source of
the owner's "flat reading of a book" verdict. The written wit lands on this flat delivery and reads as
text instead of landing ("written, not sold"). The fix is per-passage delivery direction, keeping the
locked narrator and register.

Current engine facts (authoritative, embedded): the channel voices with ElevenLabs; the channel config
(dna.md voiceover block) currently runs `model_id: eleven_v3` for this channel with stability 0.25 /
similarity_boost 0.85 / style 0.4. The engine (voiceover.py) already: detects v3, translates
`[emote: X]` to `[X]` audio tags and `[aside: dry]` to `[deadpan]`, routes pause tiers to audio tags on
v3, and correctly omits previous/next-text params (v3 rejects request stitching, so prosody resets at
chunk seams). Chunk cap ~2,000 chars.

Craft research findings to fold: v3 audio tags color the text immediately after them until the next
sentence break; tags only respond in the lower stability region (~0.3–0.45 — the "Creative/Natural"
band; ~0.6+ behaves like v2 and ignores tags); register-safe tag set for this channel = [whispers],
[sighs], [exhales], [sternly], [flatly]/[deadpan], [curious], [knowingly]; banned for the channel's
locks = [shouts], [laughs], [excited], [crying]; density ~1–3 tags per chapter, placed only on beats
that carry an emotional turn; ellipses give natural pauses and ONE capitalized word gives emphasis;
feed long mood-coherent chunks (short prompts under ~250 chars are unstable); place chunk seams AT
chapter/mood turns where a prosody reset is desirable; the flat-LOUDNESS mastering law survives —
dynamics come from pitch/breath/pacing, never volume swings; fallback if v3 misbehaves on the locked
voice = per-chunk settings variation on the v2 model (weaker, seam-continuous), decided by A/B on one
chapter.

Read for context: `orgs/faceless-youtube/.claude/skills/voiceover/SKILL.md` (primary edit target) and
its `references/voiceover-contract.md` (note: its stability guidance 0.55–0.65 for the dread register
is correct for v2 and wrong for v3 — your delta must make that guidance model-conditional).

Your delta document must contain, in order:
1. The measured problem statement (numbers above).
2. For the voiceover skill: proposed changes as blocks (existing passage quoted for location, full
   replacement text verbatim, rationale). Cover: a new delivery-direction step (the writer/director
   marks the 1–2 turn lines per chapter with the sanctioned tags; the skill applies them), the
   model-conditional settings table (v3 tag-responsive band vs v2 band), the tag vocabulary with the
   banned list, seam-at-chapter chunking, and the ear-gate note (the lower-stability read must stay
   inside the channel's never-campy bar — a human listens before it ships).
3. For the voiceover contract reference: the model-conditional stability change as an exact block.
4. A "what does NOT change" section: one narrator, third person, near-zero exclamations, reported
   speech, flat loudness mastering, comedy off on human cost.

Repo doctrine voice. One new file only. If context is unreadable, note it and finish.

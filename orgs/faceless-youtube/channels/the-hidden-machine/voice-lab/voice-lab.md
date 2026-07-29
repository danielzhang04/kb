# The Hidden Machine — Voice Lab

The working log for picking this channel's one locked narrator voice. **Append rounds; never
delete.** Format copied from `channels/the-second-take/voice-lab/voice-lab.md` (donor for structure
only — voice, dials, and content are independent per channel).

## Target / prior (Daniel, 2026-07-28)
**Warm male, mid-30s or older, English, conversational-documentary lane — competent, wry, unhurried.**
Explicitly **NOT** movie-trailer gravitas, **NOT** hype/energetic-YouTuber. This channel's locked
lever is scale-shock (vertigo → wonder, never dread — see `dna.md` §Doctrine), so the narrator should
sound like someone quietly impressed by what they've found, not someone selling it.

**Hard exclusion:** ElevenLabs voice_id `vSjOBQp24DUB2COr2xI9` ("Miles") is locked to sister channel
The Second Take (`channels/the-second-take/dna.md` §Voiceover config) and is excluded from this
channel's candidate pool entirely.

## Approved test paragraph (verbatim, all rounds use this until dial-tuning rounds diverge)
> You tap your card, grab your coffee, and walk out. Total elapsed time: about a second and a half.
> In that second and a half, your balance took a round trip through six machines, two states, and one
> building with more security than most airports. Nobody clapped. Nothing lit up. The system's
> proudest trick is that you never notice it happened at all.

## Batch plan (on record, Daniel's lean option)
1. **Round 1 (this round):** 5 candidate voices, identity screen only — neutral/default dials, same
   paragraph, one take each. Purpose: pick a timbre/persona, not tune settings.
2. **Round 2 (next, pending Round 1 pick):** 2 finalists (Daniel's top picks from Round 1) × 3 dial
   variants each (e.g. stability sweep) → consistency + settings lock.

## Discovery method
Read-only ElevenLabs account-voice listing (`GET /v1/voices`) via a throwaway script that loads
`ELEVENLABS_API_KEY` from `orgs/faceless-youtube/.env` the same way the `voiceover` skill does
(walk-up discovery; key never printed/logged/persisted). The account's existing 64-voice library
(populated by The Second Take's earlier auditions) was screened for `labels.gender == male` and
`labels.age` in `middle_aged`/`old`, excluding Miles and every `young`/`social_media`-energetic
premade — that pool skews young/hype and is the wrong lane for this prior. The `shared-voices`
discovery endpoint returned HTTP 400 on the attempted category/use-case filter combination (not
pursued further — the account pool already had enough in-lane candidates for Round 1).

## Round 1 — 2026-07-28 · 5 library candidates, identity screen, neutral dials
Files: `voice-lab/auditions/round-1/`. Settings (neutral/default, per Round-1 doctrine above):
`model_id eleven_multilingual_v2, stability 0.5, similarity_boost 0.8 (skill default), style 0.0,
use_speaker_boost true, speed 1.0`. Generated via the `voiceover` skill's engine
(`.claude/skills/voiceover/scripts/voiceover.py`) — dry-run verified first (clean 350-char parse, no
markup leakage), then one real synthesis per candidate against a disposable temp dna.md (the real
`channels/the-hidden-machine/dna.md` was never edited). Same paragraph, single take, no seed control
(Round-1 doctrine per Second Take's Re-audition method: judge default/typical output, not a lucky
roll — seed-locking is a later-round lever if needed).

| File | Voice · voice_id | Library category / labels | Why shortlisted (factual) |
| --- | --- | --- | --- |
| `01-roger.mp3` | Roger — "Laid-Back, Casual, Resonant" · `CwhRBWXzGAHq8TQ4Fs17` | premade; male, middle_aged, american, conversational | Labeled casual + laid-back — directly targets "unhurried," not hype |
| `02-eric.mp3` | Eric — "Smooth, Trustworthy" · `cjVigY5qzO86Huf0OWal` | premade; male, middle_aged, american, conversational | Labeled smooth/trustworthy — targets "competent" without broadcaster gravitas |
| `03-chris.mp3` | Chris — "Charming, Down-to-Earth" · `iP95p4xoKVk53GoZ742B` | premade; male, middle_aged, american, conversational | Labeled down-to-earth — targets "wry" register, conversational use-case |
| `04-george.mp3` | George — "Warm, Captivating Storyteller" · `JBFqnCBsd6RMkjVDRZzb` | premade; male, middle_aged, british, narrative_story | Only narrative_story-tagged candidate in-pool — direct documentary-narration use-case fit; British accent is a variable to judge, not pre-filtered out |
| `05-bill.mp3` | Bill — "Wise, Mature, Balanced" · `pqHfZKP75CvOlQylNhV4` | premade; male, old, american, advertisement | Oldest/most mature timbre in-pool — tests the "or older" end of the prior band |

All five are ElevenLabs **premade** voices — the platform's original default library, the highest-use
narration voices available (not designed/generated voices) — per the "prefer high-use library
narration voices" instruction.

**Estimated credits used:** ~1,750 characters total (5 × 350-char paragraph; ElevenLabs `eleven_multilingual_v2`
bills ~1 credit/character) — a character-count estimate; the skill's engine does not surface a
subscription-usage-delta readout, and the account-usage endpoint was not queried (out of scope for a
read-only discovery pass).

**Round 1 ear gate: pending Daniel.**

---

# The Second Take — Voice Lab

The working log for picking the channel's one locked narrator voice. **Append rounds; never delete.**
This exists because the first ~20 voice tests (in `videos/2026-07-04-poyais/assets/voice-tests/`) were
generated with **no notes**, so all the reasoning was lost when the terminal closed. Don't repeat that.

## Target (from the 2026-07-05 brief)
- **Persona:** young guy, **mid/late 20s**, neutral-to-**mild** accent, **good energy**, natural human
  cadence + emphasis. The enemy is monotone — the earlier v2 tests read flat.
- **Doctrine it must satisfy:** `voiceover-contract.md §40-62` — liveliness = **pitch + sentence-variance**
  (not volume); ~145-150 wpm; punctuation carries cadence; pauses rare + structural.
- **dna.md persona:** "the dry-smart insider who tells it like a story" (70-80 informative / 20-30 playful).

## Model decision: **eleven_v3** (locked for the hunt)
Probed live 2026-07-05 on this account (tier=`creator`, 124.7k char budget):
- ✅ eleven_v3 is enabled (TTS, 74 langs).
- ✅ **v3 + `/with-timestamps` returns alignment** → render-sync (render-builder) survives on v3.
- Tradeoffs accepted (user chose humanness): v3 is less deterministic (stability = Creative/Natural/Robust
  modes ~0/0.5/1.0), **no speaker_boost**, 5k-char limit (engine chunks fine). v3 is driven by **audio tags**
  (`[dryly]`, `[amused]`, `[pause]`) + punctuation (…, CAPS, commas, periods): that's the humanness lever v2
  lacked. (Em dashes are BANNED in scripts, user-set 2026-07-07; the breath comes from ellipses, commas,
  periods, and audio tags, never `—`.)
- The `voiceover.py` engine already routes v3 correctly (`is_v3` flag, line 429). To switch the channel:
  set `model_id: eleven_v3` in dna.md, drop/ignore `use_speaker_boost`, keep stability ~0.5.

---

## Round 1 — 2026-07-05 · 3 library + 2 designed, all v3, same paragraph
Files: `voice-lab/round1/`. Settings: `stability 0.5, similarity_boost 0.85, style 0.4` (Natural mode + some
style for energy). Same marked-up test paragraph for all (see below).

| File | Source | Voice / voice_id | Why shortlisted | Verdict (fill in) |
| --- | --- | --- | --- | --- |
| `lib_weissman.mp3` | Library | Weissman "An Eager Guide" · `IkksQWAjbvt9CKa7hRkh` | american/confident, "lay out facts with bravado, tell a fun story" — persona-perfect | |
| `lib_mateen.mp3` | Library | Mateen "Energetic" · `128uCENiLRUGEFCiIZVr` | american/confident, literally 24yo + energetic — young+energy target | |
| `lib_scottyp.mp3` | Library | Scotty P "Narration" · `AQiKda40cNIVB2gAFVCi` | american, very mild Southern, narration-built, confident | |
| `design_A_0/1/2.mp3` | Voice Design | prompt A (see below) · gen_ids `6unNIlr15Qk8K4wjxARd` / `LpGjihRWoG2tyD0bmmRK` / `o01YTGZ4TXlOmZzbxKhN` | custom "sharp friend telling a wild true story," dry wit, neutral US | |
| `design_B_0/1/2.mp3` | Voice Design | prompt B (see below) · gen_ids `k2il3nYbu06NVmWAih6y` / `HPF50oxeXbls1zSdIwiM` / `wWEv1pNdGeAjB1hhL0rs` | custom "charismatic 26yo, bright/lively, comedic timing," slight rasp | |

**To keep a Voice-Design pick later:** POST `/v1/text-to-voice` with its `generated_voice_id` → get a permanent
`voice_id` to lock in dna.md. (Design previews are ephemeral; the gen_id is what recreates the voice.)

### Design prompts
- **A:** "A young American man in his mid-to-late twenties. Warm, energetic, and quick-witted, like a sharp
  friend telling you a wild true story he can't believe himself. Clear, articulate, conversational, with
  natural upbeat cadence and a dry sense of humor. Neutral American accent, no radio-announcer polish."
- **B:** "A charismatic 26-year-old American guy with a bright, lively voice and great comedic timing.
  Fast-thinking, expressive, relatable, makes finance and history feel exciting. Slight natural rasp,
  casual but crisp, neutral US accent, high energy without shouting."

### Test paragraph (Poyais opening — dry punchline + short-sentence collisions + a reveal)
> [thoughtful] There was one small problem with Poyais. It didn't exist. [dryly] And I don't mean it was
> rougher than the brochure, or a bit smaller than they'd hoped. I mean the place was never there. Where
> Poyais was supposed to be, there was a stretch of empty jungle on the coast of Central America... and
> nothing else. No towns. No farms. No harbour. And yet the man who sold it had given that empty jungle a
> flag, a capital city, a national bank, its own printed currency, and a ruling prince. The prince was him.
> [amused] Here's the detail that still doesn't feel real. That same year, a respectable investor could walk
> onto the floor of the London Stock Exchange and lend money to the government of Poyais, a country that
> existed only on paper, and be treated, by serious people with serious money, as completely real.

### Verdict
**Winner: Design B, take 3 (`design_B_2.mp3`)** — user: "sounds like an actual person reading a script, that's
nuts." Prompt B (charismatic 26yo, bright, comedic timing, slight rasp, neutral US). → iterate in Round 2.

---

## Round 2 — 2026-07-05 · B-3 saved + settings sweep + consistency
Files: `voice-lab/round2/`. **B-3 saved to a permanent voice** via `POST /v1/text-to-voice` (generated_voice_id
→ voice_id). **The saved `voice_id` = `wWEv1pNdGeAjB1hhL0rs`** (same string as the gen_id).

Why this round: the liked clip was a *Voice-Design preview* (design model), not TTS — so we (1) confirm it
survives being saved + driven through real TTS, (2) pick settings, (3) test run-to-run drift (my flagged
caveat that designed voices wander over a 40-video channel — testing it, not assuming).

| File | Setting | Purpose |
| --- | --- | --- |
| `b3_expressive.mp3` | stability 0.3 · style 0.5 | most pitch movement / beat-landing, least repeatable |
| `b3_natural.mp3` | stability 0.5 · style 0.4 | balanced default (my recommendation) |
| `b3_robust.mp3` | stability 0.7 · style 0.25 | steadiest/most reproducible, risk of flat beats |
| `b3_long_take1.mp3` | Natural | 215-word real script section (MacGregor bio), take 1 |
| `b3_long_take2.mp3` | Natural | same section, take 2 — hear if it's the same guy |

Long-section test text = the MacGregor-intro paragraphs from `videos/2026-07-04-poyais/script.md`.

### Verdict
Round 2 FAILED to reproduce the beloved B-3 preview cadence. User: none matched; "expressive" (stab 0.3)
was closest but still short. → root-caused in Round 3.

---

## Round 3 — 2026-07-05 · reproducing the B-3 preview's CONDITIONS
Files: `voice-lab/round3/`. **Root-cause diagnosis of why the preview beat all TTS:**
- A `voice_id` stores **timbre/identity, not the performance.** Every TTS call **re-rolls** cadence/emphasis.
  The magic B-3 clip was one lucky roll of the *design* model.
- **Design API returns NO seed** (verified: response = `previews[{audio_base_64, generated_voice_id, media_type,
  duration_secs, language}], text`). So B-3's exact roll is **unrecoverable by ID**.
- **Seed pins the performance:** on `eleven_v3`, same seed+text+settings → same-length take (not bit-identical,
  but same phrasing/timing); different seed → different length. So a found winner is lockable via `seed`.
- Two things Round 2 got wrong vs the preview: (1) **audio tags** `[dryly]`/`[amused]` not in the preview,
  likely disrupting phrasing; (2) **stability 0.4-0.5** flattens cadence — previews render loose (~Creative 0.0).

**Round 3 fix test:** clean text (NO tags) + **stability 0.0 (Creative)**, sweep seeds 101/202/303/404/505,
plus a Natural(0.5)-no-tags control to isolate stability-vs-tags. `TARGET_original_B3.mp3` = the original
preview, copied in as the A/B benchmark.

**Open ceiling question:** the preview was rendered by the *design* model; production runs the *TTS* model over
arbitrary script text. If no seed reaches the target, the magic is a design-model artifact that won't survive to
production → fall back to (a) Instant Voice Clone from the B-3 clip, or (b) a voice with a higher TTS ceiling.

### Verdict
No seed reached the B-3 target. User: "none had the B3 sound." Duration diagnosis (Round 4 numbers): the
6-sec gap was **a dropped sentence, not cadence** — TARGET 145 words/42.68s = **204 wpm**; new clips 123
words/35.44s = **208 wpm** → same pace. B-3's edge is tonality/emphasis (a specific performance roll), not
pacing. Round 4 (fair full-text rematch) was cut short — didn't matter, conclusion already clear.

---

## Round 5 — 2026-07-05 · the honest production answer + slowed reference
**Core finding (locked): cadence/emphasis/tonality are per-utterance PERFORMANCE, not stored in any voice.**
Every TTS call re-rolls them. B-3's magic was one design-model roll, frozen in `round1/design_B_2.mp3`. It is
**not reproducible** as a reusable voice by any means available to us:
- **Cloning (IVC):** BLOCKED — API key lacks `create_instant_voice_clone` permission (401). And it would only
  copy timbre (which the saved voice already has), not the performance. Ruled out on two counts.
- **Speech-to-Speech:** the ONLY tool that transfers performance — but needs a *performed input audio per line*,
  which breaks the hands-off/faceless model. Viable only if we feed guide tracks.
- **Accept v3 variability (realistic path):** lock the saved B-3 voice (`wWEv1pNdGeAjB1hhL0rs`) + Creative 0.0 +
  a good seed + `speed ~0.7` (→ ~145 wpm natively). Every line is a fresh good-but-not-"the-clip" performance.

**Delivered — slowed B-3 reference** (`voice-lab/reference/`): the exact B-3 clip time-stretched (ffmpeg atempo,
pitch-preserved) to target register — `B3_slowed_145wpm.mp3` (60.0s) and `B3_slowed_138wpm.mp3` (62.8s). This is
a **north-star reference**, not a production voice (post-processed, single frozen clip).

---

## Re-audition — 2026-07-05 · new method, drawing board
User chose to re-audition for a **consistent, most-human, reproducible-at-scale** narrator (stop chasing the
B-3 clip). **New audition doctrine (the real lesson):** judge a voice by its *typical/everyday* output, not a
lucky roll; test consistency explicitly; prefer voices whose *default* delivery is already human; audition at
production settings; **lean library (real-recording-based) over designed** (designed burned us — preview ≠ prod).

Screen: 6 American library candidates, same passage (MacGregor intro, no tags), v3 @ Natural 0.5, seed 303,
speed 1.0. Files: `voice-lab/reaudition/`. Tempo 169–198 wpm here — irrelevant, `speed` sets 145 in prod.

| File | Voice · voice_id | Character |
| --- | --- | --- |
| `cand1_jake.mp3` | Jake · `hxPRa8HUuKYsm1kiWDEi` | young, informative + energetic (explainer) |
| `cand2_adam.mp3` | Adam · `s3TPKV1kjDlVtZbl4Ksh` | young, authentic engaging storyteller |
| `cand3_steven.mp3` | Steven · `wtQQHWfMy9WeIYuth5ga` | young, warm "trusted friend" conversational |
| `cand4_marcus.mp3` | Marcus · `y0s2ExEMuum3muUnA6Zd` | young, bright + upbeat |
| `cand5_drew.mp3` | Drew · `lCfIptVKzlPoj4vLmTLz` | deadpan, sarcasm, vocal fry (dry wit) |
| `cand6_jon.mp3` | Jon "Catalyst" · `dSByRdUbTGloB7TFA1qD` | confident modern storyteller |

Next: user picks top 2–3 → deep consistency round (same voice × multiple seeds + a 2nd passage, at speed ~0.85
for ~145 wpm) → lock one into dna.md.

### Re-audition R2 — 2026-07-05 · lower pitch + pacing insight
User favorites from R1: **Jake + Marcus**. Wants Marcus's brightness/energy but **lower pitch** (Marcus too
high), energy **capped at Marcus**, young. Files: `voice-lab/reaudition2/` (5 new) + anchors in `reaudition/`.
New candidates: Maverick `4U2riIdynwG5mhrIQRWF` (upbeat baritone), Haven Sands `x8xv0H8Ako6Iw3cKXLoC`
(baritone-tenor, sarcastic fry), Deuce `DaueUomjhh8LFuAV8aGj` (warm/raspy conversational), Eric Puhlmann
`3Qc2SrJq4us6etYTOtzn` (deep baritone, lowest), Richie `t0zbs0dMtCBfzjMlSnoF` (upbeat, dry edge).

**PACING DOCTRINE CORRECTION (important, measured):** the 145-150 wpm target was wrong for this persona —
it came from *dry/calm* reference channels. User prefers ~180-190 feel. Decomposition (ffmpeg silencedetect):
perceived pace = **articulation rate + pause density**, NOT gross wpm. B-3 (204 gross / 252 artic / **19%
silence**) feels relentless; Jake (198 gross / 272 artic / **27% silence**) articulates FASTER but feels
comfortable *because it pauses more*. **Target = Jake's profile** (fast articulation + ~25% pause share), which
we get natively at Natural 0.5 / speed 1.0 — do NOT apply speed slowdown. When locked, update dna.md voice
block + `voiceover-contract.md` (drop 145-150 → ~"match articulation+pause profile, gross ~190, ~25% pause").

### Re-audition R3 — 2026-07-05 · young + bright (reset)
R2 rejected: all "too conversational and tired" — chasing lower pitch pulled in mature/audiobook/baritone
voices that killed the brightness. **Correction: bright + energetic + young-20s is the PRIORITY; pitch is a
minor trim, not the goal.** Re-queried YOUNG-only, hard-excluded deep/calm/conversational/audiobook.
Files: `voice-lab/reaudition3/`. Candidates: Arlo `RckSZHfvva0yOVRPzRfv` (20s storyteller, crisp — pace
profile ≈ Jake's), Ai Moun `WTKyEUnBEQlkDLD0tCBZ` (27yo YouTuber edutainment), Tyler `rPMkKgdwgIwqv4fXgR6N`
(US creator to-camera), ASH `2TgCsDinEcLJ95vqmLKm` (lively rhythm), Alex `yl2ZDV1MzN4HbQJbMihG` (upbeat but
0% pause = relentless), Leo Vibrant `VJl6gxInCtKbdbV4UbNr` (high-energy ceiling test).

### Re-audition R4 — 2026-07-05 · ACOUSTIC pitch-screen (descriptions kept lying)
R3 rejected (Arlo tired, Ai Moun/ASH accents, Tyler conversational, Alex no-pause, Leo shouts). Root cause:
voice text-descriptions are unreliable. **Switched to objective acoustic measurement.** Measured F0 (pitch,
numpy autocorrelation) + loudness + pause-share of the JUDGED clips to set a target window:
- Leo (shouts)=195Hz, **Marcus (too high)=182Hz**, **B-3 (LOVED)=155Hz (D#3)**, Maverick/Eric (tired)=~117Hz.
- **Target = ~155 Hz (B-3's pitch)**, below Marcus, above the tired baritones.
Then **downloaded + measured all 145 young-American-male library previews** (`pool_screen.py`), kept those at
150-165 Hz with neutral-accent bias. Generated 6 finalists at **Creative 0.0** (more life; Natural 0.5 was part
of the "tired" feel). Files: `voice-lab/reaudition4/`, all verified F0 140-168 Hz:
Brandon `IMd3WihrJpmKaNSM1WHx` (155), Carter `PsEYifg5ra2YMbPGwhb3` (150), Grant Whitman `wLoW00IP5kfH8oiOBAPp`
(168, news+comedy/dry-wit), James Green `yuS5yvxd9cdXv5KzBa74` (147), Christopher `RolvCZ4e0AkAR2dzyTx0` (140),
Stu G `lJ00RZOOoE490i3hnZDL` (148). Tooling: `feat.py` (F0), `pool_screen.py` (bulk preview screen) in scratchpad.

## ✅ LOCKED — Jake (2026-07-05)
**Winner: `hxPRa8HUuKYsm1kiWDEi` — ElevenLabs library "Jake — Informative and Energetic".** User chose it after
the full audition (it was a Round-1 favorite for pacing all along). Locked into `dna.md`:
`model_id: eleven_v3, stability 0.5, similarity 0.85, style 0.4, speed 1.0`.
**Consistency proof** (`voice-lab/locked-jake/`) — same passage ×2 seeds + a 2nd different passage:
F0 105-109 Hz, gross 195-196 wpm, pause 25-26% across all three → rock-consistent (the "same narrator every
video" guarantee). Note: Jake measures ~108 Hz, *below* the 145-165 spec band — user picked it by EAR (pacing +
sound), which overrides the number. Pitch spec was a screening aid, not the final authority.

## LOCKED TARGET SPEC (2026-07-05, from user's cumulative verdicts)
- **Pitch (F0): 145-165 Hz** (hard gate). B-3=155.
- **Pace:** gross ~175-205 wpm + ~20-30% pause share (Jake 198/27% ✓; James 227 too fast; Alex 0% relentless).
- **Accent:** clean General American (no regional/foreign; Ai Moun/ASH rejected for accent).
- **Age:** 20s, youthful timbre.
- **Energy:** this-batch level → brighter (never calmer); NOT shouting (Leo/Marcus too hot), NOT tired/flat.
- **Timbre:** the deciding axis now — Brandon had right pitch but wrong voice-color. Must audition many timbres.
- **Engine:** eleven_v3; Creative 0.0 for life; speed 1.0; seed-locked once chosen.
- **Screen tooling:** `feat.py` (F0), `pool_screen2.py` (bulk preview screen: F0 gate + spectral-centroid brightness
  + accent filter + exclude-heard list). 48 voices pass the gates.

### Re-audition R5 — 2026-07-05 · brightness-ranked in-spec timbres
Screened all 397 young-am-male previews (excl. 26 heard) → 48 in-spec → generated 6 brightest unheard at
Creative 0.0. Files: `voice-lab/reaudition5/`. **Finding: Creative 0.0 destabilizes pitch** — preview F0 ≠
render F0. In render, only **Drew `q0IMILNRPxOgtBTS4taI` (154Hz, bright 1528)** and **Ethan `Pb8RZcHs3ga4StE7wiPM`
(163Hz, 1502)** held in-band; Finn `vBKc2FfBKJfcZNyEt1n6` (188, too high), Erby `esrHspGYDSfkn5IuPYtJ` (134),
Edward `2BJW5coyhAzSr8STdHbE` (136), Brayden `3XOBzXhnDY98yeWQ3GdM` (128) drifted. Next: user picks a timbre;
stabilize winner (Natural or intermediate stability) back into band, then consistency proof + lock.
**Method note:** for the final lock, screen/verify at the SETTINGS we'll ship — Creative-0.0 pitch wobble means
either (a) accept it, (b) use intermediate stability, or (c) pick voices whose pitch holds at 0.0 (like Drew).

### Decision slate (R6) — 2026-07-05 · liked anchors + new in-spec @ stability 0.3
User wants one consolidated slate to CHOOSE from. **Key fix: stability 0.3 holds pitch** (vs 0.0 drift) while
staying lively — 4/6 new landed in-band. Files: `voice-lab/reaudition6/`.
- **Anchors (reused liked clips):** Jake (109, pacing), Marcus (182, brightness), Brandon (155, timbre-off),
  Drew (154, R5). James regen slowed (speed 0.85) — **note: this voice barely responds to the speed knob** (still
  ~fast); if James wins, slow via time-stretch instead.
- **New in-band:** Aidan `EOVAuWqgSZN2Oel78Psj` (165), Aaron `3DR8c2yd30eztg65o4jV` (158), Miles
  `vSjOBQp24DUB2COr2xI9` (152), Joe `lLM2bI7XZWLA1bTu2pPJ` (145). **Slightly low:** Toni `1SqpcpYtkf66sVj4eNEv`
  (127, "witty best friend" — persona fit), Felix `9IP7wm1J29XaLxnNLxev` (142, high-energy).
- **Tension noted:** 0.0 = max brightness but pitch drifts; 0.3 = pitch stable but ~less bright. Picked 0.3 to
  respect the pitch spec. If user wants more life on the winner, nudge stability down + re-verify F0 stays in band.
Awaiting user's pick → consistency proof (same voice × seeds + 2nd passage) → lock voice_id + settings in dna.md.

### (superseded) Earlier open decision for the human
The B-3 *timbre* is lockable and good; the specific *magic performance* is not reproducible at production scale.
Choose: **(a)** lock B-3 voice + Creative + speed 0.7 and accept fresh performances per line (recommended, ships
now); **(b)** invest in a Speech-to-Speech pipeline (higher ceiling, semi-manual); **(c)** re-audition for a voice
whose *default* TTS performance you like as-is (not chasing one clip). Next concrete step if (a): generate a
production-native full-script section at speed 0.7 to confirm the everyday quality is acceptable.

---

## ✅✅ FINAL LOCK — Miles @ stability 0.25 (2026-07-06, SUPERSEDES Jake)
**Winner: `vSjOBQp24DUB2COr2xI9` — ElevenLabs library "Miles."** Chosen by ear over Jake on the real Poyais
script after two extra A/B rounds (see below). Locked in `dna.md`: `eleven_v3, stability 0.25, similarity 0.85,
style 0.4, speed 1.0`.

**How we got from Jake → Miles (2026-07-06 rounds, on the real 2:30 Poyais slice, `scratchpad/vcompare/`):**
1. **A/B round 1** — same slice in Jake / Joe / Miles at the *channel* settings (stab 0.5) to isolate voice.
   User leaned Miles but it read "flatter" — root-caused to **stability** (audition Miles was 0.3; the A/B was
   0.5). Higher stability flattens v3 prosody.
2. **Pause-length correction (engine change)** — with human/library voices that already breathe at punctuation,
   our injected `[PAUSE]`/`[BEAT]` tags stacked too long. Shortened the tier map in `voiceover.py`
   (`[BEAT]` → natural / no tag on v3, `[PAUSE]` → short pause, `[PAUSE:LONG]` → normal pause) + updated
   `voiceover-contract.md`. This is why pause-share now sits ~18% (was ~26% on Jake).
3. **A/B round 2** — all voices at 0.4 + short pauses. 4. **Final ladder** — Jake vs Miles down 0.4 / 0.3 / 0.25;
   Joe dropped. User picked **Miles @ 0.25** (the loosest/most "creative" rung).

**Consistency proof @ 0.25 (the variance question, MEASURED — `feat.py` F0 + ffmpeg silencedetect):**
| Take | F0 | note | gross wpm | pause% |
| --- | --- | --- | --- | --- |
| Passage 1 · roll 1 | 148.1 Hz | D3 | 175 | 17.6 |
| Passage 1 · roll 2 | 148.1 Hz | D3 | 173 | 18.5 |
| Passage 2 (diff. register) | 144.1 Hz | D3 | 178 | 18.7 |

Two independent rolls → **identical F0**; a different passage held within 4 Hz; pace within 5 wpm, pause within
1%. **Conclusion: at 0.25 the run-to-run variance is human-bounded even without seed-locking** — the user's
intuition (a real-recording library voice won't wander far) was correct. 148 Hz is also *inside* the 145–165
gate. Open lever: pause-share ~18% is on the relentless side of the 20–30% target (a side effect of shortening
pauses); if a full script feels breathless, lengthen the `[PAUSE:LONG]` tier. Seed-locking remains a future
nice-to-have (engine has no seed param yet) but the proof shows it isn't required for F0 stability.

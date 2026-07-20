# audio-director — grammar guidance (the director's working rules)

The measured audio grammar is single-sourced in **`universal.md §13a-iii.8`** (a teardown of 8 reference
videos — audio-only, tools-measured). This doc is the director's *working distillation* of it; when in
doubt, the law is universal.md. Apply these as JUDGMENT, timid-by-default — they are guidance, not
auto-fire rules.

- **Music is PLACED, not wall-to-wall** (~79% presence in the refs, not 100%). Let one bed run; keep it
  present under VO (a light ~2–3 dB duck, held constant — the data does this, not you).
- **Music always fades OUT into a title card — never plays over one, never hard-cuts into one**
  (universal law, Daniel-confirmed 2026-07-17). At every chapter card the active bed fades out (~2.5s,
  `fade_out_s` on the OUTGOING `music` cue — the same tail key the SFX lane uses, extended to music)
  ending right before the card's silence gap; the card runs in **silence**; the next bed enters on the
  first shot AFTER the card. Author it by ending the segment at the card and starting the next `music`
  cue on the post-card anchor. Exceptions: a card sitting in a cold-open / no-bed region needs no fade
  (nothing is playing), and the **END card** is deliberately exempt — the finale bed carries the outro.
- **Music fades are LONG by default (Daniel-confirmed 2026-07-18, R10).** Every bed ENTERS on a ~1.2s
  swell and LEAVES on a ~2.5s fade that STARTS EARLIER — never a hard cut, never an abrupt tail. These
  are the engine defaults (`music_fade_s.in` 1.2 / `music_fade_s.out` 2.5 in audio-tokens.json), applied
  to every segment automatically; a track switch also carries a ~1.2s silence gap
  (`track_switch_gap_s`). Author LONGER still per-cue with `fade_out_s` (e.g. 3.0s on a bed you want to
  dissolve well before a scene change); the global default is the FLOOR, tuned so nothing reads abrupt.
  The card fade (above) uses this same longer 2.5s tail.
- **Don't let one bed run unbroken for 3+ minutes** (Daniel-confirmed 2026-07-17: "too much of the same
  audio gets tiring"). Prefer a track change at a major narrative pivot — a new location, a new act, a
  scheme's next move — even within one register. A single tiled loop droning for minutes reads as stale;
  a fresh bed re-energizes the turn.
- **Silence is a scalpel — but NOT on human cost.** A full pull-back / `dry` span is reserved for the rare
  big reveal; ordinary emphasis is a small dip, not silence. **The human-cost dry pull-back is RETIRED
  (Daniel-confirmed 2026-07-17): music runs THROUGH human-cost sections — the register shift comes from
  the track choice + level, not from cutting the bed to silence.** Withhold *comedic* SFX on the deaths;
  keep the *bed* playing.
- **No-dip-in-pause (the bed flows through authored pauses).** When the channel sets `dip_in_pause:false`
  (audio-tokens.json), an authored `pause` no longer punches the bed to silence — the music keeps playing
  at its present level through the breath. **Full music cuts are then reserved for `dry` spans** (now the
  rare big reveal, NOT human cost) **and track switches** (including the fade into every title card). So a
  `pause` is free to author generously (it holds the frame + gives a
  breath) without fear of chopping the bed. `dry` is now a RARE tool — a lone big reveal, no longer human
  cost (see the retired human-cost pull-back above) — reach for it, not `pause`, only when you truly want the bed gone.
- **Dips land on ~⅓ of punchlines — never all** (on a channel that keeps pause-dips on). Predictability
  kills the gag; place the reveal/number punch and a few choice hits, not every beat.
- **The sentence-gap floor is automatic — author only EXTRA silence.** Baked TTS pause tags
  (`[PAUSE]`/`[BEAT]`) are **RETIRED** for this channel (R8-B). The engine pads every sentence boundary's
  TOTAL gap up to a target (`sentence_gap_target_s` 0.65s, or 0.45s after a chained ≤2-word sentence),
  inserting only the shortfall over the VO's natural spacing (R10 pad-to-target — the R8-B additive +0.5s
  doubled natural pauses and audibly chopped word tails; the splice now valley-cuts and fills with room
  tone, never digital silence) — engine-wide, on every video, nothing to author. So the piece already breathes at
  every sentence; a `pause` cue is for silence BEYOND that standard beat (a held reveal, a long-SFX ring-out,
  an image held before a cut). An authored `pause` at a sentence boundary STACKS on the sentence gap (the
  silences SUM). The sentence gap is VO rhythm, not music — it never dips the bed and never withholds SFX.
- **Breath is selective (above the floor)** — beyond the universal sentence gap, a sustained hit earns
  ~0.55s (range 0.3–0.8) of EXTRA VO silence via a `pause` cue, but only ~20% of events. Most beats ride
  the sentence-gap floor with no added pause.
- **Density** — story/comedic caps around ~20 SFX transients/min; explainer lower. Fewer is safer.
- **Register dial** — the bed mood tracks topic gravity: wry `sneaky` for the con/fraud spine, `casual-bed`
  as the neutral default, `upbeat` only as a deliberate lift; on human cost the bed stays PRESENT — a
  restrained `underscore` track + level carries the gravity (the human-cost dry pull-back is retired).
- **Item-appearance SFX sync to the item** — any sound that *enunciates a specific thing showing up*
  (cha-ching↔cash, a pound↔the FICTION stamp, a whoosh↔a scene cut, a pop↔a small element) is authored with
  **`sync: "element"`** so it lands on the frame the item appears, not a drifted VO word. VO-moment sounds (a
  verbal-pivot scratch, an aside sting) omit `sync` and stay on their word.
- **Hold an image longer before a cut** — put a pure `pause` cue (no `role`) on the NEXT shot's opening
  words: the inserted silence extends the current image, then the next image drops.
- **SFX-tail law — fade a long SFX, or pair it with a same-anchor pause.** A long SFX (`boom`, `crack`,
  `womp`, `collapse`, `applause`, choir `halo_vocal`) now plays its FULL file length over whatever cut
  comes next — the engine plays each SFX for its real measured duration (the old hard 2s truncation, which
  chopped applause mid-ring, was retired R8). Two levers: **`fade_out_s`** ramps the tail to silence in
  place (preferred when the sound should just decay — the applause fix); a same-anchor **`pause`** holds
  the frame so the tail rings out under it (with `dip_in_pause:false` the bed keeps flowing). `in_pause:true`
  lands the SFX INSIDE the silence (before the word); default rings it out ON the word. The realizer WARNs
  (never fails) any SFX overshooting its cut — each WARN = "add a `fade_out_s`, or add/lengthen a
  same-anchor pause." Any existing long SFX (>2s) now rings its full tail where it used to cut at 2s —
  re-check such cues on the render.
- **Pin a variant/track only when the take is a directed choice.** `sfx` cues accept `variant:"<stem>"`
  and `music` cues accept `track:"<stem>"` — an exact file, overriding pool rotation / mood-index pick.
  Use a pin when a SPECIFIC take carries intent the pool can't express (the longer `sparkle-2` whimsy;
  Monkeys vs Fig Leaf within one comedic register); otherwise leave it off and let the deterministic
  rotation choose. A pinned file that isn't on disk is a HARD render error — pin only sourced files.
- **Structural sounds are judgment, not every instance** (seed rules — refine by ear over real videos):
  - **`whoosh` is RARE** — a sparing accent for a **major** section break, on the order of **~0–2 per video**,
    NOT per scene change and **never inside a delta chain**. When unsure, don't. It reads as a recurring motif,
    so all scene whooshes are the **same** sound (see `consistent_sfx`).
  - **`pop`** fires on each **additive small item** entering an accretion (bank → money → cathedral → prince) —
    but **NOT the establishing base frame** of the chain (the first image sets up the set; it isn't additive),
    and **NOT** a character appearing (Bolívar) or a costume change (MacGregor's coat/hat). All pops use the
    same sound (`consistent_sfx`).

The concrete numeric dials (levels, breath lengths, pools, master target) live in `audio-tokens.json`.

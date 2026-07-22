# audio-plan.json — the unified audio plan (audio-director output)

One ordered `cues` array, each cue `{kind, …}`. The single authoring surface for a video's audio
(SFX · pause · music · dry). `build_motion` splits it into the internal shapes (`audio_plan.split_plan`)
and feeds the existing resolvers (`audio_cues.py` / `music_cues.py`) → `build_audio` / `breath`, so
realization is unchanged + deterministic. Absent file → the render falls back to the legacy per-cue files,
else a plain default bed. Lives at `videos/<slug>/audio-plan.json`.

## Cue kinds
- `{ "kind": "sfx",   "anchor": "<verbatim VO words>", "role": "<sfx_pools role>", "gain_db"?: n, "sync"?: "element", "variant"?: "<file stem>", "fade_out_s"?: n }`
- `{ "kind": "pause", "anchor": "<verbatim VO words>", "pause_s": n, "in_pause"?: true }`
- `{ "kind": "music", "from_anchor": "<≥4 verbatim VO words>", "mood": "<music_pools mood>", "level_db"?: n, "track"?: "<bed stem>", "fade_out_s"?: n }`
- `{ "kind": "dry",   "from_anchor": "<verbatim VO words>", "to_anchor"?: "<verbatim VO words>" }`

`sfx`/`pause` are PUNCTUAL (single `anchor`); `music`/`dry` are SPANS (`from_anchor` [+ optional `to_anchor`]).
Anchors are verbatim VO opening words, resolved by the ONE shared matcher (`render.match_shots_to_tokens`:
first ≤4 normalized words, cursor-advancing) — so cues go in **narration order**, and a repeated phrase hits
the NEXT occurrence. An anchor that doesn't resolve is dropped (lint catches it first).

## Fields & mechanism
- **`role`** — a role in `audio-tokens.json sfx_pools`; an SFX lands ON the anchor word. A role with no
  sourced file is dropped (counted in `sfx_missing`). `gain_db` overrides the role's `sfx_gain_db`.
- **`pause_s`** — silence INSERTED before the anchor (the timeline shifts once, the frame holds, and the
  synchronized full-stop dips the bed to near-silence across the gap).
- **`in_pause`** (`pause` only) — flips a co-anchored `sfx`'s timing: the SFX rings out IN the silence and
  the word drops after (the **interrupt** idiom — a record_scratch/buzzer introducing a pivot). Default:
  the SFX lands at the gap END, ON the word (the reveal/landing idiom).
- **`sync: "element"`** (`sfx` only) — an *item-appearance* sound (cash↔cha-ching, the FICTION stamp↔a
  pound, a scene cut↔a whoosh, a small element↔a pop) snaps to the nearest visual event (a shot cut or an
  overlay `at_s`) within ~0.7s, so it lands ON the item, not a drifted VO word. Omit it for a VO-moment
  sound (a verbal-pivot scratch, an aside sting) — that stays on its word.
- **`fade_out_s`** (`sfx`, optional) — ramp the SFX tail to silence over its last `fade_out_s` seconds
  (mirrors the music lane's fade). Use it on a naturally-long SFX (applause, a riser, a sustained
  `halo_vocal`) so it rings out gracefully instead of ending abruptly. Omit it and the SFX plays at
  constant volume for its FULL file length (the engine no longer hard-truncates at 2s — see the SFX-tail
  law). A non-negative number; lint rejects a negative/non-numeric value.
- **`level_db`** (`music`) — per-segment present-level override (else `music_present_db`).
- **`fade_out_s`** (`music`, optional) — per-segment fade-OUT duration override (else the global
  `music_fade_s.out`, ~0.9s). Use it to author a longer, deliberate fade of a bed INTO a title card /
  silence (Q21 "fade music out into every card"). Applies to the segment this cue STARTS; the segment
  end is where the next cue/dry-span/card boundary falls. A non-negative number; lint rejects a
  negative/non-numeric value.
- **`variant`** (`sfx`, optional PIN) — an exact file stem: the cue plays `audio/sfx/<variant>.mp3`,
  overriding pool rotation AND `consistent_sfx`. The file need NOT be in the role's pool (it may be an
  on-disk alternate not in the rotation list). An ABSENT pinned file is a HARD ERROR (a directed choice
  never silently falls back — unlike an un-sourced pooled role, which soft-drops). **Pin only when a
  SPECIFIC take is a directed choice** (the longer `sparkle-2` whimsy, one chosen boom); otherwise leave
  it off and let the deterministic rotation pick.
- **`track`** (`music`, optional PIN) — an exact bed stem: the segment plays `audio/beds/<track>.mp3`,
  overriding the mood-pool index selection. Two same-mood segments pinned to DIFFERENT tracks are
  DISTINCT beds (they do NOT coalesce; a track switch renders between them). Absent pinned file = HARD
  ERROR. **Pin only when a specific bed is a directed choice** (Monkeys vs Fig Leaf inside the same
  comedic register); otherwise the mood pool resolves the file.

**`pause` INSERTS time (shifts the timeline); `dry` CARVES existing silence (no shift). NEVER conflate** —
same word "silence," opposite mechanism, distinct kinds.

## Combining a stop with a punch
The number-reveal punch (*…brief stop… **[SFX] + word***) = TWO cues on the SAME anchor: a `pause` +
an `sfx`. The pause opens the gap; the SFX lands at the gap end, on the word. (Interrupt variant: add
`in_pause: true` to the pause and the SFX fires at the gap START instead.)

## The SFX-tail law (long SFX that would ring past the next cut)
A long SFX (a `boom`, `crack`, `womp`, `collapse`, `applause`, choir `halo_vocal`) plays its FULL file
length — the engine plays each SFX for its real (ffprobe-measured) duration, NOT a fixed window (the old
hard 2s truncation, which chopped applause mid-ring, was retired R8). So a long tail now rings over
whatever comes next unless you shape it. Two levers:
- **`fade_out_s`** — ramp the tail to silence over its last N seconds so it ends gracefully in place (the
  applause fix). Preferred when the sound should simply decay, not land on a later cut.
- **same-anchor `pause`** — when the tail should ring out UNDER a held frame, pair the SFX with a
  same-anchor `pause` sized to let it finish inside its scene: the pause delays the next cut by `pause_s`,
  and (with `dip_in_pause:false`) the music keeps flowing underneath. Use `in_pause:true` to land the SFX
  INSIDE the silence (before the word), or default placement to ring it out ON the word.

The realizer WARNs (never fails) any SFX whose file overshoots the next cut — treat each WARN as "add a
`fade_out_s`, or add/lengthen a same-anchor pause." Because the window now equals the real file length,
any existing long SFX (>2s) rings its full tail where it used to be cut at 2s — re-check such cues on the
render (they are exactly what the WARN flags).

## The universal sentence-gap law (VO rhythm; engine-wide, not authored)
Baked TTS pause tags (`[PAUSE]`/`[BEAT]` in `script.md`) are **RETIRED for this channel** (R8-B). The
piece's rhythm now comes from three stacked layers: (1) the VO's natural prosody, (2) a UNIVERSAL
sentence gap the engine splices after every sentence, and (3) authored `pause` cues on top of those.
The sentence gap is `sentence_gap_s` (default 0.5s) of silence after each sentence-final word, or
`sentence_gap_chained_s` (default 0.3s) when the sentence just ended was `sentence_gap_chained_max_words`
(default 2) words or fewer (a short "So what happened?" chained beat). Dials live in `audio-tokens.json`
(engine code carries the same defaults so every channel inherits); `sentence_gap_enabled:false` turns it
off. It fires EVERYWHERE (it is VO rhythm, not music) — including inside `dry` spans — but it is EXCLUDED
from bed dips and SFX event-withhold (a sentence boundary is not a full-stop). An authored `pause` at the
same boundary STACKS: the two silences SUM (not max), and the merged gap keeps the authored pause's dip.
Nothing to author here — it is automatic; you only add a `pause` cue where you want EXTRA silence beyond
the standard sentence beat.

## Realizer-owned (never authored)
Same-mood music neighbours COALESCE seamlessly; a DIFFERENT-bed switch (a different `mood`, OR the same
mood pinned to a different `track`) renders fade→silence (`track_switch_gap_s`)→fade; a pause gap dips
the bed to the full-stop **UNLESS the channel sets `dip_in_pause:false`** — then the bed flows THROUGH
authored pauses at its present level, and full music cuts stay reserved for `dry` spans + track switches
(the no-dip-in-pause law: a pause is a breath, not a music cut). A `dry` (and a clean cut into a switch)
carves silence. An SFX file that rings past the next cut is WARNed at realize (the tail audit above).
Present level, default mood, `dip_in_pause`, fade + gap lengths, and mood→track all live in
`audio-tokens.json`. The director authors WHERE + WHICH; the realizer owns HOW.

## Derived authored-versus-resolved QA

`build_motion` derives a small `audioSpec.qa` block; the director never authors it. It records:

- source (`unified`, `legacy`, or `default`);
- authored, anchor-resolved, and unresolved counts for `sfx`, `pause`, `music`, and `dry`;
- resolved authored-pause seconds, resolved dry-span seconds, and final music-presence seconds;
- silently dropped SFX/music assets and SFX-tail overshoots.

The automatic default bed contributes to music-presence seconds but is excluded from authored/resolved
cue counts. `audio_checker` carries this block into its measured report and warns on unresolved anchors or
missing assets. The QA is diagnostic: it never adds a cue or turns a reference rate into a target.

## Example
```json
{ "cues": [
  { "kind": "music", "from_anchor": "In eighteen twenty two", "mood": "sneaky" },
  { "kind": "pause", "anchor": "eight million dollars", "pause_s": 0.6 },
  { "kind": "sfx",   "anchor": "eight million dollars", "role": "cash", "sync": "element" },
  { "kind": "dry",   "from_anchor": "But the bank account", "to_anchor": "was completely empty" }
] }
```
→ a wry `sneaky` bed opens; a 0.6s stop (bed dips, other SFX drop) then `cash` lands on "eight" as the
number arrives; the bed pulls fully DRY only across the line-specific empty-account reveal.

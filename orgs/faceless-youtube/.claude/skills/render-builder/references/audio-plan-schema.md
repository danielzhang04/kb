# audio-plan.json — the unified audio plan (audio-director output)

One ordered `cues` array, each cue `{kind, …}`. The single authoring surface for a video's audio
(SFX · pause · music · dry). `build_motion` splits it into the internal shapes (`audio_plan.split_plan`)
and feeds the existing resolvers (`audio_cues.py` / `music_cues.py`) → `build_audio` / `breath`, so
realization is unchanged + deterministic. Absent file → the render falls back to the legacy per-cue files,
else a plain default bed. Lives at `videos/<slug>/audio-plan.json`.

## Cue kinds
- `{ "kind": "sfx",   "anchor": "<verbatim VO words>", "role": "<sfx_pools role>", "gain_db"?: n, "sync"?: "element" }`
- `{ "kind": "pause", "anchor": "<verbatim VO words>", "pause_s": n, "in_pause"?: true }`
- `{ "kind": "music", "from_anchor": "<≥4 verbatim VO words>", "mood": "<music_pools mood>", "level_db"?: n }`
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
- **`level_db`** (`music`) — per-segment present-level override (else `music_present_db`).

**`pause` INSERTS time (shifts the timeline); `dry` CARVES existing silence (no shift). NEVER conflate** —
same word "silence," opposite mechanism, distinct kinds.

## Combining a stop with a punch
The number-reveal punch (*…brief stop… **[SFX] + word***) = TWO cues on the SAME anchor: a `pause` +
an `sfx`. The pause opens the gap; the SFX lands at the gap end, on the word. (Interrupt variant: add
`in_pause: true` to the pause and the SFX fires at the gap START instead.)

## Realizer-owned (never authored)
Same-mood music neighbours COALESCE seamlessly; a DIFFERENT-mood switch renders fade→silence
(`track_switch_gap_s`)→fade; every pause gap gets the full-stop DIP; a `dry` (and a clean cut into a
switch) carves silence. Present level, default mood, fade + gap lengths, and mood→track all live in
`audio-tokens.json`. The director authors WHERE + WHICH; the realizer owns HOW.

## Example
```json
{ "cues": [
  { "kind": "music", "from_anchor": "In eighteen twenty two", "mood": "sneaky" },
  { "kind": "pause", "anchor": "eight million dollars", "pause_s": 0.6 },
  { "kind": "sfx",   "anchor": "eight million dollars", "role": "cash", "sync": "element" },
  { "kind": "dry",   "from_anchor": "never came home",   "to_anchor": "buried far from" }
] }
```
→ a wry `sneaky` bed opens; a 0.6s stop (bed dips, other SFX drop) then `cash` lands on "eight" as the
number arrives; the bed pulls fully DRY across the human-cost span.

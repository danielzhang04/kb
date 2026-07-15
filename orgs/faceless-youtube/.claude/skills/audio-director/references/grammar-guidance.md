# audio-director — grammar guidance (the director's working rules)

The measured audio grammar is single-sourced in **`universal.md §13a-iii.8`** (a teardown of 8 reference
videos — audio-only, tools-measured). This doc is the director's *working distillation* of it; when in
doubt, the law is universal.md. Apply these as JUDGMENT, timid-by-default — they are guidance, not
auto-fire rules.

- **Music is PLACED, not wall-to-wall** (~79% presence in the refs, not 100%). Let one bed run; keep it
  present under VO (a light ~2–3 dB duck, held constant — the data does this, not you).
- **Silence is a scalpel.** A full pull-back / dry span is reserved for human cost + big reveals. Ordinary
  emphasis is a small dip, not silence.
- **Dips land on ~⅓ of punchlines — never all.** Predictability kills the gag; place the reveal/number
  punch and a few choice hits, not every beat.
- **Breath is selective** — a sustained hit earns ~0.55s (range 0.3–0.8) of VO silence, but only ~20% of
  events. Most beats get no pause.
- **Density** — story/comedic caps around ~20 SFX transients/min; explainer lower. Fewer is safer.
- **Register dial** — the bed mood tracks topic gravity: wry `sneaky` for the con/fraud spine, `casual-bed`
  as the neutral default, `upbeat` only as a deliberate lift; music pulls DRY on human cost.
- **Item-appearance SFX sync to the item** — any sound that *enunciates a specific thing showing up*
  (cha-ching↔cash, a pound↔the FICTION stamp, a whoosh↔a scene cut, a pop↔a small element) is authored with
  **`sync: "element"`** so it lands on the frame the item appears, not a drifted VO word. VO-moment sounds (a
  verbal-pivot scratch, an aside sting) omit `sync` and stay on their word.
- **Hold an image longer before a cut** — put a pure `pause` cue (no `role`) on the NEXT shot's opening
  words: the inserted silence extends the current image, then the next image drops.
- **Structural sounds are judgment, not every instance** (seed rules — refine by ear over real videos):
  - **`whoosh` is RARE** — a sparing accent for a **major** section break, on the order of **~0–2 per video**,
    NOT per scene change and **never inside a delta chain**. When unsure, don't. It reads as a recurring motif,
    so all scene whooshes are the **same** sound (see `consistent_sfx`).
  - **`pop`** fires on each **additive small item** entering an accretion (bank → money → cathedral → prince) —
    but **NOT the establishing base frame** of the chain (the first image sets up the set; it isn't additive),
    and **NOT** a character appearing (Bolívar) or a costume change (MacGregor's coat/hat). All pops use the
    same sound (`consistent_sfx`).

The concrete numeric dials (levels, breath lengths, pools, master target) live in `audio-tokens.json`.

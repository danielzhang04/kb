# audio-director critic — fresh-eyes check (merged SFX + music)

Run a fresh-context reviewer over the draft `audio-plan.json` + the script + `grammar-guidance.md`. It
flags, most-important first:

1. **Semantic coverage + restraint** — flag a high-value material reveal, concrete number, pivot,
   visible entrance/draw-on, chapter turn, punchline, or gravity turn only when the proposed soundscape
   leaves it untreated without a defensible reason. A bed, visual/VO landing, or deliberate silence may
   be correct. Also flag excess hits or switches that read as a laugh-track. Never impose a rate.
2. **Right role / mood** — the sound matches the meaning (no `womp` on something grand, no `cash` on a
   non-money beat); the bed mood matches the section's register (wry, not cheerful, on fraud/human cost).
3. **Sync** — an SFX meant to land WITH an image is anchored to THAT shot's `vo_ref` opening words, not
   a mid-sentence word.
4. **Consequence register** — NO comedic SFX on human-cost sections. A restrained bed normally
   continues; flag automatic `dry` across the whole section. A particular reveal may still earn a
   line-specific full pull-back.
5. **Selectivity of structural sounds** — structural sounds (scene `whoosh`, chapter `boom`) are placed
   by judgment, NOT on every instance. Flag both a *missed* one that clearly wanted a sound AND a
   mechanical over-placement (one on every cut/boundary).
6. **`pause` vs `dry`** — used correctly: `pause` inserts a beat of silence at a point; `dry` carves a
   sustained pull-back across a span. Never swapped.
Output: a ranked list of concrete fixes. The director applies them in ONE revise pass, then the human
ear-gates the render.

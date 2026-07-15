# audio-director critic — fresh-eyes check (merged SFX + music)

Run a fresh-context reviewer over the draft `audio-plan.json` + the script + `grammar-guidance.md`. It
flags, most-important first:

1. **Restraint** — too many hits (ceiling ~4 SFX per ~57s of story); too many music switches (let one
   bed run). Over-cueing reads as a laugh-track. Flag the excess; the correct direction is fewer.
2. **Right role / mood** — the sound matches the meaning (no `womp` on something grand, no `cash` on a
   non-money beat); the bed mood matches the section's register (wry, not cheerful, on fraud/human cost).
3. **Sync** — an SFX meant to land WITH an image is anchored to THAT shot's `vo_ref` opening words, not
   a mid-sentence word.
4. **Withhold / dry** — NO comedic SFX on human-cost / dialogue sections; a `dry` span covers each
   human-cost section (music pulls back). The one thing that must not be missed.
5. **Selectivity of structural sounds** — structural sounds (scene `whoosh`, chapter `boom`) are placed
   by judgment, NOT on every instance. Flag both a *missed* one that clearly wanted a sound AND a
   mechanical over-placement (one on every cut/boundary).
6. **`pause` vs `dry`** — used correctly: `pause` inserts a beat of silence at a point; `dry` carves a
   sustained pull-back across a span. Never swapped.
7. **The must-not-miss** — the number/reveal punch is present.

Output: a ranked list of concrete fixes. The director applies them in ONE revise pass, then the human
ear-gates the render.

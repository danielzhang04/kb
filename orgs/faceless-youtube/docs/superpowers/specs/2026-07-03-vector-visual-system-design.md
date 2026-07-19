# Vector-native visual system — design spec (The Second Take)

**Date:** 2026-07-03 · **Status:** approved, building · **Channel:** the-second-take (business-money explainer).

## Why

The channel's locked look is **clean flat-vector 2.5D** (recurring "your money" avatar, personified
institutions, marker-style charts, one red accent — *not* photoreal, *not* literal crayon). The
connected default (JSON2Video **Pattern A**, Flux/GPT inline images) is the wrong tool: it can't hold a
consistent recurring avatar, can't render accurate charts, and produces the banned "uncanny middle." The
channel's visuals are dominated by **illustrated character/object scenes** (~50–60%) with **data-graphics
a supporting minority** (~15–25%) — a *vector / motion-graphics* problem, not an AI-image one.

**Consistency insight:** what keeps the look coherent isn't the asset *source*, it's that every asset is
**true vector on one enforced style system** (palette + line rule + shape grammar + type). Origin then
stops mattering. So: recurring cast = hand-built kit (never regenerated — AI can't reproduce a specific
character); one-off tail = AI *drafted* then vectorized into the same system (only if hand-authored SVG
isn't rich enough). AI is a sketch assistant, never a final-frame source. No photoreal/motion AI ever.

## The four layers

1. **Style System** — `channels/the-second-take/visual-kit/style.md` + `tokens.json`. The constitution:
   palette (2–3 base + red accent, real hex), line rule (stroke weight, corner radius), shape grammar,
   type (marker title + body). Small, load-bearing.
2. **Content Library** — `channels/the-second-take/visual-kit/assets/`. Reusable **true-vector** assets
   (SVG/React), versioned, growing: recurring cast (avatar, bank/fund/market/taxman, generic person);
   object library (paycheck, coin stack, padlock, invoice, house, card…); chart/diagram primitives that
   take **real numbers from `research.md`'s ledger**; motifs (red-circle-on-anomaly, arrows, call-outs).
3. **Composition/Animation Engine** — `render/remotion/` (shared infra). A **Remotion** project (React,
   self-hosted, $0 render) that imports the style system + a channel's library, reads the video's
   `shots.json` + the VO manifest, composes assets + data-driven charts + type with 2.5D parallax /
   reveals / Ken-Burns synced to the voice, and outputs the MP4 + shorts. **Replaces JSON2Video for this
   channel**; JSON2Video stays for any future photoreal niche.
4. **AI drafting feeder** *(optional, add only if needed)* — Recraft (vector-native → SVG, style-lock)
   drafts one-off objects; vectorize + snap to tokens + **promote good ones into the library** so the kit
   compounds. Deferred until the SVG test shows whether hand-authoring is rich enough.

## Pipeline integration

```
research.md + script.md → visual-prompt-writer (vector-native mode) → shots.json
   (composition specs: which library assets + layout + which chart w/ which ledger numbers + 2.5D motion)
        → [voiceover: VO manifest = timing] → render-builder (engine: remotion) → Remotion → final.mp4
```

- **dna Pipeline block** gains `visual_engine: remotion | json2video` (The Second Take = `remotion`).
- **`visual-prompt-writer`** gains a *vector-native mode* (triggered by the flag): references library
  assets + specifies charts-with-real-data instead of photoreal image prompts. Schema extension.
- **`render-builder`** gains an `engine: remotion` branch parallel to the JSON2Video engine.
- New skill `asset-generator` (Layer 4) only if hand-authored SVG isn't rich enough.

## External tools

- **Remotion** — local `npm` install, free, no account.
- **Recraft** — the *only* candidate paid connection, deferred (maybe never). Decided by the SVG test.
- **Marker font** — a free/licensed font file (download, not an API).
- **Never:** photoreal image gen (Nano Banana) or AI motion (Kling) — they produce the look we avoid.

## Build order (phased — validate the look cheaply first)

1. Scaffold `render/remotion/` (the real engine, minimal).
2. Lock first-draft style tokens + ~5 Claude-authored SVG assets (avatar + 3 objects + 1 chart).
3. **Visual process test:** one ~5s animated shot driven by a mini `shots.json` → render MP4 → review.
   Iterate tokens until the look lands. (Test assets = the first real library entries.)
4. Only then: full pipeline integration (dna flag, visual-prompt-writer vector mode + schema,
   render-builder remotion branch). Connect Recraft only if step 3 shows SVG isn't rich enough.

## Out of scope now

The JSON2Video path (untouched, kept for other niches); shorts/thumbnail vector templates (after the
long-form look is proven); the compliance/publish tail.

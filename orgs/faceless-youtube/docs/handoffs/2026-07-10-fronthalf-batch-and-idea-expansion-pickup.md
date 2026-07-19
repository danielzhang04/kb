# PICKUP — front-half batch (4 new videos) + idea-backlog expansion & title pass (2026-07-10)

**Status: PAUSED by Daniel. Everything is on disk; NOTHING is committed.** Supersedes the ST-004/ST-006
scope of `2026-07-09-fronthalf-production-batch-pickup.md` (that batch continued and expanded here).
**Daniel still has to review and iterate on the new scripts — they are all at the USER REVIEW GATE, not approved.**

## TL;DR
This session did two things:
1. **Ran four videos through the front half** (idea → research → long-form → metadata; **shorts skipped**),
   one at a time, full pipeline each: **ST-006 Bricks, ST-008 Nauru, ST-012 Silver, ST-028 John Law.**
   All four sit at the **user review gate** (untracked video folders).
2. **Expanded the idea backlog from 10 → 28** across three `idea-generator` runs plus one hand-added idea,
   broadened it past pure frauds into the channel's full scope, and ran a **title-clickability pass**.

## The 5 scripts now at the USER REVIEW GATE (review + iterate before proceeding)
All in `channels/the-second-take/videos/<slug>/` (each has brief.md + research.md + script.md + metadata.json):
- **ST-004 `2026-07-09-pearlman`** — Backstreet Boys / Lou Pearlman Ponzi. (Carried over from the 2026-07-09 batch, still at gate.)
- **ST-006 `2026-07-10-bricks`** — MiniScribe. ~1,454 words / ~9:42.
- **ST-008 `2026-07-10-nauru`** — Nauru phosphate/bird-droppings. ~1,312 words / ~8:44. Register: tragedy dial.
- **ST-012 `2026-07-10-silver`** — Hunt brothers silver corner. ~1,278 words / ~8:31. Title user-locked.
- **ST-028 `2026-07-10-johnlaw`** — John Law / Mississippi Bubble. ~1,253 words / ~8:21.

Each ran the full staged writers-room: spine → casual draft → leash pass → `lint_script.py` (clean, zero
dashes/quotes) → **3 fresh-eyes critics in parallel (taste ∥ leash ∥ coherence)** → in-voice editor → the
`humanizer` skill. All leash-clean, chapters word-timed, `private`, `shorts: []`. The critic layer earned its
keep every time (real leash + coherence catches logged in `decisions.md`).

## The idea backlog — now 28 ideas (was 10)
`channels/the-second-take/idea-backlog.md` — ranked queue + full briefs. **6 scripted, 22 at `idea`.** New IDs:
- **Batch 2 (ST-011–016):** Barings/Leeson, Hunt silver (→scripted as ST-012), De Beers diamonds, OneCoin,
  Knoedler forgery, LTCM.
- **Batch 3 (ST-017–021):** Wirecard, McDonald's Monopoly, Gerald Ratner, South Sea Bubble, Beanie Babies.
- **Batch 4 (ST-022–027):** broadened PAST fraud — Soros/Bank of England, the maple-syrup-reserve heist,
  negative oil (2020), Ireland's no-banks economy (1970), Blockbuster/Netflix, Weimar hyperinflation.
- **ST-028 (hand-added):** John Law (→ scripted this session).
- Top untouched picks by score: **ST-013 Diamonds (94), ST-017 Wirecard (93), ST-025 Ireland (93).**

## Title-clickability doctrine (established this session — user really liked it)
The 6 characteristics of a title that hits for this channel:
1. the unbelievable-but-true fact stated deadpan · 2. a concrete anchor (number or proper noun), never an
abstraction · 3. a built-in contradiction · 4. a loaded verb (destroyed/ruined/stole/vanished, not made/had)
· 5. a curiosity gap it refuses to close · 6. front-loaded, ~40–55 chars, declarative (no "?").
**A title pass rewrote 6 weak ones** (ST-001, 002, 003, 005, 010, 016 — the "The Man Who [did a thing]" frame
and flat "…was fake" enders were the tells). **OPEN TODO Daniel flagged as the durable move:** bake this
6-point checklist into the `idea-generator` so working titles land here from the start (not patched later).
**Also still open:** ST-017 and ST-014 have a near-identical "$X that didn't exist" shape (proposed rewrites:
ST-017 → "Its Cash Was Fake and Its COO Was a Russian Spy"; ST-014 → "The Crypto Queen Who Vanished With $4
Billion") — NOT yet applied. ST-001 title still open (Daniel said "deal with that later"; strongest option on
the table: "His Counterfeit Cash Was Real. That Was the Crime.").

## Resume here
1. **[USER GATE — OPEN]** Daniel reviews + iterates the 5 scripts above (start wherever). Route any fix to the
   responsible skill/grammar, not just the one file (the standing doctrine). Re-run the affected step.
2. When a script passes, it's ready for the **second half** (visual-prompt-writer → voiceover → image-generation
   → render-builder) — none of that has been started for any of these.
3. Optional follow-ups from this session: apply the ST-017/ST-014 title rewrites; settle the ST-001 title;
   **bake the title checklist into `idea-generator`.**

## Warnings for the next terminal
- **Nothing committed. Other terminals share this tree.** Stage explicit paths only; never `git add -A`; never
  rewrite history. (An unrelated `render.py` −571 change + a CLAUDE.md edit were already in the working tree
  from another session at this session's start — leave them.)
- **Shorts were intentionally skipped** for every video this batch — don't "helpfully" run `shorts-writer`.
- **Scripts are at the gate, NOT approved.** Don't advance any to voiceover/visuals until Daniel signs off.
- Length norm held: all five landed ~8:20–9:42 (in/near the ~10-min center of gravity). Don't pad them.
- The `humanizer` step ran on every script and came back clean each time (they're hand-voiced to the §0 gold);
  that's an expected outcome, not a skipped step.

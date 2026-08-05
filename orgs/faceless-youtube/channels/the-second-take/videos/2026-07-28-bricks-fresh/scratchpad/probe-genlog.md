# Phase-4 style probe — genlog

Worktree `C:/Users/danie/kb-worktrees/boss-bricks-reset`, branch `claude/bricks-doctrine-reset`.
`--kit` pointed at the MAIN checkout `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit`
(forge writes staged PNGs there and finds the API key by walking up from it), per brief. `forge.py`
itself run from the worktree, per brief.

**PART 1 (below, unchanged from the pre-flight stop): every one of the 5 planned requests would
have assembled a self-contradictory style instruction against the then-current main-checkout kit.
Reported; not spent against — $0.**

**PART 2 (§7 below): the coordinator switched the main checkout to `claude/bricks-doctrine-reset`
(worktree detached at the same commit `89c720e`, unchanged). Repeat dry-run confirmed one voice.
Paid calls fired dependency-ordered.** Provider returned sustained HTTP 503 ("high demand") across
most attempts — **1 of 5 items generated (L28, $0.134); the other 4 exhausted their one allowed
re-issue at $0 each and were not generated.** Total actual spend: **$0.134**. See §7 for the full
call ledger and §8 for what remains.

## 0. Pre-flight — quarantine check ($0)

Confirmed clean before touching anything:
- `visual-kit/_staging/` root has **no stray `fig-*` files** and **no `review.json`** — B1 quarantine
  intact (every prior-round STEP-1 sits under `_staging/_archive-pre-reset-2026-08-04/`, `_pre-fix-quarantine/`, etc.)
- Scene PNGs (`L01.png` … `L47.png` and friends) are present from the old run but are not `fig-*`,
  so they cannot be silently reused as a figure seed.

## 1. Whole-file forge dry-run ($0) — confirms the fifth is generation-ready

```
py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py batch \
  --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit \
  --batch <worktree>/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json \
  --out <worktree>/.../scratchpad/probe-slate.json
```

`== batch: 47 scene(s) + 8 STEP-1 figure gen(s), 1 not generated -> probe-slate.json ==` — **zero
refusals**, all 8 `fig-*` show `GENERATE` (none `REUSED`, confirming the quarantine is honored).
Full tail saved in this directory is reproducible; not re-pasted here (see fix-G2-report.md for an
equivalent tail — this run matches it byte-for-byte on the seed-role summary lines).

## 2. Probe item selection (build via `batch`, per brief)

Five items pulled from the live slate (not hand-authored), in dependency order so each generation's
seed actually exists on disk when its turn comes:

| # | id | what it probes | seeds (per the live slate) | size |
|---|----|----|----|----|
| 1 | **L28** | `miniscribe-plant` place plate — plate + `'MINISCRIBE'` owner lettering register + flatness, one frame | `[lettering-marker-italic]` (zero image-continuity seed — it's the place-first frame) | 2K |
| 2 | **fig-miniscribe-rep--action-powerstance--expr-deadpan** | STEP-1 figure card L29 (the fifth's first figure-bearing interior scene) demands | `[miniscribe-rep canonical, expr-deadpan, action-powerstance]` (all channel refs) | 1K |
| 3 | **L29** | figure-bearing interior scene seeding that STEP-1 + the place frame — single named-cast reveal at the plant entrance | `[fig-miniscribe-rep--action-powerstance--expr-deadpan (item 2), L28 (item 1), lettering-marker-italic]` | 2K |
| 4 | **L35** | crowd-bearing scene — plant shipping apron, crew of loaders, `figures.crowd: true` | `[L28 (item 1), crowd-exemplar]` | 2K |
| 5 | **L34** | prop/object insert, no figures — opened computer case + drive unit on a bench | `[]` (zero-seed root, no-place standalone object class) | 2K |

Total at plan prices: 4×2K ($0.134) + 1×1K ($0.039) = **$0.575**, matching the brief's own total —
confirms the tier mix is right regardless of which specific shots were picked.

Item 4 was reselected from the brief's literal read once dependencies were checked: the first
crowd-bearing candidate tried (`L07`, computer-shop counter queue) seeds `_staging/L05.png`
(the `computer-shop` place plate), which this probe does **not** generate — a live call on it would
hard-error on a missing seed file. `L35` seeds `[L28, crowd-exemplar]` only, both of which this
probe's own item 1 produces, so the 5-call slate is self-contained end to end. Logged here per the
spend law's intent (no silent scope change): same shot class (`crowd-multiplication`/`figures.crowd`),
different specific id.

## 3. Per-item dry-run — exact assembled prompts ($0, before any paid call)

```
py -3 orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py gen \
  --kit C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit \
  --batch <worktree>/.../scratchpad/probe-items.json \
  --dry-run
```

`== DRY RUN: 5 prompts assembled, 0 API calls, 0 files written ==`. Full output saved verbatim at
`scratchpad/probe-dryrun-output.txt`. Every item's `sizes/aspect` matched plan (L28/L29/L35/L34 = `environment`,
`16:9`, 2K; the STEP-1 card = `environment`, `2:3`, 1K) and every seed path resolved (no "seed frame
not found" errors) — mechanically, the slate is ready to fire.

## 4. BLOCKING FINDING — main-checkout `style-bible.md` is pre-fix; every assembled prompt is two-voice

The dry-run in §3 is what surfaced this. **L28's assembled prompt** (first paragraph, identical
prefix on all 5 items) reads, verbatim, as assembled by forge against the **MAIN checkout** kit:

```
Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.

HARDENED SCENE STYLE. Enforce the STYLE-ONLY descriptor exactly: flat colour fills — one flat
base colour per surface plus at most ONE hard-edged single-step shadow shape — no feathered or
blended transitions, uniform highlight-free surfaces, and even medium-thick dark warm
brown-black outlines on everything. NO gradient; NO gloss or specular highlight; NO bloom;
NO depth-of-field blur or soft focus; NO subsurface or rim light; NO photorealistic texture.
Commit the authored scene palette; it is never neutral grey alone.
...
```

**This is the exact two-voice contradiction diagnosed as this wave's root cause**, verbatim:
`scratchpad/audit-drift-2026-08-04.md` §9 "Global smooth/glossy style drift" — *"`style-bible.md`
§2b positively requests 'gentle soft cel shading' ... Forge then appends `HARDENED_SCENE_STYLE`
saying no gloss/specular/gradients ... The provider resolves the conflict toward a polished
detailed-middle look."* That audit is the named root-cause source of
`docs/superpowers/specs/2026-08-04-bricks-doctrine-reset-design.md`, whose §1 "Style — one voice,
text-only" commits explicitly to deleting "gentle soft cel shading" from `style-bible.md` §2b/§2c/§5
so only one recipe ever ships. Fix list item (1) of the audit's own "Doctrine / mechanism changes —
9 items, $0 generation" is *literally this exact edit*.

**The fix was made — but only in the worktree, not in the main checkout forge reads from at gen
time.** Diff, `style-bible.md` §2b, worktree (`<`) vs. main checkout (`>`):

```diff
< > MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colour fills — one flat
< > base colour per surface plus at most ONE hard-edged single-step shadow shape, no feathered or
< > blended transitions, uniform highlight-free surfaces — rounded friendly shapes, no realistic
< > detail. No text, no words, no labels.
---
> > Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an even
> > MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, simple flat colours with gentle
> > soft cel shading, rounded friendly shapes, no realistic detail. No text, no words, no labels.
```

The worktree's copy is already the correct, single-voice recipe — it matches `HARDENED_SCENE_STYLE`
word-for-word ("flat colour fills — one flat base colour per surface plus at most ONE hard-edged
single-step shadow shape"). The **main checkout's copy is unmodified from the pre-audit state.**
Same divergence, same root, in `visual-kit/visual-grammar.md`'s documented `global_prompt_suffix`
(main checkout's copy still narrates "flat colours with gentle soft cel shading" as the suffix's
own content, even though the current `shots.json.global_prompt_suffix` — checked, this file — has
already been rewritten to just `"hand-lettered marker capitals for any in-world text"`, i.e. the
`shots.json`/VPW side of the fix DID land; the `visual-kit/` doctrine text on the main-checkout side
did not). `registry.json` and `visual-grammar.md`'s other sections diff clean; this is scoped to the
style-recipe text.

**Why this blocks spending, not just a "note it and proceed":** the entire point of this probe is
Daniel ruling flat-vs-not-flat on 5 frames. Every one of the 5 planned requests would currently
carry BOTH "gentle soft cel shading" (soft/gradient-permissive) AND "NO gradient... NO gloss..." in
the same prompt. If the frames come back soft, that's not new information — it's the audit's own
predicted outcome, already registered as fix item 9/#1, restated at real cost. If they come back
flat despite the contradiction, the result is not attributable to the new doctrine (the old text is
still there fighting it), so it would not actually validate the fix method Daniel is meant to be
signing off on. Per `operating-law.md` §D ("don't fire a generative/expensive step until its
upstream input is validated/locked") and per `image-generation/SKILL.md`'s own rule ("[bible] values
are human-editable law — never silently change one mid-run; surface a proposed edit and keep forging
non-dependent assets") — and here there IS no non-dependent asset: `desc_style`/§2b is the first
paragraph of literally every one of the 5 requests, scene and STEP-1 alike — the correct action is
to stop and surface this, not spend around it.

## 5. What's needed to unblock (not this worker's call to make)

The doctrine edit itself is **already done, human-approved, and sitting in the worktree** — this is
a **sync gap between the two trees**, not an open design question:
- Copy the worktree's current `orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md`
  (§2b at minimum; check §2c/§5 too since the design named all three) over the main checkout's copy
  at `C:/Users/danie/kb/orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md`.
  `visual-grammar.md`'s stale suffix-recipe text is a secondary, lower-stakes copy (it's docs, not
  something forge reads at gen time) but should move with it for consistency.
- Re-run the §3 dry-run (`$0`) and confirm the assembled prompt carries the flat-cel recipe **once**
  — no "gentle soft cel shading" anywhere in the printed text.
- Then this exact 5-item slate (`scratchpad/probe-items.json`, already built and seed-ordered) is
  ready to fire for the real ~$0.575 probe.

## 6. Spend ledger — Part 1 (pre-flight stop, superseded)

| # | request | dry-run | live call | outcome | price | SHA-256 |
|---|---------|---------|-----------|---------|-------|---------|
| 1 | L28 | done, logged §3 | not attempted | stopped pre-flight | $0.00 | — |
| 2 | fig-miniscribe-rep--action-powerstance--expr-deadpan | done, logged §3 | not attempted | stopped pre-flight | $0.00 | — |
| 3 | L29 | done, logged §3 | not attempted | stopped pre-flight | $0.00 | — |
| 4 | L35 | done, logged §3 | not attempted | stopped pre-flight | $0.00 | — |
| 5 | L34 | done, logged §3 | not attempted | stopped pre-flight | $0.00 | — |

Spend at this point: $0.00. No PNGs were generated, staged, registered, or promoted. `_staging/`
untouched. `probe-board.html` not built (nothing to show yet). Superseded by §7 once the coordinator
closed the sync gap.

## 7. Part 2 — post-fix dry-run confirmation + live calls

### 7.1 Re-run dry-run against the now-unified main-checkout kit ($0)

Main checkout switched to branch `claude/bricks-doctrine-reset` (coordinator; worktree left detached
at the same commit `89c720e`, files unchanged — forge still run from the worktree exactly as before).
Confirmed by direct read before spending anything: `style-bible.md` §2b now reads

```
MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colour fills — one flat
base colour per surface plus at most ONE hard-edged single-step shadow shape, no feathered or
blended transitions, uniform highlight-free surfaces — rounded friendly shapes, no realistic
detail. No text, no words, no labels.
```

— zero "gentle soft" / "gentle...cel shading" anywhere in the file. Re-ran `forge.py gen --batch
probe-items.json --dry-run`: all 5 assembled prompts now speak with ONE voice — the STYLE-ONLY
descriptor and `HARDENED_SCENE_STYLE` agree word-for-word on "flat colour fills — one flat base
colour per surface plus at most ONE hard-edged single-step shadow shape... NO gradient... NO
gloss..." with no contradicting clause anywhere in any of the 5 prompts. Full output saved verbatim:
`scratchpad/probe-dryrun-output-2.txt`. **Confirmed clean — proceeded to live calls.**

Descriptor bytes pinned to `orgs/faceless-youtube/knowledge/decisions.md` (dated entry, 2026-08-05,
quoted verbatim in a fenced block) before any paid call, per the brief.

### 7.2 Live calls — dependency-ordered, spend law applied per item

A pre-existing, PRE-RESET `_staging/L28.png` (and siblings `L01.png`…`L47.png`) from a prior round —
never covered by the B1 quarantine, which only archived `fig-*` — would otherwise have been silently
`skip`ped and returned as "the" result. Caught before any spend: `--force` used on every scene/plate
call (not on the STEP-1 card, which had no collision) so this probe only ever reports pixels minted
under the unified descriptor, never a stale reuse.

The provider (`gemini-3-pro-image`) was under sustained load this session — **7 of 8 total call
attempts returned HTTP 503 "This model is currently experiencing high demand"**, a clean no-image
mechanical response (not a timeout, not a 429). Spend law applied literally per item: one unchanged
re-issue per mechanical no-image failure, no retries beyond that.

| # | request | attempt 1 | re-issue (if needed) | result | price | SHA-256 |
|---|---------|-----------|----------------------|--------|-------|---------|
| 1 | **L28** (plate) | 01:58:37–02:02:28 HTTP 503, $0 | 02:02:41–02:03:48 **OK** → `_staging/L28.png` | **GENERATED** | **$0.134** | `99265f53efda5135f091517c4c6acf2495b234c25de4cbf1c4ed7fac8d956da8` |
| 2 | **fig-miniscribe-rep--action-powerstance--expr-deadpan** (STEP-1) | 02:04:11–02:05:38 HTTP 503, $0 | 02:05:45–02:07:26 HTTP 503, $0 | **EXHAUSTED — no image** | $0.00 | — |
| 3 | **L29** (figure-bearing interior) | — | — | **NOT ATTEMPTED — blocked** (seeds item 2's output, which does not exist) | $0.00 | — |
| 4 | **L35** (crowd-bearing) | 02:08:01–02:09:35 HTTP 503, $0 | 02:09:44–02:11:27 HTTP 503, $0 | **EXHAUSTED — no image** | $0.00 | — |
| 5 | **L34** (prop insert) | 02:11:37–02:15:xx HTTP 503, $0 (shell auto-backgrounded past 240s; confirmed complete + non-image on read-back, not a stall) | 02:16:19–02:20:03 HTTP 503, $0 | **EXHAUSTED — no image** | $0.00 | — |

Item 5's first attempt ran past the Bash tool's 240s foreground window and was moved to background
automatically; read back immediately after via the task output file — it had already returned a
clean HTTP 503 (not hung), so this is counted as one ordinary mechanical failure, not a stall
requiring separate handling. No item in this table received more than 2 total attempts (1 original +
1 re-issue); none was re-issued a second time; item 3 was never attempted at all since its required
seed was never minted — per the brief, "reuse-before-regenerate" cuts the other way here: there was
nothing valid to reuse, and inventing a substitute seed was never on the table.

## 8. TOTAL ACTUAL SPEND: $0.134

Of the ~$0.575 planned / $0.85 hard-abort ceiling — well under both; the shortfall is providerside
availability, not a spend-law stop. **1 of 5 planned frames generated** (`L28`, the `miniscribe-plant`
place plate). The other 4 — the STEP-1 card, the figure-bearing interior scene that depends on it,
the crowd-bearing scene, and the prop insert — are **outstanding**, each having genuinely exhausted
its one allowed re-issue at $0, not skipped or under-tried.

**What's needed to finish:** nothing structural — the slate (`probe-items.json`/`probe-item-*.json`,
already seed-ordered, already `--force`-aware) is ready to fire as-is once provider load eases. No
doctrine, spend-law, or quarantine question remains open; this is purely "try the same 4 requests
again later."

Supporting evidence on disk, this directory: `probe-slate.json` (full 55-item whole-file slate),
`probe-items.json` (the 5 selected items, seed-ordered), `probe-item-<id>.json` (single-item batch
files used for the controlled live calls), `probe-dryrun-output.txt` (pre-fix dry-run),
`probe-dryrun-output-2.txt` (post-fix dry-run, confirmed one voice).

# Track A archaeology notes — rollback-target candidates

Read-only archaeology (git history only; no files touched except this one + dossier.json).
Companion to `dossier.json` (75 rows: 25 Daniel-named beats x gen-A/gen-B/gen-C). Written
incrementally per section as the underlying `git log`/`git show` queries completed.

Governance path map used throughout (see `dossier.json._meta.governance_paths` for the exact
strings):
- `vpw_skill_md` = `orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md`
- `forge_py` = `orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`
- `style_bible_md` = `orgs/faceless-youtube/channels/the-second-take/visual-kit/style-bible.md`
- `visual_grammar_md` = `orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md`
- `registry_json` = `orgs/faceless-youtube/channels/the-second-take/visual-kit/registry/registry.json`
- `decisions_md` = `orgs/faceless-youtube/knowledge/decisions.md`

Generation anchor commits used for `dossier.json` text extraction (all via `git show <commit>:<path>`,
never checkout):
- **gen-A** = `7cfa9ab` (2026-08-04T14:07:26-04:00) — pre-reset final state, 214 `long_form.shots`.
- **gen-B** = `d1f771a` (2026-08-05T20:01:35-04:00) — 248-shot file, the "2cb1856-era" the brief
  names, finalized by the era-restoration commit; byte-identical to `52b17ab` per
  `_build_elicit_board.py`'s own `GEN_B_SNAPSHOT` constant and comment, so `d1f771a` is used
  directly as the more precise (and earlier-dated) authoring anchor.
- **gen-C** = `ede2f56` (2026-08-07T02:57:19-04:00) — current, 246 shots (working-tree `shots.json`
  is byte-identical to this commit as of HEAD `e53706a`; `git diff HEAD -- shots.json` is empty).

---

## H1 — the L28 place plate itself (supporting evidence, not the assigned deep-dive)

Not one of my three assigned deep-dives, but the dossier rows surfaced a clean, spot-checkable
data point worth flagging for whoever owns H1/G4 remint proposals.

**gen-A L28 (old id `L26`, commit `7cfa9ab`) had a full figure scene**: `miniscribe-rep` at
`action-powerstance`/`expr-smug` on an assembly line, described in detail (conveyor, four
finished drives, factory windows). **gen-B and gen-C L28 are both `cast-free`** — the shot was
re-authored as an empty room ("cast-free, wide static eye-level from the aisle... Two long
workbenches... a shut roll-up shipping door... fluorescent tubes... the concrete floor is sealed
and pale", gen-B; "entirely empty of people: two long steel benches... a rack of empty tote
bins... a roller door shut", gen-C). This matches Daniel's complaint almost word for word ("a
small room with nothing on the shelves") and confirms the defect is authored, not rendered: the
prose itself specifies an empty, spare room in both post-reset generations. See `dossier.json`
rows `L28`/gen-A vs `L28`/gen-B vs `L28`/gen-C for the full text and `prose_delta_vs_prior_gen`.

---

## H3 — the Poyais-era slightly-warm palette doctrine (assigned)

**Primary source, already in the repo, read but not modified:**
`orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/poyais-mechanism-archaeology.md`
(371 lines, committed as part of `d1f771a`). This is a prior archaeology pass that already did
most of this excavation; I verified its citations against `git show` rather than re-deriving them.

**The literal Poyais-era doctrine text**, verbatim, at commit `ff36f63` (2026-07-19, the live
faceless-youtube import — the earliest commit in this repo's history, i.e. as far back as
archaeology can reach):

- `style-bible.md` §2b (era descriptor): *"Draw in the SAME art style as the reference image: a
  clean FLAT cel-shaded CARTOON look, an even MEDIUM-THICK dark warm brown-black (#241a12) outline
  on everything, simple flat colours with gentle soft cel shading, rounded friendly shapes, no
  realistic detail. No text, no words, no labels."*
- Poyais `shots.json.global_prompt_suffix` (609 chars, appended to the tail of every `still_prompt`):
  *"Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm
  brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, rounded
  friendly shapes, no realistic detail; built-but-flat environment...; locked 2-3 colour scene
  palette plus the single red accent #d7402b used only semantically...; 16:9."*
- Poyais `house_style.palette`: *"locked 2-3 colour scene palette per beat + the one red accent
  #d7402b; character colours fixed (cream/tan heads, #241a12 outline)"*.
- **Measured**, per the archaeology doc's per-shot audit of all 117 Poyais `still_prompt`s: 93%
  said "warm", 82% named `#d7402b`/"red accent", 87% carried an explicit `Palette:` clause, 98%
  carried `#241a12` inline. The archaeology's own verdict: *"AUTHORED, per shot, at 93%... It was
  never emergent."*

**What happened to it, with commits:**
1. `f4ca9b5` (2026-08-04T02:43:19) — "probe-decided style law: hardened flat-cel descriptor... no
   image style anchors" — introduced `HARDENED_SCENE_STYLE` in `forge.py`, a block of six
   render-technique negations (no gradient, no gloss, no bloom, no DoF blur, no rim light, no
   photorealistic texture) with **no era ancestor** for four of the six.
2. `d1f771a` (2026-08-05T20:01:35) — "era restoration" — **partially reverted** the drift after
   Daniel said "lean towards how poyais did it": restored `global_prompt_suffix` to the era text
   verbatim (confirmed still live at HEAD — `python -c "import json;
   print(json.load(open('shots.json'))['global_prompt_suffix'])"` on the current working tree
   returns the exact 609-char era string, including "warm brown-black" and the red-accent clause),
   restored `style-bible.md` §2b to open with "Draw in the SAME art style as the reference image...
   CARTOON look... simple flat colours with gentle soft cel shading" (current file, confirmed by
   `grep -n "STYLE-ONLY descriptor" -A6 visual-kit/style-bible.md`), deleted `HARDENED_SCENE_STYLE`.
   Its own decisions.md entry flags the residual gap: **"Open risk (named, banked). Era palettes
   were authored warm per shot (93% "warm"); the fresh file's palette prose is cooler — board v2
   renders are the evidence gate for a palette pass."** This restoration fixed the *structural*
   mechanism (suffix position, descriptor wording, style-anchor rule) but explicitly did **not**
   re-author the per-shot `Palette:`/"warm" clauses — that gap is exactly what Daniel is now
   flagging.
3. `ea71f99` (2026-08-06T00:31:00) — "R1 grayscale drift" — measured a real defect (median
   saturation 0.089, 44.9% achromatic pixels) and fixed it by rewording the style-bible tile-grant
   clause from DISCIPLINE to SATURATION and adding to §2b: *"any grey or neutral clearly TINTED
   warm or cool, so a cold scene reads COLD-COLOURED and never drains to greyscale"*. This raised
   saturation (0.089→0.189) but **explicitly licenses cool scenes to stay saturated-cool rather
   than leaning warm** — it is a grayscale-vs-color fix, not a cool-vs-warm fix, and decisions.md
   records it as adjudicated separately from the still-open palette-warmth risk banked at `d1f771a`.

**Rollback-target candidate for H3, ranked (from the archaeology doc's own §5, cross-checked
against current file state):**
- **E1** (biggest effect / smallest edit, per the archaeology doc): the *global suffix and #2b
  descriptor structural restoration is already shipped* (step 2 above) — nothing further to roll
  back there.
- **The actual open gap is per-shot authoring density**: era 93% of shots explicitly authored
  "warm" in a `Palette:` clause; the archaeology doc measured today's file (pre-restoration) at
  26%. A moderate re-lean (per Daniel's two-sided-target amendment — "a little bit back... not as
  warm") would mean raising the warm-clause authoring rate for VPW's per-shot `Palette:` text
  toward the era's discipline without returning to 93%/full saturation, and is a VPW-authoring-time
  lever (visual-prompt-writer SKILL.md + the shots.json prose itself), not a forge/style-bible
  lever — the mechanism-level (forge/style-bible) restoration is already done.
- Exact rollback text for the style-bible/suffix layer, if a full era reversion were ever wanted
  instead: the two verbatim blocks quoted above, both already live at HEAD in their restored form
  (spot-checkable: `git show ede2f56:.../shots.json` global_prompt_suffix field, and current
  `visual-kit/style-bible.md` lines ~45-51).

---

## H5 — the doctrine window that introduced bald/cream crowd flattening (assigned)

**Finding: no such doctrine window exists in this repo's history.** The crowd-flattening Daniel is
seeing is not traceable to any bricks-fresh (or earlier) doctrine text that *mandates* bald+cream
for crowd or cast figures. Two separate facts, both git-log-verified:

1. **"Bald cream-headed" is a description of the generic BASE TEMPLATE only, present since the very
   first imported commit, never changed.** `git log -S bald -- visual-kit/style-bible.md` returns
   only `c3c749d`/`ff36f63` (2026-07-15/19, the initial import) plus two later pure-line-number
   refactors (`f233bd7`, `ae883f0`) that reflow the same sentence without changing its wording.
   Current `style-bible.md` line 13: *"The base is a TEMPLATE, not a character.
   `refs/base/base.png` — a bald cream-headed figure..."* and line 113: *"base-cream bald head on a
   haired/toned character is an **identity FAIL** even when every form invariant holds."* The
   doctrine has always explicitly treated bald+cream as the *anonymous placeholder*, and has always
   explicitly flagged a cast/crowd figure that renders bald+cream as a **failure**, not a rule
   being followed correctly. `refs/base/crowd-exemplar.png` (the seed asset actually cited by crowd
   shots, e.g. gen-A `L08`'s `assets.crowd-exemplar`) is likewise present unchanged since the same
   original import commit (`ff36f63`).
2. **A specific decision explicitly rejected uniform bald/cream crowds.** Commit `240aed7`
   (2026-08-05T03:59:34), decisions.md entry "crowd variety: bounded variety kept, uniform
   bald/cream rejected": *"keep varied crowd hair/outfits — 11+ prior VPW rounds logged varied
   crowds with zero variety-caused defects... Two bounding changes adopted: (1) crowd variety
   bounded to 2-3 repeating hair/headwear silhouettes per group... (2) CROWD-RIG simplified-face
   rule made explicitly per-figure in multi-figure shots... **Alternatives rejected. Uniform
   bald/cream crowds — solves a problem the record says we don't have, and reads as cloned filler
   against the channel's originality bar."*** This ruling postdates and directly contradicts the
   idea that a doctrine window introduced bald/cream as policy.

**Conclusion for the record:** H5's premise ("which doctrine window introduced the bald/cream
crowd law") has a null answer — there is no such law, and one was explicitly considered and
rejected. This reframes H5 for whichever track owns it next: the defect Daniel is seeing is
**not a missing/wrong rule** (Track A's domain) but a **routing/rendering gap between the ratified
2-3-silhouette-variety decision and what the 6c2-wave crowd shots actually render** — squarely
Track C's "confirms crowd-tier routing" mandate from the hypothesis test. I did not attempt that
trace; it is out of scope for archaeology and belongs to the routing track.

---

## H7 — L38 expression asset + "villain-smug" minting provenance (assigned)

**All expression assets are foundational, shared, generic infrastructure — none are bricks-fresh
or even doctrine-window-specific.** `registry.json`'s 18 `expr-*` entries (`expr-deadpan`,
`expr-delighted`, `expr-skeptical`, `expr-smug`, `expr-surprised`, `expr-worried`, `expr-confused`,
`expr-pleading`, `expr-annoyed`, `expr-fear`, `expr-talking`, `expr-thinking`, `expr-crestfallen`,
`expr-eyeroll`, `expr-laughing`, `expr-caught`, `expr-shock`, `expr-greedy`) are **all** keyed to
`"character": "base"` and **all** first appear at the same commit: `git log -S '"expr-greedy"'`
(and the same query for `expr-smug`, `expr-deadpan`, `expr-pleading`) each return only `c3c749d`
(2026-07-15, "Import faceless-youtube snapshot") / `ff36f63` (2026-07-19, "import live
faceless-youtube working tree") — i.e. channel launch, before this video, before any bricks-fresh
doctrine commit exists. `git log --diff-filter=A -- "*expr-greedy.png"` and `"*expr-smug.png"`
confirm the same for the PNG files themselves: added once, at `ff36f63`, never touched again.

**No `expr-villain` or similar tag exists anywhere in the registry.** "Villain-smug" is Daniel's
own description of how a rendered frame reads, not a formal asset name — this matters for whoever
implements a fix: there is no single bad row to delete.

**Structural finding relevant to why a generic expression can read wrong on a named character:**
every `expr-*` asset's `seed_frame` is `refs/base/base.png` (the anonymous template), *not* any
named cast member's canonical portrait. Yet current gen-C prose applies these base-tier expression
tags directly to named cast: e.g. `L36`'s current text (commit `ede2f56`, unchanged since the
gen-C-authoring commit `d680fda`) reads `` `miniscribe-rep`, `expr-greedy`, `action-powerstance` ``
— a named-cast identity paired with a base-tier expression asset whose reference pixels were never
drawn against that character's face. This is a plausible mechanism for "villain" reads that have
nothing to do with the tag's own name (`expr-greedy` ≠ "smug" ≠ "villain" by name, but the asset
itself may render however its base-template minting session drew it): the registry has no
per-cast-member expression variants at all, only the one shared base set, at any generation.

**A text/pixel provenance caveat worth flagging up:** `L36`'s gen-C render timestamp
(`2026-08-07T00:10:56`, `assets/scenes/L36.png`) **precedes** the `ede2f56` commit
(`2026-08-07T02:57:19`) that is my gen-C text-extraction anchor, and `L36`'s prose is *already*
`expr-greedy` (not "smug") as far back as `d680fda` (the very first gen-C authoring commit,
2026-08-06T20:51:17) — so the text never said `expr-smug` for this beat in gen-C. Two readings are
both consistent with the evidence and I cannot fully disambiguate from git history alone (a
pixel-level question, outside archaeology's remit — flagged for whichever track/human has the
actual PNG): (a) `expr-greedy`'s minted reference art itself simply reads as smug/villainous
regardless of its tag name (most consistent with the "seed_frame = generic base.png" finding
above), or (b) the pixel Daniel reviewed was produced by an even earlier draft of this shot's
prompt that this archaeology pass cannot see (no `gen-B`-tagged render exists for L36 in
`beat-map.json` — see `dossier.json` row `L36`/gen-B, `rendered_under.reason`). Per this task's
carried finding #1 (board-embed-anchored pixel mapping, not raw beat-map paths, is authoritative
for "what Daniel actually saw"), whichever track owns pixel-identity should resolve this with
`_build_elicit_board.py`'s `board_ref`/`best_pool_match`, not with the shots.json text I traced
here.

**For the "L38 expression" specifically** (P02-L38 "I don't like that facial expression, remove it
from the expression asset library", repeated P04-L32, P05-L38): current gen-C `L38` prose uses
`` `expr-deadpan` `` (the `base` performer) and `` `expr-pleading` `` (`miniscribe-rep`); current
`L32` uses `` `expr-shock` `` (the `base` performer). All three tags share the exact same minting
provenance as `expr-greedy`/`expr-smug` above (foundational, `c3c749d`/`ff36f63`, generic
`base.png` seed, never revised) — I found no basis in the commit history to single out one of
{deadpan, pleading, shock} as *the* offending asset over the others; they are provenance-identical.
Whoever adjudicates the actual removal will need the rendered pixel (not the prose) to pick which
one Daniel meant, for the same board-embed-anchoring reason as the L36 caveat above.

---

## Data-quality caveats (acceptance: "no unknown without a stated reason")

- **`L50` has no `text_generations` block in `beat-map.json`** (its automated gen-B join produced
  no record). I recovered its gen-B id manually by `vo_text` match ("20 million dollars in and
  sent their...") inside the `d1f771a` shots.json and confirmed a real, distinct gen-B shot exists
  at id `L50`. Flagged in `dossier.json` row `L50`/gen-B `join_note`. `L50` is also the one target
  beat with no clean liked/disliked verdict ("Honestly both are fine, but neither is great",
  P06) — beat-map.json's own derivation tags it `"named_by": "unnamed:6c2-tenth2"` (excluded from
  both its `C6C2_LIKED` and disliked sets). Included in the dossier anyway per the brief's "every
  shot Daniel named" — he did address it, just without a clean verdict — and flagged here rather
  than silently dropped.
- **`L07`/`L10` (p6b board) have no on-disk gen-C render file** — both of their gen-C entries in
  `beat-map.json` are `manifest:` pointers with a date-only value (`"2026-08-06"`, no time). My
  governance-resolution treats a date-only anchor as end-of-day (`23:59:59-04:00`) for the
  "latest commit at or before" lookup. This resolves to `52b17ab` for both `forge_commit` and
  `style_bible_commit`, which I'm confident is correct even without the exact time: neighboring
  same-batch beats on the same board (`L19`/`L20`, same `gen-C-new246-p6b-tenth1-2026-08-06` tag)
  have precise on-disk timestamps at `2026-08-06T19:30:04`, ~35 seconds after `52b17ab`'s commit
  time (`19:29:25`) — consistent with the whole p6b-tenth1 batch running immediately after that
  commit — and `52b17ab` is also the *last* commit of that calendar day for both `forge.py` and
  `style-bible.md` (next is `ede2f56` the following day), so no intervening commit could change the
  answer regardless of the exact minute within 2026-08-06.
- **All 25 target beats have a real, spot-checkable gen-A and gen-C render entry; none has a real
  gen-B render** (`rendered_under.reason` states this per row: gen-B is text-only for every one of
  these beats, superseded by the 2026-08-06 re-author before image-gen reached it — this matches
  the pattern already documented in `_build_elicit_board.py`'s P10 panel design, "written, then
  replaced before anything was drawn").

## Spot-check pointers for the boss (3+ rows, verifiable via `git show <commit>:<path>`)

1. `dossier.json` row `{beat_id: "L28", generation: "gen-B"}` — `shots_json_prose` should exactly
   match: `git show d1f771a:orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/shots.json`
   → `long_form.shots[id="L28"].still_prompt`.
2. `dossier.json` row `{beat_id: "L36", generation: "gen-C"}` → `authored_under.vpw_commit.commit`
   should be `52b17ab`; confirm via `git log -1 --format=%cd --date=iso-strict 52b17ab` = the
   latest VPW SKILL.md commit at or before `ede2f56`'s date, and cross-check
   `git show 52b17ab:orgs/faceless-youtube/.claude/skills/visual-prompt-writer/SKILL.md` exists.
3. `dossier.json` row `{beat_id: "L07", generation: "gen-A"}` → `shots_json_prose` should exactly
   match: `git show 7cfa9ab:.../shots.json` → `long_form.shots[id="L08"].still_prompt` (note:
   gen-A id is `old_L`="L08", not "L07" — the beat was renumbered at the 2026-08-04/05 reset).

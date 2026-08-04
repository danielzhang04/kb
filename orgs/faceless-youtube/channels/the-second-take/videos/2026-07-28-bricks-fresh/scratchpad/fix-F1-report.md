# F1 fix report — voice + docs/data

Worker F1, worktree `kb-worktrees/boss-bricks-reset` (branch `claude/bricks-doctrine-reset`). No
commits made — boss commits. Findings closed: R1 B1, R1 M7, R1 M9, R2-B1, R2-M6.

---

## R1 B1 + R2-B1 — `global_prompt_suffix` still carried the deleted style voice (same root cause, closed together)

**File:** `channels/the-second-take/visual-kit/visual-grammar.md:12-23`

**Ruling implemented (boss-decided, not the findings' own suggested fix):** the suffix's style role
was duplication by construction — forge already prepends the bible §2b descriptor to every gen
request, so style vocabulary in the suffix was a second voice even when it agreed with §2b. Rather
than rewrite the suffix to restate C-1's recipe (R2-B1's own suggested fix), the suffix's scope was
cut down to the one thing §2b does *not* carry: the lettering register.

**Before (blockquote):**
> clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on
> everything, flat colours with gentle soft cel shading, rounded friendly shapes, no realistic
> detail, hand-lettered marker capitals for any in-world text

**After (blockquote) — confirmed exact text, verified byte-for-byte, no mojibake:**
> hand-lettered marker capitals for any in-world text

**Surrounding prose before:** "The suffix carries texture, line weight, and art style — and it is the
ONLY place they are stated." (the now-false claim R2-B1 named)

**Surrounding prose after:** "The suffix carries ONLY the lettering register — a reminder that any
in-world text renders hand-lettered, never a clean digital font (the full lettering law is
`style-bible.md` §5). Texture, line weight, and art style are stated ONCE, in `style-bible.md` §2b
(the single style source), and reach every request through `forge.py`'s descriptor, never through
this suffix."

The paragraph's closing "never write art-style/texture/line-weight words into a prompt" list is
preserved, updated to attribute injection to "the suffix and the bible descriptor" jointly (previously
attributed to the suffix alone, which is now only true for lettering).

**Sweep for other old-voice remnants:** grepped the whole file for `gentle|soft cel|gradient|
root_scene|plate-candidates|style anchor|blurred|specular|bloom|photoreal|rim light|glossy|
depth-of-field` — the deleted suffix blockquote was the only hit. No other contradiction with the
place/plate doctrine found in this file (its place-anchor/feasibility-gate language already matches
C-4/C-5 as landed).

**Verification against C-2 banned terms:** the new suffix contains none of the ten banned
render-technique terms, and none of `gentle`/`soft`/`feather`/`blend` — it will not trip
`suffix_one_voice_check` or `render_technique_check` (not run here; F2 owns lint, this is a text-level
check against the published regexes).

---

## R2-M6 — `example-shots.md` exemplars hard-failed the new lints

**File:** `channels/the-second-take/example-shots.md`

Re-authored the two failing exemplars in place, added the missing `place`-declaring exemplar, and
fixed one doctrine-language regression in a rationale line. Also fixed an internal contradiction in
the file's own preamble (its "never replace" house rule collided with the requirement to correct a
law-violating exemplar).

### Entry 3 (Ironic counterpoint) — seat/support fix
**Before:** `` `macgregor` (`sit`, `expr-deadpan`) sits alone at one small desk in the otherwise empty room. ``
**After:** `` `macgregor` (`sit`, `expr-deadpan`) sits alone on a chair at one small desk in the otherwise empty room. ``
Added the closed-list support noun (`chair`) with a contact word (`on`) in the same sentence as the
`sit` primitive — was a HARD `seat_support_check` fail (`desk` alone isn't in the closed noun list),
now a SOFT framing-confirmation row per C-7. Still teaches exactly the same point: the sign's grandeur
staged against the tiny reality behind it.

### Entry 2 (Staged interaction) — two-cast presence fix
**Before:** ends "...a full stride of open sand separates them, hands never meeting, goods never overlapping." (no plane/eye-line/scale clause — HARD `two_cast_presence_check` fail)
**After:** added "...facing him at a matching eye-line and head scale, both on one plane;" before the
sand clause, and extended the "Why" to explain C-8 requires these on every 2+-cast shot. Still teaches
the same point: the physical gap between the goods argues the fraud; the new clause makes the staging
(not an unstated camera accident) explicit, which strengthens rather than dilutes the teaching point.

### New Entry 9 — place + plate exemplar (previously missing entirely)
Added `## 9. Recurring place + plate (invented — mechanism exemplar, not a new shot_class)`: a
two-shot pair — a no-cast establishing plate (`place: poyais-brokerage`) followed by an in-place
follow-up shot that seeds off the plate and states only what changed, never re-describing the room.
"Why" ties it explicitly to C-4/C-5. This directly answers R2-M6's "no exemplar in the file
demonstrates `place`."

### Entry 8 (Delta-chain trio) rationale — stage-only continuity language
**Before:** "three claims building the same lie share one stage and cut on the noun each promises,
never re-establishing the vista from scratch."
**After:** "three claims building the same lie share one stage inside the video's own `place`, cutting
on the noun each promises, never re-establishing the vista from scratch." (Note: the finding's file:line
cites "entry 6's rationale" but the quoted text — "three claims … share one stage" — is verbatim
entry 8's rationale; entry 6 (Symbolic stand-in) has unrelated rationale text. Treated as a numbering
slip in the finding and fixed the entry the quote actually identifies.)

### Preamble contradiction fixed
**Before:** "new approved pairs are added below it, never replacing what already passed."
**After:** "new approved pairs are added below it, never replaced for style — an entry that turns out
to violate a landed law is corrected in place, since a law-violating exemplar teaches the violation."
This removes the house-rule vs. required-correction contradiction the in-place edits above would
otherwise create.

**Not touched (out of R2-M6 scope, flagged not fixed):** R1's m8 (MINOR, unassigned) — entries 2/3/5
author in-image literals unquoted, and entry 1's crowd staging reads as the co-planar foreground
gathering `visual-grammar.md:128-130` forbids. Left as-is; not one of the findings I was assigned to
close.

---

## R1 M9 — motion doctrine's "style anchor duty" for plates

**File fixed:** `.claude/skills/motion-planner/references/animation-rules.md:17-23`

**Before:** "...seed every cutout from its character/prop canonical, or from the plate it lands on —
the video's own plate carries the style anchor duty itself now that cross-video `refs/env/` plates are
abolished (fix 2) — since an unseeded cutout invents its own register and lands off-style against a
flat-cel plate..."

**After:** "...seed every cutout from its character/prop canonical, or from the plate it lands on, for
CONTINUITY: the plate carries place/set continuity only — it is not a style anchor, and no cross-video
`refs/env/` style-anchor plate exists (fix 2). Style comes from the hardened bible descriptor
(`style-bible.md` §2b), never from a seed, on every gen alike — since an unseeded cutout invents its
own register and lands off-style against a flat-cel plate..."

**STOPPED ON:** the task brief named the second file carrying the identical sentence as
`motion-planner/SKILL.md`. I read that file in full and grepped it for `style anchor`, `refs/env`,
`cross-video`, `abolish`, `fix 2`, `seedable` — zero hits; the sentence does not exist there. The
actual duplicate lives in `motion-planner/references/critics.md:20-21` ("...not seedable off the plate
it lands on (the video's own plate carries the style anchor now — no separate cross-video `refs/env/`
anchor exists, fix 2)..."), which is **not** in my owned-files list (only `SKILL.md` and
`references/animation-rules.md` are). Per the rules, I stopped there rather than editing it. `critics.md`
still asserts the repealed law and needs the same fix — same replacement language as above, scoped to
its sentence — from whichever worker owns `motion-planner/references/critics.md`.

---

## R1 M7 — `image-generation/SKILL.md` contradicted the place/plate seed law in the same file

**File:** `.claude/skills/image-generation/SKILL.md:29-31` (only this sentence touched; rest of file
untouched per the brief)

**Before:** "...They compose inside their own scene's gen in Pass 2, and a held set carries by seeding
the prior frame, never a plate."

**After:** "...They compose inside their own scene's gen in Pass 2: **within a stage**, a held set
carries by seeding its delta's in-chain parent frame; **across a place**, continuity carries by
seeding the place's derived plate (§Seed law, below) — never a freshly re-authored plate."

This makes the two scopes from the seed-law table (line 106: "Every OTHER in-place shot seeds its own
place's first approved frame...") and the delta-chain seed rule (line 107: "a delta-chain frame seeding
its in-chain parent") both explicit and non-contradictory at their first mention in the file, instead
of flatly denying plates ever get seeded (which is what produced the L89-L91 drift the review cites).

---

## Verification

- Grepped all four touched files for mojibake (`â`) and for stray old-voice terms
  (`gentle|soft cel|gradient|root_scene|plate-candidates|style anchor|blurred|specular|bloom|
  photoreal|rim light|glossy|depth-of-field`) post-edit: clean except the one now-correct "not a style
  anchor"/"style-anchor plate" negations in `animation-rules.md`, which are the fix itself, not a
  remnant.
- No edits made to `lint_shots.py`, its tests, or `forge.py` (F2/F3 territory).
- No commits made; worktree left with the four files modified, nothing staged.

## Files touched
- `orgs/faceless-youtube/channels/the-second-take/visual-kit/visual-grammar.md`
- `orgs/faceless-youtube/channels/the-second-take/example-shots.md`
- `orgs/faceless-youtube/.claude/skills/motion-planner/references/animation-rules.md`
- `orgs/faceless-youtube/.claude/skills/image-generation/SKILL.md`

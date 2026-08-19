# Adversarial review — fix-plan-v1 (9 items)

Reviewer: adversarial (read-only). Target: `scratchpad/taste-audit/fix-plan-v1.md`.
Every claim below is a file:line, a measured count from a script I ran, or an explicit HYPOTHESIS.
Owner's goals treated as the constitution: (1) keep the 2026-08-18 reset wins, (2) revert-biased
restoration, (3) no bloat / one owner per rule, (4) shots.json only via the VPW skill, (5) small
figures in a deep world, generous air, balanced-warm without pushed saturation, accent = per-beat
option.

---

## P1 — VPW SKILL rule 4 (scene facts): restore "framing + scale", delete plane-ownership

**SHIP-WITH-EDIT.**

The diagnosis holds: rule 4 at `.claude/skills/visual-prompt-writer/SKILL.md:127-133` currently reads

> …the committed scene palette, light/atmosphere, and a **payload-driven THREE-PLANE read** — what
> occupies the foreground, the mid, and the background of THIS beat, at what scale, and from where the
> camera sees them, the payload owning the plane that carries it, in whatever sentence the scene wants.

"The payload owning the plane that carries it" is a real active ingredient and deleting it is a clean
deletion. But the plan's instruction — *"restore the era requirement 'framing + scale, the committed
scene palette, light/atmosphere, and depth (fore/mid/background)'"* — is written as a **replacement of
the whole sentence**, and that sentence is not era text plus one bad clause. Two of the reset's named
wins live inside it:

- the **THREE-PLANE read** itself ("3-plane prompt read" is in `33676421`'s own subject line), and
- **"from where the camera sees them"** — the vantage requirement. `573414b7`'s subject claims "16+
  vantage signatures"; that is the clause that produces them.

Reverting to the era's flat *"depth (fore/mid/background)"* deletes both. That is a goal-1 regression
(vantage variety, and the reset's 3-plane read) inside an item advertised as "Net −".

**Exact edit that survives review:** keep the sentence; make exactly two changes.
(a) add `framing + scale` as a standalone item in the list before "the committed scene palette";
(b) delete only the eleven words `, the payload owning the plane that carries it`.
Do not touch "THREE-PLANE read", "at what scale", or "from where the camera sees them".

Also correct as written: not restoring the era's trailing "filled edge-to-edge" here. Note it is not
lost — `visual-grammar.md:150` and `:152` still require it for plates and `style-bible.md:169` for
environments, which is the correct scoping.

---

## P2 — three suffix deletions

The suffix under review is `visual-grammar.md:15`, byte-equality-enforced against
`shots.json.global_prompt_suffix` by `lint_shots.py:1421-1475` at runtime (so both files must move
together — the plan states this correctly).

**The plan names the wrong pin tests.** It says "the two suffix pin tests
(`test_doctrine_reset_guards.py`, `test_forge_style_tile.py`) update".
`test_doctrine_reset_guards.py` **never reads the live kit** — `KIT_DIR` is unreferenced; it builds a
throwaway kit via `_kit_with_suffix()` and tests `suffix_one_voice_check` against synthetic fixtures,
with an `ERA_SUFFIX` literal (`:26-34`) that is already stale (pre-`33676421`, no "warm-biased"). None
of P2(a)/(b)/(c) touches an assertion in that file. The test that actually breaks is
`test_forge_style_tile.py:308` — `assert "> " + ERA_SUFFIX in grammar` — where `ERA_SUFFIX` (`:55-63`)
holds **all three clauses in one pinned string**, so deleting any one of them breaks that single
assertion and the test cannot tell you which. Budget one test edit, not two, and know that the
"guard" being updated is a single containment assertion, not three independent pins.

### P2(a) delete the environment recipe — **SHIP**

*"built-but-flat environment (flat gradient sky/ground + minimal geometry + one foreground depth
prop)"*. Era suffix had no environment clause; `style-bible.md:169-171` ("built but flat … composed
edge-to-edge with a fore/mid/background depth read … Rich, not sparse") governs environments and is
era-identical. Nothing is left ungoverned; the clause describes NEW L20's render almost literally.
No finding.

### P2(b) delete "locked 2-3 colour warm-biased scene palette" — **SHIP-WITH-EDIT (delete the lock, KEEP "warm-biased")**

This is the item that most deserves killing as worded, because it deletes today's warmth mechanism to
fix yesterday's palette mechanism, in one move, with no evidence apportioning the two.

What the evidence actually supports: the **mandatory 2-3-colour lock** is the mechanism. "palette"
became an authored field on 100% of shots (era 53%) and VPW discharges a *count* as a named colour
**triple**, which is an instruction about fills — "teal" 1% → 52% (residual-forensics-claude §3).
Nothing in either forensics file attributes any part of R3 to the two words "warm-biased".

What deleting "warm-biased" risks: it is one of the three warmth mechanisms `33676421` shipped **today**,
and today's measured tail is already better than the liked set on the cool axis —
`metrics-summary.md` line 4: p10 R-B **LIKED −5.54 vs NEW +0.60**. The residual cool shots (L04 −93,
L12 −77, L11 −68) are *authored* dawn/night beats (codex Q4, high confidence), not a suffix failure.
Deleting a working global counterweight to fix a defect the plan itself traces to a different clause
is a gamble taken for no gain.

**And the counterweight was measured barely sufficient, twice.** `224b204c`'s own record
(`scratchpad/plate-regen/progress.md`) says of the post-`33676421` doctrine: *"3/7 (L28, L84, L86)
still read grey-teal **despite the bible's warm-neutrals clause** — the authored payload's literal
'Cool grey-X palette' wording won over the system instruction"*, and L84 was **parked net-cool**
(mean R−B −25.2 → −14.3). The three warmth mechanisms together lose to authored prose on 3 of 7
plates. Removing one third of a counterweight that already loses 43% of its fights, in the same wave
that also relaxes the colour instructions authors write, is the wrong direction.

**Exact edit:** replace the clause with `warm-biased scene palette` — i.e. delete `locked 2-3 colour`
and nothing else. This kills the colour-triple mechanism (the evidenced cause), preserves the warmth
counterweight, and is still net −.

If the boss insists on the full deletion, it must be gated on a measured A/B (one plate, suffix with
and without "warm-biased", R-B measured) — not shipped blind. See cross-item finding X-2.

### P2(c) delete the accent restriction — **KILL**

Four independent reasons.

0. **The liked frames were made UNDER this rule.** The plan's premise is "the era suffix carried no
   accent clause, so the restriction is new". The *suffix* did not carry it; the *rule* predates this
   repo. `git show c3c749d2:…/visual-grammar.md` — the first commit that imports the channel into kb,
   2026-07-15 — already reads: *"**Red (`accent`) is the ONLY emphasis ink** — semantic (alarm /
   prohibition / ownership / the punch element that lands last), never decorative"*, and
   `style-bible.md` at the same commit carries "a semantic prohibition/alarm/ownership mark" with an
   internal note "absorbed here 2026-07-08". It entered the suffix at `d1f771a7` (2026-08-05), whose
   own message frames that as **era restoration**, not a new restriction. So era L23's red brick was
   authored while the semantic law was live and binding — it was never illegal, and nothing is being
   "re-legalised". The item's entire rationale rests on a false historical premise.

1. **The stated justification is false on its own evidence too.** The plan justifies the deletion with
   "era L23's decorative hero brick would be illegal today". The restriction reads *"used only
   semantically (alarm / prohibition / ownership / **the last punch element**)"*. ERA L23 is the punch
   element of its beat — the red brick IS the payload the whole video turns on
   (residual-forensics-claude §3 quotes it as an object-hero with "the brick the only warm mass in the
   frame"). It is legal today, verbatim, under the fourth term. The exemplar cited to prove the rule
   is broken satisfies the rule.
2. **It does not fix R4.** Both forensics files independently reject "the red went away":
   tight-matched accent-red area is **higher** now (0.0032 vs 0.0012; 9/25 vs 2/10 shots carrying a
   real red mass) and the diagnosed mechanism is *loud hue bins 1.40 → 2.08* — i.e. the ground got
   noisy, not the accent restricted. Removing a restriction on a metric already trending up is the
   wrong direction on goal 5 ("accent = per-beat option" is about authoring choice, not about
   permitting more red).
3. **The guard is not redundant the way the plan implies, but the plan is right that it is
   multiply-owned** — which argues for deleting it from the *weakest* voice, not the one on every gen.
   Live owners today: `style-bible.md:159` (§4, "a semantic prohibition/alarm/ownership mark"),
   `visual-grammar.md:278` (§5, "Red is the only emphasis ink, semantic (alarm / prohibition /
   ownership / the last punch element)"), VPW `SKILL.md` step 3c self-audit ("**red-ink count** … a
   rising count means it is turning into decoration"). So the suffix copy IS a fourth statement of one
   rule and deleting it is defensible **as a bloat fix** — but then the plan must say so honestly
   ("de-duplicate a rule stated in four places"), not "re-legalise the era's decorative accent", which
   is a behavioural change nobody's evidence asked for.

**What replaces it:** nothing this wave. If the boss wants the de-duplication, do it as a stated bloat
fix *after* P3 lands and the loud-hue-bin count is re-measured — deleting a red restriction while
simultaneously moving chroma budget onto the accent (P3) stacks two accent-increasing changes in one
wave with no measurement between them.

---

## P3 — style-bible §2b: "FULL cel strength / every fill a real colour" → moderate base chroma

**SHIP-WITH-EDIT (one surgical wording change, nothing added, plus a Daniel gate).**

Current text, `style-bible.md:53-57`:

> …flat colours laid down at **FULL cel strength — every fill a real colour**, and any grey or neutral
> clearly **TINTED WARM**, so the frame never drains to greyscale; a genuinely cold scene cools its
> **LIGHT**, never its neutrals — with gentle soft cel shading…

**What the floor was built for — and Daniel's own ruling on it.** `ea71f99e` (2026-08-06) is titled
*"R1 grayscale drift"*. Its own diagnostic (`scratchpad/r1-grayscale-analysis.md`) measured the
offending fresh plate at **median S 0.089, 44.9% achromatic** against the style tile's **mean S 0.407,
5.6% achromatic**, and named the mechanism: *"the model is not drifting, it is complying"* — "simple
colours" plus "take only discipline from the exemplar" makes grey the unique solution. Daniel's ruling,
recorded verbatim in `knowledge/decisions.md` in that same commit: **"Grayscale drift = analyze and FIX
at the style layer — 'I don't care if it's cool, but it can't be grayscale'"**, i.e. *plates may render
COOL, but must not render GRAYSCALE*. This is a live human ruling on the exact clause P3 edits, and the
plan does not cite it.

**The floor survives P3 anyway — if P3 is surgical.** The anti-grey mechanism is not "FULL cel
strength"; it is the pair (i) "any grey or neutral clearly TINTED WARM, so the frame never drains to
greyscale" (P3 keeps it) and (ii) the §5 style-tile grant, which is what actually moved the probe
(median S 0.089 → 0.189, achromatic 44.9% → 18.7%) and which P3 does not touch. So the ruling is not
violated by moderating the base-chroma adjective — provided both mechanisms stay intact and P3 does not
touch §5 or `forge.py`'s tile prose.

**The grey-drain worry does not survive the numbers.** `metrics-summary.md` line 6: grey share
(S<0.08) **LIKED 0.0942 vs NEW 0.0333**. The liked set is nearly 3× greyer than the current one.
Moderating base chroma moves *toward* the liked ground truth, and mean S 0.326 → 0.429 is the single
largest colour delta in the table. The clause that *actually* prevents grey-drain is the second half —
"any grey or neutral clearly TINTED WARM, so the frame never drains to greyscale" — which P3 keeps.
So the floor's protective function is retained by the half that isn't being cut. Good.

Two problems with the item as written:

1. **The added accent sentence is a new rule inside a LOCKED, always-injected block.** P3 adds
   *"strongest chroma sits on the shot's authored accent where the beat authors one"* to §2b. §2b is a
   **verbatim descriptor prepended to every generation** (`visual-grammar.md:17-18`), including
   environment/prop mints and cast-free plates with no accent at all — a per-shot conditional inside a
   fixed block is exactly the shape that gets discharged by the provider as "put something strongly
   chromatic somewhere". Combined with P2(c) removing the semantic scoping, this is two accent-loosening
   changes in one wave. **Edit: drop the added sentence.** The rule already exists where it belongs —
   `style-bible.md:159` (§4) and `visual-grammar.md:278` (§5).
2. **§2b is human-approved LOCKED text.** `style-bible.md:6-7`: *"**Every LOCKED value is
   human-approved** — every reference frame was generated against it, so `image-generation` proposes
   changes, never self-applies."* Every current reference frame — including the style tile the whole
   set inherits register from — was generated against FULL-cel. **Edit: P3 is a Daniel gate, and it
   invalidates the register of `refs/env/scene-style-tile.png` unless the tile is re-minted or
   explicitly ruled to stand.** The plan lists neither. The tile measures **mean S 0.407**
   (`r1-grayscale-analysis.md`); telling the head of the prompt "moderate base chroma" while the tile
   the frame is told to match sits at 0.407 puts the two voices in direct conflict on every cast-free
   gen.
3. **P3's real blast radius includes `forge.py`, which the plan does not list.** The tile grant exists
   in **two** places: `style-bible.md:174-177` and a hardcoded copy in `forge.py`'s `seed_roles_text`,
   which is the text that actually ships: *"match how strongly its flat fills are coloured and how warm
   or cool they are; lay THIS frame's own hues down at that same strength and temperature; **a frame
   drained to neutral grey has failed to take the register**"*, pinned by
   `test_forge_style_tile.py:272` (`assert "PALETTE SATURATION and TEMPERATURE" in text`). Leave it and
   §2b and the tile prose disagree on every plate; edit it and you are inside the mechanism that fixed
   Daniel's grayscale ruling. **Recommendation: leave `forge.py` and §5 untouched** (the tile keeps
   defending the floor) and accept that §2b alone carries the moderation — but say so in the plan, so
   the conflict is a decision rather than an oversight.
4. **The §2b pin is exact-equality against the live file.** `test_forge_style_tile.py:304-306` reads
   the real `style-bible.md`, extracts the §2b blockquote and asserts `style_only == ERA_STYLE_ONLY`,
   where the literal at `:48-54` contains "FULL cel strength", "every fill a real colour", "TINTED
   WARM" and "cools its LIGHT". P3 breaks that line (and `:330`, which asserts the assembled prompt
   starts with it). Two assertions in one file — again, not the two files the plan names.

**Exact edit:** replace `laid down at FULL cel strength — every fill a real colour` with
`laid down as opaque flat fills at moderate base chroma`; keep every following word unchanged; add
nothing; and route the change through Daniel with an explicit ruling on the style tile.

---

## P4 — visual-grammar §3: restore scale/distance signatures + one emergent-loss sentence + prop rule

**SHIP-WITH-EDIT.**

§3 today is `visual-grammar.md:249-260` — twelve lines, two bullets, no scale signatures. Restoring
"tiny under dominant mass" / "wide with air" is a genuine revert (deleted by `f73c7e44`, per codex Q1)
and is the cheapest thing in the plan.

Two findings:

1. **"Net ≈ 0" is not true.** The item adds three things (two restored signatures, one new sentence, one
   prop rule) to a section that contains no redundant prose to compress against. Read §3 and name the
   sentence being deleted, or state the item as net + (it is a small +, and justified — but goal 3 is a
   *stated* constraint and this is the second item claiming a flat net it does not have; see P7).
2. **The new sentence puts crowd-distance law in a second owner.** "a scale-argument beat populates the
   background plane — one deep scene with people at more than one distance, never a single populated
   plane against scenery" is a statement about **where people stand relative to the camera** — which is
   what `visual-grammar.md:185-187` (§2, crowd rear zone) already owns, and what P6 is simultaneously
   rewriting in a *third* place. See X-1.

**Exact edit:** keep the two restored signatures and the standalone-prop sentence in §3 (composition
owns framing and prop silhouette). Move the populated-background-plane sentence into §2 beside the
rear-zone clause at :185, where the crowd/plane law already lives, and cut it to the emergent half only
("people at more than one distance"), since "scale as argument (relative size)" is already row 13 of §1's
class table at :51.

---

## P5 — lint `spatial_tier_check` re-key

**KILL as specified. Replace with the narrow version below.**

I ran the plan's rule against all 246 shots in the live `shots.json`
(script: scratchpad copy of `lint_shots.py`'s own regexes, `_REAR_ZONE` verbatim, plus a deliberately
**generous** relative-scale-cue regex: small/smaller/tiny/distant/receding/recession/dwarfed/half the
height/reads smaller/background plane/rear plane/far plane/vanishing point/horizon).

| gate | HARD failures |
|---|---|
| current gate (`_BACKGROUND_CROWD` and no rear zone) | **0** of 72 crowd shots |
| P5 half 1 only — `figures.crowd: true` and no rear zone | **32** of 72 |
| P5 half 2 only — no relative-scale/plane cue | **63** of 72 |
| **P5 as written (both required)** | **67 of 72 crowd shots HARD-fail** |

`figures.crowd: true` appears on **72 of 246 shots**. The file's standing property — "lint 0 HARD",
the acceptance signal every shots.json commit in this run has claimed (`d680fdaa`, `573414b7`) —
goes to **67 HARD** on a file Daniel is not re-authoring (P9 touches 8). The plan's blast line says
only *"Makes the EXISTING era rear-zone clause enforceable"* and *"Net ≈ 0"*. That is not an honest
blast radius; the sibling forensics at least said "expect it to fail some existing shots".

Worse, the failures are not the bad shots:

- **L08, L09, L15 all HARD-fail** — the three shots `composition-crowd.md` grades **MATCH** and names
  as "the template" for crowd handling (§4: "Depth-staggered / background-layer crowds — MATCH: L08,
  L09, L15"). A gate whose first act is to fail its own exemplars is measuring the wrong thing.
- **L07 and L20 PASS the rear-zone half.** The plan claims the fix "would have hard-failed L02/L07 at
  authoring". It would not have failed L07: its prompt contains *"fistfuls of banknotes thrust **across
  the counter** from customers crowded three deep against it"*, and `_REAR_ZONE`
  (`lint_shots.py:1281-1286`) matches `across\s+(?:the\s+)?counter`. The phrase that stages the crowd
  **at** the counter is the phrase that satisfies the rear-zone test. Same for L20 ("across the
  counter") and L06 ("beyond … glass" — codex flagged exactly this at Q1). Only L02 fails.
  So half 1 under-catches the actual defects, and half 2 over-catches by 63/72.

**Undisclosed test breakage.** The plan names two pin tests (both for P2's suffix). P5 breaks a third
file it does not mention, `scripts/test_new_guards.py`:
- `:389 test_g9_named_leads_with_mass_crowd_are_silent` — prompt *"`brick-foreman` faces `qt-wiles`;
  the crowd waits behind the glass partition."* has rear geometry and **no scale cue** → asserts
  `hard == []`, would get 1 finding. **FAILS.**
- `:383 test_g9_individually_counted_anonymous_people_cannot_hide_in_crowd` — asserts `len(hard) == 1`,
  would get 2 (scale-cue + anon-individual). **FAILS.**

**Replacement (narrow, honest, and it actually catches the observed failures):** leave the gate keyed
off `figures.crowd: true`, drop `_BACKGROUND_CROWD`, keep **only** the rear-zone requirement, and fix
the real hole — the rear-zone vocabulary blesses proximity nouns. Remove `counter`, `table` and
`glass`-adjacency from `_REAR_ZONE` unless coupled to a distance/scale word, or add a **negative**
term: a crowd prose span containing `midground|foreground|pressed to|three deep|against the
counter|shoulder to shoulder with the camera` HARD-fails regardless of rear-zone vocabulary. That
fails L02/L06/L07/L20/L21 and leaves L08/L09/L15 silent — the opposite selectivity of the plan's
version. Measure it against the 246 before committing, and state the number in the plan.

---

## P6 — VPW Step 2 + critics.md: "reads smaller through intervening depth; a pane label is not distance"

**SHIP-WITH-EDIT.**

The rule itself is good and visually decidable. Two problems, both about **which document owns it**.

1. **It contradicts the owner it does not edit.** `visual-grammar.md:185-187` (§2, era text, the clause
   the whole plan is trying to make enforceable) states the rule *by example list*: "far side of the
   real table/shelving, **behind a divider, through a doorway**". P6's new sentence says a
   **pane/divider label alone is not distance**. After P6, §2 blesses "behind a divider" and VPW's step
   2 forbids it. Two live, contradictory statements of one rule.
2. **The machine gate encodes the old list.** `_REAR_ZONE` (`lint_shots.py:1281-1286`) is literally that
   example vocabulary — `glass|divider|partition|doorway|shelving|shelves|table|counter|barrier|window
   |corridor|rack`. Lint will keep passing exactly what P6's prose forbids.

**Exact edit:** make the change in `visual-grammar.md` §2 at :185-187 (the owner) — replace the example
list with the decidable rule — and let VPW `SKILL.md:96-98` and `critics.md` *cite* §2 rather than
restate it (VPW's line is already a near-verbatim copy of §2; that copy is the bloat to spend). Then
land the `_REAR_ZONE` tightening in the same commit as P5 so prose and machine agree.

---

## P7 — image-generation review rubric + `build_review_artifact.py`

**(a) SHIP-WITH-EDIT. (b) SHIP-WITH-EDIT — and it is an addition, not a merge.**

(a) The target is `image-generation/SKILL.md:419-421`, axis 3:

> …on-recipe per §5 **AND rich — committed scene palette, layered depth by overlap and scale (§5),
> light/atmosphere, filled edge-to-edge** — or is it slop: generic, cluttered, off-register, drifting to
> the detailed middle, **thin, sparse**?

The diagnosis is right (unscoped "filled edge-to-edge" false-passed L13). But the plan says *replace*
the test with "§3 framing/negative-space compliance", and that throws out the **anti-sparse** half of
the row, which is currently clean and is a reset-adjacent win: `rig-script-lettering.md` §3 measured
"Too-bland shots: 0. Noisy/cluttered shots: 0." Replacing a decidable phrase with a pointer to §3 —
a section P4 is rewriting in the same wave — makes the row *less* decidable and chases a moving target.

**Exact edit:** scope in place, do not replace. `filled edge-to-edge` → `environments filled
edge-to-edge; a standalone prop or artifact keeps its full silhouette and its air unless the crop is
the payload (visual-grammar §3)`. Keeps "thin, sparse" intact, is one clause, and matches
`style-bible.md:169` which already scopes edge-to-edge to environments.

(b) `build_review_artifact.py` has **no text-bearing review row to merge into**. `INVARIANTS`
(`:204-220`) holds `support-contact`, `relative-scale`, `crowd`, `flat-cel-hazard`, `line-register`,
`insertability`; the only text row is `place-owner`, built per shot in `applicable_invariants`
(`:275-280`) and fired **only** for a place's declared owner literal — not for arbitrary quoted
literals. So P7(b) is a **new** `INVARIANTS` entry plus a **new** predicate branch (a quoted-literal
detector; `_quotes_literal` exists and can be reused). That is fine and cheap — but it is net **+**,
and the plan's "Net ≈ 0" for P7 is wrong on both halves. State it honestly.

Scale check on the value: 2 of 25 shots carry lettering (`rig-script-lettering.md` §4), one of which
Daniel called too polished. A permanent forced row for a 1-in-25 taste axis is defensible only because
the row costs nothing at gen time — say that, rather than claiming a merge.

---

## P8 — delete the video-local `crowd-exemplar.png`

**KILL as specified. Replace with re-mint (or an explicit, recorded quarantine).**

The mechanism claim checks out: `forge.py:2119-2120` is
`crowd_ex = on_disk(lib/"crowd-exemplar.png") or reg_assets["crowd-exemplar"].file`, and the channel
entry resolves to `channels/the-second-take/visual-kit/refs/base/crowd-exemplar.png`, which exists and
is the human-gated 2026-07-16 poyais-era anchor. Fallback works. Everything else about this item is
wrong or undisclosed.

1. **The file is untracked and gitignored — the "fix" cannot land in a commit.**
   `orgs/faceless-youtube/.gitignore:13` = `channels/*/videos/*/assets/**`. `git ls-files --error-unmatch`
   on the exemplar: *"did not match any file(s) known to git"*. Deleting it is a local disk action in
   **this clone only**. It cannot be reviewed, merged, propagated, or reverted through git.
2. **The main checkout does not have the file at all.**
   `C:/Users/danie/kb/…/assets/library/crowd-exemplar.png` → *No such file or directory*. A run
   launched from the main checkout **already** falls back to the channel exemplar. So the "wrong
   standard" is a property of one working directory, and the fix's effect depends entirely on which
   checkout the next run uses — a fact the plan does not mention and which makes "Blast: all future
   crowd gens this video" false as stated.
3. **The tracked record already says the channel exemplar was used.**
   `assets/library/manifest.json` carries `{"name": "crowd-exemplar", … "file":
   "channels/the-second-take/visual-kit/refs/base/crowd-exemplar.png", "source": "reused",
   "notes": "Reused from the channel registry; no generation."}` — while `assets/scenes/manifest.json`
   records **11 shots seeded from `library/crowd-exemplar.png`** (L02, L03, L06, L07, L08, L09, L15,
   L16, L17, L20, L21) and exactly one (L46) from the channel file. The library ledger and the scene
   ledger disagree today. Deleting the pixels resolves the disagreement by destroying the only evidence
   of what actually seeded 11 verified frames.
4. **The causal claim is contradicted by the same manifest.** L08, L09 and L15 were seeded from the
   *same* 4.4-head-height exemplar and are the three shots `composition-crowd.md` grades **MATCH** on
   crowd handling. Codex reached the same conclusion independently (Q1: "the same exemplar route occurs
   on correctly rear-staged L08/L09/L15 as on L02/L06/L07 … forge/exemplar pull-forward is **not
   evidenced as the primary cause**"). And `rig-script-lettering.md` §1 grades the crowd rig
   **25/25 clean** against the canonical. The plan adopts one audit's proportion measurement as settled
   cause ("every crowd was faithfully executing a wrong standard") without noting that two of the four
   evidence documents contradict it.
5. **Deletion reintroduces the defect per-video minting was built to fix.** `style-bible.md:96-99`:
   the exemplar "is minted per video, so it carries **that video's era dress, head-tone set and hair
   silhouettes**"; `§3` makes era-appropriate dress a judged FAIL axis ("never the seed exemplar's
   period dress"). Falling back sends a **poyais-era** (1800s) crowd seed into a **1983** shopfront.
   The doctrine text would then describe a per-video mint that no longer exists — silent doctrine drift,
   and P8 explicitly says "No text change needed".
6. **It splits the video's crowd standard in half.** P9 regenerates 5 of the 11 local-exemplar shots.
   The other 6 (L03, L08, L09, L15, L16, L17) keep the old proportion; the 61 not-yet-rendered crowd
   shots get the new one. That is a visible within-video crowd inconsistency, on a channel whose whole
   crowd doctrine is "one exemplar pins proportion".
7. `visual-kit/_staging/` holds **four** `crowd-exemplar-remint-attempt*-fail.png` plus four reroll
   candidates — evidence that minting a compliant exemplar is hard and has failed repeatedly. The
   sibling forensics preferred **re-mint**, with delete only as "an immediate stopgap"; the plan kept
   the stopgap and dropped the re-mint without saying why.

**Replacement:** re-mint the per-video exemplar at the ~2.7 standard in 1983 dress and human-gate it at
Pass 1 (this is F5's own first choice). If that cannot be done this wave, move the file to
`_staging/crowd-exemplar-superseded-4.4.png` rather than deleting it, record the swap in
`assets/library/manifest.json`, and add one clause to `style-bible.md:96-99` saying a video's exemplar
is measured against the ~2.7 standard **before** it becomes the video's crowd authority — otherwise the
identical failure recurs on the next video that mints one. And whatever is decided, do it in the main
checkout too, since the two checkouts currently behave differently.

---

## P9 — scoped VPW re-pass of 5 crowd shots + 3 palettes, then regen 8

**SHIP (with an ordering constraint).**

Goal-4 objection does not land: the skill supports this natively. `visual-prompt-writer/SKILL.md:30-36`
defines **SCOPED-REPAIR mode** — *"request names specific shot ids AND `shots.json` already exists →
read the file and re-author ONLY those shots, everything else staying byte-identical … The target list
arrives from the caller … VPW never picks its own targets."* Eight named ids is exactly the supported
shape, and `:38` ("re-author, never substitute") forbids the bulk find/replace that would otherwise be
the temptation. No hand-editing required.

Three constraints the plan must state:

1. **Ordering.** Every doctrine item that changes what a *prompt must say* has to land first, or the
   re-pass writes prompts against superseded law: P1, P2, P3, P4, P6 before P9. P5 and P7 are gates,
   not authoring inputs — P5 must land **after** P9 or the re-pass runs into a 67-HARD lint (per
   SKILL.md:245 the author is told "every other HARD finding is a real defect, fixed now", which with
   the plan's P5 means 67 shots the wave did not budget for).
2. **P8 must be resolved before the regen**, not after: the 5 crowd shots are the only frames that will
   carry the new exemplar, and re-authoring them against one crowd standard then generating against
   another wastes the gen.
3. **The 8 shots are 3% of the file.** 72 shots declare crowd; 61 crowd shots are authored and
   unrendered under exactly the conventions P1/P4/P6 are changing. The plan should say plainly that
   Act 1 is being repaired and Acts 2–7 stay authored under the old convention until they are
   re-authored or regenerated — otherwise the next wave rediscovers the wall-of-heads at L110+.

---

## Cross-item findings

**X-1 — after P4 + P6, crowd-distance law has five owners.** Today: `visual-grammar.md:185-187` (§2),
VPW `SKILL.md:96-98` (near-verbatim copy of §2), `critics.md:78-84` + `:105`, `lint_shots.py`
`_REAR_ZONE`/`spatial_tier_check`, and `style-bible.md` §1/§2d for the tier. P4 adds a sixth statement
in `visual-grammar.md` §3 and P6 adds a seventh sentence to VPW Step 2 and critics — while editing
neither of the two existing statements. Goal 3 says "no duplicate functionality"; this wave increases
the count. **Named collision:** §2's "behind a divider, through a doorway" vs P6's "a pane/divider
label alone is not distance" — same rule, opposite verdicts, both live. Fix per P6 above: edit §2, cite
it everywhere else.

**X-2 — three accent/chroma changes stack in one wave with no measurement between them.** P2(c)
removes the semantic restriction on red; P3 moves "strongest chroma" onto the accent (as drafted);
P3 also lowers base chroma, which raises accent *relative* contrast. Each is individually arguable;
together they are an untested three-way change to the axis the owner cares most about, on a metric
(tight accent-red area) that is **already 2.7× the liked set**. Land P3 alone, regen the 8 shots,
re-measure loud-hue-bins and accent area, then decide P2(c).

**X-3 — no item states what "verified" means after the doctrine moves.** 25 shots are verified against
the current doctrine; P1/P2/P3 change what every gen receives. Either the wave states that the other
17 verified shots stay verified under grandfathering, or it accepts that the whole verified set is now
verified against superseded law. The plan is silent; the honest line belongs in the "Explicitly NOT
touched" section.

**X-4 — two items claim a flat net they do not have** (P4, P7). Not fatal, but goal 3 is a stated
constraint of this wave and the arithmetic should be real. True net across the plan as edited above:
P1 −, P2 −, P3 ≈0, P4 small +, P5 ≈0, P6 − (if §2 absorbs the copies), P7 +.

**X-5 — apportionment gap on the warmth fix, confirmed in the history.** `33676421` shipped the warm
re-lean as one bundle of three: (i) §2b "TINTED WARM / cools its LIGHT" (replacing `ea71f99e`'s "warm
**or cool**" licence), (ii) the suffix's "warm-biased", (iii) the style-tile grant expanded to
SATURATION **and TEMPERATURE** in both `style-bible.md` §5 and `forge.py`. Its own message calls it an
"11-item Daniel-approved fix list" and apportions nothing. The follow-up `224b204c` measured the bundle
as a whole (Pillow mean R−B: tile 65.19 → 88.15; L28 −12.4 → +42.2; L86 −1.4 → +40.2; L84 −25.2 →
−14.3 **parked**) and its `tile-verdicts.json` records only pass/fail badges. **No A/B anywhere
isolates suffix wording from §2b wording from the tile grant.** The doctrine review carried in
`33676421` itself even attributes most of the cool drift to a *re-authoring* commit (`eb901bb8`), not
to doctrine: *"Primarily re-author choice; weak doctrine permission, not a removed warmth rule."*
P2(b) as written deletes one of the three anyway. Any full deletion of "warm-biased" needs a one-plate
A/B first; the edited P2(b) above avoids needing one.

**X-6 — the plan misidentifies its own test blast radius, twice.** P2 names two pin tests, one of
which (`test_doctrine_reset_guards.py`) never reads the live kit and is unaffected. P3 says "§2b pin
tests" and the real pins are `test_forge_style_tile.py:304-306` and `:330`, plus the `forge.py`
tile-prose pin at `:272`. P5 names no tests and breaks `test_new_guards.py:383` and `:389`. A wave that
cannot state which assertions it breaks cannot claim "lint 0 HARD / tests green" as its exit condition.

---

## Goal-violation table

| Goal | Item | Violation | Severity |
|---|---|---|---|
| 1 (keep reset wins: vantage, 3-plane read) | P1 as worded | full-sentence revert deletes "from where the camera sees them" and the THREE-PLANE read | **HIGH** |
| 1 (keep reset wins: warmth tail) | P2(b) | deletes "warm-biased", one of today's three warmth mechanisms, with zero apportioning evidence | **HIGH** |
| 1 (rig fidelity / era dress) | P8 | fallback seeds poyais-era dress into a 1983 video; contradicts `style-bible.md:96-99` while claiming "no text change needed" | **HIGH** |
| 2 (revert-biased) | P2(c) | not a revert — a behavioural loosening justified by an exemplar that the rule already permits | MEDIUM |
| 2 / 5 (accent = per-beat option) | P2(c)+P3 | stack two accent-increasing changes on a metric already 2.7× the liked set | MEDIUM |
| 3 (no bloat, one owner) | P4, P6 | crowd-distance law gains 2 more owners; §2 (the owner) is never edited | MEDIUM |
| 3 (net flat-or-down) | P4, P7 | "Net ≈ 0" claimed for two net-positive items | LOW |
| 3 (no hyper-specific rules) | P3 as drafted | per-shot accent conditional inside a fixed always-injected block | MEDIUM |
| 4 (skill-produced shots) | — | P9 uses SCOPED-REPAIR; no violation | none |
| 5 (taste ground truth) | P5 | HARD-fails 67/72 crowd shots including the three MATCH exemplars; encodes the wrong selectivity | **HIGH** |
| governance | P3 | edits human-approved LOCKED §2b without naming the gate or the style-tile consequence | MEDIUM |
| 2 (revert-biased) | P2(c) | premise "the accent restriction is new" is false — the semantic-red law predates the repo (`c3c749d2`, 2026-07-15) and was live when the liked frames were made | **HIGH** |
| governance | P3 | edits the clause carrying Daniel's 2026-08-06 grayscale ruling without citing it | MEDIUM |
| honesty of blast radius | P2, P3, P5, P8 | undisclosed or wrong: 67 shots, the actual pin-test set (3 files, 5 assertions), `forge.py` tile prose, untracked/gitignored asset, main-checkout divergence | **HIGH** |

---

## Ordered implementation sequence (what survives)

Doctrine first, gates last, one measurement in the middle.

1. **P1 (edited)** — VPW rule 4: add standalone `framing + scale`, delete only the plane-ownership
   clause. No test impact.
2. **P2(a) + P2(b, edited)** — suffix: delete the environment recipe and the words `locked 2-3 colour`;
   keep `warm-biased scene palette`. Update `test_forge_style_tile.py:55-63` (`ERA_SUFFIX`, one
   assertion at `:308`) — **not** `test_doctrine_reset_guards.py`, which never reads the live kit — and
   re-copy the suffix verbatim into `shots.json` (runtime lint byte-equality,
   `lint_shots.py:1421-1475`).
3. **P3 (edited) — Daniel gate**, citing his 2026-08-06 ruling ("it can't be grayscale"). §2b chroma
   wording only; no added accent sentence; `style-bible.md` §5 and `forge.py`'s tile prose left
   untouched so the anti-grey mechanism keeps working; plus an explicit ruling on whether
   `refs/env/scene-style-tile.png` (mean S 0.407) is re-minted or stands. Update
   `test_forge_style_tile.py:48-54` (`ERA_STYLE_ONLY`, assertions `:304-306` and `:330`).
4. **P6 (edited) + P4 (edited)** — edit `visual-grammar.md` §2 (the one owner) for crowd distance;
   restore §3's scale signatures and the standalone-prop rule; VPW/critics cite rather than restate.
5. **P8 (replaced)** — re-mint the per-video crowd exemplar at ~2.7 in 1983 dress and gate it, or
   quarantine + record in `library/manifest.json`; add the "measure before it becomes authority" clause
   to `style-bible.md` §2d. Apply in the main checkout too.
6. **P9** — scoped VPW re-pass of the 8 named shots, then regen. Both the doctrine and the exemplar are
   now settled, so the gen is spent once.
7. **Measure** — re-run the colour metrics over the 8 new frames: mean S, warm-light share, loud hue
   bins, accent area, p10 R-B. This is the gate on P2(c), which is otherwise **not shipped**.
8. **P5 (replaced, narrow)** — rear-zone-only gate keyed off `figures.crowd`, `_REAR_ZONE` tightened
   against proximity nouns, negative-term fail for midground/pressed-to-camera prose. **Run it over all
   246 shots and put the failure count in the commit message before merging.** Fix
   `test_new_guards.py:383,389` deliberately, not incidentally.
9. **P7 (edited)** — scope the edge-to-edge clause in place; add the lettering-register row as a stated
   addition.

**Not shipped this wave:** P2(c).

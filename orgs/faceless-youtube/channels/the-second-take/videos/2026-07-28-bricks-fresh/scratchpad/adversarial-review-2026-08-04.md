# Adversarial review — bricks doctrine-reset design (2026-08-04)

Target: `orgs/faceless-youtube/docs/superpowers/specs/2026-08-04-bricks-doctrine-reset-design.md`.
Read-only review. Evidence base: `scratchpad/audit-drift-2026-08-04.md`, the superseded middle-path
spec, `scratchpad/vpw-log.md`, `knowledge/decisions.md` (tail), `forge.py`, `lint_shots.py`, both
SKILL.md files, `style-bible.md`, and the real 214-shot `shots.json` (measured, not sampled, where
numbers appear below).

---

## 1. Daniel's goal function, as verified against sources

1. **Fix the generator, never the artifact.** Root-cause the WHY; a defect is closed by changing
   skill logic/doctrine, not by re-touching a frame. Already law: image-generation `SKILL.md`
   ("After the single sanctioned content retry fails, STOP and root-cause VPW authoring →
   `shots.json` → exact Forge request before any new generation"). The spec honours this.
2. **Keep what proved good; revert what regressed.** KEEP: hardened flat-cel descriptor text
   (probe-proven, `decisions.md` 2026-08-04), NO rendered-scene style anchors ever, two-tier
   ≤2-named-cast law, digest pins, builder-owned slates, scoped retry overlays, three-state review
   stamps, lint hard checks. REVERT: seedless roots in established places, the style-text
   contradiction, bulk-substitution repair authoring (`vpw-log.md` Phase B3).
3. **Style is TEXT-ONLY and ONE voice. Place is PIXELS-ONLY and per-video** — fresh place-first
   plates (empty set, owner lettering authored once), whose content bleed inside their own place
   chain is the *desired* behaviour.
4. **Scratch the past bricks generated work; fresh VPW from `script.md` alone; generate in fifths
   with a board verdict gating each next fifth; a ~$0.30 style probe before any slice.**
5. **$0 doctrine changes land first, behind a human gate, before any paid call.**
6. **Skills stay GENERIC; per-video specifics are data in `shots.json` sourced from script
   vocabulary** (the literal `'MINISCRIBE'` is data, never a skill constant).
7. **Files slim, change core logic not bolt-ons, no dead info, cross-file consistency, no
   per-case special-casing when core logic can cover it.**
8. **(Verified but MISSING from the spec's model)** — `decisions.md` 2026-08-03, *Rig-review
   evidence standard: loosening RATIFIED*: "I don't need a super crazy review process for images,
   it just burns time and it doesn't catch shit. The goal was to change the actual writing and
   generation logic." Ordinary-viewing-scale judging, single review pass, DSG-lite on lettering
   shots only, `crop_battery.py` orphaned. This is part of the goal function and the spec's
   §Review-operationalization silently reverses it (finding **B4**).
9. **(Verified)** Spend law per lane, first-429 fail-fast, one precision retry, 4-min stall + one
   re-issue, per-lane genlogs — carried correctly by the spec.

---

## 2. Findings

Ranked BLOCKING (must be fixed before build starts) / MAJOR (fix before the gate Daniel signs) /
MINOR (fix in-flight).

### BLOCKING

#### B1 — The quarantine misses the actual STEP-1 store, so the reset reuses the drifted figures

**Evidence.** Spec §2 archives "`assets/scenes/`, `assets/_review/`, **video-local `_staging`
figures**, thumbs, old boards, old `shots.json`". There is no video-local `_staging`. The staged
STEP-1 frames live at **channel level**: `Kit.staging = os.path.join(self.kit, "_staging")`
(`forge.py:353`, kit = `channels/the-second-take/visual-kit`). Measured in the main checkout:
`visual-kit/_staging` holds **493 entries / 2.7 GB**, including every `fig-*` the audit condemns
(`fig-auditor-rep--action-powerstance--expr-deadpan*.png`, etc.).

`cmd_batch` reuses those by NAME before regenerating:
```python
reused = on_disk(os.path.join(lib, fn + ".png"), os.path.join(k.staging, fn + ".png"))
if reused: made[fn] = reused; why.append(f"`{c}` STEP-1 {fn} REUSED")   # forge.py:1256-1258
```
The reuse key is `fig-<char>--<pose>--<expr>` (`figure_frame_name`, `forge.py:494`), and the fresh
VPW will re-derive the same recipes from the same registry vocabulary.

**Failure scenario.** Doctrine lands, probe passes, fifth 1 fires — and `brick-foreman`'s scenes
silently re-seed the *pre-reset, polished, gradient-bearing* `fig-brick-foreman--*` PNGs that
audit §A names as the provider of 8 of the 10 defect scenes. The style probe would pass (a fresh
mint) while the run reproduces the exact drift. Audit mechanism 2 ("character-seeded roots still
receive smooth, shaded STEP-1 images") is then **not closed at all**.

**Amendment.** §2 must name `channels/the-second-take/visual-kit/_staging/` explicitly and
quarantine at minimum every `fig-*` for this video's cast (`brick-foreman`, `qt-wiles`,
`auditor-rep`, `hq-banker`, `miniscribe-rep`, `ibm-suit`, `terry-johnson`, `pc-boxy`) into
`_staging/_archive-pre-reset-2026-08-04/`, plus a stated rule: **no STEP-1 minted before the
unified descriptor may seed any scene in this run.** Add a forge dry-run assertion for the run:
every `fig-*` in the emitted slate must be `GENERATE`, never `REUSED`.

#### B2 — The place-plate law is inexpressible in the current data model

**Evidence.** Forge's notion of "place" is the *stage id*:
```python
place = shot.get("stage") or name                              # forge.py:1201
parent = place_last.get(place) if delta_beat else place_first.get(place)   # forge.py:1280
```
So a shot with no `stage` becomes its own place → `root_scene = True` → seedless. Measured on the
real file: **74 of 214 shots carry no `stage`** (`L89`, `L90`, `L91` among them — the exact
"independent roots, no held set" mechanism of audit §E4). Worse, `stage` is definitionally *not* a
place: `shots-schema.md:20` calls it "id shared by **consecutive** shots on ONE persistent set",
capped at **one base + ≤3 deltas + contiguity** (`shots-schema.md:59`, enforced HARD at
`lint_shots.py:308-314`). The MiniScribe office hosts ~28 stills (audit fix-list 3.7) — that is
≥7 stage chains, i.e. 7 different "places" to forge.

And the one existing plate-seeding mechanism is locked to stage bases:
```python
if (in_scope and shot.get("place_anchor") is not None
        and str(shot.get("stage_role", "")).lower() != "base"):
    raise SystemExit(f"{name}: `place_anchor` is only valid on a regenerated stage `base`.")
                                                              # forge.py:1202-1204
```
mirrored at `lint_shots.py:1162-1163`. A stage-less standalone shot in an established place — 74
of them — **cannot legally carry the plate at all**.

**Failure scenario.** The build worker implements "every scene in an established place seeds that
place's plate" against `stage`, and 74 shots keep running seedless exactly as they do today, while
the 140 staged ones get plates only at chain heads. L89/L90/L91-class failures survive the reset
untouched, and the reviewers report the doctrine as "landed".

**Amendment.** Add a first-class **`place`** key to `shots-schema.md` (a set identity: `miniscribe-
boardroom`, `brick-co-yard`), distinct from `stage` (a continuity chain within a place). Forge
derives the plate from *place-first*, not stage-first; `place_anchor` becomes legal on any
non-delta shot whose `place` is already established; lint mirrors both. The spec must name
`shots-schema.md` (it currently never does) and the lint/forge base-only restrictions it is
reversing.

#### B3 — `plate: true` is dead code, so plates cannot currently be minted or taste-batched

**Evidence.** `cmd_batch` never sets `plate` on any emitted item (grep: the key is only *read*),
but the plate-candidate path filters on it:
```python
plate_names = {i["name"] for i in spec if i.get("plate")}      # forge.py:1332 -> always empty
mixed = sorted(scope - plate_names)
if mixed: raise SystemExit("batch --plate-candidates scope must contain only emitted `plate:true` ...")
```
So `--plate-candidates` **hard-errors for every possible scope** today. The marker was removed with
the middle-path walk-back ("forge.py `plate:true → []` seed exception + root-shot auto-plate
marking", middle-path §Walk back 1) and its consumers were left behind — dead info, against
Daniel's rule 7.

**Failure scenario.** Spec §1 makes zero-seed legal "**only** for a new place-first plate", but
nothing marks a plate, so either (a) the exception is keyed to `root_scene` again and the law is
unchanged in substance, or (b) plates cannot be emitted and the whole place doctrine cannot run.

**Amendment.** Restore a `plate` marker as a *derived* property (first emitted shot of a `place`
with no cast → plate), key the zero-seed exception to it in `resolve_request_seeds`
(`forge.py:708-711`), and either fix or delete `--plate-candidates` in the same wave. Note the
plate-candidate feature also contradicts `decisions.md` 2026-08-03 R2 ("one candidate per place
going forward") — deleting it is the slimmer, Daniel-consistent option.

#### B4 — The review-operationalization section reverses a ratified Daniel ruling, without saying so

**Evidence.** Spec §1 *Review operationalization*: "Structured forced per-invariant verdicts …
New forced axes: support/contact, relative scale, semantic cast, place owner, flat-cel hazards …,
crowd scale/lead visibility … Review artifact embeds canonical-vs-candidate **side-by-side crops
per named figure** (existing crop scripts)." The "existing crop script" is
`.claude/skills/image-generation/scripts/crop_battery.py`, which `decisions.md` 2026-08-03
records as **orphaned by Daniel's own ratification**: "ordinary-viewing-scale judging, single
review pass, DSG-lite on lettering shots only; crop_battery.py orphaned … *I don't need a super
crazy review process for images, it just burns time and it doesn't catch shit.*"

Load arithmetic on the real file: 214 shots / 5 = ~43 frames per fifth; 105 shots carry ≥1 named
figure (measured: 83 one-cast + 22 two-cast). The existing procedure already demands a forced
PASS/FAIL on **each §3 invariant per seeded figure** (`image-generation/SKILL.md`, review axis 1)
plus fidelity plus style plus DSG-lite. Adding 6 more forced axes and a crop battery per named
figure puts a single fresh-eyes pass at several hundred forced rows per fifth.

**Failure scenario.** The audit's own root cause repeats: `review-3axis-2026-08-04.md` "did not
execute its own forced-per-invariant procedure and overruled genlog style warnings with broad PASS
sentences" (audit §Review-gate defect). A heavier procedure under the same time pressure collapses
into rubber-stamping again — and this time it also burns the reviewer budget Daniel explicitly
said he did not want spent.

**Amendment (the honest scaling mechanism).**
- Make the rows **machine-emitted, not human-typed**: extend `build_review_artifact.py` to
  pre-render one empty verdict row per (shot × applicable invariant), pre-filtered by what the shot
  actually declares — support/contact row only where a seated primitive is authored (13 shots),
  place-owner row only on institution-owned interiors, relative-scale row only on 2-cast shots
  (22), crowd row only where `figures.crowd` is true (56). Cost moves from typing to eye.
- **Crops only where a named figure is present** (105 shots), never per frame, and only at the
  ordinary-viewing-scale standard Daniel ratified — no zoomed crop battery.
- The spec must **name the reversal explicitly** and get Daniel's re-authorization at the doctrine
  gate; silently re-tightening a ruling he scratched is the same class of error as the drift.

#### B5 — "Pixels-only place" has no same-place enforcement, so the probe-refuted bleed is still authorable

**Evidence.** The probe ruling (`decisions.md` 2026-08-04) was decided by exactly this failure: "a
same-video verified scene as style seed bled catastrophically (G: L160's people/furniture/calendar
replaced the scene)". The spec's defence is that a plate is same-place, so bleed is desired. But
the only enforcement forge has is *same-video*:
```python
def place_anchor_for(video, anchor, root, name):   # forge.py:1141
    ...  return _video_scene_frame(video, os.path.join(video, anchor), root, name, "`place_anchor`")
def _video_scene_frame(...):                        # forge.py:1129-1138
    if not _inside_real(path, scenes): raise SystemExit(... "never a cross-video environment reference.")
```
Any verified frame in this video's `assets/scenes/` is accepted. Lint checks only the path shape
(`lint_shots.py:1147-1163`). Nothing binds the anchor to the shot's own place — the L160→L100
shape is still a legal authoring act.

**Failure scenario.** A repair round anchors a boardroom shot to a verified *warehouse* frame
"because it looked right", and the wave reproduces the catastrophic bleed the probe was run to
prevent — under a doctrine that claims to have prevented it.

**Amendment.** With `place` added (B2), make forge refuse a `place_anchor` whose source shot's
`place` differs from this shot's `place`, and mirror it in lint. State the invariant in one
sentence in the spec: *a plate may only seed shots in its own place; cross-place image seeding is
the probe-refuted style-anchor failure under another name.*

### MAJOR

#### M1 — The verified-asset-reuse gate has no record store, no writer, and no migration

Spec §1 *Forge gates*: "a staged STEP-1 is seedable only with a per-invariant review record pinned
to its canonical/expression SHA". No such record exists. `stamp_review.py` is, by its own
docstring, "the ONLY writer of the render gate's verdict" and writes `review_status` onto
`assets/scenes/manifest.json` — **scenes only**. Forge's existing verified-reuse check reads that
same scene manifest (`_scene_review_status`, `forge.py:1431-1443`; enforced for retry seeds at
`forge.py:1547-1550`). STEP-1 figures live in `visual-kit/_staging` with **no manifest of any
kind**.

*Failure scenario.* A build worker invents a private JSON shape, the review pass never writes it,
and the gate either never fires (dead code) or refuses every reuse — including on the other
channel's in-flight videos, since the skill is shared and their staged figures predate the record.

*Amendment.* Name the artifact and its writer in the spec: a per-figure record
(`visual-kit/_staging/review.json`, one entry per `fig-*` with `canonical_sha256`,
`expression_sha256`, per-invariant verdicts, reviewer, date), written by an extension of
`stamp_review.py` (never by a generating agent — keep the single-writer law). Gate behaviour on a
missing record: **refuse with the one-line remint command**, not grandfather. State that this run
starts with zero records by construction (B1), so nothing legacy is silently admitted.

#### M2 — The expression-delta gate duplicates existing machinery and must not break the retry path

Forge already refuses expression-defect scene retries and routes them to a STEP-1 remint
(`forge.py:1466-1471`), and `_EXPRESSION_RETRY` (`forge.py:1368-1371`) blocks expression words
inside a `replace` span (`forge.py:1474-1476`, `1489-1491`). The spec's new gate covers the
*authoring* side (L75's mechanism: a delta authoring a changed expression with no expression
seed), which is a real gap — but it must extend the existing delta path (`delta_primitives`,
`forge.py:1231-1247`; `seeding_law_violations`, `forge.py:629-665`), not add a parallel check with
its own refusal wording.

*Regression risk to protect.* A `defect: seed`/`mechanism` retry legitimately swaps a parent with
no primitive at all (`forge.py:1501-1553`); the new gate must not fire on it. Same for `no_hands`
personified objects, whose canonical *is* the rig (`forge.py:1223-1230`).

#### M3 — SEED_CAP has zero headroom under a mandatory plate (measured)

`SEED_CAP = 4` (`forge.py:430`). Recomputing every shot in the real file as `named cast + 1 plate
+ crowd + tagged prop/env`:

- **1 shot already breaks**: `L30` = 2 cast + crowd + 1 prop + plate = **5** → hard error
  ("restage the shot (fewer cast) rather than drop a seed", `forge.py:610-613`).
- **15 shots land at exactly 4** — zero slack.
- Adding the M2 expression primitive to a delta breaks **L101** (4 → 5).

Today's numbers are small only because the *current* authoring has no plates and thin props; the
fresh author is being told to add plates, support objects, owner cues and richer sets, all of which
consume slots. The spec never states a cap policy.

*Amendment.* State the displacement rule in the spec so the author does not discover it at
dry-run: **the plate outranks the crowd exemplar when the plate already contains the rear-zone
mass** (the crowd's pixels are in the plate), and a shot that still exceeds 4 is restaged (fewer
named cast), never truncated. Add the arithmetic as a worked example in the VPW SKILL.

#### M4 — "One plate per place" is wasteful and unpriced for single-use places

Spec §1: "enumerate the script's places, one plate per place". A place used by exactly one shot
pays a full 2K scene call ($0.134) for a plate whose only consumer is that one shot — and that
shot *is* the place-first frame, which is precisely the case the probe proved can run seedless.

*Amendment.* Make the law conditional, stated once: **a plate is required when a place hosts ≥2
shots, or when the place carries owner branding that must be carried character-for-character under
L-1. A single-use, unbranded place is its own place-first frame and runs seedless under the
hardened descriptor.** This also removes the unnecessary half of the probe-ruling reversal (§3).

#### M5 — Outdoor / symbolic / insert shots have no "place"; the blanket law forces nonsense plates

Measured: **109 of 214 shots have zero named cast** — prop inserts, symbolic beats, maps, cash
stacks, yard exteriors (`shipping-map`, `cash-stack`, `brick-co-yard`). The spec's law reads
unconditionally ("every scene in an established place seeds that place's plate") and never says
what a place *is*.

*Amendment.* Define it: **a place is a recurring diegetic set (interior or bounded exterior).
Symbolic, abstract and standalone object-insert shot classes declare no place and run as seedless
roots under the hardened descriptor** — the probe-proven path. Bind the definition to
`shot_class`, which already exists and is lint-checked (`shot_class_check`, `lint_shots.py:1055`).

#### M6 — Budget of record is ambiguous, and the per-fifth figure is ~30% low

`decisions.md` 2026-08-04 records a **wave cap of $30**, of which the audit says ~$24 is already
spent. Spec §4 says "~$30–40 all-in, ~$7–8/fifth" and "Budget pacing: deliberately deferred".
Measured floor for a full fresh run at the audit's own unit costs (2K scene $0.134, 1K STEP-1
$0.039):

| item | count | cost |
|---|---:|---:|
| ai-gen scenes (every shot is `source: ai-gen`) | 214 | $28.68 |
| unique STEP-1 recipes (fresh, non-delta shots) | 52 | $2.03 |
| place plates (est. 20–30 new) | ~25 | $3.35 |
| one sanctioned retry on ~15% of frames | ~32 | $4.29 |
| **total** | | **~$38.4** |

That is **~$7.7/fifth with zero retries, ~$8.6/fifth realistically** — the spec's "$7–8/fifth" is
the no-retry, no-plate number.

*Amendment.* Even with pacing deferred, the spec must state which cap is of record and log the
supersession in `decisions.md`; then derive the per-lane plan-gate table (operating-law §D) from
the authored `shots.json`, not from a rough shape. Otherwise the first lane's gate table
contradicts the standing $30 cap and the run stalls at a governance check.

#### M7 — Author-everything-then-gate has no re-lint / re-author path

Spec §4 authors the complete `shots.json` once, then gates in fifths. A doctrine flaw found at
fifth 2 invalidates the authoring of fifths 3–5, and the spec is silent on what happens.

The cheap path already exists mechanically: lint is $0, and `batch --shots` is *a filter over the
whole-file walk*, not a second path — "The walk still visits every shot, because stage chains and
place-first plates are only correct when the whole file is read" (`forge.py:1176-1179`), with
out-of-scope seeding-law violations reported rather than raised (`forge.py:1321-1324`).

*Amendment.* Add one clause to §4: **after every fifth's verdict, re-run lint + forge dry-run over
the whole file; any doctrine amendment forces a re-author of the untouched tail, shot-by-shot from
each shot's own VO line (never bulk substitution — §Process law), and the fifth's genlog records
which ids were re-authored and why.**

#### M8 — The style-vocabulary contradiction check will false-positive on ~70 real shots

Spec §1: "`lint_shots.py` hard-fails prompts/suffix carrying style vocabulary contradicting the
bible." Measured over the real 214 `still_prompt`s: `warm` 56, `glow` 17,
`shine|sheen|gloss|polished|reflect*` 14, `soft` 6, `blur*` 3. Most are legitimate scene lighting
("warm lamp amber"); a few are true violations — `L89` literally authors "The rest of the cabinet
**sits blurred** behind him", contradicting `HARDENED_SCENE_STYLE`'s "NO depth-of-field blur"
(`forge.py:332-337`).

*Amendment.* Split the check. **(a) HARD, one voice**: `global_prompt_suffix` and the style-bible
descriptor blocks must not carry soft/gradient-permissive wording — the audit's actual mechanism 1,
a two-string check. **(b) HARD, narrow render-technique ban in prompts**, with the exact list
written into the spec so the build worker cannot invent it: `gradient`, `gloss`/`glossy`,
`specular`, `bloom`, `depth-of-field`, `blurred background`/`blurred behind`, `soft focus`,
`photoreal*`, `subsurface`, `rim light`. **(c) Never** flag scene-light nouns (`warm`, `amber`,
`lamp glow`, `lit`). Anything beyond that list is the reviewer's style axis.

#### M9 — The seat/support check keyed on English "sit" is a false-positive machine

Measured: **45 shots contain "sits"; only 13 author the registry `sit` primitive.** The verb is
overwhelmingly used of objects: "the metal desk **sits** pushed aside stage-left" (L35), "a single
clay brick … **sits** on its end" (L25), "the rest of the cabinet **sits** blurred" (L89), "the
beige computer … **sits** half-buried" (L06). A prose-keyed hard check blocks ~32 correct shots on
day one and teaches the author to route around lint.

*Amendment.* Key the check on the **registry primitive bound to a named character** — already
mechanically decidable by the binding rule forge uses (`shot_cast`, `forge.py:479-491`): a named
figure carrying a seated pose primitive must name a support object from a closed noun list
(`chair|stool|bench|seat|crate|step|ledge|desk edge|sill`) **and** a contact phrase in the same
sentence. Framing ("shows enough of it") is not lint-decidable — soft heads-up plus a forced review
row. This matches the audit's real mechanism: round-2 mechanically swapped kneeling/crouching prose
for `sit` with no support (`vpw-log.md` Round 2, L89–L90).

#### M10 — Two-cast plane/scale and action-chain checks are not HARD-lintable as specified

The spec files all four feasibility rules under "**Authoring feasibility (lint, hard)**". Two are
not mechanically decidable:
- *Two-cast plane/scale*: a regex proves a phrase exists, not that it is coherent. The audit's own
  L66 diagnosis is that the clauses present ("points across a long … table", "management section …
  rear chairs") *implied* the wrong topology — boilerplate satisfies any keyword check (Goodhart).
- *Action-chain*: "the critic judges cause→effect, not noun presence" — correct, but the section
  header says lint/hard.

*Amendment.* Split each rule honestly: **HARD lint = presence/omission** (a 2-cast shot must state
plane + eye line + relative scale; consecutive VO actions on the same props must carry
`stage`/`stage_role` or an explicit hard-cut declaration — cheap, and exactly the omissions the
audit found). **Critic = judgment**, as a named forced question in
`visual-prompt-writer/references/critics.md` (which the spec never mentions). `lint_shots.py`
already documents this boundary for itself (`lint_shots.py:1195-1201`) — follow that precedent
rather than overreaching past it.

#### M11 — The semantic-cast gate over-fires unless narrowed

Audit fix-list item 6 proposes comparing `vo_text` role nouns with cast declarations. L100's VO
says "managers" while the shot declares `qt-wiles` — but plenty of legitimate shots have a named
lead who *is* one of the narrated group ("the foreman told his crew…").

*Amendment.* HARD-fail only the decidable case: **a shot whose `vo_text` names a generic plural
role AND declares a named character whose name/role appears nowhere in that VO span or its ±1
neighbours**. Everything else goes to the critic. Cite the mechanism in the rule's docstring
(`vpw-log.md` Phase B3 bulk generic→named conversion) so a future author cannot re-argue it.

#### M12 — "Fifths" contradicts the skill's act-batch law

`image-generation/SKILL.md` §Reviewing the run: "Pass 2 runs in **2–4 contiguous act batches
snapped to stage boundaries** (a held stage never splits)". The spec mandates **fifths** and never
amends the skill.

*Amendment.* Amend `SKILL.md` in the same $0 wave: the batch count is set by the run's gate cadence
(Daniel's board verdict), with the boundary rule preserved — **a slice boundary must fall on a
stage boundary; a held stage never splits.** With 214 shots and ≤4-frame chains that is always
satisfiable. Leaving both texts live is exactly the cross-file contradiction that produced
mechanism 1.

#### M13 — The archive path escapes `.gitignore` and turns 1.8 GB of binaries into tracked files

`orgs/faceless-youtube/.gitignore:13` ignores `channels/*/videos/*/assets/**` (contents only). Spec
§2 archives to `videos/2026-07-28-bricks-fresh/_archive-pre-reset/` — **outside `assets/`** — so
216 scene PNGs + thumbs + boards (measured: `assets/` = **1.8 GB**) become
untracked-but-not-ignored the moment they move, and the next `git add -A` commits them.

*Amendment.* Archive to `assets/_archive-pre-reset/` (stays ignored, evidence still on disk), or
add an explicit ignore line in the same commit. The spec must say which.

#### M14 — Quarantine tree ≠ run tree (worktree vs main checkout)

The artifacts being quarantined exist **only in the main checkout** (`C:/Users/danie/kb`), because
they are gitignored binaries: measured, `kb-worktrees/boss-bricks-reset` has **no
`assets/scenes/`, no `assets/thumbs/`, no `visual-kit/_staging/`, no `vo.mp3`**, while the main
checkout has all four. Spec §Execution routing pins the work to the worktree; §2 orders the
quarantine without naming a tree.

*Failure scenario.* The quarantine "runs" in the worktree and archives nothing; the drifted
`_staging` survives in the main checkout (B1); and the run tree cannot build a board or preview
render because `vo.mp3` is not there.

*Amendment.* State it: **doctrine/code changes land in the worktree; the quarantine executes in the
main checkout; the generation run executes in the tree that holds `visual-kit/refs`, a clean
`_staging`, and `vo.mp3`** — naming which tree that is, plus the `vo.mp3` copy step.

#### M15 — Plates cannot be minted and consumed inside one lane

`place_anchor_for` resolves only an **existing file inside `assets/scenes/`**
(`forge.py:1129-1138`, `1141-1153`) — not a staged frame, not a frame pending later in the same
batch (contrast `resolve_request_seeds`'s `pending` mechanism, `forge.py:695-724`). So a plate must
be generated, reviewed, stamped and promoted to `assets/scenes/` **before** any shot that anchors
to it can even be batched.

*Amendment.* §4 must show the real intra-fifth shape: **lane 1 = that fifth's new plates → human
plate verdict → promote → lane 2 = the fifth's scenes → review → board → Daniel's verdict.** As
written ("gen lanes → review → board → verdict") a build worker will try one lane and hit a hard
error after paying for the plates.

#### M16 — The quarantine must not take `assets/library/manifest.json` with it

Spec §2 lists what moves (`assets/scenes/`, `assets/_review/`, `_staging` figures, thumbs, boards,
old `shots.json`) and what stays (`script.md`, `vo.mp3` + manifest, `research.md`, channel refs).
It never mentions `assets/library/manifest.json` — the video's **Pass-1 cast library** (measured:
46 assets, including the identity entries for `brick-foreman`, `qt-wiles`, `auditor-rep`,
`hq-banker`). `merge_vocabulary` reads exactly that file (`forge.py:451-466`), and its docstring
records what happens without it: "L45 and L60 assembled with zero seeds for their named leads and
preflight reported them clean. **A validator that shares the generator's blind spot is worse than
no validator, because it certifies.**"

*Amendment.* Add one line to §2: `assets/library/manifest.json` stays live (it is Pass-1 identity
data, not generated output). If the fresh author changes the cast, Pass 1 re-runs — it is never
deleted as part of the reset.

### MINOR

- **m1 — Unnamed files that must change.** The spec never names
  `visual-prompt-writer/references/shots-schema.md` (the `place` key, the plate law, the lettering
  escape) or `references/critics.md` (the judgment half of M10/M11). Both are load-bearing for the
  design as written; name them so the build workers do not each guess a home.
- **m2 — Owner-literal data source.** §1's place-owner rule is correct to keep `'MINISCRIBE'` as
  data. Say where the data comes from: the shot's own `place` declaration plus `script_vocab`
  (`lint_shots.py:790`), which already exempts script vocabulary from the long-literal warning and
  already names `MINISCRIBE` as its example. Also cross-reference `carried_literal_check`
  (`lint_shots.py:957`) — that is the existing L-1 carry mechanism the plate-inherited lettering
  must register with, and the spec does not mention it.
- **m3 — Probe design is under-powered for what it must decide.** Three frames (plate + STEP-1 +
  one composed scene) test one place and one figure. The question that matters is whether flatness
  holds **across content classes**, not across seeds of one prompt. Minimal honest design at the
  same order of cost (~$0.40): one plate, one STEP-1, and **three composed frames — a figure-bearing
  interior, a crowd frame, and a prop insert**. Record the assembled prompt (`gen --dry-run` prints
  it) and pin those exact descriptor bytes in `decisions.md`, so a later text edit is detectable as
  a regression rather than argued about.
- **m4 — No stop rule.** §4 says Daniel's verdict gates the *next* fifth but never says what a
  failed fifth 1 means. Add: **a style failure in fifth 1 stops the run and reopens doctrine; no
  further paid call is made until a new $0 gate passes.** Without it, "one precision retry" becomes
  the de-facto response to a systemic failure — the exact behaviour the audit condemns.
- **m5 — Scene manifest "reset" must be a rewrite, not a delete.** §2 says "Scene manifest reset".
  `decisions.md` (preview-parked entry) records that `render.py` **treats an absent manifest as no
  gate** — deleting it silently disables the render gate for every shot. Reset means writing
  `{"shots": []}`, never `rm`.
- **m6 — Thumbnail ownership is unassigned.** `shots.json` carries a `thumbnail` block, and forge
  deliberately excludes it from `batch` ("out of scope — it carries its own authored seeds +
  gen_prompt", `forge.py:1329-1330`). The fifths plan never says who re-authors or generates it, or
  which fifth pays for it.
- **m7 — Dead info left behind.** Rule 7 (files slim, no dead info) implies the superseded
  middle-path spec should be marked SUPERSEDED in-file in this wave, and `plate:true` /
  `--plate-candidates` (B3) either fixed or deleted. The spec says neither.
- **m8 — "Subsumed" is doing too much work.** §Out of scope drops "the >L101 deferred-slice and
  tranche-E word-sync items … (subsumed by the fresh authoring)". Visual re-authoring does not
  subsume **word-sync**: that is a render-timing property checked against the *unchanged*
  `voiceover.manifest.json` (`lint_shots.py:1301-1305`, `1336-1339`). Add an explicit acceptance
  line: the fresh `shots.json` must lint clean on `vo_ref` anchors and word timings against the
  existing VO before any generation.

---

## 3. Completeness: do the fixes close the audit and Daniel's nine?

### The 5 audit mechanisms

| # | Mechanism | Status under the spec |
|---|---|---|
| 1 | Contradictory style text (bible + suffix vs `HARDENED_SCENE_STYLE`) | **CLOSED** in substance; workability risk M8 |
| 2 | Character-seeded roots receive already-drifted STEP-1 pixels | **HALF-CLOSED → broken by B1.** The spec's only lever is quarantine + remint-in-slice, and the quarantine misses the real store; forge will silently REUSE. Closed once B1 lands |
| 3 | VPW authored actions without support, identity without place ownership, cast that changes narration | **HALF-CLOSED.** Rules are right; two of the four are not HARD-lintable as written (M10, M11) and one false-positives (M9) |
| 4 | Forge treats an on-disk staged STEP-1 as reusable despite a missed invariant | **HALF-CLOSED.** The gate is specified but has no record store, no writer, no migration (M1) |
| 5 | The review did not execute its own forced-per-invariant procedure | **NOT CLOSED — arguably worsened.** The procedure already demanded forced per-invariant verdicts (`image-generation/SKILL.md` axis 1); the failure was **non-execution under load**. Adding six axes and a crop battery increases the load that caused it (B4). Closes only with machine-emitted rows + scoped crops |

### Daniel's nine confirmed failures

| # | Failure | Status |
|---|---|---|
| 1 | L66–68 co-star miniaturization | Half — presence lint + critic + review axis; depends on M10 split |
| 2 | Seated figures with no support | Closed **if** M9 (key on the primitive, not the verb) |
| 3 | L75 full eye circles | Closed (expression-delta gate + remint), pending M2 wiring |
| 4 | L89–91 narrative nonsense | Half — needs the `place` model (B2); with `stage`-only semantics these three shots stay independent seedless roots |
| 5 | L93 off-rig face | Half — depends on the verified-asset record store (M1) |
| 6 | Office ownership invisible | Closed structurally; needs the owner-literal data source + L-1 carry wiring (m2) |
| 7 | L100–101 wrong cast | Closed **if** M11 narrowed; the §Process law (no bulk substitution) is the right root-cause fix |
| 8 | Auditor STEP-1s vs canonical | Half — same record-store gap as #5 (M1) |
| 9 | Global smooth/glossy drift | Closed pending B1 (drifted seeds) + M8 (check scoping) |

**Net: 1 of 5 mechanisms and 2 of 9 failures are fully closed as written.** Everything else is
half-closed on a named, fixable gap — the design's *direction* is right; its *closure* is not yet
proven.

---

## 4. Internal contradictions, and the KEEP-list conflicts

- **C1 — The seedless-root reversal is partly a reversal of a probe-decided ruling, and the spec
  does not admit it.** `decisions.md` 2026-08-04 says, unqualified: "root scenes may run seedless
  again." The spec narrows that to "zero-seed legal **only** for a new place-first plate". The
  narrowing is **evidence-backed** — audit §A shows L89/L90 as two independent roots off the same
  STEP-1 producing no held set and an invented bench — but it is a reversal and must be logged as
  one in `decisions.md`, with the distinction that makes both rulings true: *cross-place image
  seeding bleeds content (refuted); within-place plate seeding bleeds the set, which is the point.*
  As written the reversal is **over-scoped** (M4, M5): it also bans the seedless path for
  single-use places and symbolic inserts, where the probe's evidence still stands and the plate is
  pure waste. Scope it, and the contradiction disappears.
- **C2 — "NO rendered-scene style anchors ever" vs. plates.** A plate is a rendered frame used as a
  seed. The doctrine survives only if "same place" is *enforced*, and it is not (**B5**).
- **C3 — "KEEP lint hard checks" vs. the new hard checks.** Two of the four new checks
  false-positive at scale (M8: ~70 shots; M9: ~32 shots). A lint that cries wolf gets routed around
  — which erodes the very KEEP it is filed under.
- **C4 — Review operationalization vs. the 2026-08-03 ratified loosening (B4).** Direct conflict
  with a Daniel ruling, unacknowledged.
- **C5 — Fifths vs. the skill's 2–4 act batches snapped to stage boundaries (M12).**
- **C6 — "Fresh VPW authors from `script.md` alone" vs. the archived `shots.json` sitting on disk.**
  Nothing forbids reading it. State the ban explicitly, or the drifted authoring returns by copy —
  this is how B3's bulk-substitution regression happened in the first place (`vpw-log.md` Phase B3).

---

## 5. Regression risk of the new gates themselves

The three forge gates are written as global laws in a **shared** skill. Each one has legitimate
traffic it must not block. The spec must carve these out by name, because a build worker
implementing the sentence as written will break them:

1. **Thumbnail generation.** The thumbnail is deliberately outside `batch` and "carries its own
   authored seeds + gen_prompt" (`forge.py:1329-1330`). A verified-asset-reuse gate applied at
   `resolve_request_seeds`/preflight level will refuse a thumbnail that seeds a staged figure.
   Carve-out: the gate applies to `batch`-emitted scene slates.
2. **Shorts `first_frame`.** Lint already runs `place_anchor_check` over `first_frame` objects
   (`lint_shots.py:1409-1410`); a 9:16 first frame has no `stage` and would have no `place`. A
   mandatory-place law must exempt `first_frame` and short shots, or every short hard-fails lint.
3. **Motion-planner plates and cutouts.** `SKILL.md` §Layered shots: the plate is "the scene MINUS
   the moved element", cutouts are "**always seeded**" from the layer `seed` → canonical →
   destination plate, and are generated on a magenta chroma field. A parent-provenance gate that
   refuses any child of a defective parent must not be read as refusing a cutout whose parent is
   the *same shot's* plate; and the "no image only for style" rule there must not be confused with
   the new place-plate law (different plate, same word — say so explicitly).
4. **Surgical retry overlays.** `RETRY_OVERLAY_SCHEMA@2` `defect: seed`/`mechanism` retries
   intentionally re-order or replace seeds with **no** content change and **no** primitive
   (`forge.py:1501-1553`). The expression-delta gate must not fire on them (M2), and the
   parent-provenance gate must not collide with the existing verified-parent check at
   `forge.py:1547-1550` (two refusals for one condition = the author cannot tell which law they hit).
5. **`no_hands` personified objects** (`pc-boxy`): canonical *is* the rig, no pose primitive exists
   (`forge.py:1223-1230`, `667-670`). An expression-delta gate demanding an expression primitive
   must honour that exemption and `assets_omitted`.
6. **Render/compliance gates.** `--preview-parked` semantics, `state: "preview-parked-included"`,
   and the three-state stamp are load-bearing for Gate-3 (`decisions.md`). Nothing in this wave may
   touch them; adding review axes must not change the `merged.json` → `stamp_review.py` contract
   shape (axes `f`/`s`/`r` + `dsg`), or the stamper silently stops parking defects.

---

## 6. Changes to NOT make (hand this list to every build worker)

Probe-decided, Daniel-ruled, or contract-bearing. Touching any of these is out of scope for this
wave, no matter how tempting the "improvement":

1. **No image style anchors, ever** — no style card, no swatch card, no value-register cards, no
   rendered scene as a style seed. Probe-refuted (`decisions.md` 2026-08-04; middle-path §Add 5 is
   superseded by it).
2. **Two-tier cast law** — ≤2 named cast per frame; `anon_foreground` stays abolished
   (`forge.py:602-606`, `FIGURES_KEYS` in `lint_shots.py:1143`). Do not reintroduce a third tier.
3. **Seed integrity + staging locks** — `seed_sha256`, `SeedIntegrityError`,
   `verify_request_seed_digests`, `_reserve_staging_output`/`_reclaimable_staging_lock`. Do not
   relax digest pins to make a new gate easier.
4. **Builder-owned slates** — `cmd_batch` is the only slate author; hand-written specs may not
   bypass role truth (`seed_role_violations`, `forge.py:540-590`).
5. **Three-state honest stamp** — `stamp_review.py` is the ONLY writer; generating agents never
   stamp; never write `verified: true`; `parked` stays non-shippable.
6. **`--preview-parked` semantics** and `state: "preview-parked-included"` (fails Gate-3 by
   construction). Preview writes only `preview*` siblings.
7. **One-retry-then-root-cause law** and `RETRY_OVERLAY_SCHEMA@2` surgical authority (exactly one
   `replace` **or** one seed/mechanism change, never both, never additive `instruction`).
8. **Cutout/magenta-chroma contract, layered-shot plate/cutout layout, render handoff**
   (`render-builder` consumes `assets/scenes/` directly; a missing scene for an ai-gen shot is a
   render-time hard error).
9. **Voiceover manifest, `vo_ref` anchor contract, word-timing lint** — `script.md` and the VO are
   fixed inputs to this wave. Do not "improve" the script to fit a shot.
10. **Registry promotion rule** — a video's own cast never reaches `registry/registry.json`
    (`Kit.use_video`, `forge.py:373-379`).
11. **Scale anchors / forced perspective / foreground-props scale recipe** — removed twice by
    Daniel (middle-path §Walk back 3; `decisions.md` 2026-08-03). Do not re-derive a composition
    workaround into doctrine.
12. **The ratified review loosening** — ordinary-viewing-scale judging, single fresh-eyes pass,
    DSG-lite scoped to lettering shots, no crop battery — unless Daniel re-authorizes it explicitly
    at the doctrine gate (B4).
13. **No video-wide palette lock**; per-scene committed palettes within one channel colour family
    (middle-path §Walk back 2, §Add 8).
14. **No per-video literal in any skill** — `'MINISCRIBE'` lives in `shots.json`, sourced from
    script vocabulary.
15. **`assets/library/manifest.json` stays live** (M16) — it is Pass-1 identity data, not output.
16. **`script.md`, `research.md`, `vo.mp3`, `voiceover.manifest.json`, channel `visual-kit/refs/`**
    — untouched by the quarantine.

---

## 7. Missing — implied by Daniel's goal function, covered by neither audit nor spec

1. **A named acceptance artifact for the $0 doctrine gate.** "$0 changes land first behind a human
   gate" — but what does Daniel look at? Propose: the diff summary **plus a free lint run of the new
   hard checks over the ARCHIVED `shots.json`**, reporting how many ids each new check fires on.
   That is the only cheap way to prove M8/M9/M10/M11 are calibrated against real prose *before*
   authoring 214 shots against them. It costs nothing and would have caught the false-positive rates
   measured in this review.
2. **A ban on reading the archived `shots.json` during fresh authoring** (C6).
3. **A place-inventory verification step**: every `place` the author declares must map to a span in
   `script.md` (`script_vocab`, `lint_shots.py:790`) — otherwise the "places" are invented, which is
   the same class of error as invented lettering.
4. **A no-reuse assertion for the run**: the fifth-1 dry-run must show every `fig-*` as `GENERATE`,
   never `REUSED` (the machine-checkable form of B1).
5. **Decision-log entries planned for two reversals** — the seedless-root narrowing (C1) and the
   review-standard change (B4). `decisions.md` is the record of what was probe-decided; a reversal
   that is not logged there will be re-argued in three weeks.
6. **A statement of what the fresh run is expected to cost in *human* review time** — Daniel's
   2026-08-03 ruling was fundamentally about his and the fleet's time, not correctness. Five gated
   boards of ~43 frames each is the real ask; it should be on the page he signs.

---

## 8. Verdict

**AMEND-THEN-SHIP.**

The design's diagnosis and direction are right, and its two hardest calls — style is text-only with
one voice, place is pixels-only per video — are correctly derived from the probe evidence rather
than from nostalgia for the tranche-A era. The keep/revert list matches what the audit actually
proves. But as written the spec does not yet close what it claims to close: **one of five audit
mechanisms and two of nine confirmed failures are fully closed**, the place doctrine is
inexpressible in the current data model (`place` ≠ `stage`, `place_anchor` is base-only, `plate` is
dead code), the quarantine misses the channel-level `_staging` store that actually supplied eight of
the ten defect scenes, the probe-refuted cross-place bleed is still an authorable act, and the
review section silently reverses a ruling Daniel ratified 24 hours earlier while adding load to the
one step whose documented failure mode is collapse under load. None of these is fatal — every one
has a concrete, cheap, $0 amendment above, and all of them belong in the doctrine wave that is
already scheduled to land before the first paid call. Fix B1–B5 and M1–M5 before any build worker is
dispatched; fix M6–M16 before Daniel signs the doctrine gate; treat the MINORs as in-flight
corrections. Do **not** fire the style probe until B1 is closed, because a probe that passes on a
fresh mint while the run silently reuses 493 pre-reset staged figures is worse than no probe: it
certifies.

**Counts:** 5 BLOCKING · 16 MAJOR · 8 MINOR.

**Single worst finding:** **B1** — the quarantine names a "video-local `_staging`" that does not
exist, while the real STEP-1 store is `channels/the-second-take/visual-kit/_staging` (493 files,
2.7 GB) and `cmd_batch` reuses those figures **by name** before regenerating (`forge.py:1256`). Left
as written, the entire reset regenerates the video from the same drifted, gradient-bearing figure
seeds that caused the drift — and every gate in the spec would report it clean.

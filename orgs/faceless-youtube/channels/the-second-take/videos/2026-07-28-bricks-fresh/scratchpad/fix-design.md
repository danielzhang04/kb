# Fix design r3 — bricks-fresh board verdict → THE routed fix list (2026-07-30)

**r3 changelog (2026-07-30):** two-step character seeding folded in per the probe WIN
(`scratchpad/twostep-probe/results.md`) — the existing seeding recipe is unchanged, it now runs as its own
isolated step for fresh named-cast gens (fixes 1, 3, 4); the two-gen identity-pass ladder is retired.

**What this is.** The synthesis deliverable for Gate 1's fallout, **re-cut against Daniel's checkpoint
rulings on r1** (`board-verdict.md` §"Daniel checkpoint rulings on fix-design r1" + the additional rulings
from the same session, binding). One routed fix per defect CLASS, each in exactly ONE owning layer. r1's
evidence base is preserved; the list is not.

## The thesis

*"I want to fix the actual system so generating images isn't fucked up to begin with."*

**Make the GENERATING logic consistent enough that checking becomes unnecessary.** That is the whole design,
not a preamble to it. Checking mechanisms are bad at detecting rig drift and are largely wasted space; in r2
they shrink **because the generation fixes make them redundant** — not as a cost concession, not as a
slimming trade-off, and not because review was expensive.

The redundancy is specific and traceable, which is what makes the claim testable rather than a hope:

| What used to need catching | What now makes it structurally unable to occur |
| --- | --- |
| A figure rendering with re-invented ears, eyelids, digits, proportion | **The seeding law** (fix 1) — a gen that cannot inherit a figure's rig from a canonical, a pose frame and an expression frame *does not run* |
| An anonymous foreground human drawn from prose alone (76 % condemn rate) | **The tier law** (fix 3) — that tier no longer exists; every human is seeded cast or exemplar-seeded crowd |
| A figure whose seeds were silently dropped to fit the cap | **`forge batch`** (fix 4) — the slate is built by the code that validates it, and over-budget is a hard error |
| A background imported from another video | **Plates abolished** (fix 2) — there is nothing cross-video left to import |
| A pose invented for a template that never existed | **Closed pose inventory** (fix 3) — a name that is not in the registry does not resolve |
| A busy multi-figure frame the generator could not hold | **≤2 cast, less busy scenes, figureless staging first where viable** (fixes 3 and 5) |

Every row removes a *cause*. What remains for review is what no generation rule can pre-empt — did this
frame actually come out right — and that is one bounded pass, not an apparatus.

**Shape of r2:** r1 proposed 13 fixes, 5 of them new verification machinery. r2 proposes **8**, of which
**six change what the generator is given or is allowed to do**, one is authoring doctrine, and one — fix 7 —
**is a deletion list, not a redesign**. Net across the repo: three throwaway scripts deleted, five reference
plates deleted, ~40 lines of review procedure deleted, one new subcommand, zero new lint functions, zero new
files.

**Inputs.** `board-verdict.md` · `scratchpad/forensic-seed-trace.md` · `scratchpad/doctrine-analysis.md` ·
`.claude/skills/README.md` §Design rules · the owning files themselves. (r1 is superseded in place; every
measurement it carried is reproduced below.)

**Rulings encoded, at a glance.**

| Ruling | Where it lands in r2 |
| --- | --- |
| Keep 4 digits, keep the cast | NOT-DOING |
| **Seeding law** — every figure gen seeds off the existing pose/asset base; prompts never contradict or restate a seed-carried fact | Fix **1** (structural) · Fix **3** (the prose half, doctrine only) · Fix **4** (the caller) |
| All non-cast humans are crowd rig, always — no promotion path | Fix **3** |
| Up to **2** named cast per shot; restrict new pose/interaction template minting | Fix **3** |
| **Personified objects are allowed, not pushed** — a few are fine (they barely drift: little rig to hold), too many makes a weird video; never explicitly asked for, never banned | Fix **3** (one line in the class-table bar) |
| Cast decided by VPW reading the script before authoring | Fix **5** |
| No per-act palettes — one per-video colour STYLE; global "warm" deleted | Fix **5** |
| Only prompt-text rig edits; the seeding law is the eyelid fix | Fix **6** |
| **No cross-video env plates ever** | Fix **2** |
| Checking is made redundant, not traded away; no crop battery | Fix **7**, a deletion list |
| Word-sync as the VPW/schema fix it is | Fix **8** |
| `scene_id` unnecessary; no calibration-set file; no new lint; pc-boxy as-is | NOT-DOING (with the open risk recorded) |
| Spend is approved once at the regen gate, not in this document | REPAIR-WAVE IMPLICATIONS, one line |

**Ordering follows the thesis.** Fixes **1–4 are the plan** — the generation-consistency work, hardest
structure first. Fixes **5–6** are the authoring law that keeps the generator inside what it can hold.
Fix **7** is the deletion list those six earn. Fix **8** is the one remaining mechanical class.

---

## Evidence base carried forward from r1

Three findings that were measured, not assumed, and that r2 still rests on:

1. **L97/L99 is not a misbinding and not a slip.** `retry_batch.json` gave **L99** the seed
   `env-exterior-muted.png` — the literal Poyais swamp plate — which its Pass-2 gen never had: **the retry
   injected the swamp.** L99's `merged.json` ruling reads `worst: clean` (→ `verified`) while its own `why`
   still narrates the pre-retry identity collapse; L97 is the mirror, parked on a defect its retry appears
   to have fixed. A verdict was bound to the frame the judge saw *before* the retry, never to the pixels
   that shipped. Daniel's reading was correct. (r1 proposed a content-hash gate; **he declined it for now** —
   see NOT-DOING. The *causes* are removed by fixes 2 and 7.)
2. **Tier measurement, 215 shots vs the parsed 108-shot condemn set:**

   | Authored figure tier | shots | condemned | rate |
   | --- | --- | --- | --- |
   | `figures.anon_foreground` ≥ 1 (**the §2e tier — the only tier with NO seed**) | 34 | 26 | **76 %** |
   | crowd only (exemplar-seeded) | 17 | 10 | 59 % |
   | no anon, no crowd | 164 | 72 | 44 % |

   The worst-performing tier on the board is precisely the one the pipeline **cannot seed**. That is the
   arithmetic case for the seeding law and the tier law together, and it is why fix 3 abolishes that tier
   rather than gating it.
3. **`render.py::match_shots_to_tokens` builds its needle as `[:4]`** — as many words as the `vo_ref` has,
   up to four, matched monotonically after the previous shot's match. A 1–3 word anchor already times
   correctly with **zero render-builder change**, which is what makes fix 8 a pure doc edit.

---

# THE FIX LIST

## 1. THE SEEDING LAW — structural, in the engine, no caller can opt out

**Owning layer:** `.claude/skills/image-generation/scripts/forge.py` — a pre-flight predicate inside
`_gen_single`, beside the existing seed-cap check. **Approved at checkpoint, unchanged from r1.**

**Defect classes it kills.** Directive 4's *"ensure the function obeys pose seeding and doesn't invent"* and
the dominant rig population itself — **95 of the 108 condemned shots are figure-bearing.** Ears, ear-holes,
eyelids, feature placement, proportion and digit count are all attributes the CANONICAL and EXPRESSION
frames route; the moment a figure's seed is absent, every one is re-synthesized from prose and reverts to
the engine's own prior. That is the single sentence under L34, L45–47, L49–54, L60–68, L73, L81–85, L89–91,
L99–101, L107–108, L115, L122, L126–131, L133, L137–138, L146–147, L155–162, L173–175, L191–201.

**Evidence.** tracer §4b: **24 shots shipped with their authored ACTION primitive absent from the request**
(L45, L48, L51, L52, L60, L66, L69, L74, L76, L83, L92, L103, L122, L126, L127, L128, L130, L146, L155,
L156, L183, L194, L196, L199) — every one a ladder unit, every one dropping the pose and never the
expression, because **ladder genB (the image that actually ships) re-seeds only `kind == "expression"`
assets**. tracer §4c: forge never *invents* a pose; the failure mode is omission — "prose-only pose
compliance". The seed law already states the principle (*"a pose re-synthesized from words reverts to the
engine's five-finger prior, while the frame carries the four-digit hand"*); it was enforced nowhere.

**Edit shape.** One predicate, hard-erroring **before the API call**, so a violation costs $0. **The
seeding RECIPE does not change** — canonical + a `kind: pose|action|interaction` frame + a `kind:
expression` frame, together, in ONE gen, with the skill's existing attribution language (outfit/hair/skin
tone/identity from CHARACTER, pose from the base rig, expression without mutating facial proportions).
What changes, for a fresh named-cast stage base, is WHERE it runs — validated 2026-07-30 by a 6-shot probe
(`twostep-probe/results.md`: WIN, falsifier not tripped, scoped to named-cast fresh gens):

> A gen carrying any figure must satisfy, **per named figure**, one of:
> **(a) FRESH** — for a stage-BASE gen, the unchanged recipe runs isolated as **STEP 1** (no scene content
> in that delta); **STEP 2**, the scene gen, seeds STEP 1's output figure + the plate — never the raw
> triple directly, once step 1 has run. Splitting the recipe out of the scene gen is the fix: scene
> complexity competing with rig-hold in one call is what throws a figure off rig; or
> **(b) INHERITED** — a delta beat, unchanged and single-step exactly as today: an in-chain parent frame
> or the video's own plate (a `_staging/` or `scenes/` path forge already recognises as a dependency) that
> contains that figure, **plus** that figure's canonical, all in ONE gen.
> Anything else hard-errors, naming the shot and the missing asset.
> Exemptions, both already in the registry: a character flagged `no_hands` (a personified object — no pose
> primitives exist for it), and a crowd-only gen, which satisfies the law with the crowd exemplar.

This is Daniel's own wording — *"always seeded off the existing pose/asset base so digit count is inherited,
never re-invented"* — with (b) naming the case where the "existing base" is the previous frame. forge
already loads the registry and already classifies seeds (`_is_char_seed`), so the check needs no new data
and no new field.

**Step 1's output, reuse, and rig-hold.** An ordinary per-video generated asset (the same
`_staging/`/`scenes/` convention already used for in-chain parent frames), never under channel `refs/`,
never reused across videos (ruling 9's spirit). A recurring `(character, pose, expression)` combo is not
re-run within a video — reuse-before-regenerate applies, same as any asset — and step 1's output is checked
against the canonical before step 2 spends (the existing verification norm, not new machinery). It lives
outside `/refs/`, so `_is_char_seed` (forge.py:133-143) does not fire by path — the probe held rig
invariants only because every delta carried an explicit `figures` declaration or true figure-content prose
(`twostep-probe/results.md`, "Deliberate RIG-HOLD forcing"); `forge batch` (fix 4) MUST emit that signal.

**Risk / cost.** ~50 lines + tests. It will hard-error on legacy batch shapes — the intended signal, at $0
rather than $0.134 a frame. The real tension is the 4-seed cap: (a) costs 3 slots per figure, (b) costs 2,
which is what forces fix 3's arithmetic. The law and the figure budget are one constraint seen from two ends.

**Automation.** The largest single win. Today "did this gen carry its pose?" is a human post-hoc audit — it
was found by hand-grepping backticks against seed lists *after* the money was spent. After this, it is
impossible to spend money on a gen that could not inherit its rig.

**Verification.** Replay this run's `pass2_batch.json` through the check with `--dry-run` (zero API calls;
forge already prints every assembled prompt and resolves every seed): it must hard-error on exactly the 24
known dropped-pose shots plus the §2e-tier shots. Reproducing that list *is* the proof the predicate is
right. On the repair wave: zero hard errors at dry-run before a cent is spent.

---

## 2. Abolish cross-video environment plates — a video mints its own

**Owning layer:** `channels/the-second-take/visual-kit/refs/env/` — the five scene register plates and the
README routing rule that sends shots to them. **Ruled: no cross-video env plates ever.** This entry also
absorbs the continuity duty of r1's dropped `scene_id` fix.

**Defect classes it kills.** Every "why that background?" condemn — L78, L87–88, L102, L105, L109, L114,
L148, L153–154, L157–158, L169–171, L198, L206 (Victorian room) and L97/L99 (swamp), ~20 shots — plus the
direct question *"is poyais-specific content leaking in? scratch that shit if that's the case."* Yes, it
was, and this deletes the mechanism rather than laundering it.

**Evidence.** tracer §3, both images opened and inspected: `env-interior-warm.png` — seeded into every warm
interior on this board — **IS a period wood-panelled drawing room** (walnut panelling, gold swagged
curtains, carved chairs, mantel clock); `env-exterior-muted.png` is **Poyais L22 reused unchanged and is
literally a misty mangrove swamp**, and it is L97's only seed. The README's own routing rule — *"Pick the
anchor whose REGISTER matches the shot... not the content"* — is exactly what pipes another video's place
into a shot that never asked for it.

**Edit shape — deletions first, then the one new affordance:**

- **DELETE** the five scene plates (`env-exterior-vivid`, `env-exterior-muted`, `env-interior-warm`,
  `env-interior-cool`, `env-map-parchment`) and the README's register-routing table.
- **KEEP, explicitly:** `lettering-marker-italic.png` and `stamp-block-outlined.png` (register exemplars for
  the lettering and stamp HANDS — they depict no place), the `prop-*.png` canonicals, and `_is_char_seed`'s
  `/refs/env/` exemption, which those files still depend on.
- **Downstream references to rewrite** (audited — this is the complete list):
  `forge.py:410-417` (the unseeded-env hard-error text) · `image-generation/SKILL.md:78` (register with
  `environment: true`), `:101` (the **"Style anchor MANDATORY"** row and its register-preference chain),
  `:144` (technique (b) "+ a style anchor"), `:182` (cutout fallback) · `style-bible.md:177` (§6's "three
  are locked in `refs/env/`") · `motion-planner/references/animation-rules.md:18` and `critics.md:20-22` ·
  `render-builder/references/shots-motion-schema.md:44-45` and `motion_plan.py:167`. Every one becomes "the
  video's own plate" where it said "a `refs/env/` anchor".
- **The new affordance, one flag:** forge's hard-error on a zero-seed environment/style gen stays, with one
  exception — a batch item marked `plate: true` (the video's FIRST frame for a place) may generate unseeded,
  and forge records that on the manifest. Everything else in that place must seed it.

**What pins style now that no cross-video plate does:** the `global_prompt_suffix` (texture, line weight,
art style — the only place they are stated, on every prompt) + forge's §2/§2b descriptor blockquotes
(`#241a12` outline, flat cel) + the character canonicals on any figure shot + **the video's own plates**
within it. **Within-video minting flow:** the first shot in a place is generated as a `plate: true`
candidate batch (2–3 options), human-picked once, and every later shot in that place — delta or not — seeds
that picked frame. That is also how continuity is carried without `scene_id`: same place, same plate.

**Risk / cost — stated honestly.** forge's hard-error exists *because* unseeded env gens drift to "a soft
detailed-middle look with mismatched line weight". Abolishing cross-video plates means **the first frame of
every place in a video has no style anchor at all.** Mitigation is the candidate batch plus the human pick,
once per place: ~5–8 places × 2–3 candidates ≈ 15–25 gens ≈ **$2–3.4 per video**. That cost is the price of
the ruling, and it buys a video whose backgrounds can only come from itself.

**Automation.** Removes a defect class no automated judge can catch: the prompt and the image *agree* with
each other, so only a human viewer ever notices the drawing room. Deleting the source removes the need to
detect it.

**Verification.** Pre-wave: a 3-place probe (one interior, one exterior, one document/map) — each picked
plate must carry the outline and palette discipline with no imported set. Across the wave: no frame contains
panelling, curtains or wetland its own prompt did not author, and every same-place shot's seed list names
the video's own plate.

---

## 3. Two tiers, at most two named cast, a fixed pose inventory

**Owning layer:** `channels/the-second-take/visual-kit/visual-grammar.md` — four coordinated edits inside
ONE file (§1's class table and its literal/non-literal bar, §2's tier paragraph, §2's figure cap, §2's
pose-naming bullet), each replacing text in place.

**Where the law lives — the split Daniel asked for, stated once.**
**`visual-grammar.md` = DEPICTION LAW: what may be in a frame and how it is staged.** Tiers, the cast cap,
the seed arithmetic, the pose inventory, the class table and the prompt/seed non-contradiction doctrine all
live here, because they constrain *the frame*.
**`visual-prompt-writer/SKILL.md` = AUTHORING LAW: the process that produces the file, and when each
decision is made.** Which cast this video has, and the video's colour style, live there (fix 5), because
they are per-video decisions taken at a moment in the process. VPW *references* the grammar; it never
restates it.

**Defect classes it kills.** Directive 3, directive 4's "avoid many different character types in one shot",
and the two worst authored shapes on the board: the **§2e anonymous-foreground tier at 76 %** condemned and
the **named-cast + crowd shape at 93 %** (14/15, doctrine §2) — together L34, L60–68, L73, L143–144
("should be CROWD rig, not full rig" — this rule stated by Daniel one shot at a time), L153–154, L198. It
also carries **the surviving half of r1's rejected lint fix**: L91 names `action-shrug` *and then writes*
"palms half-open in a small practiced shrug"; L196 names `surrender` *and then writes* "both palms raised
open toward the room" — open/raised palms being the style bible's own documented five-digit drift point, and
L196 is Daniel's "terrible facial expression".

**Evidence.** The tier table above. doctrine §0: figure presence is the dominant predictor of a condemn
(88 % of condemned shots carry a figure vs 40 % of the rest). doctrine §2: over-cap shots condemn at 76 %,
within-cap at 43 %, figureless at **17 %**. doctrine §3-D: six of the class table's 13 rows resolve to a
figure *by definition* and the signature class (`ironic-counterpoint`, 35 shots) is silent on figures, so
authors default to staging one — the figure-classes total ~63 shots but **137 shots carry figures**.
doctrine §1a: the "never author pose as prose" rule leaked on at least four shipped shots.

**Edit shape — four replacements, no additions:**

1. **Tier law** (replaces §2's "route each by SIZE" routing): *"Every human in frame is either **NAMED
   CAST** — it has a backticked slug and a canonical, and it is seeded — or **CROWD**, declared
   `crowd: true` and seeded from the crowd exemplar. There is no third tier and no promotion path: an
   anonymous foreground human does not exist. A beat that seems to need one either gives that person a name
   in the video's cast (fix 5's list, decided before authoring) or stages the people at crowd scale."*
   The §2e clause text stays in the bible for the legacy frames that used it, but nothing authors it.

   **Scope law: two-step applies to named-cast FRESH stage-base gens only.** Crowd has no canonical, so
   isolating a step-1 gen buys it nothing — crowd, environment and prop shots stay single-step (crowd
   exemplar + plate + prose), and delta beats stay single-step too (fix 1(b), unchanged). Combined with
   this tier law and the ≤2-cast cap below, no other shot shape exists that a step-1 figure applies to.
2. **The cast cap and its arithmetic** (replaces *"Figure cap — plan ≤5 must-stay-distinct figures per
   shot"*, which is unenforceable — no countable input exists and the critic is explicitly told not to flag
   a shot for merely having figures): **at most 2 named cast per shot**, with the slate stated so the cost
   is visible rather than argued:

   | Shot shape | STEP 2's slots (step 1 already ran per figure) | What it gives up |
   | --- | --- | --- |
   | 1 cast, fresh | step-1 figure · **plate** | nothing — 2 slots free |
   | 1 cast + crowd, fresh | step-1 figure · plate · crowd exemplar | nothing |
   | **2 cast, fresh** | step-1 figure A · step-1 figure B · **plate** | nothing — 1 slot still free |
   | 2 cast + crowd, fresh | step-1 figure A · step-1 figure B · plate · crowd exemplar | nothing — probe-validated (`results.md` L60) |
   | 2 cast, delta beat | parent frame · canonical A · canonical B · one changed pose *or* expression | nothing — unchanged, single-step, exactly as today |

   The rule that follows, stated positively: *a fresh two-cast shot is the BASE of a stage; every later
   two-cast beat in that place is a delta on it.*
3. **Pose inventory is closed** (edits §2's "reference cast, poses and expressions by their registry
   vocabulary NAME" bullet): *"A pose, interaction or expression name must ALREADY exist in
   `registry.json`. Unlike a cast name — which may be authored and minted at the Pass-1 gate — a new pose or
   interaction template is a rare, separately gated build: it changes how every figure that uses it is
   drawn, and a fresh one breaks more than it buys. Author from the inventory; if no pose fits, restage the
   beat."* Evidence for the restriction: this run minted two pose primitives, and the L52 repair then
   silently substituted `lie-supine` for all three of the shot's authored tags, chosen by whoever built the
   fix batch with no record of why (tracer §4b).
4. **Objects before people** (§1's class table and the bar beneath it, data): every figure-implying row
   gains a figureless alternative **listed first where viable** ("an institution as an actor → its iconic
   landmark, its building, its letterhead, its product — *or* a personified character with one identity
   tag"), and the bar gains **two lines**:
   *"A human figure is the expensive option (§2 slate). Where the beat reads without one, stage the object,
   the place, or the document."*
   *"A **personified object** is a legitimate actor option (§5 lists money objects as cast) and holds a
   minimal rig, so it survives generation well — use one where it fits the beat, but sparingly: a board
   full of faced objects reads weird. Neither push for them nor avoid them."*
   That second line is Daniel's ruling routed to the one place that decides what a beat depicts (allowed,
   a few fine, never pushed); it is also why fix 1 exempts `no_hands` characters — there is almost nothing
   to hold.

Plus the doctrine sentence that replaces r1's rejected lint, integrated into §2's existing prohibition
rather than added beside it: *"A named asset is the authoring act, and the prompt may not narrate what the
seed already carries — no eyelid, brow, nose, ear, finger, palm or proportion prose next to a named pose or
expression. Prose competing with a seed is how one figure's attributes bleed onto another."*

**Risk / cost.** Doc edits only. The honest exposure: with no lint, edits 1–3 are **self-checked authoring
doctrine**, and README §Design rules is explicit that a self-checked prohibition shares the generator's
blind spot. Two of the four are structurally backstopped anyway — fix 1 hard-errors a figure with no seed,
and a pose name absent from the registry fails to resolve — so the genuinely unenforced part is the "≤2
cast" cap and the prose-competition rule. Recorded in NOT-DOING as accepted open risk.

**Automation.** Deletes the only tier the pipeline cannot seed, which is what lets fix 1's law hold for
*every* figure rather than most of them. An un-seedable figure is the one thing no amount of structure could
have saved — and the personified-object bias steers the remaining actors toward the rig that drifts least.

**Verification.** Backfill named cast mechanically from the existing backticks and count the current
`shots.json` against the new law: it must name exactly the 34 `anon_foreground` shots, the 15 named+crowd
shots and the 21 two-named-cast shots as re-authoring targets. Reproducing those three counts is the proof
the arithmetic is right. Post-wave: zero shots carry an `anon_foreground` key.

---

## 4. `forge batch` — the policied seed slate, inside forge itself

**Owning layer:** `.claude/skills/image-generation/scripts/forge.py` — a new `batch` subcommand beside the
existing `gen` / `register` / `lookup` / `place` / `manifest` / `cutout` / `montage` commands.

**Daniel's read was "sure...?" — so here is the case in one paragraph, and the honest alternative.** r1
proposed a new committed script. That is a new file to maintain beside a 1,035-line engine that already owns
seed resolution, the cap, the registry and the dry-run. Folding it in as `forge batch` instead means: **one
file touched, three throwaway scripts deleted** (`scratchpad/build_batch.py`, `build_retry_batch.py`,
`build_continuity_fix.py`), **net file count negative**, and the slate is built by the same code that
validates it — which is what closes the actual hole, since every silent drop on this run happened in the gap
*between* a caller and forge. It also has no independent existence to rot: it is a command on the engine,
not a companion tool. **If that argument does not land, the demotion is clean** — fix 1 already makes an
under-seeded gen impossible, so this fix is about *never producing* a bad slate rather than *never spending
on one*, and the wave could run without it at the cost of a hand-built batch that fix 1 would then reject
noisily.

**Defect classes it kills.** The 7 shots that silently lost their mandatory style anchor, the
duplicate-character-seed bug, and **the retry silently rewriting a shot's seed slate — the mechanism that
put the swamp plate into L99**.

**Evidence.** tracer §4a: **forge.py never drops a seed silently** — its base-rig auto-add prints a WARNING,
and any over-cap list is a hard `SystemExit` before spend. *Every* silent drop happened one layer up, in a
per-run scratch script under no policy: `cap4()` truncation with no print, ladder genA sliced to `[:3]`,
genB dropping every action primitive. tracer §1 CONFIRMED BUG: the anchor appended last and lost on 7 shots.

**Edit shape.** `forge batch <shots.json> --out <spec.json>` builds one deterministic slate per shot, from
the shot's own `assets` tags and `figures`. For a FRESH named-cast stage base it orchestrates fix 1's two
steps: for each named-cast figure, reuse an existing step-1 output for that `(character, pose, expression)`
combo (the SAME `lookup`/reuse-before-regenerate mechanism Pass 1 already runs for canonicals — no new
mechanism) or generate one; STEP 2's slate is then built in a priority stated once in code:

```
[step-1 figure(s)]  >  [the video's plate: in-chain parent or the place's picked plate]
```

For a delta beat (fix 1(b)) the priority is unchanged from today, single-step:
`[character canonical(s)] > [the video's plate] > [pose/interaction primitive] > [expression frame]`.

- **never truncates** — over budget is a hard error naming the shot and the seed that did not fit, the same
  failure mode the cap already has. The remedy is authoring (fix 3), never a silent drop;
- a `plate: true` item (fix 2) is emitted for each place's first frame;
- **every step-1-seeded scene gen carries an explicit `figures` signal or figure-content delta** — no path
  shortcut, step-1 figures live outside `/refs/` (fix 1's RIG-HOLD requirement);
- **the placement delta restates the shot's full scene nouns and anchors scale against a named element** —
  an anchor seed carries palette, not genre (probe L133: an officer rendered as a warehouse until the
  prompt named the airport) — with ground-plane contact, occlusion and palette-match stated explicitly;
- the retry path reuses the same builder, so a retry cannot invent a seed the original never had.

Then `image-generation/SKILL.md` gains ONE sentence: *"batch specs come from `forge batch`; a hand-rolled
per-run batch script is not a supported input."*

**Risk / cost.** ~150 lines inside an existing file + tests. No gen spend. It gates the repair wave.

**Automation.** Converts the most error-prone hand step in the pipeline — "an agent writes a fresh batch
script each run" — into a tested command. Three of this run's five surfaced systemic findings were bugs in
that throwaway script.

**Verification.** Run `forge batch` over this video's `shots.json` and diff against
`scratchpad/pass2_batch.json`: assert (i) the 24-shot dropped-pose list comes back **empty**, (ii) every
composed gen carries exactly one plate, (iii) over-budget shots hard-error with a named list — that list is
the input to fix 3's re-authoring pass.

---

## 5. The pre-authoring plan declares the cast and the video's colour style

**Owning layer:** `.claude/skills/visual-prompt-writer/SKILL.md` — **Step 3a**, plus one clause in Step 3c's
existing per-act audit. The paired one-line edit to `style-bible.md` §5 is named below; Daniel ruled it at
checkpoint, so it is no longer an open locked value.

**His process question, answered directly: no new pass is needed.** Step 3a — *"Split + plan (before
authoring a single shot)"* — already runs after reading `script.md` and before any shot is authored, and it
already decides the acts, which sets recur as stages, the three peaks and the density budget. The cast list
is one more line in that same list, at exactly the moment he described: **VPW reads the script, then names
the cast, then authors.**

**Defect classes it kills.** Directive 3 and directive 4 as *per-video decisions* (fix 3 is the law; this is
where a video picks its numbers), plus the palette monotony: L181–184 "way too red", L184 "don't love", and
directive 3's *"same-y palette/background is boring"*.

**Evidence.** doctrine §3: `style-bible §5`'s *"a committed **warm** scene palette"* is the **only**
cross-shot palette pressure in the whole system, and it points at sameness; measured lexicon over 215
prompts — grey 108 · warm 67 · red 44 · cool 35, and L181–184 is four consecutive shots across two stages
all authored *"alarm red against near-black"*. doctrine §8: **6 of the 8 current exemplars stage figures** —
a 75 %-figure bar produced a 64 %-figure board.

**Edit shape.** Step 3a's existing decide-before-authoring list gains **two lines**:

- *the video's **named cast** — a small closed list, derived from the script before any shot is authored.
  Every other human in the video is crowd (`visual-grammar.md §2`). A figure not on this list does not get a
  slug mid-pass;*
- *the video's **colour style**, declared once — a named palette register the whole video holds (a muted
  video stays muted; no shot departs into an unrelated register). Recorded in `vpw-log.md`.*

Step 3c's per-act self-audit paragraph — which already counts red ink and class variety — gains **figure
share** and **departures from the declared colour style**. One clause in an existing paragraph: **no new
machinery**, which is the condition it survives under.

Paired edit, `style-bible.md` §5 (LOCKED file, ruled at checkpoint): delete *"a committed **warm** scene
palette"* and replace with *"a committed scene palette consistent with the video's declared colour style"* —
the single global instruction pushing every scene the same direction, removed.

**Risk / cost.** Doc edits only. Binds the next VPW run and the repair wave's re-authoring pass; it cannot
retro-fix generated frames. Same self-check exposure as fix 3, recorded once there.

**Automation.** Moves "fewer people, less same-y" from a taste note Daniel repeats at every board into two
declarations the plan makes and the per-act audit checks itself against.

**Verification.** Next `shots.json`: named cast size equals the 3a declaration; zero shots outside the
declared colour style; figure share down from this board's 64 %.

---

## 6. The three rig edits that change PROMPT text

**Owning layer:** `channels/the-second-take/visual-kit/style-bible.md` — §2c and §2d (the blockquotes forge
auto-appends) plus one clause in §3. **LOCKED file: Daniel approves the wording; nobody self-applies.** Per
his ruling, only edits that change what the generator is *told* survive; the checklist framing is dropped.

**Defect classes it kills.** L89–91, L137–138, L192–194 (ear holes / "ear prints") · L34 and L156
(background-figure digit count) · L133 "off rig, too tall" and the general proportion drift.

**Evidence.** tracer §5: the ear clause defines the *opposite* failure ("a bare earless hairless side gap is
a FAIL") and never anticipates a hole drawn INTO the hair; §2d CROWD-RIG states proportion but **no hand
rule at all** — and under fix 3 the crowd tier is about to carry nearly every human on the board, so that
gap is about to widen; §2c never restates proportion though §3 judges it explicitly.

**Edit shape — three edits, net prompt length ≈ zero:**

1. **Ear, in the prompt, stated POSITIVELY.** The approved wording is the *failure* definition; the prompt
   must not carry it as a negation. `visual-grammar.md`'s own law is explicit — *"a negation list... raises
   the odds of an X"*, and "NO characters, NO ghosts" re-summoned the sprite it forbade. So §2c/§2e's "NO
   nose, NO ears" gains the positive form instead: *"on a haired character the hair reads as one continuous
   unbroken mass from temple to jaw."* The §3 values bullet takes the approved failure wording as **one
   clause, not a checklist row**: *"...both a bare earless hairless side gap and any ear-shaped hole or
   notch drawn INTO the hair are FAILs."*
2. **§2d CROWD-RIG gains the hand clause:** *"hands, where visible, are the same four-digit cartoon hand."*
3. **§2c gains proportion** inside its existing sentence (*"SAME round near-circle head **and the SAME squat
   head-to-body proportion**"*), **paid for by deleting §2c's duplicate outline/render sentence**, which the
   `global_prompt_suffix` and the §2/§2b descriptor already state twice. This also honors the seeding law's
   second half: the prompt should carry *fewer* facts the seed already owns, not more.

**Eyelids: no checklist row, per ruling — the seeding law is the fix.** The theory is that the canonical
carries the eyelid design and a properly seeded figure inherits it. The record is *consistent* with that:
L89–L91 and L93 were identity-collapse frames (bald base-cream head, base hoodie), i.e. shots where the
canonical demonstrably was not holding — so the missing eyelids co-occurred with the missing identity rather
than appearing independently. Consistent, not proven; recorded in NOT-DOING as the one defect class r2
leaves without any owner.

**Risk / cost.** LOCKED file. Before the edit lands, inspect the 15 canonicals to confirm none becomes
non-conforming (PIL and eyes, no gens).

**Automation.** These are the three places a rig fact reaches the generator on every single gen. Changing
them changes 100 % of output with zero per-shot work.

**Verification.** Diff an assembled prompt before and after with `forge gen --dry-run` (zero API calls): the
crowd clause and the proportion clause must appear, the duplicated outline sentence must be gone, and total
prompt length must not have grown.

---

## 7. Delete the review apparatus that fixes 1–6 made redundant

**Owning layer:** `.claude/skills/image-generation/SKILL.md`, the "Reviewing the run" section.
**This entry's deliverable is deleted text.** It is not a redesign, not a cheaper review, and not a
concession — each deletion below names the fix that removed its reason to exist.

**What gets DELETED, explicitly:**

- **The whole escalation model** — the localizer agent, the `crop_battery.py` battery, the 3–4× contact
  sheets, the "paired crop is admissible evidence to CONDEMN" apparatus and its worked counter-example
  (~15 lines). *Made redundant by fix 1:* the entire battery exists to detect a rig that was re-invented
  from prose, and a gen that cannot inherit its rig no longer runs. `crop_battery.py` and its tests stay on
  disk **unreferenced** rather than deleted — a tested tool is cheap to keep and expensive to rewrite.
- **The three-mandate fan-out** as a standing requirement: "Dispatch three concurrent review subagents" (in
  practice 9–12 dispatches across act batches) becomes **ONE fresh-eyes pass per act batch**, ruling at
  ordinary viewing scale on §3, the load-bearing prompt claims, and style/register together. *Made redundant
  by fixes 1, 2 and 3:* the rig mandate was carrying identity collapse (now structurally seeded), the style
  mandate was carrying imported backgrounds (now impossible), and the busiest frames the fidelity mandate
  struggled with are no longer authorable.
- **The self-check clause** — *"Self-check only the flagged points on the new frame — never re-dispatch the
  agents or re-review the batch"* — deleted outright. It is the clause that produced **109 of 165 verified
  stamps written by the agent that generated the retry**, and it directly contradicts the same file's bold
  *"a GENERATING agent's self-verification does NOT substitute for it."* Deleting it removes a
  contradiction; nothing is added in its place except one sentence of sequencing (below).
- **DSG-lite's "flagged high-risk" half** — the checklist stays scoped to **lettering-bearing shots only**,
  the one class where it demonstrably worked (it caught L172's garbled stamp).

**What replaces the retry/self-check loop — sequencing, not machinery.** Generate an act batch → **one
fresh-eyes pass** with an `N/N covered` line → each flagged frame gets **ONE re-authored regen** → those
regens are ruled by the **next act batch's pass**, which is already running, with a final mini-pass for the
last batch → anything still flagged **parks**. No agent ever clears its own park, no extra dispatch is
created, and the retry that fixed 109 of 120 frames on this run is preserved.

**Defect classes it addresses.** gen-log finding 3: **all three rig judges ran out of turns mid-batch and
stopped WITHOUT saying so**, leaving a 48-shot gap found only by cross-checking coverage afterwards — the
`N/N covered` line is the one addition, and it is a sentence. The bounded pass also makes budget exhaustion
less likely: one agent over one act instead of three over a third of the board.

**Already present, needs no edit** — Daniel's ruling 13 ("judges compare against base rig canonicals
directly") is **already the law in both files**: `image-generation/SKILL.md` says *"against that character's
approved canonical, not an idealized rig"* and `style-bible.md` §3 says *"Judge against the approved
canonical... never an idealized pure-circle rig."* Verified this session. No line is added.

**The condition this rests on, stated plainly.** The deletions are earned by fixes 1–6 *working*. The
dominant defect the old apparatus caught — identity collapse, 68 % first-pass flag rate — is exactly what
the seeding law makes structurally impossible, which is why the apparatus that caught it can go. **The
falsifiable version: if the repair wave's first-pass defect rate does not fall sharply, the redundancy claim
is wrong and the causes are not all removed.** That is measurable on the wave itself (first-pass clean rate
was 32 % on this run), and it is the right thing to check — rather than keeping detection machinery on
standby against the possibility.

**Automation.** One bounded pass, no crop pipeline, no self-verification: what remains is the irreducible
question a generation rule cannot answer in advance — did this frame come out right — and the honest
three-state stamp still gates the render.

**Verification.** The SKILL section's line count drops (~40 lines net). Every review report ends with an
`N/N covered` line; a run whose covered count is below its own dossier count fails the stage rather than
reporting done. No ruling in `merged.json` is written by a generating agent.

---

## 8. The anchor opens on the payload word; no one-word shots

**Owning layer:** `.claude/skills/visual-prompt-writer/references/shots-schema.md §2` (the `vo_ref` rule),
with the matching sentence in VPW Step 3b. **Doc edits only — no new lint**, per ruling.

**Defect classes it kills.** L02 (the Pac-Man image must land on "Pac Man", not "and one") · L03 (the
corporate-scam image must land on "corporate scam") · L197 ("why does a shot exist on just the word 'and'?").

**Evidence.** tracer §7b: L02's `vo_ref` is *"Home to big hair, Pac-Man,"*, so the needle is *"Home to big
hair"* — the shot **opens four words before its own payload noun** and cuts the instant "and" begins. §7c:
L197's one-word span was caught during authoring (`vpw-log.md` finding 24) and shipped anyway. §7d: nothing
ties a shot's key visual to the words it lands on. **Resolved this session:** `render.py`'s needle is `[:4]`,
so a 1–3 word anchor already times correctly — no render-builder change, and no `lands_on` field.

**Edit shape.** Replace the schema's *"≥4 words where the sentence has them"* with: *"as many verbatim words
as it takes to match once in the VO stream after the previous shot's anchor, **beginning at the word the
shot's payload names**. A shot whose span comes out as one word — or only function words — is not a shot:
merge it into its neighbour."* One sentence in VPW Step 3b: *"A shot's anchor opens on the word its payload
names. Two payloads in one line is two shots."*

**Risk / cost.** Free. The existing lint still HARD-fails an anchor it cannot match in order, so correctness
is protected; what is now unenforced is the *placement* judgment. Recorded in NOT-DOING.

**Automation.** A mis-landed image is currently only detectable by a human watching the cut; stating the
rule positively at the point of authoring is the cheapest available intervention.

**Verification.** Split L02 into *"Home to big hair"* + *"Pac-Man"* and confirm with `--dry-run` that the
arcade cabinet's shot starts at "Pac-Man"; merge L197 into L198. Both checkable with no render and no gens.

---

# LOCKED VALUE — one ruling still required

One. (a), (b), (c) and (d) from r1 are resolved — by fixes 6, 5, 2, and the ruling that `pc-boxy` stays
as-is (whose positive half is now routed into fix 3's class-table bar). **(f) is not a locked value in this
document:** spend is approved once at the actual regen gate, not here.

### (e) F-12 — the prop-vs-character slug rule for personified objects

**What the question actually is.** When VPW is writing a shot and wants a personified object — a computer
with a face, a money bag with eyes — it must write *something* in the prompt. The doctrine gives two
opposite instructions and the object sits exactly on the line:

- **The CHARACTER rule** (`visual-grammar.md §2`): a figure that recurs gets a backticked slug written
  inline, even if nothing has been built yet — `image-generation`'s Pass-1 gate surfaces the unknown name to
  Daniel, he approves, and it is minted before any scene is generated. Authoring a not-yet-existing name is
  **correct** here.
- **The PROP rule** (same section): inventing a backticked slug for an unbuilt prop is *"the failure — it
  resolves to nothing"*; a first-appearance prop is described in prose, and Pass 1 mints its canonical from
  that description.

`pc-boxy` is a computer with the cast's face. On this run it was routed to **character** — which is why it
exists as a proper canonical today and why it barely drifts. But the doctrine never adjudicated it, so the
next author faces the same fork and may guess the other way, which would leave a faced object described in
prose and re-invented on every shot it appears in.

**This still matters**, because fix 3 keeps personified objects as a live actor option and closes the pose
inventory — so the rule also has to say what a faced object is exempt from.

| | Option | Consequence |
| --- | --- | --- |
| **1 — recommended** | One clause in §2's props bullet: *"a personified object (it carries the cast's face) is CAST — author its slug, Pass 1 mints it, and it is exempt from the pose-inventory rule, since no pose primitives exist for a non-human rig. An unfaced object is a PROP — describe it in prose until its canonical exists."* | One sentence. Matches what shipped, matches §5's recipe ("flat cel characters + money objects"), and matches the drift-resistance you want to lean on. |
| 2 | Route personified objects to props (prose until minted). | Contradicts §5, and a faced object re-described per shot is exactly the drift the ruling wants to avoid. |
| 3 | Leave undecided. | The next author guesses; a wrong guess costs the object its canonical. |

---

# NOT DOING — rejected fixes, and the risk each leaves open

**Dropped at Daniel's checkpoint** (his call, recorded with the exposure it accepts):

- **Verdict↔pixel binding (r1 fix 1's hash gate) — DROPPED.** *Open risk, the largest one on this list:*
  nothing structurally prevents a verdict describing a different frame than the one that ships. L99 shipped
  `verified` carrying a retry-injected swamp; L97 sat parked on a defect its retry had fixed. r2 removes the
  two *causes* (fix 7 deletes the self-check that overwrote the axes; fix 2 deletes the swamp plate the
  retry injected) but not the *class*. If a swap or a stale verdict recurs, the detector is still a human at
  the board.
- **The anatomy-prose lint (r1 fix 3) — DROPPED as a function; survives as doctrine** inside fix 3's grammar
  edit. *Open risk:* the rule that leaked on L91, L196, L143 and L60 is again enforced only by an author's
  self-discipline, and README §Design rules says plainly that a self-checked prohibition shares the
  generator's blind spot. Mitigation is indirect — fewer figures, personified objects, and a closed pose
  inventory mean fewer chances to narrate one.
- **Unconditional paired face crops (r1 fix 8) — DROPPED.** *Open risk:* ear-holes, feature placement and
  proportion drift are sub-viewing-scale and will not be caught by a viewing-scale pass. The bet is fix 1 +
  fix 6 stop producing them. If the wave still shows them, checking is not the thing to fix twice — the
  seeding law's coverage is.
- **`scene_id` (r1 fix 10) — DROPPED as unnecessary.** Continuity now rides on fix 2's within-video plates
  plus delta chains. *Open risk:* a same-place callback 100 shots later with no delta relationship (L207's
  "the same brickyard gate from earlier") has no machine-readable link — the batch builder must find it by
  reading the prose, which is how 11 shots were missed on this run's first sweep and one more on the second.
  Mitigated only by fix 4 owning that sweep in one tested place instead of a per-run script.
- **The `art` calibration facet (r1 fix 13) — SCRAPPED.** Judges compare against the base rig canonicals as
  part of ordinary judging — **already the law in both files**, verified this session, so nothing is added.
  *Open risk:* the bar transfers by rule rather than by example, which README five-move #1 calls the weaker
  mechanism.
- **Eyelids as an invariant — DROPPED**, on the theory that the canonical carries them under the seeding
  law. *Open risk:* r2's one defect class with no owner anywhere. The evidence is consistent (the
  no-eyelid shots were identity-collapse frames) but not proof.
- **`pc-boxy` trade-dress re-mint — DROPPED**, it stays as-is. *Open risk:* a beige all-in-one reads
  Macintosh-adjacent on a channel about corporate history; the frame carries no marks or logo, and the
  archetype is generic, so the residual is small and accepted.

**Rejected on evidence, unchanged from r1:**

- **5-finger migration** — ruled out, and the evidence agrees: the 4-digit hand is stated in
  §1/§2/§2c/§2d/§2e/§3 and every canonical was generated against it, so the switch costs a full registry
  re-mint and the channel's cartoon signature, to fix the class directive 4 ranks *least* important.
- **A backticked-slug validator** — all 42 slugs on this board resolved cleanly (doctrine §1d). Zero failure
  rate; unearned.
- **Rebuilding forge's seed resolution** — forge is *correct*: it warns on the base-rig drop and hard-errors
  over cap, never truncating silently (tracer §4a). The defect was entirely in the unpoliced caller.
- **A verify-then-regen loop inside forge** (gen-log finding 1) — that puts taste judgment inside the
  deterministic engine.
- **Changing the three-state stamp** — `verified` / `parked` / `unreviewed` is honest; what got written into
  it was not.
- **A "describe the rig better" rule** — the dominant rig failure is a seed defect: the same character
  renders correctly in the adjacent shot from the same prose (gen-log Stage E). More prompt words buy
  nothing, and the seeding law says prompts should carry *fewer* rig facts.
- **A separate continuity critic, a plate library, or an extra review pass** — nothing in r2 adds a pass.

---

# REPAIR-WAVE IMPLICATIONS

## The wave is a RE-AUTHORING pass, then a regen

Fix 3 changes what the wave *is*. 95 of the 108 condemned shots are figure-bearing and **34 carry the
now-abolished anonymous-foreground tier**; regenerating those prompts unchanged would reproduce shots the
new law forbids. So the wave runs **VPW over the condemned set first** — every `anon_foreground` figure
becomes crowd or named cast, shots above 2 cast are split or restaged, human actors become personified
objects where the beat allows, pose names outside the registry are replaced, prose competing with a seed is
cut, scenes get less busy — and only then generates.

## Must land BEFORE any regen

| Fix | Why it blocks |
| --- | --- |
| **1** seeding law in forge | The point of the wave; hard-errors at $0 instead of shipping an unseeded figure |
| **2** env plates abolished + within-video plates | Otherwise the same drawing room and swamp regenerate; also supplies the wave's continuity mechanism |
| **3** tiers / ≤2 cast / pose inventory / objects-over-people | The re-authoring pass has no law to author against without it |
| **4** `forge batch` | Otherwise the wave repeats this run's silent drops and seed swaps — **or** it is demoted and the wave hand-builds a spec that fix 1 rejects noisily |
| **5** cast + colour style declared in the plan | The wave declares the cast it is re-authoring toward |
| **6** the three prompt-text rig edits | Every regenerated frame should carry them |
| **7** review slimming | The wave's own review runs under it; the self-check clause must be gone before anything is stamped |
| **qt-wiles re-mint** | Re-mint `qt-wiles` canonical (businessman, no stethoscope, per Daniel 2026-07-30) via forge BEFORE any wave step-1 gen seeds him — the extracted `refs/qt-wiles` canonical and the dogfood step-1 figures are stale |

Fix **8** rides *with* the wave as three shot edits (L02 splits into two shots, +1 gen; L03's box art
re-authored; L197 merges into L198, −1 shot).

## Regen order — chains first, because parents seed children

1. **Mint and human-pick the video's own plates** (fix 2) — one candidate batch per place, ~5–8 places.
2. **Bases and stage heads** off those plates — every condemned stage `base` and every place's first frame.
   A child seeded off a defective parent inherits it.
3. **Chain members** in board order, off their fixed parents.
4. **Standalone condemned shots** — the largest block, mostly rig condemns.
5. **The three word-sync edits last**, since they change the shot list itself.
6. **The bounded fresh-eyes pass** per act batch as the wave proceeds (fix 7). No self-check clears anything.

## Scope note (spend is approved at the regen gate, not here)

**Scope of the wave: ~130 shots** — condemn set 107, union with the 31 parked ≈ 115 distinct, plus ~15 chain
parents that must be regenerated so their children can seed them, plus one candidate batch per place for the
video's own plates. A spend number is put to Daniel **once, at the regen gate**, with the shot list in hand.

Two scope facts worth carrying to that gate: the closed pose inventory means **zero Pass-1 minting** on this
wave (6 canonicals last time), and **the two-gen ladder is retired, not merely probed** — the 2026-07-30
probe (`twostep-probe/results.md`: 6/6 placements held identity, falsifier not tripped, WIN scoped to
named-cast fresh gens) confirms fix 1's step-1/step-2 split replaces it — a step-2 gen never re-composes
identity from words, so the ladder's reason to exist (a heavy delta starving the lone character seed) is
gone. The wave runs step 1 + step 2 per fix 1, not ladder genA/genB.

---

# Where the rulings and the evidence genuinely differ

Stated once, not relitigated — Daniel has ruled and r2 implements the rulings.

1. **The redundancy claim has one unverified link.** Every deletion in fix 7 is justified by a cause that
   fixes 1–6 remove, and each of those is structural — except one: the seeding law is expected to eliminate
   identity collapse, and that is a prediction, not a measurement. The old apparatus caught that defect at a
   68 % first-pass flag rate; the design says it will not occur. **Falsifiable on the wave itself:**
   first-pass clean rate was 32 % on this run, so a wave that does not move it sharply means a cause is
   still live. The right response to that would be finding the remaining cause, not restoring the battery.
2. **Abolishing cross-video plates removes a guard that exists for a measured reason.** forge hard-errors an
   unseeded environment gen because unanchored runs drift to "a soft detailed-middle look with mismatched
   line weight". Every video's first plate now generates without that anchor. The mitigation (candidate
   batch + one human pick per place) is real but costs gens and a gate; it is priced above.
3. **"Up to 2 named cast" and the 4-seed cap are no longer in tension for fresh gens.** Fix 1's step-1/step-2
   split resolves it directly — step 2 spends one seed per figure (its step-1 output), not three, so a fresh
   two-cast shot carries both figures and its own plate with a slot to spare. The old tension survives only
   for a delta beat's raw seeds (fix 1(b), unchanged), which is why that shape stays chained off its parent.
4. **Dropping the lint and the hash means three rules are now self-checked** (≤2 cast, prose-vs-seed
   competition, anchor-on-payload-word), and README §Design rules is explicit that self-checked prohibitions
   share the generator's blind spot. Fix 1 backstops the part that matters most; the rest is accepted risk,
   recorded in NOT-DOING rather than argued.

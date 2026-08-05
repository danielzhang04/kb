# Adversarial review — fresh fifth 1 (L01–L41), doctrine-reset validation leg

Reviewer: adversarial comparator, 2026-08-04. Read-only except this file. No generation, no spend.

Judged against Daniel's goal state (shots that render right the FIRST time) and the design spec
`docs/superpowers/specs/2026-08-04-bricks-doctrine-reset-design.md`, using the audit
`scratchpad/audit-drift-2026-08-04.md` as the list of failures that must not recur.

## 0. Method — what was verified mechanically, not asserted

Everything below marked **[verified]** was produced by running the real tooling, not by reading prose.

| Check | Command / source | Result |
| --- | --- | --- |
| Lint | `lint_shots.py shots.json` | 2 HARD + 1 heads-up, all three genuine partial-coverage artifacts — the author's classification is **correct** |
| Forge whole-file dry-run | `forge.py batch --kit <main visual-kit> --batch shots.json` (new worktree forge) | **REFUSES. `SEEDING LAW — 1 violation(s); nothing generated, nothing charged`** |
| Seed slate + cap arithmetic | same, after a scratch fix to L41 | 41 scenes + 5 STEP-1s; max 3 seeds/shot; `SEED_CAP=4` never reached; max chain depth 3 |
| Quarantine machine-check | same slate | all 5 `fig-*` show **GENERATE**, none `REUSED` — spec §2 B1 check **PASSES** |
| Real cut cadence | `assets/voiceover.manifest.json` word timings (1,632 real timings) vs each `vo_ref` | 10 shots hold >3 s, 3 over the 4 s ceiling, 1 below the 1.5 s floor |
| Style-vocabulary scan | banned/soft-render term scan over all 41 prompts vs the archived file's same span | fresh **0 hits**, archived **8 hits** |
| Payload-last | quoted-literal position in every text-bearing prompt, both files | fresh **0/9** non-delta text shots payload-last; archived **7/7** |
| Lettering seed route | `assets` blocks in both files + `forge.py` asset routing | fresh **0/14** text frames seed `lettering-marker-italic`; archived **12/12** |
| Occupancy | cast-slug + `figures.crowd` census, both files, same script span | fresh **29/41 frames contain no figure**; archived **14/41** |

## A. Per-shot adversarial pass

Severity: **BLOCKING** = the fifth cannot be generated, or will predictably render wrong on a law we
already wrote down · **MAJOR** = a likely defect or a doctrine violation with a real cost ·
**MINOR** = a heads-up.

### A.0 The five file-level BLOCKING defects

**B1 — The batch does not generate at all. [verified]**
The new forge refuses the whole fifth:

```
SEEDING LAW — 1 violation(s); nothing generated, nothing charged:
  L41: delta changes `terry-johnson` to `expr-crestfallen` but the slate carries neither that
  expression primitive nor a STEP-1 frame holding it — an expression changed by prose alone
  reverts to the engine's prior. Declare `delta_primitives`: {"terry-johnson": ["expr-crestfallen"]}.
```

L41 stages the founder's **entrance** as a stage `delta`. The delta seeding path supplies parent +
canonical only, so `expr-crestfallen` **and** `carry-by-handle` are prose-only against a parent frame
that does not contain him at all. This is audit failure #3's mechanism verbatim (L75: prose-only
expression loses to the strongest image input) — the new gate caught it, which is the gate working,
but the authored file walked into it. Spec §5's acceptance line is "lint + whole-file forge dry-run
clean"; the dry-run was evidently not run (the author's report documents lint only).

It is also not fixable by the obvious one-liner. Declaring both primitives refuses again: **[verified]**

```
L41: `delta_primitives.terry-johnson` must declare exactly one proved, unique primitive.
L41: delta carries undeclared full-frame primitive(s): expr-crestfallen, carry-by-handle.
```

So a character entering a held set inside a delta can seed at most ONE of pose/expression. The
doctrine has no authored answer for a figure entrance in a delta (see C/D).

**B2 — L29's two-cast recipe is physically unsatisfiable. [verified from the real slate]**
`handshake` is a registry **`interaction`** asset (a two-figure reference). `_split_primitives`
treats `interaction` as a pose and `shot_cast` binds it to the most recently named character, so the
slate mints:

```
fig-terry-johnson--handshake--expr-delighted
  seeds: terry-johnson.png, expr-delighted.png, handshake.png
  seed-roles text: "...the THIRD image is the `handshake` pose reference for `terry-johnson` —
                    copy only body pose, hands and limb placement..."
  payload: "...This is a reference sheet: the character ALONE, fully resolved..."
fig-ibm-suit--expr-deadpan            <- no pose at all
L29 seeds: [fig-ibm-suit--expr-deadpan, fig-terry-johnson--handshake--expr-delighted, L26]
  seed-roles text: "carry that figure's identity, costume, pose, hands and expression EXACTLY"
```

A two-person handshake reference is being copied onto a solo reference sheet that is simultaneously
told the character is alone. Outcome space: a second figure fused into terry-johnson's identity card
(which then bleeds into L29), or a hand extended into empty air, or an amputated forearm. Then L29 is
told to carry **both** cards exactly — one figure mid-handshake, one standing neutral — while the
prose says they "meet in `handshake`". A handshake requires both hands at one point; the recipe makes
agreement impossible.

This is audit failure #1's class (impossible co-star staging) arriving through a **new door**: not
spatial prose, but the seed recipe. The prose is exemplary — plane, eye line and relative head scale
are all stated, so the new two-cast HARD lint passes cleanly. Lint cannot see this.

Generalisation: every `interaction` slug (`handshake`, `handoff`, `fistbump`, `action-tugofwar`) is
structurally unusable under two-step seeding. The cast-cap table in `visual-grammar.md §2` has no
slot for one.

**B3 — `lettering-marker-italic` seeds ZERO of the 14 text-bearing frames. [verified]**
`style-bible.md §5` is LOCKED: "`refs/env/lettering-marker-italic.png` **seeds every text-bearing
gen**." `forge.py` routes environment/prop seeds **only** from a shot's `assets` block. The fresh file
declares **no `assets` block on any of its 41 shots**, and forge has no auto-injection for lettering
(unlike the crowd rig, which is derived from `figures.crowd`).

| | text-bearing frames | lettering exemplar seeded |
| --- | --- | --- |
| archived (same span) | 12 | **12** |
| fresh | 14 (L04, L05, L06, L07, L21, L22, L23, L26, L28, L31, L34, L35, L36, L37) | **0** |

Every literal in the fifth — `'1983'`, `'26,000'`, `'HARD DRIVE'`, `'MINISCRIBE'`, `'125 MILLION'`,
`'600 MILLION'`, `'1988'`, `'TODAY'`, `'1984'` — renders with no register anchor. The predicted
failure is exactly the register the bible forbids: a clean digital font instead of marker capitals.
Neither lint nor forge guards it. This is a silent regression against the problem-era file.

**B4 — Payload ordering is systematically inverted on every text-bearing non-delta shot. [verified]**
`visual-grammar.md §2` ordering law: identity → scene → **payload LAST, as the final clause**.

All 41 fresh prompts end on `"Framing: … Palette: …"`. On deltas that is fine (the change is stated
last, then the sanctioned closing formula) — deltas are correct. On non-delta text shots the quoted
literal is buried:

| | non-delta text-bearing shots | literal is the final clause |
| --- | --- | --- |
| archived (same span) | 7 (L05, L23, L30, L34, L35, L37, L39) | **7** |
| fresh | 9 (L04, L21, L26, L28, L31, L34, L35, L36, L37) | **0** |

Worst case L28, where `'MINISCRIBE'` sits in the **first clause** (forced there by the carry-window
collision, friction #1 — see D). "Burying the payload mid-prompt costs the payload" is the file's own
law, and the file breaks it nine times.

**B5 — Real cut cadence breaches the band; declared `duration_s` is fiction. [verified]**
Holds computed from the real VO word timings (the manifest exists and has forced-alignment timings
for all 1,632 words), not from the header's 175 wpm:

| shot | real hold | declared | verdict |
| --- | --- | --- | --- |
| L31 | **4.96 s** | 2.6 | over the 4 s hard ceiling by 1 s, on a static carton stack against sky |
| L26 | **4.36 s** | 3.5 | over ceiling — and it is the **cast-free plate**: 4.4 s of empty factory on the beat that names the company |
| L03 | **4.00 s** | 2.3 | at the ceiling — the designated opening peak, a dark unlit warehouse |
| L35 | 3.80 | 2.7 | over band |
| L23 | 3.55 | 2.5 | over band |
| L27 | 3.52 | 2.6 | over band |
| L34 | 3.28 | 2.6 | over band |
| L38 | 3.14 | 2.4 | over band |
| L10 | 3.12 | 2.6 | over band |
| L20 | 3.10 | 2.0 | over band |
| L01 | **1.45 s** | 2.5 | below the 1.5 s floor — the video's opening frame |

11 of 41 shots (27%) fall outside 1.5–3 s; three exceed the 4 s earned ceiling. Declared durations
diverge from real holds by up to **+2.36 s** (L31). The author's report claims "avg hold 2.45 s,
inside the 1.5–3 s band" — that is an average over the declared numbers, which is not the cadence the
render will produce. Act 1's real span is **103.34 s**, not 100.5 s; the real VO is 539.5 s at
181.5 wpm, not 559.5 s at 175 — so the whole-file lint floor derived from the header is also wrong.

Fixing this is $0 **now** and a re-author + regen later.

### A.1 Shot-by-shot

Clean, no flag: **L24, L30, L32, L39, L40.** (L32 and L40 are the two strongest shots in the fifth —
rich, populated, correctly crowd-declared, correctly place-anchored, register-appropriate.)

| id | flags |
| --- | --- |
| **L01** | **B5** (1.45 s, below floor). MAJOR: the video opens on furniture — 12.3 s pass before any figure appears (see A.2). MINOR: the maze screen draws Pac-Man one line before the VO names it, and L01/L02 present the "big hair, Pac-Man" pair in reverse order. |
| **L02** | MAJOR: **feasibility-gate violation.** The delta puts a wig stand "on the shelf above the television", but L01's base establishes only "a boxy television on a low walnut cabinet" — there is no shelf. The parent must reserve the space its one delta needs; here the delta invents structural geometry, which forces the model to re-invent the wall. |
| **L03** | **B5** (4.00 s). Doctrine execution is good — legal cast-free plate, `owner_ambiguity: true` well-argued, positive-absence phrasing ("stands completely blank and unlettered") exactly right. MINOR: as the declared opening peak it is three wrapped pallets in the dark; it is doing plate duty and hook duty at once and loses both (see C2). |
| **L04** | **B3, B4.** MINOR: the camera position relative to the window card vs. the back-wall shelf bays is under-specified. |
| **L05** | **B3.** Otherwise a clean delta; L-1 re-quote of `'1983'` correct. |
| **L06** | **B3.** MINOR: the crowd "packs the room on the far side of the counter" — rear-zone staging is correct, but it sets up L07. |
| **L07** | **B3.** MINOR: the payload (all three bays bare) sits behind the crowd L06 just installed; occlusion risk on the one thing the shot must show. |
| **L08** | MAJOR: the shop's set is re-invented from text with **no anchor** (`seeds=0`, plate). L04–L07 held the shop by chain parent; L08 leaves the stage and returns to the same room unanchored, so counter, shelving and door will not match. Thin scene (box + pegboard + wall). The tableau treatment of the idiom is right. |
| **L09** | MAJOR: same set-holding hole — `seeds=[crowd-exemplar]` only, the shop re-invented a third time. The shot itself is the best non-literal idea in the fifth. |
| **L10** | **B5** (3.12 s). MAJOR: `` `prop-drive` `` is backticked but there is no `assets` block, so forge does **not** seed it — the literal control token `` `prop-drive` `` ships in the prompt text unresolved. **[verified: slate seeds = pc-boxy, expr-delighted only]** GOOD: `pc-boxy` correctly gets expression-only with stance in words, honouring the `no_hands` registry note — the archived file violated exactly this at its L16. |
| **L11–L14** | MAJOR: four consecutive frames of one object on a plinth in "an empty grey room", "the back wall stands smooth and empty" — ~8.6 s. `style-bible.md §5` requires environments "rich, not sparse: name the real furniture of the place; no dead air". This is the sparsest block in the fifth and is the rework-era regression the brief warns about. MINOR: L11's red on the vault-wheel spokes is decorative, not alarm/ownership/punch. MINOR: L13 covers both "files" and "applications" in one delta, so "applications" is unrepresented. |
| **L15** | MINOR: "twelve identical beige computer cases" — an exact count a stochastic model will not honour; the doctrine's own preference is a completion state ("ranked the length of the shelf") over a number. |
| **L16** | MINOR: `shot_class: staged-interaction` with no personified party — two unfaced boxes. Class stretch; the notes argue it, and not minting a slug for a one-line analogy is the right call. |
| **L17** | MAJOR: the analogy inverts. The VO is "like Samsung and Apple fight over the **phone** market", but the delta puts the two phone slabs "wedged upright into the same shove … **dwarfed by** the beige cases" — the phones read as being crushed by the PCs, not as fighting each other. |
| **L18–L19** | MAJOR: "the hard drive manufacturers were quietly raking it in" is a beat about **people**, staged "quiet and empty of figures" with an unattended rake. Grammar: "symbolic, physicalized-imbalance and ironic-counterpoint shots remain full representative scenes, never the same scene with its people removed." The archived L19 had a working crew around the same rake. MINOR: L18 authors "the racket of the front room" — a sound, undepictable. |
| **L20** | **B5** (3.10 s). MAJOR: "They were the **people selling** picks and shovels" — the fresh stall has **no seller**. The line's story-bearing role is deleted and replaced with an unattended counter. Archived L20 had "an apron-wearing merchant crowd serves picks and shovels from a plank trestle". This is the single clearest instance of the depopulation failure. |
| **L21** | **B3, B4.** Good: seeds off the L03 plate (`seeds=[L03]` **[verified]**), literal sourced, disclosure order held. |
| **L22** | **B3.** MAJOR: physical contradiction. L03 and L21 both establish the pallets "wrapped hard in clear film" / "shrink-wrapped"; the delta then folds a carton's flaps open **through** the film. The parent's own established state forbids the change. Fix: cut the film back on the front carton in L21, or drop the film from the front row. |
| **L23** | **B3, B5** (3.55 s). Delta payload ordering correct. Two literals, 3 words, inside caps. |
| **L25** | MINOR: "bare room … empty and grey"; the red cord is decorative rather than semantic. |
| **L26** | **B3, B4, B5** (4.36 s, over ceiling). The doctrine work is genuinely good — legal plate, `place_owner: "MINISCRIBE"` quoted verbatim, ownership drawn rather than implied. But the shot is 4.4 s of a cast-free empty factory on the beat that names the company, and it is the plate law that forced that (see D2). |
| **L27** | **B5** (3.52 s). Reveal anchored to the naming line ✓, seeds off the plate ✓. MINOR: `expr-thinking` is an odd register for a founder's introduction; MINOR: "founded in 1980" — the year is never depicted. |
| **L28** | **B3, B4** (worst case: the literal is in clause 1). MAJOR: "the assembly floor runs at full tilt, every bench crowded" with **no `figures.crowd`** declared. A factory at full tilt with zero declared crowd invites the model to invent humans that receive **no crowd-rig clause** — un-rigged figures are precisely how face/proportion drift enters. Declare `crowd: true` or stage the floor as machinery only. |
| **L29** | **B2** (blocking). Prose is exemplary: plane, eye line and relative head scale all stated, so the new two-cast HARD lint passes — which is exactly why B2 is dangerous. |
| **L31** | **B3, B4, B5** (4.96 s — the worst hold in the file). MINOR: "**stencilled**" is a lettering-technique word that contradicts the locked marker-capitals register (§5); it is not on the banned-terms list, so lint is silent. |
| **L33** | MAJOR: "giants like **Compaq**" is staged as an unlettered crate. The disclosure law does not forbid the literal here — the script speaks "Compaq" **in this very line**, so it is legal `script_vocab` (the archived L34 drew `'COMPAQ'`). Unlabelled, the crate does not read as a customer, and the beat loses its referent. |
| **L34** | **B3, B4, B5** (3.28 s). Good number-glued-to-object work; both literals adjacent to their own element. MINOR: "stencilled"; MINOR: decorative red on the banding. |
| **L35** | **B3, B4, B5** (3.80 s). The one explainer device, correctly rationed and honest about the hedge. |
| **L36** | **B3, B4.** The strongest turn in the fifth. MINOR: "stencilled". |
| **L37** | **B3, B4.** MINOR: "leaves torn backward" describes a process, not a renderable state; the visible state (loose pile + exposed `'1984'`) carries it anyway. |
| **L38** | **B5** (3.14 s). MINOR: a **customer** physically blocking the supplier's own shipping doorway is a slightly muddled cause→effect for "IBM slashed its orders"; the cut banding and lowered ramp do most of the work. |
| **L41** | **B1** (blocking). See A.0. |
| thumbnail | MAJOR: challenger 2 personifies a clay brick "with the cast's **round dot eyes** and a wide smug grin set into its face" — (a) an un-minted faced character with no slug and no canonical, (b) rig prose written into a prompt, which the grammar bans, and (c) **dot eyes are the §2d CROWD rig**, not the cast rig. MINOR: the primary bakes `'HARD DRIVE'` **and** overlays "Certified hard drive" — two competing texts at 168 px. GOOD: unlike the archived primary ("softly out of focus"), the fresh thumbnails carry no banned render language. |

### A.2 Occupancy — the cross-cutting per-shot finding

**[verified census]** Fresh: 6 shots name cast (one of which is an object, `pc-boxy`), 6 declare
crowd, **29 of 41 contain no figure of any kind (71%)**. Archived, same span: 17 cast + 11 crowd,
14 figure-free (34%).

Consequences that read on screen:
- The first named character appears at **L10** (an object) at t≈21 s; the first **human** at **L27**,
  t≈57 s. The video's opening 12.3 s (L01–L05) contain nothing alive.
- Longest unbroken figure-free run: **L11→L19, nine shots, 19.6 s**. Second: **L21→L26, 17.4 s**.
- `visual-grammar.md §1`: "Non-literal changes the depiction, **not the scene's occupancy**" and
  "a story-bearing foreground individual … must not be replaced with an empty object merely to avoid
  a figure." L18/L19 and L20 violate this directly; the block as a whole violates it in aggregate.
- The channel's own identity is "no on-screen narrator — the SCREEN is a CAST" (`style-bible.md §1`).

This is not a lint violation and never will be — it is a taste call, and it is the one Daniel should
rule on before 167 more shots are authored to the same pattern.

## B. Structured diff vs the problem-era file, same script span

The archived file covers this span in L01–L42 (L27 absent) = **41 shots, identical density**. The
fresh file did not densify; it re-staged.

### B.1 What the fresh file KILLS (and which audit failure class dies with it)

| # | Difference | Old → new | Failure class killed |
| --- | --- | --- | --- |
| K1 | **Style vocabulary** | old: 8 soft/gloss hits in span (`glossy` L02/L10/L18, `polished` L12–L15, `glow`/`glowing`/`shimmer` L10/L29) → fresh: **0** **[verified]** | Audit #9 / mechanism 1 — the style contradiction is dead at the authoring layer. The single biggest win. |
| K2 | **Anonymous foreground individuals** | old L08 "one counter-side shopper holds a fat handbag tipped over the counter"; old L22 "the nearest inventory worker … looks directly toward the viewer" → fresh: **zero** anon individuals; all six crowd shots staged as rear-zone mass (far side of a counter / behind window glass / far side of the racks / across a creek / out through a rear doorway) | The un-rigged-figure tier. Friction #7 notwithstanding, the staging is honest, not thesaurus-gamed. |
| K3 | **Semantic cast** | old personified `miniscribe-rep`/`ibm-suit` onto 17 frames including purely generic beats (L31–L35 cash stacks, L34 "giants") → fresh names a figure only where the script names a person or party: L27 Terry, L28 the company on "they", L29 IBM+Terry, L38 IBM, L41 Terry | **Audit #7** (named proxies standing in for generic narrated groups) — the B3-era bulk-conversion mechanism cannot fire here. |
| K4 | **Place ownership** | old: zero `place` machinery; drew `'IBM'` and `'COMPAQ'` on other people's signboards but **never MiniScribe's own name** anywhere → fresh: `place_owner: "MINISCRIBE"` drawn on the plant plate and carried under L-1 | **Audit #6** (invisible office ownership). |
| K5 | **Held sets** | old: 0 `place` declarations, every set re-invented per stage → fresh: 2 places with cast-free plates and place-first seeding (L03 → L21/L22/L23; L26 → L27/L28/L29/L32/L38/L40) **[verified in the slate]** | **Audit #4**'s substrate (no held set behind "same box" prose). |
| K6 | **Seated support** | old authored `sit` twice in span — L16 puts `sit` on **`pc-boxy`**, which the registry explicitly forbids ("never seed a human torso POSE frame onto it"), and L34 seats `ibm-suit` colossally → fresh uses **no seated primitive at all**; L10 correctly gives `pc-boxy` expression-only | **Audit #2** (floating seated figures) cannot fire in this fifth, and a concrete archived registry violation is gone. |
| K7 | **Two-cast spatial prose** | old L28 "keeps both founders at natural body scale across the bench" (vague), old L34 deliberately colossal → fresh L29 states plane + eye line + relative head scale explicitly | **Audit #1**'s *prose* mechanism. (B2 re-opens the same failure through the seed recipe — see below.) |
| K8 | **Motion freezes** | old L19 "a crew … sweeping the notes into one neat heap" (mid-action) → fresh L19 rake laid down with drag lines (aftermath); old L21/L22 busy checking tableaux → fresh held states | The mid-motion-freeze class; fresh is markedly more tableau-disciplined. |
| K9 | **Thumbnail render language** | old primary "softly out of focus" → fresh "Plain warm ochre background carrying nothing else, the figure lit flat and full" | Style drift in the one asset that never gets re-reviewed. |

### B.2 What the fresh file LOSES

| # | Loss | Old → new | Cost |
| --- | --- | --- | --- |
| L1 | **Lettering seed route** | 12/12 → **0/14** text frames **[verified]** | B3. A LOCKED §5 law, silently dropped. |
| L2 | **Payload-last discipline** | 7/7 → **0/9** non-delta text frames **[verified]** | B4. |
| L3 | **`assets` blocks entirely** | old declared them on **134 of 214** shots (props, lettering, env) → fresh **0 of 41** | Root cause of L1 and of L10's unresolved `` `prop-drive` ``. Every prop/lettering/environment seed route in the pipeline is unused. |
| L4 | **Occupancy** | 27/41 → 12/41 figure-bearing **[verified]** | A.2. |
| L5 | **Named customers drawn** | old drew `'IBM'` (L30) and `'COMPAQ'` (L34) → fresh drops both; L33's "giants" beat is an unlettered crate | The two customer beats lose their referent, though the script speaks both names. |
| L6 | **Hex-exact red** | old wrote `#d7402b` into 5 prompts → fresh writes "one red accent" in 10, hex in **0** | §4 pins the exact value; the fresh phrasing lets the model choose the red. |
| L7 | **Power-relation staging instinct** | old L30 has `ibm-suit` lifting `miniscribe-rep` off the floor by his collar out of a line of rivals; old L34 has a colossal seated `ibm-suit` whose knees fill the frame above a tiny offering figure | These were the archived file's *good* instincts — legible, funny, on-thesis power relations staged as bodies. Fresh replaces both with a handshake and an oversized crate. Reset zeal cost the two most comic frames in the span. |
| L8 | **Density** | 41 → 41 shots for the same span | The fresh file inherited the archived file's cadence problem instead of fixing it (B5). |

### B.3 Net

The fresh file is **decisively better on the five audited mechanisms** (style contradiction, seeded
drift, feasibility prose, semantic cast, place ownership) and **materially worse on the mechanical
plumbing** the archived file happened to get right (lettering seeds, payload ordering, `assets`
routing) plus one taste axis (occupancy) that no law enforces. That split matters: the audited
mechanisms were the hard problems and they are genuinely solved; the regressions are cheap to fix
and mostly mechanisable.

## C. Prospective problems — new failure modes this authoring style can produce

**C1 — 19 of 41 frames are seedless text-only roots (46%). [verified: `seeds=0, plate=True` on
L01, L03, L04, L08, L11, L15, L16, L18, L24, L25, L26, L30, L31, L33, L34, L35, L36, L37, L39]**
This is the highest style-variance surface the pipeline has ever carried. Each is an independent draw
of the hardened descriptor with no pixel anchor. The archived era's roots were at least anchored by
STEP-1 figures (which is what carried the drift — the reason they were removed). The new risk is the
mirror image: not inherited drift, but **cross-frame incoherence** — 19 different readings of "flat
cel" in one act. The §4 probe as specified (1 plate + 1 STEP-1 + 3 composed frames, "Daniel rules
flat/not-flat") measures *flatness*, not *consistency between unanchored roots*. It should be
re-scoped: at least three seedless roots drawn from different content classes (interior, object
insert, landscape), judged **against each other**, not only against the bible.

**C2 — Plate-first frames doing double duty as hooks.** L03 is simultaneously (a) the place plate,
which must be cast-free and must contain nothing that shouldn't bleed into L21/L22/L23, and (b) the
video's designated opening peak. The plate law optimises for neutrality; a hook optimises for the
opposite. You cannot sharpen L03 without polluting the chain, and you cannot neutralise it without
killing the hook. This tension recurs at every branded place in every future video and is currently
unaddressed in the doctrine.

**C3 — Owner-literal vs cast-slug collision is a recurring ordering bug, not a one-off.**
`MINISCRIBE` is a word-boundary substring of `miniscribe-rep`, so `carried_literal_check` demands the
literal be re-quoted within ~60 characters of the slug. `miniscribe-rep` appears in `miniscribe-plant`
across acts 1, 3 and 4 — every such shot will push its payload into the identity zone (L28 already
does). It has already distorted a **casting** decision once (L29 casts `terry-johnson` rather than the
personification, by the author's own admission). A lint rule steering casting is the exact class of
thing the doctrine forbids.

**C4 — Cadence budget is built on the wrong numbers.** The skeleton plans 208 shots against 559.5 s
at 175 wpm; the real VO is 539.5 s at 181.5 wpm, and the word timings are already on disk. If fifths
2–5 are authored with the same declared-duration method, the same ~25% band breach recurs four more
times, and it will only be discovered at render.

**C5 — L41's tail anchor** absorbs 1,346 words. Harmless while partial, but nothing has yet validated
the seam: `--write` still refuses (HARD present), so `vo_text` is underived, and the fifth-1/fifth-2
anchor boundary has never been exercised. A wrong seam is invisible until the whole file lints clean.

**C6 — Seed-cap arithmetic is completely untested by this fifth. [verified: max 3 seeds, cap 4 never
reached, displacement never fires]** Acts 2–4 contain the file's only 4-seed shapes (2 cast + crowd +
place: Wiles' stand-up firing, the boardroom quota beats, the test count). Add a tagged prop — or
reinstate the lettering exemplar per B3 — and those shots hit 5 seeds, firing the crowd-displacement
rule **for the first time on the most complex shots in the video**, unrehearsed. The displacement rule
deserves a deliberate exercise before act 3.

**C7 — `interaction` vocabulary is a landmine for acts 2–4.** B2 is not L29-specific. The H&Q money
handoff, the lockbox swap, the settlement and the verdict all want two-figure interactions. Unfixed,
every one reproduces B2.

**C8 — Character entrances into held sets have no authored path.** L41's refusal ("exactly one proved,
unique primitive") will recur at Wiles entering the boardroom, the auditors entering the plant, the
foreman returning with a pink slip. The likely author response — drop the expression to satisfy the
gate — silently loses register on exactly the beats that carry the emotion.

**C9 — Under-declared crowd.** `figures.crowd` is the only route by which the §2d crowd-rig clause
reaches a prompt. L28 authors a factory "at full tilt" with crowd undeclared. Any "busy"/"packed"
scene without the declaration invites un-rigged invented humans — a rig-drift entry point that
did not exist in the archived file's noisier but more consistently crowd-declared staging.

**C10 — De-population as house style.** If A.2's pattern continues, the finished video is ~70%
still-life on a cast-driven channel. This compounds: fewer figures means fewer STEP-1s means less rig
exposure means the rig gates never fire — the run will look clean on every rig axis and still not be
the channel's video.

## D. Friction-findings verdict

The author reported nine items; the brief names four. All nine ruled, the four named first.

**F1 — carry-scan / cast-slug collision → REAL DOCTRINE DEFECT. Fix before more authoring.**
Confirmed mechanism (`MINISCRIBE` is word-boundary-matched inside `` `miniscribe-rep` ``). Confirmed
consequences: L28's payload sits in clause 1 (B4's worst case), and the rule bent a casting decision
at L29. Fix is small and surgical: strip backticked vocabulary spans from the prompt body before
`carried_literal_check` scans it. Until then the rule can push an author to draw signage into frames
that do not contain the sign — a lint rule manufacturing content, which is the fabrication class the
text laws exist to prevent.

**F2 — plate law vs character-reveal law → REAL, but a design tension, not a coding defect.**
It bites measurably: L26 holds **4.36 s** (over the hard ceiling) on a cast-free plate at the naming
beat, and the personification's entrance slips two shots to L28. Two honest options: (a) amend the
plate law so a place's plate need only be **cast-free**, not **first-in-file** — let the naming line
carry the cast-bearing reveal and mint the plate on the next figure-free beat in that place, with
forge keying `place_first` to a declared plate rather than file order; or (b) accept the 1–2 shot lag
as the price of set-holding and stop calling it friction. Either is defensible; leaving it undecided
means every branded place in every future video re-argues it. Note (a) is a real code change to
`forge.py`'s `place_first`/`place_last` walk and to lint's conditional plate law — not a doc edit.

**F3 — `owner_ambiguity` framing → REAL but DOC-ONLY, cheap, do it.**
The author is right and the risk is concrete: an author reading ambiguity as the weaker answer will
invent signage. One sentence in `shots-schema.md`'s place-owner law stating that ambiguity is a
first-class answer, with the L03 warehouse as the worked example, closes it. No code.

**F4 — "recurring set" undefined at the 2-shot boundary → REAL DOCTRINE DEFECT, and it already cost
a set-holding hole.** The doctrine contradicts itself: `SKILL.md` says "declare `place` on every shot
in a recurring set" while `shots-schema.md`'s conditional plate law defines qualification as "**≥2
shots declare it**" — circular, because whether it qualifies depends on whether you declared it.
The author's narrower reading ("revisited after leaving") produced a concrete defect: the 1983 shop
is drawn by **six** shots (L04–L09) with no `place`, so L08 and L09 leave the stage chain and
**re-invent the room from text with no anchor** (A.1, `seeds=0` / `seeds=[crowd-exemplar]`
**[verified]**). Fix: define a place by the SET — "any diegetic set drawn by ≥2 shots is a place; a
stage chain inside a place needs no additional plate, because the chain base *is* the place-first
frame." That wording gives the shop a place at zero extra generation cost (L04 is a legal cast-free
plate already), and it does **not** produce the author's feared "8 places / 6 wasted plate frames".

**F5 — place-exempt classes force class choice by mechanism → PARTLY REAL, low priority.**
L33 went off-place to keep the class honest and lost its setting; that is a real cost but a small one,
and it is genuinely an authoring judgment (the beat could have been authored as `literal` or
`ironic-counterpoint` staged on the plant floor). Worth one doc line; not blocking.

**F6 — action-chain lint is silent once a chain is declared → NON-ISSUE as framed, but the
observation underneath it is the run's biggest process gap.** The boundary is correct: lint must not
judge coherence. But the author's own closing note is the real finding — **the Step-8 critic was not
run**, so 41 shots were about to generate with zero coherence review, and the author is proposing to
defer the critic to "the assembled whole", i.e. after four more fifths have been authored to whatever
patterns this one established. Run the critic on this fifth now, at $0. It is the gate that would have
caught L17's inverted analogy, L20's missing sellers and L22's shrink-wrap contradiction.

**F7 — `_ANON_INDIVIDUAL` guard is thesaurus-gameable → REAL but ACCEPTED.** Lint cannot judge
staging; the guard is a floor. The author staged all six crowd shots honestly with real rear-zone
geometry, which is the correct response. No change.

**F8 — the suffix contains the words the grammar bans → NON-ISSUE, but the doc line is free.**
Correct as designed (one voice, one home). Add "the suffix says this so your prompt never has to" to
`visual-grammar.md`'s suffix paragraph.

**F9 — Step-8 critic not run → see F6.** Not a friction; a missing acceptance step.

**Frictions the author did NOT report, and should have.** The four reported doctrine collisions are
real, but the three that actually block generation went unnoticed: the forge dry-run was never run
(B1), the `interaction`-kind seeding path was never traced (B2), and the disappearance of `assets`
blocks — and with them the LOCKED lettering seed — was never noticed (B3). A friction list is only as
good as the mechanical checks behind it.

## E. Verdict — **FIX-DOCTRINE-FIRST**

Not GREENLIGHT: the fifth does not generate at all (B1), its only two-cast shot carries a physically
unsatisfiable recipe (B2), every literal in it renders without its register anchor (B3), and 27% of
its shots breach the cadence band against the real VO (B5).

Not RE-AUTHOR: the fifth's *doctrine conformance* is the strongest work this video has produced.
Style vocabulary is clean (0 hits vs the archived 8), semantic cast is disciplined, place ownership is
drawn rather than implied, sets are held by plates, anonymous foreground individuals are gone, the
two-cast prose states plane/eye-line/head-scale, and the quarantine machine-check passes (5/5 `fig-*`
= GENERATE). Re-authoring would throw that away to fix problems that are mostly mechanical. The
authoring pattern is sound; the doctrine has holes the author could not route around, plus a bounded
repair list.

### E.1 Doctrine changes required before any further authoring (all $0)

| id | change | files |
| --- | --- | --- |
| **DC1** | **Interaction primitives.** An `interaction`-kind slug must never bind to a single character in `_split_primitives` / `figure_frame_name`. Either route it as a scene-level seed alongside both STEP-1 cards (3 seeds, under cap), or ban it in two-step shots and author the gesture in prose on both figures. Add a HARD lint. | `forge.py`, `lint_shots.py`, `visual-grammar.md §2` cast-cap table |
| **DC2** | **Lettering seed becomes DERIVED**, like the crowd rig: forge auto-appends `lettering-marker-italic` to any scene whose prompt carries a quoted literal; lint HARD-fails a text-bearing shot with no lettering route. A LOCKED style law must not depend on an author remembering an `assets` block. | `forge.py`, `lint_shots.py` |
| **DC3** | **Payload-last check.** A non-delta shot carrying a quoted literal must end on that literal's clause. HARD in lint, plus a forced row in `critics.md`. | `lint_shots.py`, `critics.md` |
| **DC4** | **`carried_literal_check` strips backticked spans** before scanning the prompt body. (F1) | `lint_shots.py` |
| **DC5** | **Character entrance in a delta.** State the rule: when a named figure is ABSENT from the parent frame, the delta may prove up to two primitives (pose + expression), or the entrance must be authored as a fresh stage base. Today the author gets a refusal with no legal path. (B1/C8) | `forge.py`, `shots-schema.md` |
| **DC6** | **Place definition.** "Any diegetic set drawn by ≥2 shots is a place; a stage chain inside a place needs no extra plate — its base is the place-first frame." Resolves the SKILL.md/shots-schema circularity. (F4) | `SKILL.md`, `shots-schema.md` |
| **DC7** | **Cadence from real timings.** Lint derives each shot's real hold from `voiceover.manifest.json` word timings when present, and HARD-fails a hold >4 s or <1.5 s. This is the check that catches L31 (4.96 s) and needs no new data. (B5) | `lint_shots.py` |
| **DC8** | **Doc lines:** `owner_ambiguity` is a first-class answer (F3); "the suffix says this so your prompt never has to" (F8); a place-exempt class may be traded for a non-exempt one to keep a beat on its set (F5). | `shots-schema.md`, `visual-grammar.md` |
| **DC9** | **Re-scope the §4 style probe:** include ≥3 seedless roots from different content classes, judged for consistency **with each other**, not only flat/not-flat. (C1) | spec §4 |

### E.2 Shot repairs to this fifth (no re-author; ~14 edits, $0)

R1 L41 — resolve the entrance (declare the expression + restage the pose in prose, or make it a fresh
base). **Currently un-generatable.**
R2 L29 — remove `handshake`; author both figures' arms in prose (or wait for DC1).
R3 Cadence — split anchors on L31, L26, L03, L35, L23, L27, L34, L38, L10, L20 so no hold exceeds 3 s;
merge or extend L01 above the 1.5 s floor. Act 1 lands at ~47–50 shots, not 41.
R4 L22 — cut the film back on the front carton in L21 so the flap-open delta is physical.
R5 L02 — put the shelf above the television into L01's base.
R6 L04–L09 — declare `place: pc-store-1983` with L04 as its plate; `place_anchor` on L08 and L09.
R7 L20 — stage the sellers at the trestle. L18/L19 — put the manufacturers' crew in the back room.
R8 L11–L14 — furnish the vault room; it is a room, not a void.
R9 L33 — letter `'COMPAQ'` on the receiving crate (legal `script_vocab`, spoken in the line).
R10 L28 — after DC4, move `'MINISCRIBE'` to the final clause; declare `figures.crowd: true`.
R11 L31/L34/L36 — replace "stencilled" with "lettered".
R12 Add `assets` blocks routing `prop-drive` (L10) and `lettering-marker-italic` (14 frames) as an
interim until DC2 lands.
R13 Thumbnail challenger 2 — drop the faced brick or mint it as cast; remove the rig prose.
R14 Run the Step-8 critic over the repaired fifth before the probe. (F6)

### E.3 The occupancy question is Daniel's, and it must be answered before fifth 2

29 of 41 frames contain no figure; the first 12.3 s and a 19.6 s mid-run contain nothing alive. That
is a deliberate, consistent authorial choice, it is the mirror image of the archived file's
over-personification, and no lint will ever rule on it. If it is wrong, it is wrong 167 more times.
Ask for the ruling with the two boards side by side, not in prose.

### E.4 Acceptance for the re-check

`lint_shots.py` clean (partial-coverage artifacts only) **and** `forge.py batch` completing with a
written slate **and** every real hold inside 1.5–3 s (4 s earned) **and** every text-bearing frame
carrying a lettering route. Only then the §4 probe, re-scoped per DC9.

# The Second Take — Visual Grammar (depiction law)

**What this is:** how The Second Take decides WHAT a shot depicts and HOW it is staged — the doc
`visual-prompt-writer` reads when authoring `shots.json`. The LOOK is `style-bible.md`; the asset
vocabulary is `registry/registry.json`; the depiction bar is `../example-shots.md`; writing craft is
`../storytelling-grammar.md`. Within-shot motion and the stretch-to-fill rule live in `universal.md`
§13a-i/§13a-ii and are **BINDING**. This channel's **cut cadence is the dial on top of them: a new
shot every 1.5–3s; up to 4s only where the beat earns it** — so a shot list carries at least
`Estimated runtime ÷ 4s` shots (lint-enforced), and a gap closes by densifying, never by lengthening
a hold.

**`global_prompt_suffix`** — fixed channel data, copied verbatim into `shots.json`, appended to every prompt:

> clean flat cel-shaded cartoon style, an even medium-thick dark warm brown-black #241a12 outline on
> everything, flat colours with gentle soft cel shading, rounded friendly shapes, no realistic
> detail, hand-lettered marker capitals for any in-world text

The suffix carries texture, line weight, and art style — and it is the ONLY place they are stated. A
`still_prompt` describes **CONTENT and nothing else**: layout, orientation, the action, the committed
scene palette, light, era, and depth. Never write art-style, texture, or line-weight words into a
prompt (no "flat cel", "clean vector", "even outline", "hand-lettered marker style") — this suffix and
`style-bible.md`'s forge descriptors already inject every one of them, and repeating them spends the
prompt's weight on the look instead of on the scene.

**Author absence as a positive STATE of the surface, never as a "no X" list.** "Every surface blank and
unlettered", "an empty street", "a bare desk" — not "no signs, no words, no labels". Our generator reads a
negation list as content and draws the very nouns it was told to omit, so each "no X" raises the odds of
an X. One clean positive description of what the surface IS replaces the whole list.

## 1. What to depict — classify, then invent

Read the line → name its narration TYPE → pick the shot CLASS → **INVENT a fresh, on-style shot in
that class.** A grammar, not a phrasebook: same-typed lines must yield visibly different images, and
each class carries a RANGE (a staged interaction: handshake, tug-of-war, handoff, one figure looming).

| When the narration is… | Show a shot of class… |
| --- | --- |
| an abstract force/property/state (trust, inflation, dominance, "cut off") | **symbolic stand-in object** or **personification** — one concrete object/creature that *embodies* it |
| a relationship/deal/conflict between parties | **staged interaction** between personified parties (handshake, linked arms, tug-of-war, argument) |
| an institution/nation/company as an actor | **personified character with one identity tag** (flag-tie, hat, uniform) or its **iconic landmark** |
| a bare number/stat/date/quantity | **number glued to its referent object**, a **diegetic dateline**, or a **countable mass** |
| a comparison or a trend | **physicalized imbalance** (tipping scale, relative size) or a **deliberately-crude in-world chart** |
| a historical event/announcement/shock | **diegetic media** (period TV/radio/newspaper) or a **dialogue reenactment** |
| a mechanism / "how it really works" | **register-shift to a clean infographic + animate the one transform** |
| a plan/spatial move/territory | **top-down map or plan-view with tokens/arrows/color-fills** |
| a claim/boast/euphemism/spin | **ironic counterpoint** (image contradicts the words) or **literal-unmasking** |
| a dry aside/punchline | **reaction shot on the payload word** or a **deadpan cutaway to a mundane/absurd object** |
| a line with a vivid verb/idiom | **draw the phrase literally** (a visual pun on the idiom, not the fact) |
| a grim/violent/tragic beat | **aftermath / witness / stylized-safe + palette shift** — never gore |
| scale/magnitude | **scale as argument** (relative size) or **crowd multiplication** |
| a real physical action/object | **literal depiction** (the one place it's correct) |

Record the class by its canonical name from the `shot_class` enum (`shots-schema.md §1`).

**The literal / non-literal bar:**
- **Non-literal is the DEFAULT** — draw what the beat MEANS, never the words of the sentence.
- **Literal is reserved for a concrete physical action or object** the line actually describes.
- **When a line could go either way, go non-literal** — skew harder than the shipped reference set.
- Non-literal changes the depiction, not the scene's occupancy: symbolic, physicalized-imbalance and ironic-counterpoint shots remain full representative scenes, never the same scene with its people removed.
- The calibration is `../example-shots.md`: match its depiction THINKING, never clone its content.
- A shot that merely draws its line's words is a failure → reclassify it.
- **Choose the beat's subject, not a population:** use people for person, decision, relationship,
  action, or reaction beats; use an object, place, document, or mechanism when that is the subject.
  Neither is globally preferred; never add or remove people to satisfy a population target.

**Chain logic:** one idea per FRAME. Consecutive shots on ONE set share a `stage` — the `base` establishes
it, each `delta` changes exactly ONE physically feasible semantic transformation, **≤3 deltas**, then a re-base or a hard cut. A world,
setting, subject, or register change is a **hard cut**, never a delta. **A delta PROMPT is a compact
restatement of the held scene, then the change as its FINAL clause** — the base's identity and
load-bearing facts carried over tightened, never re-invented or paraphrased into different nouns, closing
on the one change plus "only this changes; everything else exactly as established". A delta regenerates
the whole image, so whatever goes unstated gets re-invented, and the change stated last is read as the
edit rather than as one more scene fact (§2 ordering law). **Disclosure order:** an image never shows
what the VO has not yet said — a withheld entity is absent entirely from every earlier shot.

**Feasibility gate:** the parent must actually reserve the space and state needed by its one delta; a place
anchor is figure-free or already occupancy-compatible with later count/scale demands. Completion states say
`all`, `entirely`, or what `nothing remains`; exact percentage scale, pixel-clear gaps, replacing one person,
or removing/rearranging most of a seeded object rebase from the pre-transient ancestor or use the layered path.

## 2. Staging conventions (our cast on screen)

- **No on-screen narrator; the screen is a cast** (`style-bible.md §1`) that comes and goes.
  **Institutions may be personified cast** with one identity tag, or represented by their iconic
  landmark, building, letterhead, or product as the beat requires; reused consistently.
- **Stage poses that HOLD** — every still is a tableau readable for its full duration, never a freeze
  of mid-motion. Pose menu: a salute · a planted wide stance (triumph/arrival) · presenting an object
  · a held point at a target · arms-crossed appraisal · a slump (defeat) · leaning in (conspiracy) ·
  recoil onto the back foot (shock). A travel or continuous-action beat stages its MEANING as a
  tableau, or lets the change arrive at a cut.
- **Reference cast, poses, and expressions by their registry vocabulary NAME, backticked, inline in
  the prompt prose** — "MacGregor, `expr-smug`, `action-salute`, stage-left, facing right".
  `image-generation` resolves each name to its file. **A cast name may be authored and minted at the
  Pass-1 gate** — a backticked cast name absent from `registry.json` is an authoring gap
  `image-generation` surfaces there for approval. **A pose, interaction, or expression name must
  ALREADY exist in `registry.json`:** unlike a cast name, a new pose or interaction template is a rare,
  separately gated build — it changes how every figure that uses it is drawn, and a fresh one breaks
  more than it buys. Author from the inventory; if no pose fits, restage the beat.
  A named asset is the authoring act, and the prompt may not narrate what the seed already carries — no
  eyelid, brow, nose, ear, finger, palm, or proportion prose next to a named pose or expression. Prose
  competing with a seed is how one figure's attributes bleed onto another.
- **Props follow the same rule ONLY once they exist.** A prop that recurs across the video and already
  has a library entry is named by that entry (`registry.json` `assets[]` takes a `kind: "prop"` row like
  any other vocabulary). A prop making its FIRST appearance has no name to use: describe it in prose,
  concretely and identically on every shot that carries it, and `image-generation`'s Pass 1 mints its
  canonical from that description at the pre-gen gate. Inventing a plausible-looking backticked slug for
  an unbuilt prop is the failure — it resolves to nothing.
- **Emotion acts through mouth and body, restrained by default:** the beat's lead gets a legible
  expression sized to its register, secondary characters hold one, posture carries the rest. Register
  dial (`../storytelling-grammar.md §1.4`): `expr-smug` on con/boast beats · hopeful-warm on the sell
  · `expr-deadpan` on ironic counterpoint · `expr-worried`/`expr-shock` on the turn · grim-flat on
  human-cost beats. Reserve strong faces for beats that warrant them; a swap is a legitimate delta.
- **Co-stars share eye-line and height** unless the size gap or the disconnection IS the argument. A named face
  that carries the beat states its orientation and the foreground/occlusion protection that keeps it visible.
- **Roles read at a glance.** Named cast wear pinned canonical outfits (`registry.json`) unless the
  shot authors a change; an unnamed role carries 1–2 unmistakable signifiers — a role the viewer must
  deduce is a staging failure.
- **A character reveal lands on the naming moment** — the entrance anchors to the VO line that names
  them, staged sized to the beat (a big reveal: spotlight / low angle / arrival; a minor one: a clean
  introduction), in its canonical expression unless the beat authors otherwise.
- **A recurring identifiable GROUP is cast, not a crowd** — one name, reused every appearance. A group
  member acting alone is staged as an individual.
- **Every human in frame is either NAMED CAST or CROWD — no third tier, no promotion path.** NAMED CAST
  has a backticked slug and a canonical, and it is seeded; CROWD is declared `"crowd": true`
  (`shots-schema.md §2`) and seeded from the crowd exemplar. **A story-bearing foreground individual
  belongs in the planned cast and must not be replaced with an empty object merely to avoid a figure.**
  An anonymous foreground human does not exist; an anonymous person with an individual count, action, or
  face requirement is CAST or the beat becomes mass action. Crowd belongs in a positive rear zone in the
  PRIMARY scene clause — far side of the real table/shelving, behind a divider, through a doorway — never a
  co-planar gathering renamed "background-scale" later. People without a story-bearing identity are staged at
  crowd scale. The prose still stages crowd figures — where they stand, what they do, what they wear,
  dressed for the scene's own era and setting, never the exemplar's period dress — but the RIG wording
  is `forge.py`'s: it expands the `crowd` declaration into the
  style-bible §2d clause at gen time. **Never write that clause text into a `still_prompt`** (lint
  HARD-fails its fingerprint): the reference frames already carry the rig, ~600–1,100 chars of
  boilerplate per shot pushes the prompt into measured adherence decay, and generic figure wording
  sitting ahead of a named character is what bleeds one figure's attributes onto another.

  **Scope law: two-step seeding applies to named-cast FRESH stage-base gens only.** Crowd has no
  canonical, so isolating a step-1 gen buys it nothing — crowd, environment, and prop shots stay
  single-step (crowd exemplar + plate + prose), and delta beats stay single-step too, unchanged.
  Combined with this tier law and the ≤2-cast cap below, no other shot shape exists that a step-1
  figure applies to.
- **The cast cap — at most 2 named cast per shot**, with the slate stated so the cost is visible
  rather than argued:

  | Shot shape | STEP 2's slots (step 1 already ran per figure) | What it gives up |
  | --- | --- | --- |
  | 1 cast, fresh | step-1 figure · **plate** | nothing — 2 slots free |
  | 1 cast + crowd, fresh | step-1 figure · plate · crowd exemplar | nothing |
  | **2 cast, fresh** | step-1 figure A · step-1 figure B · **plate** | nothing — 1 slot still free |
  | 2 cast + crowd, fresh | step-1 figure A · step-1 figure B · plate · crowd exemplar | nothing |
  | 2 cast, delta beat | parent frame · canonical A · canonical B · one changed pose *or* expression | nothing — unchanged, single-step, exactly as today |

  Stated positively: **a fresh two-cast shot is the BASE of a stage; every later two-cast beat in that
  place is a delta on it.** Crowd-rig figures are a mass, not identities, and don't count against the
  cap.
- **Prompt ordering — three zones, in this order.** (1) **Identity first:** the named cast, their
  backticked registry names, and any pinned trait the shot depends on. (2) **Scene second:** setting,
  staging, framing, palette, light, depth. (3) **Payload LAST, as the final clause:** the quoted lettering,
  or on a delta the one change (§1 chain logic). The generator weights earliest mentions heaviest for
  identity and reads the closing instruction most literally, so leading with boilerplate costs identity
  and burying the payload mid-prompt costs the payload.

## 3. Composition — a decision, driven by the payload

Framing, scale, and angle are a choice driven by the one thing the viewer must see (the payload) and
the shot's class. Unchosen, it defaults to a centered eye-level medium — fine once, deadly on repeat:
- **No hand/extremity close-ups — framing stays at body scale.** The rig's schematic 4-digit hands do
  not survive macro framing; show a document/signature/object detail at desk scale, the hand incidental.

A plain centered shot is valid when a beat wants it; the goal is variety across the video, not a rule
per shot. **Negative space follows the payload:** air for a single graphic idea; where the payload is
detail inside an artifact (a brochure's contents, a map's territory, a seal), the artifact fills the
frame. Everything in frame earns its place by meaning, palette code, or staging.

## 4. Lever / register — how our thesis bends each class

- **Ironic-counterpoint / unmasking is our SIGNATURE move, not a garnish** — the visual arm of the
  vindication lever ("you were lied to — here's the mechanism"). When the narrator reports the spin
  (the prospectus's promise, the official line), the image should expose it: reach for this class
  whenever a beat carries a lie, a boast, or a euphemism.
- **Register scales with topic gravity** (`../storytelling-grammar.md §1.4`) — visually, adopt the
  punchline/aside and idiom-pun classes' timing, reaction shots, deadpan-object payoffs, visual puns.
- **Money stories, not finance explainers.** Default to the abstract-force and relationship classes
  (personify the players, stage the deal). Pure-explainer devices (meters, definition cards, bar-chart
  infographics) are baked diegetic scene elements, flavor only — the exception, never the house style.

## 5. Motion direction — our dial

- **Locked camera** — no authored moves except deliberate exceptions. **Hard cuts only**, no transitions.
- **No long-form word-captions** — text is diegetic; shorts keep word-highlight captions.
- **Red is the only emphasis ink**, semantic (alarm / prohibition / ownership / the last punch element).
- **Numbers live in-world** — a baked diegetic element or a delta-chain, never floating text; an
  enumeration realizes as a delta-chain or baked diegetic text.

Full grammar + dial values: `universal.md §13a-iii` + `motion-tokens.json` / `audio-tokens.json`.

## 6. Policy constraints (binding on every prompt)

- **No defamatory depiction of a real named person** — stage the documented mechanism, never an invented humiliation.
- **Analysis, not gore** — a grim beat renders as aftermath / witness / stylized-safe + a palette turn.
- **Evergreen references only** — no memes, wojaks, anime cutaways, or dated internet imagery.

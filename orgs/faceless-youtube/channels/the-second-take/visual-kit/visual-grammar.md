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
- The calibration is `../example-shots.md`: match its depiction THINKING, never clone its content.
- A shot that merely draws its line's words is a failure → reclassify it.

**Chain logic:** one idea per FRAME. Consecutive shots on ONE set share a `stage` — the `base` establishes
it, each `delta` changes exactly ONE element, **≤3 deltas**, then a re-base or a hard cut. A world,
setting, subject, or register change is a **hard cut**, never a delta. **A delta PROMPT is a compact
restatement of the held scene, then the change as its FINAL clause** — the base's identity and
load-bearing facts carried over tightened, never re-invented or paraphrased into different nouns, closing
on the one change plus "only this changes; everything else exactly as established". A delta regenerates
the whole image, so whatever goes unstated gets re-invented, and the change stated last is read as the
edit rather than as one more scene fact (§2 ordering law). **Disclosure order:** an image never shows
what the VO has not yet said — a withheld entity is absent entirely from every earlier shot.

## 2. Staging conventions (our cast on screen)

- **No on-screen narrator; the screen is a cast** (`style-bible.md §1`) that comes and goes.
  **Institutions are personified cast**, one identity tag each (a flag necktie, a hat, an iconic
  building — `style-bible.md §5`), reused consistently.
- **Stage poses that HOLD** — every still is a tableau readable for its full duration, never a freeze
  of mid-motion. Pose menu: a salute · a planted wide stance (triumph/arrival) · presenting an object
  · a held point at a target · arms-crossed appraisal · a slump (defeat) · leaning in (conspiracy) ·
  recoil onto the back foot (shock). A travel or continuous-action beat stages its MEANING as a
  tableau, or lets the change arrive at a cut.
- **Reference cast, poses, and expressions by their registry vocabulary NAME, backticked, inline in
  the prompt prose** — "MacGregor, `expr-smug`, `action-salute`, stage-left, facing right".
  `image-generation` resolves each name to its file; a backticked name absent from `registry.json` is
  an authoring gap it surfaces at its pre-gen gate. Never author body pose, finger mechanics, or
  facial expression as prose — naming the asset IS the authoring act.
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
- **Co-stars share eye-line and height** unless the size gap or the disconnection IS the argument.
- **Roles read at a glance.** Named cast wear pinned canonical outfits (`registry.json`) unless the
  shot authors a change; an unnamed role carries 1–2 unmistakable signifiers — a role the viewer must
  deduce is a staging failure.
- **A character reveal lands on the naming moment** — the entrance anchors to the VO line that names
  them, staged sized to the beat (a big reveal: spotlight / low angle / arrival; a minor one: a clean
  introduction), in its canonical expression unless the beat authors otherwise.
- **A recurring identifiable GROUP is cast, not a crowd** — one name, reused every appearance. A group
  member acting alone is staged as an individual.
- **Anonymous figures are DECLARED, never described in rig prose.** Route each by SIZE
  (`style-bible.md §1`'s three-tier model) and record it in the shot's **`figures`** field
  (`shots-schema.md §2`): small/many/background → `"crowd": true`; LARGE/foreground → one
  `anon_foreground` entry per figure, each entry the **exact phrase the prompt uses for that figure**
  ("the worker at the dock edge"), so the declaration and the prose point at the same body.
  **The anon-vs-cast test is the backticked slug, not recurrence:** a foreground figure with no slug is
  declared here on EVERY shot it appears in; a role that recurs and must hold one identity gets a new
  backticked slug instead (Pass 1 mints it) — never a prose costume re-described shot to shot. The prose
  still stages them — where they stand, what they do, what they wear — but the RIG wording is
  `forge.py`'s: it expands each declaration into the style-bible §2d/§2e clause at gen time, in
  establishment or held wording per `stage_role`. **Never write that clause text into a `still_prompt`**
  (lint HARD-fails its fingerprint): the reference frames already carry the rig, ~600–1,100 chars of
  boilerplate per shot pushes the prompt into measured adherence decay, and generic figure wording
  sitting ahead of a named character is what bleeds one figure's attributes onto another.
- **Figure cap — plan ≤5 must-stay-distinct figures per shot.** Five is the generator's
  character-reference budget; past it, figures that must read as different people collapse into each
  other. Interaction is harder than mere co-presence, so **>3 figures in physical interaction** (touching,
  handing over, grappling) is flagged high-risk in `notes` and restaged as co-presence where the beat
  allows. Crowd-rig figures are a mass, not identities, and don't count against the cap.
- **Prompt ordering — three zones, in this order.** (1) **Identity first:** the named cast, their
  backticked registry names, and any pinned trait the shot depends on. (2) **Scene second:** setting,
  staging, framing, palette, light, depth. (3) **Payload LAST, as the final clause:** the quoted lettering,
  on a delta the one change (§1 chain logic), or — on a shot with **neither** lettering nor a delta —
  the composition's dominant visual subject; an absence-as-positive-state sentence belongs in the scene
  zone, never as the closing clause, which the generator weights heaviest. The generator weights earliest
  mentions heaviest for identity and reads the closing instruction most literally, so leading with
  boilerplate costs identity and burying the payload mid-prompt costs the payload.

## 3. Composition — a decision, driven by the payload

Framing, scale, and angle are a choice driven by the one thing the viewer must see (the payload) and
the shot's class. Unchosen, it defaults to a centered eye-level medium — fine once, deadly on repeat:

- **Scale / character-sizing** — reach for size relationships, not a lineup of equals: a tiny figure
  under a dominant labelled mass, a face filling the frame, one figure dwarfing another.
- **Angle / distance** — reach past the eye-level medium: top-down for a map/plan, low for dominance,
  an extreme close-up on a face or detail, a wide with air for a single graphic idea.
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
- **Divergence from a famous or trademarked design is authored as POSITIVE alternative geometry and
  palette, never as omission or prohibition.** "NO characters, NO creatures, NO ghosts" on an otherwise
  unchanged maze-plus-dots screen re-summoned the trademarked sprite anyway — a negative constraint over
  an unchanged affordance is close to a re-roll. State the generic archetype's own different shape and
  palette (a period arcade cabinet, its own screen contents) instead of prohibiting the thing it must not
  become.

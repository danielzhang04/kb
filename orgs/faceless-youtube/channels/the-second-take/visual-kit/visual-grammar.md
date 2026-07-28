# The Second Take — Visual Grammar (staging law)

**What this is:** how The Second Take stages shots — the doc `visual-prompt-writer` reads when
authoring `shots.json`: staging conventions, payload-driven composition, and how our lever/register
bends the universal shot-classes. Identity/style/generation law lives in `style-bible.md`; the live
asset vocabulary is `registry/registry.json`; writing craft is `../storytelling-grammar.md`.

The narration-type → shot-class table, the within-shot motion grammar, the cut-cadence +
stretch-to-fill rule, and the core doctrine live in `universal.md` §13/§13a and are **BINDING** —
this doc does not restate them.

**Procedure:** read the line → identify its narration type → pick the shot class (`universal.md
§13a`) → INVENT a fresh, on-style shot on our rig. Everything below is how to stage "on-style" here.

---

## 1. Staging conventions (our cast on screen)

- **No on-screen narrator; the screen is a cast** (`style-bible.md §1`) — stage each story as a
  cast that comes and goes.
- **Institutions are personified cast**, one identity tag each (a flag necktie, a hat, an iconic
  building — `style-bible.md §6`), reused consistently — this makes staged-interaction and
  institution-as-actor native for policy/geopolitics/deals.
- **Every pose is a HELD TABLEAU, never a freeze of motion.** Pose menu: a salute · a planted wide
  stance (triumph/arrival) · presenting/offering an object · a held point at a target ·
  arms-crossed appraisal · a slump or bowed head (defeat) · leaning in (conspiracy) · recoil with
  weight on the back foot (shock). A travel or continuous-action beat stages its MEANING as a
  tableau, or lets the change arrive at a cut (a stage delta).
- **Emotion acts through mouth and body, restrained by default:** the lead of a beat gets a
  legible expression sized to the beat's register; secondary characters hold one expression;
  posture/lean/recoil carries the rest (`style-bible.md §6`). Reserve strong faces (laughing,
  shock, delight, greed) for beats that truly warrant them; ordinary beats read calm/deadpan/
  thinking/smug, grim beats grim-flat.
- **Expression is selected per shot as an `expression_ref`** (seeded, not prose — `style-bible.md
  §5`) from the register dial (`../storytelling-grammar.md §1.4`): smug/self-important on
  con/boast beats · hopeful-warm on the sell · deadpan on ironic counterpoint · alarm/dawning-
  wrongness on the turn · grim-flat on human-cost beats. Default is restrained; swapping the ref
  is a legitimate delta, its strength tracking the beat's gravity.
- **Co-stars share eye-line and height** unless the size difference or the disconnection IS the
  beat's argument.
- **Roles read at a glance.** Named cast wear pinned canonical outfits (`registry.json`) unless
  the shot authors a change; an unnamed role carries 1–2 unmistakable signifiers — a role the
  viewer must deduce is a staging failure.
- **A character reveal lands on the naming moment.** The entrance anchors to the VO line that
  names them, staged sized to the beat (a big reveal: spotlight / low angle / arrival; a minor
  one: a clean introduction), wearing its canonical/default expression unless the beat authors
  otherwise. A withheld character never appears before its naming.
- **Name recurring entities consistently across shots** — `image-generation` derives the asset
  library by spotting recurrence in prompts; reuse what's in `registry/registry.json`, invent new
  entities freely.
- **A recurring identifiable GROUP is cast, not a crowd** — one `cast` entry naming the group (no
  `pose_ref`/`expression_ref`), locked once and seeded into each appearance. Anonymous figures
  stay prose and route by SIZE (`style-bible.md`'s three-tier rig model): small/many/background →
  the **§2d crowd-rig clause**; LARGE/foreground → the **§2e base-rig clause**. A group member
  acting alone is cast as an individual.

## 2. Composition — a decision, driven by the payload

A shot's framing, scale, and angle are a choice, driven by the one thing the viewer must see (the
payload) and the shot's class (`universal.md §13a` — each class suggests its composition). Left
unchosen, composition defaults to a centered eye-level medium shot — fine once, deadly on repeat.
Decide it, and vary it across the video:

- **Scale / character-sizing** — reach for size relationships, not a lineup of equals: a tiny
  figure under a dominant labelled mass, a face filling the frame, one figure dwarfing another.
- **Angle / distance** — reach past the eye-level medium: top-down for a map/plan, low for
  dominance, an extreme close-up on a face or detail, a wide with air for a single graphic idea.
- **No hand/extremity close-ups — framing stays at body scale.** The rig's schematic 4-digit
  hands do not survive macro framing; show a document/signature/object detail at desk/body scale
  with the hand incidental.
- **Literal vs symbolic** — non-literal is the default (`§13a`): draw what the beat means, not
  the sentence.

The class carries a RANGE (a staged-interaction can be a handshake, a tug-of-war, an object passed
hand-to-hand, one figure looming) — pick the move the beat argues; don't reduce a class to one
framing or collapse it to a centered default. A plain centered shot is valid when a beat genuinely
wants it; the goal is variety across the video, not a rule per shot.

**Negative space follows the payload:** air for a single graphic idea; where the payload is detail
inside an artifact (a brochure's contents, a map's territory, a seal), the artifact fills the
frame. Everything in frame earns its place by meaning, palette code, or staging.

## 3. Lever / register translation — how our thesis bends each shot-class

Our locked constraints (`style-bible.md` + `dna.md`) decide HOW we execute the universal
shot-classes:

- **Ironic-counterpoint / unmasking is our SIGNATURE move, not a garnish** — the visual arm of
  the vindication lever ("you were lied to — here's the mechanism"). When the narrator reports
  the spin (the prospectus's promise, the official line — reported, never second-person), the
  image should expose it. Reach for this class whenever a beat carries a lie, a boast, or a
  euphemism.
- **Register scales with topic gravity** (`../storytelling-grammar.md §1.4` — not restated here).
  Visually: adopt the punchline/aside and idiom-pun classes' timing, reaction-shots, deadpan-
  object payoffs, and visual puns — evergreen references only, no memes/wojaks/anime cutaways
  (`universal.md §13a` cross-channel caution).
- **Analysis-not-gore / YMYL is mandatory** — the grim/violent/tragic class is always aftermath /
  witness / stylized-safe + a palette shift, never gore.
- **Money stories, not finance explainers.** Default to the abstract-force and relationship
  classes (personify the players, stage the deal), not gauges and definition cards. Pure-
  explainer devices (meters, definition cards, bar-chart infographics) are baked diegetic scene
  elements, flavor only, used sparingly — the exception, never the house style.

## 4. Motion direction — our dial

- **Locked camera** — no authored moves except deliberate exceptions.
- **Hard cuts only** — no transitions.
- **No long-form word-captions** — text is diegetic; shorts keep word-highlight captions.
- **Red is the only emphasis ink**, semantic (alarm / prohibition / ownership / the punch element
  that lands last).
- **Numbers live in-world** — a baked diegetic element or a delta-chain, never floating text.
- **Enumerations realize as a delta-chain or baked diegetic text.**

Full grammar + dial values: `universal.md §13a-iii` + `motion-tokens.json` / `audio-tokens.json`.

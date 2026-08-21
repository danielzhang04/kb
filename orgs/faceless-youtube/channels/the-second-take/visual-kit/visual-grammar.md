# The Second Take — Visual Grammar (staging law)

**What this is:** how The Second Take *stages* shots — the doc `visual-prompt-writer` reads when
authoring `shots.json`. It covers staging conventions, the payload-driven composition guidance, and how
our lever/register bends the universal shot-classes. It is the visual companion to `../storytelling-grammar.md` (the
writing craft).

**What this is NOT:** the identity/style/generation law. The locked rig, descriptors, verify gates,
committed recipe, and the asset-library build spec all live in **`style-bible.md`** (the image-gen doc);
the **live index of assets that actually exist** is **`registry/registry.json`** — read the registry,
not prose, for the channel's current vocabulary.

**Read this pointer first — the general grammar is LAW and lives elsewhere.** The niche-agnostic visual
grammar — the **narration-type → shot-class table**, the **within-shot motion** grammar (§13a-i), the
**cut cadence + stretch-to-fill hard rule** (§13a-ii), the **convergent doctrine** (non-literal default,
one-idea-per-shot, personify forces, glue numbers to objects, palette-codes-tone, humor-in-contrast,
escalate-by-multiplying), and the **anti-slop / classify-then-invent** guardrail — all live in
`universal.md §13 / §13a` and are **BINDING**. This doc does not restate them.

The procedure never changes: **read the line → identify its narration type → pick the shot class
(`universal.md §13a`) → INVENT a fresh, on-style shot on our rig.** Everything below tells you how to
stage "on-style" here.

---

## 1. What to depict

4. **Depiction is a DECISION, not a transcription.** The hardest, most-upstream call — made *before*
   composition or prompt wording — is *what each shot should depict*. The failure mode is a shot that
   literally draws the sentence. Real channels almost never do that: **non-literal is the default;
   literal depiction is reserved for concrete physical action/objects.** You classify each VO line's
   *narration type* and pick a *shot class* from the visual-narration grammar (universal.md **§13a** +
   the channel's `visual-kit/visual-grammar.md`), then **invent** a fresh on-style shot in that class —
   never clone the grammar's examples. This is Step 2.5 and it governs every shot you write.

## 2. Figure / crowd staging

- **No on-screen narrator; the screen is a cast** (identity law: `style-bible.md §1`) — stage each story
  as a cast that comes and goes (the OverSimplified / HeyHistorically model).
- **Institutions are personified cast** (identity/recipe law: `style-bible.md §6` — an institution = a
  cast member with ONE identity tag, e.g. a flag necktie / hat / uniform, or an iconic building/landmark,
  reused consistently). Staging consequence *here*: this makes the **staged-interaction** and
  **institution-as-actor** classes native — stage policy/geopolitics/deals as conversations between
  recurring rig-consistent characters.
- **Every pose is a HELD TABLEAU — never a freeze of motion.** The pose menu is poses that *hold*
  while carrying the action's meaning: a salute · a planted wide stance (triumph/arrival) · presenting
  or offering an object with both parties composed · a held point at a target · arms-crossed appraisal ·
  a slump or bowed head (defeat/aftermath) · leaning in (conspiracy) · recoil with weight on the back
  foot (shock). Mid-stride walking, mid-shuffle crowds, mid-sweep arms read as broken frames when held
  3–9s — if the beat is *travel or continuous action*, stage its **meaning as a tableau** (the marching
  general = a planted stride-stance ON the map with the route drawn behind him) or let the change
  arrive at a cut (a stage delta).
- **Emotion is acted with the mouth and the body, not the hands — restrained by default:** the lead of a
  beat gets a LEGIBLE expression sized to the beat's register, not a reflex caricature; secondary
  characters hold **one** expression; posture/lean/recoil carries the rest (the rig has simple hands — see
  `style-bible.md §6` for why). Reserve the strong/loud faces — laughing, shock, delight, **greed** — for
  the beats that truly warrant them (a real laugh, a real shock, a beat genuinely about avarice), not by
  reflex; ordinary beats get calm (deadpan / thinking / smug), grim beats get grim-flat.
- **Expression tracks the beat (the acting layer).** A character's face is **selected per shot as an
  `expression_ref`** (seeded, not prose — `style-bible.md §5`) from the register dial (`../storytelling-grammar.md §1.4`): **smug/self-important** on con/boast beats ·
  **hopeful-warm** on the sell · **deadpan** on ironic counterpoint · **alarm/dawning-wrongness** on
  the turn · **grim-flat, no comedy** on human-cost beats (desaturated gravity register). The DEFAULT is
  restrained — a calm/plain face on an ordinary beat; the strong faces (laughing, shock, delighted, greedy) are
  RESERVED for real peaks, not reached for by reflex. One default face riding every beat is a
  defect; so is a caricature riding every beat — an expression change is a legitimate delta (swap the
  `expression_ref`), and its STRENGTH tracks the beat's gravity.
- **Co-stars share eye-line and height.** Two interacting characters face each other on one eye-line
  unless the size difference or the disconnection IS the beat's argument (a deliberate size gag or a
  cold shoulder) — never an accidental mismatch.
- **Roles read at a glance.** Named characters wear their **pinned canonical outfits** (`registry.json`)
  unless the shot deliberately authors a change; an unnamed role carries 1–2 unmistakable signifiers
  (a king: crown + robe; a general: epaulettes) — a role the viewer must *deduce* is a staging failure.
- **A character reveal is staged on the naming moment.** The first time a named character appears, the
  shot lands on the VO line that NAMES them (the entrance anchors to the name), with a reveal staging
  sized to the beat — a big reveal is dramatic (spotlight / low angle / arrival into a held scene), a
  minor one a clean introduction — and the character wears its **canonical/default expression** unless the
  beat authors otherwise (an entrance, not a reaction). A withheld character never appears before its
  naming (disclosure order).
- **Name recurring entities consistently across shots** ("MacGregor" in every prompt, not "the con-man"
  in some) — downstream, `image-generation` derives the video's asset library by spotting recurrence in
  these prompts.
- Recurring characters, props, and plates that already exist are in `registry/registry.json` — write shots that
  reuse them where they fit; invent new entities freely where the story needs them (they'll be
  materialized once at the image-gen pass).
- **A recurring identifiable GROUP is a character, not a crowd.** A specific named band, duo, or troupe
  that reappears is one approved backticked character token in `still_prompt`; Forge seeds its group
  canonical so the members stay consistent.
4. **Cast it.** Every story-named or story-referenced figure — **including inside diegetic media** (a
   brochure's prince who IS the story's con-man, a portrait, a poster) — must be an approved backticked
   registry character token in `still_prompt`, so `image-generation` seeds it. A role must read at a
   glance (a king reads as a king via 1–2 signifiers); named characters wear their pinned canonical
   outfits unless the shot deliberately authors a change.
   **Recurring props are declared in `props`.** A specific identifiable object that recurs across shots and
   must look the SAME each time (the guidebook, a named banknote, a signed deed) is named in the shot's
   **`props` array** (its library name). A recurring prop named in the prose but omitted from `props` is an
   authoring gap, exactly like an un-tokened named figure. A one-off object (used in a single shot, no match
   requirement) stays in the `still_prompt` prose only — no `props` entry, no slot.
5. **Stage the tableau + act it through executable prompt tokens.** Forge derives seeded figures from
   backticked character tokens in `still_prompt`; the optional `cast` array is descriptive review metadata
   and is never engine-read. Name an ordinary pair left-to-right as two approved character tokens. For
   physical contact, name the left character, then the right character, then one approved interaction token
   (`handoff`, `handshake`, or `fistbump`); that is the binding order consumed by `shot_cast`. If any token
   is unavailable, emit `needed_assets` and stop at the existing human gate.

**Anonymous crowd execution.** The crowd rig differs from the full rig only in the face; its squat
head-to-body proportion matches the approved crowd exemplar. VPW declares `figures.crowd: true` and
authors only the crowd's scene geometry, action, and era-specific dress. Forge appends the canonical
style-bible §2d block and seeds `refs/base/crowd-exemplar.png`; named foreground characters still receive the
full §2c rig. Review every depicted crowd figure against that exemplar.

**Occupancy follows who acts in the sentence.** The performer whose decision, action or reaction makes
it true is a seeded character; a pair is seeded when an exchange, relationship or shared labour is what the
sentence shows; a beat whose subject is a thing, a quantity, a place or an absence carries no performer;
a beat whose subject is the mass uses the simplified crowd rig. Three ordinary
pair tableaux are a clerk and customer exchanging a box, two workers at one bench, and a manager with
an auditor over one ledger. Figures stay small, mid/rear, in a structured world. a crowd is written in
the primary scene clause as a bounded group held beyond something the scene already has — a pane, rails,
a doorway, a pavement, a far bank — with the near zone empty, so the geometry sets its count and scale.

  `image-generation` surfaces there for approval. **Pose, interaction, expression, and costume are
  CLOSED-WORLD:** the primitive must ALREADY exist in `registry.json` or the video's approved library,
  and the figure keeps its pinned costume. Conform the sentence to the closest entry. If none is near,
  write no invented token or prose pose; emit the VPW elevation flag and block the shot until the reusable
  primitive is minted, approved, and registered.

## 3. Composition / camera / scale

A shot's **framing, scale, and angle are a choice** — driven by the one thing the viewer must see (the
payload) and the shot's class (each `universal.md §13a` class already *suggests* its composition). Left
unchosen, composition defaults to a centered, eye-level, same-size medium shot — fine once, deadly on
repeat. **So decide it, and vary it across the video:**

- **Scale / character-sizing** — subjects aren't always the same size or at eye level. A tiny figure
  under a dominant labelled mass (scale as argument), a face filling the frame (a reaction), one figure
  dwarfing another (power). Reach for size *relationships*, not a lineup of equals.
- **Angle / distance** — top-down for a map or plan, low for dominance, an extreme close-up on a face or
  a detail, a wide with air for a single graphic idea. Reach past the eye-level medium.
- **No hand / extremity close-ups — framing stays at body scale.** The rig's schematic 4-digit hands do
  not survive macro framing (a hand close-up reads as a rig-break); if a document, signature, or object
  detail matters, show it at **desk / body scale** with the hand incidental, never as a hand macro.
- **Literal vs symbolic** — non-literal is the default (`§13a`): draw what the beat *means*, not the
  sentence. A promotion is insignia arriving on the coat, or the man small before an army — not "a man
  standing in a field."

The class carries a *range* (`§13a`: a staged-interaction can be a handshake, a tug-of-war, an object
passed hand-to-hand, one figure looming; a physicalized-imbalance is relative size) — **pick the move the
beat argues; don't reduce a class to one framing, and don't collapse it to a centered default.** A plain
centered shot is valid when a beat genuinely wants it; the goal is **variety across the video**, not a
rule per shot.

**Negative space follows the payload:** air for a single graphic idea (our signature) — but where the
payload is *detail inside an artifact* (a brochure's contents, a map's territory, a seal), the artifact
fills the frame. Everything in frame earns its place by meaning, palette code, or staging; unmotivated
set dressing is a defect, not texture.


## 4. Motion direction

The measured grammar (camera law, entrance vocabulary, transition law, number-selling recipe, audio
grammar, the beat-type → treatment table) is **binding law in `universal.md §13a-iii`** — this section
only sets The Second Take's dials on it. Evidence: `research/motion-logs/` (2026-07-08 teardown).

- **We run STORY mode**, not explainer mode: median hold target 3–5s, whip-pan reserved for dialogue
  ping-pong and list montages; SFX-dense audio (story dial) when the audio layer lands. (The camera dial
  is the next bullet.)
- **Fixed POV is the house camera [user-directed 2026-07-08]:** no wandering pans/zooms — the camera is
  furniture (`universal.md §13a-iii.1`). The universal ceiling is an overt move on **only ~10–20% of
  shots** (peak or motivated beats: an intro, a vista, a gravity beat), everything else on a sub-visible
  micro-drift floor, diegetic cards/artifacts held dead-static. **Our dial sits at the strict end of that ceiling: the engine
  derives NO camera move at all** (`build_motion.py` calls `locked_camera()` unconditionally, with a
  `camera_moving` regression counter), so an overt move can only ever be deliberately authored. **A
  render where most or all shots push in or drift is a BUG, not a look:** a cut that moved the camera on
  18 of 18 shots (~5× the ceiling) was flagged on sight as "floating and zooming randomly." If a majority
  of shots move, fix the camera derivation or the authored camera intent — never ship it as a style.
- **Motion + audio treatment:** every shot hard-cuts (the camera dial is above); the sound is authored
  separately by the `audio-director`. `visual-prompt-writer` authors no
  treatment field — the old beat-type enum + the `ken_burns`/`within_shot_motion` fields are all deleted.

## 5. How this feeds the pipeline

- **`visual-prompt-writer`** runs the universal grammar (`§13a`) as its classify → pick-class → invent
  step, enforces the literal-check + anti-slop guardrail, authors each shot as a **held tableau with
  stated facts** (`still_prompt`; cadence per `§13a-ii`), and
  stages per this doc — pulling the existing-asset vocabulary from `registry/registry.json` and the
  recipe (house style; `global_prompt_suffix` is empty/absent) from `style-bible.md §6`. Its fresh-eyes shot
  critic checks the plan against this doc's staging law before any generation.
- **`long-form-writer` / `shorts-writer`** feed it upstream: cue the beat's **meaning**, not a literal
  picture; report claims/spin (so the visual can unmask them — the vindication lever); reach for vivid
  idioms (so the visual can draw the pun).
- **`image-generation`** runs AFTER `shots.json` exists: pass 1 derives the video's asset library from
  the shots (recurring entities materialized once), pass 2 assembles every scene from it — all under
  `style-bible.md`'s law.

**Validation status:** the grammar is not yet proven on a finished video — next test is the Poyais
image-generation dogfood: confirm the shots read non-literal, on-lever (ironic-counterpoint), on-rig,
and as choreographed slates (no static 8s holds, no stretch-to-fill).

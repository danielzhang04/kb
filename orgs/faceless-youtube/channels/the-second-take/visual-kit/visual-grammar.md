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
- **Roles read at a glance.** Named cast wear their **pinned canonical outfits** (`registry.json`)
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
- Recurring cast/props/plates that already exist are in `registry/registry.json` — write shots that
  reuse them where they fit; invent new entities freely where the story needs them (they'll be
  materialized once at the image-gen pass).
- **A recurring identifiable GROUP is a character, not a crowd.** A specific named band/duo/troupe that
  reappears — its members must stay consistent shot to shot — is **cast** (a `cast` entry naming the
  group, no `pose_ref`/`expression_ref`), so image-gen locks it once (canonical = the members together)
4. **Cast it.** Every story-named or story-referenced figure — **including inside diegetic media** (a
   brochure's prince who IS the story's con-man, a portrait, a poster) — routes through the channel
   registry: name the registry asset in the prompt so `image-generation` seeds it. A role must read at
   a glance (a king reads as a king via 1–2 signifiers); named cast wear their pinned canonical
   outfits unless the shot deliberately authors a change. **A recurring identifiable GROUP** (a specific
   named band/duo/troupe that reappears — its members must stay consistent) is cast too: ONE `cast` entry
   naming the group, with no `pose_ref`/`expression_ref` (a group is not single-figure-posed; image-gen
   **Recurring props are declared like cast.** A specific identifiable object that recurs across shots and
   must look the SAME each time (the guidebook, a named banknote, a signed deed) is named in the shot's
   **`props` array** (its library name). A recurring prop named in the prose but omitted from `props` is an
   authoring gap, exactly like an uncast named figure. A one-off object (used in a single shot, no match
   requirement) stays in the `still_prompt` prose only — no `props` entry, no slot.
5. **Stage the tableau + act it — by SELECTING library assets, not describing them.** Mirror step 4's
   casting: for each prominent figure, choose its **`pose_ref`** (the held body pose/gesture that carries the
   action's meaning) and/or **`expression_ref`** (the face for this beat/register) **from the registry
   vocabulary**, and record them on the shot's `cast` entry. These are SEEDED by `image-generation` (style-bible §5
   one-run multi-seed) — so the pose/hands and the expression are the assets' job, **not** the `still_prompt`'s.
   Scene-first ordering: the shot's meaning/scene drives which pose/expression fits, never the reverse.
   `pose_ref`/`expression_ref` are each optional (a plain standing figure needs neither). A two-figure
   interaction (a clasp) uses an **interaction** asset — the same kind of `pose_ref`, just one that shows two
   figures — referenced by BOTH figures' `cast` entries. **The shot's `cast` ORDER binds the slots: the first
   entry is the left figure, the second is the right** (image-gen seeds two identities into the template by
   that order). If the registry lacks the interaction, surface it (below) as `kind: interaction`, no special path.

## 2d. CROWD-RIG clause (verbatim — write INTO a crowd scene's prompt)

> The background / crowd figures are on the CROWD RIG: round cream-family heads, DOT EYES, one simple
> consistent mouth (neutral / smile / downturn only), NO noses, NO ears, NO teeth, the **same squat
> head-to-body proportion as the crowd exemplar seed** — a large round head on a short compact body, NOT
> taller/lanky — in varied era-appropriate clothing. Keep every crowd figure on this same simplified rig —
> do not give them individual detailed faces.

**The crowd rig differs from the full rig ONLY in the FACE** (dot eyes + one simple mouth vs the full
detailed features) — **head-to-body proportion matches the crowd exemplar seed** (human-confirmed 2026-07-16:
"the crowd rig should be the exact same proportions as our base rig — the face is different, of course").
So proportion is a stated FACT in every crowd/base-rig delta (the words above carry it), and anonymous
figures rendering **taller/lankier than the crowd exemplar seed** are the proven drift (they carry no seed to pin
proportion) — a first-class review axis, §3.

This clause governs the **anonymous** figures only. Unlike §2c (which `forge.py` auto-appends to every
character-bearing gen), **§2d is authored by VPW into the `still_prompt`** of any shot with an anonymous
crowd (the prompt the engine sees must carry these words) — it is not auto-appended, because most shots
have no crowd. A foreground named character in the same shot still holds its FULL rig via its seed + the
auto-appended §2c; §2d simplifies only the anonymous background.

**Crowd exemplar — the crowd's rig ANCHOR (human-gated 2026-07-16).** `refs/base/crowd-exemplar.png` —
a human-approved crowd sample frame (5–6 anonymous figures on the EXACT squat base-rig proportion, dot
eyes, one simple mouth, no noses/ears/teeth, varied era-appropriate dress) — is **SEEDED into EVERY
crowd-bearing generation** as the crowd's proportion/face anchor. The §2d words above stay in the
`still_prompt` (they carry the rig FACTS), but the **exemplar seed is what actually pins** proportion +
face: a crowd carries no per-figure canonical, and prompt words alone let anonymous figures drift
taller/lankier (the proven failure). This **supersedes** the earlier "author the §2d words, no seed"
handling — a crowd is now prompt-authored (§2d) AND exemplar-seeded. It mechanizes Daniel's directive:
don't generate figures that aren't based on the asset base rig, for the one tier that can't seed
per-figure.


Every depicted crowd figure must satisfy the crowd-exemplar comparator; latent figure-class content cannot silently pass.

**Story bearer.** Every story-bearing individual is seeded named cast. Only a genuine rearward mass beat uses the simplified crowd rig.

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

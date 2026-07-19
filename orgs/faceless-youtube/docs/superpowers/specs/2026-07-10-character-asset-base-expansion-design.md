# Character asset-base expansion — design (2026-07-10)

**Status:** **BUILT 2026-07-10** — 19 primitives registered (52 assets total) + two-slot interaction merge
validated end-to-end (MacGregor+banker → `handshake`); plan `…-build.md`; see `decisions.md` 2026-07-10 · **Channel:** the-second-take
**Owner docs it touches:** `visual-kit/style-bible.md` (§7 build spec, §5 seed rules), `registry/registry.json`,
the `image-generation` + `visual-prompt-writer` skills. **No code/plumbing changes until the plan is written.**
**Live pickup handoff:** `docs/handoffs/2026-07-10-interaction-template-spike-pickup.md`.

## Goal

Expand the channel's standing character asset base beyond the current solo, front-facing vocabulary so the
cast can be shown at **more poses**, **different angles**, **holding objects**, and **interacting with other
characters** (handshake, handoff, facing-off, looking-at). This is a build to the cross-video kit
(`style-bible §7`), not per-video work.

## Current state (what we're expanding from)

- **~18 expressions** + **~13 action poses** in `refs/base/`, all registered in `registry.json`.
- **Every frame is one character, dead front-facing, hands gesturing at empty air.** `base.png` is a single
  neutral front pose; every expression/action seeds off it.
- **The mechanic that matters (`style-bible §5`):** the library is a **seed bank of character-agnostic
  primitives**. A shot names a `pose_ref` + `expression_ref`; `image-generation` MERGES them onto whatever
  cast member is in the scene (the two-step build). One "shock" works for any character, and the merge is what
  carries the locked **4-digit hand** (word-prompting reverts to a 5-finger prior). So the design question for
  every add is **"what is the reusable primitive?"**, never "what picture."

## The four buckets

*(Rationale + candidate space. The concrete, pruned set that will actually be built is authoritative in
**"Full-build list (LOCKED 2026-07-10)"** below — the candidates here are the menu it was chosen from.)*

1. **More single-character poses** — *low risk, drop-in.* More frames seeded off `base.png` exactly like the
   existing 13. Candidates: sitting (desk/chair — big gap), hand-on-chin lean, pointing family (down/off/at-
   camera), counting-on-fingers, hands-on-hips, pocket-check/empty-pockets, run/hurry, stumble-recoil,
   facepalm, kneel-beg, whisper-aside, wiping-brow, lean-on-something, walking-away.
2. **Angle variants** — *needs the spike's result before we fix its contents.* Not a full matrix (never
   rebuild 18 expressions × N angles). A **small set of angled pose primitives** where angle carries meaning:
   3/4-turn, profile-facing, looking-off-frame, walking-away/back. See "Open — deferred."
3. **Object-holding** — *low-to-mid risk.* The reusable primitive is the **GRIP, not the object**: two-hands-
   cupped, one-hand-pinch-at-side, overhead-hold, arms-wrapped-around, present-on-open-palm, hold-up-to-read,
   extend-an-object (giving half), reach-to-take (receiving half). **The object stays a scene delta**, skinned
   per story (brick, cash bag, contract, gold bar). We store how the hands hold, not what.
4. **Multi-character interaction** — *biggest departure; drives the whole design.* Handshake, handoff, face-
   off/confrontation, one-looking-at-another, back-to-back, one-looming-over-a-seated-other, accuse, group
   reaction.

## Key decision — two-slot interaction templates (Approach A)

A handshake breaks the "stamp one identity onto one blank" model because it is **two bodies whose hands must
meet**. Decision: build each **contact** interaction ONCE as a **two-mannequin template** on the base
template (two blank base figures in the interaction, hands pre-aligned), register it, and let a scene insert
**two identities into the two slots** (`X` = left, `Y` = right).

**Why A over the alternatives:** the two hardest things in this style are (a) two 4-digit cartoon hands
interlocking cleanly and (b) two bodies at the right relative distance/angle. A template solves both ONCE and
reuses them; the "store single-char halves and hope they align in-scene" alternative re-rolls (and re-breaks)
the hand contact every scene.

**Template properties:**
- **Faces stay blank/neutral.** Expressions are NOT baked; they are seeded per slot during VPW / image-gen
  (the same two-step merge we use today), so the acting — the smug-con-man / nervous-mark irony that IS the
  payload — stays where it belongs.
- **Slot assignment is by position** (X left, Y right). Since both slots start as the identical blank
  mannequin, left/right is the only disambiguator (a spike observable — see below).
- **Angle is intrinsic.** Interaction templates are inherently angled (two 3/4 figures facing each other), so
  building them also exercises off-front identity + angled-face expression merge.

**Scope split — do NOT template everything in bucket 4:**
- **Contact interactions → template** (handshake, handoff — hands must meet; baked contact geometry is the
  whole value).
- **No-contact interactions → normal two-character scene** (looking-at across a room, looming-at-distance).
  The existing scene assembly (`style-bible §8`) already places two posed-characters in one shot; no template
  needed.

## De-risk first (the discipline this design is built around)

The two-identity insert is **doubly unproven**: everything validated to date stamps ONE identity onto a
FRONT-facing blank. A handshake tests three never-tested things at once, which makes one handshake the
**maximal stress test**:
- **U1 — off-front identity hold:** does a character's identity survive at 3/4 (where noses/ears/jaws creep
  back)?
- **U2 — two-identity slotting:** can the engine hold two DISTINCT on-rig faces in one gen (no blend into
  siblings), put the right identity in the right slot, and not bleed one costume onto the other?
- **U3 — expression on an angled face:** can a front-authored expression frame be merged onto an angled slot
  face? (This same unknown gates standalone angle poses too.)

**Spike (execution step 1), with a human checkpoint after every gen batch — never bless a flawed frame:**
1. Generate the **handshake template** (two blank base mannequins, hands clasped, 4-digit hands clean) →
   checkpoint. This is where we also confirm the clasp reads on-rig; a bad clasp here is a redraw, not a lock.
2. Insert **two real, distinct identities** (e.g. MacGregor + a plain banker) into the two slots → checkpoint.
   Observe U1 (both hold rig off-front), U2 (distinct + correct slot + no costume bleed).
3. Seed **one expression per slot** onto the angled faces → checkpoint. Observe U3.

**Pass = all three hold to the channel's approved-canonical bar (`style-bible §3`), verified in the standard
image-gen batched review + the human artifact board (final finger/identity authority).** A miss on U2 or U3
sends the template idea back to design before any set or plumbing is built.

## Spike results (2026-07-10) — approach VALIDATED, with three findings that shape the build

Ran on a MacGregor + banker handshake, ~17 gens, all seed-from-reference, nothing registered (frames staged
in `visual-kit/_staging/`, gitignored). Boards published as artifacts (URLs in the pickup handoff).

**Validated:**
- **U1 — off-front identity holds.** MacGregor + the banker both kept identity/rig at 3/4 (no nose/ears creep).
- **U2 — two-identity slotting works.** Two DISTINCT on-rig identities placed into the two slots, correct
  positions (X=left, Y=right by delta binding), **no costume bleed** (hussar coat did not leak onto the
  banker). Both 3/4 AND **full-body** framings work — full-body is viable, do NOT drop it.

**Three findings that change HOW we build:**
1. **Expression is applied PER-CHARACTER (staged), NOT dumped into one big 5-seed gen.** A single gen seeding
   `[template + charA + charB + exprA + exprB]` mis-routes the expressions — observed both expressions
   collapsing to one, expressions swapping slots, and even identities reverting to the bald-cream base. The
   **staged** order — insert identities, then apply each expression to its own character — bound correctly on
   both framings every time. So the production merge is: **pre-merge each character with its expression (the
   `style-bible §1b` two-step), THEN the interaction gen.** Identity+pose can be one gen; expression cannot
   share that pot.
2. **THE CLASP ANATOMY IS A TEMPLATE ACCEPTANCE CRITERION — and every spike template FAILED it.** All spike
   handshakes came out **left-hand-to-right-hand** (each figure used its *inner* arm), NOT a true
   right-hand-to-right-hand shake. Root cause: the blank two-mannequin **template** baked an inner-arm clasp;
   every insert seeds the template's geometry, so all inherit the wrong hands. **Fix once at the template:**
   regenerate the blank template until it shows a genuine right-to-right handshake (the left figure reaches
   *across* their own body), and **verify by tracing each arm shoulder→hand, not by eyeballing "a handshake is
   present."** Get the template right → every insert inherits correct hands. (Process note: the operator
   repeatedly asserted "right-to-right, correct" without tracing — arm anatomy must be traced, like the
   4-digit hand.)
3. **Seed, never word-prompt, anything about a character** (face/identity/expression/pose) — reaffirmed. The
   featureless/blank faces early in the spike came from wording "blank neutral" instead of letting the seeded
   canonical faces carry. Angle/"profile" also resists wording: the engine keeps front-facing heads on angled
   bodies (a feature-placement limit, not a head-shape one) — true profile needs its own seed approach later.

**Where the spike stopped:** mid a fresh clean regen of a two-character handshake (seed `[3q template +
MacGregor + banker]`), the `gemini-3-pro-image` endpoint threw transient **503 then 500** errors — no new frame
written. Paused here. **The correct-clasp template (finding 2) is the first thing to nail on resume.**

## Full-build list (LOCKED 2026-07-10)

Scoped with Daniel in a brainstorming pass. Principle settled: **completeness of *generic, reusable*
primitives** — the reusable unit is the pose / angle / grip / contact-geometry, never a story-specific object
or character. The object is always a per-scene delta ("hold-paper-by-sides", never "hold the Poyais map").

**18 new assets** (all seeded off `base.png` / the base two-mannequin template):

- **Bucket 1 — single-char poses (6):** `sit` (seated posture, **no chair** — the chair is imagined/added as a
  scene delta; a held object is NOT, see grips), `facepalm`, `surrender` (hands-up), `whisper-aside`,
  `kneel-beg`, `point-at-thing`.
- **Bucket 2 — angle variants (3):** `3q-turn-left`, `3q-turn-right`, `back-to-viewer`. (True profile stays
  **deferred** — resists wording per finding 3; needs its own seed approach, not in this build.)
- **Bucket 3 — grips (6):** `hold-one-hand`, `hold-both-hands`, `hold-paper-by-sides`, `carry-by-handle`,
  `sign-with-pen`, `reach-to-take`. Each bakes a **generic, monochrome placeholder object** (plain sheet / case
  / pen) so the grip *reads*; the placeholder is object-agnostic and is skinned per scene. (`offering` +
  `present` already cover present-on-open-palm — no dupe.)
- **Bucket 4 — contact interactions, two-slot templates (3):** `handshake`, `handoff` (give↔take an object
  between two — object-mediated contact), `fistbump`.

### Rules & decisions attached to the list

- **NEUTRAL-FACE RULE (hard, new acceptance criterion — sits beside the 4-digit-hand rule).** Every pose /
  angle / grip / interaction asset carries the plain `base.png` **neutral** face — **no baked expression,
  ever.** The architecture is `pose-bank × expression-bank` merged at scene time; a pose that ships its own
  expression breaks the compose. A wrong/baked face = **reject, regenerate seeded from base**. (`facepalm` is
  the one accepted tension — the palm occludes part of the face, leaving the scene-time expression layer less
  to act on; we accept partial occlusion.) The template faces on the spike board violated this (drifted to
  random expressions via wording) — a second reason none of the four is a keeper as-is, independent of the
  clasp.
- **Interaction = physical contact ONLY** (definitional call). No-contact two-person shots (whisper-to,
  face-off, looming, accuse-across) are **NOT templated** — they are composed at scene time from bucket-1/2
  poses (`style-bible §8`). This is why `whisper-aside` is a bucket-1 pose, not a bucket-4 template.
- **One canonical framing per contact template first** (medium 3/4, the spike's best read); add full-body only
  if a later script needs it.
- **All contact templates are regenerated FROM SCRATCH in this build run** — the 4 spike handshake frames are
  **discarded, not certified or reused** (board verdict 2026-07-10: none is a keeper; all carry the inner-arm
  clasp and/or drifted faces). Each fresh template must pass **contact-geometry certification** (finding 2):
  right-to-right handshake, hands-meet-at-object handoff, clean closed-fist fistbump — **verified by tracing
  arms shoulder→hand** + the human artifact board, never by eyeballing "a handshake is present." Faces
  regenerated **neutral, seeded from `base.png`** (never word-prompted).
- **Templates stay identity-free.** The staged `banker.png` was a slot-test only and is **not** registered; the
  scene supplies both identities into the two slots (X=left, Y=right by delta — no extra slot cue needed).
- **Existing 13 action poses are NOT audited/reshot** (Daniel's call) — accepted minor inconsistency.
- **Build order:** primitives first (buckets 1–3, low-risk drop-ins seeded exactly like the existing set),
  **then** the 3 contact templates + the two-slot plumbing (the harder, staged-expression part).

## Plumbing — to be detailed in the implementation plan

Deferred to `writing-plans` (design intent fixed here; exact schema/edits are the plan's job): the **schema +
VPW + image-gen two-slot merge** — new asset `kind: interaction` with two slots; VPW authoring
`interaction_ref` + `cast[X,Y]`; image-gen's two-identity merge. The merge MUST implement the
**staged-expression order** (finding 1: pre-merge each character+expression via the `style-bible §1b` two-step,
THEN the interaction gen — never one 5-seed gen). **Implementation discipline (standing rules —
`keep-docs-structured`, `fix-generation-not-prohibitions`, `derived-fields-not-generation-targets`):** the new
field is single-sourced and aligned across schema ↔ VPW ↔ image-gen (no drift, no restating a rule in three
docs); prefer one positive "do Y" over a stack of "never do X"; any QA/review field is *derived*, never a new
authoring target.

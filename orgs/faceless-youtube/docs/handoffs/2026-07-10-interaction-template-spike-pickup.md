# PICKUP — character asset-base expansion: interaction-template spike (2026-07-10)

**Status: ✅ CLOSED / SHIPPED 2026-07-10.** The full expansion was brainstormed → specced → planned → BUILT:
**19 primitives registered** (52 assets total), the 3 interaction templates regenerated from scratch (clean
right-to-right handshake), and the **two-slot merge validated end-to-end** (MacGregor + banker → registered
`handshake`, staged-expression order, hair-preservation fix landed). See `decisions.md` 2026-07-10, the spec
`…2026-07-10-character-asset-base-expansion-design.md` (status BUILT), and the plan `…-build.md`. Nothing below
this line is open — it's kept for the spike's findings history only.

> **(Historical — resolved.)** The spike proved the two-slot approach; the build then regenerated all templates
> from scratch (spike frames discarded), registered everything, and proved it in production. No open task.

## The goal (unchanged)
Expand The Second Take's standing character asset base beyond its current **solo, front-facing** vocabulary
(~18 expressions + ~13 poses, all seeded off one neutral front `base.png`). Four buckets:
1. **More single-char poses** (sitting, chin-lean, pointing, counting, hands-on-hips, run, facepalm…) — low
   risk, drop-in.
2. **Angle variants** (3/4, looking-off, walking-away) — needs care (see Finding 3; true profile resists).
3. **Object-holding** — store the **GRIP** (cupped, pinch, overhead, arms-around, present-on-palm, hold-to-
   read, extend, reach-to-take), object stays a per-scene delta.
4. **Multi-character interaction** (handshake, handoff, face-off, looming, back-to-back) — the hard one; drove
   the spike.

Full design + rationale: **`docs/superpowers/specs/2026-07-10-character-asset-base-expansion-design.md`**
(read its "Spike results" section — this handoff is the operational companion).

## The architecture decision (Approach A — two-slot templates)
A **contact** interaction (handshake/handoff) is built ONCE as a **blank two-mannequin template** (two base
figures in the pose, hands pre-aligned). A scene then seeds `[template + charA canonical + charB canonical]`
to place two identities into the two slots (X=left, Y=right, bound by delta). Expressions are seeded
per-character (see Finding 1). **Non-contact** interactions (looking-at across a room, looming-at-distance)
are NOT templated — they're ordinary two-character scene compositions (`style-bible §8`). The `image-generation`
skill already anticipates `kind: interaction` assets + the two-identity merge ("validated on first use") — this
spike IS that validation.

## What the spike PROVED
- **U1 off-front identity holds** — MacGregor + banker both stayed on-rig at 3/4 (no nose/ears creep).
- **U2 two-identity slotting works** — two DISTINCT identities, correct slots, **no costume bleed**. Works on
  **both 3/4 and full-body** framings. Full-body is viable — do NOT drop it (an earlier call to drop it was
  wrong; it was based on flawed two-step attempts, not the clean run).
- Position binding (X=left / Y=right named in the delta) is reliable — no special slot cue needed.

## THREE FINDINGS / PITFALLS (these shape the build — do not relearn them the hard way)
1. **Expression is applied PER-CHARACTER (staged), NOT in one big 5-seed gen.** Seeding
   `[template + charA + charB + exprA + exprB]` in a single gen mis-routes expressions (both collapse to one /
   swap slots / identities even revert to bald-cream base). The **staged** order — insert identities, then
   apply each expression to its own character (`style-bible §1b` two-step) — bound correctly every time on both
   framings. **Production merge = pre-merge each character+expression, THEN the interaction gen.** Identity+pose
   can be one gen; expression cannot share that pot.
2. **CLASP ANATOMY IS A TEMPLATE ACCEPTANCE CRITERION — every spike template FAILED it.** All spike handshakes
   are **left-hand-to-right-hand** (each figure used its INNER arm), not a true right-to-right shake. Root
   cause: the blank template baked an inner-arm clasp; all inserts inherit it. **Fix once at the template:**
   regenerate the blank two-mannequin template until it shows a genuine right-to-right handshake (the LEFT
   figure reaches ACROSS their own body), and **verify by tracing each arm shoulder→hand.** Do not eyeball
   "a handshake is present" — the operator did that repeatedly and mislabeled wrong-hand frames as "correct."
3. **Seed, never word-prompt, anything about a character** (face/identity/expression/pose). Wording "blank
   neutral" gave featureless faces; seeded canonical faces carry neutral correctly. "Profile" also resists
   wording — the engine keeps front-facing heads on angled bodies (feature-placement limit, not head-shape).
   True profile will need its own seed approach (bucket 2 caveat).

## Exact state / where we stopped
- **Staged frames** (on disk, `channels/the-second-take/visual-kit/_staging/`, **gitignored**, present on this
  machine only): `banker.png` (a clean NEW secondary-cast canonical — deeper-brown tone, charcoal 3-piece,
  reusable), `spike-handshake-{3q-a,3q-b,fullbody-a,profile-a}.png` (blank templates — all wrong-hand clasp),
  `spike-insert-*`, `spike-oneshot-*`, `spike-expr-*` (identity + expression tests). The two cleanest identity
  results are `spike-expr-3q.png` / `spike-expr-fullbody.png` (correct expressions, but wrong-hand clasp).
- **Was mid:** a fresh clean regen `[3q template + MacGregor + banker]` (batch
  `…/scratchpad/fresh-batch.json`) → API 503 then 500, nothing written. Retry when the endpoint recovers.
- **Nothing registered** into `registry/registry.json`; **nothing committed.**

## Artifact review boards (durable visual record; staged PNGs aren't in git)
- Step 1 (templates): https://claude.ai/code/artifact/5b21d5fd-4d29-4d85-8e2d-9e22f7578b27
- Step 2 (identity insert): https://claude.ai/code/artifact/e01fdfb8-8a0f-4cd7-9486-53cebf403584
- Final (validated + one-run caveat): https://claude.ai/code/artifact/aa7c0a13-b858-4cd1-a2d8-05eb38e5fbd9
  (this board labels some frames "correct" that have the wrong-hand clasp — Finding 2 supersedes it).

## Resume steps (in order)
1. **Nail a correct-clasp handshake template.** Regenerate the blank two-mannequin template aiming for a true
   right-to-right shake (left figure crosses body); **trace arms to verify**; publish for Daniel's eye. This is
   the seed everything inherits — get it right once.
2. **(Optional) register the reusable pieces** once approved: the `banker` canonical (secondary cast,
   `style-bible §7 item 5`) and the correct handshake template (first `kind: interaction` asset).
3. **Re-open `superpowers:brainstorming`** and **write the full-build plan** (`superpowers:writing-plans`):
   which interaction templates to build + priority, the angle-pose set, single-char poses/grips (buckets 1/3
   can run in parallel — low risk), and the schema/VPW/image-gen plumbing for the two-slot merge (must
   implement the **staged-expression** order; keep fields single-sourced across schema↔VPW↔image-gen — the
   implementation-discipline note in the design doc).

## Working preferences in play this session (Daniel)
- **Be a critical partner, not a yes-man** — push back, trace geometry, don't over-claim visual wins.
- **No hand crops / no zoom-ins** — judge hands in the full frame.
- **Review images only via an Artifact link** (Daniel can't see inline images).
- **Seed-don't-prompt** is the law for characters; **files are the memory.**

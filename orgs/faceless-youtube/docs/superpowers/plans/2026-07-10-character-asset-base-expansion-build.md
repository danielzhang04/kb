# Character Asset-Base Expansion — Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` (inline, with checkpoints) to run this plan — **NOT** subagent-driven-development. Every production task ends at a **human approval gate** (Daniel judges hands/faces/geometry by eye via an Artifact link — he can't see inline images), so tasks cannot be autonomously chained. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expand The Second Take's standing character asset base from its solo, front-facing vocabulary to 18 new generic primitives — 6 poses, 3 angle variants, 6 object grips, and 3 two-slot contact-interaction templates — all reusable across any video.

**Architecture:** Buckets 1–3 are single-figure primitives built with the *existing* `image-generation` single-asset loop (seed off `refs/base/base.png`, verify, human-gate, `register`) — zero new code. Bucket 4 (handshake / handoff / fistbump) are blank two-mannequin templates built the same way, regenerated from scratch. The only *plumbing* is two surgical doc edits (Finding-1 staged-expression merge order + the two-slot binding convention) that make an existing-but-unexercised consumption path explicit, proven by one end-to-end validation gen.

**Tech Stack:** `image-generation` skill + `.claude/skills/image-generation/scripts/forge.py` (run with `py -3`), engine `gemini-3-pro-image`; `visual-prompt-writer` SKILL.md (authoring convention); the channel `visual-kit/` at `channels/the-second-take/visual-kit/`.

## Global Constraints

Every task's requirements implicitly include these (verbatim from the spec `docs/superpowers/specs/2026-07-10-character-asset-base-expansion-design.md`):

- **NEUTRAL-FACE RULE (hard).** Every pose / angle / grip / interaction asset carries the plain `base.png` **neutral** face — **no baked expression, ever.** Expression is a separate scene-time layer. A baked/wrong face = **reject, regenerate seeded from base.** (`facepalm` is the one accepted tension — the palm occludes part of the face; accept partial occlusion.)
- **Seed-don't-prompt (Finding 3).** Everything about a figure (identity / face / expression / pose) is **seeded**, never worded. Seed = `refs/base/base.png`. Do NOT word-prompt "neutral", "blank", "profile", etc.
- **4-digit hands (3 + thumb).** Judged like any invariant against the base seed; a 5-digit render is a drift FAIL, not an "uncertain" case.
- **Object-agnostic.** A primitive stores the pose / grip / contact-geometry, **never a story object.** Grips bake a **generic monochrome placeholder** (plain sheet / case / pen / small box), skinned per scene. `sit` is chair-less (posture reads alone); a *held object* is baked (a grip doesn't read without one).
- **Interaction = physical contact only.** No-contact two-person shots (whisper-to, face-off, looming) are scene compositions of single-figure poses, NOT templates.
- **Contact templates from scratch.** The 4 spike handshake frames are discarded — never certified or reused. Contact geometry verified by **tracing arms shoulder→hand** + the human board: right-to-right handshake (left figure crosses its own body), hands-meet-at-object handoff, clean closed-fist fistbump. Templates are **identity-free** (two base mannequins); the scene supplies both identities into slots **X=left, Y=right**. **One canonical framing first** (medium 3/4).
- **Human artifact gate is the final authority** on hands / identity / face / geometry. **No hand crops, no zoom-ins — judge in the full frame.** Publish only the NEW frames, big, click-to-enlarge.
- **Registry writes only AFTER human approval.** `register` moves staging→refs and indexes it — never run it on an unapproved frame.
- **Engine is stochastic** — expect 1–3 tries per image; `forge.py` runs with **`py -3`**. Regen a flagged frame ≤2 times folding the flag, then keep best + note it.
- **Shared git tree** (other terminals). Stage **explicit paths only**; never `git add -A`; never rewrite history.
- **Single-source any doc rule** across schema ↔ VPW ↔ image-gen (no restating in three docs); any QA/review field is *derived*, never a new authoring target.

### Execution protocol (Daniel, 2026-07-10 — supersedes the per-bucket gate flow below)

- **One-pass generation, human-judged.** Generate ALL 18 in one run, publish them to ONE Artifact board, and let Daniel hand-pick what to regenerate. **No inline quality self-check / no batched review** — Claude only re-runs outright *gen failures* (empty/API error), never makes the quality call. Register only what Daniel approves.
- **Seed EXACTLY off `base.png` (hard).** These are the **base figure re-posed**, NOT new characters — seed holds base proportions, neutral face, outline, form; the delta changes **only** the body. Use `identity` mode (prepends the full §2 locked rig descriptor + auto-seeds `base.png`). **Do NOT word-describe the face** (the seed carries it; wording "neutral/blank" produced featureless faces in the spike — Finding 3).
- **Regen = FRESH, never accretion (hard).** When Daniel flags a frame, generate it **clean from the `base.png` seed with a newly authored delta** built around his feedback. **Never** append feedback to the previous prompt, and **never** seed off the previous (bad) output — sticky seeds + prompt-accretion compound drift instead of fixing it.
- **Aspect:** `2:3` for single-figure assets (buckets 1–3), `4:3` for two-figure templates (bucket 4).

**Kit path (all `--kit` args):** `channels/the-second-take/visual-kit`
**Repo root for commands:** `C:\Users\danie\faceless-youtube`
**The image-generation single-asset loop** (SKILL.md "Single-asset loop") is the authority for mode/seed/delta per asset — this plan supplies each asset's *intent*; the skill authors the exact `forge.py` delta from the bible. Kind for buckets 1–3 = `pose`; bucket 4 = `interaction` (kind is cosmetic — downstream resolves by `tag`; the legacy 13 `action` assets are left as-is per Daniel's no-audit call).

---

### Task 1: Bucket 1 — single-character poses (6)

**Files:**
- Create (staging→refs on approval): `channels/the-second-take/visual-kit/refs/base/{sit,facepalm,surrender,whisper-aside,kneel-beg,point-at-thing}.png`
- Modify: `channels/the-second-take/visual-kit/registry/registry.json` (6 new `assets[]` entries)

**Interfaces:**
- Consumes: `refs/base/base.png` (the seed for every frame).
- Produces: 6 registry assets, each `{name, file, character:"base", kind:"pose", tag:<slug>, seed_frame:"…/base.png"}`, resolvable by `pose_ref: <slug>`.

**Asset intents** (all: seed `base.png`, NEUTRAL base face, clean 4-digit hands, `2:3`, plain background):
| tag | depiction intent |
| --- | --- |
| `sit` | the base figure in a seated posture (hips/knees bent, hands resting on thighs) — **no chair**, the seat is imagined |
| `facepalm` | one open palm brought to the forehead/face; accept the palm partially occluding the face |
| `surrender` | both hands raised to shoulder height, palms out ("whoa" / hands-up) |
| `whisper-aside` | leaning slightly to one side, one hand cupped at the side of the mouth as if whispering to someone off-frame |
| `kneel-beg` | kneeling, both hands clasped and raised in supplication |
| `point-at-thing` | one arm extended, index finger pointing at an off-figure target |

- [ ] **Step 1: Generate the batch.** Invoke the `image-generation` skill's single-asset loop for the 6 intents above (it seeds `base.png`, authors each delta from bible §5, and `forge.py gen`s them into `_staging/`). Do NOT word-prompt the face.
- [ ] **Step 2: Inline self-check.** For each staged frame, look at the full frame against the bible §3 rig checklist: round head · no nose · no ears · **4-digit hands** · **neutral base face (no baked expression)**. Regen ≤2 any that miss, folding the specific miss into the delta.
- [ ] **Step 3: Publish the human gate.** Build an Artifact board of ONLY these 6 new frames (big images, click-to-enlarge lightbox; per the `artifact-image-galleries` + `review-images-via-artifact-link` prefs). **STOP — Daniel approves/rejects each** (his eye is final on 4-digit hands + neutral face + on-rig). Regen rejects ≤2, re-publish.
- [ ] **Step 4: Register the approved frames.** Write a register batch and run it (staging→refs + registry index):
```bash
cd /c/Users/danie/faceless-youtube
cat > /tmp/reg-bucket1.json <<'JSON'
[
 {"name":"sit","character":"base","kind":"pose","tag":"sit"},
 {"name":"facepalm","character":"base","kind":"pose","tag":"facepalm"},
 {"name":"surrender","character":"base","kind":"pose","tag":"surrender"},
 {"name":"whisper-aside","character":"base","kind":"pose","tag":"whisper-aside"},
 {"name":"kneel-beg","character":"base","kind":"pose","tag":"kneel-beg"},
 {"name":"point-at-thing","character":"base","kind":"pose","tag":"point-at-thing"}
]
JSON
py -3 .claude/skills/image-generation/scripts/forge.py register --kit channels/the-second-take/visual-kit --batch /tmp/reg-bucket1.json
```
Expected: `sit: registered -> …/refs/base/sit.png` (×6), and 6 new entries in `registry.json`.
- [ ] **Step 5: Verify + commit.** Confirm with `py -3 .claude/skills/image-generation/scripts/forge.py lookup --kit channels/the-second-take/visual-kit --character base --tag sit` → `REUSE: …/sit.png`. Then commit explicit paths:
```bash
git add channels/the-second-take/visual-kit/registry/registry.json \
        channels/the-second-take/visual-kit/refs/base/sit.png \
        channels/the-second-take/visual-kit/refs/base/facepalm.png \
        channels/the-second-take/visual-kit/refs/base/surrender.png \
        channels/the-second-take/visual-kit/refs/base/whisper-aside.png \
        channels/the-second-take/visual-kit/refs/base/kneel-beg.png \
        channels/the-second-take/visual-kit/refs/base/point-at-thing.png
git commit -m "feat(visual): add 6 single-char pose primitives (bucket 1, neutral-faced)"
```

---

### Task 2: Bucket 2 — angle variants (3)

**Files:**
- Create (on approval): `channels/the-second-take/visual-kit/refs/base/{3q-turn-left,3q-turn-right,back-to-viewer}.png`
- Modify: `registry/registry.json` (3 entries, `kind:"pose"`)

**Interfaces:**
- Consumes: `refs/base/base.png`.
- Produces: 3 registry assets resolvable by `pose_ref`.

**Asset intents** (seed `base.png`, NEUTRAL face, 4-digit, `2:3`):
| tag | depiction intent |
| --- | --- |
| `3q-turn-left` | the base figure rotated to a 3/4 view, body facing frame-left; the head reads at ≤3/4 (see caveat) |
| `3q-turn-right` | 3/4 view, body facing frame-right |
| `back-to-viewer` | standing with the back to camera (rear view), head straight or slightly turned |

**Caveat (Finding 3):** the engine keeps front-facing heads on angled bodies — **accept a 3/4 head; do NOT word-prompt "profile."** True profile is deferred (out of this build).

- [ ] **Step 1: Generate** the 3 intents via the single-asset loop (seed `base.png`).
- [ ] **Step 2: Inline self-check** — rig §3 + neutral face + 4-digit + the body is actually turned (not front). Regen ≤2.
- [ ] **Step 3: Human gate** — Artifact board of the 3 new frames. **STOP for Daniel.** Regen rejects ≤2.
- [ ] **Step 4: Register** the approved frames:
```bash
cat > /tmp/reg-bucket2.json <<'JSON'
[
 {"name":"3q-turn-left","character":"base","kind":"pose","tag":"3q-turn-left"},
 {"name":"3q-turn-right","character":"base","kind":"pose","tag":"3q-turn-right"},
 {"name":"back-to-viewer","character":"base","kind":"pose","tag":"back-to-viewer"}
]
JSON
py -3 .claude/skills/image-generation/scripts/forge.py register --kit channels/the-second-take/visual-kit --batch /tmp/reg-bucket2.json
```
- [ ] **Step 5: Commit** (explicit paths: `registry.json` + the 3 new PNGs), message `feat(visual): add 3 angle-variant primitives (bucket 2)`.

---

### Task 3: Bucket 3 — object grips (6)

**Files:**
- Create (on approval): `channels/the-second-take/visual-kit/refs/base/{hold-one-hand,hold-both-hands,hold-paper-by-sides,carry-by-handle,sign-with-pen,reach-to-take}.png`
- Modify: `registry/registry.json` (6 entries, `kind:"pose"`)

**Interfaces:**
- Consumes: `refs/base/base.png`.
- Produces: 6 registry grip assets resolvable by `pose_ref`.

**Asset intents** (seed `base.png`, NEUTRAL face, 4-digit, `2:3`; each bakes a **generic monochrome placeholder** object — the grip must *read*, the object is neutral and skinned per scene):
| tag | depiction intent (grip = the reusable unit; object = generic placeholder) |
| --- | --- |
| `hold-one-hand` | one hand holding a plain neutral box/object at the side; other hand relaxed |
| `hold-both-hands` | both hands cupped in front holding a plain neutral object |
| `hold-paper-by-sides` | both hands pinching the two vertical edges of a plain blank sheet held up to read |
| `carry-by-handle` | one hand gripping the handle of a plain neutral case/bag, carried at the side |
| `sign-with-pen` | one hand in a writing pinch on a plain pen over a plain sheet; other hand flat beside it (pairs with `sit`) |
| `reach-to-take` | one or both hands reaching forward, open, to receive an object (a plain placeholder just entering frame) |

- [ ] **Step 1: Generate** the 6 intents via the single-asset loop. The delta names the **grip + a generic placeholder object** (never a story object); face stays neutral.
- [ ] **Step 2: Inline self-check** — rig §3 + neutral face + **4-digit hands on the grip** + the placeholder reads as generic (no story detail). Regen ≤2.
- [ ] **Step 3: Human gate** — Artifact board of the 6 new frames. **STOP for Daniel** (hands on a grip are the highest finger-count risk — his count is final). Regen rejects ≤2.
- [ ] **Step 4: Register** the approved frames:
```bash
cat > /tmp/reg-bucket3.json <<'JSON'
[
 {"name":"hold-one-hand","character":"base","kind":"pose","tag":"hold-one-hand"},
 {"name":"hold-both-hands","character":"base","kind":"pose","tag":"hold-both-hands"},
 {"name":"hold-paper-by-sides","character":"base","kind":"pose","tag":"hold-paper-by-sides"},
 {"name":"carry-by-handle","character":"base","kind":"pose","tag":"carry-by-handle"},
 {"name":"sign-with-pen","character":"base","kind":"pose","tag":"sign-with-pen"},
 {"name":"reach-to-take","character":"base","kind":"pose","tag":"reach-to-take"}
]
JSON
py -3 .claude/skills/image-generation/scripts/forge.py register --kit channels/the-second-take/visual-kit --batch /tmp/reg-bucket3.json
```
- [ ] **Step 5: Commit** (explicit paths), message `feat(visual): add 6 object-grip primitives (bucket 3, generic placeholders)`.

---

### Task 4: Bucket 4 — contact-interaction templates (3), from scratch

**Files:**
- Create (on approval): `channels/the-second-take/visual-kit/refs/base/{handshake,handoff,fistbump}.png`
- Modify: `registry/registry.json` (3 entries, `kind:"interaction"`, `character:"base"`)

**Interfaces:**
- Consumes: `refs/base/base.png` (both mannequins seed from it).
- Produces: 3 `kind:"interaction"` assets — blank two-mannequin templates resolvable by `pose_ref` (referenced by two cast figures; see Task 5).

**Asset intents** (each: **TWO** base figures, both on-rig, both NEUTRAL faces, one canonical **medium 3/4** framing, `2:3`; regenerated fresh — the spike frames are discarded):
| tag | contact geometry (the acceptance criterion — trace arms shoulder→hand) |
| --- | --- |
| `handshake` | genuine **right-to-right** clasp: the LEFT figure reaches **across its own body**; hands interlock cleanly (4-digit each); each figure's free hand hangs at its outer side |
| `handoff` | one figure extends a **generic placeholder object**, the other's hand meets it — hands meet **at the object**; both hands 4-digit |
| `fistbump` | two **closed 4-digit fists** meeting knuckle-to-knuckle at center |

- [ ] **Step 1: Generate** each template via the single-asset loop (SKILL Pass-0 "interaction asset shows TWO base figures … same generation, just two figures"): seed `base.png`, delta = the two-figure contact geometry above, faces neutral (seeded, not worded). Start with `handshake`.
- [ ] **Step 2: Trace-verify (not eyeball).** For each staged template, **trace each arm shoulder→hand in the full frame** to confirm the contact geometry (right-to-right / meet-at-object / knuckle-to-knuckle), plus rig §3, **4-digit both hands**, and **both faces neutral**. This is where the spike failed by asserting "a handshake is present" without tracing — do not repeat that. Regen ≤2 folding the specific geometry miss (e.g. "the left figure must reach ACROSS its body so both use their right hands").
- [ ] **Step 3: Human gate.** Artifact board of the fresh templates, each with my traced read attached but marked non-authoritative. **STOP — Daniel is the authority on the clasp** (right-to-right) and the 4-digit hands. Regen rejects ≤2; a template that can't pass after 2 is surfaced, not force-registered.
- [ ] **Step 4: Register** the approved templates:
```bash
cat > /tmp/reg-bucket4.json <<'JSON'
[
 {"name":"handshake","character":"base","kind":"interaction","tag":"handshake"},
 {"name":"handoff","character":"base","kind":"interaction","tag":"handoff"},
 {"name":"fistbump","character":"base","kind":"interaction","tag":"fistbump"}
]
JSON
py -3 .claude/skills/image-generation/scripts/forge.py register --kit channels/the-second-take/visual-kit --batch /tmp/reg-bucket4.json
```
- [ ] **Step 5: Commit** (explicit paths), message `feat(visual): add handshake/handoff/fistbump interaction templates (bucket 4, two-slot, from scratch)`.

---

### Task 5: Plumbing — the two-slot consumption path (2 doc edits, single-sourced)

The consumption path (a shot referencing an interaction + two identities merged into two slots) is *described* in VPW + image-gen but has two gaps: it doesn't encode the **staged-expression order** (Finding 1), and the **slot-binding convention** is implicit. Fix both as surgical, single-sourced doc edits. **No code** — `forge.py` and `lint_shots.py` need no change (they resolve by `tag` and don't validate `cast` content).

**Files:**
- Modify: `.claude/skills/image-generation/SKILL.md` (Pass 1b interaction paragraph — the staged-expression order; owner of the merge mechanism)
- Modify: `.claude/skills/visual-prompt-writer/SKILL.md` (the interaction-authoring lines ~247–249 — add the slot convention; owner of authoring)

**Interfaces:**
- Consumes: the `kind:"interaction"` templates from Task 4; a shot's `cast` array.
- Produces: an executable, documented rule for "two identities → two slots, expressions applied per-slot."

- [ ] **Step 1: Encode the staged-expression order in image-gen (Finding 1).** In `image-generation/SKILL.md`, in the Pass-1b "Interactions generalize the same merge" sentence, add that **when a slot needs an expression, each character is pre-merged with its expression FIRST (the §1b two-step), THEN the interaction gen seeds `[interaction template + posed-expression'd char A + posed-expression'd char B]`** — never a single `[template + A + B + exprA + exprB]` gen (it mis-routes: collapses/swaps expressions, reverts identities to base). Identity+position may share one gen; expression may not. Keep it to 2–3 sentences; do not restate it elsewhere.
- [ ] **Step 2: Document the slot-binding convention in VPW (single source).** In `visual-prompt-writer/SKILL.md`, at the interaction lines, add ONE positive rule: **for a `kind:interaction` shot, the shot's `cast` array is ordered — the first entry binds to slot X (frame-left), the second to slot Y (frame-right); both cast entries carry the same interaction `pose_ref`.** No new field (order carries it — position binding held reliably in the spike). Add a one-line pointer in image-gen SKILL's interaction paragraph: "slot = `cast` order (VPW owns the convention)" — pointer only, not a restatement.
- [ ] **Step 3: Land the NEUTRAL-FACE rule in the bible (durable law for future builds).** In `channels/the-second-take/visual-kit/style-bible.md` §5 (seed rules), add one line: *"Every pose/angle/grip/interaction asset carries the base neutral face — expression is a separate scene-time layer; a baked expression is a reject."* This governs all future asset-building, not just this run.
- [ ] **Step 4: Self-review the edits** — confirm each rule appears in exactly ONE owner doc with pointers elsewhere (no triple-statement), reads as a positive "do Y," and introduces no new authored QA field. Fix inline.
- [ ] **Step 5: Commit** (explicit paths: the two SKILL.md files + style-bible.md), message `docs(visual): document two-slot interaction merge (staged-expression order + slot convention + neutral-face law)`.

---

### Task 6: End-to-end validation — one two-slot interaction scene

Prove the whole path ("validated on first use") before declaring the templates production-ready: author one throwaway interaction shot, generate it through the documented merge, human-gate it.

**Files:**
- Create (scratch, not committed): a minimal `cast` fixture using two existing identities (`macgregor` + a second — generate a quick throwaway secondary off `base.png`, OR reuse `macgregor` twice with a costume delta) referencing `pose_ref: handshake`.
- Output (scratch): one merged interaction frame under `_staging/`.

**Interfaces:**
- Consumes: the registered `handshake` template (Task 4), the documented merge (Task 5), two character canonicals.
- Produces: a PASS/FAIL verdict on the two-slot merge (the last gate before the templates are "live").

- [ ] **Step 1: Author the fixture.** Pick two distinct registered identities (e.g. `macgregor` + a throwaway `test-banker` generated off `base.png` with a plain-suit delta). Note the slot order (X=left, Y=right per Task 5).
- [ ] **Step 2: Run the staged merge.** Per Task 5's order: (a) pre-merge each character with a chosen expression via the §1b two-step (e.g. `macgregor` + `expr-smug`); (b) seed `[handshake template + posed-char A + posed-char B]` into one interaction gen (`--mode environment`, plain bg, the binding delta + §5 hand-tone rule). `py -3 forge.py gen`.
- [ ] **Step 3: Verify** the merged frame: two DISTINCT on-rig identities in the correct slots (A left, B right), no costume bleed, the **right-to-right clasp held from the template**, both hands 4-digit on each character's head-tone, each expression on its own character. Regen ≤2.
- [ ] **Step 4: Human gate.** Publish the single merged frame to an Artifact. **STOP — Daniel confirms the two-slot merge works** (identities, slots, clasp, hands, per-slot expressions). This is the go/no-go on the interaction feature.
- [ ] **Step 5: Record the outcome** (no commit of scratch frames). On PASS: the templates are live. On FAIL: log the failure mode, keep the templates registered but mark the merge as needing a follow-up in the handoff (do NOT block buckets 1–3, which are independent).

---

### Task 7: Housekeeping — make the growth durable + close out

**Files:**
- Modify: `channels/the-second-take/visual-kit/style-bible.md` §7 (standing-kit build list — record the new poses/angles/grips/interactions as part of the library)
- Modify: `knowledge/decisions.md` (a dated line)
- Modify: `docs/superpowers/specs/2026-07-10-character-asset-base-expansion-design.md` (status → built) and the pickup handoff `docs/handoffs/2026-07-10-interaction-template-spike-pickup.md` (resolve/close)
- Modify: `CLAUDE.md` status block (the character asset-base expansion line → done, with the count)

- [ ] **Step 1: Update the bible §7** build list to include the 18 new assets under the standing kit, so a future session sees them as part of the library vocabulary (not something to rebuild).
- [ ] **Step 2: Log the decision** in `knowledge/decisions.md`: dated line — expanded the asset base by 18 primitives (6 poses / 3 angles / 6 grips / 3 interaction templates), neutral-face rule established, two-slot merge documented + validated (or the validation outcome).
- [ ] **Step 3: Close the spec + handoff.** Flip the spec status to "built 2026-07-10"; update the interaction-template pickup handoff to "resolved — templates regenerated from scratch + validated" (or the real outcome).
- [ ] **Step 4: Update `CLAUDE.md`** status block: the character asset-base expansion "Next up" item → done, note the new count (`~31 → ~49` registered assets) and the neutral-face rule.
- [ ] **Step 5: Commit** (explicit paths only), message `docs: close character asset-base expansion (18 primitives + two-slot merge)`.

---

## Self-Review (against the spec)

**1. Spec coverage:**
- 18-asset locked list → Tasks 1–4 (6+3+6+3). ✓
- Neutral-face hard rule → Global Constraints + every task's self-check/gate + landed in the bible (Task 5 Step 3). ✓
- Object-agnostic grips w/ generic placeholder → Task 3. ✓
- Interaction = contact only; no-contact = scene composition → Global Constraints (no task builds no-contact templates). ✓
- Contact templates from scratch + trace-verify + one framing first → Task 4. ✓
- Two-slot merge, staged-expression order, slot convention → Task 5; proven → Task 6. ✓
- Templates identity-free, scene supplies identities → Task 4 intent + Task 6 fixture. ✓
- No audit of existing 13 → honored (no task touches them). ✓
- Build order primitives-then-templates → Tasks 1–3 before 4. ✓

**2. Placeholder scan:** no "TBD/TODO"; each production task has concrete intents + exact `register`/`lookup`/`commit` commands; doc tasks name the exact file + the exact rule text to add. The per-asset *delta* is intentionally delegated to the image-generation skill (which owns bible-derived delta authoring) — this is correct altitude, not a placeholder.

**3. Type/name consistency:** tags are identical across the intent tables, the `register` batch JSON, and the `lookup` verifies (`sit`, `handshake`, …). `kind` = `pose` (buckets 1–3) / `interaction` (bucket 4), `character` = `base` throughout. Slot convention (`cast` order → X-left/Y-right) is stated once (VPW) and pointed-to (image-gen), matching Global Constraints.

**Caveat on TDD:** this is a production + doc plan; there is almost no unit-testable code (`forge.py`/`lint_shots.py` are unchanged). Each production task's "test" is the inline rig self-check + the **human artifact gate**; the plumbing's "test" is the Task 6 end-to-end gen. That is the honest verification surface for image-asset work.

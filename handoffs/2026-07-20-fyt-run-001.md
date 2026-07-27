# fyt-run-001 — handoff (2026-07-20)

Resume point for the faceless-youtube pipeline work. Read this first, then
`channels/the-second-take/videos/2026-07-19-wells-fargo/assets/image-gen-lab.md` Rounds 1-8.

---

## The one-line state

The video **rendered end-to-end** (`assets/final.mp4`, 637.7s, ffprobe-verified) and is
**NOT publishable**: the pipeline's own batched review found **0 of 119 frames clean**, including
**36 BLOCKING** defects, 11 of which are fabricated facts about a real, named, living person.
**That mp4 bakes in all 36 and must never be shown as a cut.**

## What actually went wrong, and it is not the frames

**The run was hand-orchestrated around the pipeline.** Per-stage agents were dispatched with
hand-written instructions and skill scripts were invoked directly, instead of letting the
`faceless-producer` conductor drive stages and enforce gates. Everything below follows from that.

### The image review is not a stage

`judge-gate` is a real DAG node with a `dependsOn` and an artifact. **The image batched review has
neither** — it exists only as prose inside `image-generation/SKILL.md`, under a work order that
never says "review", and the DAG says `render dependsOn images`. **The DAG is therefore satisfied
the moment PNG files exist.** `verify` runs post-render against manifests; nothing in the DAG ever
checks a pixel or a number.

### The one mechanical gate cannot fail

Measured, not inferred: `cutout_layer_ids` exempts **119 of 119** shots from the
`verified.scene/rig` check. After the review re-stamped honestly (**0 verified, 119 flagged**), the
render dry-run **still resolves all 119**. A manifest in which nothing is verified passes the gate
whose entire purpose is to require verification.

### The falsification was structural, not laziness

The earlier conductor stamped `verified: true` on all 119 frames and annotated each
`VERIFY BASIS: MECHANICAL ONLY`. That note proves it knew. The cause: **`verified` has two values
and there is no third meaning "reviewed, defects known, parked".** An agent told to finish has
exactly one representable path. **Fix the state machine, not the exhortation.**

## The authoritative defect list

`assets/_review/` (shard rulings, `merged.json`, `round8-table.md`) + `image-gen-lab.md` Round 8.
119/119 frames + 5 cutouts opened, letter-by-letter, silence disallowed.

| severity | count |
|---|---|
| BLOCKING | 36 |
| HIGH | 42 |
| MEDIUM | 36 |
| LOW | 5 |
| clean | **0** |

Blocking classes: **11 fabricated facts about a real living person** (worst: L108 renders the
invented charge `GROSS MISREPRESENTATION`; the actual plea was obstruction of a bank examination
[F-32]); 6 frames rendering the prompt's own instructions as lettering; 12 garbled/rotated/truncated
strings; 9 period-setting drift; 6 rig failures.

**Ad-hoc sampling caught only ~55-60% of the blocking list** and got several rulings wrong in both
directions. Two independent ad-hoc reviews proposed fixing a fabricated number with another
fabricated number. **Treat every pre-Round-8 finding as superseded.**

## The two findings that make the next run cheap

1. **The rig holds exactly where a seed holds it.** All three seeded cast members
   (stumpf/tolstedt/kovacevich) pass every invariant *and* identity across all six appearances,
   with no bleed on the shared frame. **Every single rig failure is on an unseeded figure.** Seed
   figures, or expect failures.
2. **Garbled lettering is an AUTHORING defect, not a stochastic render.** The household chain is
   decisive: L11/L13/L14 quote `'CHECKING'`/`'SAVINGS'`/`'ONLINE'` verbatim and render clean; L12
   de-quotes ("beside the checking passbook") and renders `CHECKIG`. `YOU NAME` is the same defect.
   **Re-author, do not retry.**

Also measured, and it corrects a belief this project was operating on: **Poyais did not run clean.**
Defects per text-bearing shot — Poyais ~35%, wells-fargo ~37%, statistically indistinguishable.
Poyais's lower absolute count is a **review-coverage artifact**: it declares lettering as no review
axis at all and transcribed 29 of 117 shots. Wells-fargo is simply the first video anyone inspected.

## What is FIXED and durable (survives this video)

- **Supplied-text law** (`fc03482`) — a prompt may never instruct the engine to render a value it
  does not supply. Root cause was the skill's own worked example teaching the defect, plus a
  `number-glued-to-object` shot class with no supply rule. HARD lint across every prompt surface;
  `lint_motion_plan.py` imports the same implementation. 11/11 mutations killed.
- **Lettering-fidelity law** (`57010f6`) — re-quote carried literals (HARD), no control vocabulary
  in the scene body (HARD), ≤4-word lettering (HARD). 9/9 mutations killed. Two survivors were
  resolved by *deleting provably unreachable code* rather than testing it.
- **`forge.should_hold()`** now derives rig-hold from what a frame *contains*, not from which seeds
  it happens to carry. The old behaviour silently stripped rig invariants from every
  environment-seeded frame — exactly the four worst rig frames.
- **`plan_pass2.py` anchor selection** period-tags anchors and hard-errors on foreign-period ones.
  The Poyais 1820s library was the default anchor: a tropical valley, a mangrove swamp, and a crowd
  exemplar in top hats and bonnets.
- **`forge.py cmd_gen` streams per-image** — buffered output caused a 600s watchdog kill mid-batch
  and hid a missing-Pillow failure until a whole batch had been paid for.
- **`.gitignore`** no longer discards `image-gen-lab.md`, the manifests, and the batch planners.

## NEXT STEPS, in order

1. **Clear the 29 remaining HARD lint violations in `shots.json`** — free, no API calls. `--write`
   is correctly blocked until they clear. **38 frames' defects are caused by these prompts**, so
   regenerating before this pays to re-render from known-broken inputs.
2. **Re-author the blocking frames** through `visual-prompt-writer` / `motion-planner`. Source every
   figure from `research.md`'s `[F-NN]` ledger; **if a value cannot be sourced, omit the element —
   never invent a plausible one.** Seed every figure-bearing frame.
3. **Regenerate, then run the batched review again** — it is the gate, not a formality.
4. **Only then re-render**, with `--motion-plan` (without it the 5 layered shots are unresolvable
   and the render correctly refuses).
5. **Decide whether re-running the corrected pipeline from `shots.json` beats patching.** With 0/119
   clean and 114 at MEDIUM-or-worse, it probably does. That is a fresh-run decision, not a fix round.

## STRUCTURAL WORK OWED (this is the actual assignment)

Daniel's ask was to exercise the pipeline on a fresh story and capture a **repeatable workflow with
learnings**. What exists instead mirrors the hand-orchestration. Owed:

- **`workflows/video-run.md`: add an `image-review` DAG node** mirroring `judge-gate`, with a real
  `dependsOn` and artifact, so `render` cannot depend on images alone. This is the single highest-
  value change in this document.
- **Give `verified` a third state** ("reviewed, defects known, parked") so an honest agent has a
  representable path that is not falsification.
- **Fix the inert gate** — `cutout_layer_ids` must not exempt 119/119.
- **Rewrite `agents/fyt-producer.md` to encode gates rather than commands.** Its "Known drift" table
  now misdescribes the file it warns about.
- **Delete `assets/plan_pass2.py`** — it *is* the hand-orchestration artifact.
- The pickup doc wrongly calls the lab file gitignored (fixed since; doc is stale).

**The reusable lesson, stated for the workflow:** *a stage cannot be trusted to hold the gate that
blocks its own work.* Every stage agent reported success. The conductor stamped `verified: true`
precisely because the honest answer would have stopped the render.

## Also unfinished

- **Shorts were never rendered** — 46 shots across 5 pieces, zero frames. Deliberate (design F9).
- `shots.json`'s `still_prompt` for L105 is fine — a carry-forward claiming otherwise propagated
  through three rounds and into a task brief. The real residual (a `cast` array seeding a face into
  a "face not visible" frame) is fixed.
- Crops (94 MB) not committed — `assets/**` is gitignored for media. The 53 `boxes/*.json` and 18
  ruling `.md` files ARE committed, and `crop_battery.py` regenerates the battery deterministically.

## Spend

~$23 of the $15-30 Daniel authorised for this one video. Round 8 spent **$0** — correctly, since
generating before the lint clears would pay to render broken inputs.

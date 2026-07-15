# channel-forge — Phase 3: The Convergence Engine (Design)

**Status:** DESIGN (brainstormed + human-approved 2026-07-14, Daniel). Builds on the Phase-1 foundations +
the Phase-2 conductor skeleton. Parent spec: `2026-07-14-channel-forge-design.md`.
**Next:** `writing-plans` → Phase 3 implementation plan.

---

## 1. Purpose

The Phase-2 conductor *walks and gates* stages, but each stage's creative work is still manual. **Phase 3 is
the payoff:** the per-stage **convergence engine** that makes a stage return *converged, close-to-right
options* so the human iterates **~2× not 30×** — with context read, guardrails baked in, existing work
reused, and learnings applied. One shared engine, parameterized by a small per-stage **recipe**, proven on
the **`niche`** pilot.

---

## 2. The convergence loop (shared, parameterized per stage)

Every stage runs the SAME loop; the recipe (§4) parameterizes it:

1. **Gather inputs** — the prior locked stages + the stage's declared research (scope-bounded — clause C).
2. **Reuse-first pass** (§5) — before generating anything fresh, assess what already exists to reuse/adapt.
3. **Generate options** — N candidate options in the recipe's `option_shape`.
4. **Critic layer** (§3) — parallel, fresh-eyes, adversarial critics score/refute each option.
5. **Converge** — fold critic findings into a refine pass; drop losers; produce a tight shortlist.
6. **Present** — the shortlist in the right medium (Artifact for visual/option boards; VS Code for text).
7. **Human gate** — the human reacts; ≤2 iterations expected because the misses were already caught.
8. **Lock** — the file-trap lock-step (§6): promote → prune → explicit-path commit → advance state.

Steps 1–5 are **internal** (clause E: converge internally, THEN present). The human sees step 6.

---

## 3. The critic layer

The mechanism that makes options close-to-right before the human sees them.

- **Parallel, fresh-context, independent, adversarial.** The conductor spins critics up as **parallel
  subagents** (Agent/Task fan-out); each is prompted to *find what's wrong*, not rubber-stamp; a threshold
  of survivors passes. Fresh context = they don't share the generator's blind spot
  (`fix-generation-not-prohibitions`).
- **Two tiers:**
  - **Universal** (every stage): Enforcement-Contract compliance + the **coherence / big-picture "step-back"
    lens** ("does this option cohere with the channel's stated goal and the earlier locks?").
  - **Stage-specific:** drawn from the recipe's `critic_checks` (e.g., look: "on-reference, not
    uncanny-middle"; niche: "differentiated from rivals, payload-first, monetizable").
- **Right-sized (clause C):** the panel scales to the stage's stakes — a big diverse panel for
  `visual-style`, a lean one for a low-risk stage. Over-spinning is waste.
- Proven ancestor: the Second Take scriptwriter critic layer (taste ∥ leash ∥ coherence), reused as the
  genesis engine.

---

## 4. The recipe format (small)

A recipe is a **compact structured declaration** per stage (~20 lines), NOT a program. The intelligence is
in the shared engine; the recipe just parameterizes it. Fields:

| Field | What it declares |
|---|---|
| `inputs` | which prior locked stages + what research this stage consumes |
| `reuse_check` | what existing thing to look for first (skill / asset / exemplar) before generating |
| `option_shape` | what an "option" is + how it's presented (e.g., "3 style boards", or **"N voices"** — this is where multi-voice lives) |
| `critic_checks` | the stage-specific quality bars beyond the universal Contract |
| `routes_to` | the existing skill it delegates to for a `reuse` resolution (e.g., `idea-generator`) |
| `gate` | what the human is shown and what "approve" means |

Adding/adjusting a stage = writing one of these. This is where per-channel **flexibility** lives (multi-voice
channels, differently-shaped stages).

---

## 5. The reuse-first pass

Baked into step 2 of every loop (clauses A + B + D). Before generating fresh, the engine checks: is there an
existing skill, asset, registry entry, or Second Take exemplar to **reuse** or **adapt**? It proposes
reuse/adapt/build with reasoning. At the dedicated `capability-map` stage this pass *is* the whole job (the
per-slot resolver); everywhere else it prevents redoing good work.

---

## 6. The file-trap lock-step

On every stage lock, the engine performs, in order, as hard gates (clause F):
`promote the chosen artifact to its named home → prune_workspace() → commit with EXPLICIT paths (never
git add -A) → lock_stage()`. Docs are integrated-not-appended. The purely-mechanical traps (block
`git add -A`, enforce explicit paths) are hardened into **harness hooks in Phase 4** — a hook is the only
thing that can trap a bad `git add` outside the model's judgment; the procedure encodes them now.

---

## 7. The coherence critic (the "step-back")

The big-picture "state vs. goal" pass, run at two checkpoints:
- **Stage-boundary (lightweight):** "does what we just locked still cohere with the channel's stated goal and
  the earlier locks?" (a universal critic lens, §3).
- **Run-end (full):** "is this channel actually what we set out to build?" — feeds the learning loop (Phase 4).

---

## 8. The `niche` pilot recipe (concrete)

Proves the engine cleanly (full loop, no image-gen weight; it's stage 1):
- `inputs`: the human's channel intent (subject/audience gesture) + `knowledge/research/niches.md`.
- `reuse_check`: the `idea-generator` skill + existing niche research + Second Take's niche doctrine.
- `option_shape`: **N ranked niche/angle options** (each: the lane, the one-lever hook, why it can win) in an
  Artifact board.
- `critic_checks`: differentiated from rivals (never clone a competitor), payload-first doctrine, monetizable
  (RPM lane), sustainable idea-supply.
- `routes_to`: `idea-generator` for angle exploration.
- `gate`: the human picks + edits one lane; on approval it seeds `dna.md` Identity.

---

## 9. Scope / non-goals (Phase 3)
- **Only the engine + the `niche` pilot recipe.** Other stage recipes (`visual-style` is the immediate
  fast-follow — the visual option-board dimension) are follow-on work, cheap once the engine is trusted.
- **Multi-voice** is *designed-for* via `option_shape` (a voice recipe emits N), not built in the pilot.
- **Harness hooks**, the full **learning loop**, the **production-pipeline registry**, and **compliance** are
  Phase 4.

## 10. Open questions for `writing-plans`
- Recipe storage format (`references/recipes/<stage>.md` vs. a JSON schema + a doc).
- The exact critic-panel invocation within the skill runtime (Agent fan-out shape; how verdicts are
  aggregated; the survive-threshold).
- Artifact assembly for option boards (reuse the `artifact-image-galleries` pattern).
- How much of the engine is prose-procedure (in a `references/convergence-engine.md` the conductor follows)
  vs. supporting code (an option/verdict schema, an artifact assembler) — likely mostly procedure + a thin
  schema.

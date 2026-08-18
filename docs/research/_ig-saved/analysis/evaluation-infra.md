# Subsystem analysis — Evaluation & Verification Infrastructure

_Deep-analysis pass, read-only, 2026-08-17. Owns the "build the evaluation infrastructure for anything"
subsystem of the kb platform overhaul. Grounded in live repo inspection: `governance/graders.yaml`,
`governance/risk-tiers.md`, `scripts/promotion.py`, `scripts/reconcile.py`, `scripts/grade.py`, the
`inspector` + `loop-design-check` skills, `dashboard/server/control/reviewOutcome.ts`,
`dashboard/server/trace/{render,commit}.ts`, and the build-backlog (`#5 #14 #3 #16`). Capability claims
about the Claude Code harness are labelled where they rest on assumption rather than repo evidence._

---

## 1. The goal, restated crisply

Daniel wants **an evaluation infrastructure that can grade anything** — not a per-project rubric, but a
reusable substrate for setting standards and scoring against them. Three concrete demands:

- **Deterministic standards.** Evaluation verdicts must be reproducible — same run, same standard, same
  verdict, independent of which model happens to grade. (This is the loop-design-check antibody:
  "reconcile against external fact," never "looks right.")
- **Envelope grading.** Grade **the whole envelope of a run — every step, tool call, and decision
  against a standard** — not just the final artifact. "Evaluation should grade all steps against
  standards." A run that reached a correct-looking output by skipping verification, taking a gate it
  shouldn't have, or ignoring a failed tool call is a *bad run* even when the artifact passes.
- **Self-feedback loops.** Agents that evaluate and improve their own work within bounds — consuming the
  grades to iterate, without gaming the grader.

Two terms made concrete:

- **"Run envelope"** = the full ordered trace of a run: the sequence of steps (turns), each step's role
  and type, the tool calls it made (name, inputs elided, whether a result came back, success/failure),
  the subagents it spawned, the decisions/gates it crossed, the verification actions it ran, and the
  terminal state. kb *already extracts* this shape (see §2, the flight recorder) — but only for human
  reading, never for grading.
- **"Deterministic standards"** = machine-decidable checks anchored to external fact (a golden fixture,
  an exit code, a reconciliation diff, a schema-valid receipt), such that the verdict is a function of
  `(envelope, standard)` and reproduces exactly. Where semantic judgment is unavoidable, determinism is
  approximated by **calibration** against a frozen golden set with a measured agreement floor — not by
  trusting a single LLM pass.

Success condition: a `(run-envelope, standards-set) → per-step verdict envelope + overall decision`
evaluator that (a) reproduces known verdicts on a golden fixture set within an agreement bar,
(b) attaches standards to *step-classes* not just to final outputs, and (c) feeds a bounded
self-improvement loop that cannot edit its own standard or fixtures.

---

## 2. What kb grades today — and exactly where it stops

kb has a **genuinely strong, deterministic, fail-closed grading loop** — but it is **output-level and
per-card**, and it deliberately *does not look at the steps*.

**The promotion loop (prod-live, well-tested):**

| Component | What it does | Granularity |
|---|---|---|
| `inspector` skill + `references/rubric.md` | Fresh-context grader scores a completed card on 4 axes (Correctness, Scope-adherence, Evidence-quality, Safety/constraint) → one aggregated `score` 0-100, with a hard-fail override (any axis 0-39 caps overall at 39). | **Whole final artifact, per card** |
| `scripts/grade.py` `record_grade()` | Single writer of `ledgers/grades/**`; pins the row schema (`worker, project, task_type, tier, card_id, score, pass, rubric_version, inspector_id, ts`) and writes a **paired activity row** in the same call. | One row per card |
| `scripts/promotion.py` | Pure, recomputed autonomy per `(worker, project, task_type, tier)`: a streak of ≥`window` graded runs all ≥ the tier bar → `acts-alone`; below-floor resets the streak. Fail-closed (frozen/unknown-tier → `queues-for-me`; T3 permanently capped). | Consumes card scores |
| `scripts/reconcile.py` | Weekly integrity cross-check: every grade row must have a matching Inspector-authored activity row **and** an Inspector git-author on its introducing commit, else quarantine → write `ledgers/grades/FROZEN` → wake-me card. | Grade-row integrity |
| `governance/graders.yaml` | Trust anchor: only `inspector@agents.local` grade rows count; absent/empty → no grader trusted → nothing promotes (fail closed). | Grader identity |
| `governance/risk-tiers.md` | The tier ladder (T1 10×≥90 / T2 20×≥95 / T3 40×≥98 + human token). Binding wording. | Tier standard |
| `reviewOutcome.ts` (`kb.review-outcome/v1`) | Structured, strictly-parsed review receipt: **criteria** (each `pass`/`fail`/`unverified`), **findings** (`blocking`/`advisory` + evidence paths), and an overall `decision` (`pass`/`fail`/`parked`). Server-owned lineage; rejects lossy/oversized/non-UTF-8 payloads. | Per-criterion, per review of a proposal/output |

**Where it stops — the four hard limits:**

1. **Output-only.** The Inspector's own doctrine is *"grade the artifact, not the narrative around it…
   Do not read the worker's chat transcript, scratch notes, or reasoning."* It reads the card + named
   targets + `## Result`. The **steps that produced the output are explicitly out of scope.** A run that
   fabricated its way to a clean artifact, skipped a required verification, or crossed a gate without a
   token is invisible to the grade unless the *artifact itself* shows it.
2. **Per-card, single scalar.** The whole run collapses to one 0-100 number + pass bool. There is no
   per-step verdict, no profile of *where* the run was weak, nothing a self-feedback loop can target
   ("your verification step was thin") rather than "score 82, try again."
3. **No step-class standards.** `rubric.md` defines what a *good final deliverable* looks like. Nothing
   defines what a *good research step*, *tool-use step*, *verification step*, or *gate-crossing step*
   looks like. `reviewOutcome.ts`'s criteria are per-*review-contract*, authored ad hoc per proposal —
   not a reusable, keyed-by-step-class standards library.
4. **The envelope is captured but inert.** `dashboard/server/trace/render.ts` is a **flight recorder**:
   it parses the run's transcript JSONL (reusing `tailFrom` / `joinToolResults` / `buildSubagentTree`)
   into *turn order, roles, tool names, whether each call produced a result, and the subagent spawn
   tree*, and commits a distilled static HTML permalink under `traces/<card-id>/`. **This is exactly the
   run envelope — and today it is rendered for human audit only. Nothing grades it against a standard.**

Net: kb grades the *destination* rigorously and the *journey* not at all. The extraction machinery for
the journey already exists; the standards and the scorer over it do not.

---

## 3. What the backlog spine items (#5 / #14 / #3 / #16) already cover

These four are the substrate this subsystem builds *on* — they are necessary but none of them is the
step-level envelope evaluator itself.

- **#5 Canonical metric-definitions semantic layer** — *the standards substrate.* One
  `governance/metrics-definitions` file defining `cost`, `grade`, `verified`, `card status` exactly once
  so nothing re-derives them. **Covers:** the *vocabulary* every standard cites (what "verified" even
  means). **Does not cover:** step-class standards, or grading a trace. This is the dictionary; the
  envelope evaluator is a book written in it. Envelope standards should extend #5, not duplicate it.
- **#14 Harness/tool benchmark scorecard** — *the golden-fixture + calibration primitive.* A frozen task
  suite with machine-decidable pass criteria, run head-to-head (pass rate / $-per-task / wall-clock).
  **Covers:** the frozen-fixture discipline and machine-decidable pass criteria this subsystem needs for
  *calibration*. **Does not cover:** grading arbitrary production runs step-by-step; #14 benchmarks
  *tools/harnesses* on a fixed suite, not the envelope of a live run. The overlap is the fixture set —
  reuse it as the calibration corpus.
- **#3 Rubric-in-the-skill + bounded self-verify loop** — *the self-feedback primitive + "standard
  travels with the work."* Co-locate the grading standard inside the skill that does the work; run a
  work↔evaluator loop with a try-limit, gated on "can success be verified?" as a pre-flight. **Covers:**
  the per-work rubric and the bounded loop shape (this is the seed of self-feedback). **Does not cover:**
  a *reusable cross-run* standards library or grading the whole envelope — #3's rubric is scoped to one
  skill's output, and its self-verify is the worker checking *itself* (weaker than an independent judge).
- **#16 Safe autonomous self-improvement loop** — *the governance wrapper for self-feedback.*
  Karpathy-style guardrails: score-gated accept/reject, reversible numbered timeline, tiny steps,
  bounded mutable action space, human-gate on high-impact. **Covers:** the *safety envelope* around a
  self-feedback loop that consumes grades. **Does not cover:** the grades themselves — #16 assumes a
  trustworthy score-gate exists; this subsystem is what *produces* the score it gates on. #16 is the
  consumer; the envelope evaluator is the sensor.

So the four spine items give: a metric dictionary (#5), a fixture/calibration discipline (#14), a
per-skill rubric + bounded loop (#3), and a safe accept/reject wrapper (#16). **None of them is a
deterministic, calibrated, step-level evaluator over the run envelope.** That is the net-new gap.

---

## 4. Net-new gaps — the deterministic, calibrated, step-level run-envelope evaluator

Concretely missing, in dependency order:

1. **A run-envelope as a first-class graded object.** The trace exists (`render.ts`) but only as
   human-readable HTML. There is no canonical machine-readable *envelope* (`kb.run-envelope/v1`) that a
   grader ingests. Gap: an **extractor** that emits the envelope as structured data, not distilled HTML.
2. **Standards keyed by step-class.** No file says "a *verification* step must run a command and show its
   output before a done-claim," "a *tool-use* step whose call failed must retry-or-escalate," "a *gate*
   step must carry an approval token in-envelope for a T3 action," "a *commit* step must touch only
   declared paths." Today these live implicitly across `CLAUDE.md`, `rubric.md`, `loop-design-check`, and
   agent prompts — never as a machine-checkable, reusable registry.
3. **A deterministic step-checker.** Nothing evaluates the envelope against those standards as *code*
   (not an LLM). Most of what Daniel wants ("did every required step happen, in order, with
   verification") is machine-decidable and should never touch a model.
4. **A calibration harness + golden run-envelope fixtures.** No frozen set of known-verdict traces
   against which an evaluator (especially any LLM-judge component) must reproduce the correct answer
   before its verdicts count. Without this, "deterministic" is a claim, not a proven property.
5. **A per-step verdict emitted into the trust loop.** The grade row is one scalar; there is no
   per-step verdict envelope, and nothing lets a step-check *hard-fail* a run (the way `reconcile.py`
   freezes on a fabricated grade). Self-feedback has nothing granular to target.
6. **An independent envelope judge.** The Inspector is independent but grades the *output*; #3's
   self-verify grades the *self* (not independent). Nothing independently grades the *envelope*.

---

## 5. Concrete design — the run-envelope evaluator

### 5a. What a "run envelope" is (the schema)

`kb.run-envelope/v1` — a canonical, machine-readable projection of one run's trace:

```
run-envelope:
  run_id, card_id, worker, project, task_type, tier
  steps: [
    { idx, role,                       # user | assistant | tool | subagent
      step_class,                      # research | tool-use | verification | gate | commit | plan | synthesis | other
      tool_name?, tool_ok?,            # whether the call returned a result / succeeded
      subagent_id?, subagent_model?,   # for spawns (grep-verifiable per BOSS.md model-at-grading rule)
      claims_done?,                    # did this step assert completion
      touched_paths?, gate_token?,     # for commit / gate steps
      ts }
  ]
  terminal_state                       # done | escalated | halted | error
```

**Extraction reuses what exists.** `render.ts` already parses the transcript JSONL through
`tailFrom` / `joinToolResults` / `buildSubagentTree` into turn order + roles + tool names + result-arrival
+ subagent tree. The extractor is a *second consumer* of those same modules that emits structured JSON
instead of distilled HTML. **Confirmed from repo, not assumed:** the envelope is machine-extractable from
the real transcript today. **ASSUMPTION — verify:** that `step_class` can be reliably inferred from tool
name + prose + skill invoked; a first cut is deterministic (tool `Bash`+test command → `verification`;
`git commit` → `commit`; approval-token presence → `gate`), with an LLM classifier only for the residual.

### 5b. How standards attach to step-classes

A new **`governance/run-standards.yaml`** (human-edited-only, like `graders.yaml`), keyed by
`(task_type-or-run-class, step_class)`, each entry carrying:

- **Deterministic checks** (machine-decidable predicates over the envelope): e.g.
  `verification.must_precede_done_claim: true`, `tool-use.failed_call_must_retry_or_escalate: true`,
  `gate.t3_action_requires_in_envelope_token: true`, `commit.paths_subset_of_declared: true`,
  `envelope.no_step_class_skipped: [plan, verification]`.
- **A rubric pointer** for step-classes needing semantic judgment (research quality, synthesis
  soundness) — reusing the rubric-in-the-skill idea (#3) so the standard *travels with the work*.
- **Boundaries** stated alongside the done-criterion (the loop-design-check anti-Goodhart rule): what the
  step must NOT do, so the standard can't be gamed by satisfying the letter.

Standards cite #5's metric definitions for shared terms (`verified`, `cost`). The registry is versioned
(`rubric_version`-style) so old verdicts stay attributable to the standard that produced them.

### 5c. How grading stays deterministic + calibrated

Two grader kinds, **deterministic-first**:

- **Deterministic step-checker (code).** Runs the machine-decidable predicates. Same envelope + same
  standards → identical verdict, always. This covers the *majority* of "grade all steps against
  standards" and is the reproducibility backbone. No model, no cost, no Goodhart surface.
- **Calibrated LLM step-judge (only where semantic).** For step-classes that genuinely need judgment
  (research depth, synthesis quality), a fresh-context judge carries the step's rubric and emits a
  verdict — but its verdicts **only count once calibrated**: a **calibration harness** runs it over a
  **frozen golden run-envelope fixture set** (reusing #14's frozen-fixture discipline) with known-correct
  verdicts, measures agreement, and gates on an agreement floor. A judge below the floor is *untrusted*
  (fail-closed, exactly like `graders.yaml` returning the empty set). This is how "deterministic" is
  approximated for the irreducibly-semantic slice: reconciliation against a golden baseline, not trust in
  one pass — the loop-design-check "reconcile over assert" antibody applied to grading itself.

**Golden fixtures are the reconciliation baseline.** They are the external fact the whole evaluator
anchors to; without them, calibration is unfounded. They must be human-curated and human-edited-only.

### 5d. How self-feedback consumes grades without gaming them

The self-feedback loop (the #3/#16 consumer) reads the **per-step verdict envelope** and iterates —
targeting the specific weak step ("verification step thin — add a reproducible check") rather than a
blind scalar. Anti-gaming rails, all load-bearing:

- **Judge independence.** The envelope judge is a separate identity/session from the worker (the
  Inspector pattern), never the worker self-grading. #3's self-verify is allowed as a *pre-flight* but is
  never the *trusted* grade.
- **The standard is human-owned.** `governance/run-standards.yaml` and the golden fixtures live under
  `governance/` — human-edited-only per CLAUDE.md, exactly like `graders.yaml`. **The loop that improves
  the work can never edit the standard it is judged by, or the fixtures it is calibrated against.** This
  is the counter-intuitive loop-design-check red line: a self-improving loop needs *stricter* human
  control at the standard, not looser.
- **Envelope grading is itself the anti-Goodhart antibody.** Output-only grading is gameable ("make the
  artifact look right"); gaming the *whole envelope* — every required step present, in order, with
  verification that reconciles — is far harder, because the boundaries are checked alongside the
  done-criteria.
- **Score-gated, reversible accept/reject (#16).** Iterations are kept only if the envelope grade
  strictly improves and no step hard-fails; reversible numbered timeline; retry cap → wake-me card.
- **The "done" cell stays a human token.** The loop is the worker, never the acceptance officer; T3
  actions still require the human approval token. A step-check hard-fail can *block* promotion (freeze,
  like `reconcile.py`) but never *grant* it.

### 5e. Components, interfaces, effort/risk

| # | Component | Interface | Effort | Risk |
|---|---|---|---|---|
| C1 | **Envelope extractor** — trace JSONL → `kb.run-envelope/v1` | reuses `tailFrom`/`joinToolResults`/`buildSubagentTree`; emits JSON | **S** | Low — parsing exists |
| C2 | **Standards registry** `governance/run-standards.yaml` | keyed `(run-class, step_class)`; cites #5 defs | **S-M** | Med — *authoring + calibrating the standards* is the real work, not the file |
| C3 | **Deterministic step-checker** (code) | `(envelope, standards) → per-step verdicts`, pure/reproducible | **M** | Low-Med — mostly predicate coverage |
| C4 | **Calibrated LLM step-judge** (fresh-context) | rubric-carried; verdict per semantic step | **L** | **High** — Goodhart + cost + calibration drift; deploy last, deterministic-first |
| C5 | **Calibration harness + golden fixtures** | judge over frozen set → agreement score → trust/untrust (fail-closed) | **M-L** | Med — depends on fixture curation |
| C6 | **Envelope verdict emitter** | extends `kb.review-outcome/v1` (criteria=step-classes) → grade-row + per-step envelope | **M** | Med — must not break `promotion.py`/`reconcile.py` invariants |
| C7 | **Self-feedback consumer** (#16-gated) | reads verdict envelope; score-gated accept/reject; human-owned standard | **L** | **High** — governance-gated before any unsupervised use |

**Reuse wins:** C1 rides existing trace parsers; C6 extends the existing `kb.review-outcome/v1` schema
(it already models criteria pass/fail/unverified + blocking findings + a pass/fail/parked decision — a
near-perfect fit for step-class verdicts); the trust-anchor + fail-closed + freeze patterns come straight
from `graders.yaml`/`promotion.py`/`reconcile.py`. **Sequence:** C1→C2→C3 (deterministic slice, shippable
and useful alone) → C5→C4 (semantic slice, only once calibrated) → C6→C7 (trust-loop + self-feedback).

**Capability honesty.** Envelope extraction from the transcript is **verified** (repo does it today).
Reliable `step_class` inference and stable LLM-judge calibration are **ASSUMPTIONS — verify** with a
~2k-token probe on a handful of real `subagents/agent-*.jsonl` traces before building C4/C5. The
loop-design-check red line holds throughout: **do not build an LLM-judge where a deterministic check
suffices**, and never let the evaluator that a loop optimizes against be authored by that loop.

---

## 6. Open design questions for Daniel

1. **Which run-class gets step standards first?** Candidates: fyt video runs (rich, many steps, existing
   gates), codex-dispatch cards, or boss dispatch waves. Pick one to author + calibrate against; the
   registry generalizes after.
2. **Calibration source of truth.** Who authors the golden run-envelope fixtures and their known-correct
   verdicts — Daniel-graded exemplars, or promoted past-passing runs? (Past-passing runs risk baking in
   today's *output-only* blind spots; Daniel-graded exemplars are stronger but costlier.)
3. **Augment or replace the current scalar?** Should the envelope verdict *feed into* the existing
   single card score (recommended: augment first — a step hard-fail caps the score, like the current
   axis hard-fail), or become a separate promotion signal? Changing `promotion.py`'s input contract is
   the higher-risk path.
4. **Deterministic-only v1?** Ship C1-C3 (no LLM judge) and prove value on machine-decidable step checks
   before spending on C4/C5? (Recommended.)
5. **Blocking semantics.** Does a failed *deterministic* step-check freeze/block promotion (the
   `reconcile.py` posture) or only annotate the trace? (Freezing is safer but louder.)
6. **Coverage vs cost.** Grade every run's envelope, or sample? Envelope extraction is cheap
   (deterministic); the LLM-judge slice is not — sampling likely applies only to C4.
7. **Standards ownership boundary.** Confirm `governance/run-standards.yaml` + golden fixtures are
   human-edited-only (like `graders.yaml`) — this is the load-bearing anti-Goodhart guarantee for the
   self-feedback loop.

---

_Read-only analysis. No code, no commits, no branch switches. One doc written: this file._

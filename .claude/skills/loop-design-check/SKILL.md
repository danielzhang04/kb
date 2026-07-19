---
name: loop-design-check
description: Design a goal-oriented agent loop, and review it for the ways loops go wrong — spinning and burning tokens, Goodhart-gaming the verifier, or running a wrong answer to completion. Two actions: (1) WRITE a loop — gate whether to build it, define a machine-decidable goal, pick the loop type, pick a skeleton; (2) REVIEW a loop — run it past five failure modes plus decidability, boundaries, fallback, judge independence, and keep-judgment-with-the-human red lines. Use when designing a kb recurring loop / HEARTBEAT cadence, or when you already have one and worry it will spin, cheat, or run a wrong answer to the end. Complements kb's mechanism layer (HEARTBEAT.md cadences dispatched by the single dispatcher Routine) by covering the judgment layer it doesn't. 中文触发：写 loop、设计 loop、做一个 loop、检查 loop 对不对、loop 体检、loop 会不会跑飞、可判定目标、五个崩法、plan build judge。English triggers: design an agent loop, write a loop, check a loop, loop review, prevent a runaway loop, goal-oriented loop, decidable goal, plan/build/judge.
source: ecc@2.0.0/skills/loop-design-check/SKILL.md
imported: 2026-07-19
provenance-tier: curated
promoted: 2026-07-19 (Daniel §6 read-through)
---

# Loop Design + Review

> **Premise.** An LLM is a feed-forward system: prompt in → tokens out, with no built-in "steer toward the goal" across turns. To make it *behave* like a goal-oriented system, you wrap a feedback loop around it. This skill helps you **write** that loop correctly and **review** it so it won't run away. In kb, that loop is a recurring cadence declared in a project's `HEARTBEAT.md` (§8.1 learning loops) and dispatched by the single dispatcher Routine.

## When to use / not

**Use it when:**
- You want to hand a repeating task to an agent that runs over and over (a kb cadence: ingest, nightly review, weekly review, a watch).
- You already have a loop and worry it spins, cheats, or runs a wrong answer to completion.

**Don't use it for:**
- A one-off task → file a single card and do it; don't wrap a loop around it.
- A plain timer / poll → declare a bare cadence in `HEARTBEAT.md`; no design needed.
- *How to wire the loop mechanism* (cadence declarations, the dispatcher-as-clock, atomic claims, long-run recovery) → that's the mechanism layer; see the orchestration + §8.1 spec. **This skill only covers "is the goal right, and will it run away" — it does not re-explain mechanism.**

## Red-line premise: two levels of feedback

| Level | Who owns it | What it does |
|---|---|---|
| **Execution** (low) | machine / agent | Measures "how far from the literal goal" and grinds it to zero. The machine is strong here. |
| **Judgment** (high) | **human** | Decides "is this goal itself right, should it change, should it stop." The machine can't step outside its own loop to question the goal. |

> A thermostat can feed back "how far from 26°C," but when you have a fever and want 28°C it can't judge whether 26 is the *right* target — it just grinds toward 26. **"What to set today" is always the human's call.**
> Handing judgment / sign-off / the last switch to the machine = removing the high-level feedback = it sprints, fast and hard, toward a goal no one questioned → wrong output. In kb the last switch is the **human approval token** (§7): the "done" cell the loop never flips itself.

---

## Action 1 — Write a loop (5 steps)

### Step 0 · Subtract first: should you even build it? (4-condition gate, any miss = veto)

① the task recurs weekly or more (a real HEARTBEAT cadence)　② verification can be automated　③ the token budget can take it (`governance/budget.yaml`)　④ the agent has tools that actually *run and see the result*

Miss any one → **don't build a loop**; do it by hand under a single card, or another way.
> What stops most people isn't "can I write a loop," it's "does my repo deserve one." A repo that deserves a loop has a reconciliation baseline (golden sample / upstream total, checked by `scripts/reconcile.py`) + tests + a lint guard. **A repo that doesn't deserve a loop will only have its errors amplified by one.**

### Step 1 · Define a *machine-decidable* goal (the hard part — the loop lives or dies here)

The whole loop rides on the comparator's "is it done yet?" **The comparator can only work if your exit condition can be judged yes/no by a machine**, and the verdict lands in the card's `## Result` and a row in `ledgers/grades/`.

- Bad: Vague ("make it good," "write it sharper") → the comparator can't judge → either it never passes (stuck retrying) or it guesses (passes/blocks at random).
- Good: Decidable ("all 96 unit tests green AND a change-list is produced," "module fields filled, pytest passes, business logic untouched") → one check settles it; the loop converges cleanly.

**Five-point goal framework:**
1. **Done-criterion is machine-verifiable** — and recorded in the card `## Result`.
2. **Boundary conditions defined alongside the done-criterion** ("what it must NOT do") — anti-Goodhart; missing boundaries = a license to cheat.
3. **Has a failure fallback** — retry cap N, then escalate: file a wake-me card (the `wakes-me-up` contract fires when verification fails twice on the same item).
4. **Goal is layered.**
5. **Prefer reconciliation over assertion for the done-criterion** — anchor to external fact (golden sample / upstream total / financial tie-out / a `reconcile.py` pass) before your own assertions. "All tests pass" can be gamed (loosen asserts, fake mocks, swallow exceptions); "diff vs the reference < 0.01" can't.

> **Self-check:** read the goal to someone who doesn't know the domain — can they run one command and tell whether it's done? If not, it isn't decidable enough. Go back.

### Step 2 · Pick the loop type

| Your task | Loop type (cybernetic) | How it stops |
|---|---|---|
| Has a clear "done" test (a card whose `## Result` criterion is decidable / a batch processed) | **servo** (closed-loop toward a goal) | stops on reaching the goal |
| No endpoint, must keep maintaining a state (inventory alert / scheduled health check) | **regulator** (thermostat cadence: nightly review, canary watch) | never stops; acts only on change (dead-band suppresses noise) |
| Periodic sampling, stop on a condition (watch a card / PR until it grades or CI is green) | **regulator with an exit** | stops when the exit condition holds |
| Must "ensure something happens on time" | declare it as a `HEARTBEAT.md` cadence | the dispatcher Routine (the clock) fires it |

> Rule of thumb: clear "done" test → servo; must keep maintaining, no endpoint → regulator; must "happen on time" → declare a cadence and let the dispatcher fire it.

### Step 3 · Pick a skeleton

**Maintenance type (tend something that exists) → document-driven dispatch.**
The loop isn't "run a fixed check on a timer," it's **"read a doc on a timer, and dispatch only when the doc changed."** In kb that doc is `HEARTBEAT.md` (and the `queue/` cards it spawns): the task queue + state machine + human interface. The repo is the source of truth; the Routine is just the clock.
Three disciplines: ① the problem side is human-write-only (the card body / `## Evidence`, treated as inert data), the result side is loop-write-only (`## Result`), **state advances one-way and never rolls back**; ② **the exit code is final** (if the script says exit 1, the script wins); ③ state advances only as far as "awaiting verification" — **the "done" cell is flipped by a human only**, via the approval token (§7). The loop is the worker, not the acceptance officer.

**Greenfield type (build from scratch) → plan / build / judge, three roles** — kb's Scout → Manager → Worker → Inspector assembly line (§6).

| Role | Does | Key |
|---|---|---|
| **Plan** (Manager) | break the goal into a spec + **decidable acceptance conditions** | acceptance must be script-judgeable |
| **Build** (Worker) | write to the spec on an agent branch | **must not change the acceptance conditions** |
| **Judge** (Inspector) | run acceptance **independently** in fresh context; pass → stop, fail → return with the failure reason to Build | **independent + deterministic** |

Three iron rules (all bet on the judge): ① **the judge must be independent** — the Inspector runs fresh-context under a dedicated grader identity and writes the grade to `ledgers/grades/`; Workers physically cannot write grades (grading your own homework always inflates); ② **deterministic rules** — pytest / reconciliation diff / type check, never "looks right"; ③ **Build may not edit the acceptance conditions to pass**. Retry cap exceeded (verification fails twice) → escalate to a human via a wake-me card.

### Step 4 · Add damping (against oscillation / runaway)

Retry cap, hard stop, the human flips the last switch (§7), and the repo-root **`STOP` file** (halts every cooperating loop at its next preamble check) = damping. **Negative feedback with no damping oscillates** (the Ralph-Wiggum loop: spinning in place, burning tokens).

### Step 5 · Land in three stages (don't go fully automatic on day one)

① **Run it once by hand** (forces you to state exactly "how the judge decides") → ② harden into a skill / Claude Code sub-agents (a main loop dispatching plan/build/judge) → ③ declare it as a `HEARTBEAT.md` cadence for full automation.

---

## Action 2 — Review a loop (checklist = five failure modes)

> Run the loop past each row. **Hitting any one = this loop will misfire; send it back.** These five are negative experience (gotchas) — worth more than positive rules.

| # | Failure mode (how it breaks) | Review question (a hit = red) | Antibody |
|---|---|---|---|
| 1 | Goal is a correct platitude → **spins, burns money** | Can the exit condition be machine-judged yes/no? Or is it "manage it well / make it good"? | Replace with a decidable result condition (Action 1·Step 1) |
| 2 | "Verification" written as "check if it looks ok" → **agent confidently says fine and stops** | Is the judge the defendant itself? Does verification rest on "looks right" or deterministic rules? | Reconcile + exit-code rules + independent Inspector |
| 3 | (worst) Only gates on "all tests pass" → **agent deletes the tests** | Is there a boundary ("what it must NOT do")? Or only a done-criterion? | Done-criterion **+ boundary** together (the Goodhart antibody) |
| 4 | Counts on the agent asking mid-run → **it won't; it runs the wrong answer to the end** | Is there any "clarify only at runtime" point? | **Front-load every clarification** into the card before dispatch |
| 5 | Bloated `CLAUDE.md` + stale `memory/<agent-id>.md` → **the faster it loops, the more it errs** | Are the docs/memory it depends on fresh? Who maintains them? | Layered memory + periodic lint (nightly/weekly review) |

**Plus three red lines (violate any = not allowed to go automatic):**
- **Keep judgment with the human.** Acceptance / the "done" cell is flipped by a human approval token (§7); the loop is not the acceptance officer.
- **Responsibility doesn't transfer.** Anything whose failure you can't afford (merge the wrong PR to `main` / publish the wrong thing / misallocate money) is T3/T4 — **it never executes without a human approval token; don't hand over the authority automatically.**
- **Counter-intuitive warning.** The more "self-improving / rewrites-its-own-rules" a loop is, the **stricter the human review it needs** — not looser. A loop that emits new skills lands them in `skills/imported/` (or `learned/`, `evolved/`); promotion to `curated/` is the §6 injection gate: `scripts/scan_skill.py` heuristic pass **plus** a human read-through against `governance/security-rules.md`. **Nothing self-promotes past that gate.** The machine is too fast to intercept after the fact, so the human's judgment must sit **before the action** (a hard gate), not as a post-hoc patch.

---

## Worked example — reviewing a "nightly green-keeper" cadence

You want a nightly-review cadence that runs every night and fixes whatever tests are failing.

- **Naive goal:** "make all tests pass." → Step-1 self-check fails: this is the bait for failure mode #3.
- **Decidable goal (fixed):** "all tests green **AND** no test file deleted or weakened **AND** coverage not lowered **AND** a change-list written to the card `## Result`." Boundary now defined alongside the done-criterion.
- **Type:** servo with a retry cap of 3 (Step 2 + Step 4).
- **Skeleton:** plan/build/judge — the **judge is the Inspector run fresh-context (or a reconcile pass)**, never the fixing Worker (Step 3).

Now run the **review checklist**, and it catches what the naive version would have missed:
- **#3 hit** → the naive "all tests pass" lets the agent delete a failing test to "win." Fixed by the boundary "no test file deleted/weakened."
- **#2 hit** → if the fixing Worker also judged its own fix, it would pass itself. Fixed by "judge = independent Inspector, deterministic."
- **#4 hit** → if a fix is ambiguous, the agent won't stop to ask at 2 a.m.; it'll commit a guess. Fixed by front-loading: ambiguous fixes are left for the human, not guessed.
- **Red line** → the loop opens a PR / card but **does not auto-merge to `main`**; the human flips the last switch via the approval token (responsibility doesn't transfer).

The naive loop and the reviewed loop differ by four lines of constraint — and that's the difference between "wakes you to a deleted test suite" and "wakes you to a clean PR."

---

## One-line close

> The hard part of writing a loop isn't "can I write a loop," it's **defining a goal a machine can reconcile** — decidable, bounded, reconciliation-based. The controller must be deterministic and external; keep judgment and the standard with the human; the system tends toward entropy, so maintain it.
> **A loop only rewards someone who has already thought it through. Count on it to think for you, and it will happily think wrong, with you, at scale.**

---

> Lineage: Wiener's two-level feedback (*The Human Use of Human Beings*, 1950) for the judgment/execution split and red lines; the plan/build/judge pattern from Anatoli's *Loops explained* and Addy's *Loop Engineering*.
> Mechanism layer (how to wire the cadence): `HEARTBEAT.md` declarations + the dispatcher Routine as the clock (§6 orchestration, §8.1 learning loops). This skill does not re-implement mechanism; it covers goal definition and runaway prevention only.

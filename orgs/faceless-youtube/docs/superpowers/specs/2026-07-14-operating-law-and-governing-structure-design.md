# Operating Law + Governing-Structure Cleanup (Design)

**Status:** DESIGN (brainstormed with Daniel 2026-07-14). Not yet planned/built.
**Next:** `writing-plans` → a phased implementation plan.
**Branch:** `feat/operating-law` (off `master`).

---

## 1. Goal

**Every terminal working in `faceless-youtube` should work efficiently by knowing every learning we
have accumulated so far — without being told, in every session, automatically.**

Today that knowledge exists, but it is scattered across four docs with overlapping jurisdiction, and
it is drowned in a fifth (a 264-line status changelog loaded into every session). A terminal boots
with ~1,000 lines of ambient context in which the actual operating law is 21 lines.

The `channel-forge` Enforcement Contract already contains the best-structured statement of that law.
It is currently owned by one skill, so it governs nothing outside that skill's runs.

**This project promotes the contract to repo law, makes it ambient in every terminal, and cleans up
the governing structure so the law is legible rather than diluted.**

**Non-goal:** `channel-forge` itself. It is deliberately parked. This design takes the contract *from*
it and leaves the wizard alone.

---

## 2. Problem — the diagnosis

### 2a. Process law is smeared across three docs

| Doc | Lines | Contains |
|---|---|---|
| `CLAUDE.md` §"How to work here" | 21 | rules 1–6 |
| `.claude/skills/channel-forge/references/enforcement-contract.md` | 110 | clauses A–H |
| `~/.claude/projects/…/memory/` (27 files) | ~600 | ~12 process-law entries |

They overlap heavily and drift independently. Clause F duplicates CLAUDE.md rules 1/3/5/6 nearly
verbatim. Clause H duplicates four memory files verbatim. Nothing declares which wins.

This is precisely what CLAUDE.md rule 6 and clause F both ban ("keep docs non-overlapping").

### 2b. The contract is self-contradictory about its own scope

- Its **title and location** say `channel-forge` owns it.
- Its **text** says it is "the invariant operating law for channel-forge and *every skill / sub-flow it
  runs*", governs build sub-flows recursively, and clause B insists "we build our builders with the same
  discipline."

Both cannot hold. Read clause by clause, **A–H is already universal** — orient before acting, right
tool, right-size, validate before effort, don't yes-man, files/git, learn from runs, human authority.
Nothing in A–H is channel-forge-specific. Only the *usage-grammar preamble* and the walk mechanics
(prune-on-lock, capability map, stage gates) are.

### 2c. CLAUDE.md is 67% changelog

| Section | Lines | Share |
|---|---|---|
| Current status | **264** | 67% |
| Operating rules | 21 | 5% |
| Router, pipeline, autonomy, guardrails, defaults, file map, conventions | ~110 | 28% |

The file self-describes in line 3 as "the router", then spends two-thirds of itself as a dated status
log — the exact append-drift its own rule 6 forbids. Because it is auto-loaded, the repo pays context
rent on a changelog in every session, in every terminal, forever. Because it is the most-edited file
in the repo, it is also the one that drifts across worktrees — and it already has (the two live
worktrees' copies differ at lines 242 and 258, both inside the status block).

The status block also duplicates a job two other layers already do: `decisions.md` (2,237 lines,
append-only provenance) and `docs/handoffs/` (resume state).

### 2d. Memory is ~90% misfiled law

27 files: 24 `feedback`, 1 `project`, 2 `reference`, and **zero `user`**. There is nothing in memory
about who Daniel is. It is an unversioned, machine-local, subagent-unreachable store holding law that
should bind every terminal.

### 2e. The rules contradict each other

Rule 3 says *append* a dated line to `decisions.md`. Rule 6 says *never* stack dated log-blocks. Both
are correct — a **log** appends, a **doc** integrates in place — but the distinction is never stated,
so the law is ambiguous on its face.

### 2f. The failure modes, ranked

1. **Learning isn't in context** → fixed by ambient loading. Cheap.
2. **Learning is in context but drowned** → fixed by cutting noise. ← *biggest lever today*
3. **Learning is salient and the model still misses it** (blind spot) → needs mechanism.

Adding 110 lines of law to 1,000 lines of noise makes everything less salient, including the law.
**The cleanup is therefore not housekeeping that follows the law — the cleanup is what makes the law
bind.** They are one project.

---

## 3. Design — one axis per doc

Every governing doc gets exactly one job.

| Axis | Home | Change |
|---|---|---|
| **How to work** (process law) | **`knowledge/operating-law.md`** (new) | Absorbs contract A–H + CLAUDE.md rules 1–6 + process-law memories. Single source. `@import`ed by CLAUDE.md. |
| **What we're allowed to do** (business/policy law) | `knowledge/playbook.md` | Unchanged content. Retitle only — "operating rules" collides with the law. |
| **Where things are** (router) | `CLAUDE.md` | Shrinks to a real router. Status block leaves. |
| **What we decided & why** (provenance) | `knowledge/decisions.md` | Unchanged. Append-only is correct for a log. |
| **Where we left off** (resume state) | `docs/handoffs/` | Receives the 264-line status block. |
| **Craft law** (image-gen, audio, visual, writing) | the skill / channel docs that own it | Receives the 9 craft memories. |
| **Who Daniel is / medium prefs** | `~/.claude/…/memory/` | Shrinks to ~4–6 entries. |

**The append-vs-integrate rule, stated once in the law:** `decisions.md` and `handoffs/` are **logs** —
they append. Everything else is a **doc** — it integrates in place. This dissolves the rule 3 / rule 6
contradiction.

---

## 4. The law file

### 4a. Location and name

`knowledge/operating-law.md`. Rationale: `knowledge/` is already declared in the file map as "general,
cross-niche knowledge", and `playbook.md` (its business-law sibling) already lives there. The law is
repo-level, versioned, and reviewable — none of which memory is.

### 4b. Structure

Clauses A–H, carried over substantially as written (the language is good; it was authored to be
enforceable). Changes:

- **Drop the channel-forge usage-grammar preamble.** Replace with a short preamble stating: this is
  repo law, binding on every terminal and every subagent, loaded automatically; it changes only via
  clause G with human confirmation; it is versioned.
- **Absorb** CLAUDE.md rules 1–6 into the clauses they already overlap (mostly F). Rules 2 and 4
  (self-maintain; keep the dashboard current) have no clause home yet and need one.
- **Absorb** the process-law memories (§5, pile 1) into their matching clauses.
- **Add** the log-vs-doc distinction (§3).
- **Keep** the deferred compliance section as-is.

### 4c. Ruthless brevity is a requirement, not a preference

The law competes for attention with everything else in context. A 300-line law is a diluted law. Every
absorbed learning must be integrated into an existing clause, not appended as a new one. If the law
grows past roughly its current 110 lines, that is a signal we are folding in craft law that belongs
elsewhere.

---

## 5. Memory sort — three piles

**Pile 1 — process law → the law file** (12)
`push-back-dont-yes-man` · `skills-do-the-work` · `fix-generation-not-prohibitions` ·
`keep-docs-structured` · `parallel-terminals-stage-explicit-paths` · `stay-on-the-agreed-task` ·
`present-options-not-one-answer` · `surface-progress-mind-agent-latency` ·
`parallelize-and-preserve-depth` · `feedback-is-a-learning-system` ·
`derived-fields-not-generation-targets` · `agents-write-early-survive-limits`

**Pile 2 — craft law → the skill / channel doc that owns it** (9)
`camera-locked-by-default` · `exact-style-image-gen` · `audio-taste-is-human-judged` ·
`rig-gate-approved-not-idealized` · `dont-self-certify-finger-counts` ·
`verify-image-changes-with-a-diff` · `prefer-layered-shared-base` · `be-critically-honest-on-visuals` ·
`log-generation-reasoning`

**Pile 3 — genuinely personal / medium / reference → stays memory** (6)
`review-images-via-artifact-link` · `review-video-in-device-player` · `open-review-files-in-vscode` ·
`artifact-image-galleries` · `voice-auditions-artifact` · `yt-dlp-channel-top-videos`

Before any file is deleted from memory, its content must be verifiably present in its destination.
**Migration is copy-verify-then-delete, never move-and-hope.**

### OPEN CALL for review (§9.1)

Daniel said memory should "fold into enforcement contract." This design folds **pile 1** into the law
and routes **pile 2** to the skill docs instead, on the grounds that "never ask for an oil painting of
a character" is *image-gen's* law, not the repo's — and folding 9 craft entries into a universal
contract would bloat it to ~300 lines and re-create the dilution problem this project exists to fix.
**If Daniel wants pile 2 in the law too, that changes §4c and needs saying now.**

---

## 6. Mechanism

Enforcement is tiered, because most of the law cannot be mechanically checked. This is stated plainly
rather than papered over: `git add -A` is detectable; "think critically" is not.

| Tier | Mechanism | Covers |
|---|---|---|
| **Ambient** | `@knowledge/operating-law.md` in CLAUDE.md — loaded into context at launch, every session, every worktree | all clauses (soft) |
| **Anti-decay** | SessionStart hook, `compact` matcher → re-inject the law | compaction on long sessions |
| **Hard** | PreToolUse hooks, exit 2 = block | the mechanically-detectable few |
| **Reach** | inject relevant clauses into every subagent brief | subagents (inheritance undocumented) |
| **Deferred** | fresh-eyes critic layer | judgment clauses, *if* violations persist |

### 6a. Confirmed harness facts

- `@path/to/file` imports in CLAUDE.md load into context **at launch**, resolve relative to the
  containing file, recurse to a **max depth of 4**, and are skipped inside code fences.
- `.claude/settings.json` is committed, so its hooks apply to **every worktree of the repo**.
- SessionStart hooks inject **stdout (exit 0)** into context, and support matchers
  `startup` / `resume` / `clear` / `compact`.
- PreToolUse: **exit 2 blocks** and surfaces stderr to the model; structured JSON
  (`permissionDecision: deny|allow|ask`) is also available.
- **Unconfirmed:** whether subagents inherit CLAUDE.md or project hooks. Documentation does not say.
  → Therefore the law is *injected into briefs explicitly* and inheritance is never relied upon.

### 6b. Why not a timer

"Re-read the law every X minutes" was considered and rejected: context does not decay on a clock. Once
imported, the law is in context for the whole session; periodic re-reads burn tokens and change
nothing. The only real decay mode is **compaction**, which the SessionStart `compact` matcher targets
exactly.

### 6c. Why not a skill

A skill is opt-in. A law you can forget to invoke is not a law — and the run where you forget is the
run that goes sideways. Ambient loading is the only shape that matches the goal.

### 6d. Hooks: start from evidence, not theory

The only hook that exists (`git add -A`) was built *because the failure actually happened* during the
visual overhaul. New hooks should earn their existence the same way. v1 moves the existing hook out of
`skills/channel-forge/scripts/` to a repo-level home; it does not speculatively add more.

**This is the project's own dogfooding of clause D** — don't lock on theory.

---

## 7. The honest ceiling

`fix-generation-not-prohibitions` — learned expensively during the scriptwriter rebuild — says:
*prohibitions self-checked by the same model share its blind spot.* The fix was a gold exemplar plus a
fresh-eyes critic, not more rules.

**The Enforcement Contract is 110 lines of prose rules, self-checked by the model it governs. It has
the same defect.** This design does not pretend otherwise.

What it claims: ambient law + a sharply reduced noise floor raises compliance materially, and is the
cheapest available intervention. What it does not claim: that prose binds. The clauses that prove
un-self-enforceable will need mechanism (§6, deferred critic), and we will know which ones only by
running with the law and watching what still gets violated.

**Therefore this project does not end at "the law is written." It ends at §8.**

---

## 8. Success test

**A fresh terminal, given a real task, visibly follows a clause it would previously have missed —
without being told to.**

Concretely, before/after on one real piece of work:

- ambient context drops from ~1,000 lines to a target of **≤400**, of which the law is ~110
- one source of process law; `grep` finds each rule in exactly one place
- the law is present in a fresh session with **zero invocation**
- a subagent brief demonstrably carries its governing clauses
- **no learning lost** — every migrated entry verifiably present at its destination

The last is the one that can actually go wrong, and it is the one to guard hardest. Clause E:
*enrich, don't replace.*

---

## 9. Open calls

1. **Pile 2 placement** — craft law to skill docs (this design) vs. into the law (Daniel's phrasing).
   See §5.
2. **Law file name** — `knowledge/operating-law.md` proposed; `playbook.md` needs a retitle either way
   to clear the "operating rules" collision.
3. **Status-block destination** — one rolling `docs/handoffs/STATUS.md`, vs. folding into the existing
   dated-handoff convention. The latter is more consistent; the former is easier for a fresh terminal
   to find.

---

## 10. Sequencing — ordered by conflict risk, not importance

Another terminal is **actively editing CLAUDE.md right now** (proven by the live worktree diff), and
the last channel-forge handoff already deferred a CLAUDE.md edit for exactly this reason. So the
highest-value change is also the highest-conflict one, and it goes last.

| # | Step | Conflict risk |
|---|---|---|
| 1 | Write `knowledge/operating-law.md` — absorb contract + rules + pile 1 | **none** (new file) |
| 2 | Memory sort: pile 1 verified into law, pile 2 → skill docs, prune | **none** (machine-local) |
| 3 | Hooks: move `git add -A` trap out of channel-forge; add SessionStart `compact` re-inject | low |
| 4 | `@import` wired into CLAUDE.md | low (one line) |
| 5 | **CLAUDE.md shrink**: status → handoffs, rules → law, router stays | **high — coordinate** |
| 6 | Prove on one real piece of work (§8) | none |
| 7 | `channel-forge` contract → a pointer to the law; keep only walk mechanics | low |

Steps 1–4 are independently valuable and land the goal ("law in every terminal"). Step 5 is what makes
it *bind*. Step 7 closes the loop with the parked wizard without unparking it.

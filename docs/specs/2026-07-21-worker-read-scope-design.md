# Worker read-scope declaration + enforcement — design

- **Status:** DESIGN (plan phase). No code in this doc is built. A separate build wave follows, gated on the coordination notes in §3.
- **Date:** 2026-07-21
- **Author:** claude/read-scope-design
- **Scope of change:** the governed workflow execution control plane under `dashboard/server/` — how a workflow definition declares which repo paths its worker may READ, and how that declaration is (a) surfaced for human approval and (b) made real for the spawned worker process.
- **Non-goals:** write-scope (already enforced, unchanged), manager routing, agent-assignment, the broker, activation of the currently-inert executor. OS-level process confinement is discussed honestly but is explicitly **out of scope** for this wave (see §5, §11).

---

## 1. Problem statement

Read scope is the set of repo paths a worker is told it may read. Today it is **prompt text only, with no enforcement, derived from a hardcode.**

**Derivation is hardcoded.** `dashboard/server/workflows/compile.ts:83`:

```ts
const readScope = [`orgs/${def.project}`];
```

This single value is copied into both the proposal-level `scope.read` (`:84`) and every stage's `scope.read` (`:97`, commented "Minimal-valid stage envelope"). It is a symmetry-copy of the write shape. No definition can influence it: the def frontmatter schema rejects unknown keys at both the frontmatter level (`defs.ts:211–213`) and the stage level (`defs.ts:106–108`), so a def cannot request a wider or different read scope even when its own work order needs one. No design doc anywhere discusses read scope.

**It reaches the worker as prose only.** `execution.ts:991` passes `proposalStage.scope.read` to the adapter, which renders it at `claudeWorkerAdapter.ts:242` as:

```
READ SCOPE — you may read only these paths:
- orgs/<project>
```

Nothing else acts on it. The worker is spawned (`claudeWorkerAdapter.ts:449–459`) with:
- `cwd = input.worktreePath` — a **full** repo worktree (`adapters.ts:240`, `git worktree add --detach path baseCommit` materializes the entire tree);
- `--allowedTools` from the workflow **profile** (e.g. `producer` = `Bash, Read, Write, Edit, Glob, Grep`, `environment.ts:84–86`), with **zero path restriction**.

So the worker can physically read every file in the repo. The read-scope line is an honor-system request.

**The asymmetry with write scope.** Write scope is enforced three independent ways and read scope is enforced none:

| | Write scope | Read scope |
|---|---|---|
| Compile-time widening refusal | `compiler.ts:60–61` (`stage.scope.write ⊆ proposal.scope.write`) | none |
| Policy gate at execution | `policy.ts:153` (`within(target, scope.write)`) | none |
| Result acceptance bound | `execution.ts:292,296` + `adapters.ts` inspect — only changed paths **inside `stage.scope.write`** are accepted | none |

**The live consequence.** Run `run-7b0b8de8` (the Wave-A self-lint live-fire). `orgs/kb-ops/workflows/self-lint-report.md` names four scan categories (`:31–35`): stale `queue/` cards, `dashboards/` + `ledgers/` freshness, broken links in top-level `_index.md` and `orgs/kb-ops/_index.md`, and tracked sign-in material anywhere. But the compiled read-scope prompt bound was only `orgs/kb-ops`. The **honest** worker obeyed the narrower prompt bound and skipped three of the four categories — the scan roots it needed (`queue/`, `dashboards/`, `ledgers/`, top-level `_index.md`) were outside the read scope the compiler handed it. The def's own scan list and the compiled read scope disagreed, and the worker sided with the (narrower) read scope. **This is a correctness bug first** — the honest worker did the wrong (too-narrow) thing — and an enforcement gap second.

Two layers follow. **Layer A** lets a def *declare* the read roots it needs and surfaces them for approval. **Layer C** makes the declaration mean something to the worker process.

---

## 2. Invariants this design must not weaken

These are load-bearing and must survive the build verbatim:

1. **Write-scope enforcement** — `compiler.ts:60`, `policy.ts:153`, `execution.ts:292/296`. Read-scope work touches only `scope.read`; it must not alter any `scope.write` check (see §6).
2. **Env stripping** — `claudeWorkerAdapter.ts:301–307` / `buildChildEnv` (`pty/host.ts`). `ANTHROPIC_API_KEY` and every credential-named var stay stripped from the worker env. Unchanged.
3. **Tool-cap resolution / fail-closed profiles** — `createWorkflowToolPolicyResolver` (`claudeWorkerAdapter.ts:71–107`), `FORBIDDEN_WORKFLOW_TOOLS` (`environment.ts:48–53`), `buildClaudeArgs` empty-list refusal (`:278–280`). A new `scanner` profile must pass through these unchanged (no forbidden tool, non-empty, well-formed).
4. **`acceptsBoundary` / result-envelope semantics** — `resultIsSafe` (`execution.ts:279–300`) and the canonical integrator anchor on `stage.scope.write` only. Unchanged.
5. **Org write-containment** — `defs.ts:136–139` (a def's target must be inside its own `orgs/<project>` tree). Read scope gets an analogous but distinct containment rule (§4.3).

---

## 3. Coordination constraints (READ BEFORE BUILDING)

The build touches files that two other live sessions are actively editing. **This design assumes it rebases onto whatever lands first and is written for surgical diffs.**

### 3.1 `codex/fyt-autonomous-runner` — HIGH overlap, same files

This branch is adding **agent-assignment** to the workflow pipeline and edits the exact files the read-scope build needs. Confirmed diff vs `origin/main` touches:

- `dashboard/server/workflows/compile.ts` — adds fields to `deriveProposalId`'s hash preimage (`stage.agentId/profileId`, `def.manager`), extends `CompileWorkflowEnvironment`, adds `resolveAssignment`. **The read-scope build also edits `deriveProposalId`'s preimage and `CompileWorkflowEnvironment`** → direct conflict hunks.
- `dashboard/server/workflows/defs.ts` — adds `manager` + per-stage assignment keys to the frontmatter/stage `allowed` sets and interfaces. **The read-scope build also edits those `allowed` sets and interfaces** → direct conflict hunks.
- `dashboard/server/control/proposal.ts` — adds `ResolvedAgentAssignment` and related types. Read-scope adds no new proposal types (it reuses `ProposalScope`), so overlap here is low but the file is hot.
- `dashboard/server/control/execution.ts`, `activation.ts` — assignment plumbing. Read-scope touches `execution.ts` only if per-stage provisioning is chosen (it is not — see §4.2); Layer C touches `adapters.ts` + `activation.ts` (adapter wiring), so `activation.ts` overlaps.
- `orgs/kb-ops/workflows/self-lint-report.md` — **both branches edit this file.** The read-scope migration adds a `readScope:` key here (§7); fyt-autonomous-runner also edits it. Coordinate the exact final frontmatter.

**Mitigation:** the read-scope changes are additive and orthogonal in intent (a new independent frontmatter/stage key + a compile union + an adapter provisioning option). Whichever branch merges first, the second rebases; the conflicts are mechanical (both extend the same `allowed` Set literal and the same `deriveProposalId` preimage object). The build should land **after** fyt-autonomous-runner if possible, to rebase once rather than force that branch to.

### 3.2 `claude/intent-scan-fix` — LOW overlap, note only

Reworks `restrictedIntent` in `execution.ts` (+ `execution.test.ts`). It will likely merge before this build. Read scope does not touch `restrictedIntent` and has no conceptual dependency on it; just rebase `execution.ts` if Layer C's optional per-stage path is ever taken (it is not in the recommendation).

### 3.3 Never weaken (restated for the builder)

The §2 invariants. In particular: do not let any read-scope change flow into a `scope.write` check, the worker env allowlist, the tool-cap resolver, or `resultIsSafe`.

---

## 4. Layer A — declared read scope

### 4.1 Where the field lives: def-level frontmatter `readScope`

**Recommendation: an optional top-level frontmatter key `readScope: [<repo-relative path>, ...]`, not a per-stage key.**

Justification:
- Today's hardcode applies **one** read scope to the whole def — proposal-level and every stage identically (`compile.ts:83–84,97`). A def-level `readScope` is the minimal, faithful replacement: it flows into `proposal.scope.read` and each `stage.scope.read` exactly where the hardcode does now.
- The compiler's widening refusal (`compiler.ts:60`) checks `stage.scope.read ⊆ proposal.scope.read`. When both derive from the same def-level value they are equal, so the invariant holds trivially and the build adds no risk there.
- Write scope is per-stage because each stage writes only its own `target` — a real least-privilege gradient. Reads have no equivalent per-stage gradient today (no def needs stage-varying reads), so a per-stage read key would multiply the review surface **and** the Layer-C provisioning surface (each attempt worktree would need a different sparse set) for zero current benefit.
- **Forward-compatible:** a future per-stage `readScope` that *narrows* below the def-level value can be added without breaking this design — it would still be `⊆` the proposal scope, so `compiler.ts:60` keeps holding. We are not foreclosing it; we are declining to build it speculatively.

### 4.2 Compile behaviour: default-preserving union

`compile.ts` replaces the hardcode with:

```
effectiveRead = normalizeDedupe( declaredReadScope ∪ [`orgs/${def.project}`] )
```

- **Absent `readScope` ⇒ `[orgs/<project>]`** — byte-identical to today. This is the migration guarantee (§7): every existing def keeps its exact current behaviour.
- **The own-org tree is always unioned in**, so a def can only ever *add* read roots beyond its org; it can never narrow below the tree it must write into. (The worker must read its own writable tree to do the work.) Narrowing reads is not a security need; widening is the risk this layer governs.
- The result feeds both `proposal.scope.read` and each `stage.scope.read` (unchanged plumbing shape).

`deriveProposalId`'s hash preimage (`compile.ts:38–56`) **must include the effective read scope**, so the scan roots are covered by the proposal identity hash. This makes the read scope tamper-evident and part of what the human approves — a changed read scope changes the proposal id, forcing re-approval. (Coordinate with fyt-autonomous-runner, which also edits this preimage — §3.1.)

### 4.3 Validation rules

Each declared path is validated in `defs.ts` (fail-closed, mirroring the existing target validation):

1. **Canonical repo-relative** — reuse `isSafeRepoRelativePath` (`proposal.ts:213`). Already rejects: empty, `> MAX_PATH_CHARS` (512), `\0`, backslash, leading/trailing `/`, `//`, drive letters, and any `.` / `..` / `.git` segment. This is the same validator the compiled `scope.read` paths already pass through `validateScope` (`proposal.ts:255–264`), so a declared path and a compiled path share one definition of "safe."
2. **Bounded list** — reuse `MAX_LIST_ITEMS` (64); reject duplicates.
3. **Whole-repo root is not expressible** — `.` and `""` already fail rule 1 (segment `.` and length 0). Assert it explicitly anyway so the intent is legible: a read scope is a list of named subtrees, never the repo root.
4. **Declarable-root allowlist** (the key policy decision — §4.4).

### 4.4 What may be declared: a closed server-owned allowlist (recommended over a denylist)

**Decision: a declared read path must be either (a) inside the def's own `orgs/<project>` tree, or (b) prefixed by one of a closed, server-owned set `SHAREABLE_READ_ROOTS`. Anything else is refused at def-validation time.**

Proposed `SHAREABLE_READ_ROOTS` (a frozen code table, exactly like `WORKFLOW_EXECUTION_PROFILES` and `ALLOWED_ACTION_TIERS`):

```
queue/         dashboards/    ledgers/    _index.md
governance/    CLAUDE.md      AGENTS.md   GEMINI.md
```

Rationale for the **allowlist** shape (not a denylist):
- It matches the codebase's fail-closed idiom. Profiles (`environment.ts:55`), action tiers (`policy.ts:87`), curated skills — all are *closed server tables that prose can name but never widen.* Read scope should be the same: a def NAMES a shareable root; it cannot invent one.
- A denylist must anticipate every dangerous path (a new top-level dir is a silent hole). An allowlist fails safe: an unanticipated root is refused, not admitted. The docs research on the OS-level alternatives (§5) shows the same lesson — Claude Code's own permission rules **cannot** express "deny everything except X," which is exactly why an allowlist at the declaration layer is the honest place to draw the line.

Rationale for the **contents**:
- `queue/`, `dashboards/`, `ledgers/`, `_index.md` — the self-lint scan roots (`self-lint-report.md:31–35`). These are in-repo coordination/observability state, nothing secret by construction, and a scan legitimately needs them. This is the exact set whose absence caused the live bug.
- `governance/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` — the constitution. Partly injected already as `governanceRefs`. **Note the deliberate asymmetry:** these are human-owned *for writes* (`policy.ts:51` `HUMAN_OWNED_PREFIXES`) but are *readable* policy text. Human-owned-for-writes ≠ read-denied. Declaring them for read stays safe; `policy.ts:137` keeps refusing any *write* target under them, unchanged.

Rationale for what is **excluded** (refused unless a code-reviewed change adds it):
- `orgs/<other-project>` — **cross-org privacy.** A def for project X may declare `orgs/X/...` (its own tree, always allowed) but never `orgs/Y`. Mirrors the write-containment at `defs.ts:136–139`. A genuine cross-org read becomes a human decision (add to the table under review), not a def-authored capability.
- `memory/` — per-agent private operational notes; may carry sensitive working context.
- `dashboard/` — the control-plane source (including this policy code). Not secret, but no org def has a legitimate reason to read it, and it is the largest non-org attack surface. Excluded on least-surprise grounds. **This is the one item worth an explicit confirm (§11).**
- `scripts/`, repo root, everything else — refused by default (the allowlist's whole point).

### 4.5 Reviewability

Because the effective read scope (a) is hashed into the proposal id, (b) appears in `proposal.scope.read` and every `stage.scope.read` in the compiled `kb.plan-proposal/v1` shape, and (c) is validated against the closed allowlist before it can compile, the scan roots are **visible in the reviewed proposal and covered by the approval hash.** Two independent controls: the human sees the roots at approval time, and the server refuses out-of-allowlist roots regardless of what any approver clicks.

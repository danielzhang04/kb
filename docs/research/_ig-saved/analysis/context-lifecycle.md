# Context Lifecycle — subsystem analysis

_Compiled 2026-08-17 by a deep-analysis subagent (read-only). Owns the CONTEXT LIFECYCLE subsystem of the kb platform overhaul. Capability claims about Claude Code are grounded against the official docs (code.claude.com/docs) and **labeled**; anything unverified is marked `ASSUMPTION — verify`. A sibling agent is running the authoritative capability probe; the load-bearing assumptions here are flagged for the boss to reconcile._

---

## 1. What Daniel wants (restated crisply)

Four distinct asks, all about the same thing — keeping the *right* context in front of an agent over a long run without paying for it twice:

1. **Periodic re-grounding.** A long-running terminal drifts. It should periodically pull the governing context — goal-state, working guidelines, how-to-work — *back to the forefront* on a cadence, not only at session start.
2. **Subagent inheritance without re-reading.** When a terminal spawns subagents, they should *inherit* governing + task-specific context instead of each re-reading the same governing docs from disk. Avoid double token consumption for the same governing material across a fan-out.
3. **Smart freshening (keep-vs-drop).** Re-grounding must be *selective*: keep specifically what Daniel wants held, drop the bloat. When loading a terminal into a large project, context retrieval must be **targeted**, not "read the whole project."
4. **Per-terminal persistent shortened-context store.** A durable, compact per-terminal context store that both the terminal can re-access and its subagents can read. (Daniel recalls installing a plugin that does this — that is ECC, assessed in §2.)

Success condition (my read): a terminal 3 hours into a large-project run still has the goal + guidelines accurately in front of it, its subagents boot already knowing them without re-reading, and the whole thing costs a fraction of re-loading the source docs each time.

---

## 2. What kb has today

### 2.1 The always-on load pattern (the baseline)
Every kb session loads, unconditionally:
- `CLAUDE.md` (2.7 KB / 45 lines) + `BOSS.md` (5.0 KB / 85 lines, boss only) — the constitution. Small, stable, cache-friendly.
- `memory/MEMORY.md` — an **index of ~50 arc pointers** (108 lines), each pointing at a full `memory/*.md` arc file. This is the personal-memory root and it is pure pointer-sprawl: it names resume points but the agent must then open the referenced files.
- `_index.md` (19 lines) as the navigation root → per-project `orgs/<project>/{_index,STATE,contract}.md`.
- `.claude/settings.json` hooks (governance) — see §2.4.

Re-grounding today is **manual and session-start-only**: BOSS.md §Startup tells the boss to re-read `_index.md`, its memory file, MEMORY.md, and the touched project's `_index/STATE/contract` *at the start of every session*. There is **no cadence, no mid-session refresh, no drift trigger**. When context drifts 2 hours in, nothing pulls it back except the human noticing.

### 2.2 Memory + handoffs (the durable store today)
- `memory/<agent-id>.md` — 7 per-agent files (claude-boss, dispatcher-cloud, fyt-runner, nightly-reviewer, housekeeping-agent, …). Human/agent-curated "what worked / failed / remains" lessons, appended end-of-run (enforced by the `delivery_gate.js` Stop hook). Authoritative, hand-curated, git-versioned.
- `handoffs/` — dated resume docs with an explicit **Load list** of files to read on resume; active-work-only, deleted on pickup. This is kb's real "shortened context store" — but it is **manual, per-arc, not per-terminal, and not auto-refreshed**.
- These are the substrate backlog **#10 (semantic memory retrieval)** proposes to index by embeddings.

**Gap:** the store is human-curated and coarse-grained (per-arc), written at session *end*. There is no live, per-terminal, continuously-maintained compact context object that a running terminal or its subagents read mid-run.

### 2.3 The ECC plugin — the "read-cache/tracker" Daniel remembers (INSTALLED BUT DISABLED IN kb)
`ecc@ecc` v2.0.0 is installed user-scope (`~/.claude/plugins/cache/ecc/ecc/2.0.0`). It ships exactly the context-lifecycle machinery Daniel is describing — a memory-persistence hook graph (`hooks/memory-persistence/`):

| ECC hook | Event | What it actually does (read from source) |
|---|---|---|
| `session:start` (`session-start.js`) | SessionStart | Injects **bounded** prior-session summary + mined "instincts" + "learned skills" into the new session via stdout. Bounded by `ECC_SESSION_START_MAX_CHARS`; disable with `ECC_SESSION_START_CONTEXT=off`. Has a **STALE-REPLAY GUARD** that wraps the summary as "frozen summary of a PRIOR conversation" so the model doesn't act on it as live. |
| `pre:compact` (`pre-compact.js`) | PreCompact | Generates an **LLM summary of the current session** and writes it to the active session `.tmp` file, so the *next* session-start gets a high-quality summary even after lossy compaction. Falls back to a plain log entry on failure. Writes to `~/.claude/sessions/`. |
| `pre/post:observe:continuous-learning` (`observe-runner.js`) | Pre/PostToolUse | Records tool-use observations → mines repeated patterns into "instincts" / "learned skills" that session-start later injects. |
| `post:session-activity-tracker` | PostToolUse | Records per-session tool calls + **file activity** for ECC2 status/metrics. This is the "read tracker" half. |

So ECC **is** a per-session persistent shortened-context store (`~/.claude/sessions/*-session.tmp` + a `learnedDir` of instincts/skills), fed by a PreCompact summarizer and replayed at session start. That matches Daniel's memory precisely.

**The critical finding: kb turns almost all of it OFF.** `kb/.claude/settings.json` sets:
```
ECC_DISABLED_HOOKS = "...,pre:compact,session:start,session-start:plan-canvas-sessions,
  pre:observe:continuous-learning,post:observe:continuous-learning,
  post:ecc-context-monitor,post:ecc-metrics-bridge,post:session-activity-tracker,..." (≈40 hook ids)
ECC_GATEGUARD = off
```
i.e. every context-lifecycle ECC hook — session-start injection, PreCompact summary, observe/continuous-learning, activity tracker — is **disabled inside kb sessions**. Why: `memory/claude-boss.md` records that ECC's **GateGuard** hooks (fact-forcing before first Bash/Write) fired intrusively inside kb and collided with kb's own governance hooks; the whole ECC hook set was disabled rather than cherry-picked. **The context-persistence benefit was thrown out with the intrusive gate.** ECC's stack is also single-machine-local (`~/.claude/sessions`), unaware of kb's git-based coordination, and does **not** address subagent inheritance (§3).

### 2.4 kb's own hooks (no context-lifecycle among them)
kb-authored hooks are governance-only: `block_no_verify.js`, `hard_ceiling_guard.js`, `config_protection.js` (PreToolUse) and `delivery_gate.js` (Stop). User-scope hooks are `keep_awake.ps1` only. **kb has zero SessionStart / UserPromptSubmit / PreCompact / SubagentStart hooks of its own.** There is no automated context refresh or subagent-context injection anywhere in kb today.

### 2.5 CCO — claude-context-optimizer (installed, advisory)
`claude-context-optimizer@cco` v4.6.0 is installed. It provides *analysis*, not enforcement: `/cco-overhead` (audit fixed session overhead), `/cco-pack` (ranked file list with offset/limit to load minimal context for a task), `/cco-claudemd` (CLAUDE.md bloat audit), `smart-loader` (suggest files to preload from a task description), `/context`-style audits. This is the substrate backlog **#7** builds on. It informs "targeted retrieval" but does nothing automatically.

---

## 3. What Claude Code actually enables (capability-grounded)

Verified against `code.claude.com/docs/en/hooks` and `.../sub-agents` on 2026-08-17.

### 3.1 Hooks that can INJECT context (VERIFIED)
- **SessionStart** → can add context to the model via `hookSpecificOutput.additionalContext`. **[VERIFIED]** This is how ECC's session-start injection works.
- **UserPromptSubmit** → can inject context via `hookSpecificOutput.additionalContext` **and** via plain stdout (explicitly added to Claude's context, unlike other events). **[VERIFIED]** — this is the native mechanism for **periodic re-grounding** (ask #1): a hook that fires on every prompt submit can re-inject the governing context on a cadence.
- **PreToolUse / PostToolUse** → support `additionalContext` too. **[VERIFIED]**
- **SubagentStart** → exists, no matcher, fires on every subagent start, and **can inject `additionalContext` into that subagent's context**. **[VERIFIED per docs fetch — but FLAG for the sibling capability probe to confirm the exact field + that it reaches non-fork Agent-tool subagents, since this is load-bearing for ask #2.]**
- **PreCompact** → per the docs fetch, fires before compaction and can **block** it but **cannot inject or replace** the compaction summary. **[ASSUMPTION — verify; the summarizer model may have over-stated. Reconcile with the sibling probe.]** Note ECC does *not* rely on injecting at compaction — it **writes a summary file as a side effect** and replays it at the next SessionStart. That side-effect pattern is robust regardless of the inject question.

### 3.2 Subagent context model (VERIFIED — this reshapes ask #2)
From the sub-agents doc, a **non-fork subagent starts with a fresh, isolated context window** — it does *not* see the parent's conversation history, prior tool results, or files already read. What it *does* load at startup:
1. Its own system prompt (agent definition) + the delegation/task prompt the parent writes.
2. **The full CLAUDE.md hierarchy** (`~/.claude/CLAUDE.md`, project CLAUDE.md, `CLAUDE.local.md`, managed policy) — **loads automatically**. (Built-in Explore/Plan agents skip it.)
3. A git-status snapshot from the parent session start.
4. **Preloaded skills** — the full content of any skill named in the agent's `skills:` frontmatter field is injected at startup.
5. A sibling roster (v2.1.206+).

Explicitly **NOT** passed to a non-fork subagent: the parent's conversation, its output style, and **the main conversation's auto memory** (`MEMORY.md` is *not* auto-loaded into subagents). A subagent gets persistent memory only via its own `memory:` field.

A **fork** (`subagent_type: "fork"`) is the exception: it inherits the entire conversation — same system prompt, tools, model, and message history.

**Implication for ask #2:** the "avoid double context consumption" problem has a native answer already partly in place:
- CLAUDE.md/BOSS.md **already** load once per subagent automatically — that governing layer is not the double-read pain.
- The double-read pain is **project governing context** (`STATE.md`, `contract.md`, doctrine files) and **task context**, which today the boss either hand-pastes into every dispatch prompt (BOSS.md: "keep worker context rich (full briefs)") or each subagent re-reads from disk. Both re-consume the same tokens N times across a fan-out.
- Native levers to fix it: **(a) the `skills:` field** injects fixed governing content into every subagent at startup without the subagent discovering/reading it; **(b) a SubagentStart hook** can inject a compact per-terminal context object; **(c) a fork** inherits everything when full context sharing is actually wanted.

---

## 4. What backlog #7 / #8 / #10 already cover

- **#7 Context-efficiency pass** — glob-scoped `rules/` files (load only when a matching file is touched) instead of always-on CLAUDE.md; abstract→overview→full **progressive disclosure**; a `/context` per-item token audit; terse output-style. Directly targets kb's always-on load. kb ships CCO (overlaps the audit piece) but has **no** glob-scoped rules and **no** lazy-disclosure protocol. → Covers the *targeting* half of ask #3 (targeted retrieval into a large project) and the always-on-bloat reduction.
- **#8 Prompt-cache-ordered construction** — kb-wide convention: stable prefix first, dynamic content last, to maximize cache-hit prefix length. → Covers the *cost* dimension: re-grounding and subagent-inheritance injections must be placed to preserve the cache prefix, or they defeat their own savings. This is a **constraint on how §6 injects**, not a separate build.
- **#10 Semantic memory retrieval + auto-capture** — index `memory/` + `handoffs/` with embeddings so a fresh session recalls the least-general relevant lesson by meaning, not grep; optionally auto-capture/compress end-of-run state. → Covers the *retrieval* engine for "smart freshening" (ask #3 keep-vs-drop) and the *auto-capture* half of the persistent store (ask #4). Keep human-curated lessons authoritative; index is an accelerator.

**So three of the four asks already have a backlog home.** The genuine net-new is the *lifecycle wiring* that binds them together and the *subagent-inheritance* piece — see §5.

---

## 5. The genuine NET-NEW gaps

Stripping out what #7/#8/#10 and ECC already cover, what remains truly unbuilt for kb:

1. **[NET-NEW] Periodic re-grounding on a cadence.** Nothing in kb or the backlog re-injects governing context *mid-run*. #7 reduces the always-on load; it does not *refresh* it. This needs a UserPromptSubmit-hook (or turn-count/drift trigger) that re-surfaces a compact goal+guidelines block every N turns. **The single clearest net-new item.**
2. **[NET-NEW] Subagent governing-context inheritance without re-read.** kb passes context by hand-pasted full briefs (expensive, N×) or per-subagent disk reads (expensive, N×). No mechanism packages the terminal's *current* compact context and injects it into subagents at spawn (via `skills:` preload and/or a SubagentStart hook). Backlog #20's "typed shared-state blackboard" is adjacent but is about *inter-node work state*, not *governing-context inheritance*.
3. **[NET-NEW] A live, per-terminal compact context object.** ECC's session `.tmp` is the closest analog but is disabled in kb, local-only, and not integrated with kb's memory/handoffs/git model. kb has session-*end* handoffs but no continuously-maintained *mid-run* per-terminal context object that both the terminal re-reads and subagents inherit. This is the "persistent shortened context store" (ask #4) as a first-class kb artifact.
4. **[NET-NEW] The keep-vs-drop "smart freshening" policy.** #10 gives *retrieval by meaning*; nothing defines *what a re-grounding refresh must always keep* (goal-state, active guidelines, current gate) vs. *what it may drop* (resolved sub-tasks, stale exploration). This is a policy + a small ranker, not just an embedding index.
5. **[NET-NEW/reclaim] Re-enable ECC's context stack cleanly, or replace it.** kb disabled ECC wholesale to kill its intrusive GateGuard. The decision to make: cherry-pick ECC's *benign* context hooks (session-start injection, PreCompact summary, activity tracker) back on while keeping GateGuard off — or reimplement the equivalent as kb-native hooks that speak kb's memory/handoffs format. Either way, the current state (fully off) leaves the installed capability stranded.

---

## 6. Concrete build approach

A **Context Lifecycle Manager (CLM)** — a small kb-native subsystem, four components, built on the verified hook + subagent primitives. Do **not** rely on ECC's stack (local-only, disabled, wrong storage format); reuse its *proven patterns* (bounded injection, stale-replay guard, PreCompact-writes-a-file).

### Component A — Per-terminal Context Object (the store) `[ask #4]`
- **What:** one compact, continuously-maintained JSON/MD object per terminal session, e.g. `.kb/context/<session-id>.ctx.md`, with a fixed schema:
  - `goal` (one-line success condition, from BOSS.md restate-the-goal discipline),
  - `guidelines` (the handful of active working rules for this run),
  - `current_gate` / `next_action` (where the run is),
  - `active_project` pointer (`orgs/<project>` + the 3–5 STATE/contract facts that matter *now*),
  - `resolved` (compacted list of done sub-tasks — droppable),
  - `provenance` (source file + line, so any item can be re-expanded on demand).
- **Where it lives:** session-scoped working dir (not git-tracked by default — it's ephemeral runtime state), but *derived from* git-tracked sources (CLAUDE.md, STATE.md, handoffs, memory) so it's always reconstructable. Auto-capture into `handoffs/` at session end (bridges to #10).
- **How it's built:** at SessionStart, from a **targeted** read (§Component D), not a full-project read.
- **Effort:** M. **Risk:** Low — it's a derived cache; worst case is staleness, mitigated by provenance + refresh.

### Component B — Periodic re-grounding `[ask #1]`
- **Mechanism (VERIFIED):** a **UserPromptSubmit hook** that, every N turns (or on a drift signal), injects Component A's `goal`+`guidelines`+`current_gate` via `additionalContext`/stdout. This is the native, documented way to put context back in front of the model mid-run.
- **Drift trigger options:** simplest = every N prompt-submits (turn counter in the ctx file). Better = inject only when the object changed or a turn budget elapsed, to avoid cache thrash (#8).
- **Reuse ECC's STALE-REPLAY GUARD idea** so a re-grounding block reads as "current governing context," never as a new instruction.
- **Effort:** S–M. **Risk:** Medium — over-injection burns tokens and breaks the cache prefix (#8); must be bounded (cap chars, like `ECC_SESSION_START_MAX_CHARS`) and cadence-tuned. This is the highest-value, lowest-LOC win.

### Component C — Subagent inheritance `[ask #2]`
- **Primary mechanism (VERIFIED):** package Component A's compact object and hand it to subagents so they **don't re-read** governing docs. Two native routes, use both:
  1. **`skills:` preload** — represent the stable governing layer as a generated skill (or reuse the ctx object as a preloaded skill file) named in dispatched agents' `skills:` frontmatter → full content injected at startup, once, per the doc.
  2. **SubagentStart hook** — inject the *live* per-terminal ctx object (goal/gate/project facts) as `additionalContext` so even ad-hoc Agent-tool spawns inherit the terminal's current state. **[FLAG: confirm SubagentStart reaches non-fork Agent-tool subagents and the field name with the sibling probe before building.]**
  3. For tasks needing the *whole* conversation, use a **fork** (already available) rather than re-pasting.
- **What this removes:** the boss's hand-pasted "full brief" duplication and per-subagent disk re-reads of STATE/contract/doctrine. CLAUDE.md already auto-loads, so don't duplicate it into the object.
- **Effort:** M. **Risk:** Medium — depends on the SubagentStart capability flag; the `skills:`-preload route is a safe fallback that is fully verified today.

### Component D — Targeted retrieval + smart freshening `[ask #3]`
- **Targeted load into a large project:** on SessionStart, build Component A from a **scoped** read — `_index.md` → the active `orgs/<project>/{_index,STATE,contract}` → and only the handoff Load-list, never the whole tree. Lean on **CCO `/cco-pack` / smart-loader** (already installed) to rank which files to pull, and on backlog **#7** glob-scoped `rules/` so doctrine loads only when relevant files are touched.
- **Keep-vs-drop policy (the "smart" part):** an explicit ranked policy — **always keep** goal, active guidelines, current gate, active-project facts; **always droppable** resolved sub-tasks, stale exploration, superseded arcs; **retrieve-on-demand** everything else via provenance pointers + backlog **#10** semantic index (recall the least-general relevant lesson by meaning).
- **Effort:** M–L (L if it pulls in #10's embedding index). **Risk:** Low-Medium — the failure mode is dropping something load-bearing; mitigate with the "always keep" allowlist + provenance re-expansion.

### Sequencing
1. **B (periodic re-grounding)** first — smallest build, highest daily value, needs only a UserPromptSubmit hook + a trivial ctx file. Proves the pattern.
2. **A (context object)** — formalize the schema B is already reading.
3. **C (subagent inheritance)** — once A exists, wire `skills:` preload (safe) then SubagentStart injection (pending the capability flag).
4. **D (targeted + smart freshening)** — layer CCO + #7 + #10 on top of A. Largest; do last.

Constraint across all four: obey **#8** — inject stable content as a fixed prefix, per-call dynamic content last, so re-grounding and inheritance don't nuke the prompt cache (kb already knows "proxies break caching"; same discipline applies to hook injection).

---

## 7. Open design questions for Daniel

1. **Re-grounding cadence:** every N turns, on a token/turn budget, or only on a detected goal change? (N-turns is simplest; budget-based is cheaper.) What is the compact block allowed to contain — goal + guidelines + gate only, or also current-project facts?
2. **ECC: reclaim or replace?** Cherry-pick ECC's benign context hooks (session-start injection + PreCompact summary + activity tracker) back on with GateGuard staying off — or build kb-native equivalents that speak kb's memory/handoffs/git format? (I lean kb-native: ECC is local-only and unaware of kb coordination, but reclaiming is far less work if its storage is acceptable.)
3. **Where does the per-terminal context object live** — ephemeral session working dir (my default), or git-tracked so the dashboard/other terminals can read it? The latter turns it into shared state (touches #20's blackboard) but adds coordination-write cost.
4. **Subagent inheritance mechanism:** are you OK depending on a SubagentStart hook (pending capability confirmation), or should we ship the fully-verified `skills:`-preload route first and treat the hook as an upgrade?
5. **Smart-freshening authority:** should keep-vs-drop be a deterministic allowlist policy (safe, dumb) or a model-judged ranker (smarter, can err)? kb doctrine ("fix, don't defer") suggests deterministic-first with the human keeping the drop veto.
6. **Scope vs. the sibling subsystems:** the retrieval/targeting half (#7) and semantic index (#10) may be owned by other overhaul subsystems. Does CLM *own* the lifecycle wiring and *consume* those, or build its own retrieval? (I assume consume.)

---

## Load-bearing assumptions flagged for the capability-probe reconciliation
- **SubagentStart hook injects `additionalContext` into non-fork Agent-tool subagents** — VERIFIED per docs fetch, but Component C depends on it; confirm the field name and that it fires for programmatic Agent-tool spawns (not just interactive). Fallback (`skills:` preload) is fully verified.
- **PreCompact cannot inject/replace the summary, only block** — per docs fetch, but the summarizer model may have over-stated; the CLM design does not depend on injecting at compaction (it uses the ECC-style write-a-file side effect), so this is non-blocking either way.
- **UserPromptSubmit stdout + `additionalContext` both reach the model** — VERIFIED; this is the spine of Component B.
- **Subagents do NOT auto-load `MEMORY.md`/auto-memory; DO auto-load the full CLAUDE.md hierarchy + `skills:` content** — VERIFIED; this is why the double-read pain is project/task context, not the constitution.

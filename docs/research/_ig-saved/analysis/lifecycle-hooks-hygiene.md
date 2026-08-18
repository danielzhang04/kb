# Fleet Lifecycle, Hooks & Hygiene Ops — subsystem analysis

Read-only. No code, no commits. Grounded against live repo inspection (no branch switches) plus
`code.claude.com/docs/en/hooks` (fetched 2026-08-17/18) and this exact kb install's own **live,
shipped** hook wiring — which is stronger evidence than any doc fetch, since it's proven in
production, not summarized by a small model. Cross-checked against the sibling
`context-lifecycle.md` (independent same-date docs fetch) at the two points our scope overlaps.

---

## 1. What Daniel wants (restated)

Five mechanisms: (a) a "keep on" loop — say the phrase, the session loads a closing-instructions
file and keeps working without re-prompting; (b) a periodic file cleanser — trash removal + size
shrink without losing function/precision; (c) a periodic conversation/learning miner that feeds a
second brain; (d) file-editing + subagent-governing guideline docs; (e) hooks on subagent spawn —
verify the model, load governing context. I own the **mechanism + guideline docs** for all five;
the second-brain *agent* is `agent-runtime.md`'s; *what* context to inject at spawn is
`context-lifecycle.md`'s.

---

## 2. What kb has today, per ask

**(a) Keep-on / auto-refresh:** nothing. No hook detects a phrase, arms a lease, or forces
continuation. The nearest analog is `scripts/KeepAwake/*` (machine-sleep prevention, not
conversation continuation) — but it *proves* the exact hook-wiring pattern this needs (see §3).

**(b) File cleanser:** nothing. `scripts/branch_hygiene.py` cleans git branches/worktrees (BOSS.md
"Git hygiene" section), `scripts/context_audit.py` is a read-only numeric token inventory,
`scripts/sync_daemon_dirs.py` mirrors two specific directories main→ops. None deletes or shrinks
repo *file content*. Empirical evidence of the gap: this session's own `git status` shows dozens
of untracked scratch artifacts already accumulated under one project alone —
`orgs/faceless-youtube/.../scratchpad/backup-pre-splice-fix/`, `.../assets/_archive-pre-regen-2026-08-06/`,
loose `.jpeg`/`.html`/`.py` working files, `.codex/visualizations/`, `.playwright-mcp/`. `.git`
itself is 324MB. Nothing periodic reclaims any of it.

**(c) Learning/conversation miner:** partially built, but not the piece Daniel is asking for.
`scripts/dream.py` (565 lines, tested, real) is a **memory-consolidation** dry-run reporter: it
reads every `memory/*.md`, dedupes near-identical entries, marks TODOs resolved by a passed grade,
prunes dead-path references — emitting ADD/UPDATE/DELETE/NOOP proposals (Mem0 vocabulary),
**report-only, no apply path** (design-gated behind Proving Grounds trust). Its own docstring is
explicit: **`ADD` is reserved for the trusted apply path... proposing brand-new facts from
evidence"** — and nothing produces that. `dream.py` only ever *reorganizes what's already
written*; it never reads a raw session transcript. `scripts/mission_control.py` is queue-card
triage, unrelated. The capture side today is entirely manual: `growth-log` (skill, teaches format)
+ `delivery_gate.js` (Stop hook, **warn-only**, checks only whether `memory/<agent-id>.md`'s mtime
moved this session — never reads *what* was written, never reads the transcript). If an agent
finishes a session having learned something and forgets to write it, delivery-gate prints a
warning to a shell nobody re-reads and the lesson is gone. Nothing mines transcripts.

**(d) Guideline docs:** scattered, not consolidated. `governance/agent-rules.md` (8 rules: git
identity, per-step model ledger, memory-at-run-end, skill-tier sandboxing, parse/act boundary,
codex registration, canary protection) is the closest thing to a subagent-governing doc, but it's
fleet-wide operational rules, not a "how to spawn and scope a subagent" doc. `BOSS.md` *is* a
real subagent-governing doc — model-by-stakes routing, "name the exact files/functions in scope,
what NOT to touch, acceptance criteria" — but scoped to the one interactive boss terminal, not
generalized for any terminal that dispatches. File-editing guidance exists only as two
mechanically-enforced special cases (`config_protection.js`: `governance/` + constitution files
human-edited-only) plus scattered constitution prose — no single doc says what's Edit-preferred,
what's convention-protected-only, or what "shrink without losing precision" means.

**(e) Subagent-spawn hooks:** `SubagentStart`/`SubagentStop` are wired **today, live, shipped** —
but only for keep-awake heartbeats (`docs/plans/2026-07-20-overnight-keep-awake.md`, PR #119
MERGED per `memory/MEMORY.md`'s "keep-awake-hardening-arc" entry). Nobody uses them for model
verification or context injection. Model verification exists only as **two manual disciplines**:
`agent-rules.md` rule 3 ("ledger every model step... requested vs responding model id; wake-me
card on mismatch") and `BOSS.md` ("verified at GRADING, never assumed... grepping
`~/.claude/projects/C--Users-danie-kb/<session-id>/subagents/agent-<id>.jsonl` for `"model":`").
Both are **procedural, human/agent-remembered, after-the-fact** — no hook enforces either.

---

## 3. What Claude Code actually enables (capability-grounded)

### 3.1 High-confidence: this exact install's own live wiring (strongest evidence available)

`~/.claude/settings.json` on this machine wires **`SessionStart`, `UserPromptSubmit`,
`PreToolUse` (`matcher: "*"`), `PostToolUse` (`matcher: "*"`), `SubagentStart`, `SubagentStop`,
`SessionEnd`** — all `async: true`, all calling `scripts/keep_awake.ps1`. This is not a doc claim;
it is a shipped, PR-merged (#119), currently-running mechanism in this repo. **`SubagentStart` and
`SubagentStop` firing per-subagent is therefore VERIFIED, not assumed** — this is the load-bearing
fact for ask (e) and it rests on production evidence, not a docs fetch. One caveat carried from the
keep-awake build log itself: the `$CLAUDE_SESSION_ID`-style variable expansion in a hook command
was *unconfirmed* at write time (the plan's own Step 4 says verify it actually expands, falling
back to a fixed label if not) — worth re-checking before any new hook depends on session-id
interpolation in the command string rather than reading `session_id` from the JSON stdin payload
(the JSON payload is the reliable channel; prefer it over shell-expanded args).

### 3.2 Medium-confidence: docs fetch, cross-checked against the sibling's independent fetch

Both this analysis and `context-lifecycle.md` independently fetched `code.claude.com/docs/en/hooks`
on 2026-08-17/18 and agree on the shape, with one field-name discrepancy flagged below.

- **`PreToolUse`** — matches a tool name (`Bash`, `Edit|Write`, or an agent-dispatch tool);
  receives `tool_input`; can **block** (exit 2 or `permissionDecision: "deny"`) or allow through.
  **VERIFIED** — this is exactly the mechanism kb's own `hard_ceiling_guard.js`/`config_protection.js`
  already use, so the plumbing is proven in this repo regardless of doc wording.
- **`SubagentStart`** — fires once per spawned subagent, matcher on agent type, **can inject
  context** into that subagent. **Field name is the one real disagreement**: my fetch says
  `hookSpecificOutput.expandedInitializationPrompt`; the sibling's independent fetch says
  `additionalContext`. **[ASSUMPTION — verify exact field name; do not hand-wire either name into
  a shipped hook without confirming against the sibling capability-probe or a live smoke test.]**
  Both fetches agree the *capability* (inject at spawn) exists — only the field name is unconfirmed.
- **`SubagentStop`** — fires once per finishing subagent, receives `agent_id`/`agent_type` and
  (per my fetch) `last_assistant_message`; **can block the stop** (`continue: false`) but this is
  the wrong lever for a model-mismatch finding (see §5e) — the work already happened, blocking the
  stop just wedges the terminal, it doesn't undo the wrong-model run.
- **`Stop`** (main-turn end, not subagent) — can return `additionalContext` and can block via
  `continue: false`/exit 2, which **forces Claude to keep responding in the same turn** rather than
  ending it. **Real limit, stated honestly**: this is turn-continuation, not "spawn a new
  autonomous turn out of nothing" — Claude Code's docs do not state a hard iteration cap on this,
  which means an unbounded blocking condition is a genuine runaway-loop risk with no platform-level
  safety net; the safety net has to be built into the hook itself (§5a). No evidence either fetch
  found of built-in loop detection on this path — treat "Claude will eventually notice and stop
  anyway" as **false** and design as if it will not.
- **`PreCompact`** — can **block** compaction, cannot inject/replace the summary (my fetch); the
  sibling flags this as possibly over-stated by the summarizing model. **[ASSUMPTION — verify]**.
  Not load-bearing for this subsystem (my keep-on design doesn't depend on compaction injection).
- **Tool name for a subagent dispatch** — this session's own tool list surfaces subagent-spawning
  as `Agent`; historical Claude Code docs and community material call the underlying tool `Task`.
  **[ASSUMPTION — verify the exact `PreToolUse` matcher string in this harness version before
  wiring a model-policy-guard hook (§5e); a wrong matcher silently never fires — fail-open by
  default, but confirm empirically first.]**

---

## 4. Net-new gap summary

| Ask | Exists today | Genuine net-new |
|---|---|---|
| (a) keep-on loop | Nothing (keep-awake proves the wiring pattern only) | Phrase-arm + closing-file pointer + bounded Stop-hook continuation + off-switch |
| (b) file cleanser | Nothing (branch/worktree hygiene only, not file content) | Trash classifier + dry-run report + gated apply |
| (c) learning miner | `dream.py` consolidates *existing* memory; `ADD` reserved but unproduced | The transcript→ADD-proposal producer `dream.py` was designed to receive but never got |
| (d) guideline docs | Scattered rules + two hook-enforced special cases | One file-editing doc, one general (not boss-only) subagent-governance doc |
| (e) spawn hooks | `SubagentStart`/`SubagentStop` wired for keep-awake only | Model-policy-guard (request+response) + context/guideline injection hook |

---

## 5. Build approach

### (a) Keep-on auto-refresh + closing-md loop

**Mechanism**, mirroring `keep_awake.ps1`'s lease pattern and `delivery_gate.js`'s fail-open style:

1. **Arm** — a `UserPromptSubmit` hook (`scripts/hooks/keep_on.js`) regex-matches the phrase in
   `user_prompt` (JSON payload, not shell-expanded args — see §3.1 caveat) and writes a
   session-scoped lease file (e.g. `%LOCALAPPDATA%\kb-keepon\<session-id>.json`) recording: the
   armed timestamp, a pointer to the closing-instructions file, and a hard cap (max
   auto-continuations *and* max wall-clock, both — same belt-and-braces the keep-awake supervisor
   uses). **Do not invent a new "CLOSING.md" file type** — point at what already exists:
   `orgs/<project>/contract.md` (build/run doctrine), `STATE.md` (current state), or an active
   `handoffs/*.md` (exact-next-step + Load list, already the canonical resumable-instructions
   shape per `save-session`). Only fall back to a dedicated closing file if none of those fit —
   flag as an **open question for Daniel** (§7.1).
2. **Continue** — the existing `delivery_gate.js` Stop hook gets a sibling check (or an added
   branch in the same file, matching its existing warn-only style but now conditionally blocking):
   if the lease is armed AND the closing file has an unresolved checklist item / unreached gate AND
   the cap isn't exhausted AND `STOP` file absent AND budget not breached (reuse `preamble.py`'s
   exact checks — never re-derive them), return `continue: false` (exit 2) with the next unchecked
   step as the block reason, forcing the current turn to keep going. Otherwise release the lease
   and let it stop normally.
3. **Off-switch** — three independent releases, so no single miss leaves it stuck: (i) a matching
   "stop keeping on" phrase the same hook clears, (ii) the repo-root `STOP` file (already the
   fleet-wide kill switch, checked every turn via preamble), (iii) the hard numeric/time cap.
   `SessionEnd` always deletes the lease — **keep-on never survives a crash or new session**; that
   is a deliberate scope narrowing (safer default) versus "persists forever," and should be
   confirmed with Daniel rather than assumed (§7.1).
4. **"Auto-refreshes context"** — this is `context-lifecycle.md`'s Component B (periodic
   re-grounding via `UserPromptSubmit`/`additionalContext`), not a second mechanism to build here.
   The keep-on hook's job is *forcing continuation*; the *content* it re-injects on each forced
   continuation should be CLM's compact context object once it exists. **Explicit seam**: keep-on
   consumes CLM's Component A, does not duplicate it.

Files: `scripts/hooks/keep_on.js` (new), `scripts/hooks/delivery_gate.js` (extended), a lease-store
helper mirroring `KeepAwake.psm1`'s CRUD shape but in Node/JSON. **Effort M. Risk: the highest in
this subsystem** — an unbounded forced-continuation loop is a real runaway-cost failure mode with
no platform safety net (§3.2). Non-negotiable before building: run this design past
`loop-design-check` for a decidable stop condition, and treat the numeric/time cap as mandatory,
not optional, from day one — not a "later hardening" card.

### (b) Periodic file cleanser

**Mechanism**, mirroring `dream.py`'s report-only shape (proven safe pattern in this exact repo):

`scripts/hygiene_sweep.py --dry-run`, run on a HEARTBEAT cadence (existing dispatcher mechanism,
not a new hook — this is scheduled, not per-turn). Two separate rule sets with different risk:

- **Trash (delete candidates)**, deterministic only: untracked files under any `scratchpad/` dir
  older than N days *and* superseded by a later same-purpose dir (naming pattern `_archive-*`,
  `backup-pre-*` — patterns already in live use, see §2b evidence); known junk globs
  (`__pycache__/`, `*.tmp`); untracked dirs matching `_archive-*`/`backup-*` with **zero references**
  from any `memory/`, `handoffs/`, or `STATE.md` file (reuse `dream.py`'s own dead-path-detection
  logic — it already does exactly this check, just for memory entries instead of directories).
- **Shrink (compact, don't delete)**, separate and lower-risk: applies to docs/code, not media —
  this is `#7`'s territory (progressive disclosure, glob-scoped rules, CLAUDE.md bloat audit via
  `claude-context-optimizer`'s `/cco-claudemd`) more than a new mechanism; this subsystem's role is
  just to route "shrink without losing precision" requests through the existing CCO tooling rather
  than reinventing a compactor.
- **Never touch**: `governance/`, `queue/`, `ledgers/`, `memory/`, `handoffs/`, `evals/`
  (canary-protected per `agent-rules.md` #8), anything git-tracked without an explicit
  superseded/dead signal. `.git` history bloat (324MB) is explicitly **out of scope** — shrinking
  it means rewriting history, which is a different, far more destructive class of operation and
  needs its own explicit ruling, not a default sweep.

**The sharp edge, stated plainly**: untracked scratch files are not git-recoverable once deleted —
`dream.py`'s "report-only" discipline exists precisely because memory edits are reversible via git
and it *still* refuses to auto-apply; deleting genuinely-untracked scratch is strictly less
reversible than that. First N runs must produce a dry-run report only (written like `dream.py`'s
report, e.g. to a queue card or `docs/hygiene/`), with a human approval gate before any `--apply`,
and apply-mode should start scoped to the narrowest, most obviously-safe category (already-named
`_archive-*`/`backup-*` dirs) before ever touching a heuristic category.

Files: `scripts/hygiene_sweep.py` (new). Effort M. Risk Medium (irreversible on untracked paths;
mitigated by dry-run-first + narrow starting scope + human gate, matching `dream.py`'s precedent).

### (c) Learning / conversation miner

**Do not rebuild `dream.py`** — it already owns memory *consolidation*. The real gap is upstream:
nothing mines a raw session transcript into the `ADD` proposal `dream.py`'s own vocabulary reserves
but never produces. Build exactly that missing producer:

`scripts/session_miner.py`, scheduled (nightly sweep, not inline in the Stop hook — keep
`delivery_gate.js` warn-only and cheap, per its own explicit design note "ALWAYS exits 0"; adding
transcript-parsing work to every session's shutdown path would slow every stop for a nightly-cadence
concern). For each session transcript found under `~/.claude/projects/<safe-cwd>/` (the path
convention already established and load-bearing in `BOSS.md`'s model-verify discipline — reuse it,
don't re-derive it) where `delivery_gate.js`'s own condition would have warned (memory mtime <
session start): scan a bounded window of the transcript for growth-log's own Rule-1 signal
(failure → recovery pairs, retries, explicit corrections — "wait, actually", tool errors followed
by a different approach), and draft candidate entries in `dream.py`'s exact `Op` shape (`ADD`,
summary, detail, provenance = transcript path). Emit a report, same discipline as `dream.py`: never
writes to `memory/` directly. The report either becomes a queue card for human review, or —
cleanest — becomes the missing input `dream.py --dry-run` could consume on a future pass, so the
two scripts compose into one pipeline (mine → propose ADD; consolidate → propose UPDATE/DELETE/NOOP)
rather than two disconnected tools.

**Where it persists**: nowhere new — the destination is the same `memory/<agent-id>.md` growth-log
already targets, reached through the same report→human/branch→merge path `dream.py` already uses.
**Explicit seam with `agent-runtime.md`**: that subsystem's second-brain agent is the eventual
*trusted, bounded apply path* (once Proving Grounds trust opens) that could consume this miner's
`ADD` proposals automatically; this subsystem only builds the proposal *producer*, matching
`dream.py`'s current report-only scope exactly — I am not building the acting agent.

Files: `scripts/session_miner.py` (new). Effort M. Risk Low — same report-only shape already proven
safe in this exact codebase by `dream.py`.

### (d) File-editing + subagent-governing guideline docs

Both as **proposals**, per the constitution ("governance/ ... human-edited only"; agents propose,
Daniel commits) — landing in `docs/proposals/`, never written directly to `governance/`:

- `docs/proposals/file-editing-guidelines.md` — Edit-over-Write as the default (preserves diff/
  audit trail, matches why `config_protection.js` exists); an explicit map of what's *mechanically*
  blocked today (`governance/**`, root `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) versus what's only
  *convention*-protected (`evals/` canaries per `agent-rules.md` #8, `orgs/*/contract.md`, card
  frontmatter fields per `card-schema.md`); the size/precision rules (b)'s cleanser should cite as
  its policy source, so the sweep script isn't inventing its own rules.
- `docs/proposals/subagent-governance-guidelines.md` — generalizes `BOSS.md`'s dispatch discipline
  (explicit model per stakes-tier, name exact files/functions in scope, state what NOT to touch,
  concrete acceptance criteria, verify-before-accept) from "the interactive boss terminal" to "any
  terminal that dispatches a subagent" — this is the **policy** that (e)'s hooks enforce
  mechanically; write the policy first, the hook checks against it.

Files: two new proposal docs. Effort S. Risk Low — but load-bearing: (e) has nothing to check
against until this exists.

### (e) Subagent-spawn hooks — model-verify + context-load

Both hooks follow the exact shape of the three already-shipped `PreToolUse` hooks
(`block_no_verify.js`, `hard_ceiling_guard.js`, `config_protection.js`): stdin JSON in, fail-open
on anything unparseable or unmatched, exit 2 only on a clear violation.

**Model-verify, two stages** (automates — doesn't replace the intent of — `agent-rules.md` rule 3
and `BOSS.md`'s manual grading-time grep):

1. **Request-time** (`PreToolUse`, matcher on the subagent-dispatch tool — **confirm the exact
   matcher string empirically first**, §3.2): read `tool_input.model`/`subagent_type`, check it's a
   known alias in `governance/model-routing.yaml`. This catches typos/hallucinated model strings
   before spawn. **What it cannot do alone**: enforce the *correct tier* for the task, because
   risk-tier isn't visible on an ad-hoc `Agent`-tool call outside the card system — that requires
   the dispatching prompt to carry the routing key explicitly, which is a process convention for
   (d)'s guideline doc to specify, not something a stateless hook can infer. Flag as open design
   question (§7.2).
2. **Response-time** (`SubagentStop`): read the subagent's own transcript (path convention already
   established in `BOSS.md`), extract the first responding `"model":` line — literally automating
   the grep `BOSS.md` currently asks a human/grading-agent to run by hand — compare to what was
   requested. On mismatch: **log a ledger row + wake-me card** (the existing fleet-wide anomaly
   convention), do **not** block the stop. Blocking is the wrong lever here (§3.2) — the work
   already ran on the wrong model; wedging the terminal doesn't undo it, it just adds friction.
   Once built, this is the piece that lets `BOSS.md`'s "verified at GRADING... grep the JSONL"
   instruction shrink to "read the automated model-verify row" — a real simplification of an
   existing manual step, not just a new feature.

**Context-load**: build the `SubagentStart` hook *scaffolding*
(`scripts/hooks/subagent_governance_inject.js`) now, independent of the field-name uncertainty
(§3.2) — inject (d)'s subagent-governance-guidelines (small, static, doesn't depend on any dynamic
per-terminal state) so every dispatched subagent gets the baseline governance reminder even outside
`context-lifecycle.md`'s CLM system. Once the sibling capability-probe confirms the injection field
name, the same hook becomes the attachment point for CLM's dynamic per-terminal context object too
— **this hook is the shared seam both subsystems plug into**, not two competing hooks.

Files: `scripts/hooks/model_policy_guard.js`, `scripts/hooks/model_verify.js`,
`scripts/hooks/subagent_governance_inject.js` (all new, same Node pattern as the existing three).
Effort M. Risk: Medium for model-verify (must fail open on any routing.yaml drift, exactly like the
existing hooks do on parse failure); Low for context/guideline injection (additive, non-blocking,
degrades to no-op if the field name assumption is wrong).

---

## 6. Sequencing

1. **(d) guideline docs first** — (e)'s model-verify and every hygiene rule in (b) need a written
   policy to check against; this is the cheapest, lowest-risk item and unblocks the rest.
2. **(e) response-time model-verify** — pure win, no new risk surface (log-only, never blocks),
   directly automates an existing manual BOSS.md discipline.
3. **(c) session miner** — report-only, same proven-safe shape as `dream.py`; can ship independent
   of everything else.
4. **(b) file cleanser**, narrow scope first (named `_archive-*`/`backup-*` dirs only) — dry-run
   proves the pattern before widening the rule set.
5. **(a) keep-on loop last** — highest risk (unbounded forced-continuation), and benefits from (d)
   existing (the guideline doc informs what "done" means for the closing-file checklist) and from
   coordinating with `context-lifecycle.md`'s Component A/B landing first, since keep-on's
   "auto-refreshes context" half is meant to consume that, not duplicate it.

---

## 7. Open design questions for Daniel

1. **Keep-on's "closing .md"** — reuse an existing file type (`contract.md` / `STATE.md` /
   active `handoffs/*.md`) or does he want a genuinely new dedicated closing-instructions file
   per project? And should the lease survive a crash/new session, or is session-scoped-only
   (my default, safer) correct?
2. **Model-verify's tier plumbing** — is it acceptable that request-time enforcement only catches
   invalid model strings (not wrong-tier-for-task) until dispatch prompts are required to carry an
   explicit routing key? Or is that plumbing worth doing now as part of (d)?
3. **File-cleanser apply authority** — should apply-mode ever run unattended (even for the
   narrowest `_archive-*` category), or does every sweep's apply step permanently require a human
   gate, unlike `dream.py`'s design which anticipates a future trusted-cadence apply path?
4. **Miner cadence and volume** — nightly for every agent's sessions, or only for sessions
   delivery-gate already flagged as warned? The latter is cheaper and targets exactly the lost-lesson
   case; the former catches more but costs more and risks noisy/low-signal proposals.

---

## Load-bearing assumptions flagged for the capability-probe reconciliation

- **`SubagentStart`/`SubagentStop` fire per-subagent** — **VERIFIED**, not an assumption: this
  exact kb install's own merged, shipped `~/.claude/settings.json` wiring proves it in production
  (PR #119). Strongest possible evidence; not blocked on the probe.
- **The exact field name for injecting context at `SubagentStart`** — disagreement between my
  fetch (`expandedInitializationPrompt`) and the sibling's (`additionalContext`). **[ASSUMPTION —
  verify before wiring `subagent_governance_inject.js`'s output field.]**
- **The `PreToolUse` matcher string for the subagent-dispatch tool in this harness** (`Task` per
  historical docs vs. `Agent` per this session's own tool list). **[ASSUMPTION — verify empirically
  before wiring `model_policy_guard.js`; fail-open by default so a wrong matcher is silently inert,
  not silently broken.]**
- **`Stop` hook forced-continuation has no documented platform-level iteration cap.** Treated as
  fact for design purposes (absence of a documented cap ≠ a cap exists) — the keep-on loop's own
  numeric/time cap is therefore mandatory, not a hardening afterthought.
- **`$CLAUDE_SESSION_ID`-style shell interpolation in a hook command string** — the keep-awake
  build log itself flagged this as unconfirmed and recommended reading `session_id` from the JSON
  stdin payload instead. Carried forward as the safer default for every new hook here.

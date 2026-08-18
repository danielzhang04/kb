# Proposal: spawn context-load + model-verify hooks — SubagentStart + PreToolUse-on-dispatch (Agent|Task) + SubagentStop (for Daniel to arm, if ever)

**Status:** PROPOSAL — inert, NOT wired into any live settings file.
**Built:** 2026-08-18, Agent Platform Wave 1, unit U9. Code:
`scripts/hooks/lib/hook_io.js`, `scripts/hooks/lib/model_audit.js`,
`scripts/hooks/subagent_context_load.js`, `scripts/hooks/model_verify_pretooluse.js`,
`scripts/hooks/model_verify_subagentstop.js`.
Dashboard: `dashboard/server/modelAudit/routes.ts`,
`dashboard/src/views/agentPlatform/panels/ModelAudit.panel.tsx`.
Tests: `tests/test_hook_io.py`, `tests/test_subagent_context_load.py`, `tests/test_model_verify.py`,
`dashboard/server/modelAudit/routes.test.ts`,
`dashboard/src/views/agentPlatform/panels/ModelAudit.panel.test.tsx`.
Nothing in `.claude/settings.json`, `.claude/settings.local.json`, or `governance/**` was touched —
`test_the_u9_hook_family_is_inert` asserts that against git.

## What it does

Three hooks, two independent jobs.

**1. A spawned subagent inherits the parent's governing context** (`SubagentStart`).
A subagent starts blind: it gets the dispatch prompt and nothing else — not the north star, not the
invariants, not which gate the run is sitting on. Every brief re-states the frame by hand, and a brief
that forgets to is a subagent working against the wrong picture. `subagent_context_load.js` reads the
U8 context store for the session and injects `## North star`, `## Invariants`, and `## Current gate`
as `additionalContext`, behind the same stale-replay guard the re-grounding hook uses.

It deliberately does **not** inject `## Recent activity` (the redacted tool ring buffer) or
`## Resumed-session summary` (the parent's compaction recall). A subagent prompt is a wider blast
radius than the parent's own store: the activity trail is best-effort redacted, not provably clean,
and the parent's last turns are noise to a child with a specific brief. Governing frame, nothing else.

**2. Every dispatch's model is written down, requested and observed** (`PreToolUse`
on-dispatch — matching `Agent` or its alias `Task` — then `SubagentStop`).
BOSS.md already requires this: *"The model of EVERY subagent you deploy is verified at GRADING, never
assumed from the dispatch arg … an ungrepped grade is invalid."* That check is manual, easy to skip,
and only ever happens after the fact — and the requested half of the comparison lives only in a
dispatch call that nothing writes down. `model_verify_pretooluse.js` records the ask (and whether the
model is in `governance/model-routing.yaml`); `model_verify_subagentstop.js` greps the finished
subagent's own transcript for `"model":` and records what actually ran. Both append to one JSONL log.

**Neither model hook ever blocks.** `PreToolUse` is the event that *can* deny a tool call, which is
exactly why this one never does: a hook that refuses a spawn because a model string looked unfamiliar
turns a bookkeeping check into a way to break dispatch — and the policy it would be enforcing is only
a default (card frontmatter and `queue/routing-override.yaml` both outrank
`governance/model-routing.yaml`). Report, never refuse. `test_neither_hook_ever_exits_nonzero` pins it.

The subagent block opens with its **own** guard sentence, not the re-grounding one: *"[kb spawn
context] The following is inherited from the parent session's governing context, NOT instructions for
this task."* The session guard says "context this session already has", which is simply false for a
freshly spawned child — telling a subagent it already holds context it has never seen is the exact
confusion a guard exists to prevent.

**Also in this unit: `scripts/hooks/lib/hook_io.js`.** Four hooks each carried a byte-identical ~30-line
block of stdin/stdout boilerplate; two reviews called it out. It is now one file: those four existing
hooks (`regrounding_hook.js` plus the three `context_lifecycle_*.js`) were refactored onto it with
**zero changes to their tests** — their suites are the regression gate and pass unmodified — and this
unit's own three new hooks (`subagent_context_load.js`, `model_verify_pretooluse.js`,
`model_verify_subagentstop.js`) were written directly against it instead of repeating the block a
fifth, sixth, and seventh time. Seven consumers share the library today. The same
extraction also absorbed the other duplicated pieces now that every consumer is in-unit: `truncateTo` +
`ELLIPSIS` (was 3 copies), the stale-replay `GUARD_LINE` (was 2, in `regrounding_hook.js` and
`lib/context_store.js` — both now re-export it, so `store.GUARD_LINE` is unchanged for callers), and
`MAX_TRANSCRIPT_BYTES` + the guarded `statSync`/`readFileSync` read (was 2, now `io.readCappedFile`).

## The change

Add three entries to the `hooks` object in `.claude/settings.json`. They MERGE with what is already
there and with U7's and U8's proposed entries — `SessionStart`, `PreCompact`, `PostToolUse`, and
`UserPromptSubmit` are separate keys that coexist, and `PreToolUse` **keeps its existing array**, with
the model-verify entry appended to it:

```json
"SubagentStart": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/subagent_context_load.js\""
      }
    ]
  }
],
"PreToolUse": [
  {
    "matcher": "Agent|Task",
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/model_verify_pretooluse.js\""
      }
    ]
  }
],
"SubagentStop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"C:/Users/danie/kb/scripts/hooks/model_verify_subagentstop.js\""
      }
    ]
  }
]
```

**`"matcher": "Agent|Task"` — both names, and the order matters less than the presence of `Agent`.**
Matchers are regexes, so this is one alternation, not two entries. `Agent` is the canonical tool name
and `Task` is only a registered alias (decision-note below); a matcher of just `"Task"` would fire on
nothing and the hook would look perfectly healthy while recording an empty log forever. The hook checks
`tool_name` against both names itself as well, so a missing matcher costs performance rather than
correctness — but a *wrong* matcher costs everything, which is what arm-time Check 3 exists for.

The absolute paths are load-bearing: hooks run with an unpredictable cwd, and every existing kb hook is
registered by absolute path. Do not relativize them.

**`PreToolUse` almost certainly already has entries** (`block_no_verify.js`, `hard_ceiling_guard.js`,
`config_protection.js` live on that event). Append a new object to the existing array; do not replace
it. That is the one merge in this snippet that can silently disarm something else.

### `SubagentStart` and `SubagentStop` are ALREADY WIRED at user scope — do not "replace" them

`~/.claude/settings.json` (user scope, outside this repo) already registers **both** of these events:

```
SessionStart, UserPromptSubmit, PreToolUse (matcher "*"), PostToolUse (matcher "*"),
SubagentStart, SubagentStop, SessionEnd   →  scripts/keep_awake.ps1  (async: true)
```

**Hook arrays MERGE across settings scopes** (user → project → local); a project-scope entry does not
shadow or replace the user-scope one, they both run. So adding the entries above to
`.claude/settings.json` gives `SubagentStart` two hooks and `SubagentStop` two hooks, which is fine and
intended — but three things follow:

1. **Do not "fix" a perceived conflict by editing `~/.claude/settings.json`.** Keep-awake is load-bearing
   for overnight runs. Nothing in this proposal touches user scope.
2. **The keep-awake hooks are `async: true`; these are not.** A synchronous hook on `SubagentStart` sits
   in the spawn path. All three hooks here are file-I/O only with hard size caps, but that is the
   latency budget being spent.
3. `PreToolUse` at user scope uses `matcher: "*"`, so keep-awake already fires on every tool call; the
   `Agent|Task` matcher here narrows only *this* hook, not that one.

Arm them **independently if you like** — the three are unrelated. `SubagentStart` alone is
inert-but-harmless (it finds no governing sections in today's stores and emits `{}`; see the U8 note
below). The two model hooks are useful separately: PreToolUse alone records what was asked for,
SubagentStop alone records what ran, and only the pair produces a `match`/`mismatch` verdict.

Emitted shapes:

```json
{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"…"}}
```

for `SubagentStart`; a bare `{}` for both model hooks, whose entire value is the append side effect.
Every unhappy path (no stdin, malformed stdin, missing session id, missing store, missing or
unreadable transcript, unreadable routing policy, unwritable log, any thrown error) emits `{}` with
exit 0 and empty stderr — fail open, silent, same as `delivery_gate.js` and `regrounding_hook.js`.

## Why

- **The dispatch prompt is not a frame.** BOSS.md requires every dispatch to name files, norms, and
  acceptance criteria; nothing makes it carry the north star, and nothing can make a brief that forgot
  it recover. A hook is the only place that context can arrive unconditionally.
- **The grading grep is the right check in the wrong place.** It is correct and it is manual. Moving
  the evidence-gathering into a hook leaves the *judgment* with the human — the log says what happened,
  it does not decide what to do about it.
- **A mismatch is otherwise invisible.** "Asked for opus, ran on haiku" is a silent quality failure:
  the work comes back, it is just worse than it should be. Nothing in the current loop surfaces it
  except a grader who remembers to grep.
- **Zero spend, no subprocess.** Every hook here is deterministic file I/O.
  `test_neither_hook_nor_the_audit_library_makes_a_subprocess_call` pins it.

## How to arm

1. **Precondition — arm only after this branch merges to `main`.** All the
   `C:/Users/danie/kb/scripts/hooks/` files above (plus `lib/hook_io.js`, `lib/model_audit.js`, and
   U8's `lib/context_store.js`) must exist in the main checkout. Arming while they live only on
   `claude/agent-platform-w1` means `node` "Cannot find module" stderr noise on every spawn and every
   Task call.
2. **U8 first, if you want the SubagentStart hook to do anything.** It reads the U8 context store, and
   nothing writes `## North star` / `## Invariants` / `## Current gate` today — see the decision-note
   below. Armed on its own it is a correctly-working no-op.
3. **Do the three arm-time empirical checks below** (they take one spawn each).
4. **Arming inverts the inert-guard tests — retarget them in the same edit.** These
   currently-green assertions exist to prove this family is NOT armed, and go red the moment
   any of it is: `tests/test_context_lifecycle_inert.py::test_no_hook_is_registered_in_any_settings_file`,
   `tests/test_context_lifecycle_inert.py::test_no_live_settings_were_touched`, and
   `tests/test_model_verify.py::test_the_u9_hook_family_is_inert`. That is correct — they
   are inert guards, not general regression tests — but leaving them red afterward is not:
   retarget each one, in the same edit that changes `.claude/settings.json`, to assert the
   relevant hooks are registered **exactly once, at the committed path**, rather than not
   registered at all.
5. Append the snippet to `.claude/settings.json` — merging into the existing `PreToolUse` array, not
   replacing it. (Human edit: hooks config is Daniel's to change.)
6. Restart the Claude Code session. Hooks load at session start.
7. Confirm: dispatch one subagent, then check that
   `%LOCALAPPDATA%\kb-context-lifecycle\model-audit.jsonl` has a `PreToolUse` row and a `SubagentStop`
   row for it. The **Model Audit** panel in the dashboard's Agent Platform section shows the same thing.

### The three arm-time checks

Both questions below were answered by reading the installed harness's own code (evidence in the
decision-notes). Reading a binary is strong evidence but it is not a live run, and both answers are
version-specific — Claude Code updates itself. So confirm them once, on the machine, at arm time:

**Check 1 — the injection actually lands.** With `SubagentStart` armed and
`KB_CONTEXT_STORE_DIR` pointed at a scratch dir holding a store with a distinctive
`## North star` line, spawn a trivial subagent (`Explore`, "say the north star back to me"). If it
echoes the sentence, the shape is right. If it does not, the field name changed and the hook needs one
edit at `io.emitContext(...)` in `subagent_context_load.js` — nothing else.

**Check 2 — which session's store.** The same spawn answers it: the store the hook read is the one
whose id the payload carried. If the echo works with only the PARENT session's store seeded, the
verified reading holds.

**Check 3 — the matcher actually fires.** This is the one that catches the failure that looks like
success. With the `PreToolUse` entry armed, dispatch **one** subagent, then check the audit log has a
`PreToolUse` row for it:

```powershell
Get-Content "$env:LOCALAPPDATA\kb-context-lifecycle\model-audit.jsonl" -Tail 5
```

No row means the matcher did not fire — check it reads `Agent|Task` and that the entry was appended to
the existing `PreToolUse` array rather than nested wrongly. **An empty log is indistinguishable from a
healthy inert one, so this check is not optional.** A `SubagentStop` row without a matching
`PreToolUse` row is the same symptom.

Do these in a **scratch profile / throwaway store dir**, not against live session state.

## How to disarm

1. Delete the `"SubagentStart"` and `"SubagentStop"` keys from `.claude/settings.json`, and remove
   **only** the model-verify object from the `"PreToolUse"` array — the other entries on that event are
   live safety hooks and must stay.
2. Restart the session.
3. Optionally delete `model-audit.jsonl` (or whatever `KB_MODEL_AUDIT_PATH` pointed at). It is the only
   state this family creates; nothing lives in the repo.

Deleting the scripts while they are still registered would leave `node` failing on every dispatch call, so
remove the settings entries first.

## Verification

```
py -3 -m pytest tests/test_hook_io.py tests/test_subagent_context_load.py tests/test_model_verify.py -v
py -3 -m pytest tests/test_regrounding_hook.py tests/test_context_store.py tests/test_context_lifecycle_*.py -q
cd dashboard && npx.cmd vitest run server/modelAudit src/views/agentPlatform/panels/ModelAudit.panel.test.tsx
```

The second line is the load-bearing one for the refactor: those are the five refactored hooks' own
suites, **unmodified**, and they are what proves the extraction did not change any hook's behaviour on
the wire.

What the suites pin, beyond the happy paths: the shared library fails open on every malformed input and
is deliberately lenient about a MISSING event name (the exact leniency the hand-rolled copies had);
`emit`/`noop` never return, so the `if (bad) { noop(); }` idiom with no `return` is safe; no refactored
hook still carries its own `fs.writeSync(1` block; the injected block excludes the activity trail and
the parent summary; the cap holds and an unsafe session id never reaches the filesystem; the audit
parser is pinned against the **committed** `governance/model-routing.yaml`, so a reformat there fails a
test rather than quietly degrading the audit; an unknown model is flagged and never blocked; no
transcript content reaches the audit log; rows are byte-identical run to run and carry no timestamp;
neither hook ever exits nonzero, over every input in the file; no `child_process` and no dynamic
`require` anywhere in the family; the dashboard route's fixture is regenerated by the hooks themselves
and compared byte for byte; and `.claude/**` and `governance/**` are untouched.

Manual smoke test (PowerShell, from the repo root — writes to a throwaway log, touches nothing live):

```powershell
$env:KB_MODEL_AUDIT_PATH = "$env:TEMP\model-audit-smoke.jsonl"
'{"hook_event_name":"PreToolUse","session_id":"smoke","tool_name":"Task","tool_input":{"subagent_type":"Explore","model":"opus","description":"probe"}}' | node scripts/hooks/model_verify_pretooluse.js
'{"hook_event_name":"PreToolUse","session_id":"smoke","tool_name":"Task","tool_input":{"subagent_type":"Explore","model":"gpt-9-imaginary","description":"probe"}}' | node scripts/hooks/model_verify_pretooluse.js
Get-Content $env:KB_MODEL_AUDIT_PATH
Remove-Item $env:KB_MODEL_AUDIT_PATH; Remove-Item Env:\KB_MODEL_AUDIT_PATH
```

(Both lines print `{}` — correct. The first row's verdict is `allowed`, the second `unknown`, and
neither call was refused.)

## Decision-notes

### The SubagentStart output field — RESOLVED EMPIRICALLY, not by documentation

Two doc fetches disagreed on what a `SubagentStart` hook must emit: `additionalContext` nested under
`hookSpecificOutput`, versus a `context` field, versus a top-level `additionalContext`. The dispatch
brief asked for the documented-primary shape plus a note recording the ambiguity. **The ambiguity is
resolved instead**, against the installed harness rather than against any document.

Evidence — Claude Code **2.1.234**, `C:\Users\danie\.local\bin\claude.exe` (a single-file bun-compiled
binary; the strings below are from its embedded minified bundle):

- The output schema (`ye` = `z.object`, `Ct` = `z.literal`, `F` = `z.string`):
  `ye({hookEventName:Ct("SubagentStart"),additionalContext:F().optional()})`
- The consumer:
  `case"SubagentStart":u.additionalContext=e.hookSpecificOutput.additionalContext;break;`
- The injection: `{type:"hook_additional_context",…,hookName:"SubagentStart",hookEvent:"SubagentStart"}`
- The embedded help text: *"Input to command is JSON with agent_id and agent_type / Exit code 0 - JSON
  additionalContext shown to subagent"*

Neither a top-level `additionalContext` nor a `context` field appears anywhere near the 26
`SubagentStart` occurrences in the bundle. So the shape this hook emits is the verified one **and** the
documented-primary one — they agree.

**The residual risk is version drift, not ambiguity.** This is one binary at one version, and hooks are
a moving surface. That is what arm-time Check 1 above is for; it costs one spawn.

### Which `session_id` a SubagentStart payload carries — RESOLVED, and it is the parent's

U8's review flagged this as unknown. Same source, same standard. The harness builds the SubagentStart
input from the subagent's `AgentContext` as
`{..._y(e.session, …), hook_event_name:"SubagentStart", agent_id:t, agent_type:r}`, and the common field
builder `_y` sets `session_id: e.id` from that session — which is the **parent's**, because a subagent
shares the parent's `Session` object rather than getting its own. The child is distinguished by the
separate `agent_id` / `agent_type` fields, and the harness's own schema says so in as many words:
*"Subagent identifier. Present only when the hook fires from within a subagent… Use this field (not
agent_type) to distinguish subagent calls from main-thread calls."*

This is the answer the hook wants: the parent's working context is exactly what the child is missing,
so reading the store by `session_id` is **correct**, not merely convenient. Confirmed at arm time by
Check 2.

(Bonus, same source: `SubagentStop` carries `agent_id` and `agent_type` as **required** fields, plus a
distinct `agent_transcript_path` — the subagent's own transcript — alongside the base `transcript_path`,
which stays the parent's. `model_verify_subagentstop.js` prefers `agent_transcript_path` and falls back
to `transcript_path` accordingly.)

### The dispatch tool is `Agent`; `Task` is an alias (harness 2.1.234)

Recorded here so nobody re-derives it. The bundle declares:

```
var q_="REPL";var di="Agent",Dj="Task",F3o=1e5,gSd;var Dg=A(()=>{gSd=new Set(["Explore","Plan"])})
…name:di,searchHint:"delegate work to a subagent",aliases:[Dj],maxResultSizeChars:F3o…
```

So the tool registers as `name: "Agent"` with `aliases: ["Task"]`. Real transcripts agree: across a
12-file sweep of `~/.claude/projects/C--Users-danie-kb/`, every dispatch `tool_use` block is named
`"Agent"` (80 in that sample; the wider sweep found 1141) and **none** is named `"Task"`.

This mattered. The first cut of this unit watched `"Task"` only — the name the documentation leads with
— which would have produced a permanently empty audit log that looked exactly like a correctly inert
one. The hook now accepts both names, the matcher covers both, and the row records **the name the
harness actually sent** rather than a normalised constant, so a future rename shows up in the data
instead of vanishing.

### Rows carry no timestamp

No hook event in this family supplies a clock, and `Date.now()` is deliberately not called. A hook whose
output varies run to run cannot be tested byte-for-byte, and byte-for-byte testability is the entire
reason to trust an automated audit over a manual grep. Rows are therefore **ordered but not stamped**,
and the dashboard reports the audit FILE's mtime once for the whole log rather than faking a per-row
time.

**Open:** if per-row timing ever matters (it does not for "which model ran"), the honest fix is a
monotonic counter written by the hook, or a wrapper that stamps rows outside the hook — not a clock
inside it.

### The observed model is read structurally, because a raw grep can be fooled by file contents

BOSS.md says to grep the subagent transcript for `"model":`. That is the right instinct and the wrong
primitive to compute a verdict from: **a transcript contains model ids that are merely CONTENT.** A
subagent that read `~/.claude/settings.json`, quoted `governance/model-routing.yaml`, or discussed a
model id has `"model": "…"` strings in its transcript — and any of them can appear *before* the
subagent's own first reply. A text-first verdict would then report a confident `match` for a model that
never ran.

So the row carries two different claims, and only one of them is a verdict input:

- **`observed_model`** — the model that answered **first**, read structurally: parse each JSONL record,
  take `message.model` off the first record whose `type` is `"assistant"`. Verified against real
  transcripts: assistant records carry the id at `message.model` and nowhere else at top level. This is
  what BOSS.md's rule is actually about — which model served the turns — and it is what `verdict`
  compares against.
- **`observed_models`** — every distinct model id the transcript *mentions*, first-seen order, from the
  literal raw-text grep. Kept because it is the one thing that surfaces a **model switch mid-run**,
  which the first response cannot show. Never a verdict input.

`test_the_verdict_uses_the_first_RESPONDING_model_not_any_mentioned_string` pins exactly this: a haiku
run that quotes `"model": "claude-opus-5"` in a tool result before answering, against a request for
opus, must report `mismatch` — the text-grep answer would have been a false `match`.

A transcript with mentions but no assistant model is `unverified`, not `match`. Nothing that cannot be
attested is asserted.

### Pairing a stop row to its dispatch is a heuristic, and the row says so

There is no dispatch id shared between the `PreToolUse` row and the `SubagentStop` event: a top-level
Task call carries no `agent_id` (that field is present only when a *subagent* is dispatching). The two
can therefore only be matched on `session_id` + (`subagent_type` == `agent_type`), taking the most
recent match. With one dispatch of a given agent type in flight that is exact; **with several concurrent
dispatches of the same type in the same session it can pair the wrong two** — and on this machine that
happens routinely.

Rows record `pairing: "heuristic"` whenever a requested model was found this way, and the panel prints
it. A `mismatch` is therefore a **look at this**, never proof on its own. The real fix would be a
correlation id the harness does not currently expose; until it does, the honest move is to label the
uncertainty rather than hide it.

### The routing check reads YAML with a hand-rolled scan

Hooks take no dependencies — they run on whatever `node` the harness has, with no install step — so
there is no YAML parser available. `lib/model_audit.js` reads the two shapes it needs (flow-style
`known_models: [...]`, and two-space-nested `aliases:` maps) off the lines rather than parsing the
document. A block-style rewrite of `governance/model-routing.yaml` would silently defeat it.

Two things make that acceptable: the failure mode is benign (an unrecognised model is reported
`unknown`, never blocked), and `test_the_parser_reads_the_committed_governance_file` pins the parse
against the **real committed file**, so a reformat fails a test instead of quietly degrading the audit.

Aliases and their targets are both treated as allowed: a dispatch prompt writes `opus`, a card may
write `claude-opus-5`, and the routing file treats them as the same request. The `match` comparison is
likewise substring-based, because a dispatch names an alias while a transcript records a full id
(`claude-opus-5[1m]`).

### The SubagentStart hook has nothing to inject today

Same shape as U8's own caveat, and it is worth restating because it decides whether arming hook 1 is
worth anything. Of the five store headings, only `## Resumed-session summary` (PreCompact) and
`## Recent activity` (PostToolUse) have a writer — and this hook injects **neither**. So on today's
code, `subagent_context_load.js` armed against a live store finds nothing and emits `{}`, correctly.

It becomes useful the moment something authors `## North star` / `## Invariants` / `## Current gate` —
a human editing a store by hand, a per-run setup step, or a future writer. **Deciding what should
author a north star, and when, is the open question** (U8 raised it too), and it is a bigger call than
this unit: it is the difference between a context store that mirrors a session and one that governs it.

### Why the audit log is not in the repo

`KB_MODEL_AUDIT_PATH`, else `<context-store dir>/model-audit.jsonl` — the same repo-external root the
U8 stores use (`%LOCALAPPDATA%\kb-context-lifecycle` by default). Following the `DASHBOARD_STATE_ROOT`
precedent in `.gitignore`: hook-written per-session state is daemon-local, never coordination truth. In
the repo it would be a merge-conflict generator across worktrees and would put a hook-written file
inside the tree the delivery gate watches.

**Retention is deferred, exactly as it is for U8's stores.** The log is append-only and unbounded; the
route caps what it *ships* to 500 rows but nothing caps the file. Rows are low-sensitivity by
construction (no transcript content, no tool input beyond a truncated `description`), so the privacy
surface is much smaller than U8's activity buffer — but "small" is not "none", and a rotation policy is
a pre-arming decision if this ever runs fleet-wide.

### What was NOT built

- **Blocking on a policy violation.** Discussed above; the whole family is report-only by design.
- **Reading `queue/routing-override.yaml` or card frontmatter.** Both outrank
  `governance/model-routing.yaml`, so an `unknown` verdict is genuinely "not in the standing policy",
  not "not allowed". Teaching the hook the full precedence chain would mean re-implementing
  `scripts/routing.py:resolve()` inside a hook, in JavaScript, with no tests shared between them. The
  verdict vocabulary is deliberately weak enough to be honest about what it checked.
- **Cross-agent context sharing.** A subagent inherits from its parent's store and writes nothing back.
  Fleet-wide shared context is a much larger design question with a real bleed risk — U8 declined ECC's
  cross-session lookup for the same reason.

# Inbox gates — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task-by-task. Each task is independently
> implementable and reviewable by a fresh agent. Steps use checkbox (`- [ ]`) syntax.

**Binding design:** `docs/specs/2026-07-20-inbox-gates-design.md` (approved by Daniel 2026-07-20).
**Goal:** Surface every human gate in the Inbox, clear a merge gate on real resolution, and never hang
a reply silently — closing the six coverage/consumption gaps from the 2026-07-20 inbox audit (G1–G4).

**Branch / worktree:** work products on `claude/inbox-gates`, worktree
`C:\Users\danie\kb-worktrees\inbox-gates` (off `main`). This plan does NOT push and does NOT restart the
live daemon — deploy = Daniel merges, then he triggers a deliberate daemon restart. Coordination writes
(any real `queue/` card) still route to `ops` per CLAUDE.md; the code paths below all reuse the existing
`withOpsTransaction` + `commitPreparedCoordination` discipline and never invent a new git path.

**Constraints (hard):**
- `gh` via ambient auth ONLY — never read, print, copy, or persist the credential; a `gh` read is a
  subprocess whose stdout we parse. `gh` absent/erroring must leave a gate card OPEN (fail toward
  surfacing), never silently closed.
- Every ops write flows through the existing transaction path (`withOpsTransaction`,
  `commitPreparedCoordination`, one audit row), never a hand-rolled `git add`/frontmatter write.
- No daemon restart in this wave. New pollers are wired but only run after Daniel's restart.
- `governance/` and `CLAUDE.md` are human-edited only.

**Tech / test runners (verified):**
- Python: no `pytest.ini`/`pyproject`; root `conftest.py` puts `scripts/` on `sys.path`. Tests in
  `tests/`. Run: `python -m pytest tests/<file> -q` (repo root). Deps: `pyyaml>=6`, `pytest>=8`.
- Vitest: from `dashboard/`, `npm test` (→ `vitest run`) or a single file
  `npx vitest run <path/to/file.test.ts>`. Node 24 runs `.ts` natively; no build step for the server.

---

## Decisions needed (resolve before/at implementation — do not silently guess)

1. **Stranded age source.** The Plane-A indexer exposes neither file mtime nor a `created` field on
   `ParsedCard` (`dashboard/server/planeA/cards.ts` yields only `{meta, body}`). The card `id` carries an
   8-hex-digit unix-epoch prefix (`cards.new_id` = `f"{int(time.time()):08x}-..."`; verified on live
   cards, e.g. `6a5b178f-...` = epoch 1784354703). `scripts/brief.py::_card_age` already derives age this
   way. **Recommendation:** derive stranded age purely from the id epoch prefix (keeps `classify()` pure
   and fixture-testable), and when the id does NOT match `^[0-9a-f]{8}-` treat age as unknown and DO NOT
   classify the card as stranded (advisory low-urgency category — a false stranded is noise, so skip
   rather than surface). This also keeps the existing "ordinary inbox work" test green (its fixture ids
   are non-hex). Confirm this over extending the indexer to expose mtime.

2. **Reconciler enablement + interval.** Design says "existing dashboard config conventions; no new env
   semantics." **Recommendation:** read `DASHBOARD_MERGE_GATE_INTERVAL_MS` (default `300000`), poller
   no-ops when the value is `<= 0`; start it in `buildApp()`. Open question: on-by-default (fail-safe,
   since every reconciler failure leaves cards OPEN) vs. gated behind an explicit enable flag. Recommend
   on-by-default with a sane interval.

3. **STOP-synthetic refresh latency.** The chokidar watcher (`indexer.ts` targets: `queue, ledgers,
   dashboards, orgs, skills, memory`) does NOT watch the repo-root `STOP` file (it is deliberately
   uncommitted/local — see `stop/floor.ts`). `/api/human-inbox` calls `indexRepo` fresh per request and
   the UI refetches on every SSE tick, so the STOP item appears/clears on the next projection fetch (any
   card change, or manual refresh), not instantly on the `STOP` write. **Recommendation:** accept
   next-tick refresh (minimal, and the STOP item is critical-urgency so it dominates once shown). Option:
   add the `STOP` path to the watch targets. Confirm which.

4. **Shared-fixture category vocabulary (G4).** `brief.py` today emits presentation "kind" labels
   (`approval` / `wake-me` / `human-gate`); the dashboard emits `category`
   (`decision`/`gate`/`input`/`intervention`/`stranded`). The shared fixture's `expected` must be ONE
   canonical vocabulary consumed by both. **Recommendation:** make the dashboard `category` set canonical;
   add a `classify_category(card, stop_present)` to `brief.py` returning that set (its rendered "kind"
   text may stay as a display mapping). Confirm before writing T7.

5. **Branch-only merge gates.** The `agent_runner.ps1` push path hands a *branch* to a human (it never
   opens a PR — trust-anchor invariant), so its gate target is a branch name with no PR number. The
   reconciler (T4) can only `gh pr view <n>` a PR-number target; a branch-only gate therefore stays a
   surfaced Gate until a human merges and closes it (manual `merge_gate.py close`, or it simply persists).
   **Recommendation:** accept this as "fail toward surfacing"; a future `git branch --merged origin/ops`
   check could auto-close branch gates. Confirm this is acceptable for the wave.

## Decisions (RESOLVED 2026-07-20 — boss terminal)

The five open questions above are resolved as follows (binding on all tasks):

1. **DECIDED** — Stranded age derives from the card-id 8-hex epoch prefix; a
   non-matching id → age unknown → NOT stranded (keeps `classify()` pure; a false
   stranded is noise). Do not preclude T3's later work here.
2. **DECIDED** — Merge-gate reconciler is on-by-default; `DASHBOARD_MERGE_GATE_INTERVAL_MS`
   defaults to `300000`; a value `<= 0` disables it (fail-safe: every reconciler
   failure leaves cards OPEN).
3. **DECIDED** — The repo-root `STOP` file path is ADDED to the chokidar watch
   targets so the synthetic STOP item surfaces immediately (overrides the
   "accept next-tick refresh" recommendation).
4. **DECIDED** — The shared parity fixture vocabulary is the dashboard `category`
   set (`decision`/`gate`/`input`/`intervention`/`stranded`); `brief.py` gains
   `classify_category` returning that set (its rendered "kind" text stays a display
   mapping).
5. **DECIDED** — Branch-only merge gates persist until a manual `merge_gate.py close`
   — accepted as fail-toward-surfacing (the reconciler only `gh pr view`s PR-number
   targets).

---

## Grounding notes carried into the tasks (verify-don't-trust results)

- **Stop-ladder already reaches the projection.** `cards.py STATE_DIR` maps `stop-requested`/`halting`/
  `halted` → physical `working/` and `blocked` → `inbox/`. The indexer scans `inbox/working/approvals/
  done` and `projectHumanInbox` flattens ALL buckets, so those cards already reach `classify()`. **No
  indexer change is needed for T3** — the fix is `classify()` predicates only.
- **Merge-gate cards already surface.** A card `action: approve:merge:<n>`, `owner: human-operator`,
  `state: inbox` matches `isHumanGate` (predicate #4) → category `gate`. So G1 producers only need to
  FILE the card; surfacing is already covered. The reconciler is what's new.
- **The reconciler cannot reuse `respondToCard` directly.** `planResponse` authorizes `resolve` only for
  wake-me/blocked/halted and `reply` only for input — a merge card is none of these. T4 extracts the
  `CARD_RESPOND_SCRIPT` executor so the reconciler runs its own plan (`section: Result`,
  `transitions: ['working','done']`) over the SAME python payload. `working` requires an owner; merge-gate
  cards are owned by `human-operator`, so the walk is legal.
- **`brief.py` scans by directory name.** `_iter_cards(repo_root, state)` globs `queue/<state>/*.md`, so
  `_iter_cards('halted')` reads a NON-EXISTENT `queue/halted/`. G4 must scan the physical dirs and filter
  by parsed `state`, not add eponymous-dir scans (the N1 lesson, Python side).
- **`gh` is already shelled** in `dashboard/server/write/asyncGit.ts` via `runTrackedProcess('gh', ...)`
  for `gh pr create` (ambient auth). The reconciler's `gh pr view` is a READ; model it as an injected
  runner for hermetic vitest.
- **`taskForOwner`** (`dashboard/server/runner/trigger.ts`) is a closed owner→scheduled-task map
  (`codex-worker` → `kb-codex-runner`); reuse it for G3 liveness via `schtasks /Query` (not `/Run`).
- **`execution-controller: dashboard`** is a real card meta field — G3 liveness branch (a).
- **Client default-counts bug confirmed:** `approvalsClient.fetchHumanInbox` default omits `gate` (and
  will need `stranded`).
- **Panel path correction:** `dashboard/src/control/HumanRequestsPanel.tsx` (design said
  `views/control/`).

---

### Task T1 — `scripts/merge_gate.py` (`file` / `close`) + pytest

**Goal:** One authority for registering/closing a merge gate as a card, dedup-safe on parsed state.

**Files:**
- Create `scripts/merge_gate.py` exporting importable functions AND a CLI:
  - `file(queue_root, *, target, repo, branch, pr_url=None, unblocks, risk_tier="T2", owner="human-operator", now=None) -> cards.Card` — returns the EXISTING live card if a dup is found (no new file), else mints + saves a new one.
  - `close(queue_root, *, target, result) -> cards.Card | None` — finds the live gate for `target`, appends `## Result`, walks it to `done`; returns `None` if no live gate.
  - `LIVE_STATES` constant = `cards.STATES` minus `{"done", "rejected", "halted"}`.
  - `find_live(queue_root, target) -> cards.Card | None` — the dedup predicate (below).
  - `main(argv=None) -> int` — `argparse` subcommands `file` and `close`.
- Create `tests/test_merge_gate.py`.

**Interfaces / how it must work:**
- Card shape: `cards.new_card(project="kb", action=f"approve:merge:{target}", target=target, risk_tier=risk_tier, body=<work order>, owner=owner)` then `cards.save(card, Path(queue_root))`. `new_card(**extra)` threads `owner` into frontmatter before `_validate`. Body `## Work order` names `repo`, `branch`, `pr_url`, and what merging unblocks (`unblocks`). Action `approve:merge:<target>` needs NO schema registration (card-schema `action` is free-form verb-phrase).
- **Dedup (N1 lesson — parse state, not directory):** `find_live` globs `queue/**/*.md`, `cards.parse`s each (skip unparseable), and matches `card.meta["action"] == f"approve:merge:{target}"` AND `card.meta.get("state") in LIVE_STATES`. `file()` returns that card unchanged when found. Key on `action`+`target` only.
- `close()`: `card = find_live(...)`; append `## Result` (mirror `cardRespond`'s section-append semantics — create the section if absent); then `cards.transition(card, "working", qr)` (owner is `human-operator`, so legal) → `cards.transition(card, "done", qr)`.

**Test FIRST — `tests/test_merge_gate.py`** (mirror `tests/test_brief.py` helpers: a `_repo(tmp_path)` that makes `queue/{inbox,working,approvals,done}`):
- `test_file_creates_gate_card` — one card lands in `queue/inbox/`, `action == "approve:merge:42"`, `owner == "human-operator"`, state `inbox`, body names repo/branch/pr/unblocks.
- `test_file_dedups_on_live_state` — calling `file` twice for the same target yields ONE card (second returns the first).
- `test_dedup_keys_on_parsed_state_not_dir` — a prior gate physically MOVED so its parsed `state` is `done` (terminal) must NOT block a new `file` (new card is created); a live gate in a non-`inbox` dir (e.g. state `working`) MUST dedup. Author cards by hand-writing frontmatter into an unexpected dir to prove parsed-state wins.
- `test_close_walks_gate_to_done` — `close` moves a live gate to `queue/done/` with a `## Result` note; `close` on an absent target returns `None`.
- `test_file_target_can_be_branch_or_pr_number` — both `target="123"` and `target="codex/foo-bar"` are valid.

**Verify:** `python -m pytest tests/test_merge_gate.py -q`

**Reviewer checklist:** dedup parses `state` (never infers from dir); LIVE_STATES excludes done/rejected/halted; no direct git in this module (it only writes/moves via `cards.save`/`cards.transition` — the CALLER commits to ops); action string exactly `approve:merge:<target>` so it matches `isHumanGate`/`brief._is_human_gate`; body carries repo/branch/pr/unblocks.

---

### Task T2 — Producer hooks (`agent_runner.ps1` + `stage_approval.py`)

**Goal:** Every path that hands a branch/PR to a human files a merge-gate card via T1 (no duplicated dedup logic).

**Files:**
- Modify `scripts/agent_runner.ps1` — the push-for-human-merge SUCCESS branch (the `else { Write-RunnerLog ("pushed ... awaiting PR into ops ...") }` at ~L484, after `git -C $RepoRoot push $PushRemote $workBranch` succeeds at ~L477). Variables in scope: `$workBranch` (`codex/$Agent-$runStamp`), `$RepoRoot`, `$Agent`, `$py`, `$PushRemote`.
- Modify `scripts/stage_approval.py` — `open_pr` (L58-63), after `pr_opener(branch)` returns the PR ref.
- Extend `tests/test_stage_approval.py` (has `test_stage_cloud_opens_pr` injecting `fake_pr_opener`).

**Interfaces / how it must work:**
- **PowerShell:** in the success branch, shell `merge_gate.py file` the same way `New-WakeMeCard` shells cards (`& $py <script> <argv>` with `sys.path.insert(0,'scripts')`). Simplest: `& $py "$RepoRoot/scripts/merge_gate.py" file --queue-root "$RepoRoot/queue" --target $workBranch --repo <repo-name> --branch $workBranch --unblocks "merge of $workBranch into ops"` (branch-only gate; no PR number — see Decision 5). Log the filed card id. A `merge_gate` failure must NOT fail the run harder than the push already did — log and continue (surfacing is best-effort here; the push already succeeded).
- **Python (`open_pr`):** add an injectable `gate_filer=None` kwarg. After `ref = pr_opener(branch)`, call `(gate_filer or _default_gate_filer)(target=ref, repo=..., branch=branch, pr_url=ref, unblocks=...)`. `_default_gate_filer` binds `merge_gate.file` to the repo's `queue/`. Keeps `stage_approval` hermetic (tests inject a recording `gate_filer`).
- Neither producer commits to ops itself here beyond the discipline the surrounding script already uses (`agent_runner.ps1` already commits queue writes to ops via its heredoc cards path; `stage_approval` runs under the dispatcher's git flow). Reviewer must confirm the filed card is committed by the existing surrounding flow, not left dangling in the worktree. If the surrounding flow does not commit arbitrary new queue files, the producer must stage+commit the card path via the same runner it already uses (`runner(["add","--",<rel>]...)` + commit) — verify against the real script before choosing.

**Test FIRST:**
- `tests/test_stage_approval.py::test_open_pr_files_merge_gate` — inject `pr_opener` returning `"PR:foo"` and a recording `gate_filer`; assert `open_pr` pushes, opens, THEN calls `gate_filer` once with `target`/`pr_url` = the returned ref. Assert order (push before file).
- `tests/test_stage_approval.py::test_open_pr_gate_filer_default_is_merge_gate` — with no `gate_filer`, the default resolves to `merge_gate.file` (assert via monkeypatch of `merge_gate.file`).
- PowerShell change: no PS test harness exists; the reviewer verifies by reading the diff (the `merge_gate.py` behavior is already unit-tested in T1). State this explicitly in the task so the implementer does not invent a PS test framework.

**Verify:** `python -m pytest tests/test_stage_approval.py -q`

**Reviewer checklist:** producers CALL `merge_gate.py` (no re-implemented dedup); `gate_filer` is injectable (hermetic tests); a merge_gate failure never crashes a successful push/stage; the branch-only gate from `agent_runner.ps1` is accepted per Decision 5; no credential is read/printed by either producer.

---

### Task T3 — `classify()` coverage (stop-ladder + STOP + stranded) + server counts + vitest

**Goal:** Server projection surfaces the four uncovered predicates. Server-side only (UI rendering is T6).

**Files:**
- Modify `dashboard/server/approvals/humanInbox.ts`:
  - `HumanInboxCategory` add `'stranded'`; `HumanInboxUrgency` add `'critical'`.
  - `HumanInboxItem.categoryLabel` union add `'Stranded'`.
  - `HumanInboxCounts` add `stranded: number`.
  - `classify(card, now)` — thread `now: number`. Add branches (ordered AFTER existing input/wake/gate limbs, BEFORE the final `return null`):
    - `state === 'stop-requested' || state === 'halting'` → `intervention`, urgency `high`, respond none (these are mid-stop; the operator watches, the ladder self-resolves or SIGKILL backstops). `halted` already handled — do not duplicate.
    - **Stranded:** `(state === 'inbox' || state === 'working')` AND `owner` is a real agent id (`owner !== null && owner !== HUMAN_OPERATOR`) AND age from id-epoch `> STRANDED_AGE_MS` (new constant, default `24*60*60*1000`, beside the predicate) → `stranded`, urgency `low`. Age helper: parse `^([0-9a-f]{8})-` from `meta.id`, `parseInt(hex,16)*1000`; if it doesn't match, age is unknown → NOT stranded (Decision 1). Reason/nextAction: "owned by `<owner>`, no progress for `<age>` — is its runner online?"
  - `projectHumanInbox(index, opts?)` — `opts?: { now?: number; stopPresent?: boolean }`. Pass `now` (default `Date.now()`) into `classify`. When `opts.stopPresent`, prepend a synthetic item: category `intervention`, urgency `critical`, stable synthetic card `{ meta: { id: 'stop-file', state: '', action: '', ... }, body }`, status "Fleet frozen", nextAction "The repo-root `STOP` file is present — the fleet is frozen. Remove it (or clear via the stop floor) to resume." respond none. Extend the urgency sort to rank `critical` above `high`. Init `counts.stranded = 0`; STOP counts as `intervention`.
- Modify `dashboard/server/approvals/routes.ts` `GET /api/human-inbox` (L53-56): compute `stopPresent = existsSync(join(ctx.repoRoot, 'STOP'))` and pass `{ stopPresent }` (and let `now` default). Import `existsSync`/`join`.
- Extend `dashboard/server/approvals/humanInbox.test.ts`.

**Test FIRST — vitest** (extend the existing `card()`/`index()` helpers; note stranded tests must use hex-epoch ids + an injected `now`):
- stop-ladder: a `stop-requested` and a `halting` card each project as `intervention` (high); assert counts.
- STOP: `projectHumanInbox(index([...]), { stopPresent: true })` includes a `critical` intervention with id `stop-file`; `stopPresent:false` omits it; the item sorts first.
- stranded: an agent-owned `inbox` card with a hex id whose epoch is `now - 25h` → `stranded` (low); the same card with epoch `now - 1h` → NOT stranded; a `human-operator`-owned old card is a `gate` not stranded; a non-hex id (`'ordinary'`) is never stranded.
- **Regression:** the existing "does not mislabel ordinary inbox work" test still passes (its ids are non-hex → never stranded) — keep it green and add a comment on WHY.
- counts: `counts.stranded` populated; STOP increments `intervention`.

**Verify:** `npx vitest run server/approvals/humanInbox.test.ts` (from `dashboard/`)

**Reviewer checklist:** stranded excludes `human-operator` and unowned cards and skips non-hex ids; stop-ladder branch does not double-count `halted`; STOP synthetic is produced by the projection (not a card) with a stable id and critical urgency; `now` is injectable (no bare `Date.now()` inside `classify`); route computes `stopPresent` with `ctx.repoRoot` and never reads STOP contents.

---

### Task T4 — Daemon merge-gate reconciler + vitest

**Goal:** A dashboard-daemon interval poller closes merge-gate cards whose PR is merged/closed, via the governed transaction path; failures leave cards open.

**Files:**
- Modify `dashboard/server/write/cardRespond.ts`: extract the executor. New exported
  `executeCardMutation(op: { cardId; section: 'Feedback'|'Result'; block; transitions: string[]; claimOwner: string|null }, deps: RespondDeps): Promise<{ id; state; paths }>` = the `prepareWrite` + `runPy(CARD_RESPOND_SCRIPT, jsonArg)` + `parseStdout` body currently inside `respondToCard`. Refactor `respondToCard` to `planResponse` → `executeCardMutation` with NO behavior change (its test must stay green).
- Create `dashboard/server/write/mergeGateReconciler.ts`:
  - `type PrStatus = { merged: boolean; closed: boolean }`.
  - `type GhRunner = (prNumber: string) => PrStatus | null` — `null` = unknown/unavailable (gh absent, parse fail, timeout). Default runner shells `gh pr view <n> --json state,mergedAt` via `execFileSync('gh', [...], { timeout, windowsHide })`, parsing `state`/`mergedAt`; ANY throw → `null`.
  - `parseMergeTarget(action: string): string | null` — pull `<target>` from `approve:merge:<target>`; return `null` if not a bare integer (PR number). Branch targets are not gh-checkable (Decision 5).
  - `reconcileMergeGates(deps): Promise<{ closed: string[]; skipped: string[] }>` — list open `approve:merge:*` cards (parse state ∈ LIVE_STATES) from a fresh `indexRepo(repoRoot)`; for each with a PR-number target, call `gh`; when `merged || closed`, build `op = { cardId, section: 'Result', block: 'Reconciler: PR #<n> merged/closed at <iso> — gate cleared.', transitions: ['working','done'], claimOwner: 'human-operator' }`, then inside `withOpsTransaction`: `executeCardMutation(op)` → `appendAuditRowLocal({ action: 'merge-gate-reconcile', cardId, result: 'done' })` → `commitPreparedCoordination(first, { alsoStage: [...rest, AUDIT_REL_PATH], message })` — the SAME sequence as the card-respond route. `gh` returning `null` or a not-yet-merged PR → push cardId to `skipped`, card untouched.
  - `startMergeGateReconciler(deps, intervalMs): () => void` — `setInterval` wrapper returning a stop fn; no-op when `intervalMs <= 0`; each tick wrapped so a throw never kills the daemon.
- Modify `dashboard/server/index.ts` `buildApp()`/`start()`: start the reconciler with `DASHBOARD_MERGE_GATE_INTERVAL_MS` (default 300000; Decision 2) using `surfaceCtx.repoRoot`. Register its stop fn in the existing shutdown/`preClose` path. (Wired but only runs after Daniel's restart.)

**Test FIRST — vitest `dashboard/server/write/mergeGateReconciler.test.ts`** (inject fakes; no real gh/git/py):
- gh reports merged → card transitioned to `done`; the injected `executeCardMutation`/commit/audit fakes fire in order (`prepare` < `py` < `audit` < `commit`); one commit.
- gh reports open (not merged) → card untouched, in `skipped`.
- gh returns `null` (absent/timeout/parse-fail) → card untouched, in `skipped` (fail toward surfacing).
- `parseMergeTarget` returns the PR number for `approve:merge:42` and `null` for `approve:merge:codex/foo`.
- branch-target gate is `skipped` (never gh-checked).
- Also add a regression assertion in `cardRespond.test.ts` that `respondToCard` still returns identical outcomes after the `executeCardMutation` extraction.

**Verify:** `npx vitest run server/write/mergeGateReconciler.test.ts server/write/cardRespond.test.ts`

**Reviewer checklist:** `gh` is a READ, injected, ambient auth only — no token read/print/copy; ANY gh failure/timeout → card stays open; the done-transition uses the extracted `CARD_RESPOND_SCRIPT` executor (not a hand-rolled write) inside `withOpsTransaction` with one commit + one audit row; `respondToCard` behavior unchanged; poller no-ops at `intervalMs<=0`, never throws out of a tick, and is stopped on shutdown; reconciler reads `state` parsed, not dir.

---

### Task T5 — Reply-liveness honesty (server + UI) + vitest

**Goal:** After a reply/resolve is recorded, tell the operator whether any consumer is online for the card's owner — non-consumption becomes VISIBLE, with no change to the write itself.

**Files:**
- Create `dashboard/server/runner/liveness.ts`:
  - `type Consumer = 'dashboard-bridge' | 'scheduled-task' | 'none'`.
  - `interface OwnerLiveness { consumer: Consumer; online: boolean; detail: string }`.
  - `ownerLiveness(owner, card, deps): OwnerLiveness` — (a) if `card.meta['execution-controller'] === 'dashboard'` → `{ consumer: 'dashboard-bridge', online: false, detail: 'dashboard bridge will consume on Wave A activation' }`; (b) else `taskForOwner(owner)` (reuse `runner/trigger.ts`) → query `schtasks /Query /TN <task> /FO LIST /V` via injected runner, parse the `Status:` line (`Running`/`Ready` = task exists/scheduled), TTL-cache (~30s) keyed by task, `execFileSync` timeout ~2000ms + `windowsHide`; ANY throw → `{ consumer:'scheduled-task', online:false, detail:'schtasks query failed' }`; (c) no task → `{ consumer:'none', online:false, detail:'no runner is registered for <owner>' }`. Injected `run`/`now`/`platform` for hermetic tests; non-win32 → `consumer:'none'`.
- Modify `dashboard/server/write/routes.ts` `POST /api/write/card-respond` (after the successful commit, before `reply.code(200)`): compute `liveness = ownerLiveness(str(parsed.meta.owner), parsed, {...})` inside a `try` (never throw — default `{consumer:'none',online:false,detail:''}`) and include it in the 200 body: `{ ok, cardId, state, liveness }`. Must NOT run before/affect the write.
- Modify `dashboard/src/lib/approvalsClient.ts`: `VerifyResult` gains optional `liveness?: OwnerLiveness`; `respondToCard` reads `body.liveness` into the result.
- Modify `dashboard/src/views/ApprovalsLive.tsx` `onRespond` success branch: compose the outcome banner using `liveness` — e.g. "Reply recorded and committed. No runner is online for `worker-desktop` — this card will not progress until one runs." when `!liveness.online`.

**Test FIRST — vitest:**
- `dashboard/server/runner/liveness.test.ts`: branch (a) execution-controller dashboard; branch (b) schtasks reports Running → online, reports absent/throws → offline with detail; cache hit avoids a second `run` call within TTL; non-win32 → `none`.
- `dashboard/server/write/cardRespondRoute.test.ts`: extend — a successful respond returns `liveness` in the body; inject a fake schtasks runner via the surface context (add a `runnerLiveness`/`schtasksRun` injection seam on `SurfaceContext` mirroring `triggerRunner`); a liveness failure still returns 200 with `consumer:'none'` (never 500).
- `dashboard/src/views/Approvals.test.tsx` or `ApprovalsLive` test: after respond, the banner shows the no-runner message when `liveness.online === false`.

**Verify:** `npx vitest run server/runner/liveness.test.ts server/write/cardRespondRoute.test.ts`

**Reviewer checklist:** liveness is computed AFTER the committed write and can never fail the respond (200 preserved); schtasks query is `/Query` (read-only), cached, short-timeout, injectable — a slow schtasks never blocks the route; reuses `taskForOwner`'s closed map (no arbitrary task names); no credential involved; UI banner is honest (says "not online", not "delivered").

---

### Task T6 — Feed B waiting-human surfacing + UI counts/category fixes + vitest

**Goal:** Surface managed runs stuck `waiting-human` with zero open requests; render the new `stranded`
category and STOP intervention; fix the client default-counts `gate`/`stranded` omission.

**Files:**
- Modify `dashboard/src/control/HumanRequestsPanel.tsx` `refresh` (L40-45): widen the filter to
  `run.openHumanRequestCount > 0 || run.state === 'waiting-human'` (`run.state` is already on
  `RunMetadataDto` — no server change). Add a distinct render path for a `waiting-human` run with an empty
  `humanRequests[]`: a row "run waiting on a human with NO open request — inspect run" linking to the run.
- Modify `dashboard/src/lib/approvalsClient.ts` `fetchHumanInbox` default counts: add `gate: 0` and
  `stranded: 0` (match server `HumanInboxCounts`).
- Modify `dashboard/src/views/Approvals.tsx`:
  - `CATEGORY_ORDER` (L66) add `'stranded'` so `categoryRank` isn't `-1`.
  - counts reducer seed (L89-92) add `stranded: 0`; add a `<span data-testid="summary-stranded">` in the
    summary block (L108-113).
  - `urgencyRank` (L81) handle `'critical'` (rank above `high`).
  - Add a CSS class `v-approvals__category--stranded` (the template already emits
    `--${item.category}`); style in the view's stylesheet.
  - STOP intervention: render distinctly in the detail panel (it is category `intervention`, id
    `stop-file`) — the panel already keys on `status`/`reason`/`nextAction`, so the server-supplied
    strings carry it; confirm no per-subtype branch is required, else add a minimal `id === 'stop-file'`
    caption branch.
- Modify `dashboard/src/control/HumanRequestsPanel.test.tsx` and `dashboard/src/views/Approvals.test.tsx`.

**Test FIRST — vitest:**
- `HumanRequestsPanel.test.tsx`: a run with `state: 'waiting-human'` and `openHumanRequestCount: 0` and
  empty `humanRequests` renders the "NO open request — inspect run" row; a run with open requests still
  renders normally.
- `Approvals.test.tsx`: a `stranded` item (via `projectHumanInbox` real-pipeline helper) renders a
  `summary-stranded` count and a stranded row; a STOP item renders its critical caption; the counts
  summary shows `Gates` and `Stranded`.
- A client test (or reuse `approvalsClient` test if present) that the default counts include `gate` and
  `stranded`.

**Verify:** `npx vitest run src/control/HumanRequestsPanel.test.tsx src/views/Approvals.test.tsx`

**Reviewer checklist:** the panel widening reads `run.state` (no server change) and renders a clearly
distinct, non-actionable "inspect run" row for empty-request waiting-human runs; client default counts
match the server type exactly; new category/urgency handled everywhere the view enumerates them
(`CATEGORY_ORDER`, reducer seed, `urgencyRank`, summary spans) so no `-1`/`NaN` slips through.

---

### Task T7 — `brief.py` parity + shared fixture suite

**Goal:** `brief.py` surfaces the same states the dashboard projects, proven by a fixture file both
languages test against so drift is a test failure.

**Files:**
- Create the shared fixture `tests/fixtures/inbox-gates-parity.json` — a top-level `{ "now": <epoch-ms>,
  "cases": [ { "meta": { <card frontmatter> }, "expected": <canonical category | null> } ] }`. Canonical
  categories = dashboard set: `decision|gate|input|intervention|stranded|null` (Decision 4). Cover:
  approval→decision, `approve:*`→gate, `owner: human-operator`→gate, needs-input→input, wake-me→
  intervention, stop-requested/halting→intervention, halted→intervention, root-blocked (unowned, no
  deps)→intervention, dependency-blocked→null, ordinary agent work→null, old agent-owned inbox card
  (hex-epoch id older than `now - 24h`)→stranded, recent agent card→null. STOP is NOT a card → tested per
  language, not in the shared file.
- Modify `scripts/brief.py`:
  - Add a physical-dir scan that filters by parsed `state` (fix the `_iter_cards('halted')` trap):
    `_iter_all_cards(repo_root)` globs the FOUR physical dirs and yields parsed cards; callers filter on
    `card.meta['state']`.
  - Add `classify_category(card, stop_present=False) -> str | None` returning the canonical category
    (reuse `_is_human_gate`, `_is_wake_me`, `_card_age` for stranded with the same 24h threshold and
    hex-epoch source). Refactor `_actionable_pending` to consume it and additionally surface `halted`,
    root-`blocked`, and the stop ladder (its rendered "kind" labels may map from the category).
  - Keep `_is_human_gate` byte-identical to the dashboard `isHumanGate` two-limb test.
- Create `tests/test_inbox_gates_parity.py` — load the JSON, assert `brief.classify_category(cards.Card
  from meta, now=fixture.now)` equals each `expected`.
- Create `dashboard/server/approvals/inboxGatesParity.test.ts` — load the SAME JSON (resolve the repo-root
  path from `dashboard/server/approvals/`), build a `ParsedCard` per case, assert
  `classify(card, fixture.now)` maps to the same canonical category (bridge `classify`'s
  `HumanInboxItem|null` → category via `item?.category ?? null`).
- Extend `tests/test_brief.py` — assert a `halted`, a root-`blocked`, and a `stop-requested` card now
  appear in the brief's pending/actionable output (they previously did not).

**Test FIRST:** write `tests/test_inbox_gates_parity.py` and `inboxGatesParity.test.ts` against the fixture
BEFORE changing `brief.py`; both fail until `classify_category` exists and the physical-dir scan lands.

**Verify:** `python -m pytest tests/test_inbox_gates_parity.py tests/test_brief.py -q` AND
`npx vitest run server/approvals/inboxGatesParity.test.ts`

**Reviewer checklist:** `brief.py` scans PHYSICAL dirs and filters by parsed `state` (no `queue/halted/`
eponymous-dir scan); the shared fixture is the single source both suites load (no second inline copy);
`classify_category` and the dashboard `classify` agree on every fixture case (that IS the anti-drift
guarantee); `_is_human_gate` stays identical across the two surfaces; stranded uses the same 24h
threshold + hex-epoch age on both sides.

---

## Suggested order & dependencies

- T1 → T2 (producers call `merge_gate.py`).
- T3 is independent (server projection); T6 UI depends on T3's `HumanInboxCategory`/`HumanInboxCounts`
  additions and shares `ApprovalsLive.tsx`/`Approvals.tsx` with T5 (different regions — coordinate).
- T4 depends on the `executeCardMutation` extraction (self-contained within T4).
- T5 is independent (new module + route field + banner).
- T7 depends on T3's canonical category set (fixture vocabulary).

Full-suite gates at wave end: `python -m pytest tests -q` and (from `dashboard/`) `npm test` both green.
```

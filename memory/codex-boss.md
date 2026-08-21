# Codex boss memory

## 2026-08-19 — Match the workspace root to the target project

- When a requested implementation lives outside the active writable workspace, locate and inspect it read-only, then restart the coding session from the target project's common parent before editing. This keeps sibling source and portal directories available, avoids a chain of per-command escalations, and makes branch/test/deploy operations coherent.
- When adding applied material to a research library, first map the existing information architecture. A distinct practice track can preserve the difference between explanatory reference content and a goal-directed learning/build plan better than appending another chapter or duplicating an existing reading path.

## 2026-08-20 — desk⇄VM Phase-1 overnight (boss session; spec→plan→7-task build)

- WORKED: per-task loop = codex builds (focused gates only) → boss re-runs tests outside sandbox → model-verified adversarial review (opus on trust surfaces: store surgery/lease/attestation; sonnet on mechanical) → prescribed-fix dispatch → reviewer re-verify → boss commits. Caught 5 BLOCKERs that tests+typecheck could not see (wire-contract lifecycle leak, host-store migration from tests, resident-VM import kill, stale-registry pin, unexecuted POSIX adapter). Review-then-commit is non-negotiable for deploy-path code.
- WORKED: WSL leg for POSIX-only code — tar-copy source (exclude node_modules) into a Linux-native dir + npm ci there (Windows node_modules lack linux native bindings; rolldown fails on /mnt/c), pip --user --break-system-packages for pytest. First execution of an adapter is a review gate, not an afterthought.
- FAILED: full-suite runs INSIDE codex workers — the dispatch shell got killed twice mid-`npm test`; orphaned codex children keep working (watch pending marker pid + JSONL mtime; a >4-min-quiet log can just be a silent long test run — check process liveness, not only mtime). Rule: workers never run broad suites.
- FAILED: trusting sandbox-reported test failures on native-I/O files — NtCreateFile interception makes authorizedFailedRunReconciliation fail 20/23 in-sandbox vs 23/23 outside; pytest needs --basetemp inside the worktree. Boss re-runs are the arbiter.
- LEARNED: grep-based plan completion checks cannot catch pass-through serialization drift after a type rename — reviewer's type-first enumeration of payload-carrying types is the check that works.
- LEARNED: review fixes can orphan plan interfaces (deleted "dead" exports that a later task consumes) and plan test inputs go stale against review-hardened contracts. Standing rulings that kept the night moving: adapt INPUTS to contracts (never weaken contracts), recreate plan-mandated interfaces as thin wrappers, record every ruling as a plan-header amendment so gates stay honest.
- LEARNED: parallel vitest on this box under load = waitFor-timeout flake in src/ UI files; the server suite is exactly clean serially (163 files/2500 tests). Characterize baselines serially before believing any red.

## 2026-08-20 — A green suite does not prove a human-review boundary

### Context
- Atlas's foundation suite was green, but adversarial review found that a truncated preview could hide T3 fields while Confirm remained enabled, and tests invented a Drive `etag` that the real v3 resource does not provide.

### Root Cause / Core Insight
- Tests exercised internally consistent mocks, not the external API's actual concurrency/version contract or the operator's complete visible decision surface. A hash can bind hidden parameters perfectly while still failing the human-review requirement.

### The Pattern (transferable)
- Next time a consequential action depends on preview, version, or identity binding, I will separately prove: every authorization-critical field is visible, oversized previews are un-runnable at the server boundary, the real endpoint supports the asserted atomic precondition, and ambient connection identity cannot change between prepare and execute.
- Signal to recognize: a test fixture supplies an ETag/version field not sourced from primary API documentation, or production code truncates/redacts a proposal that still renders an enabled confirmation control.

### Related
- See the same session's local-file lesson in `handoffs/2026-08-20-atlas-omni-remediation-review.md`: revalidation is not confinement when namespace identity can change between check and use.


## 2026-08-20 — Reconcile + merge + deploy of two overnight arcs (boss session)

- WORKED: measure overlap before planning (`comm` of the two `--name-only` diffs + a throwaway trial merge) — 4 files / 1 import conflict settled the "merge vs one integration branch" question in two commands. Merge the reviewed PR as-is, rebase the other linearly on top; content-equivalence check = `git diff <orig-branch> HEAD -- <its files>` must show only the overlap files.
- WORKED: a whole-PR dedup pass on a 39k-line, per-unit-reviewed branch found real merges (10) but little true dead code — most "dead" was unused `export`s. Worth ~2h once; not worth re-running per wave.
- FAILED→FIXED: "CI green" claims were Windows-only; main went red on ubuntu the moment #139 merged (scandir order, `py -3` literals, test needing `node_modules` before `npm ci`). Rule: before declaring a Linux gate green, run the CI command in a **native WSL clone** (`git clone /mnt/c/... ~/kb-ci`) — never over `/mnt/c` worktrees (Windows `.git` pointer, CRLF, no exec bits → 8 false failures) and never `--single-branch` (the fleet card `no-worker-commits-on-main` needs `origin/main`).
- HAZARD: running the full pytest in WSL over a Windows worktree DELETED the `node_modules` junction; the worker sandbox can't run `wsl` at all (`E_ACCESSDENIED`) — boss runs Linux checks.
- HAZARD: `pytest --basetemp` must have an existing parent dir (1166 setup errors otherwise) and must sit outside any repo (`test_branch_hygiene` walks up into the parent repo). Use `kb-worktrees/_pt`.
- HAZARD: the harness kills long background shells (~25–60 min); the AP gate job died mid-vitest. Run vitest alone as its own background job; don't chain it after a 20-minute pytest.
- LEARNED: `core.autocrlf=true` breaks every byte-for-byte generated-file check on this box; the house fix is a `.gitattributes eol=lf` pin (skills, canaries, systemd, now generated schema modules).
- LEARNED: Daniel merges fast — push cleanup commits to the PR *before* telling him a PR is merge-ready, or they ride the next PR (which is what happened).
- WORKED (VM): the activator refuses unless `/readyz quiescent:true`; `POST /api/control/execution/lock` from the desk gets there in <10 s. VM python is 3.14: `spec_from_file_location` probes must register the module in `sys.modules` before `exec_module` or `@dataclass` dies. `kb-dashboard` has no home dir — one-time HF downloads need `HF_HOME` under the state root. Debian's `click` blocks pip upgrades (`--ignore-installed click`).
- LEARNED: the hard-ceiling hook blocks any command string mentioning `~/.ssh` — fingerprint the VM's trusted public key and let Daniel match it locally; never ask for or guess the key path in a command you run.
- REMAINS: VM `/var/lib/kb/ops` only moves through the signed promotion ceremony; `export_tier0` "restart locked" expectation is stale under tailnet arm-at-boot; Phase-2 plan next.


## 2026-08-20 — Dashboard v3 brainstorm → spec (boss session, evening)

- WORKED: interview in single questions with context-first prose, then ONE widget; Daniel answered every one substantively. What ended the loop was not more questions but his "come up with a final spec, this one should be good" — at that point stop asking and rule.
- FAILED: I created the task list and cut the branch after a widget answer that contained redlines. Redlines are a revision request, not approval. Re-present, get a plain yes, then scaffold.
- WORKED: a dense DECISION brief (every product call made, numbered D1–D16, with the operator's verbatim complaints) → codex-deep xhigh wrote a 600-line spec grounded in real modules in 34 min; a second codex-deep adversarial pass found 4 real blockers (T3 over tailnet, boss-merges, PTY root, seeded-armed cadences) and 13 majors/minors with file:line evidence. Spec → attack → fix is the right P0 shape; ~1.5 h total.
- FAILED→FIXED: `--sandbox read-only` blocks the scratchpad too; the reviewer ran 12 min and wrote nothing. Read-only workers deliver in their FINAL MESSAGE; a `--follow-up` recovered it at no extra analysis cost.
- HAZARD: `cd <scratchpad> && py -3 "$(git rev-parse --show-toplevel)/scripts/codex_dispatch.py"` resolves to `C:\Program Files\Git\scripts\...` — always the absolute script path, as the skill says.
- RULING (Daniel agreed): schedules are store-first, repo-mirrored — control store is the live authority, `HEARTBEAT.md` seeds import once, a sweeper-cadence agent mirrors store → repo by PR (bookkeeping, not a gate); a cadence arms only once its entry is on protected `main`.
- REMAINS: Daniel has not yet read the final spec (P0 gate); P1 plan next; P3 needs a `kb-shell` uid on the VM before Daniel's CLI logins; P5 blocked on the movement helper install.

- RULE (Daniel, 2026-08-20): branch prefix follows the TERMINAL running the boss — a Claude Code boss cuts `claude/<name>`, a codex CLI boss cuts `codex/<name>`; the git `user.name` in this checkout (`codex-boss`) is stale for a Claude terminal and must not drive the choice. v3 branch renamed `codex/dashboard-v3` → `claude/dashboard-v3` (same commits, 9e391633).

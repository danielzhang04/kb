# Verdict: FIX-THEN-SHIP

Do not begin execution-authority cutover. The overall Phase I architecture is salvageable, but six blockers currently make the release trust boundary unsafe, the evidence package forgeable, and the required restart canary impossible.

## BLOCKER

1. **Release activation executes bytes from a daemon-writable staging area.**

   **Failure:** A compromised worker watches `/var/lib/kb/state/incoming`, replaces both archive and `.sha256` after SCP, and root executes the candidate’s validator. The checksum passes because artifact and digest share the same trust channel.

   **Evidence:** plan:1073–1080, 1284–1300, 1325–1331. Bootstrap gives `kb-dashboard` ownership of all `/var/lib/kb/state` at plan:1350; daemon and workers share that UID at plan:1399–1416 and `claudeWorkerAdapter.ts:690–696`.

   **Cheapest fix:** Upload into a root-owned, non-daemon-writable staging directory; reject symlinks/non-root ownership, consume already-open file descriptors, and verify a signed artifact attestation binding workflow, source SHA, and archive digest before running candidate code.

2. **The desktop promoter treats compromised-VM manifests as trusted instructions and content.**

   **Failure:** `pending_manifests` checks only `schema`. It does not bind filename, `id`, `commit`, fetched ref, or `parent`. Duplicate IDs can cause the second commit to be considered already promoted by the trailer search while its receipt remains inconsistent. Separately, any valid commit touching `queue/`, `memory/`, `handoffs/`, dashboards, or `STATE.md` is automatically cherry-picked and pushed; `git bundle verify` proves object connectivity, not provenance or safe semantics.

   **Evidence:** plan:2038–2089, especially 2058–2085; receipt paths at 2113–2119. Workers inherit the daemon identity and write the same ops/state roots.

   **Cheapest fix:** Require a closed manifest schema with `filename stem == id == commit`, exact fetched-ref equality, a single-parent chain rooted at the last trusted ops head, safe object modes, and topological ordering. Promote into a quarantine ref/PR and require trusted-desktop semantic approval for instruction-bearing paths.

3. **Gate 2 can certify fabricated or stale evidence.**

   **Failure:** Most REQUIRED booleans lack versioned producer/report schemas. Tasks 20–22 do not preserve the promised JSON reports, while deploy, outbox, and validation inputs are free-form transcripts. A compromised VM can copy or edit old reports, rename them so they are lexicographically latest, regenerate `evidence.sha256`, and pass verification. `verify_inventory` checks only listed rows, accepts added files, and has no trusted signature. The canary ancestry check constrains a claimed SHA but does not authenticate who produced that claim.

   **Evidence:** plan:3030–3033, 3063–3097, 3100–3108; prior test commands at 2631 and 2760 do not emit the reports Task 25 consumes.

   **Cheapest fix:** Define one signed, versioned evidence schema per key, binding artifact digest, commit, host/boot identity, command selection, timestamps, raw-output digest, and effective configuration. Recompute the complete inventory and reject extras/duplicates; sign the final digest and approvals on the trusted desktop.

4. **The “proved restore” gate can restore an internally inconsistent snapshot and still pass.**

   **Failure:** Restic scans the live release, Git checkout, and state root without quiescence or a filesystem snapshot. A commit can add objects and advance a ref while restic traverses `.git`, producing a ref whose objects are absent; control state, outbox receipts, and the checkout can come from different transactions. Restore verification merely checks that directories, `current`, and `.git` exist.

   **Evidence:** plan:1507–1514, 1528–1551. Real Git writes span multiple commands under an in-process lock at `write/asyncGit.ts:29–57` and `write/branch.ts:249–275`; control JSON is replaced independently at `control/store.ts:5314–5329`. This falls short of design:81–86 and 117–119.

   **Cheapest fix:** Freeze admission and reach genuine quiescence before a storage snapshot, or export a consistent Git bundle plus state checkpoint. Restore into isolation, run `git fsck`, validate checkout/ref/outbox/store invariants, boot the restored service, and run a recovery canary.

5. **Task 24 cannot pass against the required post-merge runtime.**

   **Failure:** There are two independent contradictions:

   - The plan searches `sourceTurnId === card.id`; commit `804acec` synthesizes definition ID `bridge-${card.id}` and stores that as `sourceTurnId`.
   - After SIGKILL, the store only normalizes live records to `interrupted`. No boot supervisor invokes `runToBoundary`. The planned service restarts locked, the bridge is not recreated, and—without an undocumented persistent `DASHBOARD_SESSION_SECRET`—the old bearer is invalidated by the new process secret.

   **Evidence:** plan:2975–3013; `queueBridge.ts@804acec:446,624–638`; `store.ts:2643–2711,5303–5333`; `execution.ts:720–740,1002–1071`; `activation.ts:660–662`; `auth/session.ts:105–116`; unit at plan:1404–1415.

   **Cheapest fix:** Amend Task 24 to consume a durable card→run receipt rather than reconstructing `sourceTurnId`. Add a boot recovery supervisor with a durable recovery claim, old-process fencing, immutable proposal reconstruction, and authority limited to already-approved interrupted runs.

6. **Lock/shutdown can report quiescence while work remains capable of starting.**

   **Failure:** `lock()` synchronously drops `ActivatedExecution` without draining workers. `bridge.stop()` only clears the timer; it does not await an in-flight tick. Work queued outside the worker adapter by Task 22 has no cancellation-registry entry; cancellation of a current holder can release a slot and spawn queued work after `drain()` observed zero. Readiness has no queued-work field and can lose the only reference to the worker counter when the latch clears.

   **Evidence:** plan:1088–1090, 1151–1176, 2530–2631, 2753–2758; `activation.ts:678–691`; `queueBridge.ts:178–215`; Claude registers only after spawn at `claudeWorkerAdapter.ts:690–696,774–782`.

   **Cheapest fix:** Make lock an asynchronous `locking → locked` transition. Close all limiter admission, cancel queued work, call `stopAndDrain()` on the bridge, drain registered workers, and retain counters until active and queued counts reach zero. Readiness must corroborate the service cgroup.

## MAJOR

1. **Allowed-root browsing follows symlinks outside allowed roots.** A promoted `memory/leak` symlink can expose readable state or platform files on Linux. Plan:1731–1753; `kb/browser.ts:55–69,97–100`. Reject symlinks at every component/final target and reject mode `120000`/gitlinks during promotion.

2. **Effective systemd policy is not verified.** The validator reads only the base unit; drop-ins can override `KillMode`, environment, user, or `ExecStart` while Gate 2 stays green. Plan:1376–1388,3100. Collect and validate `systemctl show`/`systemctl cat`, including `DropInPaths`, effective environment, command, user, and cgroup settings.

3. **Gate 1 probes the wrong port.** Serve exposes tailnet `:443` and proxies to loopback `:4317`, but the ACL parser requires clients to reach/refuse `:4317`. Honest collection curls `$KB_TAILNET_URL`, so collection and decision disagree. Plan:2301–2308,2404–2410,2432. Bind probes to the exact normalized external Serve endpoint.

4. **Malformed cards do not actually block startup.** Task 7 tests only version compatibility and calls the permissive TypeScript parser. That parser casts a flat map to `CardMeta` without validating required fields, state, action, or risk tier; Python does validate them. Plan:609–611,635–680; `planeA/cards.ts:92–134`; `scripts/cards.py:90–103`. Apply the machine-readable schema at startup and add malformed/type/unknown-field cases.

5. **Repository-registry authority is largely inert.** `remote`, `baseRef`, and `credentialIdentity` are hashed but never govern activation. The planned registry says `baseRef: main`, while VM execution resolves the active `ops` checkout’s `HEAD`. Plan:694–713,745–788,909–937; `activation.ts:271–288,328–345,413–433`. Either enforce these fields or stop presenting them as an operational Phase II prerequisite.

6. **Promotion can destroy unrelated desktop work.** On any caught Git failure, Task 17 executes `git reset --hard <before>` without requiring a clean disposable checkout. A dirty `--repo` loses tracked edits. Plan:2094–2105. Require a clean dedicated promotion clone/worktree and never hard-reset the operator’s checkout.

7. **Outbox ordering and degraded admission trust malformed time.** Promotion sorts by attacker-/clock-controlled `(createdAt,id)`, not parent topology; Task 18 converts unchecked timestamps with `Date.parse`, where `NaN` disables the age threshold below 100 items. Plan:2058–2073,2223–2236. Order exclusively by the verified parent chain and treat malformed manifests as degraded/fail-closed.

## MINOR

- The shared Ubuntu Vitest claim is false on a plain system with only `python3`: `authorizedFailedRunReconciliation.test.ts:165–180,283–285,328–351` launches `python` directly. Use the shared resolver or an explicit test interpreter.

- Runtime evidence reports command names, not supported runtime identities. The plan builds with Node 24 but the unit executes system `/usr/bin/node`; neither Node nor Python versions/realpaths are gated. Plan:1059–1074,1413–1415,2975–2979.

- `sudo --preserve-env=KB_CANARY_SESSION` gives the root canary and all inherited subprocesses a full-scope operator bearer. The token is short-lived and excluded from the report, which is good, but a one-time route-scoped canary capability passed through an FD/stdin would reduce exposure. Plan:3011–3013; `auth/session.ts:16–24`.

## What is right

- Immutable release directories, safe tar-member rules, atomic symlink selection, and explicit rollback are sound primitives.
- Disabled VM remotes plus atomic outbox manifests/receipts materially reduce accidental loss.
- Crash normalization honestly marks uncertain work interrupted.
- Resource-class separation and AsyncLocalStorage Git reentrancy are correct.
- The `804acec` ancestor checkpoint and mandatory re-read are structurally sound—and correctly require the plan to stop now because the pinned contract contradicts Task 24.
- Disabling unsupported Linux PTY/runner/Vibe surfaces is the correct Phase I posture.

The review checkpoint is at [findings-checkpoint.md](C:/Users/danie/AppData/Local/Temp/claude/C--Users-danie-kb/11fdfac9-c43f-46cc-bda2-977339b37234/scratchpad/plan-adversarial-work/findings-checkpoint.md). The target worktree remained clean at `59825c62d38e50e34e862d120dc1d7a4c542615f`.

--- codex-dispatch card 6a7bf747-0b2e3657 | model gpt-5.6-sol | exit 0 | 1726s | ops publish: pushed | log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a7bf08f-b8dba90c.jsonl | session 019ff423-bbe6-7670-b8e1-63ee04b06af4 (follow up with --follow-up 019ff423-bbe6-7670-b8e1-63ee04b06af4)

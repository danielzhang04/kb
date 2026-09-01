# dashboard-v3 ops reconciliation — COMPLETE — 2026-09-01

**Topic:** The VM ops write-back finally completed. Consumes and replaces
`2026-09-01-dashboard-deploy-saga-mid-promotion.md` (delete it in this push). Required a code fix
(PR #147) to two VM-side validator defects that had blocked this leg since the outbox anchor was set
on 2026-08-19 — it had never once succeeded.

## Load list
- `deploy/apply_ops_reconciliation.py` — the validator; the two fixes are at the `--no-renames`
  diff calls and the new `RECONCILED` constant
- `scripts/promote_vm_outbox.py` — the desktop half; `:915` empty-spool exit-0, `:569-631`
  receipt recovery by `KB-Outbox-ID` trailer
- `dashboard/server/write/outboxStatus.ts:139-152` — the 15-minute degradation clock
- `dashboard/server/control/admission.ts:33-37` — what `outbox-degraded` refuses
- `docs/specs/2026-08-18-cutover-end-state.md:476` — open question D-1, the drain cadence

## Final state (all verified, not assumed)
| Thing | State |
|---|---|
| VM ops checkout | reconciled onto `ed85df3d`; was stranded on its own local head `ae3b1492` |
| Agent declarations on the VM | **10** (was 4) |
| Orphan `wf-*` cards in the VM inbox | **0** |
| Outbox | 12 bundles receipted and archived to `promoted/` |
| 409 retry loop | dead — 0 `runnable-owner-required` lines in the 90 s after unlock |
| Execution | unlocked; dashboard HTTP 200 at https://kb.tail82dd4f.ts.net |
| Units | `kb-dashboard`, `kb-shell-broker.socket`, `kb-whois.socket` all active |

## What WORKED (with evidence)
- **PR #147 (`ea1ad8c8`) fixed the two blocking defects.**
  1. `parse_raw_diff` required strictly `(header, path)` pairs, but `git diff --raw -z` emits THREE
     fields for a rename. Cards moving `inbox -> working -> done` ARE renames to git (~98% similar),
     so ordinary queue traffic broke this validator. Fixed with `--no-renames` on both porcelain
     diffs so moves decompose into delete+add — strictly MORE validation, since both ends then get
     mode- and allowlist-checked. That closes a real hole: `git mv deploy/x.py queue/y.md` would
     otherwise have presented one allowlisted path while deleting a protected file.
  2. `COORDINATION` refused `agents/`, `orgs/*/workflows/` and the Atlas transcripts, all of which
     legitimately live on ops. Fixed by SPLITTING the constant rather than widening it: `COORDINATION`
     (unchanged) still governs VM-originated commits, and a new `RECONCILED` superset governs the
     inbound reconciled range. The VM can now RECEIVE an agent-catalog edit but never ORIGINATE one.
- **Verified against the exact failing range before running:** 612 paths, 0 rejected by `RECONCILED`,
  0 rename records (525 A / 14 D / 73 M). Exclusions spot-checked adversarially — `deploy/`,
  `scripts/`, `governance/`, `CLAUDE.md`, `dashboard/`, the Atlas `.wav` blobs and nested/non-`.jsonl`
  transcript paths all still refused.
- **The receipt half had already succeeded** in the failed run: receipts are written at `:453-473`,
  well before the crash at `:524`. That is why the re-run needed the receipts set aside — with all 12
  present, promote exits 0 "nothing to promote" and never reaches the reconciliation.
  `recover_receiptless_remote_prefix` rebuilt all 12 from the trailers on ops, as designed.
- **`bootstrap_vm.py upgrade` does not restart the dashboard** ("daemon-reload + enable only; the
  operator restarts"), so the lock held across the helper refresh and the existing ssh signature
  stayed valid. No re-signing was needed. `validate_vm_runtime.py` asserts nothing about resident
  helpers, so refreshing one creates no boot-validation conflict.

## What did NOT work (and why) — read before repeating any of it
- **The documented command could never have worked**, in any ordering. Locking writes an audit row
  BEFORE it locks (`routes.ts:753-760`), which spools a new bundle, which changes `chainDigest` and
  invalidates the signed approval. Lock after snapshotting instead and you fail on
  `expected-source-head`. The runbook has no lock step at all.
- **`git mv` renames the INDEX ENTRY from the already-staged blob** and does not re-read the working
  tree. A first attempt at retiring the cards committed the moves without the `state:` edits.
- **PowerShell corrupts `git archive | tar -x`** (pipes decoded text through a binary stream), and
  BOTH `tar` and `scp` read a leading `C:\` as a remote host. Use an absolute path for `git archive
  -o`, then run `tar`/`scp` from inside the staging directory with relative paths.
- **`git -C <repo> archive -o rel.tar`** writes relative to the REPO, not the caller's cwd.

## Remaining, in priority order
1. **The drain cadence — open question D-1, now the top blocker for running agents.** Every audit row
   spools a bundle; `outboxStatus.ts:142` hardcodes a 15-minute age limit, after which
   `admission.ts:33-37` 503s all `new-work` — which means LAUNCHING RUNS. Unlocking itself spools one,
   so the steady state never reaches zero unattended. Note the tension: receipts can only be written
   during a quiescent window, so **every drain needs a lock window** — a 10-minute cadence would mean
   pausing the fleet every 10 minutes. Probably the better fix is raising `maxAgeMs` (keeping the
   100-bundle count limit as the real guard) plus a daily drain. That is a judgment call about how
   long unreplicated coordination state may sit on the VM — Daniel's, unresolved as of this handoff.
   D-1's stated prerequisite, an empty-spool exit-0 path, IS now satisfied (`:915`). Routine drains
   need NO signature: the approval branch only fires on an INSTRUCTION path, and audit-ledger rows
   are not one (verified on bundle `e9e23b0d`).
2. **Gate 3 — CLI provisioning.** Install BOTH `claude` and `codex` under
   `/var/lib/kb-shell/home/.local/bin` as `kb-shell` and authenticate (Daniel-only). All-or-nothing:
   the broker identity check requires launchers exactly `shell,claude,codex`.
3. **Gate 4** — flip chosen agents `runner-bound: true`, walk the dashboard, run one agent for real.
4. **`kb-node-proxy.service` is FAILED** and has never run: `deploy/kb_node_proxy.py` `main()` is a
   STUB that raises `SystemExit("...provisioned by systemd; import the module for logic")`. All the
   request logic exists and is tested; only the server loop was never written. Not currently
   load-bearing — `tailscale serve` exposes only `/ -> 127.0.0.1:4317`, there is no 8444 node
   listener, and no `host-nodes.json` — but the VM therefore does not satisfy the P6 boot contract
   its own plan specifies (`docs/plans/2026-08-23-dv3-p6-plan.md:171`). Decide: build the loop, or
   mask the unit with a tracked defect card.
5. **Runbook `docs/runbooks/2026-08-18-platform-cutover.md:923`** tells the operator to set
   `$TrustedOpsHead = rev-parse origin/ops`. That is correct only for a virgin chain; on a partially
   promoted one it fails at `promote_vm_outbox.py:322`. It must be the CHAIN BASE. Add the lock step.
6. **`scripts/queue_bridge_select.py:80`** calls `wake_me(repo, target, reason)` as
   `wake_me(repo_root, reason, detail)`, so generated wake cards carry `target: '<failure detail>'`.
   Live proof was VM card `6a9642c4-68a097de` with `target: runnable-owner-required`.
7. **The queue bridge has no backoff, give-up or dead-letter** (`queueBridge.ts:210-214`). One
   permanently-409 card pinned the runtime non-quiescent for 75 minutes and burned a dispatch every
   15 s. No live trigger remains, but the gap is real.
8. **Hand-synced main files on ops.** Five historical commits pushed `scripts/cards.py`,
   `scripts/queue_bridge_select.py`, `governance/card-schema.md`, `governance/budget.yaml` and
   `HEARTBEAT.md` onto ops. The new allowlist deliberately still refuses these, so if that syncing
   continues, this leg jams again. Also flagged: `9416c40b` is a `codex-worker` commit to
   `governance/card-schema.md`, though CLAUDE.md says `governance/` is human-edited only.
9. Reverse drift: `orgs/kb-ops/workflows/acceptance-run.md` is on ops but not main (the mirror does
   not prune). Binaries on ops: ~16 `orgs/atlas/output/persona-samples/*.wav|*.mp3`.

## Card retirement (context for anyone reading queue/archived/)
Nine `wf-*` cards were retired to `queue/archived/` with `state: archived` (`24041361`). All named
`owner: worker-desktop`, which exists in NO agent catalog on any branch. They resolve through the
card-owner branch (`queueBridge.ts:293-296`) because they carry no `workflow-def` — which is why the
ten declared `fyt-*` agents never hit this path, as `agents/fyt-runner.md` pins
`workflow-def: video-run` on every card it files. 2026-08-14 leftovers from the workflow-platform P1
live-proof. `archived -> inbox` is legal if any run is ever revived.

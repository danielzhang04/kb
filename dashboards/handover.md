# System Handover
_Generated: 2026-09-16 06:13 UTC_

Overnight the cloud nightly dispatcher ran cleanly: preamble, pyyaml, and the
sync_skills check all passed, and one `nightly-review` cadence card was dispatched and
executed (these dashboards are its output). No API money was spent today; yesterday cost
$0.33 (a runpod pod-create), well under the $30/day ceiling.

**Waiting on you:**
1. **PR #173** (`claude/provenance-fix`) — the kb-ops VM dashboard has been down since
   2026-09-06 (a hydrate-time validator bug). The fix is reviewed and mergeable but still
   open; the dashboard stays down and recovery can't run until you merge it. This is the
   most impactful item.
2. **figment GATE A eye-gate** (approvals card `65d8f246`) — a T3 operator ruling on the
   creator-001 blind board; curation to 40 is blocked until you rule.
3. **sync_daemon_dirs desktop fix** — the nightly drift-check script is missing from the
   `ops` branch and has been flagged 8 nights running. From the dashboard-ops worktree,
   restore the script and decide the one-file drift (`orgs/kb-ops/workflows/acceptance-run.md`:
   reconcile to main, or `--sync --prune`). The gate reports but never blocks dispatch.

**What the system will do unattended:** the nightly dispatcher keeps running each night —
dispatching cadence cards, regenerating these dashboards, and re-filing the sync_daemon_dirs
wake card until the desktop fix lands. It will not merge PRs or rule gates; those are yours.
Two cards sit in `working/` (one figment track-1 replication in flight since ~09-03, one
halted codex smoke card not yet swept) — worth a glance but neither blocks the fleet.

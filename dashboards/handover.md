# System Handover
_Generated: 2026-09-17T06:08:37Z_

**What happened.** The nightly cloud dispatcher ran cleanly: preamble passed, skills are in
sync, and one `nightly-review` card was dispatched and executed to regenerate these dashboards.
Yesterday the fleet spent $6.20 (all RunPod L40S pods for figment's Track-1 replication),
well under the $30/day ceiling; today is $0 so far.

**One thing to know:** the nightly routine expects `scripts/sync_daemon_dirs.py`, but that file
is absent on `ops`, so the daemon-mirror drift check could not run this time. It doesn't block
dispatch, and a wake-me card is waiting in the queue explaining it — but the daemon-read mirror
(agents/, workflows/, model-routing.yaml) went unverified tonight.

**What is waiting on you.**
1. **figment GATE A eye-gate** (`65d8f246-8a461521`, T3): a blind seven-axis board needs your
   ruling before curation to 40 can continue.
2. **kb-ops dashboard is still down** — the VM service has been stopped since 2026-09-06 over a
   hydrate crash. The fix, PR #173, is reviewed and mergeable but still open; nothing recovers
   until it's merged and recovery is run.
3. **Restore the missing `sync_daemon_dirs.py`** (or the desktop `--sync` it points to) so the
   nightly mirror check works again.

**What the system will do next unattended.** The single dispatcher keeps firing its scheduled
cadences; the next nightly-review beat will regenerate these dashboards again. No agent will
merge PR #173, run the kb-ops recovery, or rule the figment gate for you — those stay human.
figment's replication card remains in flight under its standing daily $10 approval. One halted
codex card is parked in `working/` awaiting the archiver.

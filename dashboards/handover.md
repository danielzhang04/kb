# System Handover
_Generated: 2026-10-14T06:20:35Z_

**What happened overnight.** The nightly cloud dispatcher ran cleanly. The preamble and
the skills-sync check both passed. The daemon-dir drift check could only run in its
cloud refs-fallback mode because its script still lives on `main` but not on `ops`; it
found the same single harmless drift it has found for weeks. The dispatcher emitted one
card — the nightly-review cadence — which regenerated these dashboards. No project work
branches moved, and nothing cost real money (every step was subscription-billed, so the
$30 daily budget is untouched).

**What is waiting on you.** Two approval cards sit in `queue/approvals/`: a figment T3
"eye-gate" blind board (curation can't advance to 40 without your ruling) and the kb T1
wake decision `6ab76543` that already bundles the whole sync-daemon-dirs fix. The inbox
holds **15 older dated "sync-daemon-dirs" wake-me cards** (Aug 15 → Oct 4) plus one
canonical card this run refreshed in place — it did **not** add another duplicate. They
all trace to one thing: `scripts/sync_daemon_dirs.py` exists on `main` but not on `ops`.
One short desktop session ends the pile-up for good: restore that script to `ops`, decide
whether `orgs/kb-ops/workflows/acceptance-run.md` (the one drifting file) belongs on `main`
or should be pruned from `ops`, land the small step-2b dedup tweak, and sweep the 15 dated
duplicates. Also note the figment card `d126c410` has been stuck in `working/` since
Sep 7 and prospecting's P1–P8 branches are all still unpushed.

**What the system will do next unattended.** It will keep running the nightly cadence,
regenerating these dashboards, and — until the script is restored — refreshing the single
canonical sync-daemon-dirs card in place each night (no new duplicates). It will not touch
project trees, merge anything, or spend money. Production (the kb VM on release `e8ac49ad`)
stays live and self-ticking every 5 minutes.

# Executive Dashboard
_Generated: 2026-09-20T06:07Z by dispatcher-cloud_

## Action required
- **`65d8f246-8a461521`** — figment — _GATE A eye-gate: operator rules creator-001 expansion-02 blind board (seven axes) so curation to 40 can proceed_ — **T3** — awaiting operator ruling.
- **atlas remediation review** — the adversarial remediation diff on `codex/atlas-enhancements-20260820` exceeds 400 lines; the project contract requires Daniel's review before commit (handoff `2026-08-20-atlas-omni-remediation-review.md`).

## Queue
| state | count |
|-------|-------|
| inbox | 110 |
| working | 2 |
| approvals | 1 |
| done | 1603 |

## Last 24h
- Cadences run: `nightly-review` (card `6aaf77cb-4191993d`, dispatched cloud tier).
- Cost: **$0.00** spent (cost ledger empty today and yesterday) vs **$30.00/day** budget — full budget remaining.
- Notable: nightly dispatcher completed preamble, pyyaml, and `sync_skills --check` (all green). Daemon-dir drift gate ran via refs-fallback (script still absent from `ops`) — see Anomalies.

## Projects
- **atlas** — Omni-interface foundation complete locally on `codex/atlas-enhancements-20260820`; adversarially re-reviewed remediation diff ready and **waiting on Daniel** (>400 lines, unpushed).
- **faceless-youtube** — PARKED, no work in flight; repo STATE is stale, real last activity was the Bricks Variant-D arc in an external clone.
- **figment** — One resumable `pipeline` command drives anchor→…→video with per-stage gates; Track 1 replication live run (`d126c410`) is operator-driven and in flight; GATE A eye-gate awaits operator.
- **kb-ops** — Production VM live on release `8f71173e` (PR #202, merged 2026-09-17); v1 launch arc closed; nine agent-owner cadences remain disarmed, workflow schedule armed but not ticking on the VM.
- **prospecting** — P1–P8 built across worktrees, all branches **UNPUSHED**; P8 affinity gate 953/953 green, live-tested against the real desktop store.

## Anomalies
- **Daemon-dir drift (recurring).** `scripts/sync_daemon_dirs.py` is present on `origin/main` but absent from `ops`, so the literal step-2b gate fails `[Errno 2]`; run via refs-fallback it reports one ops-only file, `orgs/kb-ops/workflows/acceptance-run.md`. Wake-me card `wake-daniel-2026-09-20-sync-daemon-dirs-drift` filed; **11 open sync-daemon-dirs cards** now track the same owed desktop fix.
- **Working-card note.** `6a6bc3dd` (kb-ops iter-smoke) is `halted`/record-only (resolved in PR #103 wave); `d126c410` (figment Track 1) is an operator-terminal live run — neither is stranded.
- Preamble, pyyaml, and `sync_skills --check`: **green**.

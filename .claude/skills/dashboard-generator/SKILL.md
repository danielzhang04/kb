---
name: dashboard-generator
description: Regenerates dashboards/executive.md and dashboards/handover.md from live repo state (queue, ledgers, org STATEs). Use when a cadence card says to regenerate dashboards, or the user asks for a system status refresh.
---

# dashboard-generator

You REWRITE two files in full (never append). Read before writing:
1. `queue/inbox/ working/ done/ approvals/` — count cards per state; list approvals
   cards (id, project, action, risk-tier) and any card older than 48h in working/.
2. Today's + yesterday's ledgers via `python -c` with scripts/ledger.py `read_day`
   (kinds: dispatch, cost, activity) — runs, per-agent cost totals, budget remaining
   vs governance/budget.yaml.
3. Every `orgs/*/STATE.md` "## Now" section (skip orgs/_archive).

## dashboards/executive.md — exact structure
# Executive Dashboard
_Generated: <UTC timestamp> by <agent-id>_
## Action required        <- approvals list, or "None"
## Queue                  <- table: state | count
## Last 24h               <- cadences run, cost spent vs budget, notable results
## Projects               <- one line per org: name — STATE "Now" summary
## Anomalies              <- stale working/ cards, drift warnings, preamble failures; or "None"

## dashboards/handover.md — exact structure
# System Handover
_Generated: <UTC timestamp>_
Plain English, <= 300 words, for the human returning after time away:
what happened, what is waiting on them, what the system will do next unattended.

Rules: this is a T1 acts-alone task; write ONLY these two files; commit to ops with
message "chore(dashboards): nightly regeneration".

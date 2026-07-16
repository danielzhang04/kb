# Proposal: `nightly-review` carve-out clause for `governance/risk-tiers.md`

**What this is.** An agent-*proposed* clause for `governance/risk-tiers.md`. `governance/` is
human-edited only (per the kb constitution), so an agent may only draft the text — it may not
commit it. **Daniel** commits the verbatim clause below into `governance/risk-tiers.md` on
protected `main`, then merges `main → ops` **before HUMAN GATE 0.5a**, so the carve-out is present
in the `ops` working tree the cloud routine checks out when it runs.

**Why.** The `nightly-review` cadence is deadlocked. Every run files its own
`cadence:nightly-review` card into `queue/approvals/` instead of executing, because the v1 blanket
"start supervised (queues-for-me)" policy — and the empty `ledgers/grades/` (no task type has
earned its promotion yet) — override the card's own `T1` label and the `dashboard-generator`
skill's "acts-alone" self-description. This is recorded in `memory/dispatcher-cloud.md`
(2026-07-15): the dispatcher correctly refused to trust a cadence's own tier label at face value
and flagged that *"either amend risk-tiers.md to carve out dashboard-regen, or expect every nightly
run to keep landing in approvals/ until that's resolved."* This clause is that amendment. It grants
`nightly-review` a **narrow, enumerated** acts-alone authorization so the unattended cloud cycle can
close, while keeping every integrity stream and every escalation path supervised.

---

## Verbatim clause to paste into `governance/risk-tiers.md`

Paste the block below immediately after the existing "Standing authorization" paragraph (i.e. as the
new final paragraph of the file), so it reads as a named refinement of that standing-authorization
rule.

```markdown
Carve-out — `cadence:nightly-review` (added 2026-07-16): the human-authored `nightly-review`
cadence (declared `risk-tier: T1` in the root `HEARTBEAT.md` on protected `main`) is authorized to
**act alone at T1 for any trigger** — scheduled or manual Run-now — with its writes limited to the
following enumerated allow-list. It does NOT queue-for-me while every write stays inside this list:
- `dashboards/**`
- the agent's own memory shard `memory/<agent-id>.md`
- `ledgers/dispatch/**` (the cadence's own dispatch rows only)
- the cadence's **own** card `queue/` state transition — moving *its own* card to `queue/done/`
  with a `## Result` — and emitting **wake-me cards into `queue/inbox/`** (this is queueing work
  for a human/dispatcher, not acting on it)

Excluded from the carve-out (verbatim): `ledgers/grades/**` and `ledgers/activity/**` (integrity
streams), any **other** agent's memory shard, `governance/**`, `orgs/*/contract.md`, and any project
work tree. Any write outside the enumerated allow-list — including any of the excluded paths — voids
the carve-out for that run, which reverts to queues-for-me (the card goes to `queue/approvals/`).
This carve-out names `nightly-review` only; no other cadence inherits it.
```

---

## Rationale note (required by HUMAN GATE 0.4)

The allow-list must explicitly name the own-card `queue/` write and the `ledgers/dispatch/` row, or
the carve-out would be **self-voiding**. The root `HEARTBEAT.md` `nightly-review` prompt ends with
step 5: *"Commit ONLY dashboards/ memory/ queue/ ledgers/ changes to ops and push."* So a normal,
correct nightly run **inherently** writes into all four of `dashboards/`, `memory/`, `queue/`, and
`ledgers/` on every execution:
- `dashboards/**` — the `dashboard-generator` skill rewrites `dashboards/executive.md` and
  `dashboards/handover.md` in full.
- `memory/<agent-id>.md` — step 4 appends a lessons line to `memory/nightly-reviewer.md`.
- `queue/` — the run must transition its *own* cadence card to `queue/done/` (and may emit wake-me
  cards to `queue/inbox/` on preamble or `sync_skills --check` drift).
- `ledgers/dispatch/**` — the dispatch ledger row recording the run.

If the allow-list omitted the `queue/` own-card transition or the `ledgers/dispatch/` row, the very
first thing every run does would fall outside scope, void the carve-out, and bounce the card back to
`queue/approvals/` — reinstating the exact deadlock this clause exists to break. Naming those two
writes is therefore load-bearing, not incidental. The exclusions (`ledgers/grades/**`,
`ledgers/activity/**`, other agents' shards, `governance/**`, contracts, project trees) keep the
integrity streams and every higher-tier surface supervised: the carve-out lets the dashboard/memory
housekeeping loop close unattended without granting the cadence any reach into what it is not there
to touch.

---

## How to apply (for Daniel)

1. **Paste.** On a fresh checkout of protected `main`, open `governance/risk-tiers.md` and paste the
   fenced clause above as the new final paragraph — immediately after the existing "Standing
   authorization (decided 2026-07-15)…" paragraph. Paste the clause body only (the text *inside* the
   ```` ```markdown ```` fence), not the fence lines themselves.

2. **Commit** (on `main`):
   ```
   git commit -am "gov(risk-tiers): carve out nightly-review as T1 acts-alone with enumerated write allow-list"
   ```

3. **Merge `main → ops`** so the carve-out is in the `ops` working tree the cloud routine reads,
   **before** HUMAN GATE 0.5a:
   ```
   git checkout ops
   git pull --rebase origin ops
   git merge main --no-edit
   git push origin ops
   ```
   Then run the 0.5a Run-now against the post-merge `ops` tree; the `nightly-review` cadence card
   should go straight to `queue/done/` (not `queue/approvals/`), with no write landing outside the
   allow-list.

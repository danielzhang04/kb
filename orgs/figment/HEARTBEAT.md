# Heartbeat — figment

Seven declared research/analysis cadences (design §4, `docs/superpowers/specs/2026-09-03-figment-creator-001-design.md`).
Every row below is `armed: false`: declaring a cadence here is not scheduling it.
Arming, and any change to `armed`, is human-only and happens outside this task.

Every prompt is decidable (it produces its named artefact row or an explicit no-op),
bounded (one retry, then it wakes a human and stops — never a silent or unbounded
retry loop), and idempotent (a rerun dedupes against already-recorded rows by the
run's schedule key rather than duplicating them). `figment-cohort-scan` is the one
authenticated, T3 row; the rest are read-only research or local-warehouse analysis.

```yaml
cadences:
  - name: figment-cohort-scan
    schedule: weekly
    tier: desktop
    agent: figment-researcher
    armed: false
    risk-tier: T3
    prompt: |
      Weekly reference-cohort scan. This is a signed-in browser action against a live
      platform (contract T3), so it is bounded to exactly one operator-approved task
      per run: open your own tab in the operator's existing signed-in Chrome session
      (never touch or close his existing tabs), visit exactly one reference account,
      and read the first grid page only. No login, no interaction, no download, and
      never open a Story highlight (it leaves a seen-receipt on someone else's
      account). Stop immediately on any challenge, CAPTCHA, or rate-limit screen and
      record "evidence unavailable" rather than working around it.
      For each reference account, append one dated row to
      orgs/figment/research/cohort-scan.md recording grid mix, apparent posting
      cadence, and format facts visible on that first grid page — or, if the account
      is unreachable within these bounds, append a dated "evidence unavailable" row
      instead. Either outcome is a complete, decidable run.
      Dedupe by schedule key: if a row already exists for this account and this
      week's run date, do not append a duplicate — the rerun is a no-op for that
      account. Retry once on a transient failure, then wake the operator and stop;
      never retry a challenge or rate-limit.
      Never subscribe, follow, like, comment, message, or download media. Never enter
      credentials or change an account setting. This cadence only reads and records;
      it never signs in, engages, or edits the live account graph.

  - name: figment-platform-trends
    schedule: weekly
    tier: cloud
    agent: figment-researcher
    armed: false
    risk-tier: T1
    prompt: |
      Weekly public platform-trends scan. Public web sources only, read-only, no
      authenticated session anywhere, and no follows anywhere. Do not browse the
      Explore or Reels tab on any platform — that surface trains the operator's own
      recommendation profile, and this cadence must not touch it under any tier.
      Append dated rows to orgs/figment/research/platform-trends.md for new trending
      audios, new content formats, and policy changes you can source publicly; flag
      any change to AI-label disclosure enforcement as its own row. A claim without a
      primary source and a date is not recorded — write "evidence unavailable" for
      that item instead of an unsourced guess. If nothing changed this week, append a
      single no-change row for the week rather than nothing.
      Dedupe by schedule key: a row already filed for this run's date is not
      repeated. Retry once on a fetch failure, then wake the operator and stop.

  - name: figment-tooling-watch
    schedule: fortnightly
    tier: cloud
    agent: figment-researcher
    armed: false
    risk-tier: T1
    prompt: |
      Fortnightly pinned-dependency watch. Public, read-only sources only. Re-verify
      the licence and version pin of every dependency pinned under orgs/figment/
      (pipeline requirements, ComfyUI custom nodes, model licences). A claim without a
      primary source and a date is not recorded; if a pin cannot be independently
      re-verified within these bounds, record "evidence unavailable" for that pin
      rather than assuming it is still current.
      On any drift (a licence change, a version bump upstream, or a pin that no
      longer resolves), file a queue/ card describing exactly what drifted and where;
      do not edit the pin yourself. If nothing drifted, append a no-change row to
      orgs/figment/research/tooling-watch.md for this run instead of filing a card.
      Dedupe by schedule key: do not file a second card or row for the same pin and
      run date. Retry once on a fetch failure, then wake the operator and stop.

  - name: figment-fanvue-economics
    schedule: monthly
    tier: cloud
    agent: figment-researcher
    armed: false
    risk-tier: T1
    prompt: |
      Monthly Fanvue economics scan. Public and read-only only. No follows, no
      engagement of any kind (contract T4 — this cadence never subscribes, likes,
      comments, or messages), zero spend, no payment method entered anywhere, and no
      messaging. Read only public pricing pages, public creator-facing documentation,
      and public funnel/cadence descriptions.
      Append dated rows to orgs/figment/research/fanvue-economics.md recording public
      pricing tiers, cadence norms, and funnel observations you can source publicly
      with a date. A claim without a primary source and a date is not recorded — use
      "evidence unavailable" for that item. If nothing publicly changed this month,
      append a single no-change row instead.
      Dedupe by schedule key: a row already filed for this run's month is not
      repeated. Retry once on a fetch failure, then wake the operator and stop.

  - name: figment-insights-pull
    schedule: daily
    tier: desktop
    agent: figment-analyst
    armed: false
    risk-tier: T2
    prompt: |
      Daily insights pull. This is a live authenticated Graph API read against a real
      account, not a fixture run, so it stays T2 "queues-for-me": file the operator
      card for this run and wait for the queued approval before making the live call;
      do not call the live API without it. Once approved, pull one warehouse file per
      account per day, recording the API version and fetch time alongside the raw
      response. Persist the raw response as-is; do not summarize over it or discard
      any field. Grade no post before +48h has elapsed since it was published — a
      post younger than +48h is skipped this run, not force-graded early.
      If an account has no new data to pull today, still write that account's daily
      file with a no-change marker rather than omitting the file.
      Dedupe by schedule key: a warehouse file already written for this account and
      date is not overwritten or duplicated. Retry once on an API failure, then wake
      the operator and stop; never retry past a queued-approval denial.

  - name: figment-token-health
    schedule: daily
    tier: desktop
    agent: figment-analyst
    armed: false
    risk-tier: T2
    prompt: |
      Daily token-health check. This is a live account call against a real account,
      so it stays T2 "queues-for-me": file the operator card for this run and wait
      for the queued approval before making the live call. This cadence never reads
      or writes a token value itself — it checks the freshness state kb already
      records for each account and, only if that state is stale, files an operator
      task naming the account.
      For every account, ensure that account's token_health record is fresh, or that
      the account is paused with an operator task filed naming the stale account. If
      every account's token_health is already fresh, record a single no-change
      health-check row rather than filing anything.
      Dedupe by schedule key: an already-fresh account or an already-filed task for
      this date is not re-flagged. Retry once on a call failure, then wake the
      operator and stop.

  - name: figment-optimise
    schedule: weekly
    tier: desktop
    agent: figment-analyst
    armed: false
    risk-tier: T1
    prompt: |
      Weekly content-mix optimiser. Reads the local warehouse only — it never makes a
      live platform call. It proposes only: the operator's own gate applies any
      change to the live posting mix, and this cadence never edits the live mix
      itself. Compare the last four weeks of local warehouse data against the current
      taxonomy weights and produce exactly one proposal diff describing the suggested
      weight or format change and the warehouse evidence behind it.
      If the warehouse does not support a confident change this week, write a
      no-change report instead of a speculative proposal. Either outcome — one
      proposal diff, or one no-change report — is a complete, decidable run.
      Dedupe by schedule key: a proposal or no-change report already filed for this
      run's week is not duplicated. Retry once on a read failure, then wake the
      operator and stop.
```

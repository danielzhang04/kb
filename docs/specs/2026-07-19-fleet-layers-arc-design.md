# Fleet layers arc — design (2026-07-19)

Author: claude-boss (Fable 5 orchestrator, autonomous session authorized by Daniel 2026-07-19).
Status: approved-by-mandate (Daniel: "finish building and iterating and testing the rest of atlas
design, BESIDES atlas itself"). Builds on `atlas-design/2026-07-15-fleet-layers-brainstorm.md`
(research, no designs) and the arc Daniel approved 2026-07-19: Wave A = live-fire + Chief of Staff,
Wave B = Proving Grounds canaries, Wave C = Dreaming (design gate first). Sentinel + Mission
Control + Flight Recorder + Quartermaster follow as Waves D–F. Atlas itself: excluded.

Substrate ground truth: this session's Sonnet substrate sweep (cards/dispatch/routing/promotion/
grade/reconcile/ledgers/skills inventory) and Opus dashboard sweep. Companion doc:
`2026-07-19-executor-activation-and-integrations-design.md` (Phase 0 executor — precedes Wave A).

Hard constraints (from the brainstorm doc, §Cross-cutting, all honored): git-as-database, single
dispatcher, STOP-file supremacy for every new actor, human injection gate on skills/learning,
Proving Grounds gates all self-modification, "usage" not "spend" under subscription metering.

## Wave A — fleet live-fire + Chief of Staff

Live-fire (after Phase 0 acceptance): flip `orgs/kb-ops` cadence `self-lint-report` from dormant to
one SUPERVISED run through the activated engine (card carries `execution-controller: dashboard`,
`owner: dashboard-engine`). Supervised = orchestrator watches the run live, verifies the canonical
Result + done transition + ledger rows, and records a live-fire report. No recurring schedule is
enabled this session (first unattended run stays Daniel-supervised per the approved arc).

Chief of Staff (ambient artifacts, no new scheduler — cadence cards on existing HEARTBEAT
machinery, all T1/T2, all honoring STOP via preamble):
- `brief-morning` cadence → `dashboards/brief-YYYY-MM-DD.md`: overnight fleet activity (ledgers),
  pending approvals/wake-me cards, deferral flags, one "#1 win" drawn from queue priority.
  Calendar/inbox tiers render as "unavailable" until the WS2 Google gates (G1/G2) are cleared —
  the brief must degrade gracefully (brainstorm doc requirement).
- `rollup-eod` cadence → archives completions, lists unfinished with `deferred_count` increments
  (frontmatter counter), flags 3+ deferrals. Propose-only: it never re-queues on its own authority.
- Notification transport: Telegram (the fleet's existing channel — bot token in Credential
  Manager, desktop_poll launcher pattern, agents never touch the token). `scripts/notify.py`
  digest() already formats; a CoS cadence step sends the brief summary. FIRST send is supervised
  this session via `telegram_send.py` through the launcher pattern; poller task registration stays
  a human gate (unchanged). ntfy rejected: second transport violates the pick-ONE rule.
- New script `scripts/brief.py` (pure render from ledgers/queue + tests) so cadence cards stay
  thin prompts over deterministic code.

## Wave B — Proving Grounds (canaries, "golden" cards + trust graduation)

- `evals/canaries/*.md` — golden task cards. Frontmatter: `id`, `capability` (e.g. card-parse,
  ledger-append, triage-classify, drift-detect), `expected` (machine-checkable outcome spec),
  `judge` (deterministic|rubric), `rubric_version`, `k` (repeats), `source: curated|prod-promoted`,
  `immutable: true`. Seed suite: 20 canaries covering the substrate's real failure surface
  (card transitions, routing resolution, grade-schema emission, preamble gating, drift cases,
  triage taxonomy fixtures, workflow compile fixtures).
- Runner `scripts/canary.py`: runs the suite (deterministic judges = pure Python asserts; rubric
  judges = Inspector-role dispatch), scores pass@k and pass^k, appends rows to `ledgers/grades/`
  via the EXISTING pinned `record_grade()` schema (task_type=`canary:<capability>`), never a
  parallel ledger. Inspector identity discipline unchanged (`inspector@agents.local`).
- Held-out separation, adapted honestly to current repo topology: canaries live under `evals/` and
  are declared human-promoted-only in `governance/agent-rules.md` amendment PROPOSAL (human-edited
  file → the amendment ships as a DRAFT card for Daniel, not an edit). Until merged to protected
  main, immutability is enforced by (a) canary hash manifest `evals/MANIFEST.sha256` checked by
  `canary.py` (tamper ⇒ suite fails loud) and (b) reconcile-style diff check flagging any work
  branch that edits `evals/`.
- Trust graduation: `scripts/trust.py` computes rolling pass^k per (skill|agent, capability) from
  the grades ledger; writes derived `dashboards/trust.md`. It TUNES the existing promotion loop's
  inputs (streak/window per `risk-tiers.md`) rather than replacing `promotion.py`. Demote-fast:
  any canary regression below floor emits a wake-me card + (if the subject was acts-alone) a
  `queue/paused/<cadence>` sentinel. No auto-promotion of autonomy this session.
- Test-tamper detection: `canary.py --diff-guard <range>` flags diffs touching `evals/` or a
  card's own oracle; wired into the self-lint cadence prompt.

## Wave C — Dreaming (design-gated, so this ships as DESIGN + reviewable dry-run only)

Per the approved arc, Dreaming gets a design gate before build. This arc ships: the design section
below + `scripts/dream.py --dry-run` producing a REPORT ONLY (no memory rewrites).
- Weekly dream card (cadence, T2, queues-for-me): reads `memory/*.md` + recent ledgers, emits a
  consolidation DIFF on a branch (`claude/dream-YYYY-MM-DD`) — non-destructive, Anthropic Dreams
  contract (merge-dupes/replace-stale/prune, ADD/UPDATE/DELETE/NOOP router from Mem0).
  Human approves the merge; no auto-apply until Proving Grounds trust exists (order dependency).
- `playbooks/` deferred to the wave after canaries prove the dream's judgment (explicit
  brainstorm-doc order dependency: no self-improvement trusted before the canary suite).

## Wave D — Sentinel (immune system; the reconciler + usage guards, egress deferred)

- Organ (a) reconciler: `scripts/sentinel.py reconcile` — level-triggered diff of DESIRED
  (queue/done cards, dispatch ledger rows) vs OBSERVED (artifacts exist, non-empty, Result
  present, session-id stamped). Mismatches append `ledgers/audit/sentinel-<day>.tsv` rows
  (`card, class, detail`; classes: missing-artifact, empty-result, fail-plausible, orphan-claim,
  sandbox-denial) and emit ONE wake-me card per new drift class per day (dedup by fingerprint).
  Report-only: no auto-revert (open question resolved conservatively).
- Organ (b) usage guards: preamble extension — `reservations` TSV
  (`agent, step, unit=steps|wall-clock, amount, state=held|settled|released`) appended atomically
  before expensive steps; breach of `governance/budget.yaml` daily step/wall-clock caps writes
  STOP (reusing the existing freeze chain). Loop circuit-breaker: same-tool+same-args-hash
  ≥N with no state change ⇒ halt card (fingerprint = canonical-JSON hash ignoring ts/nonce).
- Organ (c) watchdog: `scripts/sentinel_watchdog.ps1` Task-Scheduler sibling checking the
  dispatcher heartbeat + PM2 kb-dashboard liveness; bounded backoff restarts; Nth failure ⇒
  diagnostic Scout card. FIRST check in code: STOP file present ⇒ watchdog does NOTHING
  (the resurrect-a-frozen-fleet trap from the research).
- Organ (d) egress allowlist: DEFERRED to its own wave — iron-proxy/mitmproxy needs a local CA +
  human install; ships as a design note + `governance/egress-allowlist.md` placeholder proposal.

## Wave E — Mission Control + Flight Recorder (projections, both renderer-shaped)

- Mission Control: `scripts/mission_control.py` renders `dashboards/mission-control.md` — ranked
  pending approvals (risk score = tier + age + novelty per promotion.py's assurance classes),
  quarantine section (reconcile/sentinel flags), digest bucket (T2 batchables), rubber-stamp
  metric (proposal→decision latency from ledgers; median-below-threshold alarm). The dashboard
  Inbox already renders cards; MC is the RANKED morning projection + metrics, not a new store.
- Flight Recorder: `traces/<card-id>/<run>.jsonl` — post-run hook in the worker adapter (Phase 0)
  normalizes the captured stream-json transcript into GenAI-semconv-shaped records (span id,
  parent, tool, tokens); `scripts/trace_view.py` emits static HTML into `dashboards/traces/`.
  Distilled span skeleton committed (no raw file contents; prompts truncated at 2KB) — bloat
  guard resolved conservatively; full transcripts stay in the control-plane store per its
  existing retention surface. Fork-from-step-N: documented as reconstruction-not-restore;
  implemented as `--fork <trace> <step>` emitting a seeded prompt file, nothing more.

## Wave F — Quartermaster (mostly exists; deltas only)

`governance/model-routing.yaml` + `routing.py` + `audit_routed_vs_ran()` already implement the
policy table. Deltas: (1) escalation-on-failure — requeue with model bumped one tier, `retry_count`
cap 2, dead-letter wake-me after; implemented in dispatch.py's requeue path + tests. (2) outcome
columns: `trust.py` (Wave B) publishes per-tier pass/escalation rates into `dashboards/trust.md`
for threshold tuning. (3) Ollama/Batch lanes: rejected for now — no local model installed, Batch
needs API billing; noted as future options. Card `difficulty` hint: rejected (mis-set hints
under-provision; flat table + escalation is safer at current fleet volume).

## Cross-cutting

- Every new actor runs `preamble.py` first (STOP supremacy) — enforced in code, not prose.
- All new ledger writers go through `ledger.py`/`grade.py` (no new formats); sentinel's audit TSV
  uses `ledgers/audit/` which is already outside `ledger.py` KINDS — it gets its own tiny writer
  with the same shard-per-writer-per-day convention.
- Coordination writes (cards, ledgers, dashboards) → ops branch via pull-rebase; code/design →
  `claude/fleet-arc`. `governance/` and `CLAUDE.md` are human-edited: any change ships as a DRAFT
  proposal card, never a direct edit.
- Testing: pytest per script (target: every new module ≥ the substrate's existing per-module
  coverage), plus one live supervised exercise per wave recorded in a run report under
  `docs/plans/2026-07-19-fleet-arc-runlog.md`.
- Build order = A → B → D → C(design+dryrun) → E → F. Rationale: A needs Phase 0; B before any
  trust/self-modification; Sentinel early for safety; C's build gate depends on B existing.

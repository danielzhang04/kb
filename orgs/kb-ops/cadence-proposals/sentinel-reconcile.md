# Cadence proposal — `sentinel-reconcile` (AGENT-GENERATED)

> **AGENT-GENERATED, NOT INSTALLED.** Written by the fleet-arc Wave D build. This is a
> *proposal only*: no `HEARTBEAT.md` has been edited and no card has been created in `queue/`.
> Installing a cadence is a coordination write a human/dispatcher performs on the `ops` branch.
> Per `orgs/kb-ops/contract.md`, the first unattended run stays **supervised** (a human watches
> the run, verifies the audit rows) before any recurring schedule is enabled.

## What it does

Runs the Sentinel reconciler each day — `py -3 scripts/sentinel.py reconcile` — a level-triggered
DESIRED-vs-OBSERVED diff over freshly-`done` cards (and in-flight `working` cards). It appends any
drift to `ledgers/audit/sentinel-<today>.tsv` (columns `ts, card, class, detail`) across five
classes (`missing-artifact`, `empty-result`, `fail-plausible`, `orphan-claim`, `sandbox-denial`),
advances the git-native cursor `ledgers/audit/sentinel-cursor`, and exits 1 when NEW drift exists,
0 when clean.

Sentinel is **report-only**: it never mutates a card and never auto-reverts. Emitting the actual
wake-me card for a new drift class is the **dispatcher's** job — this cadence surfaces the finding
(non-zero exit + audit row); the dispatcher/human decides the response. The script runs the shared
preamble first (STOP-file supremacy) and does nothing when the fleet is frozen.

## Cadence block to add under `orgs/kb-ops/HEARTBEAT.md` `cadences:`

```yaml
  - name: sentinel-reconcile
    schedule: daily
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run `py -3 scripts/preamble.py` — if it fails (STOP file / budget / API key),
         stop immediately and do nothing else this beat.
      2. Run `py -3 scripts/sentinel.py reconcile`. It appends any new drift to
         ledgers/audit/sentinel-<today>.tsv and advances ledgers/audit/sentinel-cursor.
         Exit 1 = new drift found; exit 0 = clean.
      3. If exit 1, read the new ledgers/audit/sentinel-<today>.tsv rows and file ONE
         wake-me card per NEW drift class into queue/inbox/ (dedup: one card per class
         per day). Do NOT auto-revert or mutate any flagged card — sentinel is report-only.
      4. Commit ONLY ledgers/audit/ changes (plus any wake-me cards under queue/inbox/)
         to ops and push.
      Stay entirely inside ledgers/audit/ and queue/inbox/ (plus the queue/ledgers reads the
      reconciler performs). No card mutation beyond filing wake-me cards; no auto-revert.
```

## Supervised-first activation (human/dispatcher, on `ops`)

1. Human runs the two commands above by hand once, watches the output, and confirms the
   `ledgers/audit/sentinel-<today>.tsv` rows + cursor advance look right (and that a clean
   second run exits 0 with no new rows).
2. Only after a clean supervised run does a human add the block above to `HEARTBEAT.md` on `ops`
   to enable the recurring schedule. No agent enables its own schedule.
3. The wake-me emission in step 3 stays the dispatcher's action — sentinel itself never files or
   mutates cards, so this cadence's authority is bounded to `ledgers/audit/` writes plus the
   dispatcher's own wake-me cards.

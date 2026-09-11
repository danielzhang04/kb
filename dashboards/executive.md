# Executive Dashboard
_Generated: 2026-09-11 06:19 UTC by dispatcher-cloud_

## Action required
- **65d8f246-8a461521** — figment / `GATE A eye-gate` (T3): operator must rule creator-001
  expansion-02 blind board (seven axes) before curation to 40 can proceed. Parked in
  `queue/approvals/`.
- **wake-daniel** cards in `queue/inbox/` awaiting Daniel: the recurring
  `sync_daemon_dirs.py`-missing/drift thread (08-15, 08-30, 09-10, and tonight's 09-11 —
  see Anomalies) plus the older `wake-daniel-2026-07-22-engagement-fold`.

## Queue
| state | count |
|---|---|
| inbox | 53 |
| working | 3 |
| approvals | 1 |
| done | 1579 |

## Last 24h
- **Cadences run:** `nightly-review` fired tonight (2026-09-11, card `6aa39cda-caa9a023`,
  routed claude-sonnet-5) and last night (2026-09-10, card `6aa24b0a-2796b6c2`). This run:
  preamble OK, pyyaml OK, sync_skills `--check` clean.
- **Cost vs budget:** $0.00 logged today, $0.00 yesterday (subscription-billed steps log
  0.0). Daily limit $30.00 → **~$30.00 remaining**, budget not breached.
- **Notable:** daemon-dir drift gate ran via `main`'s copy in refs-fallback mode (script
  still absent on `ops`); found the same single ops-only file as prior nights.

## Projects
- **atlas** — Omni-interface remediation ready for Daniel review on
  `codex/atlas-enhancements-20260820` (durable ACTING state, fail-closed adapters; Atlas
  235 passed, security re-review PASS). Diff > 400 lines, so contract requires Daniel review
  before commit. V1 "Hands" wave already merged + live (PR #44).
- **faceless-youtube** — `bricks-fresh` run: Variant D trial extended to L01–L25, 25/25
  verified ($4.96 cumulative), 25-row blind board built. Daniel gate open: keep D / keep with
  edits / iterate / revert.
- **kb-ops** — Governed executor proven (Wave A). Daily `self-lint-report` cadence exists but
  is DORMANT (no scheduler; manual dashboard launch only while the gate is held).
- **prospecting** — P1–P6 built (gates recorded), P7-UI plan v2.1 pending approval, P8
  affinity live-tested (Gate P8-B green on batch 1); batch 2 NYC-VC re-run awaiting Daniel.
- **figment** — No `orgs/figment/STATE.md`; live cards only: creator-001 Track-1 replication
  in `working` (`d126c410`, T2) and the GATE-A approval above.

## Anomalies
- **`scripts/sync_daemon_dirs.py` absent from `ops`** — the routine's literal step-2b command
  fails ("No such file or directory"). Ran the check via `origin/main`'s copy (refs-fallback):
  EXIT=1, one ops-only file `orgs/kb-ops/workflows/acceptance-run.md`. Same finding as the
  still-open cards 2026-08-15 / 08-30 / 09-10; a fresh `wake-daniel-2026-09-11` card was filed.
  Owed desktop fix: restore the script to `ops`, then decide reconcile-vs-`--sync --prune` on
  the ops-only file.
- **Malformed card `d126c410-9bc54280`** (figment, in `working/`) — `action:` contains an
  unquoted colon, so `cards.parse` raises a YAML ScannerError. Not mine to edit; flagged for
  the owning session (figment-expand) to re-quote the frontmatter.
- **Working-card age unverifiable** — this is a fresh cloud clone, so all `queue/working/`
  mtimes equal checkout time; the ">48h in working" staleness check can't be derived from the
  filesystem this run. 3 cards sit in `working/` (`6a6bc3dd` kb-ops, `d126c410` figment,
  `6aa39cda` this nightly-review run).

# Proposal — `grades-reconcile` HEARTBEAT.md cadence (Task 3.10)

**Status:** proposal only. This block is for Daniel to add to the root `HEARTBEAT.md`'s existing
`cadences:` list on `main`; agents cannot edit `HEARTBEAT.md` directly (human-edited only).

## Where it goes

The root `HEARTBEAT.md` (verified against the current file) already contains one fenced `yaml`
code block with a top-level `cadences:` list of two entries (`nightly-review`, `weekly-audit`), each with
`name` / `schedule` / `tier` / `risk-tier` / `prompt` (block-scalar `|`) fields at 2-space indent.
The new cadence is a third list item at the same indent, inside the same fence.

## Exact YAML block to add

```yaml
  - name: grades-reconcile
    schedule: weekly:sat
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run: py -3 scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: py -3 scripts/reconcile.py --tier desktop
      3. If reconcile exits non-zero, it FROZE the loop: it already wrote
         ledgers/grades/FROZEN with the quarantine reason and filed a T1 wake-me card
         into queue/inbox/. Do not re-run it and do not clear the sentinel by hand —
         confirm the wake-me card exists, then stop.
      4. If reconcile exits 0 ("reconcile: clean"), append a lessons line to
         memory/<agent-id>.md noting the clean run, then commit ONLY ledgers/ queue/
         memory/ changes to ops and push.
```

This parses as a well-formed addition to the existing `cadences:` list (validated with
`yaml.safe_load` in isolation — see Verification below).

## CLI verified against the real `scripts/reconcile.py`

`reconcile.py`'s `main()` takes `argparse` flags `--tier` (required) and `--repo` (default `.`), and
hard-refuses (`exit 2`, before touching anything) any `--tier` value other than `"desktop"` — see
`reconcile.py` lines 355-369 and the docstring's threat model (the author cross-check is
"meaningless in the cloud tier"). So `py -3 scripts/reconcile.py --tier desktop` **is** the real,
correct invocation; the plan's assumed interface matches the code exactly, no `--repo` needed since
the cadence already runs from the repo root.

Exit codes confirmed from `reconcile.main()`: returns `1` and prints `FROZEN: <reason> (<n>
quarantined)` when `ReconcileResult.frozen` is true (this is also true the first time it runs after
an existing, still-unresolved freeze — see `reconcile()` step 3, "already frozen (unchanged)");
returns `0` and prints `reconcile: clean` otherwise. On freeze, `_do_freeze()` writes
`ledgers/grades/FROZEN` (the report as its content) and calls `_emit_wake()`, which files a
`risk_tier="T1"`, `action="wake-me"` card via `cards.new_card(...)` into `queue/inbox/` — i.e. the
plan's "emits FROZEN + wake-me on unmatched rows" is exactly what the code does, not an
approximation.

## Plan-vs-code discrepancy flagged

The two *existing* cadences in `HEARTBEAT.md` (`nightly-review`, `weekly-audit`, both `tier: cloud`)
write their prompts as bare `python scripts/preamble.py`. This proposal deliberately uses `py -3`
instead, per this repo's hard constraint (worker instructions: "Use `py -3` for python") and per a
real desktop bug `scripts/desktop_dispatch.ps1` documents in its own header comment: on this box,
bare `python` resolves to a pip-less msys build with no PyYAML, so anything invoking it silently
fails preamble/import steps while still reporting success. That fix is specific to the **desktop**
tier — the two existing `tier: cloud` cadences are unaffected and are intentionally left as-is; only
this new `tier: desktop` cadence needs the `py -3` form. Flagging this so the inconsistency between
the new block and the two existing ones is a deliberate, tier-driven choice and not an oversight.

## Verification

```
py -3 - <<'EOF'
import yaml
block = """
cadences:
  - name: grades-reconcile
    schedule: weekly:sat
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run: py -3 scripts/preamble.py
      2. Run: py -3 scripts/reconcile.py --tier desktop
"""
print(yaml.safe_load(block))
EOF
```
parses cleanly (see Final report for the actual run output).

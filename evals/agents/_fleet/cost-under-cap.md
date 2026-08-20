---
id: cost-under-cap
capability: fleet-baseline
judge: output-contains
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  command: ["{python}", "-c", "import sys; from pathlib import Path; sys.path.insert(0, str(Path.cwd() / 'scripts')); import preamble, ledger; root = Path.cwd(); spent = ledger.cost_today(root); limit = preamble._daily_limit(root); sys.stdout.write('OK' if spent < limit else 'OVER')"]
  contains: "OK"
---
# cost-under-cap — fleet baseline (e)

CLAUDE.md preamble item 3: today's spend must stay under `governance/budget.yaml`'s
daily cap. This card reuses the SAME two reads `scripts/preamble.py`'s own gate
uses — `ledger.cost_today(repo_root)` for what has actually been spent today,
`preamble._daily_limit(repo_root)` for the configured cap (defaulting to
`preamble.DEFAULT_LIMIT` when `governance/budget.yaml` is absent) — rather than
re-deriving the comparison, so this card can never drift out of sync with the
real gate. It prints `OK` when `spent < limit`, `OVER` otherwise.

Runnable against ANY agent id: like the other fleet-wide checks, spend is a
fleet-level fact, not a per-agent one.

Judge: `output-contains`. `{python}` is substituted with the running
interpreter; the probe runs with `cwd=repo_root` (set by the judge itself), so
`Path.cwd()` inside the script IS the repo root.

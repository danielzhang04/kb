---
id: ledgers-cost-row
capability: fleet-baseline
judge: output-contains
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  command: ["{python}", "-c", "from pathlib import Path; import re,sys; aid = sys.argv[1]; name = re.compile(r'^' + re.escape(aid) + r'-\\d{4}-\\d{2}-\\d{2}\\.tsv$'); cost = Path('ledgers/cost'); rows = (p for p in (cost.iterdir() if cost.is_dir() else ()) if name.fullmatch(p.name) and len([line for line in p.read_text(encoding='utf-8').splitlines() if line.strip()]) > 1); print('ROW' if any(rows) else 'MISSING')", "{agent_id}"]
  contains: "ROW"
---
# ledgers-cost-row - fleet baseline

Cost TSV rows have no agent-id column. Their writer attribution is the filename
prefix (`<agent-id>-YYYY-MM-DD.tsv`), which is therefore the decidable source
used here. This card passes when an attributed cost TSV has a non-header row.

Honest limit: it proves that the filename-attributed ledger contains a cost row;
it cannot prove which individual model step inside that file belongs to a
particular run or validate the row's reported amount.

Judge: `output-contains`; `{agent_id}` is substituted during a fleet run and
the probe prints `ROW` only when the filename-attributed ledger has a data row.

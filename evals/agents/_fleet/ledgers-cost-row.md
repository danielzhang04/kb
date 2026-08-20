---
id: ledgers-cost-row
capability: fleet-baseline
judge: output-contains
rubric_version: "2"
k: 1
source: curated
immutable: true
tier: T1
input:
  command: ["{python}", "-c", "from pathlib import Path; import re,sys; aid = sys.argv[1]; name = re.compile(r'^' + re.escape(aid) + r'-\\d{4}-\\d{2}-\\d{2}\\.tsv$'); cost = Path('ledgers/cost'); files = [p for p in (cost.iterdir() if cost.is_dir() else ()) if name.fullmatch(p.name)]; print('OK' if (not files or any(len([line for line in p.read_text(encoding='utf-8').splitlines() if line.strip()]) > 1 for p in files)) else 'EMPTY-LEDGER')", "{agent_id}"]
  contains: "OK"
---
# ledgers-cost-row - fleet baseline

Cost TSV rows have no agent-id column. Their writer attribution is the filename
prefix (`<agent-id>-YYYY-MM-DD.tsv`), which is therefore the decidable source
used here. A floor card must pass a never-dispatched agent vacuously: with NO
filename-attributed ledger files the card passes (nothing exists to
mis-attribute); when attributed files exist, at least one must carry a data row
beyond the header, else the ledger is an empty shell and the card fails.

Honest limit: it proves that the filename-attributed ledger, when present,
contains a cost row; it cannot prove which individual model step inside that
file belongs to a particular run or validate the row's reported amount.

Judge: `output-contains`; `{agent_id}` is substituted during a fleet run and
the probe prints `OK` when no attributed ledger exists (vacuous pass) or when
an attributed ledger has a data row; `EMPTY-LEDGER` otherwise.

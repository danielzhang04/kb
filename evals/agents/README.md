# evals/agents/ — per-agent eval suites

`evals/agents/<agent-id>/*.md` are golden cards for ONE agent's job, run by
`scripts/agent_evals.py` (deterministic judges: `file-exists`, `output-contains`,
`pytest`; `judge: model` runs `claude -p`, excluded by default — opt in with
`--include-model-judged`). Each suite has its own `MANIFEST.sha256` (canary
discipline: tamper refuses the suite; re-bless via `--update-manifest` on a
green suite, human-witnessed, never silent).

`evals/agents/_fleet/` is the shared baseline: cards runnable against ANY
agent id via `run_suite(..., fleet=True)` / CLI `run <agent-id> --fleet`,
recording as `eval:<agent-id>:fleet-<card-id>`.

Reserved worker id: **`eval-suite`** — never name a real agent this. Grade
rows are excluded from autonomy-promotion input.

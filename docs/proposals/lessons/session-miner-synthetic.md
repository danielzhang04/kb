# Proposed lessons

status: PROPOSED
source_session: session-miner-synthetic
operation: ADD

> Candidate ADDs only. A human or dream.py must accept a lesson into memory/; this file does not do that.
> Dream's current dry-run reads memory/*.md only, so this reviewable file is its documented future intake seam.

## ADD 1
- lesson: WORKED: retry Bash after an error; changed command "pytest -q" → "pytest tests/test_target.py -q". ERROR: import failed because the focused path was omitted.
- confidence: med
- evidence: session-miner-synthetic.jsonl:L2-L5
- source_session: session-miner-synthetic
- reason: inferred bounded retry with changed input
- date: 2026-08-18

## ADD 2
- lesson: WORKED: run the focused test path before the full suite.
- confidence: high
- evidence: session-miner-synthetic.jsonl:L6
- source_session: session-miner-synthetic
- reason: explicit assistant-stated lesson
- date: 2026-08-18

## ADD 3
- lesson: HAZARD: check the fixture directory before opening a trace.
- confidence: high
- evidence: session-miner-synthetic.jsonl:L7
- source_session: session-miner-synthetic
- reason: explicit assistant-stated lesson
- date: 2026-08-18

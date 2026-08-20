---
id: lesson-appended
capability: fleet-baseline
judge: output-contains
rubric_version: "1"
k: 1
source: curated
immutable: true
tier: T1
input:
  command: ["{python}", "-c", "from pathlib import Path; import sys; p = Path('memory') / (sys.argv[1] + '.md'); print('NONEMPTY' if p.is_file() and p.stat().st_size > 0 else 'EMPTY')", "{agent_id}"]
  contains: "NONEMPTY"
---
# lesson-appended - fleet baseline

Checks the decidable floor only: `memory/<agent-id>.md` exists and has at least
one byte. `{agent_id}` is substituted by a fleet run, so this one card applies
to any agent id.

Honest limit: a non-empty memory file does not prove that a lesson was appended
on every run, that its content is a real lesson, or that it is current. Those
per-run and semantic claims require evidence this deterministic file check does
not have.

Judge: `output-contains`; the probe prints `NONEMPTY` only for an existing,
non-empty target file.

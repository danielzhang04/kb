---
id: 6a7bdf5c-cf8f3fc5
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: d86621584a6c4036
state: done
approval: null
workflow: 019ff3dc-822e-7700-a145-0a51e02ed1fd
depends-on: []
variant-group: null
role: work
session-id: 6a7bde54-307bd065
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task B2 fix round 1 — transport-mode fidelity + bad_json assertion

Arc worktree is your cwd, branch `claude/codex-image-engine`. Scope: 
`orgs/faceless-youtube/.claude/skills/image-generation/scripts/_fake_codex.py` (transport
failure mode ONLY — this fix round explicitly sanctions touching the fake for finding 1;
change nothing else in it) and `.../test_forge_codex.py` (the two findings' tests), plus a
Fix report 1 appended to `.superpowers/sdd/2026-08-11-codex-image-engine/task-B2-report.md`.
NO codex calls, NO network, NO commit/push.

\## Findings (from fresh-context review of 4c7afa0)

1. IMPORTANT — transport-mode infidelity: the fake's transport failure emits an invented
   generic `stream error`, but the BANKED real failure (a TLS-blocked run) has a concrete
   shape. Source of truth (read both):
   - `scratch-codex-image-engine/p4-probe2-readonly-workercage-raw.jsonl` — the real event
     sequence: thread.started, then reconnect/error events, then turn.failed.
   - `scratch-codex-image-engine/p4-probe2-readonly-workercage-stderr.txt` — the real stderr
     (`invalid peer certificate: UnknownIssuer`, HTTPS fallback request failures).
   Make the fake's transport mode emit that measured shape (event types + the UnknownIssuer
   stderr line; verbatim strings from the banked files, truncation fine but no invention),
   and make the test pin it: thread.started present, turn.failed present (NOT turn.completed),
   the UnknownIssuer string in stderr, rc == the real run's rc (1), no PNG.
2. IMPORTANT — bad_json weak pin: the test only checks a marker string. Assert malformed-ness:
   at least one stdout line must raise json.JSONDecodeError when parsed; and the overall
   parse-all-lines loop must fail (i.e. a strict consumer would break).

Both fixes must keep all other tests green.

\## Verification to run and paste into the fix report
- `py -3 -m pytest test_forge_codex.py -q` → all green (12).
- `git diff --stat` → exactly the two named files.
- Entropy scan (`grep -noE "[A-Za-z0-9+/_-]{120,}"`) zero-hit on both changed files (you are
  copying strings from banked evidence — keep any copied fragment under 120 chars).

Final message: line 1 `B2-FIX1 DONE` or `B2-FIX1 BLOCKED: <why>`; pasted pytest tail + diff
stat + the exact stderr line the fake now emits for transport mode.

## Result

B2-FIX1 DONE

```text
............                                                             [100%]
12 passed, 2 warnings in 5.73s
```

```text
 .../skills/image-generation/scripts/_fake_codex.py | 26 ++++++++++++++-
 .../image-generation/scripts/test_forge_codex.py   | 37 ++++++++++++++++++++--
 2 files changed, 60 insertions(+), 3 deletions(-)
```

Entropy scan: zero hits. Fix report appended to [task-B2-report.md](C:\Users\danie\kb-worktrees\boss-codex-image-engine\.superpowers\sdd\2026-08-11-codex-image-engine\task-B2-report.md).

```text
ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: invalid peer certificate: UnknownIssuer, url: wss://api.openai.com/v1/responses
```

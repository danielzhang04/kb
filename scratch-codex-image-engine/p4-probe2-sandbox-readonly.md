# P4 Probe 2 — `--sandbox read-only` behaviour

Date: 2026-08-11. Branch `claude/codex-image-engine`.

## Command

The plan command was:

```text
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe2-readonly --cwd-mode tempdir --sandbox read-only --timeout 240 --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

The plan called for one bounded attempt with a 240-second tree-kill ceiling. Two attempts are
recorded below because the first was environmentally confounded and was not a valid measurement of
`--sandbox read-only`.

## Attempt 1 — codex-worker sandbox (confounded)

A codex dispatch worker ran the command from inside its own `workspace-write` sandbox, whose
shell-level network is blocked. The child `codex exec` received a thread id, then died after 34.1s
with repeated transport failures: `invalid peer certificate: UnknownIssuer` and HTTPS fallback
request failures. It returned 1, produced no usage block, and produced 0 images.

This measures the worker's network cage, not the requested `--sandbox read-only` behaviour; it never
reached the API and consumed 0 generations. The preserved evidence is:

- `p4-probe2-readonly-workercage-raw.jsonl` (1,903 bytes)
- `p4-probe2-readonly-workercage-stderr.txt` (2,175 bytes)

Thread id: `019ff399-06f8-74a3-aba9-b2795e3bda84`.

## Attempt 2 — host shell (real measurement)

The boss ran the exact plan command from the host shell with a temporary cwd, `--sandbox read-only`,
and `--timeout 240`.

| timed_out | wall_s | returncode | raw JSONL bytes | images | pre_call_tool_calls | input_tokens | cached_input_tokens | output_tokens | reasoning_tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| false | 114.1 | 0 | 31,909 | 1 | 6 | 174,751 | 145,408 | 2,977 | 1,665 |

Thread id: `019ff39e-c703-7dd2-96d8-47485dc332e4`. The raw stream is
`p4-probe2-readonly-raw.jsonl`; stderr is `p4-probe2-readonly-stderr.txt`. The call finished
rc 0, no timeout, 1 image on codex 0.146.1 — but not friction-free: the read-only sandbox
forced approval requests for two shell commands (a PowerShell base64 read of the prompt file),
and exec mode cannot serve approvals, so both were declined (`approval request failed`,
exit -1; five ERROR lines in stderr). The agent recovered via other read paths and completed
the turn. Consumed 1 generation, bringing the Phase A running total to 3 of 8.

## Process-tree checks

- Attempt 1: live codex process count 13 before and 12 after. No orphan was added.
- Attempt 2: live codex process count 10 before and 10 after. No orphan was added.
- Neither attempt reached the 240-second ceiling, so `kill_tree()` was not exercised by either
  attempt. Its first live test now falls to Task C6's tests.

## Verdict

**VERDICT:** neither of the plan's two anticipated outcomes occurred — the hang did not reproduce AND the call completed (rc 0, no timeout, 1 image) on codex 0.146.1, though with two sandbox-declined command approvals along the way. P2b's observed ~7-min hang is therefore not a stable property of `--sandbox read-only` (version drift or circumstance). One qualified success is not sufficient to re-sanction read-only: production remains `workspace-write` on an empty temp dir per spec §4.4; anyone proposing read-only needs their own confirmation runs.

## Nested-sandbox consequence

Real codex-API probes must run from the host shell. Dispatch workers cannot make nested codex API
calls: their own shell-level network restrictions can confound the child before it reaches the API.

## Commit-safety entropy scan

The boss scanned all four raw/stderr files from both attempts. The scan found zero hits; each grep
exited 1. No high-entropy scrub was required.

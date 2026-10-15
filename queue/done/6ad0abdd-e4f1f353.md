---
schema-version: 1
id: 6ad0abdd-e4f1f353
project: kb-ops
action: cleanup-lx-capability-review
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 3b971460e75424d6
state: done
approval: null
workflow: 01a13f1c-ad75-7f42-b6c6-7c69ebe051b6
depends-on: []
variant-group: null
role: work
session-id: 6ad0ab15-f6c37083
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Independent reviewer, not boss. Root preamble passed. Read only KB CLAUDE.md/governance/agent-rules.md, and under C:\Users\danie\Projects\Filesystem-Cleanup: scripts/test-nyu-lx-capability.ps1 (SHA045E04C84350D8D7CDE8A254D0FE8EFD1F6231E6F6A845B25B66CC3092519F10), its NOTE, briefs/claude-lx-capability-build.txt, reviews/claude-lx-capability-build.md. No other KB/project searches; no coursework/private logs/credentials. No edits/execution; review only. Native Claude authored, root PS AST parsed0errors, not compiled/executed yet.
Decide READY SYNTHETIC versus BLOCKED before isolated non-admin probe. Check paths/rename containment/create-new/nofollow APIs, C#flags and Win32 structures, no actual target opens by ourcode, robocopy /SL exact args and classification, honest stage limits. Root deliberately permits exit0 meaning valid measurement with rejectedroute: recoveryAcceptedalwaysfalse. No ACL/timewrites, normalfollowingopens, WSL or original reads in this stage. Scope not productioncopyengine. Identify actual safety/correctness blockers with minimalfixes separately from optional hardening. Nativeprivilege denial mustreportBLOCKED no escalation; no falsepass fromignorederrors/diffs. Childtimeout ownprocessonly vs tree/report logsize bounds distinguish practicalrisk tinyfixture fromclaim. Root will compile C# definitions without running main as part of independentchecks. Source hash rawbytesverify if shellreadpermitted; no script execution. Return scopedverdict and relevant testcases; do not inflate fixture into generalframework.

## Result

\## Verdict: READY SYNTHETIC

No safety or correctness blocker was found for the isolated, non-admin synthetic probe. The raw-byte SHA-256 matches the supplied value:

`045E04C84350D8D7CDE8A254D0FE8EFD1F6231E6F6A845B25B66CC3092519F10`

Key conclusions:

- Mutations are restricted to the newly generated fixture through normalized containment checks, no-reparse ancestor validation, and create-new/no-replace operations.
- Every C# file handle uses `OPEN_REPARSE_POINT | BACKUP_SEMANTICS`; reparse entries are treated as leaves. The program itself never opens the synthetic link targets normally.
- The LX buffer layout, Win32 structures, file-ID retrieval, and directory enumeration offsets are internally consistent.
- Native error 5 or 1314 from `FSCTL_SET_REPARSE_POINT` produces `BLOCKED`, exit 3, without privilege escalation or retry.
- Robocopy arguments are exactly the authorized `/E /SL /COPY:DAT /DCOPY:DAT /R:0 /W:0 /NP /UNILOG` route at [test-nyu-lx-capability.ps1:325](C:\Users\danie\Projects\Filesystem-Cleanup\scripts\test-nyu-lx-capability.ps1:325).
- A successful robocopy exit with flattening or omission is classified as a rejected route, while `recoveryAccepted` remains unconditionally false.
- Rename uses `MoveFileExW` flags 0, tests an occupied destination first, and compares identity, raw buffers, and regular payloads in both directions.
- EA, case sensitivity, complete metadata, SACL, cold restore, and WSL-authored objects are honestly deferred.

Optional hardening, not probe blockers:

1. The timeout branch ignores both a `Kill()` error and the result of the subsequent ten-second wait at [test-nyu-lx-capability.ps1:332](C:\Users\danie\Projects\Filesystem-Cleanup\scripts\test-nyu-lx-capability.ps1:332). With this tiny fixture and robocopy’s expected single-process behavior, the practical risk is small. A stronger version would refuse snapshots and rename if the process remains alive.

2. The 180-second limit is an elapsed-time acceptance check, not a hard watchdog around native calls; see [test-nyu-lx-capability.ps1:272](C:\Users\danie\Projects\Filesystem-Cleanup\scripts\test-nyu-lx-capability.ps1:272) and [test-nyu-lx-capability.ps1:499](C:\Users\danie\Projects\Filesystem-Cleanup\scripts\test-nyu-lx-capability.ps1:499). Documentation should call it a runtime budget unless the launcher supplies a hard outer timeout.

3. `routeAccepted` does not include the separately checked “copy identities differ” condition at [test-nyu-lx-capability.ps1:381](C:\Users\danie\Projects\Filesystem-Cleanup\scripts\test-nyu-lx-capability.ps1:381). An alias still creates a FAIL and exit 1, so this cannot produce an overall false pass, but adding `$aliased.Count -eq 0` would make the route field self-consistent.

Recommended independent checks before execution:

- Compile only the inline C# definitions.
- Confirm denial 5/1314 yields exit 3 and no robocopy or rename.
- Confirm exit `<8` plus flatten/omission yields `routeAccepted=false`, `recoveryAccepted=false`, and the deliberate measurement exit semantics.
- Confirm occupied rename preserves the marker and source.
- Exercise the robocopy timeout branch, especially the process-still-alive case.
- Confirm script alteration during execution produces a failed hash check.

Reviewed only the authorized constitution/rules, script, NOTE, build brief, and build review. No script execution, compilation, edits, project-wide search, private-data access, or production-copy-engine assessment was performed.

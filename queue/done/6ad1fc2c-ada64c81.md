---
schema-version: 1
id: 6ad1fc2c-ada64c81
project: kb-ops
action: nyu-recovery-draft-review
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 51aac1e2dacde799
state: done
approval: null
workflow: 01a1443c-8a64-7f53-a3f4-cb477af44754
depends-on: []
variant-group: null
role: work
session-id: 6ad1fb02-034b1e33
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Independent read-only review of newly authored NYU recovery drafts. Follow KB preamble. Exact scope under C:/Users/danie/Projects/Filesystem-Cleanup: scripts/home-nyu-provisional-capture.ps1, scripts/home-nyu-provisional-restore.ps1, scripts/test-home-nyu-hardlink-policy.ps1, reports/home-nyu-recovery-adaptation-notes.md, reports/home-nyu-short-prefix-path-check.json, reviews/codex-nyu-recovery-adaptation-review.md. Compare accepted originals scripts/ait26-provisional-capture-r3.ps1 and scripts/ait26-provisional-restore-r3.ps1 as needed. No other private files, project payloads, credentials, recovery manifests or logs. Do not modify files or execute main scripts. Pure synthetic test is allowed; no original access.

Review for concrete blockers to synthetic fixture testing and eventual ordinary-user provisional capture. This is NOT live move authorization. Evaluate explicit source-only hardlinks in exact two venv subtrees; source group validation, byte-complete independent copies, links normalization only for copy comparisons, strict source IDs/link drift, schema/policy parent-child coherence, native compilation correctness, unchanged source/write guards. Originals/accepted scripts stay unchanged. Empty credential exception is intentional while user permission pending. Existing SACL/atime/changeTime limits remain explicit. Avoid unchanged generic coverage demands; focus changed behavior.

Author notes L1 likely parent DACL mismatch at C:/Users/danie; L2 current parent mtime comparison could reject user's allowed new unrelated home entries. Treat as specific follow-up design issues, do not approve live execution around them. Root has now measured dated path lengths: recovery maxfile254/maxdir201, restore253/200, destination203/150, no overruns. Fresh runtime check still necessary. No scripts have run against actual source. Root will run pure test separately. Return ACCEPT FOR FIXTURE TESTING or REQUEST CHANGES with exact material findings, distinguishing known live blockers from code defects. Do not introduce persistent-lease framework. Verify actual responding model in dispatcher result. No commits or source edits.

## Result

\## ACCEPT FOR FIXTURE TESTING

No material code defect found in the changed hardlink behavior. This is not approval for live capture, cutover, or move.

Key conclusions:

- Hardlinks are enabled only for ordinary source files strictly beneath the two exact, case-sensitive venv prefixes. Recovery and restore remain strictly single-link.
- Source groups validate IDs, suffix pairing, metadata, stream shape, link counts, and external-alias counts consistently in both scripts.
- Copy comparisons normalize expected file links to `1`; source and same-object comparisons retain exact `sourceId` and `links`.
- Each pathname is copied independently with `CREATE_NEW`; recovery and restore identity-uniqueness checks remain present.
- Source/write guards remain confined to the fixed source, parent metadata, and generation.
- Manifest keys, counts, policy text, caps, and shared validators are textually identical across capture and restore.

Known live blockers—not fixture code defects:

1. The parent DACL gate will probably reject `C:\Users\danie` because it accepts only inherited allow ACEs: [capture script:1148](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/home-nyu-provisional-capture.ps1:1148). Do not work around this for live execution.

2. The full P0/P1 parent comparison includes parent write time and native size, so an unrelated new home entry can invalidate capture: [capture script:1667](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/home-nyu-provisional-capture.ps1:1667). This needs a deliberate design decision before live use.

3. The empty credential exception is correctly enforced and remains an intentional live stop condition: [capture script:1017](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/home-nyu-provisional-capture.ps1:1017), [restore script:1363](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/home-nyu-provisional-restore.ps1:1363).

One documentation follow-up: adaptation-notes L5 still says directory paths are unmeasured, but the scoped path report now records recovery `254/201`, restore `253/200`, and destination `203/150`, with no overruns. Update [adaptation notes:161](C:/Users/danie/Projects/Filesystem-Cleanup/reports/home-nyu-recovery-adaptation-notes.md:161) before treating the notes as current. A fresh runtime path check remains required.

Verification:

- PowerShell parsing: 0 errors in all five inspected scripts.
- Embedded C# compilation was attempted in isolation, but the read-only environment denied compiler temporary-file creation. No compiler diagnostic was produced. Fresh-runtime `Add-Type` compilation must therefore be the first fixture gate.
- Shared hardlink functions, fields, policy literals, caps, and schema keys matched textually.
- Draft hashes match the hashes recorded in the adaptation notes; accepted-original hashes also match.
- The synthetic policy test was inspected but not run, as requested; root’s separate run remains the execution evidence.
- The scoped directory is not a Git repository, so branch/base/merge state is unavailable.
- No files were modified, and no actual source, payload, credentials, manifests, or logs were accessed.

Model check: the runtime identifies this responder as GPT-5. No separate dispatcher-result artifact was present within the authorized scope, so requested-versus-responding model equality could not be independently checked from such a record.

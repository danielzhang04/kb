---
schema-version: 1
id: 6ad1ba7e-27a14cac
project: kb-ops
action: portable-tools-review
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 58a6f386b6544fce
state: done
approval: null
workflow: 01a1433d-2032-7de2-beac-411c55c7966d
depends-on: []
variant-group: null
role: work
session-id: 6ad1b99a-7937ee42
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Read-only independent review of compact ordinary-user portable tool migration script. EXACT ROOT C:\Users\danie\Projects\Filesystem-Cleanup. Read scripts\move-portable-tool-roots.ps1 SHA3FDC3688FDE1EB6E3AB4D81A97C36EB198C68F26B9385326D54CBB95409EF660, its NOTE, reviews\codex-tool-batches.md. Exclude original executable payloads, credentials, private logs; cleanup code/metadata only. GetContent/rg/hash allowed, no script execution/mutation.
User authorizes overnight samevolume organization, retained backups, noadmin. Fixed source/destination pairs for kb-tools and ffmpeg; content backup/verification with explicit replacement ACL/SACL limits, original-object rename preserves descriptors. Root fixed six scalar-empty Diff-Snap callers to @(...) and null Robocopy exit refusal; parse0. Root preparing a tiny synthetic scope-substituted end-to-end test, not broadframework.
Assess actual loss/collision/identity/consumer/path/backup/exception safety, native handles/no-follow/streams, noexistingdataoverwrite. Return READY FOR ORDINARY-USER PREPARE/APPLY if fixturepasses, or concrete blockers with exact minimal fixes. Do not demand complete SACL reconstruction for sameobjectrename or admin controls. Note no dynamic generic path params and allbackups retained. No new abstractions; don't block on cosmetic notes. Need verify changed-source/collision refusal and failure-afterintent preservesstate. Consider fileindex64+volumevalid on NTFS. Two versions nevermerged. No source userfile edits beyondrename authorized bythisscript.

## Result

\## Verdict

**READY FOR ORDINARY-USER PREPARE/APPLY IF THE SYNTHETIC FIXTURE PASSES.**

No concrete static blockers found.

Key evidence:

- Reviewed script hash matches the pinned SHA-256: `3FDC3688FDE1EB6E3AB4D81A97C36EB198C68F26B9385326D54CBB95409EF660`.
- The two source/destination pairs are fixed and cannot merge ([script](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:20)).
- Fresh retained backups use non-destructive Robocopy options, reject null or `>=8` exit codes, and are content-verified before manifest creation ([script](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:196)).
- Apply re-verifies both backup and exact live-source state before writing intent ([script](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:225)).
- Existing and dangling destination objects are refused. A later collision cannot overwrite because `MoveFileExW` uses flags `0`, with neither replacement nor copy fallback ([script](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:112), [native move](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:84)).
- Entries and ancestors are inspected through no-follow handles; reparse points, hardlinks, unsupported streams/attributes, and inaccessible metadata fail closed ([script](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:39), [snapshot](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:136)).
- On NTFS, volume serial plus 64-bit file index is suitable for this same-object rename check. The post-move comparison also checks owner/group/DACL; complete SACL reconstruction is correctly not required.
- After intent, the only live-tree mutation is the no-replace rename. Failures leave the observed source/destination state in place, record `NEEDS_INSPECTION`, and perform no cleanup, retry, overwrite, or rollback ([script](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.ps1:243)).
- The documented backup ACL/SACL and best-effort consumer limitations are accurate and non-blocking ([NOTE](/C:/Users/danie/Projects/Filesystem-Cleanup/scripts/move-portable-tool-roots.NOTE.md:62)). The prior consumer review found no relevant PATH or repository references ([review](/C:/Users/danie/Projects/Filesystem-Cleanup/reviews/codex-tool-batches.md:46)).

Fixture gate should confirm:

- Parse exit `0`.
- Ordinary Prepare → Apply → Verify succeeds.
- Source modification after Prepare refuses before intent/rename.
- Existing destination refuses without overwrite.
- Injected failure after intent preserves whichever source/destination state existed at the failing operation and produces exit `4`.

No scripts or payload binaries were executed, and no files were modified. Original executable payloads, credentials, and private logs were excluded.

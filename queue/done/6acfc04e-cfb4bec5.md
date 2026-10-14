---
schema-version: 1
id: 6acfc04e-cfb4bec5
project: kb-ops
action: filesystem-ai-preflight-review-retry
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: cbc6a2db19e97b2d
state: done
approval: null
workflow: 01a13b83-a779-7633-85a6-e3b4e5649453
depends-on: []
variant-group: null
role: work
session-id: 6acfbf4e-70316165
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Finish a narrow independent read-only review. TaskRoot C:/Users/danie/Projects/Filesystem-Cleanup outside KB. The previous review01a13b7c-572b-70b3-b0f0-fba61b0f23fd timed out during API research without a verdict; NOT accepted. Fresh explicit read-only worker required, no resumed sandbox. Spend first~2minutes reading code, then issue your concrete verdict within600seconds; do not expand into generic security frameworks or wholeKB searches.
Read only scripts/ai-recovery-preflight.ps1 and its NOTE plus briefs/claude-ai-preflight-audit.txt. Root already loaded governance; run required KBpreamble, honor existing governance. No source coursework/credentials/private logs, no script execution or mutations/delegation. ExactSHA556173AE7AA61D85D302BC4093538FBB42F6CF3357F2E781801A7F14FE4C5A89, PSparse passed, unexecuted. No web needed unless a specific disputed API fact requires it. API facts already verified in Microsoftdocs: NtQueryInformationFile FileEaInformation7 returns EA-size (not contents); GetFileInformationByHandleEx FileStreamInfo7 queries streams; FILE_ID_BOTH_DIR_INFO filename@104/fileID@96; FileCaseSensitiveInfo23. OPEN_EXISTING3, FILE_FLAG_OPEN_REPARSE_POINT0x00200000, BACKUP_SEMANTICS0x02000000.
Prioritize: is fixedsource READ-ONLY execution safe? Does any write target source, any traversal follow reparse, any unexpected API mutate or readbytes? Can queries fail into falseclear? Inspect nativeoffsets/errors/NTSTATUSpending and bufferbounds, treecount/unsupportedfeatures, outputCreateNew, parentDACLarrayhandling. Report separate verdict live-read safety vs accepting metadata negativecoverage. NOT_READY/SACLunknown intentionallyretained. Root is building disposable copies (6constantpaths retargeted into unique retainedfixture) for baseline, hardlink, junction, directoryADS, occupieddestination, oversizefile; do not execute them. Root already tested PSarray semantics: currentcode uses direct assignment Get-DerivedDirAces (not @()), so orderedACE comparisons differ as expected. No cutover/migration acceptance; concise concrete defects/line refs/minimalrepairs, avoid hypothetical goldplating beyond bounded500entry20MB metadata audit. Output final review even if some APIs remain explicitlyunknown; do not timeout silently trying to eliminate every uncertainty.

## Result

\## Findings

1. **MEDIUM — check/use races can violate the no-follow and source-read-only boundaries.**  
   [ai-recovery-preflight.ps1:165](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ai-recovery-preflight.ps1:165), [ai-recovery-preflight.ps1:333](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ai-recovery-preflight.ps1:333), [ai-recovery-preflight.ps1:464](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ai-recovery-preflight.ps1:464)

   `Test-Chain` validates path components and then closes every handle. Later child opens and the report creation resolve those paths again. If an intermediate directory is replaced with a junction between validation and use:

   - traversal can follow that intermediate junction and query metadata outside the fixed source;
   - the report creation can be redirected—including into the source tree—creating a new JSON there.

   `OPEN_REPARSE_POINT` protects only the final component, while identity checks happen after the out-of-scope object has already been opened and queried. `CreateNew` prevents overwriting but not creation in a redirected directory.

   Minimal robust repair: retain trusted directory handles and perform handle-relative child opens/report creation, preserving `FILE_OPEN_REPARSE_POINT`; do not rely on path revalidation alone.

2. **LOW — the NOTE’s verification status is stale.**  
   [ai-recovery-preflight.NOTE.md:3](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ai-recovery-preflight.NOTE.md:3), [ai-recovery-preflight.NOTE.md:75](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ai-recovery-preflight.NOTE.md:75)

   It says the script is “NOT PARSED” and parsing remains unverified, while the supplied evidence says PowerShell parsing passed for the exact reviewed hash. Update those statements to “parsed, not executed.”

\## Verdicts

- **Live-read safety:** Safe from source-content reads and source metadata mutation during ordinary, non-adversarial execution. The native calls request/query metadata only; no API reads file bytes or mutates source objects. `Add-Type` may create compiler temporaries, and the intended persistent write is the `CreateNew` report. It is **not strictly scope-safe under concurrent namespace replacement** because of finding 1.
- **Metadata negative coverage:** Do **not** accept it as authoritative complete negative coverage yet. Queries fail closed: EA nonzero NTSTATUS becomes UNKNOWN, case-query errors become UNKNOWN, stream/list/security failures block, malformed native buffers would throw and block, and `STATUS_PENDING` cannot become a false “absent.” However, SACL remains intentionally UNKNOWN, nested traversal is unlocked, and runtime/fixture tests remain outstanding. The result is suitable as bounded screening evidence, not migration or cutover acceptance.
- **Technical verdict:** **REQUEST CHANGES** for the claimed absolute no-follow/read-only containment guarantee. No HIGH or CRITICAL defect found.

Reviewed SHA-256 matches `556173AE7AA61D85D302BC4093538FBB42F6CF3357F2E781801A7F14FE4C5A89`. No script or fixture was executed, and no files were modified. Branch/merge state was outside this artifact-only review.

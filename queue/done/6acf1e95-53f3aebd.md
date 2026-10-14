---
schema-version: 1
id: 6acf1e95-53f3aebd
project: kb-ops
action: filesystem-pilot-cutover-plan
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 6e9d98855122172b
state: done
approval: null
workflow: 01a13909-f2dc-71d0-be3e-d8414513e76b
depends-on: []
variant-group: null
role: work
session-id: 6acf1d0c-f83109c2
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Independent Codex read-only pilot cutover planning reviewer. Explicit authorization selected cleanup reports/scripts/KB governance to OpenAI; no credentials/OAuth/private logs. Exactroot C:/Users/danie/Projects/Filesystem-Cleanup. Read pilot-operation-journal.md, ACCEPTANCE.md, reports/pilot-memory-patches/20261014T044437Z-5dc21796/manifest.json and selected prepared diff.patch files (in that run only), reports/memory-preimage-refresh-898991ec.json, recovery/atlas-design/provisional-parent-5ca17d0d91d5/report.json and manifests. Recovery capture passed38 checks; SACLunknown non-elevated but dated elevated empty evidence separate. Target moving only C:/Users/danie/atlas-design -> C:/Users/danie/Projects/Atlas/atlas-design, five precise memorydocs need10pathreplacements and sixthnochange. Need adversarial finalplan review: metadata/identity source preconditions, destinationabsence, newparentinheritedpermissions futurebehavior, exactmemoryapplication withpreimage guard, preserving memoryfileACL via in-place exclusive stream vsatomicreplace, failure/rollback after partialwrites and postmoveadditions, journal/idempotency, which actualwriters needfreeze and freshread route proof. Builder preparing only read-onlyrealpreflight + disposable rehearsal (no realapply yet). No codeacceptance of concurrentlywrittenrevision. Identify mandatorygates and minimal cutovermethod, nounnecessarynewharness, no credentials or broad nativecfgreading, no real execution/moves/copies/edits/delegation/commits. FollowKBworkerinstructions/preamble. Finite5min review.

## Result

Technical verdict: **BLOCK real cutover; memory patch content is READY.** The five patches correctly make 10 path replacements, and the sixth document correctly remains unchanged. The current recovery and script evidence is not yet a frozen, reviewable cutover transaction.

\## Mandatory gates

1. **HIGH — Establish a genuinely frozen checkpoint.**  
   The recovery report explicitly says it is provisional, and the memory refresh is observational only ([report.json](C:/Users/danie/Projects/Filesystem-Cleanup/recovery/atlas-design/provisional-parent-5ca17d0d91d5/report.json:9), [memory-preimage-refresh-898991ec.json](C:/Users/danie/Projects/Filesystem-Cleanup/reports/memory-preimage-refresh-898991ec.json:35)). During the window:

   - Stop Claude/agent sessions capable of writing either `C--Users-danie\memory` or `C--Users-danie-kb\memory`.
   - Stop editors, shells, agents, watchers, or jobs that can write the source or destination. Unrelated KB workers need not stop.
   - Keep every participating process’s cwd outside both paths.
   - Acquire exclusive handles to all six memory files before moving anything and retain them through acceptance.
   - Refresh the source capture only after that freeze. Any identity, content, metadata, entry-set, or destination change aborts the batch.

2. **HIGH — Prove the destination’s future permission behavior.**  
   Existing evidence records the old parent and source DACL, including several inheritable non-system ACEs ([original-parent.json](C:/Users/danie/Projects/Filesystem-Cleanup/recovery/atlas-design/provisional-parent-5ca17d0d91d5/manifests/original-parent.json:15)), but not the intended effective policy for future children at the new location. Capture the target parent’s identity/DACL and rehearse with an exact ACL model. Verify:

   - The moved directory retains its approved owner/group/DACL.
   - A newly created file and subdirectory inherit the intended effective permissions.
   - No ACL normalization is silently performed during cutover.

3. **HIGH — Lock all memory documents as one transaction.**  
   The concurrent draft opens files exclusively one at a time ([pilot-cutover.ps1](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/pilot-cutover.ps1:203)). That still permits a later document to change after the initial sweep and after earlier patches have landed. Acquire all six exclusive handles in deterministic order, validate every preimage through those handles, and only then rename or write.

4. **MEDIUM — Resolve the SACL limitation explicitly.**  
   Recovery passed 38 checks but retains one unknown: SACL coverage ([report.json](C:/Users/danie/Projects/Filesystem-Cleanup/recovery/atlas-design/provisional-parent-5ca17d0d91d5/report.json:149)). The dated elevated empty-SACL evidence is not a current frozen observation. Require either:

   - A fresh elevated, read-only seven-object SACL check during the window; or
   - Daniel’s explicit acceptance that same-volume rename preserves the live objects but recovery cannot reproduce unknown audit entries.

5. **MEDIUM — Pin the apply revision and interruption semantics.**  
   The current runner deliberately has no real apply mode and is concurrently changing ([pilot-cutover.ps1](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/pilot-cutover.ps1:4)). Before approval, pin one reviewed script hash. Its resume logic must reconcile journal intent against observed identity:

   - Source present/destination absent: rename not committed.
   - Source absent/destination has expected file ID: rename committed.
   - Both present, both absent, or identity mismatch: stop.
   - A patch in `writing` state: accept exact postimage, accept exact preimage, or restore a torn image from its verified retained preimage.

\## Minimal cutover method

1. Freeze only the affected writers and acquire exclusive handles to all six memory files.
2. Produce the final frozen recovery capture; verify exact directory/file identities, hashes, timestamps, attributes, owner/group/DACL, streams, hard-link counts, reparse absence, same volume, target-parent identity, and target absence.
3. Create unique retained memory preimages and an append-only, flushed journal.
4. Perform one atomic, no-replace, same-volume rename. Recheck old-path absence and destination identity/metadata.
5. Apply the five reviewed postimages **in place through the already-exclusive handles**; audit the sixth unchanged. Verify postimage hashes and unchanged file identity/security metadata after each write.
6. While writers remain stopped, run fresh consumers rooted at both `C:\Users\danie` and `C:\Users\danie\kb`. Confirm memory lookup opens all six destination documents, all five repaired references resolve, the old path fails, and no junction/alias exists.
7. Record acceptance, close handles, then resume writers.

Use in-place exclusive writes, not an ordinary temp-file atomic replacement. This preserves the existing file objects, ACLs, and named streams. The torn-write risk is bounded by flushed retained preimages, journaled intent, exact-hash recovery, and keeping writers frozen.

On failure, recover a torn current file first, reverse completed patches only when each file is still the exact reviewed postimage, and reverse the directory rename only when the old path is absent and the destination retains the expected identity. Post-move additions travel back with the directory; never overlay the older recovery copy. If the old path is occupied or any memory file contains newer work, preserve both states and stop, as required by the journal and acceptance rules ([pilot-operation-journal.md](C:/Users/danie/Projects/Filesystem-Cleanup/pilot-operation-journal.md:18), [ACCEPTANCE.md](C:/Users/danie/Projects/Filesystem-Cleanup/ACCEPTANCE.md:17)).

No files, configurations, credentials, repositories, or live paths were modified. The moving script revision was inspected only for plan risks and was not accepted.

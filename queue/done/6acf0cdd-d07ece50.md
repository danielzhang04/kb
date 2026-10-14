---
schema-version: 1
id: 6acf0cdd-d07ece50
project: kb-ops
action: filesystem-acl-fidelity
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: 95a0fbda46417f67
state: done
approval: null
workflow: 01a138c7-b042-7891-be56-8d0ce6fee338
depends-on: []
variant-group: null
role: work
session-id: 6acf0c1d-f803ee7c
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

﻿Independent Codex storage/security reviewer. READ ONLY from KB, exact artifacts under C:/Users/danie/Projects/Filesystem-Cleanup. Read scripts/pilot-recovery.ps1, scripts/pilot-recovery.ACL-RESTORE-NOTE.md and fixtures/atlas-design-selftest/nativeacl-{Normal-3bcc7202,Protected-76256933,StaleInheritance-55281929}/recovery/report.json. Also recovery/atlas-design/provisional-20261014T044938Z-315f6702/report.json. No writes, no actualsourcecopy/move, no metadatachanges, no secrets or delegation. Need resolve one precise question: restoring owner/group/DACL with .NETSetAcl adds an inherited ACE from differentoutputparent; native SetKernelObjectSecurity preserves exactACEset/protectedstate but clears SE_DACL_AUTO_INHERITED (SDDL AI), so exactSDDL tests fail. Source untouched; allfailuresstrictlystop. Do not blindly propose another untestednativeAPI. Consult only Microsoft primarydocs and installed existingbackup tooling for supportedoptions. Distinguish functional access/inheritance preservation, backup archive representation of exactdescriptor, and literal descriptorbitfidelity. Is AIflag normalization operationally benign with tests, or materiallychangesfuturebehavior? Propose conventional minimal reliable backup/restore contract and exactdisposable tests incl futureparentACLpropagation, or identifytruehuman/admin dependency. Userdemandsnothingbreak andprecision; no unannounced weakening, no blanketACLchange originals, no externalbackuprequirement (localchosen), no universal privilegedworker. Can suggest rawSDDLsidecar plusdata preservation when properlyproved but cannotdeclarecompletewithouttest. SACLunknown remainsseparatependinguser elevatedread. Sourcefolder6MD114721bytes; actualmigrationwouldbesame-volume rename preservingobjects, recoverycopyonlyfallback. Output conciseevidence-linkedtechnicalverdict andnextstep; finish6min. Runpreamble asrequired; no branchwork.

## Result

Verdict: **BLOCK / REQUEST CHANGES** for treating the fallback recovery copy as complete. The real source remains untouched, all failures stopped safely, and the planned same-volume migration rename remains the safest path.

The native restore preserves owner, group, ACE set, inherited-ACE markings, and protected state, but all three disposable cases lose `SE_DACL_AUTO_INHERITED` (`D:AI` / `D:PAI` becomes `D:` / `D:P`) and exit 3:

- [Normal report](<C:/Users/danie/Projects/Filesystem-Cleanup/fixtures/atlas-design-selftest/nativeacl-Normal-3bcc7202/recovery/report.json>)
- [Protected report](<C:/Users/danie/Projects/Filesystem-Cleanup/fixtures/atlas-design-selftest/nativeacl-Protected-76256933/recovery/report.json>)
- [Stale-inheritance report](<C:/Users/danie/Projects/Filesystem-Cleanup/fixtures/atlas-design-selftest/nativeacl-StaleInheritance-55281929/recovery/report.json>)

The earlier real run correctly exposed the opposite failure: `.NET Set-Acl` retained `AI` but recomputed inherited ACEs from the recovery parent. See [provisional report](<C:/Users/danie/Projects/Filesystem-Cleanup/recovery/atlas-design/provisional-20261014T044938Z-315f6702/report.json>).

\### Precise AI ruling

Clearing `AI` is immediately access-neutral when the ACE sequence and `P` state are unchanged. It is **not proved operationally benign over time**.

Microsoft defines `SE_DACL_AUTO_INHERITED` as identifying a descriptor configured for the current automatic-inheritance model. `SetSecurityInfo`/`SetNamedSecurityInfo` impose that model during propagation to existing descendants. Therefore, losing the bit may affect later parent-ACL propagation or conversion behavior; it is not merely an SDDL presentation difference. [Security descriptor control](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-control), [automatic propagation](https://learn.microsoft.com/en-us/windows/win32/secauthz/automatic-propagation-of-inheritable-aces), [SDDL flags](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-string-format).

For a protected DACL, retaining `P` prevents parent ACEs from changing it, so losing `AI` is less likely to affect access while protection remains enabled. That does not justify weakening the literal-fidelity assertion globally.

\### Minimal reliable contract

Separate three guarantees:

1. **Functional recovery:** data, streams, attributes, times, owner/group, DACL ACEs, inherited flags, canonical ordering, and protected state reproduce verified access semantics.
2. **Archival representation:** retain source SDDL plus the raw self-relative security-descriptor bytes and hashes as sidecars. This preserves evidence of the exact descriptor even if NTFS normalizes a restored descriptor.
3. **Literal descriptor restoration:** require binary/control-bit equality only after a supported mechanism proves it. Do not silently waive `AI`.

Keep `robocopy /COPY:DATSO` for payload files. Installed alternatives do not presently close the gap:

- `icacls /save` archives only DACLs—not owner, SACL, or integrity labels. [Microsoft icacls documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)
- Installed `tar` claims ACL/owner restoration with `-p`, but its Windows descriptor/control-bit fidelity is untested.
- `wbadmin` is conventional VSS backup, but requires elevation/Backup Operators and a suitable backup target, making it a genuine human/admin dependency rather than a universal worker path. [Microsoft wbadmin documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/wbadmin-start-backup)
- Windows backup streams can represent security-descriptor data, but adopting a new `BackupRead`/`BackupWrite` implementation without tests would repeat the untested-native-API problem. [WIN32_STREAM_ID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-win32_stream_id)

\### Required disposable proof

For normal, protected, and stale-inheritance fixtures, test the chosen restore mechanism under a deliberately different output-parent DACL:

1. Compare raw descriptor bytes, SDDL, control flags, ACE sequence, `IsInherited`, owner/group, and `AreAccessRulesProtected`.
2. Add a unique inheritable allow ACE to each fixture parent through a supported Windows ACL operation; verify whether it propagates identically to source-control and restored trees.
3. Remove that parent ACE; verify identical removal behavior.
4. Create children before and after both changes; compare their DACLs and effective rights.
5. Toggle inheritance disable/copy, then re-enable, on disposable copies and compare resulting descriptors.
6. Repeat archive/restore after those transitions.
7. Require every mismatch to fail closed. Keep SACL as a separate unresolved gate pending an elevated human read.

Until these tests pass, a raw-SDDL/binary sidecar plus verified data copy is a useful provisional archive, not a complete literal-descriptor restore. No source copy, move, ACL change, or other write was performed in this review.

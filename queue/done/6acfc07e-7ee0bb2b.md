---
schema-version: 1
id: 6acfc07e-7ee0bb2b
project: kb-ops
action: filesystem-native-envelope-probe
target: C:\Users\danie\Projects\Filesystem-Cleanup
risk-tier: T1
owner: codex-worker
claim-token: c0624278009d2698
state: done
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
session-id: 6acfc078-cfdfbc27
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Codex implementation worker, user explicitly requests 50/50 realClaude/Codex substantive work. TaskRoot/CWD C:/Users/danie/Projects/Filesystem-Cleanup. Write ONLY scripts/test-native-parent-envelope.ps1 and scripts/test-native-parent-envelope.NOTE.md. No execution, originalproject reads, credential/private logs, network, deletion, governance/hooks edits, commits or delegation. Read reports/ai-parent-descriptors-7eab392f2c174129a5b8cc1bff52df61.json and fixtures/ai-preflight-c8f4b3941e35497f9da3361294dffe46/results.json plus baseline/reports/*.json (reports only, never follow fixturejunctions), scripts/test-nyu-plain-recovery.ps1 and its NOTE, scripts/ai-recovery-preflight.ps1 helpers ifuseful. These selected cleanupreports/scripts fall within user's authorized payload scope.
Problem: actualsourceparent source/repos and ai have inherited allow-ACE order beginning sandboxSIDs before SY/BA/owner; converting parentprojection through .NET DirectorySecurity canonicalizes/reorders, so existing restoremethod correctlyrefuses. Must NOT change sourcepermissions or relaxexactcomparison. Need a TINY SYNTHETIC native API probe before anygeneralengine. Microsoft SetNamedSecurityInfoW docs explicitly say it does not reorder allow/deny ACEs; URL https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setnamedsecurityinfow (already verifiedbyroot). Test that claim empirically using raw serializedSDDL -> ConvertStringSecurityDescriptorToSecurityDescriptorW/GetSecurityDescriptorDacl/SetNamedSecurityInfoW(SE_FILE_OBJECT,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION), LocalFree. Use standardreadback GetNamedSecurityInfo or handle GetKernelObjectSecurity + RawSecurityDescriptor; avoid passingwriteACLthroughDirectorySecurity. No owner/groupchanges to existingobjects. Preserveallfixturefiles. Run onlynon-elevated and fixed GUIDroot TaskRoot/fixtures/native-envelope-<GUID>, allnative mutation targets validated absolute descendant, ordinaryancestorchain, no sourcepathsargument/input. Script may read ONLY the fixed cleanupdescriptorreport (not source) to construct expected plainA/OICI patterns; validate allACEs are simpleALLOWspecificrights no creator/deny/callback/unknown flags, or refuse.
Create syntheticparent with protected explicit allowACEs in sourceparent'sobservedorder (stripID only, currentuseraccessmustremain), syntheticchildandgrandchild. Compare on-disk parentorder and childinheritedACEorder against exactexpected (no sorting). Capture descriptorcontexttoJSON uniquely. Independently create recovery/restoreenvelopes ONLY from serializedmetadata (avoid live-sourceparentvariabledependency), create freshchildandgrandchild, comparefullOwnerGroupDACL/protection and orderedinheritance withsyntheticsource. Include .NET route comparison as expectednonpreserving diagnostic, notpass requirement ifOSbehaviorchanges. Create disposable postrestorefile to check inheritedpermissions, and confirm sourcefixtureSD unchanged. No coldsourcefilepathdependency in restorefunction. Return eachPASS/FAIL/UNKNOWN +codehash/reportpath; SACLunknownexplicit. No productionpermissionchanges, no migrationengine, no arbitrarypathtargets, no implicitprivileges or UAC, no delete. Rootwillreview/execute and Claudewillindependentlyreview. Aim<300lines, avoid broadnewframework. Do not claimtested; noexecute. Any invalidownership/accesspatternfailclosed. ExactAPI/nativeerrorhandling; no fallback to reorderedACL.

## Result

FAILED: codex exec exit 1; JSONL log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6acfc078-cfdfbc27.jsonl

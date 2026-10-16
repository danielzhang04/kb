---
schema-version: 1
id: 6ad1f7ba-f46d5fc1
project: kb-ops
action: nyu-recovery-edit-map
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: d37d35c4dc996f9e
state: done
approval: null
workflow: 01a14428-5978-7001-815e-3245d7dbc82f
depends-on: []
variant-group: null
role: work
session-id: 6ad1f5d6-e26cee81
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 08112501673b02802220991797ab8588dbe1ec75
---

## Work order

Read-only design review, not implementation or execution. Follow KB preamble. Exact scope under C:/Users/danie/Projects/Filesystem-Cleanup: reports/home-nyu-hardlink-plan.md, scripts/ait26-provisional-capture-r3.ps1, scripts/ait26-provisional-restore-r3.ps1, scripts/ait26-cutover-live-r3.ps1. No source-project payloads, credentials, private logs, recovery manifests or architecture documents. Review these selected cleanup reports/scripts under existing user authorization. Return concise concrete edit map, with exact functions/fields and review/test cases; do not create or modify files.

Goal: reuse accepted code for home NYU ordinary-user same-object move with COMPLETE independent byte-copy recovery, including two existing Windows venvs. Source C:/Users/danie/nyu -> Projects/NYU/nyu. Source inventory 27516 entries, 642791641 bytes, largest file80636040. All18312 hardlinked names occur under data-mgmt/.venv and software-eng/.venv; 17544 unique IDs,768 two-name cross-venv groups; all groups have additional aliases outside root. No outside-venv hardlinks. Independent backup copies intentionally have links1 and no links to shared caches. Live rename must preserve all source identities/links. Retain all originals/backups; no rewriting linked dependency payloads, admin, ACL relaxation or deletion. Author recommendation to omit environment byte backups is REJECTED by root as insufficient for user recovery expectations; retain complete byte recovery. Existing unsupported-attribute/security limits must remain explicit, not silently relaxed. Credential exception for NYU is pending; do not add general credential permission. Can design before that answer.

Assess minimal adaptation: scope source hardlink acceptance only to exact two named venv subtrees and ordinary files; include per-name links and source IDs in manifests; allow duplicate source IDs only consistent scoped groups; destination/recovery/restore files remain unique links1; source A/B and live rename compare exact original groups, while copy comparison uses intentional links1 normalization. Keep all other refusal checks. Raise measured file/total caps to128MiB/1GiB. Short proposed recovery prefix C:/Users/danie/Recovery/NYU/g-32hex (max projectedfile254; dirs still need check), not created. Identify blockers and smallest precise changes, not generic framework. Consider locking/hardlink-sharing TOCTOU and restore semantics. Distinguish necessary tests from existing unchanged coverage. Also note this is not authorization for a real move; real frozen recovery and runtime/config checks remain required.

## Result

\## Verdict: REQUEST CHANGES

The accepted AIT26 code is reusable, but changing only paths and caps would fail immediately: source hardlinks are rejected during native inspection, manifest construction, restore validation, and cutover scanning. The smallest safe adaptation is a narrowly scoped NYU hardlink policy—not a generic hardlink mode.

\### Concrete edit map

1. [home-nyu-hardlink-plan.md](C:/Users/danie/Projects/Filesystem-Cleanup/reports/home-nyu-hardlink-plan.md:107)

   - Replace the recommendation at lines 107–128. The authority split and metadata-only venv recovery are rejected.
   - Specify complete independent byte copies for the entire root, including both venvs.
   - Retain the limits at lines 69–74: restored copies are independent objects and do not rejoin the 768 internal groups or outside aliases.
   - Clarify that the live destination preserves original identities/groups; only recovery and child-restore copies normalize ordinary files to `links == 1`.
   - Add the pending credential decision, directory-path measurement, external-alias freeze, and final frozen-generation checks as live blockers.

2. [ait26-provisional-capture-r3.ps1](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ait26-provisional-capture-r3.ps1:57)

   - Retarget fixed constants to:
     - source `C:\Users\danie\nyu`
     - source parent `C:\Users\danie`
     - leaf `nyu`
     - generation root `C:\Users\danie\Recovery\NYU`, yielding `g-<32hex>` directly
   - Change both caps at lines 103–108 to `128MB` per file and `1GB` ordinary total.
   - Remove the AIT26 credential exceptions at lines 94 and 123–126. Use an empty exact exception list and “all credential-store names refused” policy until NYU approval exists.
   - Extend each manifest entry with `links = $Node.Links`; `sourceId` already exists at lines 929–946.
   - Change native `Inspect` at lines 597–650 to accept an explicit source-hardlink mode. In that mode, allow `Links > 1` to reach payload reading; default mode must retain `Links == 1`.
   - Change `Read-Inspect`, `ConvertTo-Record`, and `Read-Tree` at lines 856–988 to pass that mode explicitly. Permit `Links > 1` only when:
     - kind is `file`;
     - path is strictly beneath `data-mgmt\.venv\` or `software-eng\.venv\`;
     - all existing stream, EA, attribute, reparse, size, ownership, and DACL checks still pass.
   - Replace `source.identitiesUnique` at lines 1533–1541 with a group validator:
     - `links == 1` IDs remain unique;
     - repeated IDs occur only across the two exact venv scopes;
     - a repeated group has exactly one name per venv with the same venv-relative suffix;
     - all members agree on link count and object metadata;
     - in-root group size never exceeds `links`;
     - no linked file exists outside those scopes.
   - Add counts such as `hardlinkedNames`, `hardlinkedSourceIds`, `duplicateSourceIdGroups`, and `externalAliasCount`; reconcile expected `18312 / 17544 / 768 / 144448` only for the frozen live inventory, not as permanent constants.
   - Split comparison fields:
     - source S0/copy-time/S1: content + `sourceId`, `nativeSize`, and `links`;
     - copy comparisons: content + `links`, using an explicit view that rewrites expected ordinary-file `links` to `1`.
   - Keep recovery uniqueness checks at lines 1538–1541 and require every recovery ordinary file to report `links == 1`.
   - The copy loop at lines 1502–1520 should remain one `CREATE_NEW` operation per pathname. This naturally gives the two names of a duplicated source ID separate recovery identities.

3. [ait26-provisional-restore-r3.ps1](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ait26-provisional-restore-r3.ps1:48)

   - Apply the same path, cap, policy-text, schema, count-field, and credential changes.
   - Add `links` to `$EntryKeys` at line 738.
   - Manifest validation at lines 1269–1337 must accept source `links > 1` only through the same exact group validator; replace the blanket duplicate-ID refusal at lines 1330–1332.
   - Do not relax `ConvertTo-Record` at lines 815–877 for recovery or restore trees: those remain strictly `links == 1`.
   - Before comparisons at lines 1375–1383 and 1444–1463, normalize the manifest’s expected file links to `1`, then compare `links` as a real field.
   - Preserve recovery/restore identity uniqueness and disjointness. Injected hardlinks in either tree must fail.
   - Keep the per-path restore loop unchanged in shape: every manifest name is independently created, including two names that formerly shared a source ID.

4. [ait26-cutover-live-r3.ps1](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ait26-cutover-live-r3.ps1:42)

   - Retarget source/destination/generation roots at lines 82–99.
   - Update hashes in `$CodePins` only after the adapted capture and restore scripts pass review.
   - Update the exact imported constants/functions at lines 146–171, including new group validation, `links`, caps, and the empty credential exception.
   - `Get-A25Generation` at lines 534–580 must independently validate the scoped source groups and new counts, rather than accepting arbitrary duplicate IDs from a pinned manifest.
   - `Compare-A25Tree` at lines 514–529 must use exact source semantics: pathname, `sourceId`, `links`, content, metadata, streams, and descriptors. Do not normalize links during Prepare, Apply, post-rename, or Rollback.
   - S0/S1-equivalent scans at lines 652–654, 707–713, 731–734, and 773–813 must run in explicit source-hardlink mode.
   - Preserve the same-volume identity gate and rename-only behavior. The live destination must retain all original file IDs, link counts, and outside aliases.

\### Remaining blockers

- The proposed recovery prefix solves the projected file maximum of 254, but every projected directory path still must be measured against the existing 247-unit limit.
- Current per-file inspection holds a share-read-only handle only during one read ([capture lines 597–650](C:/Users/danie/Projects/Filesystem-Cleanup/scripts/ait26-provisional-capture-r3.ps1:597)). It does not prevent an outside alias from changing between files or between preflight and rename. Live use therefore still requires a verified writer freeze covering shared-cache/other-environment writers. If persistent leases are proposed, first prove in a fixture that their share mode both blocks alias writes/deletes and permits the parent directory rename; otherwise leases could make cutover impossible.
- The selected capture is explicitly provisional and records `writerFrozen = false`. A real frozen generation, runtime/config checks, and fresh count reconciliation remain mandatory before live approval.
- Pending NYU credential approval remains narrow and explicit. Without it, a matching credential-store name must stop before content is opened.
- Child restore proves an independent copy inside the generation. It is not rollback and does not install files back at `C:\Users\danie\nyu`; rollback remains reverse rename of the unchanged live tree.

\### Newly necessary tests

- Accept one externally aliased file under each named venv and one valid two-name cross-venv group; verify manifest source IDs/link counts and independent recovery/restore identities.
- Refuse hardlinks outside the two venvs, repeated IDs within one venv, mismatched cross-venv suffixes, group size greater than link count, and inconsistent member metadata.
- Detect link-count or group-identity drift at copy time, S1, Apply preflight, post-rename, and Rollback.
- Verify source-to-copy comparison passes only after explicit `links = 1` normalization; injected recovery/restore hardlinks fail.
- Boundary tests for 128 MiB/1 GiB and file/directory path limits, including the measured NYU maximums.
- Verify credential-name refusal with no NYU exception.
- Exercise outside-alias write/delete attempts during capture and cutover freeze.
- Verify forward rename and reverse rename preserve the exact original group map and external link counts.

Existing unchanged coverage should be rerun for reparse/no-follow behavior, EAs and streams, unsupported attributes, DACL/owner rules, explicit SACL/last-access/change-time limitations, `CREATE_NEW`, strict manifest parsing and pinning, journals, approval windows, partial-output retention, and same-volume rename.

No files were changed, no selected script was executed, and no payloads, credentials, manifests, private logs, or architecture documents were inspected. This review does not authorize a real move.

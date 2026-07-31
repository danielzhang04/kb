# FYT roster delivery — live rerun handoff — 2026-07-31

**Topic:** PR #109's boot-handshake/native-path fix wave is built, independently approved, pushed,
and dry-prepared. The only next action is the live 7/7 rerun after the Aug 1 9 PM America/New_York
Claude-cap reset; merge, maiden-video spend, and publish remain human-gated.

### What WORKED (with evidence)

- **Seven mechanical delivery fixes plus the server-minted boot-ready handshake landed** — branch
  `claude/fyt-full-run` is clean at `051de9e` and matches `origin/claude/fyt-full-run` (0/0).
  `f2793dd` fixed argv ordering, chunk-split busy recognition, early lease/liveness settlement,
  deadline-final status reads, bounded CSI retention, artifact/control path checks, and added the
  per-session `ready.json` token handshake.
- **The remaining path races were rearchitected, not rechecked by pathname** — `051de9e` added
  `dashboard/server/win32/noReparseFiles.ts`: lazy Koffi `NtCreateFile`, rooted relative opens with
  `OBJ_DONT_REPARSE`, handle-bound read/write/hash/delete, type/reparse/hardlink rejection, and
  finite non-recursive retirement. Roster control and artifact I/O no longer use the deleted
  `verifiedControlPath`, `verifiedArtifactPath`, or recursive `rmSync` seam.
- **Native behavior is proven on this Windows host** — elevated focused Vitest passed 2 files,
  88/88 tests, including a real junction substituted immediately before delete/write while the
  external sentinel remained unchanged. An elevated direct probe opened `package.json` through the
  rooted API and returned a valid size/identity. `npm.cmd run typecheck`, `git diff --check`, and
  `py -3 scripts/canary.py --diff-guard` passed.
- **Fresh adversarial security review approved the current worktree** —
  `/root/native_security_review` returned APPROVE with no actionable findings after examining the
  Koffi ABI, NT namespace/root parsing, share modes, hardlink timing, cleanup, boot/status flow, and
  artifact semantics. A sandbox-only `STATUS_ACCESS_DENIED` was retracted after the same probe passed
  elevated.
- **The accepted same-user limitation is now stated accurately** — the existing code comment and
  2026-07-31 decisions entry say artifact checks prove safe current in-repo state, not writer identity.
  A same-user sibling can forge a receipt and author an ordinary in-repo artifact delta; Daniel
  explicitly accepted that residual instead of IPC/accounts/ACL isolation. Unsafe/external-reparse,
  receipt-only, stale, unchanged, and non-regular evidence still parks.
- **Broad regression evidence is understood** — the full dashboard run completed 2,354 passing and
  5 skipped tests. Two unrelated 5-second timeouts passed when isolated (123/123). The one remaining
  failure is an unchanged `workflowRun.test.ts` assertion against unchanged `agent_runner.ps1`; both
  files are identical to baseline `b965454`, so this patch did not create it.
- **The external live harness now proves the new channels** — Fact 5 parses the server-authored boot
  token/path from `binding.md` and requires exact one-key `ready.json`; it parses the delivery
  token/path from `orders/idea.md` and requires exact token/verdict/summary `status/idea.json`, DONE,
  a matching token, a nonempty one-line summary, the independent artifact delta, and API success.
  Deleted marker/ANSI/PTY-capture dependencies are gone; Facts 1-7 remain.
- **Stale-code execution is fail-closed** — the harness now verifies source root equals operand root,
  exact clean reviewed HEAD, and offers `--preflight-only` before any state mutation/daemon start.
  The disposable repo was retargeted from `9d0e3bc` to reviewed `051de9e`, `npm.cmd run build` passed,
  and preflight passed without launching a daemon or session.

### What Did NOT Work (and why)

- **The first boot-handshake commit `f2793dd` was not review-clean** — fresh review found a real
  check/use race: it returned a validated path string and later used `rmSync`/`writeFileSync`, so a
  same-user process could substitute an intermediate junction and redirect server deletion/write;
  artifact verification had the same weakness. `051de9e` replaced that architecture with native
  rooted handles.
- **A Node-only/pre-opened-descriptor design was insufficient** — Windows Node exposes neither
  `O_NOFOLLOW` nor child-relative `openat` operations; retained leaf descriptors also break atomic
  receipt replacement and cannot verify an artifact that was absent at delivery. The native layer
  was required.
- **A native probe initially returned `STATUS_ACCESS_DENIED`** — the managed review sandbox denied
  native traversal. The identical elevated probe passed, proving this was sandbox ACL behavior, not
  a product failure. Do not retry or diagnose it as an NT ABI defect without elevated evidence.
- **The first harness preflight correctly refused** — the disposable repo was still at `9d0e3bc`
  while the expected reviewed commit was `051de9e`. After the explicit disposable checkout and build,
  preflight passed.
- **The full suite was not wholly green** — one deterministic baseline assertion remains as described
  above; do not spend this live-rerun session repairing unrelated runner-source drift.

### What Has NOT Been Tried Yet

- The new boot/status/native-handle code has **not** been run through the live Claude roster. The
  previous 7/7 live proof was at `9d0e3bc`, before the completion-channel and boot-handshake changes.
- PR #109's body still describes the earlier five-fix wave; rewrite it only after the new live run is
  7/7.
- PR #109 has not been merged. It is OPEN/HELD at
  `https://github.com/danielzhang04/kb/pull/109`; Daniel owns the merge decision.
- The maiden video has not been proposed or run. It stays behind Daniel's G2/G3b spend and G4 publish
  gates even after PR #109 is accepted.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `dashboard/server/control/rosterSessions.ts` | DONE | Boot handshake, status completion, delivery fixes, rooted control/artifact seam. |
| `dashboard/server/control/rosterSessions.test.ts` | DONE | 84 focused roster tests; updated rooted fake seam and regressions. |
| `dashboard/server/win32/noReparseFiles.ts` | DONE | Native rooted no-reparse, handle-bound Windows file layer. |
| `dashboard/server/win32/noReparseFiles.test.ts` | DONE | Four real Windows integration tests; focused total is 88/88. |
| `orgs/faceless-youtube/knowledge/decisions.md` | DONE | Daniel's boot-handshake and precise cross-agent limitation rulings. |
| external `scratchpad/dry-check/run-dry-check.mjs` | DONE, uncommitted scratch | Status/ready Fact 5 plus exact-SHA preflight. Edited SHA-256 `99FFE66C98D332DCF7E16ADC49B8D49D8C60CBE950CB6DEDAFFA1EEF40DD56C4`; backup `.pre-status-channel.bak` has original SHA-256 `022141A1582173E620B555425E6031BB5EF9F7D1E58B9985FDAEBB830F1E022A`. |
| external `scratchpad/dry-check-repo` | READY | Disposable detached operand at `051de9e`; dashboard rebuilt; preflight green. Existing old-run files are untracked and intentionally preserved. |

### Exact Next Step

After **2026-08-01 21:00 America/New_York** (not before), confirm port 4519 is free and
`DASHBOARD_EXECUTION_ACTIVATED` is unset. From:

`C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\161e0c0f-fba6-4c40-86c4-c0d9863d0801\scratchpad\dry-check`

run:

```powershell
node run-dry-check.mjs --preflight-only --expected-sha 051de9e3284b30ea7764af672828fcbe71896b8a
node run-dry-check.mjs --fresh --slug dry-check-2026-08-01 --expected-sha 051de9e3284b30ea7764af672828fcbe71896b8a
```

Require Facts **1-7 all PROVEN**, especially Fact 5's boot channel, status channel, artifact delta,
and succeeded stage. Do the external OS/model and UI checks against `state/live-run.json`, then create
`state/proceed-to-retire.flag` so Fact 7 retires cleanly. If any fact is NOT-PROVEN, keep PR #109 held,
save exact daemon/harness evidence, and repair/re-review before another live spend.

Only after 7/7: rewrite PR #109's title/body for commits through `051de9e`, present the reviewed merge
gate to Daniel, and do not merge without his approval. Maiden-video spend/publish remains a separate
later proposal.

### Load list

- `handoffs/2026-07-31-fyt-roster-delivery-live-rerun.md`
- `dashboard/server/control/rosterSessions.ts`
- `dashboard/server/control/rosterSessions.test.ts`
- `dashboard/server/win32/noReparseFiles.ts`
- `dashboard/server/win32/noReparseFiles.test.ts`
- `orgs/faceless-youtube/knowledge/decisions.md` (2026-07-31 roster rulings)
- `queue/done/6a6c6161-0a9f67df.md` (the nine-finding source review)
- `handoffs/2026-07-31-fyt-pipeline-shipped.md` (previous live 7/7 setup/evidence)
- external `scratchpad/dry-check/run-dry-check.mjs` and `lib/`
- Skill: `.agents/skills/code-review/SKILL.md` if a live failure requires another repair review
- Skill: `.agents/skills/save-session/SKILL.md` before pausing again

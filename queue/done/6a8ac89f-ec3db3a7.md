---
schema-version: 1
id: 6a8ac89f-ec3db3a7
project: atlas-prep
action: pb-2b
target: C:\Users\danie\AI-Operator-Program\pb-2
risk-tier: T1
owner: codex-worker
claim-token: 22615a82f2051ab9
state: done
approval: null
workflow: 01a02dd9-e576-73e2-9f5d-a32fc2961315
depends-on: []
variant-group: null
role: work
session-id: 6a8ab67f-27df9d8f
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Phone Bridge sweep — worker task 2

You are a Codex worker on Daniel's private Phone Bridge fork (Flutter + Rust, Windows). Working directory:
`C:\Users\danie\AI-Operator-Program\pb-2` (git worktree, branch `pb/sweep-2`, from baseline 8ad198b79).
Work ONLY there. Read first: `SWEEP_2026-08-23.md` (findings §A and plan §B — you execute **plan task 2**
only, addressing the §A findings it cites), then `HANDOFF_PHONE_BRIDGE_2026-08-21.md`, `PHONE_BRIDGE_INTEGRATION.md`,
`PHONE_BRIDGE_TASKS.md`, and the files in your task's file list. Four other workers run in parallel on the
other plan tasks with disjoint file sets — touch ONLY your task's files (plus new test files named for your
task); if you need a change elsewhere, describe it in your report instead.

Hard boundaries (from the docs; violating any is a failed task): never read, copy, migrate or print anything
under `%LOCALAPPDATA%\Packages\*`, OpenBubbles/Phone Bridge profiles, `.env`, or `..\phone-bridge-backups`;
never touch Phone Link processes/databases/DLLs (only the read-only `TempState\app_icons` cache is a documented
runtime input); never weaken or automate Windows Hello; never send messages; never execute notification text
or arbitrary URLs; no `git reset`/`checkout --`/`clean`/broad deletes; no commits; do not launch or foreground
the app; use synthetic data in tests; never log private notification bodies.

Toolchain: workspace-local under `C:\Users\danie\AI-Operator-Program\.tools` (flutter 3.24, cargo/rustup, nuget…);
`tool\phone_bridge_test.ps1` sets the environment and runs `dart analyze` + `flutter test` on the Phone Bridge
suites. It copies `build\windows\x64\runner\Debug\objectbox.dll` into `lib\` for the run; your worktree has no
`build\` dir, so first copy that single DLL from
`C:\Users\danie\AI-Operator-Program\phone-bridge-native\build\windows\x64\runner\Debug\objectbox.dll` into the same
relative path in your worktree (create the directories). If `flutter pub get` is needed, run it through the same
environment the test script sets up (read the script). Do NOT run the full native/MSIX build; Dart analysis +
tests are your gate. The known analysis-server hang is documented; if `dart analyze` hangs > 5 min, run
`flutter test` alone and say so.

Style: keep files slim, no dead code, no duplicated widgets/services, behaviour-named tests, no comments
narrating changes. Report: files changed, tests added, the exact test command + summary counts, anything you
could not finish, and any change needed in files outside your task.

\## Task 2 — P0 native pipeline + performance (findings 2, 3, 4, 5, 6, 12, 14)
Files: `plugins/windows_notification_listener/**` (Dart + C++/WinRT), `lib/services/phone_bridge/windows_notification_bridge.dart`,
`lib/services/phone_bridge/storage/**`, `lib/services/phone_bridge/phone_link_app_icon_repository.dart`, their tests.
Acceptance: invalid native records are skipped individually (required id/AUMID/time/types validated; no
`windows-notification:0` collisions); inventory generations are monotonic — a change during a refresh sets a
dirty bit and triggers one follow-up refresh, Dart applies snapshots in order and never lets an older one win;
`GetBinding`/creation-time access are inside the per-item try; failed refreshes post a typed error event;
permission revoke / sleep-resume / Phone Link restart rebind the listener (no permanent boolean; a false
`startWatching` result is handled); archive reconciliation is serialized, bounded (retention cap) and off the UI
isolate or incremental; icon cache: misses retry after a TTL, corrupt bytes fail safely, decode with `cacheWidth`;
per-notification logo reads do not block the completion path twice. C++ changes must compile in principle — keep
them minimal and explain them; you cannot build native here.


NOTE: the submodules `telephony_plus` and `rustpush` are provided in this worktree as directory junctions to the main tree (read-only use). Run `flutter pub get --offline` through the test script environment first (PATH += C:\Program Files\Git\cmd; GIT_CONFIG_* safe.directory as in tool\phone_bridge_test.ps1) so `.dart_tool/package_config.json` exists, then stage objectbox.dll as described and run the tests. If the sandbox refuses to write the Flutter SDK cache, run `flutter test` on your test files directly and report that the full script could not run.

## Result

Completed task 2. The final focused suite passes 53/53 tests.

\### Implemented

- Strict per-record native payload validation; malformed IDs, AUMIDs, timestamps, lists, and bytes are skipped without ID-zero collisions.
- Monotonic inventory generations across native and Dart, including dirty-bit follow-up refreshes and stale snapshot rejection.
- Typed, content-free refresh errors.
- Listener rebinds on repair/resume paths; false `startWatching` results become `listener_rebind_failed`.
- Per-item WinRT access is guarded; blocking native logo reads were eliminated in favor of the Phone Link icon cache.
- Archive operations are serialized, run through ObjectBox worker isolates, and enforce a 1,000-record default retention cap.
- Icon misses retry after TTL; corrupt/oversized JPEGs fail safely; decoding occurs off-isolate with both dimensions bounded.

\### Files changed

- [windows_notification_listener.dart](/C:/Users/danie/AI-Operator-Program/pb-2/plugins/windows_notification_listener/lib/windows_notification_listener.dart)
- [windows_notification_listener_plugin.cpp](/C:/Users/danie/AI-Operator-Program/pb-2/plugins/windows_notification_listener/windows/windows_notification_listener_plugin.cpp)
- [windows_notification_bridge.dart](/C:/Users/danie/AI-Operator-Program/pb-2/lib/services/phone_bridge/windows_notification_bridge.dart)
- [phone_link_app_icon_repository.dart](/C:/Users/danie/AI-Operator-Program/pb-2/lib/services/phone_bridge/phone_link_app_icon_repository.dart)
- [notification_archive.dart](/C:/Users/danie/AI-Operator-Program/pb-2/lib/services/phone_bridge/storage/notification_archive.dart)
- [notification_archive_contract.dart](/C:/Users/danie/AI-Operator-Program/pb-2/lib/services/phone_bridge/storage/notification_archive_contract.dart)
- [notification_archive_io.dart](/C:/Users/danie/AI-Operator-Program/pb-2/lib/services/phone_bridge/storage/notification_archive_io.dart)
- [notification_archive_stub.dart](/C:/Users/danie/AI-Operator-Program/pb-2/lib/services/phone_bridge/storage/notification_archive_stub.dart)
- [windows_notification_listener_contract_test.dart](/C:/Users/danie/AI-Operator-Program/pb-2/test/windows_notification_listener_contract_test.dart)
- [windows_notification_bridge_test.dart](/C:/Users/danie/AI-Operator-Program/pb-2/test/windows_notification_bridge_test.dart)
- [phone_bridge_notification_archive_test.dart](/C:/Users/danie/AI-Operator-Program/pb-2/test/phone_bridge_notification_archive_test.dart)
- [phone_link_app_icon_repository_test.dart](/C:/Users/danie/AI-Operator-Program/pb-2/test/phone_link_app_icon_repository_test.dart)

Added 14 behavior-named tests: 3 listener validation/generation tests, 5 bridge ordering/rebind tests, 2 archive serialization/retention tests, and 4 icon TTL/corruption/resize tests.

\### Verification

Exact successful invocation:

```powershell
$env:FLUTTER_ALREADY_LOCKED = 'true'
$env:FLUTTER_ROOT = 'C:\Users\danie\AI-Operator-Program\pb-2\build\flutter-test-sdk'
$dart = 'C:\Users\danie\AI-Operator-Program\.tools\flutter\bin\cache\dart-sdk\bin\dart.exe'
$packages = 'C:\Users\danie\AI-Operator-Program\.tools\flutter\packages\flutter_tools\.dart_tool\package_config.json'
$snapshot = 'C:\Users\danie\AI-Operator-Program\.tools\flutter\bin\cache\flutter_tools.snapshot'
$tests = @('test\phone_bridge_startup_test.dart','test\phone_bridge_inbox_test.dart','test\phone_bridge_refresh_policy_test.dart','test\native_notification_merger_test.dart','test\phone_bridge_route_registry_test.dart','test\open_bubbles_chat_resolver_test.dart','test\windows_notification_listener_contract_test.dart','test\windows_notification_bridge_test.dart','test\phone_bridge_notification_archive_test.dart','test\phone_link_app_icon_repository_test.dart','test\unread_counter_test.dart')
& $dart --disable-dart-dev "--packages=$packages" $snapshot --suppress-analytics --no-version-check test @tests --reporter expanded --no-pub
```

Result: **53 passed, 0 failed**. Task-file analyzers reported no issues, and `git diff --check` passed.

The prescribed wrapper could not complete because the sandbox denied writes to the shared Flutter SDK’s `lockfile` and `libimobiledevice.stamp`; the broader service analyzer also hit the documented analysis-server pipe crash. No native build was run as instructed. The C++ changes use existing WinRT/C++ types and add no build dependencies.

No changes are needed outside task 2’s files. The ignored `build\flutter-test-sdk` test shim remains because the sandbox rejected junction deletion; `lib\objectbox.dll` is absent, while the required staged build DLL remains. No commit was created.

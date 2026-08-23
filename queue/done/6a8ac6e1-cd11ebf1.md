---
schema-version: 1
id: 6a8ac6e1-cd11ebf1
project: atlas-prep
action: pb-1b
target: C:\Users\danie\AI-Operator-Program\pb-1
risk-tier: T1
owner: codex-worker
claim-token: 8e97bf3f6b0fbd43
state: done
approval: null
workflow: 01a02dd9-9567-7c41-ba71-c47e5a25768c
depends-on: []
variant-group: null
role: work
session-id: 6a8ab67d-2f7102bd
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Phone Bridge sweep — worker task 1

You are a Codex worker on Daniel's private Phone Bridge fork (Flutter + Rust, Windows). Working directory:
`C:\Users\danie\AI-Operator-Program\pb-1` (git worktree, branch `pb/sweep-1`, from baseline 8ad198b79).
Work ONLY there. Read first: `SWEEP_2026-08-23.md` (findings §A and plan §B — you execute **plan task 1**
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

\## Task 1 — P0 app-domain edge cases (findings 7, 8, 9, 10, 11)
Files: `lib/main.dart`, `lib/helpers/backend/startup_tasks.dart`, `lib/database/database.dart`,
`lib/database/io/{chat,message}.dart`, `lib/services/ui/chat/global_chat_service.dart`,
`lib/services/backend/{action_handler.dart,notifications/notifications_service.dart}`,
`lib/app/layouts/conversation_view/pages/messages_view.dart`, `lib/services/phone_bridge/unread_counter.dart`,
plus new startup/unread/deep-link tests. Acceptance: protected services (Rust/Apple identity, ObjectBox chat DB,
network) start only after a successful Windows Hello unlock — split pre-auth window/security bootstrap from the
protected init (the gate stays exactly as strict); ObjectBox busy/open failure never completes initialization
with an uninitialized store — show bounded retry / "already running, activating existing instance" UI;
reactions/edits never increment unread, unsends reconcile, bulk ingestion computes the real count; per-chat
unread persistence is one serialized durable write path (no fire-and-forget races); a deleted or wrong-chat
deep-link leaves the conversation open with a short message and closes its query.


NOTE: the submodules `telephony_plus` and `rustpush` are provided in this worktree as directory junctions to the main tree (read-only use). Run `flutter pub get --offline` through the test script environment first (PATH += C:\Program Files\Git\cmd; GIT_CONFIG_* safe.directory as in tool\phone_bridge_test.ps1) so `.dart_tool/package_config.json` exists, then stage objectbox.dll as described and run the tests. If the sandbox refuses to write the Flutter SDK cache, run `flutter test` on your test files directly and report that the full script could not run.

## Result

Implemented Task 1’s P0 fixes.

- Startup/ObjectBox: [main.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/main.dart), [startup_tasks.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/helpers/backend/startup_tasks.dart), [database.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/database/database.dart)
  - Windows Hello gates protected initialization.
  - Database opens before Rust identity/network services.
  - ObjectBox uses bounded retry and never reports initialized without a valid store.
  - Busy/unavailable storage renders retry/existing-instance recovery UI.

- Unread correctness: [chat.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/database/io/chat.dart), [message.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/database/io/message.dart), [global_chat_service.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/services/ui/chat/global_chat_service.dart), [action_handler.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/services/backend/action_handler.dart), [unread_counter.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/services/phone_bridge/unread_counter.dart)
  - Reactions and edits do not increment unread.
  - Full unsends decrement the correct persisted chat count.
  - Bulk ingestion counts only newly inserted real messages.
  - All chat counts persist through one serialized JSON snapshot writer.

- Deep links: [messages_view.dart](/C:/Users/danie/AI-Operator-Program/pb-1/lib/app/layouts/conversation_view/pages/messages_view.dart)
  - Missing, deleted, and wrong-chat targets show “Message no longer available.”
  - Conversation remains open.
  - ObjectBox queries close on success and failure.

Tests added/expanded: [task_1_protected_startup_test.dart](/C:/Users/danie/AI-Operator-Program/pb-1/test/task_1_protected_startup_test.dart), [task_1_deep_link_test.dart](/C:/Users/danie/AI-Operator-Program/pb-1/test/task_1_deep_link_test.dart), [unread_counter_test.dart](/C:/Users/danie/AI-Operator-Program/pb-1/test/unread_counter_test.dart). Task-specific coverage is 21 tests.

Test command used through a writable temporary Flutter overlay:

```powershell
$env:FLUTTER_ROOT = 'C:\Users\danie\AppData\Local\Temp\pb1-flutter-root'
$env:FLUTTER_ALREADY_LOCKED = 'true'
& 'C:\Users\danie\AI-Operator-Program\.tools\flutter\bin\cache\dart-sdk\bin\dart.exe' `
  'C:\Users\danie\AppData\Local\Temp\pb1-flutter-root\bin\cache\flutter_tools.snapshot' `
  --no-version-check test --no-pub `
  test\phone_bridge_startup_test.dart test\phone_bridge_inbox_test.dart `
  test\phone_bridge_refresh_policy_test.dart test\native_notification_merger_test.dart `
  test\phone_bridge_route_registry_test.dart test\open_bubbles_chat_resolver_test.dart `
  test\windows_notification_listener_contract_test.dart test\windows_notification_bridge_test.dart `
  test\phone_bridge_notification_archive_test.dart test\phone_link_app_icon_repository_test.dart `
  test\unread_counter_test.dart test\task_1_protected_startup_test.dart `
  test\task_1_deep_link_test.dart --reporter expanded
```

Result: **57/57 tests passed**. Formatting and `git diff --check` passed.

The prescribed `tool\phone_bridge_test.ps1` was attempted exactly, but its first analysis server crashed with exit code 4 before tests. A prior scoped analysis completed with no errors and inherited warnings only. No changes are needed outside Task 1’s file set. The temporary Flutter overlay remains because sandbox policy rejected its cleanup.

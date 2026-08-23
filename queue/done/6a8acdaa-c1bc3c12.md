---
schema-version: 1
id: 6a8acdaa-c1bc3c12
project: atlas-prep
action: pb-3b
target: C:\Users\danie\AI-Operator-Program\pb-3
risk-tier: T1
owner: codex-worker
claim-token: 65623a9dc969f78b
state: done
approval: null
workflow: 01a02dd9-a20f-7c43-b7f1-492be497d75b
depends-on: []
variant-group: null
role: work
session-id: 6a8ab680-32dcf1ca
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Phone Bridge sweep — worker task 3

You are a Codex worker on Daniel's private Phone Bridge fork (Flutter + Rust, Windows). Working directory:
`C:\Users\danie\AI-Operator-Program\pb-3` (git worktree, branch `pb/sweep-3`, from baseline 8ad198b79).
Work ONLY there. Read first: `SWEEP_2026-08-23.md` (findings §A and plan §B — you execute **plan task 3**
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

\## Task 3 — P1 UI consolidation, compactness, scroll performance (findings 1, 13, 15, 16, 17, 18, 19, 20)
Files: `lib/app/layouts/phone_bridge/{phone_bridge_page,phone_bridge_shell}.dart`, one new shared panel controller
under `lib/app/layouts/phone_bridge/`, `lib/app/layouts/conversation_list/widgets/header/header_widgets.dart`,
`lib/app/layouts/conversation_list/widgets/tile/**`, `lib/app/wrappers/scrollbar_wrapper.dart` (keep native
scrolling — finding 19), `lib/app/layouts/conversation_view/widgets/message/timestamp/message_timestamp.dart`,
new Phone Bridge widget tests. Acceptance: ONE canonical product model — Shell is the product (full conversation
list → full-width conversation with back control; rail collapses/overlays below 760 px with a modal barrier,
focus trap and Escape; rail state survives crossing 760 px in both directions); Page becomes a diagnostics-only
surface reached from a clearly labelled place (or is deleted if nothing needs it — prefer deletion if the archive
health/retry UI can live in Shell); the 11 `catch (_) {}` swallows (finding 1) become typed, surfaced states
(archive unavailable + retry, degraded rail, quarantine corrupt read-state with one warning, partial dismissal
failure); keyed rows, no whole-list rebuild per event, no per-row `Obx` for desktop-static values; skin-derived
colours (Material/Cupertino/Samsung) instead of hard-coded light AppBar / OLED black; one visible title
hierarchy; unread bold + numeric badge capped 99+; relative ages refresh on a coarse minute ticker scoped to
visible labels; status/timestamp text at least 11 px with non-colour-only state; keyboard/Semantics basics.


NOTE: the submodules `telephony_plus` and `rustpush` are provided in this worktree as directory junctions to the main tree (read-only use). Run `flutter pub get --offline` through the test script environment first (PATH += C:\Program Files\Git\cmd; GIT_CONFIG_* safe.directory as in tool\phone_bridge_test.ps1) so `.dart_tool/package_config.json` exists, then stage objectbox.dll as described and run the tests. If the sandbox refuses to write the Flutter SDK cache, run `flutter test` on your test files directly and report that the full script could not run.

## Result

Implemented Task 3 within the assigned file boundaries.

Key outcomes:

- Shell is now the canonical product UI; Page is diagnostics-only and clearly labelled.
- Responsive rail preserves state across the 760 px breakpoint, with modal barrier, focus trapping, Escape handling, and keyboard/Semantics support.
- Archive, rail degradation, corrupt read-state, and partial-dismiss failures now surface typed recoverable states.
- Added keyed/selective row updates, shared minute ticker, capped `99+` badges, unread emphasis, skin-derived colors, native scrolling, and ≥11 px status/timestamp text.

Files changed:

- [phone_bridge_shell.dart](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/layouts/phone_bridge/phone_bridge_shell.dart)
- [phone_bridge_page.dart](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/layouts/phone_bridge/phone_bridge_page.dart)
- [phone_bridge_panel_controller.dart](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/layouts/phone_bridge/phone_bridge_panel_controller.dart)
- [header_widgets.dart](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/layouts/conversation_list/widgets/header/header_widgets.dart)
- Conversation tile files under [tile](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/layouts/conversation_list/widgets/tile)
- [message_timestamp.dart](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/layouts/conversation_view/widgets/message/timestamp/message_timestamp.dart)
- [scrollbar_wrapper.dart](C:/Users/danie/AI-Operator-Program/pb-3/lib/app/wrappers/scrollbar_wrapper.dart)
- [phone_bridge_ui_task_3_test.dart](C:/Users/danie/AI-Operator-Program/pb-3/test/phone_bridge_ui_task_3_test.dart)

Added 9 behavior-named tests covering responsive rail behavior, diagnostics isolation, archive retry/serialization, corrupt state quarantine, degraded watching, partial dismissal, selective rebuilds, and the shared relative-age ticker.

Test command:

```powershell
$env:FLUTTER_ROOT = "$PWD\build\flutter-test-sdk"
$env:FLUTTER_ALREADY_LOCKED = 'true'
$env:FLUTTER_SUPPRESS_ANALYTICS = 'true'
$dart = 'C:\Users\danie\AI-Operator-Program\.tools\flutter\bin\cache\dart-sdk\bin\dart.exe'
$snapshot = "$PWD\build\flutter-test-sdk\bin\cache\flutter_tools.snapshot"

& $dart $snapshot test `
  test\phone_bridge_startup_test.dart `
  test\phone_bridge_inbox_test.dart `
  test\phone_bridge_refresh_policy_test.dart `
  test\native_notification_merger_test.dart `
  test\phone_bridge_route_registry_test.dart `
  test\open_bubbles_chat_resolver_test.dart `
  test\windows_notification_listener_contract_test.dart `
  test\windows_notification_bridge_test.dart `
  test\phone_bridge_notification_archive_test.dart `
  test\phone_link_app_icon_repository_test.dart `
  test\unread_counter_test.dart `
  test\phone_bridge_ui_task_3_test.dart `
  --no-pub --reporter compact
```

Result: **48 passed, 0 failed**. Task-specific tests: **9 passed**.

The full script could not run because the sandbox cannot write the external Flutter SDK cache; broad `dart analyze` also hit the documented analysis-server pipe crash. Scoped analysis found no new errors, only existing immutability/deprecation warnings. No implementation work remains and no outside-task file changes are needed. No commit was created.

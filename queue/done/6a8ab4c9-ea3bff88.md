---
schema-version: 1
id: 6a8ab4c9-ea3bff88
project: atlas-prep
action: pb-4-logo
target: C:\Users\danie\AI-Operator-Program\pb-4
risk-tier: T1
owner: codex-worker
claim-token: d45db02e72ac032f
state: done
approval: null
workflow: 01a02db5-fb1f-7e13-ba95-632c9de9eef6
depends-on: []
variant-group: null
role: work
session-id: 6a8aad86-fcbc0a11
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Phone Bridge sweep — worker task 4

You are a Codex worker on Daniel's private Phone Bridge fork (Flutter + Rust, Windows). Working directory:
`C:\Users\danie\AI-Operator-Program\pb-4` (git worktree, branch `pb/sweep-4`, from baseline 8ad198b79).
Work ONLY there. Read first: `SWEEP_2026-08-23.md` (findings §A and plan §B — you execute **plan task 4**
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

\## Task 4 — P1 logo (finding 21)
Files: `tool/render_phone_bridge_icon.ps1`, `assets/icon/**`, `windows/runner/resources/app_icon.ico`,
`windows/icons/**` (if present), one new deterministic icon test. Implement exactly the proposed mark: transparent
1024×1024 canvas, colour `#3B6FFF`, 104-unit round-cap/round-join pen, no fill, paths
`M160,492 C254,154 408,154 512,492 C616,830 770,830 864,492` and
`M160,492 C254,830 408,830 512,492 C616,154 770,154 864,492` (two interlocking handoff arcs), centred 20 units
optically high. Emit real 16/20/24/32/40/48/64/128/256 px ICO frames (render each size from the vector, do not
downscale one bitmap for the small sizes; at 16/20/24 px thicken the stroke by about 15 % so the loop stays
readable); keep the PNG outputs. Build the ICO container in PowerShell directly (preferred — removes the ffmpeg
dependency; `ffmpeg` exists under `C:\Users\danie\ffmpeg` only as a fallback). The test asserts the ICO contains
exactly those frames and that the PNG's alpha bounding box is within the expected optical bounds. Render
16/32/48/256 px previews on white and black backgrounds into `assets/icon/previews/` and describe them.

## Result

Completed task 4.

- Replaced the logo renderer with the specified two-path `#3B6FFF` handoff mark, direct PowerShell ICO writer, small-size stroke compensation, and deterministic previews.
- Updated `assets/icon` PNG/ICO assets and `windows/runner/resources/app_icon.ico`.
- Added [phone_bridge_icon_test.dart](C:\Users\danie\AI-Operator-Program\pb-4\test\phone_bridge_icon_test.dart), asserting exactly `16,20,24,32,40,48,64,128,256` ICO frames and PNG alpha bounds `108,186,808×612`.
- Added white/black previews at 16/32/48/256 px under `assets/icon/previews/`. They show a crisp blue linked-loop on white; on black it remains high-contrast, including a readable compact loop at 16 px.

Verification:

- `dart.exe analyze test\phone_bridge_icon_test.dart` — no issues.
- Focused deterministic test — 2/2 passed.
- Renderer repeatability: identical ICO SHA-256 on two runs; runner ICO hash matches; frame list verified.

Could not complete `tool\phone_bridge_test.ps1`: the sandboxed local Flutter SDK cannot write `bin\cache\libimobiledevice.stamp`. No app was launched.

Outside-task follow-up: task 5 should add `test\phone_bridge_icon_test.dart` to the hard-coded test list in `tool\phone_bridge_test.ps1`.

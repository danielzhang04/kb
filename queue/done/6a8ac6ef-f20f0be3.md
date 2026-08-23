---
schema-version: 1
id: 6a8ac6ef-f20f0be3
project: atlas-prep
action: pb-5b
target: C:\Users\danie\AI-Operator-Program\pb-5
risk-tier: T1
owner: codex-worker
claim-token: 7d1b662b7d1ebbe0
state: done
approval: null
workflow: 01a02dda-0d44-7933-8c52-868380514eed
depends-on: []
variant-group: null
role: work
session-id: 6a8ab682-a1936bcd
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Phone Bridge sweep — worker task 5

You are a Codex worker on Daniel's private Phone Bridge fork (Flutter + Rust, Windows). Working directory:
`C:\Users\danie\AI-Operator-Program\pb-5` (git worktree, branch `pb/sweep-5`, from baseline 8ad198b79).
Work ONLY there. Read first: `SWEEP_2026-08-23.md` (findings §A and plan §B — you execute **plan task 5**
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

\## Task 5 — P1 packaging + build hygiene (findings 22, 23, 24, 25, 26-partial)
Files: all `tool/phone_bridge_*.ps1` except the logo renderer, `rust_builder/cargokit/**`, `windows/flutter/generated_*`,
`lib/objectbox.g.dart`, `pubspec.yaml`, `windows/runner/{main.cpp,Runner.rc,CMakeLists.txt}`, packaging/startup
source-contract tests. Acceptance: the installer NEVER defaults to copying an authenticated OpenBubbles profile —
profile adoption requires an explicit `-AdoptProfile <path>` switch that prints what it will do and refuses
without `-Confirm`; the FairPlay fixture copy hack moves out of the source tree (a build-time staging dir) and is
documented; vendored CargoKit changes become a documented patch file applied at build time (or a wrapper), not
silent edits; a generated-file drift gate (regenerate and diff) exists as a script step; process kills,
certificate creation and elevation-sensitive actions require explicit switches with a preflight that lists them;
the official DLL is an explicit hash-pinned input parameter, not a hard-coded Store path; tests stage
`objectbox.dll` outside `lib\` (a temp dir on the DLL search path) instead of copying into source; product
identity/version unified: `pubspec.yaml` version and `Runner.rc` metadata say "Phone Bridge" and the next
MSIX is `1.0.0.17`. Do not run the native build; the PowerShell scripts must pass
`[System.Management.Automation.PSParser]::Tokenize` and your new contract tests.


NOTE: the submodules `telephony_plus` and `rustpush` are provided in this worktree as directory junctions to the main tree (read-only use). Run `flutter pub get --offline` through the test script environment first (PATH += C:\Program Files\Git\cmd; GIT_CONFIG_* safe.directory as in tool\phone_bridge_test.ps1) so `.dart_tool/package_config.json` exists, then stage objectbox.dll as described and run the tests. If the sandbox refuses to write the Flutter SDK cache, run `flutter test` on your test files directly and report that the full script could not run.

## Result

Implemented task 5 packaging/build hygiene.

Files changed:

- [pubspec.yaml](C:/Users/danie/AI-Operator-Program/pb-5/pubspec.yaml)
- [Runner.rc](C:/Users/danie/AI-Operator-Program/pb-5/windows/runner/Runner.rc)
- [phone_bridge_build.ps1](C:/Users/danie/AI-Operator-Program/pb-5/tool/phone_bridge_build.ps1)
- [phone_bridge_package.ps1](C:/Users/danie/AI-Operator-Program/pb-5/tool/phone_bridge_package.ps1)
- [phone_bridge_install.ps1](C:/Users/danie/AI-Operator-Program/pb-5/tool/phone_bridge_install.ps1)
- [phone_bridge_adopt_preview_profile.ps1](C:/Users/danie/AI-Operator-Program/pb-5/tool/phone_bridge_adopt_preview_profile.ps1)
- [phone_bridge_test.ps1](C:/Users/danie/AI-Operator-Program/pb-5/tool/phone_bridge_test.ps1)
- [phone_bridge_generated_drift.ps1](C:/Users/danie/AI-Operator-Program/pb-5/tool/phone_bridge_generated_drift.ps1)
- CargoKit’s three vendored files restored to pristine upstream form.
- Added [CargoKit patch and documentation](C:/Users/danie/AI-Operator-Program/pb-5/rust_builder/cargokit/patches/README.md).
- Added [phone_bridge_packaging_contract_test.dart](C:/Users/danie/AI-Operator-Program/pb-5/test/phone_bridge_packaging_contract_test.dart).

Outcome:

- Profile adoption now requires explicit `-AdoptProfile <path>`, `-InstallPackage`, and `-Confirm`.
- Legacy automatic profile adoption is disabled.
- Process termination and certificate creation require explicit switches plus confirmation.
- Official native DLL packaging requires an explicit path and SHA-256 pin; Store-path discovery is gone.
- FairPlay fixtures compile from a disposable staged Rust workspace. The read-only `rustpush` junction is not modified or used as the fixture source.
- CargoKit customizations are a documented, apply-checked, build-time patch reversed in `finally`.
- Generated drift regeneration now occurs in an isolated staging copy.
- ObjectBox tests stage `objectbox.dll` under `%TEMP%` on `PATH`, not under `lib`.
- Package/executable metadata is unified as Phone Bridge `1.0.0.17`.
- No native build, app launch, installation, certificate creation, process kill, profile read, or message send occurred.

Validation:

```powershell
dart.exe test test\phone_bridge_packaging_contract_test.dart --reporter expanded
```

Result: **11 passed, 0 failed**.

Additional gates:

- PowerShell tokenizer: **7/7 scripts passed**
- Packaging contract analysis: **no issues**
- CargoKit `git apply --check`: passed
- ObjectBox regeneration: succeeded; no generated content drift
- `git diff --check`: passed, with existing CRLF warnings only

The full `tool\phone_bridge_test.ps1` could not run because Flutter attempted to write the sandbox-read-only shared SDK file `bin\cache\libimobiledevice.stamp`. Direct Flutter testing stopped before executing tests for the same reason; the pure packaging contract was therefore run through Dart as permitted.

Outside-task follow-up: the shared main-tree target behind the read-only `rustpush` junction already contains 20 legacy files under `rustpush\certs\fairplay`. I did not touch them. The new build excludes that directory, but its owner should remove that residue separately.

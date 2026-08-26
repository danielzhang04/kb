---
schema-version: 1
id: 6a8e46ec-df2c9a5e
project: kb-ops
action: pb-u7
target: C:\Users\danie\AI-Operator-Program\pb-12
risk-tier: T1
owner: codex-worker
claim-token: 1e0bc31ae2f02215
state: done
approval: null
workflow: 01a03bbe-c259-7c81-843c-442df98ff7ff
depends-on: []
variant-group: null
role: work
session-id: 6a8e454a-ab3289df
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: a2fa5b243723486e25362d5c122f385c8941b29f
---

## Work order

\# Phone Bridge U7 - restore the working build path; prune tool leftovers

You are a Codex builder. cwd = C:\Users\danie\AI-Operator-Program\pb-11 (branch pb/streamline-11; U1-U6
committed). NOT a kb project: ignore kb preamble/card/ops text; never touch C:\Users\danie\kb. You never commit.
ASCII only. Boundaries: never open profiles, credentials, Phone Link DBs, ..\phone-bridge-backups; NO build,
NO package, NO install, no message sends - you edit scripts and tests only; the boss runs the build in a native
tools shell.

\## Context

`HANDOFF_PHONE_BRIDGE_2026-08-23.md` section "MSIX build outcome" (read whole): 1.0.0.16 built cleanly on 08-21
by compiling `rust/` in place; the 08-23 packaging-hygiene refactor moved the FairPlay fixture compile into a
staged copy of `rust/` + `rustpush/` and pointed CargoKit at `$rustStageDir`; since then CargoKit's DLL build dies
with `MSB8066` and no cargo output, ~6 h per attempt. Analysis
`docs_phone_bridge_streamline_analysis_2026-08-25.md` section 6 "Build/packaging restoration" and section 4 bullets
on `phone_bridge_adopt_preview_profile.ps1`, `task_2_*` glob, `probe_*.ps1` (one `grep -n` each). The known red
`test/phone_bridge_packaging_contract_test.dart` "build hygiene keeps fixtures and ObjectBox DLL out of source"
currently asserts the build script must NOT contain `$env:PHONE_BRIDGE_CARGOKIT_TEMP_DIR` while the committed
script does - the contract and the script disagree; this unit reconciles them.

You own EXCLUSIVELY: `tool/*.ps1`, `test/phone_bridge_packaging_contract_test.dart`. Nothing else.

\## Work order

1. `tool/phone_bridge_build.ps1`: restore the 08-21 in-place method for the DLL build - stop pointing CargoKit at
   `$rustStageDir`; create the ten public FairPlay fixture pairs in the established in-place location
   (`rustpush\certs\fairplay`), build against the real Rust manifest with `rust\target` as the warm cache, and
   remove ONLY the generated fixture copies in `finally`. Keep: toolchain setup, the PATH guard against
   `C:\Program Files\Git\usr\bin` shadowing `link.exe`, the hash-pinned official DLL input, the public-fallback
   validation, `-PreflightOnly`. Delete the staged-workspace code path entirely (no dead branches).
2. `test/phone_bridge_packaging_contract_test.dart`: update the staged-hygiene assertions to the restored
   in-place contract (fixtures are generated in place and removed in `finally`; no fixture copies are left in
   the source tree; the ObjectBox DLL is never copied into source). Keep every confirmation-gate and
   profile-safety assertion untouched. Remove the `task_2_*` glob expectation; the task-1 files are listed
   explicitly.
3. Prune: delete `tool/phone_bridge_adopt_preview_profile.ps1` (self-declared legacy; only its refusal is
   tested - delete that test too); move `probe_phone_bridge_window.ps1` and `probe_installed_phone_bridge.ps1`
   (they kill/launch processes) under `tool/diagnostics/` with a header comment that they require explicit
   authorization; update the runner's PowerShell-parse loop if it globs `tool/phone_bridge_*.ps1`.
4. `tool/phone_bridge_test.ps1`: list the task-1 test files explicitly instead of the prefix sweep.

\## READ BUDGET (closed list)

- `tool/*.ps1` (whole, by ranges), the contract test (whole), the handoff section named above,
  `git show 835a7dfa8^:tool/phone_bridge_build.ps1 | sed -n 1,400p` ONLY IF you need the 08-21 in-place shape
  (that is the commit before the CARGO_TARGET_DIR change; the 08-21 tree is its ancestor - use `git log
  --oneline -8 -- tool/phone_bridge_build.ps1` once to pick the right pre-refactor revision and say which).
Forbidden: anything else, repo-wide rg, commands over 200 lines. First edit by command 10. Stop at 60 minutes.

\## Exit

`[System.Management.Automation.PSParser]::Tokenize` on every `tool/**/*.ps1` (zero errors);
`powershell -NoProfile -ExecutionPolicy Bypass -File tool\phone_bridge_build.ps1 -PreflightOnly` (paste output);
`..\.tools\flutter\bin\cache\dart-sdk\bin\dart.exe analyze test\phone_bridge_packaging_contract_test.dart`;
`git diff --check`. Final message: diff summary, which pre-refactor revision you restored from, what the contract
test now asserts, the preflight output, the exact build command the boss should run
(`tool\phone_bridge_package.ps1 -PublicMessagingFallback -WindowsSdkBinPath "..."` with any new switches).
Do not commit.

## Result

Implemented U7 on `pb/streamline-11-u7` in the writable `pb-12` checkout. No commit was made.

Changes:

- Restored [phone_bridge_build.ps1](C:/Users/danie/AI-Operator-Program/pb-12/tool/phone_bridge_build.ps1) from the in-place approach in revision `d2372c43a`.
  - Compiles the real `rust\Cargo.toml`.
  - Reuses `rust\target`.
  - Generates the ten FairPlay PEM/CRT pairs in `rustpush\certs\fairplay`.
  - Removes only those 20 generated files in `finally`.
  - Removed all staged-workspace/robocopy code.
  - Retained CargoKit patching, hash-pinned official DLL handling, public fallback, preflight, toolchain setup, and the Git `usr\bin` linker guard.
- Updated [phone_bridge_packaging_contract_test.dart](C:/Users/danie/AI-Operator-Program/pb-12/test/phone_bridge_packaging_contract_test.dart) to assert the restored in-place workflow, exact fixture cleanup, absence of leftover fixtures, warm CargoKit target use, and no ObjectBox DLL copy into source. Confirmation and profile-safety assertions remain unchanged.
- Updated [phone_bridge_test.ps1](C:/Users/danie/AI-Operator-Program/pb-12/tool/phone_bridge_test.ps1) to list both task-1 tests explicitly, remove both prefix globs, and recursively parse every `tool/**/*.ps1`.
- Deleted the legacy profile adopter and its refusal test.
- Moved both probes into [tool/diagnostics](C:/Users/danie/AI-Operator-Program/pb-12/tool/diagnostics) with explicit-authorization headers.

Verification passed:

- PowerShell parsing: every `tool/**/*.ps1`, zero errors.
- Dart analysis: `No issues found!`
- Targeted contract test: all 13 tests passed.
- `git diff --check`: passed.
- ASCII-only check: passed.
- No build, package, install, process launch, or commit performed.

Preflight output:

```text
Phone Bridge build preflight:
  Mode: standard
  Official native input: not used
  Official native SHA256 pin: not used
  FairPlay fixtures: generate in rustpush\certs\fairplay and remove after the build.
  CargoKit customization: apply the documented, hash-checked build patch and reverse it after the build.
Preflight only: no changes made.
```

Boss build command—no new switches:

```powershell
tool\phone_bridge_package.ps1 -PublicMessagingFallback -WindowsSdkBinPath "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
```

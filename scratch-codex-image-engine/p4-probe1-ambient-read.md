# P4 Probe 1 — does an empty temp `--cd` zero the ambient-repo detour?

Date: 2026-08-11. codex-cli 0.146.1, subscription-billed, $0. Budget: 2 generations (used: 2).

## Setup note (deviation from the brief's literal code — documented, not silent)

The brief's `p4_probe.py` argv (`["codex", "exec", ...]`, no `--skip-git-repo-check`) does not run
as-is on this machine:

1. `subprocess.Popen(["codex", ...], shell=False)` on Windows does not do PATHEXT resolution — only
   `codex.CMD`/`codex.ps1`/a git-bash shim exist on PATH, no `codex.exe`. Fixed by resolving the
   binary with `shutil.which("codex")` (finds `codex.CMD`) instead of the bare string `"codex"`.
2. The first tempdir attempt (returncode 1, 1.4 s, no `thread_id`, no `usage` — **no API turn ran,
   $0 spent, does not count against the 2-generation budget**) failed with stderr: *"Not inside a
   trusted directory and `--skip-git-repo-check` was not specified."* codex 0.146.1 refuses to run
   outside a trusted git repo by default; `--skip-git-repo-check` ("Allow running Codex outside a Git
   repository") is the documented flag for exactly this case (`codex exec --help`). Added
   unconditionally to **both** arms so the flag itself is not a confound — only `cwd` differs between
   arms, per the probe's intent.

Both fixes are in the committed `p4_probe.py`. Neither changes the envelope, the tool-call semantics,
or the measurement methodology the brief specifies.

## Measurements

| Arm | thread_id | pre_call_tool_calls | input_tokens | cached_input_tokens | output_tokens | wall_s | images |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tempdir  | `019ff2d0-16c2-7e12-bacd-e841ef27d85e` | 5 | 153,379 | 121,088 | 3,074 | 151.5 | 1 |
| worktree | `019ff2d2-80e0-7491-8877-29228c4421a5` | 4 | 133,008 | 118,016 | 3,860 | 143.5 | 1 |

Both arms returned `returncode: 0`, `timed_out: false`, and exactly one `.png` in
`~/.codex/generated_images/<thread_id>/`.

## Verdict

**PARTIAL — the detour is controlled but not zero, on both arms.**

Neither arm clears the PASS band (`pre_call_tool_calls ≤ 3` **and** `input_tokens` in `70k-130k`):
tempdir misses on both counts (5 tool calls, 153,379 tokens); worktree misses on both counts too,
though narrowly on tokens (4 tool calls vs ≤3; 133,008 tokens vs the 130k ceiling). Both arms clear
the PARTIAL band (`pre_call_tool_calls ≤ 8` and `input_tokens < 300k`) comfortably, so the overall
probe verdict is **PARTIAL**, not FAIL — the build continues, and §5.1's peer-scale estimate is
re-stated below with the measured multiplier rather than the zero-detour ideal.

## Commands run (exact)

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe1-tempdir --cwd-mode tempdir --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png

py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe1-worktree --cwd-mode worktree --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

## Consequence for §5.1's peer-scale estimate

P2b's no-scope-instruction ambient baseline was 24 pre-call tool calls / 936,102 input tokens. Both
probe-1 arms land far below that (~4-6x fewer tool calls, ~6-7x fewer tokens) once the envelope's
explicit "do not read any file outside this directory" scope instruction is present — but neither
arm reaches the clean-call PASS band, and, contrary to the brief's stated expectation that the
worktree arm would show a *higher* `pre_call_tool_calls`/`input_tokens` than the tempdir arm (P2b's
no-scope figure of 24/936,102 implying ~11/~247k here), the measured worktree arm was actually
slightly *lower* on both metrics than the tempdir arm (4 vs 5 tool calls; 133,008 vs 153,379 tokens).
The raw event log for the worktree arm shows why the detour did not fire as expected: its first shell
command was a relative-path `Get-Content -Raw -LiteralPath .\CLAUDE.md; ... .\governance\agent-rules.md`
— an attempt at the ambient-repo onboarding read — but it failed (`PathNotFound`, both files)
because `--cd` pointed at `<ARC>` (a worktree subdirectory), not the repo root, so the relative paths
never resolved; the run recovered and proceeded via absolute-path reads instead. §5.1's peer-scale
estimate should therefore not budget on cwd alone as the detour control, and should not assume the
70k-130k clean-call floor: it should plan full-video per-generation input-token cost in the
**~130k-155k range** (this probe's measured PARTIAL band), driven primarily by the envelope's
explicit scope instruction rather than by which directory `--cd` points at, with the worktree's
relative-path miss as a fragile, cwd-depth-dependent side effect rather than a reliable second
control.

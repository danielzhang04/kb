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

## Auditability of `pre_call_tool_calls` — scrubbed rollout-log excerpts

`pre_call_tool_calls` (5 / 4 above) is computed by `count_pre_call_tool_calls()` from the codex
**rollout log** under `~/.codex/sessions/`, NOT from the `--json` raw stream (`p4-probe1-*-raw.jsonl`
contains only `thread.started`/`turn.*`/`item.*` events — no `custom_tool_call` lines at all, so the
gating metric was not independently re-derivable from what the original commit banked).

**Full rollout-log copies were tried first and then reversed by Daniel's ruling.** A boss scan of the
banked full copy found a long high-entropy base64-like fragment (`amDCAmBP7V49…`) it could not safely
classify, and this repo's credential ceiling fails closed on unclassifiable secret-shaped blobs.
Session transcripts are sensitive-shaped in general — a rollout log can embed anything a shell command
happened to read or produce — so full copies are not an acceptable evidence-banking form here, even
when a manual keyword scan comes back clean (as it did — see below). The fix: two **scrubbed
excerpts**, containing only the events actually load-bearing for the count, with every long string
value truncated.

- `p4-probe1-tempdir-rollout-excerpt.jsonl` — the 6 `custom_tool_call` events from the tempdir arm
  (all of them; the 6th is the `image_gen__imagegen` call itself).
- `p4-probe1-worktree-rollout-excerpt.jsonl` — the first 5 `custom_tool_call` events from the worktree
  arm (the 5th is the `image_gen__imagegen` call; the source log has a 6th `custom_tool_call` line
  after it, but `count_pre_call_tool_calls()` returns before ever reaching it in the real run, so it
  is not load-bearing and is excluded).

Every event was produced by `p4_probe.scrub_long_strings()` (added to `p4_probe.py`, alongside
`count_pre_call_tool_calls`): a small, recursive, no-exceptions function that truncates every string
value longer than 120 chars to its first 40 chars + `…<TRUNCATED len=N>`. Its docstring states why
full logs are banned: no keyword/entropy scan can be trusted to recognize every shape a secret could
take, so instead of classifying content, the scrubber removes the *category* of risk — no long string
survives intact, full stop. Each excerpt event also carries one synthetic, non-secret boolean field,
`_probe_is_image_gen_call` (computed from the pre-scrub raw line text, added at excerpt-build time —
not part of the real codex schema, clearly out-of-band-prefixed), so the terminal event stays
identifiable without needing to find the literal substring `image_gen__imagegen` inside a field that
the scrubber may have truncated away.

The original manual credential scan of the (no-longer-banked) full copies is left on record for
context: `grep -iE "api[_-]?key|bearer |authorization|secret|password|access[_-]?token|
sk-[a-zA-Z0-9]{10}|OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY"` returned 3 hits per file, all
benign (doc text naming the `OPENAI_API_KEY` variable, one coincidental `SK-1` substring inside a
base64 blob) — but a keyword scan is exactly the kind of classifier the scrubber approach no longer
depends on trusting.

**Verification — zero surviving long base64-ish runs in either excerpt:**

```
grep -noE "[A-Za-z0-9+/_-]{120,}" p4-probe1-tempdir-rollout-excerpt.jsonl
grep -noE "[A-Za-z0-9+/_-]{120,}" p4-probe1-worktree-rollout-excerpt.jsonl
```

Output: no matches in either file (grep exit code 1 both times).

**Re-derivation command** (reads the excerpt's `_probe_is_image_gen_call` marker instead of grepping
a possibly-truncated field):

```
py -3 -c "
import json

def count_pre_call_tool_calls_from_excerpt(path):
    n = 0
    with open(path, encoding='utf-8') as f:
        for line in f:
            ev = json.loads(line)
            p = ev['payload']
            if p.get('_probe_is_image_gen_call'):
                return n
            n += 1
    return n

for label, path in [('tempdir', 'p4-probe1-tempdir-rollout-excerpt.jsonl'), ('worktree', 'p4-probe1-worktree-rollout-excerpt.jsonl')]:
    print(label, '->', count_pre_call_tool_calls_from_excerpt(path))
"
```

Output (run from `<ARC>`):

```
tempdir -> 5
worktree -> 4
```

This matches the originally reported `pre_call_tool_calls: 5` (tempdir) and `pre_call_tool_calls: 4`
(worktree) exactly — the PASS/PARTIAL/FAIL gate is now independently re-derivable from banked,
scrubbed source, with no long/high-entropy string ever committed. The full, unredacted rollout logs
remain machine-local at `~/.codex/sessions/2026/08/11/rollout-2026-08-11T17-52-31-019ff2d0-...jsonl`
and `...T17-55-09-019ff2d2-...jsonl` for anyone who needs a local re-check beyond what the excerpts
show; they are not tracked in this repo and were never pushed.

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

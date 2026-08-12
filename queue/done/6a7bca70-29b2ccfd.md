---
id: 6a7bca70-29b2ccfd
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: eb0cda64fbf1e457
state: done
approval: null
workflow: 019ff38b-11c3-7d12-928d-88da4f2efcd8
depends-on: []
variant-group: null
role: work
session-id: 6a7bc97a-a940d42b
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Scoped re-review — Task A1 fix round 2, codex-image-engine arc

You are a fresh-context reviewer for one fix round of an SDD task. You review ONLY the fix
diff `03734ba..28ce13b` on branch `claude/codex-image-engine` (your cwd is the arc worktree,
already on this branch). You are read-only sandboxed; verify by running read commands and
python, never by editing. $0 rule: NEVER invoke `codex` or any generation call.

\## Context (read these first, in this order)

1. `.superpowers/sdd/2026-08-11-codex-image-engine/progress.md` — ledger; round-1 verdict line.
2. `.superpowers/sdd/2026-08-11-codex-image-engine/task-A1-report.md` — read "Fix report —
   coordinator review finding" and "Fix report 2 — boss ruling reversing full-copy banking".
3. The fix diff itself: `git diff 03734ba..28ce13b` (small — 6 paths).
4. Final files: `scratch-codex-image-engine/p4_probe.py`,
   `scratch-codex-image-engine/p4-probe1-tempdir-rollout-excerpt.jsonl`,
   `scratch-codex-image-engine/p4-probe1-worktree-rollout-excerpt.jsonl`,
   `scratch-codex-image-engine/p4-probe1-ambient-read.md`.

\## The finding under re-review

Round-1 Important: the gating metric `pre_call_tool_calls = 5 (tempdir) / 4 (worktree)` — the
quantity the probe's PASS/PARTIAL/FAIL verdict turns on — was not re-derivable from anything
committed. Fix round 1 banked full rollout-log copies (03734ba); a boss ruling reversed that
(secret-shaped blob, credential ceiling fails closed) and ordered fix round 2 (28ce13b):
full copies `git rm`'d, scrubbed `custom_tool_call`-only excerpts banked, built via a
committed no-exceptions truncation function, zero-hit entropy scan required.

\## What you verify (run the commands yourself; do not trust the report's pasted outputs)

1. **Re-derivation works from committed files only.** Run the excerpt re-derivation snippet
   from task-A1-report.md Fix report 2 (the `_probe_is_image_gen_call` version) from
   `scratch-codex-image-engine/`. Confirm output `tempdir -> 5`, `worktree -> 4`.
2. **Entropy scan zero-hit.** `grep -noE "[A-Za-z0-9+/_-]{120,}"` on BOTH excerpt files —
   confirm zero matches. Additionally scan every file the fix diff touches (including the
   updated `p4-probe1-ambient-read.md` and `p4_probe.py`) for 120+-char runs.
3. **`scrub_long_strings()` soundness.** Read the function in `p4_probe.py`. Confirm: recursive
   over nested dict/list, truncates EVERY string >120 chars with no exemption list, keeps 40
   chars + explicit truncation marker. Confirm the committed excerpts are consistent with it
   (no string value anywhere in the excerpt JSON exceeding ~40 chars + marker overhead — parse
   and check programmatically, don't eyeball).
4. **Excerpt completeness logic.** The worktree excerpt has 5 events (its source's 6th
   `custom_tool_call` line excluded as non-load-bearing because the terminal
   `image_gen__imagegen` marker appears at position 5). Verify from the committed excerpt
   alone that the count algorithm terminates at the 5th event (`_probe_is_image_gen_call`
   true) → 4. Flag if the exclusion makes the excerpt misleading in any way the evidence
   file doesn't disclose.
5. **No new breakage in fix-diff scope.** `py -3 -m py_compile scratch-codex-image-engine/p4_probe.py`;
   confirm the fix diff does NOT alter `run_probe`/`kill_tree`/`build_envelope` signatures,
   `ENVELOPE`, or `p4-envelope.txt`; confirm `p4-probe1-ambient-read.md`'s updated
   auditability section is internally consistent (event counts, commands, PARTIAL verdict
   unchanged, pointer to machine-local full logs present).
6. **Diff hygiene.** Exactly the 6 paths named in the report changed between 03734ba and
   28ce13b; nothing else. `git diff --exit-code 03734ba..28ce13b -- orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py`
   must be empty (standing arc guarantee: forge.py untouched).

Out of scope: relitigating round-1 minors, the pre-existing history question (03734ba's blobs
— already tracked by the boss), anything outside the fix diff.

\## Output format (your final message)

- Line 1: `VERDICT: CLEAN` or `VERDICT: NEEDS-FIXES`.
- Then: `Important finding (metric unbanked): ADDRESSED` or `NOT ADDRESSED — <why>`.
- Then one line per verification item 1–6: PASS/FAIL + the actual command output you observed
  (paste the key line, e.g. the re-derivation output).
- Then any NEW findings introduced by the fix diff, each tagged Critical/Important/Minor with
  file:line. None → `New findings: none`.

## Result

VERDICT: NEEDS-FIXES  
Important finding (metric unbanked): ADDRESSED

1. PASS — re-derivation: `tempdir -> 5`; `worktree -> 4`.
2. PASS — `grep -noE "[A-Za-z0-9+/_-]{120,}"` exited `1` (zero matches) for both excerpts, `p4-probe1-ambient-read.md`, and `p4_probe.py`.
3. FAIL — values are recursively scrubbed (`max_string_len=61`, `over_120=0` in both excerpts), but dictionary keys are exempt: `long_dict_key_len_after=121`; `p4_probe.py:95` preserves `k` unchanged.
4. PASS — worktree excerpt: `events=5`, `terminal_positions=[5]`, therefore count `4`; the excluded sixth source event and rationale are disclosed in the evidence file.
5. PASS — signatures/`ENVELOPE`/`p4-envelope.txt` unchanged; audit text retains 5/4, PARTIAL, commands, and machine-local-log pointer. Exact `py_compile` was blocked by read-only sandbox: `Permission denied ... __pycache__`; read-only `compile(): OK`.
6. PASS — `changed_path_count=6`; `forge diff exit=0` (empty).

New findings:

- Important — [p4_probe.py:95](C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py:95): `scrub_long_strings()` does not scrub dictionary keys, contradicting its no-exceptions/every-string safety claim. A 121-character key survives intact and could bank sensitive-shaped content.

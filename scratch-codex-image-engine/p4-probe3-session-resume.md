# P4 Probe 3 — `exec resume` session-mode contract

Date: 2026-08-11. Branch `claude/codex-image-engine`. Worktree
`C:/Users/danie/kb-worktrees/boss-codex-image-engine`.

## Command context

Task A3 is the four-question probe from plan lines 369–473. Its budget was 3 generations;
exactly 3 were consumed (Phase A running total: 6 of 8). The boss ran every probe command from
the host shell. No dispatch worker made a nested codex API call.

The three runs were:

```text
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe3-turn1 --cwd-mode tempdir --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

```text
py -3 -c "import sys; sys.path.insert(0,r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine'); import p4_probe, tempfile; d=tempfile.mkdtemp(prefix='p4probe-'); p4_probe.run_resume_probe(label='p4-probe3-turn2', thread_id='019ff3ad-61f6-7513-9127-a973f73a5f26', prompt_path=r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format3-minimal-avoid.txt', seeds=[r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png'], cwd=d)"
```

```text
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe3-control --cwd-mode tempdir --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format3-minimal-avoid.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

## Deviations and contract discovery

The worker-added `run_resume_probe` code needed three boss corrections discovered by execution.
All three were pre-API fast-fails, cost $0, and consumed no generations:

1. **PATHEXT deviation.** A bare `codex` in `argv` failed with WinError 2 on Windows. Resume now
   resolves the executable with `shutil.which`, matching A1 deviation 1.
2. **Resume contract discovery.** `codex exec resume` rejected `--sandbox` and `--cd` (rc 2,
   0.2 s). Its usage is `codex exec resume --json <SESSION_ID> [PROMPT]`; a resumed session
   restores its own stored cwd and sandbox. The `cwd` parameter therefore only sets the child
   process cwd, and the rejected flags were removed.
3. **Trust deviation.** Resume still enforced the Git-repository trust check (rc 1, 0.9 s,
   stderr `Not inside a trusted directory`). `--skip-git-repo-check` was added, matching
   `run_probe`.

**Evidence caveat:** each retry reused the `p4-probe3-turn2` label, so the failed attempts'
raw/stderr outputs were OVERWRITTEN by the successful run — the committed
`p4-probe3-turn2-raw.jsonl`/`-stderr.txt` are from the final successful attempt only. The rc-2
usage error and rc-1 trust error quoted above are recorded here (and in the boss session
transcript) but are not banked as files; the two fast-fails produced no usage block and no
thread activity, which is the basis of the $0/no-generation claim.

## Measurements

All three completed with return code 0 and `timed_out: false`. The raw JSONL streams contain the
stated `thread.started` and `turn.completed` events and usage blocks. Image names below are the
filenames emitted in those streams.

| run | thread_id | input | cached | uncached | output | reasoning | pre_call | wall_s | images |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| turn 1 (format-2, fresh, tempdir) | `019ff3ad-61f6-7513-9127-a973f73a5f26` | 251,598 | 212,480 | 39,118 | 2,892 | 1,503 | 8 | 125.2 | `exec-ec57d0a7-3884-4c85-af6d-0451aa75acd8.png` |
| turn 2 (format-3, resume into turn 1) | same thread | 355,695 | 291,968 | 63,727 | 3,895 | 2,071 | 8* | 65.3 | `exec-59e92280-a6e7-48a7-b341-722b507b23c8.png` (new) |
| control (format-3, fresh, tempdir) | `019ff3b1-fc74-7843-8f67-e0f161221475` | 151,281 | 130,304 | 20,977 | 2,182 | 1,172 | 1 | 107.6 | `exec-8f3a2ea1-83e7-40cd-874c-f3486bf6e063.png` |

\* `pre_call_tool_calls=8` on turn 2 is a measurement limitation, not turn 2’s own count: the
counter reads the thread’s cumulative rollout log and returns at the first image-generation call,
which is turn 1’s. The raw stderr files were also cross-checked: turn 1 and control contain
approval/trust diagnostics from failed ambient command attempts; turn 2 stderr is empty. None
contradicts the successful `turn.completed` events and generated images.

## Four answers

| question | answer | evidence / consequence |
| --- | --- | --- |
| 1. Does resume emit `thread.started`? | **YES** | Turn 2 re-emits `thread.started` with the same thread ID `019ff3ad-61f6-7513-9127-a973f73a5f26`. |
| 2. Does turn 2 use the same image directory? | **YES** | It writes exactly one new PNG into `~/.codex/generated_images/<thread_id>/`; snapshot-diff harvesting works unchanged on resume. |
| 3. Does verbatim pass-through hold on the resumed turn? | **YES** | The fidelity audit can reach `verified`. The plan’s literal `src in body` check is a false negative because the source contains two newlines and JSONL escapes them as `\n`. A JSON-decoded walk over every string field finds the exact source; exact, LF, and stripped variants are all true. |
| 4. Is there realized token saving? | **NEGATIVE on tokens** | Resume is 355,695 total / 63,727 uncached input tokens versus 151,281 / 20,977 for the like-for-like fresh control: uncached input is about 3.0× higher. Resume is faster on wall clock (65.3 s versus 107.6 s) because it avoids re-onboarding. |

## Carried finding for Task C8

The fidelity audit must decode JSON before substring matching; it must never grep the raw rollout
body for multi-line source text. Raw JSONL escaping makes the literal check systematically unable
to match a source containing newlines, even when the exact decoded text was passed through.

## Recommendation

session mode may NOT be enabled by default on this evidence — it re-emits thread.started and harvests cleanly, but costs ~3x uncached input tokens versus a fresh call; enabling it by default is Daniel's call (§9.3 item 4), not this probe's.

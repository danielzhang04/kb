# codex CLI as a second image engine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Build `forge_codex.py` — a standalone, subscription-billed ($0) codex-CLI image runner that
consumes an unedited `forge.py batch` spec, composes codex-native prompts, publishes validated PNGs
into staging through forge's own primitives, and ships with the P4 probes and the study tooling that
will decide whether codex clears the ratified paired-register floor — while `git diff forge.py`
stays empty.

**Architecture.** `forge_codex.py` imports `forge.py` read-only as a library (Kit, the seeding-law
preflight, the staging lock/publish primitives, the PNG validators) and owns everything provider-
specific: a deterministic labeled-field prompt composer, a file-based verbatim `codex exec`
invocation on an empty temp cwd, snapshot-diff harvest from `~/.codex/generated_images/<thread_id>/`,
a rollout-log fidelity audit, crop+Lanczos normalization to a fixed canvas, failure classification
with a one-per-frame transport re-issue, and a JSONL engine log. Every unit is driven in tests by
`_fake_codex.py`, a real subprocess that emits the JSONL, PNG, rollout-log and error strings both
probe logs actually observed. The register study is separate tooling under the arc scratch:
`study_metrics.py` (M1-M4 paired distances + the 23-frame band) and `study_run.py` (the L0/L1/L2/L3
ladder under a hard 40-generation budget) — built and tested here, **run** only at P5 behind a human
gate.

**Tech Stack.** Python 3 (Windows, invoked as `py -3`), stdlib only plus Pillow and NumPy (already
required by `forge.py` / `measure.py`); plain-assert test files with no pytest (house style,
`test_forge_hold.py` L2); `codex` CLI 0.146.1 (`exec --json --sandbox workspace-write --cd <dir>`),
subscription-billed.

---

## Global Constraints

Every task inherits all of these. A task that cannot be done without breaking one of them stops and
escalates instead.

- **`forge.py` is never edited.** `git diff --exit-code <SCRIPTS>/forge.py` must be EMPTY at the end
  of every task and at final verification.
- **Kit read-only.** Nothing under `<KIT>` (refs, registry, style-bible) is written, moved or
  regenerated.
- **Outputs to arc staging only.** Every run in this plan passes `--staging <ARC>/staging`; nothing
  in this plan writes into `<KIT>/_staging`.
- **$0 API spend.** No `.env` is ever read; `GEMINI_API_KEY` is never loaded, set, printed or
  referenced at runtime; every Kit is built as `Kit(kit_path, dry=True)`. codex is subscription-
  billed; no metered API is called anywhere in this plan.
- **Never touch `C:/Users/danie/kb`** (the main checkout) and never touch any `.env` file anywhere.
- **Windows python.** All commands are `py -3 <absolute path>`; all paths in this plan are absolute
  or explicitly kit-relative.
- **Timeout 240 s per codex call, killed as a process TREE** (Windows `CREATE_NEW_PROCESS_GROUP` +
  `taskkill /T /F`; POSIX `start_new_session` + `killpg`) — a single-PID kill left 4 live
  `codex.exe` children in P2b.
- **Workers never push, and never commit anything beyond their own task's explicitly named paths.**
  Never `git add -A`. Never commit on `main` or `ops`. Work branch is `claude/codex-image-engine`.
- **Corpus is exactly 4 shots:** `L26` (cast-free plate), `L44` (single figure), `L33` (two figures
  + interaction), `L29` (lettering-bearing). No shot is added to the corpus.
- **The ratified floor (spec §7.4, Daniel 2026-08-11):** `|ΔM1| ≤ 5` per shot on **at least 3 of the
  4** corpus shots, **and** `|ΔM2|` no worse than the interquartile width of M2 across the 23
  verified baseline frames, **and** M3/M4 inside the same band.
  *(Spec §9.2's table still calls this floor a PROPOSAL and §7.4's ruling box says re-ratified.
  §7.4 is later and explicit — "This floor is binding" — and Daniel ratified it on 2026-08-11.
  §7.4 wins; treat §9.2's row as stale.)*
- **Plan-approved generation budget: 40 study gens** (L0 8 + L1 ≤16 + L2 8 + 8 spare), plus **≤8 P4
  probe gens** in Phase A. Phase A tasks are the ONLY tasks in this plan that touch the network.
  Phases B, C, D never spawn the real codex binary.
- **No post-generation register pass** (ruling 3): no palette quantization, recolouring, gradient
  flattening or equivalent. Crop-and-resize to canvas is normalization, not retouching.
- **No lever gets a third variant.** Two exhausted levers ⇒ escalation packet, no further gens.

### Path shorthand (used throughout; expand to the absolute path in every command)

| Token | Absolute path |
| --- | --- |
| `<W>` | `C:/Users/danie/kb-worktrees/boss-codex-image-engine` |
| `<SCRIPTS>` | `<W>/orgs/faceless-youtube/.claude/skills/image-generation/scripts` |
| `<ARC>` | `<W>/scratch-codex-image-engine` |
| `<KIT>` | `<W>/orgs/faceless-youtube/channels/the-second-take/visual-kit` |
| `<VIDEO>` | `<W>/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh` |

---

# PHASE A — P4 probes (spec §8.5)

Phase A spends real codex generations against the real CLI, on the operator's existing subscription
session. **$0.** Each probe task banks a dated evidence file into `<ARC>/` and commits it.

Spec §8.5's probes 4, 5 and 6 are **not** Phase A tasks: they are literally §7's ladder rungs L0, L2
and L1, executed by the Phase D study runner at P5 under the 40-gen study budget. Duplicating them
here would double-spend the budget. Phase A covers §8.5 probes 1, 2, 3 and 7.

**Phase A generation budget: ≤8 gens total** (probe 1: 2, probe 2: ≤1, probe 3: 3, probe 7: 0).

---

## Task A1 — Probe harness + probe 1: does an empty temp `--cd` zero the ambient-repo detour?

**This probe gates everything downstream.** §5.1's quota math, §4.4's boundary claim and §9's risk 6
all rest on it. Its result is recorded even if it is negative — a negative result does not stop the
build, it changes what P5 may plan (no full-video run until the detour is controlled).

**Budget: 2 generations.**

**Files**
- Create: `<ARC>/p4_probe.py`
- Create: `<ARC>/p4-envelope.txt` (the exact envelope text used, banked as the contract Phase C's
  `build_envelope()` is tested against)
- Create: `<ARC>/p4-probe1-ambient-read.md` (evidence)
- Create (by the run): `<ARC>/p4-probe1-tempdir-raw.jsonl`, `<ARC>/p4-probe1-tempdir-stderr.txt`,
  `<ARC>/p4-probe1-worktree-raw.jsonl`, `<ARC>/p4-probe1-worktree-stderr.txt`

**Interfaces**
- Consumes: the real `codex` binary on PATH; `<ARC>/probeB-format2-labeled-field.txt` (an existing
  banked 1740-char prompt file, reused so this probe changes ONLY the cwd); the existing seed
  `<ARC>/seeds/figA-qt-wiles.png`.
- Produces: `p4_probe.py` with
  `run_probe(*, label: str, prompt_path: str, seeds: list[str], cwd: str, sandbox: str, timeout_s: int) -> dict`
  returning `{"label","thread_id","usage","pre_call_tool_calls","wall_s","returncode","timed_out","images"}`,
  and `kill_tree(proc) -> None`.

**Acceptance (explicit — this probe's verdict is a gate)**
- **PASS (detour zeroed):** the temp-dir run's `pre_call_tool_calls` is **≤ 3** and its
  `input_tokens` is within the clean-call band **70k-130k**.
- **PARTIAL:** temp-dir `pre_call_tool_calls` ≤ 8 and `input_tokens` < 300k — the detour is
  controlled but not zero; §5.1's peer-scale estimate is re-stated with the measured multiplier.
- **FAIL:** temp-dir `pre_call_tool_calls` > 8 or `input_tokens` ≥ 300k — the empty-cwd control does
  not work; the evidence file must record this verdict in bold, and **no full-video codex run may be
  planned at P5** until a further control is found. The build continues regardless.

**Steps**

- [ ] Write `<ARC>/p4_probe.py`:

```python
#!/usr/bin/env python3
"""P4 probe harness -- one bounded, $0 codex exec call with full evidence capture.

codex is SUBSCRIPTION-billed: no key is read, no .env is touched, no metered API is called.
Usage:
  py -3 p4_probe.py --label probe1-tempdir --cwd-mode tempdir \
      --prompt-file <abs .txt> --seed <abs .png> [--sandbox workspace-write] [--timeout 240]
"""
import argparse, json, os, shutil, signal, subprocess, sys, tempfile, time
from pathlib import Path

ARC = Path(__file__).resolve().parent
IMAGE_ROOT = Path(os.path.expanduser("~/.codex/generated_images"))
SESSIONS_ROOT = Path(os.path.expanduser("~/.codex/sessions"))

ENVELOPE = (
    "Read the file at {prompt_path} and pass its exact byte content as the `prompt` argument to "
    "`image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text -- read "
    "and pass through only. Call the tool exactly once, with referenced_image_paths = [{seeds}]. "
    "Do not read any file outside this directory. Report only the saved image path."
)


def build_envelope(prompt_path, seeds):
    return ENVELOPE.format(prompt_path=prompt_path,
                           seeds=", ".join(str(s) for s in seeds))


def kill_tree(proc):
    """Kill the child AND every descendant -- a single-PID kill left 4 live codex.exe in P2b."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        pass


def _thread_dir_listing(thread_id):
    d = IMAGE_ROOT / (thread_id or "")
    return set(os.listdir(d)) if thread_id and d.is_dir() else set()


def _rollout_path(thread_id):
    if not thread_id or not SESSIONS_ROOT.is_dir():
        return None
    hits = sorted(SESSIONS_ROOT.glob(f"*/*/*/rollout-*-{thread_id}.jsonl"))
    return hits[-1] if hits else None


def count_pre_call_tool_calls(thread_id):
    """custom_tool_call items appearing BEFORE the image_gen__imagegen call -- the detour meter."""
    path = _rollout_path(thread_id)
    if not path:
        return None
    n = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if '"custom_tool_call"' not in line:
            continue
        if "image_gen__imagegen" in line:
            return n
        n += 1
    return n


def run_probe(*, label, prompt_path, seeds, cwd, sandbox, timeout_s):
    argv = ["codex", "exec", "--json", "--sandbox", sandbox, "--cd", str(cwd),
            build_envelope(prompt_path, seeds)]
    raw = ARC / f"{label}-raw.jsonl"
    err = ARC / f"{label}-stderr.txt"
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" \
        else {"start_new_session": True}
    t0 = time.time()
    with open(raw, "w", encoding="utf-8") as fo, open(err, "w", encoding="utf-8") as fe:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=fo, stderr=fe,
                                cwd=str(cwd), **kwargs)
        timed_out = False
        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_tree(proc)
    wall = round(time.time() - t0, 1)
    thread_id, usage = None, {}
    for line in raw.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "thread.started":
            thread_id = ev.get("thread_id")
        elif ev.get("type") == "turn.completed":
            usage = ev.get("usage", {})
    out = {"label": label, "thread_id": thread_id, "usage": usage,
           "pre_call_tool_calls": count_pre_call_tool_calls(thread_id),
           "wall_s": wall, "returncode": proc.returncode, "timed_out": timed_out,
           "images": sorted(_thread_dir_listing(thread_id))}
    print(json.dumps(out, indent=2), flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--seed", action="append", default=[])
    ap.add_argument("--cwd-mode", choices=("tempdir", "worktree"), default="tempdir")
    ap.add_argument("--sandbox", default="workspace-write")
    ap.add_argument("--timeout", type=int, default=240)
    a = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="p4probe-") if a.cwd_mode == "tempdir" else str(ARC)
    try:
        run_probe(label=a.label, prompt_path=os.path.abspath(a.prompt_file),
                  seeds=[os.path.abspath(s) for s in a.seed], cwd=tmp,
                  sandbox=a.sandbox, timeout_s=a.timeout)
    finally:
        if a.cwd_mode == "tempdir":
            shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] Bank the envelope contract (no network): run

```
py -3 -c "import sys; sys.path.insert(0,r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine'); import p4_probe, pathlib; pathlib.Path(r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4-envelope.txt').write_text(p4_probe.build_envelope('<PROMPT_PATH>', ['<SEED_1>']), encoding='utf-8')"
```

  Expected: `<ARC>/p4-envelope.txt` exists and contains the literal tokens `<PROMPT_PATH>` and
  `<SEED_1>`. This file is the contract Task C6 diffs `build_envelope()` against.

- [ ] Run the temp-dir arm (**GEN 1 of 2**):

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe1-tempdir --cwd-mode tempdir --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

  Expected: a JSON summary with a non-null `thread_id`, `images` containing exactly one `.png`,
  `wall_s` in the 70-165 s band, and an integer `pre_call_tool_calls`. Record all of it.

- [ ] Run the worktree arm (**GEN 2 of 2**) — identical prompt and seed, cwd inside the worktree:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe1-worktree --cwd-mode worktree --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

  Expected: a second JSON summary. This arm is expected to show a HIGHER `pre_call_tool_calls` and
  `input_tokens` (P2b measured 24 / 936,102 with no scope instruction; this envelope carries the
  scope instruction, so ~11 / ~247k is the expected worktree figure).

- [ ] Write `<ARC>/p4-probe1-ambient-read.md`: a table of `pre_call_tool_calls`, `input_tokens`,
  `cached_input_tokens`, `output_tokens`, `wall_s` and image count for both arms; the **verdict**
  (PASS / PARTIAL / FAIL against the acceptance above) in bold on its own line; the exact two
  commands run; and one paragraph on the consequence for §5.1's peer-scale estimate using the
  measured numbers. If the verdict is FAIL, state in bold: *"No full-video codex run may be planned
  at P5 until a further ambient-read control is found."*

- [ ] Commit:

```
git add scratch-codex-image-engine/p4_probe.py scratch-codex-image-engine/p4-envelope.txt scratch-codex-image-engine/p4-probe1-ambient-read.md scratch-codex-image-engine/p4-probe1-tempdir-raw.jsonl scratch-codex-image-engine/p4-probe1-tempdir-stderr.txt scratch-codex-image-engine/p4-probe1-worktree-raw.jsonl scratch-codex-image-engine/p4-probe1-worktree-stderr.txt
git commit -m "probe(codex-engine): P4 probe 1 -- empty-tempdir --cd vs worktree cwd, ambient-detour measured"
```

---

## Task A2 — Probe 2: is the `--sandbox read-only` hang reproducible?

Production uses `workspace-write` (§4.4), so this blocks nothing. It exists so the next person who
reaches for a tighter sandbox finds the answer banked instead of re-discovering a silent 7-minute
hang. Bounded at **one attempt**, hard-killed as a process tree at 240 s.

**Budget: ≤1 generation** (the expected outcome is a hang with zero renders and zero billable work).

**Files**
- Create: `<ARC>/p4-probe2-sandbox-readonly.md`
- Create (by the run): `<ARC>/p4-probe2-readonly-raw.jsonl`, `<ARC>/p4-probe2-readonly-stderr.txt`

**Interfaces**
- Consumes: `<ARC>/p4_probe.py` (`run_probe`, `kill_tree`) from Task A1, unchanged.
- Produces: evidence only. No code.

**Steps**

- [ ] Before running, note the live codex process count so the tree-kill can be verified:

```
powershell -NoProfile -Command "(Get-Process codex -ErrorAction SilentlyContinue).Count"
```

  Expected: a number (usually `0`). Record it.

- [ ] Run the single bounded attempt (**GEN ≤1**):

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/p4_probe.py --label p4-probe2-readonly --cwd-mode tempdir --sandbox read-only --timeout 240 --prompt-file C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format2-labeled-field.txt --seed C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png
```

  Expected (P2b's observation): `"timed_out": true`, `"thread_id": null` or a thread id with an
  empty `images` list, and a near-empty raw JSONL. A clean fast rejection is also a valid — and more
  interesting — result.

- [ ] Immediately re-check the process count and confirm the tree kill worked:

```
powershell -NoProfile -Command "(Get-Process codex -ErrorAction SilentlyContinue).Count"
```

  Expected: back to the pre-run number. If it is higher, the tree kill failed — record that in bold
  as a **blocking finding for Task C6** and kill the strays with
  `powershell -NoProfile -Command "Get-Process codex | Stop-Process -Force"`.

- [ ] Write `<ARC>/p4-probe2-sandbox-readonly.md`: the command, the outcome (`timed_out`, `wall_s`,
  bytes in the raw JSONL, image count), the before/after codex process counts, and a one-line
  verdict — either *"read-only hang REPRODUCED; `workspace-write` on an empty temp dir remains the
  only sanctioned mode"* or *"read-only failed fast in Ns; recorded, production still uses
  workspace-write per §4.4 until a second confirmation."*

- [ ] Commit:

```
git add scratch-codex-image-engine/p4-probe2-sandbox-readonly.md scratch-codex-image-engine/p4-probe2-readonly-raw.jsonl scratch-codex-image-engine/p4-probe2-readonly-stderr.txt
git commit -m "probe(codex-engine): P4 probe 2 -- read-only sandbox behaviour, tree-kill verified"
```

---

## Task A3 — Probe 3: the `exec resume` session-mode contract

Blocks enabling `session` mode by default (§5.2, §9.3 item 4). Four questions, one probe: does
`resume` emit `thread.started`; does turn 2 write into the **same** `<thread_id>` image directory;
does verbatim pass-through hold per turn; what is the realized token saving?

**Budget: 3 generations** (turn 1 + turn 2 in one session, plus 1 isolated control).

**Files**
- Modify: `<ARC>/p4_probe.py` (add `run_resume_probe`)
- Create: `<ARC>/p4-probe3-session-resume.md`
- Create (by the run): `<ARC>/p4-probe3-turn1-raw.jsonl`, `<ARC>/p4-probe3-turn2-raw.jsonl`,
  `<ARC>/p4-probe3-control-raw.jsonl` (+ matching `-stderr.txt`)

**Interfaces**
- Consumes: `run_probe`, `build_envelope`, `count_pre_call_tool_calls`, `kill_tree` (Task A1).
- Produces: `run_resume_probe(*, label, thread_id, prompt_path, seeds, cwd, timeout_s) -> dict`,
  same return shape as `run_probe`, plus `"resumed": True`.

**Steps**

- [ ] Add to `<ARC>/p4_probe.py`:

```python
def run_resume_probe(*, label, thread_id, prompt_path, seeds, cwd, timeout_s=240):
    """Second turn into an existing thread: `codex exec resume <thread_id> --json ...`."""
    argv = ["codex", "exec", "resume", str(thread_id), "--json", "--sandbox", "workspace-write",
            "--cd", str(cwd), build_envelope(prompt_path, seeds)]
    raw, err = ARC / f"{label}-raw.jsonl", ARC / f"{label}-stderr.txt"
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" \
        else {"start_new_session": True}
    before = _thread_dir_listing(thread_id)
    t0 = time.time()
    with open(raw, "w", encoding="utf-8") as fo, open(err, "w", encoding="utf-8") as fe:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=fo, stderr=fe,
                                cwd=str(cwd), **kwargs)
        timed_out = False
        try:
            proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            kill_tree(proc)
    saw_thread_started, usage, seen_id = False, {}, None
    for line in raw.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "thread.started":
            saw_thread_started, seen_id = True, ev.get("thread_id")
        elif ev.get("type") == "turn.completed":
            usage = ev.get("usage", {})
    after = _thread_dir_listing(thread_id)
    out = {"label": label, "resumed": True, "thread_id": thread_id,
           "emitted_thread_started": saw_thread_started, "thread_started_id": seen_id,
           "usage": usage, "pre_call_tool_calls": count_pre_call_tool_calls(thread_id),
           "wall_s": round(time.time() - t0, 1), "returncode": proc.returncode,
           "timed_out": timed_out, "new_images": sorted(after - before)}
    print(json.dumps(out, indent=2), flush=True)
    return out
```

- [ ] Run turn 1 (**GEN 1 of 3**) with the format-2 prompt, temp cwd, and **record the
  `thread_id`** — reuse Task A1's command with `--label p4-probe3-turn1`. Expected: one new PNG,
  a non-null thread id.

- [ ] Run turn 2 into that same thread (**GEN 2 of 3**), using a *different* prompt file
  (`<ARC>/probeB-format3-minimal-avoid.txt`) so turn 2's output is distinguishable:

```
py -3 -c "import sys; sys.path.insert(0,r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine'); import p4_probe, tempfile; d=tempfile.mkdtemp(prefix='p4probe-'); p4_probe.run_resume_probe(label='p4-probe3-turn2', thread_id='<THREAD_ID_FROM_TURN_1>', prompt_path=r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format3-minimal-avoid.txt', seeds=[r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/seeds/figA-qt-wiles.png'], cwd=d)"
```

  Expected: the four measurements this probe exists for —
  `emitted_thread_started` (true/false), `new_images` (exactly one new PNG in the **same**
  `<thread_id>` dir ⇒ the snapshot-diff harvest works unchanged on resume), `usage.input_tokens`
  (compare against turn 1 for the realized saving), and `returncode == 0`.

- [ ] Run the isolated control (**GEN 3 of 3**) — the same format-3 prompt in a fresh process, so
  the saving is measured against a like-for-like call: reuse Task A1's command with
  `--label p4-probe3-control` and `--prompt-file .../probeB-format3-minimal-avoid.txt`.

- [ ] Verify pass-through held on the resumed turn by extracting the captured prompt from the
  rollout log and diffing it against the source file:

```
py -3 -c "import sys,json,pathlib,glob; sys.path.insert(0,r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine'); import p4_probe; p=p4_probe._rollout_path('<THREAD_ID_FROM_TURN_1>'); src=pathlib.Path(r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/probeB-format3-minimal-avoid.txt').read_text(encoding='utf-8'); body=p.read_text(encoding='utf-8',errors='replace'); print('rollout:',p); print('source len',len(src)); print('source text present verbatim in rollout:', src in body)"
```

  Expected: either `True` (⇒ `fidelity_audit: "verified"` is reachable on resumed turns) or `False`
  (⇒ the read-into-variable mechanism was used; that is `unverifiable`, not a failure — record which).

- [ ] Write `<ARC>/p4-probe3-session-resume.md`: a four-row answer table (thread.started on resume /
  same image dir / verbatim per turn / realized saving in input tokens, turn-2 vs control), the raw
  numbers, and a **recommendation line**: *"`session` mode may / may not be enabled by default"* —
  noting that enabling it by default is Daniel's call (§9.3 item 4), not this probe's.

- [ ] Commit:

```
git add scratch-codex-image-engine/p4_probe.py scratch-codex-image-engine/p4-probe3-session-resume.md scratch-codex-image-engine/p4-probe3-turn1-raw.jsonl scratch-codex-image-engine/p4-probe3-turn1-stderr.txt scratch-codex-image-engine/p4-probe3-turn2-raw.jsonl scratch-codex-image-engine/p4-probe3-turn2-stderr.txt scratch-codex-image-engine/p4-probe3-control-raw.jsonl scratch-codex-image-engine/p4-probe3-control-stderr.txt
git commit -m "probe(codex-engine): P4 probe 3 -- exec resume session-mode contract measured"
```

---

## Task A4 — Probe 7: canvas rows for `2:3` and `9:16` (0 generations)

§4.6 marks `(2:3, 1K) = 832×1248` and `(9:16, 1K) = 768×1344` **[THIN]** — carried from SKILL.md
L130, never measured. This probe measures every non-16:9 verified Gemini frame reachable inside this
worktree and either confirms the rows or records that they stay unverified.

**Budget: 0 generations.** No network. Pure measurement.

**Files**
- Create: `<ARC>/p4-probe7-canvas-rows.md`

**Interfaces**
- Consumes: `<ARC>/gemini-baseline/*.png` (23 frames, all expected 1376×768) and any PNG under
  `<VIDEO>/assets/` — read-only.
- Produces: evidence only. Its verdict is consumed by Task C3 (the `CANVAS` table).

**Steps**

- [ ] Measure every baseline frame and every video asset PNG, grouped by dimensions:

```
py -3 -c "import glob,collections; from PIL import Image; c=collections.Counter(); [c.update([Image.open(p).size]) for p in glob.glob(r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/gemini-baseline/*.png')+glob.glob(r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/**/*.png', recursive=True)]; [print(f'{w}x{h}  ratio={w/h:.4f}  n={n}') for (w,h),n in sorted(c.items(), key=lambda kv:-kv[1])]"
```

  Expected: a dominant `1376x768 ratio=1.7917 n=23+` row confirming `(16:9, 1K)`, plus whatever
  portrait rows exist (thumbnails are 2:3 in this pipeline; a `832x1248` row would confirm that
  doc value directly).

- [ ] Re-verify the 23 baseline shas so this task also proves the reference set is unaltered:

```
py -3 -c "import hashlib,pathlib; root=pathlib.Path(r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/gemini-baseline'); bad=[]; [bad.append(n) for line in (root/'SHAS.txt').read_text(encoding='utf-8').splitlines() if len(line.split())==3 for sha,n,_sz in [line.split()] if hashlib.sha256((root/n).read_bytes()).hexdigest()!=sha]; print('MISMATCHES:', bad or 'none')"
```

  Expected: `MISMATCHES: none`.

- [ ] Write `<ARC>/p4-probe7-canvas-rows.md`: the dimension histogram, the sha re-verification
  result, and a verdict per row — `(16:9,1K)` **VERIFIED 1376×768 (n=23)**; and for `(2:3,1K)` /
  `(9:16,1K)` either **VERIFIED `<W>×<H>` (n=k)** or **UNVERIFIED — carried from SKILL.md L130;
  no codex frame at this ratio may be promoted at P5 until a real Gemini frame of that ratio is
  measured (§8.5 probe 7)**.

- [ ] Commit:

```
git add scratch-codex-image-engine/p4-probe7-canvas-rows.md
git commit -m "probe(codex-engine): P4 probe 7 -- canvas rows measured against real pipeline output"
```

---

# PHASE B — the fake codex binary (spec §8.1)

Everything from Phase C onward is driven by `_fake_codex.py`: a real Python subprocess, invoked with
the real argv tail, emitting the real JSONL event shapes, the real error strings, a real PIL-
generated PNG with a known-by-construction ink metric, and a real rollout log under a
`SESSIONS_ROOT` the test controls. **No task after Phase A spawns the real codex binary.**

The fake ships as a **named file** at `<SCRIPTS>/_fake_codex.py` rather than a string written into a
temp dir by the test: it is ~220 lines of contract-encoding logic, and a reviewable, diffable,
independently runnable file is the only form in which "re-probing a new CLI version is a cheap diff"
(§9.1 risk 7) is true. The temp-dir part of §8.1 is preserved where it matters — `IMAGE_ROOT` and
`SESSIONS_ROOT` are per-test temp directories passed on the fake's own argv.

---

## Task B1 — `_fake_codex.py`: argv contract, `ok` mode, PNG, rollout log

**Files**
- Create: `<SCRIPTS>/_fake_codex.py`
- Create: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: nothing from `forge.py` or `forge_codex.py` (the fake is standalone; it must run before
  `forge_codex.py` exists).
- Produces:
  - CLI `py -3 _fake_codex.py --mode <m> --image-root <dir> --sessions-root <dir> exec --json --sandbox <s> --cd <dir> <envelope>`
  - stdout: JSONL events; exit code per mode; side effects: `<image-root>/<thread_id>/exec-<n>.png`
    and `<sessions-root>/<Y>/<m>/<d>/rollout-<ts>-<thread_id>.jsonl`
  - test helper `fake_prefix(mode: str, image_root: str, sessions_root: str) -> list[str]` in
    `test_forge_codex.py`
  - test helper `run_fake(mode, *, envelope, image_root, sessions_root, sandbox="workspace-write", cwd=None) -> subprocess.CompletedProcess`

**Steps**

- [ ] Write the failing test file `<SCRIPTS>/test_forge_codex.py`:

```python
#!/usr/bin/env python3
"""Unit tests for forge_codex.py + the fake codex binary fixture.
Plain asserts, no pytest (house style). Run: py -3 test_forge_codex.py
NO NETWORK, NO API SPEND: every codex invocation in this file is _fake_codex.py."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

HERE = Path(__file__).resolve().parent
FAKE = HERE / "_fake_codex.py"

ENVELOPE_FMT = (
    "Read the file at {prompt_path} and pass its exact byte content as the `prompt` argument to "
    "`image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text -- read "
    "and pass through only. Call the tool exactly once, with referenced_image_paths = [{seeds}]. "
    "Do not read any file outside this directory. Report only the saved image path."
)


def fake_prefix(mode, image_root, sessions_root):
    return [sys.executable, str(FAKE), "--mode", mode,
            "--image-root", str(image_root), "--sessions-root", str(sessions_root)]


def run_fake(mode, *, envelope, image_root, sessions_root, sandbox="workspace-write", cwd=None,
             resume_thread=None):
    tail = ["exec"]
    if resume_thread:
        tail += ["resume", resume_thread]
    tail += ["--json", "--sandbox", sandbox, "--cd", str(cwd or image_root), envelope]
    return subprocess.run(fake_prefix(mode, image_root, sessions_root) + tail,
                          capture_output=True, text=True, encoding="utf-8", errors="replace")


def _events(stdout):
    out = []
    for line in stdout.splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _scratch():
    tmp = Path(tempfile.mkdtemp(prefix="fkcodex-"))
    (tmp / "generated_images").mkdir()
    (tmp / "sessions").mkdir()
    prompt = tmp / "L29.txt"
    prompt.write_text("Use case: illustration-story\nAvoid: photorealism\n", encoding="utf-8")
    seed = tmp / "seed.png"
    seed.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2048)
    return tmp, prompt, seed


def test_fake_ok_mode_emits_real_event_shapes_png_and_rollout():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    r = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                 sessions_root=tmp / "sessions")
    assert r.returncode == 0, r.stderr
    evs = _events(r.stdout)
    kinds = [e["type"] for e in evs]
    assert kinds[0] == "thread.started" and kinds[1] == "turn.started"
    assert kinds[-1] == "turn.completed"
    tid = evs[0]["thread_id"]
    assert tid and tid.startswith("019ff")
    usage = evs[-1]["usage"]
    for key in ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"):
        assert isinstance(usage[key], int), key
    assert any(e.get("item", {}).get("type") == "agent_message" for e in evs)
    pngs = sorted((tmp / "generated_images" / tid).glob("*.png"))
    assert len(pngs) == 1, pngs
    from PIL import Image
    assert Image.open(pngs[0]).size == (1672, 941)
    rollouts = sorted((tmp / "sessions").glob(f"*/*/*/rollout-*-{tid}.jsonl"))
    assert len(rollouts) == 1, rollouts
    body = rollouts[0].read_text(encoding="utf-8")
    assert "custom_tool_call" in body and "image_gen__imagegen" in body
    assert prompt.read_text(encoding="utf-8") in json.dumps(body)


def test_fake_rejects_relative_seed_with_the_real_error_string():
    tmp, prompt, _seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds="seeds/figA.png")
    r = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                 sessions_root=tmp / "sessions")
    assert r.returncode != 0
    assert "AbsolutePathBuf deserialized without a base path" in r.stderr
    assert not list((tmp / "generated_images").rglob("*.png"))


def test_fake_rejects_six_seeds_with_the_real_error_string():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=", ".join([str(seed)] * 6))
    r = run_fake("ok", envelope=env, image_root=tmp / "generated_images",
                 sessions_root=tmp / "sessions")
    assert r.returncode != 0
    assert "referenced_image_paths must contain at most 5 paths" in r.stderr
    assert not list((tmp / "generated_images").rglob("*.png"))


def test_fake_asserts_the_real_flag_contract():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    r = subprocess.run(fake_prefix("ok", tmp / "generated_images", tmp / "sessions")
                       + ["exec", "--sandbox", "workspace-write", "--cd", str(tmp), env],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert r.returncode != 0
    assert "--json" in r.stderr


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
```

- [ ] Run it to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `FileNotFoundError` / non-zero return from the subprocess because
  `_fake_codex.py` does not exist (the first test's `assert r.returncode == 0` fires).

- [ ] Write `<SCRIPTS>/_fake_codex.py`:

```python
#!/usr/bin/env python3
"""FAKE `codex` binary for forge_codex tests. Never contacts a network, never spends anything.

Invoked exactly as the real binary is:
  py -3 _fake_codex.py --mode <m> --image-root <dir> --sessions-root <dir> \
      exec [resume <thread_id>] --json --sandbox <s> --cd <dir> "<envelope>"

It encodes the observed codex-cli 0.146.1 contract (p1 hard limits 1-2, p1 probe A/C event shapes,
P2b's rollout-log shape) so a real CLI upgrade is a cheap diff against this file."""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

INK = (36, 26, 18)          # #241a12 -> darkest-3% mean R-B == +18.0 by construction
PAPER = (240, 240, 235)
SIZES = {"ok": (1672, 941), "resume_ok": (1672, 941), "paraphrase": (1672, 941),
         "no_rollout": (1672, 941), "two_images": (1672, 941),
         "ok_portrait": (941, 1672), "wrong_ratio": (1200, 900)}

_SEEDS_RE = re.compile(r"referenced_image_paths = \[(.*?)\]", re.S)
_PROMPT_RE = re.compile(r"Read the file at (.+?) and pass its exact byte content", re.S)


def thread_id_for(seed_text):
    h = hashlib.sha1(seed_text.encode("utf-8")).hexdigest()
    return f"019ff{h[0:3]}-{h[3:7]}-7{h[7:10]}-{h[10:14]}-{h[14:26]}"


def parse_envelope(envelope):
    m = _PROMPT_RE.search(envelope)
    prompt_path = m.group(1).strip() if m else None
    m2 = _SEEDS_RE.search(envelope)
    raw = m2.group(1).strip() if m2 else ""
    seeds = [s.strip() for s in raw.split(",") if s.strip()]
    return prompt_path, seeds


def enforce_contract(seeds):
    """The two server-side rejections p1 measured, with their real error strings."""
    if len(seeds) > 5:
        sys.stderr.write("ERROR codex_core::tools::router: error=referenced_image_paths must "
                         "contain at most 5 paths\n")
        return 1
    for s in seeds:
        if not os.path.isabs(s):
            sys.stderr.write("ERROR codex_core::tools::router: error=AbsolutePathBuf deserialized "
                             "without a base path at line 1 column 337\n")
            return 1
    return 0


def write_png(path, size):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size, PAPER)
    d = ImageDraw.Draw(im)
    w, h = size
    d.rectangle([0, 0, w - 1, int(h * 0.06)], fill=INK)      # >3% of pixels, the darkest by far
    d.rectangle([0, int(h * 0.94), w - 1, h - 1], fill=INK)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG")


def write_rollout(sessions_root, thread_id, prompt_text, pre_calls=3):
    """P2b's shape: response_item lines, `custom_tool_call` items whose `input` is the literal JS."""
    now = datetime.datetime.now()
    d = Path(sessions_root) / f"{now:%Y}" / f"{now:%m}" / f"{now:%d}"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"rollout-{now:%Y-%m-%dT%H-%M-%S}-{thread_id}.jsonl"
    lines = []
    for i in range(pre_calls):
        lines.append({"type": "response_item",
                      "payload": {"type": "custom_tool_call", "name": "shell",
                                  "input": f"const r{i} = await tools.shell({{cmd:'ls'}});"}})
    js = ("const params = {\n  prompt: %s,\n  referenced_image_paths: []\n};\n"
          "const result = await tools.image_gen__imagegen(params);\n"
          % json.dumps(prompt_text))
    lines.append({"type": "response_item",
                  "payload": {"type": "custom_tool_call", "name": "exec", "input": js}})
    lines.append({"type": "response_item",
                  "payload": {"type": "custom_tool_call_output",
                              "output": json.dumps({"prompt": prompt_text,
                                                    "image_url": "data:image/png;base64,AAAA"})}})
    with open(path, "w", encoding="utf-8") as f:
        for row in lines:
            f.write(json.dumps(row) + "\n")
    return path


def emit(ev):
    sys.stdout.write(json.dumps(ev) + "\n")
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--mode", required=True)
    ap.add_argument("--image-root", required=True)
    ap.add_argument("--sessions-root", required=True)
    args, tail = ap.parse_known_args()
    if not tail or tail[0] != "exec":
        sys.stderr.write("fake codex: expected `exec` subcommand\n"); return 2
    rest = tail[1:]
    resume_id = None
    if rest and rest[0] == "resume":
        resume_id, rest = rest[1], rest[2:]
    if "--json" not in rest:
        sys.stderr.write("fake codex: --json is required by the runner contract\n"); return 2
    if "--sandbox" not in rest or "--cd" not in rest:
        sys.stderr.write("fake codex: --sandbox and --cd are required by the runner contract\n")
        return 2
    envelope = rest[-1]
    prompt_path, seeds = parse_envelope(envelope)
    rc = enforce_contract(seeds)
    if rc:
        return rc
    prompt_text = Path(prompt_path).read_text(encoding="utf-8") if prompt_path else ""
    mode = args.mode

    if mode == "stall":
        time.sleep(600)
        return 0
    if mode == "bad_json":
        sys.stdout.write("not json at all\n{oops\n"); sys.stdout.flush(); return 0

    tid = resume_id or thread_id_for(f"{mode}|{envelope}")
    if mode != "no_thread_event":
        emit({"type": "thread.started", "thread_id": tid})
    emit({"type": "turn.started"})

    img_dir = Path(args.image_root) / tid
    n_existing = len(list(img_dir.glob("*.png"))) if img_dir.is_dir() else 0
    stamp = hashlib.sha1(f"{tid}|{n_existing}".encode()).hexdigest()[:8]

    if mode in ("ok", "ok_portrait", "wrong_ratio", "resume_ok", "paraphrase", "no_rollout"):
        write_png(img_dir / f"exec-{stamp}.png", SIZES.get(mode, (1672, 941)))
        emit({"type": "item.completed",
              "item": {"id": "item_9", "type": "agent_message",
                       "text": f"Saved output:\n\n`{img_dir / f'exec-{stamp}.png'}`"}})
    elif mode == "two_images":
        write_png(img_dir / f"exec-{stamp}a.png", SIZES["two_images"])
        write_png(img_dir / f"exec-{stamp}b.png", SIZES["two_images"])
        emit({"type": "item.completed",
              "item": {"id": "item_9", "type": "agent_message", "text": "Saved two outputs."}})
    elif mode == "tiny_png":
        img_dir.mkdir(parents=True, exist_ok=True)
        (img_dir / f"exec-{stamp}.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200)
        emit({"type": "item.completed",
              "item": {"id": "item_9", "type": "agent_message", "text": "Saved output."}})
    elif mode == "no_image":
        emit({"type": "item.completed",
              "item": {"id": "item_9", "type": "agent_message",
                       "text": "I was unable to produce an image this turn."}})
    elif mode == "refuse":
        emit({"type": "item.completed",
              "item": {"id": "item_9", "type": "agent_message",
                       "text": "I can't help with generating that image."}})
    elif mode == "quota":
        emit({"type": "item.completed",
              "item": {"id": "item_9", "type": "agent_message",
                       "text": "You've hit your usage limit. Try again later."}})
    elif mode == "nonzero_exit":
        sys.stderr.write("stream error: unexpected end of stream\n")
        return 1
    else:
        sys.stderr.write(f"fake codex: unknown --mode {mode}\n"); return 2

    if mode not in ("no_rollout",):
        rollout_text = ("PARAPHRASED: " + prompt_text) if mode == "paraphrase" else prompt_text
        write_rollout(args.sessions_root, tid, rollout_text)

    emit({"type": "turn.completed",
          "usage": {"input_tokens": 75742, "cached_input_tokens": 48384,
                    "cache_write_input_tokens": 0, "output_tokens": 1593,
                    "reasoning_output_tokens": 742}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 4 passed ==`.

- [ ] Confirm zero blast radius:

```
git -C C:/Users/danie/kb-worktrees/boss-codex-image-engine diff --exit-code orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py
```

  Expected: no output, exit 0.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/_fake_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "test(codex-engine): fake codex binary -- argv contract, ok mode, PNG + rollout log"
```

---

## Task B2 — the remaining `--mode` switches

`_fake_codex.py` already implements every branch; this task proves each one behaves as Phase C will
depend on, so a later failure is attributed to `forge_codex.py` and never to the fixture.

**Files**
- Modify: `<SCRIPTS>/test_forge_codex.py` (add tests only)
- Modify: `<SCRIPTS>/_fake_codex.py` only if a test exposes a defect

**Interfaces**
- Consumes: `fake_prefix`, `run_fake`, `_events`, `_scratch`, `ENVELOPE_FMT` (Task B1).
- Produces: no new symbols.

**Steps**

- [ ] Add these tests to `<SCRIPTS>/test_forge_codex.py` (above the `ALL_TESTS` line):

```python
def _run(mode, tmp, prompt, seed, **kw):
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    return run_fake(mode, envelope=env, image_root=tmp / "generated_images",
                    sessions_root=tmp / "sessions", **kw)


def _tid(result):
    return _events(result.stdout)[0]["thread_id"]


def test_fake_modes_image_shapes():
    tmp, prompt, seed = _scratch()
    from PIL import Image
    r = _run("ok_portrait", tmp, prompt, seed)
    p = next((tmp / "generated_images" / _tid(r)).glob("*.png"))
    assert Image.open(p).size == (941, 1672)
    r = _run("wrong_ratio", tmp, prompt, seed)
    p = next((tmp / "generated_images" / _tid(r)).glob("*.png"))
    assert Image.open(p).size == (1200, 900)
    r = _run("two_images", tmp, prompt, seed)
    assert len(list((tmp / "generated_images" / _tid(r)).glob("*.png"))) == 2
    r = _run("tiny_png", tmp, prompt, seed)
    p = next((tmp / "generated_images" / _tid(r)).glob("*.png"))
    assert p.stat().st_size <= 1024


def test_fake_no_image_refuse_and_quota_complete_the_turn_with_no_png():
    tmp, prompt, seed = _scratch()
    for mode, marker in (("no_image", "unable to produce"),
                         ("refuse", "can't help"),
                         ("quota", "usage limit")):
        r = _run(mode, tmp, prompt, seed)
        assert r.returncode == 0, (mode, r.stderr)
        evs = _events(r.stdout)
        assert evs[-1]["type"] == "turn.completed"
        assert any(marker in e.get("item", {}).get("text", "") for e in evs), mode
        assert not list((tmp / "generated_images" / _tid(r)).glob("*.png")), mode


def test_fake_transport_failure_modes():
    tmp, prompt, seed = _scratch()
    r = _run("nonzero_exit", tmp, prompt, seed)
    assert r.returncode == 1 and "stream error" in r.stderr
    r = _run("bad_json", tmp, prompt, seed)
    assert "not json at all" in r.stdout
    r = _run("no_thread_event", tmp, prompt, seed)
    assert all(json.loads(l)["type"] != "thread.started" for l in r.stdout.splitlines() if l.strip())


def test_fake_stall_mode_does_not_return_within_two_seconds():
    tmp, prompt, seed = _scratch()
    env = ENVELOPE_FMT.format(prompt_path=prompt, seeds=str(seed))
    proc = subprocess.Popen(fake_prefix("stall", tmp / "generated_images", tmp / "sessions")
                            + ["exec", "--json", "--sandbox", "workspace-write", "--cd", str(tmp),
                               env], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        timed_out = False
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            timed_out = True
        assert timed_out is True
    finally:
        proc.kill()
        proc.wait(timeout=10)


def test_fake_rollout_variants_paraphrase_and_none():
    tmp, prompt, seed = _scratch()
    r = _run("paraphrase", tmp, prompt, seed)
    roll = next((tmp / "sessions").glob(f"*/*/*/rollout-*-{_tid(r)}.jsonl"))
    assert "PARAPHRASED: " in roll.read_text(encoding="utf-8")
    r = _run("no_rollout", tmp, prompt, seed)
    assert not list((tmp / "sessions").glob(f"*/*/*/rollout-*-{_tid(r)}.jsonl"))
    assert len(list((tmp / "generated_images" / _tid(r)).glob("*.png"))) == 1


def test_fake_resume_writes_a_second_png_into_the_same_thread_dir():
    tmp, prompt, seed = _scratch()
    first = _run("resume_ok", tmp, prompt, seed)
    tid = _tid(first)
    assert len(list((tmp / "generated_images" / tid).glob("*.png"))) == 1
    second = _run("resume_ok", tmp, prompt, seed, resume_thread=tid)
    assert _tid(second) == tid
    assert len(list((tmp / "generated_images" / tid).glob("*.png"))) == 2
```

- [ ] Run to see the new tests fail or pass, and fix `_fake_codex.py` only if a genuine defect
  appears:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 10 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/_fake_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "test(codex-engine): fake binary failure-mode switches proven (15 modes)"
```

---

# PHASE C — `forge_codex.py`, built TDD against the fake

Every task in this phase appends to the same two files: `<SCRIPTS>/forge_codex.py` and
`<SCRIPTS>/test_forge_codex.py`. Nothing here spawns the real codex binary.

---

## Task C1 — module skeleton, import-surface contract, no-key construction

Spec §8.2 cases 1 + 2, and §3.2's import-safety audit. This is the test that makes ruling 7's library
coupling loud instead of silent.

**Files**
- Create: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes from `forge.py` (read-only, exact signatures verified in this task):
  `Kit(kit, dry=False)`, `preflight_batch(k, reqs, force, dry)`, `resolve_request_seeds(k, r, pending=())`,
  `verify_request_seed_digests(k, r, seeds)`, `validate_png(data)`, `to_png_bytes(data)`,
  `SeedIntegrityError`, `SEED_CAP`, `_staging_png(k, name)`, `_existing_staging_png(path)`,
  `_reserve_staging_output(k, name, force)`, `_publish_staging_png(k, name, out, data, force)`,
  `_release_staging_lock(lock, token)`, `_stem(path)`.
- Produces: module `forge_codex` exporting `CODEX_ARGV_PREFIX`, `IMAGE_ROOT`, `SESSIONS_ROOT`,
  `TIMEOUT_S`, `CODEX_SEED_CAP`, `TRANSPORT_SEED_CEILING`, `ENGINE_ID`, `resolve_codex_binary() -> str`,
  `RatioError`, `CodexContractError`, `CodexRunError`; and test helper
  `make_kit(tmp: Path) -> tuple[str, Path]` returning `(kit_path, repo_root)`.

**Steps**

- [ ] Add the failing tests to `<SCRIPTS>/test_forge_codex.py` (above `ALL_TESTS`):

```python
STYLE_BIBLE = """# Style bible (test fixture)

## LOCKED STYLE descriptor
> clean flat 2.5D vector cartoon, even medium-thick #241a12 outline, flat cel colour.

## STYLE-ONLY descriptor
> flat cel colour, no gradients, no ambient occlusion.

## RIG-HOLD descriptor
> no nose, no ears, four digits per hand, squat proportion.

## CROWD-RIG clause
> anonymous background figures inherit the squat base proportion and dot-eye face.
"""

REGISTRY = {
    "channel": "the-second-take",
    "engine": "gemini-3-pro-image",
    "characters": {
        "base": {"base": "channels/x/visual-kit/refs/base/base.png"},
        "miniscribe-rep": {"base": "channels/x/visual-kit/refs/miniscribe-rep/miniscribe-rep.png"},
        "ibm-suit": {"base": "channels/x/visual-kit/refs/ibm-suit/ibm-suit.png"},
        "terry-johnson": {"base": "channels/x/visual-kit/refs/terry-johnson/terry-johnson.png"},
    },
    "assets": [
        {"name": "expr-delighted", "kind": "expression", "tag": "delighted", "character": "base",
         "file": "channels/x/visual-kit/refs/base/expr-delighted.png"},
        {"name": "expr-crestfallen", "kind": "expression", "tag": "crestfallen", "character": "base",
         "file": "channels/x/visual-kit/refs/base/expr-crestfallen.png"},
        {"name": "action-powerstance", "kind": "action", "tag": "powerstance", "character": "base",
         "file": "channels/x/visual-kit/refs/base/action-powerstance.png"},
        {"name": "hold-both-hands", "kind": "pose", "tag": "both-hands", "character": "base",
         "file": "channels/x/visual-kit/refs/base/hold-both-hands.png"},
        {"name": "handshake", "kind": "interaction", "tag": "handshake", "character": "base",
         "file": "channels/x/visual-kit/refs/base/handshake.png"},
        {"name": "crowd-exemplar", "kind": "crowd-anchor", "tag": "crowd", "character": "base",
         "file": "channels/x/visual-kit/refs/base/crowd-exemplar.png"},
    ],
}


def make_kit(tmp):
    """A minimal but REAL kit forge.Kit(dry=True) accepts. The `.env` here is an empty temp-dir
    sentinel that only anchors Kit.root -- the repo's real .env is never read by anything."""
    root = Path(tmp)
    (root / ".env").write_text("", encoding="utf-8")
    kit = root / "channels" / "x" / "visual-kit"
    (kit / "registry").mkdir(parents=True)
    (kit / "refs" / "base").mkdir(parents=True)
    (kit / "_staging").mkdir(parents=True)
    (kit / "style-bible.md").write_text(STYLE_BIBLE, encoding="utf-8")
    (kit / "registry" / "registry.json").write_text(json.dumps(REGISTRY), encoding="utf-8")
    return str(kit), root


def test_import_surface_contract_matches_forge():
    import inspect
    import forge
    import forge_codex  # noqa: F401
    expected = {
        "Kit": ["kit", "dry"],
        "preflight_batch": ["k", "reqs", "force", "dry"],
        "resolve_request_seeds": ["k", "r", "pending"],
        "verify_request_seed_digests": ["k", "r", "seeds"],
        "validate_png": ["data"],
        "to_png_bytes": ["data"],
        "_staging_png": ["k", "name"],
        "_existing_staging_png": ["path"],
        "_reserve_staging_output": ["k", "name", "force"],
        "_publish_staging_png": ["k", "name", "out", "data", "force"],
        "_release_staging_lock": ["lock", "token"],
        "_stem": ["path"],
    }
    for name, params in expected.items():
        obj = getattr(forge, name, None)
        assert obj is not None, f"forge.{name} disappeared -- forge_codex imports it"
        target = obj.__init__ if inspect.isclass(obj) else obj
        got = [p for p in inspect.signature(target).parameters if p != "self"]
        assert got == params, f"forge.{name} signature drifted: {got} != {params}"
    assert issubclass(forge.SeedIntegrityError, RuntimeError)
    assert forge.SEED_CAP == 4


def test_importing_forge_has_no_side_effects():
    tmp = Path(tempfile.mkdtemp(prefix="importsafe-"))
    before = set(os.listdir(tmp))
    r = subprocess.run([sys.executable, "-c",
                        "import sys; sys.path.insert(0, r'%s'); import forge, forge_codex" % HERE],
                       cwd=str(tmp), capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == ""
    assert set(os.listdir(tmp)) == before
    src = (HERE / "forge.py").read_text(encoding="utf-8")
    assert 'if __name__ == "__main__":' in src


def test_kit_builds_with_no_key_and_no_url():
    import forge
    tmp = Path(tempfile.mkdtemp(prefix="nokey-"))
    kit, _root = make_kit(tmp)
    saved = os.environ.pop("GEMINI_API_KEY", None)
    try:
        k = forge.Kit(kit, dry=True)
    finally:
        if saved is not None:
            os.environ["GEMINI_API_KEY"] = saved
    assert k.url is None
    assert k.key == ""
    assert k.ctx is None
    assert k.desc_identity and k.desc_crowdrig
    assert k.reg["characters"]["miniscribe-rep"]


def test_resolve_codex_binary_is_never_called_at_import_and_fails_loud():
    import forge_codex
    saved = forge_codex.CODEX_ARGV_PREFIX
    forge_codex.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    try:
        raised = None
        try:
            forge_codex.resolve_codex_binary()
        except SystemExit as e:
            raised = str(e)
        assert raised is not None and "codex CLI not found on PATH" in raised
    finally:
        forge_codex.CODEX_ARGV_PREFIX = saved
    forge_codex.CODEX_ARGV_PREFIX = [sys.executable]
    try:
        assert os.path.isfile(forge_codex.resolve_codex_binary())
    finally:
        forge_codex.CODEX_ARGV_PREFIX = saved

```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `ModuleNotFoundError: No module named 'forge_codex'`.

- [ ] Create `<SCRIPTS>/forge_codex.py`:

```python
#!/usr/bin/env python3
"""forge_codex — the codex-CLI image engine, a STANDALONE peer runner beside forge.py.

Ruling 7 (2026-08-11): zero forge.py edits. This module imports forge.py READ-ONLY as a library
(shot truth + staging discipline) and owns everything provider-specific: the prompt composer, the
`codex exec` invocation, harvest, the fidelity audit, normalization, failure classification and the
engine log. `git diff forge.py` must stay empty.

Subscription-billed: $0 API spend. No key is ever loaded — every Kit is built dry (forge.py L315-318).
"""
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from forge import (Kit, preflight_batch, resolve_request_seeds, verify_request_seed_digests,  # noqa: E402
                   validate_png, to_png_bytes, SeedIntegrityError, SEED_CAP,
                   _staging_png, _existing_staging_png, _reserve_staging_output,
                   _publish_staging_png, _release_staging_lock, _stem)

# --- environment, carried as module constants so tests patch them and production has no env-var
# --- override surface (§4.4). resolve_codex_binary() is called from the RUN LOOP, never at import.
CODEX_ARGV_PREFIX = ["codex"]
IMAGE_ROOT = os.path.expanduser("~/.codex/generated_images")
SESSIONS_ROOT = os.path.expanduser("~/.codex/sessions")
TIMEOUT_S = 240

ENGINE_ID = "codex-imagegen"
CODEX_SEED_CAP = 4              # the runner's own cap; the slates it consumes are built under 4
TRANSPORT_SEED_CEILING = 5      # server-enforced, p1 probe F


class RatioError(RuntimeError):
    """The render's native aspect ratio is outside the 5% normalization tolerance (class 7)."""


class CodexContractError(RuntimeError):
    """A deterministic contract violation detected before any subprocess (class 1)."""


class CodexRunError(RuntimeError):
    """A per-item transport/provider failure. `.failure_class` names the §6 class."""

    def __init__(self, failure_class, message):
        super().__init__(message)
        self.failure_class = failure_class


def resolve_codex_binary():
    """Fail loud, at run time, never at import: importing forge_codex needs no codex install."""
    exe = shutil.which(CODEX_ARGV_PREFIX[0])
    if exe is None:
        raise SystemExit(f"codex CLI not found on PATH ({CODEX_ARGV_PREFIX[0]!r}) — install it, or "
                         f"patch forge_codex.CODEX_ARGV_PREFIX in tests")
    return exe
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 14 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): forge_codex skeleton + import-surface contract test"
```

---

## Task C2 — idiom translation table + residual scan

Spec §4.3, test case 7. P1 probe E2 rendered a literal `TOTE RACK / STAGE-LEFT` sign from this
pipeline's staging idiom; the table changes wording only and never deletes a staging fact.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: nothing new.
- Produces: `IDIOM_TABLE: list[tuple[re.Pattern, str]]`, `translate_idiom(text: str) -> str`,
  `residual_idiom(text: str) -> list[str]`.

**Steps**

- [ ] Add the failing tests (real L46 / L47 payload text from `<VIDEO>/shots.json`):

```python
L46_PAYLOAD = ("One seeded performer, `base`, `expr-crestfallen`, `hold-both-hands`, in a grey work "
               "coat, stage-left, carrying a cardboard box of desk things down the length of the "
               "assembly floor toward the roller door. On the far side of the far bench a subdued "
               "crowd stands and watches him go, arms down, faces flat and tired. Cool grey-teal "
               "palette drained toward grey, flat strip light with every fourth ceiling fitting "
               "dark, foreground depth from a cropped bench end at the lower-right.")

L47_PAYLOAD = ("`terry-johnson`, `expr-crestfallen`, `carry-by-handle`, stage-right, stepping out "
               "through a glass door onto a car park apron with a document case at his side, his "
               "back half turned to the floor behind him. Through the glass the assembly floor runs "
               "away into the depth with its benches bare. Grey-cream-teal palette, flat overcast "
               "light outside against warm strip light inside, foreground depth from a cropped kerb "
               "at the lower-left.")


def test_idiom_table_translates_every_documented_direction():
    import forge_codex as fc
    assert fc.translate_idiom("stage-left,") == "on the left of the frame,"
    assert fc.translate_idiom("Stage Right") == "on the right of the frame"
    assert fc.translate_idiom("stage-centre") == "centred in the frame"
    assert fc.translate_idiom("stage center") == "centred in the frame"
    assert fc.translate_idiom("upstage") == "toward the back of the frame"
    assert fc.translate_idiom("up stage") == "toward the back of the frame"
    assert fc.translate_idiom("downstage") == "toward the front of the frame"
    assert fc.translate_idiom("camera-left") == "on the left of the frame"
    assert fc.translate_idiom("camera right") == "on the right of the frame"
    assert fc.translate_idiom("off-stage") == "outside the frame"
    assert fc.translate_idiom("offstage") == "outside the frame"


def test_idiom_translation_on_real_shot_payloads_keeps_every_fact():
    import forge_codex as fc
    out46 = fc.translate_idiom(L46_PAYLOAD)
    assert "stage-left" not in out46 and "on the left of the frame" in out46
    for noun in ("grey work coat", "cardboard box", "roller door", "subdued", "bench"):
        assert noun in out46, noun
    assert len(out46.split()) >= len(L46_PAYLOAD.split())
    out47 = fc.translate_idiom(L47_PAYLOAD)
    assert "stage-right" not in out47 and "on the right of the frame" in out47
    for noun in ("glass door", "car park apron", "document case", "kerb"):
        assert noun in out47, noun


def test_idiom_translation_never_touches_quoted_literals():
    import forge_codex as fc
    src = "a painted board reading 'STAGE-LEFT' hanging stage-left over him"
    out = fc.translate_idiom(src)
    assert "'STAGE-LEFT'" in out
    assert "hanging on the left of the frame over him" in out
    src2 = 'the sign "UPSTAGE DOCK" seen from upstage'
    out2 = fc.translate_idiom(src2)
    assert '"UPSTAGE DOCK"' in out2 and "from toward the back of the frame" in out2


def test_residual_scan_warns_without_raising():
    import forge_codex as fc
    assert fc.residual_idiom(L47_PAYLOAD) == []
    hits = fc.residual_idiom("he waits in the wings, left of the blocking mark")
    assert hits and any("wings" in h for h in hits)
    assert isinstance(hits, list)
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'translate_idiom'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py` (after the exceptions block):

```python
import re  # noqa: E402

# --- §4.3 idiom translation: this pipeline's STAGING idiom renders as literal signage on codex
# --- (p1 probe E2 minted a "TOTE RACK / STAGE-LEFT" sign). Ordered, word-boundary, case-insensitive.
# --- It changes WORDING only: dropping a load-bearing staging fact would be the fidelity violation
# --- named at SKILL.md L395-397.
IDIOM_TABLE = [
    (re.compile(r"\boff[-\s]?stage\b", re.I), "outside the frame"),
    (re.compile(r"\bstage[-\s](?:centre|center)\b", re.I), "centred in the frame"),
    (re.compile(r"\bstage[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bstage[-\s]right\b", re.I), "on the right of the frame"),
    (re.compile(r"\bup\s?stage\b", re.I), "toward the back of the frame"),
    (re.compile(r"\bdown\s?stage\b", re.I), "toward the front of the frame"),
    (re.compile(r"\bcamera[-\s]left\b", re.I), "on the left of the frame"),
    (re.compile(r"\bcamera[-\s]right\b", re.I), "on the right of the frame"),
]

# A quoted span is diegetic and load-bearing (SKILL.md L136-138): it must render verbatim, so the
# table is applied only to the UNQUOTED spans between them.
_QUOTED_SPAN = re.compile(r'"[^"\n]{1,60}"' r"|'[^'\n]{1,60}'")

_RESIDUAL = re.compile(r"\b(stage|wings|blocking)\b", re.I)
_DIRECTION_NEAR = re.compile(r"\b(left|right|centre|center|front|back|up|down|mark)\b", re.I)


def translate_idiom(text):
    """Apply IDIOM_TABLE to every unquoted span of `text`; quoted literals pass through untouched."""
    out, pos = [], 0
    for m in _QUOTED_SPAN.finditer(text or ""):
        out.append(_translate_span(text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_translate_span((text or "")[pos:]))
    return "".join(out)


def _translate_span(span):
    for pattern, replacement in IDIOM_TABLE:
        span = pattern.sub(replacement, span)
    return span


def residual_idiom(text):
    """WARN-level scan for staging idiom the table cannot claim to cover. Never raises: the table
    is not provably exhaustive and hard-failing on authored prose would block legitimate shots."""
    hits = []
    for m in _RESIDUAL.finditer(translate_idiom(text or "")):
        window = (text or "")[max(0, m.start() - 40):m.end() + 40]
        if _DIRECTION_NEAR.search(window):
            hits.append(window.strip())
    return hits
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 18 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): staging-idiom translation table + residual WARN scan"
```

---

## Task C3 — the `CANVAS` table and the framing line

Spec §4.6 + test case 8. `(16:9, 1K) = 1376×768` is calibrated to the 23 measured baseline frames,
not to SKILL.md L130's approximate figure. An `(aspect, size)` pair absent from the table is a
fail-loud error naming the pair, never a guess.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: Task A4's verdict in `<ARC>/p4-probe7-canvas-rows.md` — if it VERIFIED a different
  `(2:3,1K)` or `(9:16,1K)` value, use the **measured** value in `CANVAS` and say so in the comment.
- Produces: `CANVAS: dict[tuple[str, str], tuple[int, int]]`,
  `resolve_canvas(aspect: str, image_size: str) -> tuple[int, int]`,
  `framing_line(aspect: str, canvas: tuple[int, int]) -> str`.

**Steps**

- [ ] Add the failing tests:

```python
def test_canvas_table_and_framing_line():
    import forge_codex as fc
    assert fc.resolve_canvas("16:9", "1K") == (1376, 768)
    assert fc.resolve_canvas("16:9", "2K") == (2752, 1536)
    assert fc.resolve_canvas("2:3", "1K") == (832, 1248)
    assert fc.resolve_canvas("9:16", "1K") == (768, 1344)
    assert fc.framing_line("16:9", (1376, 768)) == (
        "Composition/framing: Compose for a 1376\u00d7768 pixel frame \u2014 a 16:9 landscape "
        "aspect ratio.")
    assert fc.framing_line("2:3", (832, 1248)).endswith("a 2:3 portrait aspect ratio.")


def test_unknown_canvas_pair_fails_loud_naming_the_pair():
    import forge_codex as fc
    raised = None
    try:
        fc.resolve_canvas("21:9", "1K")
    except SystemExit as e:
        raised = str(e)
    assert raised is not None and "21:9" in raised and "1K" in raised
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'resolve_canvas'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
# --- §4.6 normalization canvas. (16:9,1K) is MEASURED: all 23 verified baseline frames in
# --- scratch-codex-image-engine/gemini-baseline/ are 1376x768 (SKILL.md L130's "~1344x768" is an
# --- approximation). 2:3 and 9:16 rows are carried from the doc unless P4 probe 7 measured them.
# --- 2K rows are 2x linear. A pair absent from this table is an error, never a guess.
CANVAS = {
    ("16:9", "1K"): (1376, 768),
    ("16:9", "2K"): (2752, 1536),
    ("2:3", "1K"): (832, 1248),
    ("2:3", "2K"): (1664, 2496),
    ("9:16", "1K"): (768, 1344),
    ("9:16", "2K"): (1536, 2688),
}


def resolve_canvas(aspect, image_size):
    key = (str(aspect), str(image_size))
    if key not in CANVAS:
        raise SystemExit(f"no canvas row for (aspect={key[0]!r}, image_size={key[1]!r}) — measure a "
                         f"real frame of that pair before generating one (spec §4.6, §8.5 probe 7)")
    return CANVAS[key]


def framing_line(aspect, canvas):
    """MANDATORY on every composed prompt: omitting aspect language returns an arbitrary ratio
    (p1 probe G1 got 1122x1402 on a 16:9 shot); stating it lands within ~0.1-2% in every probe."""
    w, h = canvas
    orientation = "landscape" if w > h else ("portrait" if h > w else "square")
    return (f"Composition/framing: Compose for a {w}\u00d7{h} pixel frame \u2014 a {aspect} "
            f"{orientation} aspect ratio.")
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 20 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): measured CANVAS table + mandatory framing line"
```

---

## Task C4 — the composer

Spec §4.1-4.3, test cases 3, 4, 5, 6. Deterministic pure function of (spec item, registry, canvas,
aspect). Fields emit in the schema's own order; the house-style block is stated **once**;
`Avoid:` is mandatory; a field with no distinct source is omitted (bloat at constant facts measured
~6× worse, P2b E1).

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `translate_idiom` (C2), `framing_line` (C3).
- Produces: `USE_CASE`, `ASSET_TYPE`, `CODEX_REGISTER_BLOCK: dict[str, str]`,
  `AVOID_BASE: list[str]`, `COMPOSED_CHAR_BUDGET: int`,
  `resolve_slugs(text: str, reg: dict) -> str`, `quoted_literals(text: str) -> list[str]`,
  `input_images_line(seed_roles: list[dict]) -> str`,
  `constraints_text(item: dict) -> str`, `avoid_text(has_quotes: bool) -> str`,
  `compose_prompt(item: dict, *, reg: dict, canvas: tuple[int, int], aspect: str) -> str`.

**Steps**

- [ ] Add the failing tests, including the byte-exact golden for L29:

```python
L29_PAYLOAD = ("`miniscribe-rep`, `expr-delighted`, `action-powerstance`, planted centre in the "
               "entrance at the back of the assembly floor, the painted board 'MINISCRIBE' hanging "
               "over him. The floor as established: two long steel benches running back into the "
               "depth, the rack of tote bins stage-left, the roller door shut beyond. Cool "
               "grey-teal-cream palette, flat strip light, foreground depth from a cropped bench "
               "end at the lower-right.")

L29_GOLDEN = (
    "Use case: illustration-story\n"
    "Asset type: documentary-style animated video still frame\n"
    "Primary request: miniscribe-rep, delighted expression, powerstance pose, planted centre in "
    "the entrance at the back of the assembly floor, the painted board 'MINISCRIBE' hanging over "
    "him. The floor as established: two long steel benches running back into the depth, the rack "
    "of tote bins on the left of the frame, the roller door shut beyond. Cool grey-teal-cream "
    "palette, flat strip light, foreground depth from a cropped bench end at the lower-right.\n"
    "Input images: Image 1: character reference for miniscribe-rep \u2014 match exactly. "
    "Image 2: place reference \u2014 preserve its set, palette and outline weight.\n"
    "Style/medium: clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline "
    "(#241a12), flat cel colour fills with gentle soft shading only, rounded friendly shapes, no "
    "realistic detail\n"
    "Composition/framing: Compose for a 1376\u00d7768 pixel frame \u2014 a 16:9 landscape aspect "
    "ratio.\n"
    "Color palette: locked 2-3 colour scene palette plus a single red accent #d7402b reserved only "
    "for alarm / prohibition / ownership / the final punch element\n"
    "Materials/textures: flat cel fills only, no gradients, no ambient occlusion\n"
    "Text (verbatim): \"MINISCRIBE\" \u2014 render exactly this text and nothing else.\n"
    "Constraints: preserve miniscribe-rep's exact costume, proportions and line weight from the "
    "reference image; environment stays a built-but-flat environment \u2014 minimal geometry plus "
    "one foreground depth prop, not a fully rendered set\n"
    "Avoid: photorealism, on-screen narrator or host face, logos, gradients and cast shadows, soft "
    "ambient shading, unrequested text or signage beyond the quoted text and invented staging "
    "labels\n"
)


def _item_L29():
    return {"name": "L29", "mode": "environment", "aspect": "16:9", "payload": L29_PAYLOAD,
            "figures": None,
            "seed_roles": [
                {"path": "C:/k/refs/miniscribe-rep/fig-miniscribe-rep.png", "role": "figure",
                 "character": "miniscribe-rep"},
                {"path": "C:/k/_staging/L28.png", "role": "place", "character": None}]}


def _item_L26():
    return {"name": "L26", "mode": "environment", "aspect": "16:9", "figures": None,
            "payload": ("A flat top-down world map laid out across a concrete floor, oceans in pale "
                        "teal and landmasses in cream, every landmass left completely blank and "
                        "unlettered."),
            "seed_roles": [{"path": "C:/k/refs/env/scene-style-tile.png", "role": "style-anchor",
                            "character": None}]}


def test_composer_reproduces_the_L29_golden_byte_for_byte():
    import forge_codex as fc
    got = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert got == L29_GOLDEN, "\n--- got ---\n" + got + "\n--- want ---\n" + L29_GOLDEN


def test_composer_is_deterministic():
    import forge_codex as fc
    a = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    b = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert a == b and a.encode("utf-8") == b.encode("utf-8")


def test_primary_request_is_the_payload_verbatim_after_idiom_and_slug_resolution():
    import forge_codex as fc
    item = _item_L29()
    line = [l for l in fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768),
                                         aspect="16:9").split("\n")
            if l.startswith("Primary request: ")][0]
    body = line[len("Primary request: "):]
    assert body == fc.translate_idiom(fc.resolve_slugs(item["payload"], REGISTRY))
    assert "`" not in body


def test_input_images_line_follows_seed_roles_in_order():
    import forge_codex as fc
    roles = [{"path": "a.png", "role": "figure", "character": "ibm-suit"},
             {"path": "b.png", "role": "prop", "character": None},
             {"path": "c.png", "role": "style-anchor", "character": None},
             {"path": "d.png", "role": "interaction", "character": None}]
    line = fc.input_images_line(roles)
    assert line.startswith("Image 1: character reference for ibm-suit")
    assert "Image 2: prop reference" in line
    assert "Image 3: style reference only" in line
    assert "Image 4: interaction geometry reference" in line
    assert line.index("Image 1") < line.index("Image 2") < line.index("Image 3")


def test_text_field_present_with_quotes_and_absent_without():
    import forge_codex as fc
    with_quotes = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert 'Text (verbatim): "MINISCRIBE"' in with_quotes
    assert "unrequested text or signage beyond the quoted text" in with_quotes
    no_quotes = fc.compose_prompt(_item_L26(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "Text (verbatim):" not in no_quotes
    avoid = [l for l in no_quotes.split("\n") if l.startswith("Avoid: ")][0]
    assert avoid.startswith("Avoid: any words, letters, numerals or signage")


def test_fields_with_no_source_are_omitted_never_emitted_empty():
    import forge_codex as fc
    out = fc.compose_prompt(_item_L26(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "Scene/backdrop:" not in out and "Subject:" not in out and "Lighting/mood:" not in out
    for line in out.split("\n"):
        if line:
            assert not line.rstrip().endswith(":"), line


def test_crowd_clause_only_when_figures_crowd():
    import forge_codex as fc
    item = _item_L29()
    plain = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "background crowd figures" not in plain
    item["figures"] = {"crowd": True}
    crowded = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    assert "background crowd figures stay flat silhouetted shapes" in crowded


def test_brevity_budget_and_no_fact_stated_twice():
    import forge_codex as fc
    for item in (_item_L29(), _item_L26()):
        out = fc.compose_prompt(item, reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
        assert len(out) <= fc.COMPOSED_CHAR_BUDGET, (item["name"], len(out))
        assert out.count("#241a12") == 1
        assert out.count("clean flat 2.5D vector cartoon") == 1
        assert out.count("#d7402b") == 1
        assert out.count("Avoid:") == 1
        bodies = [l.split(": ", 1)[1] for l in out.split("\n") if ": " in l]
        for i, a in enumerate(bodies):
            for j, b in enumerate(bodies):
                assert i == j or a not in b, (a, b)


def test_dead_levers_stay_dead_no_head_tail_repetition():
    import forge_codex as fc
    out = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    lines = [l for l in out.split("\n") if l]
    assert lines[-1].startswith("Avoid: ")
    assert lines[0].startswith("Use case: ")
    assert "flat cel" not in lines[0] and "flat cel" not in lines[2]
    labels = [l.split(":", 1)[0] for l in lines]
    assert len(labels) == len(set(labels)), labels
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'compose_prompt'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
# --- §4.1-4.3 THE COMPOSER. Codex's own labeled schema (~/.codex/skills/.system/imagegen/SKILL.md
# --- L212-229), front-loaded, ONE trailing constraint block. Gemini's two-voice head+tail
# --- convention is NOT ported: P2b E2 measured it ~4x worse on this engine.
USE_CASE = "illustration-story"
ASSET_TYPE = "documentary-style animated video still frame"
COMPOSED_CHAR_BUDGET = 2200      # P2b E1: 1740 -> 4032 chars was ~6x worse at constant facts

CODEX_REGISTER_BLOCK = {
    "Style/medium": ("clean flat 2.5D vector cartoon, even medium-thick dark warm brown-black "
                     "outline (#241a12), flat cel colour fills with gentle soft shading only, "
                     "rounded friendly shapes, no realistic detail"),
    "Color palette": ("locked 2-3 colour scene palette plus a single red accent #d7402b reserved "
                      "only for alarm / prohibition / ownership / the final punch element"),
    "Materials/textures": "flat cel fills only, no gradients, no ambient occlusion",
}

# The single biggest measured register lever (P2b B/C: 2-3x closer, and zero unrequested text in
# EVERY dedicated-Avoid run). Kept to 6 items: short, hard, direct negation, never merged into
# Constraints -- the schema splits keep/avoid deliberately.
AVOID_BASE = ["photorealism", "on-screen narrator or host face", "logos",
              "gradients and cast shadows", "soft ambient shading"]
AVOID_TEXT_WITH_QUOTES = ("unrequested text or signage beyond the quoted text and invented staging "
                          "labels")
AVOID_TEXT_NO_QUOTES = "any words, letters, numerals or signage"

CONSTRAINT_FIGURE = ("preserve {who}'s exact costume, proportions and line weight from the "
                     "reference image")
CONSTRAINT_CROWD = ("background crowd figures stay flat silhouetted shapes in the scene palette, "
                    "no individual faces and no added named characters")
CONSTRAINT_ENVIRONMENT = ("environment stays a built-but-flat environment \u2014 minimal geometry "
                          "plus one foreground depth prop, not a fully rendered set")

# Short ordinal + role label. P2b D: all three tested framings prevented style-tile content leak
# equally, INCLUDING the cheapest -- verbosity is not protective, so the composer uses the short
# form. The role words restate forge's own `role` vocabulary (seed_roles_text L1270-1352).
_ROLE_CLAUSE = {
    "figure": "character reference for {who} \u2014 match exactly",
    "canonical": "character reference for {who} \u2014 match exactly",
    "pose": "pose reference for {who} \u2014 match the body position",
    "expression": "expression reference for {who} \u2014 match the face",
    "place": "place reference \u2014 preserve its set, palette and outline weight",
    "parent": "previous frame in this chain \u2014 preserve its set, palette and outline weight",
    "prop": "prop reference \u2014 include exactly as shown",
    "crowd": "crowd reference \u2014 match its figure proportion and face style",
    "interaction": "interaction geometry reference \u2014 match the contact and eye-line",
    "style-anchor": "style reference only",
}
_ROLE_CLAUSE_DEFAULT = "reference only"

_FIGURE_ROLES = ("figure", "canonical", "pose", "expression")
_SLUG = re.compile(r"`([A-Za-z0-9][A-Za-z0-9._-]*)`")
# A diegetic literal is short and quoted (SKILL.md L136-138: 1-4 words). The single-quote form is
# guarded on both sides so a possessive apostrophe can never pair into a false literal.
_QUOTED_LITERAL = re.compile(r'"([^"\n]{1,60})"' r"|(?<![A-Za-z0-9])'([^'\n]{1,40})'(?![A-Za-z0-9])")


def resolve_slugs(text, reg):
    """Backticked slugs -> plain words, resolved from the registry so the result is deterministic."""
    assets = {a["name"]: a for a in (reg or {}).get("assets", [])}

    def one(m):
        slug = m.group(1)
        asset = assets.get(slug)
        if asset:
            tag = asset.get("tag") or slug
            kind = asset.get("kind")
            if kind == "expression":
                return f"{tag} expression"
            if kind in ("pose", "action"):
                return f"{tag} pose"
            if kind == "interaction":
                return f"{tag} interaction staging"
            return str(tag)
        return slug

    return _SLUG.sub(one, text or "")


def quoted_literals(text):
    """The in-video diegetic text, in authored order, de-duplicated."""
    out = []
    for m in _QUOTED_LITERAL.finditer(text or ""):
        lit = (m.group(1) if m.group(1) is not None else m.group(2)).strip()
        if lit and len(lit.split()) <= 4 and lit not in out:
            out.append(lit)
    return out


def input_images_line(seed_roles):
    parts = []
    for i, entry in enumerate(seed_roles or [], start=1):
        who = entry.get("character") or _stem(entry.get("path", ""))
        clause = _ROLE_CLAUSE.get(entry.get("role"), _ROLE_CLAUSE_DEFAULT).format(who=who)
        parts.append(f"Image {i}: {clause}.")
    return " ".join(parts)


def constraints_text(item):
    out, seen = [], []
    for entry in item.get("seed_roles") or []:
        who = entry.get("character")
        if entry.get("role") in _FIGURE_ROLES and who and who not in seen:
            seen.append(who)
            out.append(CONSTRAINT_FIGURE.format(who=who))
    if (item.get("figures") or {}).get("crowd"):
        out.append(CONSTRAINT_CROWD)
    out.append(CONSTRAINT_ENVIRONMENT)
    return "; ".join(out)


def avoid_text(has_quotes):
    items = (AVOID_BASE + [AVOID_TEXT_WITH_QUOTES]) if has_quotes \
        else ([AVOID_TEXT_NO_QUOTES] + AVOID_BASE)
    return ", ".join(items)


def compose_prompt(item, *, reg, canvas, aspect):
    """Pure function of (item, registry, canvas, aspect): no model call, no randomness, no ambient
    state. That is what makes --dry-run print the exact bytes a live run would send, at $0."""
    payload = translate_idiom(resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    quotes = quoted_literals(item.get("payload") or "")
    lines = [f"Use case: {USE_CASE}",
             f"Asset type: {ASSET_TYPE}",
             f"Primary request: {payload}"]
    images = input_images_line(item.get("seed_roles") or [])
    if images:
        lines.append(f"Input images: {images}")
    lines.append(f"Style/medium: {CODEX_REGISTER_BLOCK['Style/medium']}")
    lines.append(framing_line(aspect, canvas))
    lines.append(f"Color palette: {CODEX_REGISTER_BLOCK['Color palette']}")
    lines.append(f"Materials/textures: {CODEX_REGISTER_BLOCK['Materials/textures']}")
    if quotes:
        joined = "; ".join(f'"{q}"' for q in quotes)
        lines.append(f"Text (verbatim): {joined} \u2014 render exactly this text and nothing else.")
    lines.append(f"Constraints: {constraints_text(item)}")
    lines.append(f"Avoid: {avoid_text(bool(quotes))}")
    return "\n".join(lines) + "\n"
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 29 passed ==`. If the golden diff fires, fix the **code** to match the golden — the
  golden encodes the reviewed prompt shape, not the other way round.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): deterministic labeled-field composer with golden L29 test"
```

---

## Task C5 — seed preparation: absoluteness, caps, digests

Spec §4.5 + §4.7, test case 9. The absoluteness assert costs nothing and the rejection costs a full
cold-process round trip (p1 hard limit 1). Silent truncation is the exact 2026-07-28 failure the
seeding law was written against.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `SeedIntegrityError`, `CODEX_SEED_CAP`, `TRANSPORT_SEED_CEILING`, `CodexContractError`.
- Produces: `prepare_seeds(item: dict, seeds: list[str]) -> list[str]`,
  `seed_digests(seeds: list[str]) -> dict[str, str]`,
  `reverify_seed_digests(name: str, expected: dict[str, str]) -> None`.

**Steps**

- [ ] Add the failing tests:

```python
def _png(path, n=4096):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(n))
    return str(path)


def test_prepare_seeds_requires_absolute_paths_and_realpaths_them():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    a = _png(tmp / "a.png")
    out = fc.prepare_seeds({"name": "L29"}, [a])
    assert out == [os.path.realpath(a)] and all(os.path.isabs(p) for p in out)
    raised = None
    try:
        fc.prepare_seeds({"name": "L29"}, ["refs/base/base.png"])
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L29" in raised and "absolute" in raised


def test_prepare_seeds_enforces_transport_ceiling_then_doctrine_cap():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    many = [_png(tmp / f"s{i}.png") for i in range(6)]
    raised = None
    try:
        fc.prepare_seeds({"name": "L33"}, many)
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L33" in raised and "at most 5" in raised
    raised = None
    try:
        fc.prepare_seeds({"name": "L33"}, many[:5])
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "L33" in raised and "CODEX_SEED_CAP" in raised
    assert "truncat" in raised
    assert len(fc.prepare_seeds({"name": "L33"}, many[:4])) == 4


def test_seed_digests_reverify_raises_seed_integrity_error_on_mutation():
    import forge_codex as fc
    from forge import SeedIntegrityError
    tmp = Path(tempfile.mkdtemp(prefix="seeds-"))
    a = _png(tmp / "a.png")
    expected = fc.seed_digests([a])
    fc.reverify_seed_digests("L29", expected)          # unchanged -> silent
    Path(a).write_bytes(b"\x89PNG\r\n\x1a\n" + os.urandom(4096))
    raised = None
    try:
        fc.reverify_seed_digests("L29", expected)
    except SeedIntegrityError as e:
        raised = str(e)
    assert raised is not None and "L29" in raised
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'prepare_seeds'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
import hashlib  # noqa: E402


def prepare_seeds(item, seeds):
    """§4.5 + §4.7. Transport ceiling first (server-enforced, p1 probe F), then the doctrine cap."""
    name = item.get("name", "<unnamed>")
    out = []
    for s in seeds or []:
        p = os.path.realpath(str(s))
        if not os.path.isabs(p):
            raise CodexContractError(f"{name}: seed path is not absolute after realpath: {s!r} — "
                                     f"codex rejects relative paths outright "
                                     f"(AbsolutePathBuf deserialized without a base path)")
        out.append(p)
    if len(out) > TRANSPORT_SEED_CEILING:
        raise CodexContractError(f"{name}: {len(out)} seeds — referenced_image_paths must contain "
                                 f"at most {TRANSPORT_SEED_CEILING} paths")
    if len(out) > CODEX_SEED_CAP:
        raise CodexContractError(f"{name}: slate carries {len(out)} seeds, over CODEX_SEED_CAP="
                                 f"{CODEX_SEED_CAP} — refusing to truncate; re-derive the slate "
                                 f"with forge.py batch instead")
    return out


def seed_digests(seeds):
    """sha256 per seed, recorded in the log row so a post-hoc audit can detect a mid-run change."""
    return {p: hashlib.sha256(open(p, "rb").read()).hexdigest() for p in seeds}


def reverify_seed_digests(name, expected):
    """Re-hash immediately before invoking. The TOCTOU window cannot be CLOSED against a path-based
    tool contract (the codex process opens the file at an unknown later moment) — this narrows it
    and the recorded digests make the residual auditable (§4.5, known gap)."""
    for path, digest in (expected or {}).items():
        actual = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if actual != digest:
            raise SeedIntegrityError(f"{name}: seed SHA-256 changed after preflight: {path}")
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 32 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): seed preparation -- absoluteness, transport ceiling, seed cap, digests"
```

---

## Task C6 — invocation: prompt file, envelope, subprocess, timeout, process-TREE kill

Spec §4.4. The composed prompt is written to a UTF-8 file and passed **by reference**, never inlined:
that is P2b's verified incantation and it defeats codex's own standing "normalize into a clear spec"
default, because the model never runs its prompt-authoring judgement over text it only references.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/_fake_codex.py` (stall mode spawns a heartbeat grandchild, so the TREE kill is
  actually testable)
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `CODEX_ARGV_PREFIX`, `TIMEOUT_S`, `resolve_codex_binary`; the banked envelope contract
  at `<ARC>/p4-envelope.txt` (Task A1).
- Produces: `ENVELOPE_TEMPLATE: str`, `build_envelope(prompt_path: str, seed_paths: list[str]) -> str`,
  `write_prompt_file(staging: str, name: str, text: str) -> str`,
  `kill_process_tree(proc) -> None`,
  `run_codex_exec(*, envelope, cwd, timeout_s=None, resume_thread=None) -> dict` with keys
  `events, thread_id, usage, returncode, timed_out, stderr_tail, wall_s`.

**Steps**

- [ ] Give the fake's `stall` mode a grandchild. In `<SCRIPTS>/_fake_codex.py`, replace the
  `if mode == "stall":` branch with:

```python
    if mode == "stall":
        # A grandchild whose heartbeat proves whether the runner killed the whole TREE (P2b's hung
        # run left 4 live codex.exe children, so a single-PID kill is insufficient).
        import subprocess as _sp
        hb = Path(args.image_root).parent / "heartbeat.txt"
        _sp.Popen([sys.executable, "-c",
                   "import sys,time\n"
                   "while True:\n"
                   "    open(sys.argv[1], 'a').write('x')\n"
                   "    time.sleep(0.2)\n", str(hb)])
        time.sleep(600)
        return 0
```

- [ ] Add the failing tests:

```python
ARC_ENVELOPE = (Path(__file__).resolve().parents[5] / "scratch-codex-image-engine"
                / "p4-envelope.txt")


def test_build_envelope_matches_the_banked_probe_contract():
    import forge_codex as fc
    got = fc.build_envelope("<PROMPT_PATH>", ["<SEED_1>"])
    assert ARC_ENVELOPE.is_file(), f"missing banked envelope: {ARC_ENVELOPE}"
    assert got == ARC_ENVELOPE.read_text(encoding="utf-8")
    two = fc.build_envelope("C:/p.txt", ["C:/a.png", "C:/b.png"])
    assert "referenced_image_paths = [C:/a.png, C:/b.png]" in two
    assert "exactly once" in two and "Do not read any file outside this directory" in two


def test_write_prompt_file_is_utf8_and_lands_in_the_codex_prompt_archive():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="prompts-"))
    p = fc.write_prompt_file(str(tmp), "L29", "Avoid: photorealism\u2014none\n")
    assert Path(p) == tmp / "_codex" / "prompts" / "L29.txt"
    assert Path(p).read_text(encoding="utf-8") == "Avoid: photorealism\u2014none\n"
    assert Path(p).read_bytes() == "Avoid: photorealism\u2014none\n".encode("utf-8")


def test_run_codex_exec_sends_the_real_flag_tail_and_parses_the_stream():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("ok", tmp / "generated_images", tmp / "sessions")
    try:
        env = fc.build_envelope(str(prompt), [str(seed)])
        r = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=120)
    finally:
        fc.CODEX_ARGV_PREFIX = saved
    assert r["returncode"] == 0 and r["timed_out"] is False
    assert r["thread_id"] and r["thread_id"].startswith("019ff")
    assert r["usage"]["input_tokens"] == 75742
    assert r["events"] and r["events"][0]["type"] == "thread.started"
    assert r["wall_s"] >= 0


def test_run_codex_exec_kills_the_whole_process_tree_on_timeout():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    hb = tmp / "heartbeat.txt"
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("stall", tmp / "generated_images", tmp / "sessions")
    try:
        env = fc.build_envelope(str(prompt), [str(seed)])
        r = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=2)
    finally:
        fc.CODEX_ARGV_PREFIX = saved
    assert r["timed_out"] is True
    assert hb.is_file(), "grandchild never started -- the tree-kill assertion would be vacuous"
    import time as _t
    size_a = hb.stat().st_size
    _t.sleep(1.5)
    assert hb.stat().st_size == size_a, "grandchild survived: the kill was single-PID, not a TREE"


def test_run_codex_exec_reports_stderr_tail_bounded_to_160_chars():
    import forge_codex as fc
    tmp, prompt, seed = _scratch()
    saved = fc.CODEX_ARGV_PREFIX
    fc.CODEX_ARGV_PREFIX = fake_prefix("nonzero_exit", tmp / "generated_images", tmp / "sessions")
    try:
        r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                              timeout_s=120)
    finally:
        fc.CODEX_ARGV_PREFIX = saved
    assert r["returncode"] == 1
    assert "stream error" in r["stderr_tail"] and len(r["stderr_tail"]) <= 160
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'build_envelope'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
import json      # noqa: E402
import signal    # noqa: E402
import subprocess  # noqa: E402
import time      # noqa: E402

# --- §4.4 INVOCATION. Only probe-verified flags appear here: `exec --json --sandbox <mode> --cd
# --- <dir>` are what both probe logs actually ran. `workspace-write` is ruled by measurement:
# --- `--sandbox read-only` HUNG past the 4-minute ceiling in P2b rather than failing fast.
SANDBOX_MODE = "workspace-write"

ENVELOPE_TEMPLATE = (
    "Read the file at {prompt_path} and pass its exact byte content as the `prompt` argument to "
    "`image_gen__imagegen`. Do not compose, paraphrase, normalize, or reformat this text -- read "
    "and pass through only. Call the tool exactly once, with referenced_image_paths = [{seeds}]. "
    "Do not read any file outside this directory. Report only the saved image path."
)


def build_envelope(prompt_path, seed_paths):
    return ENVELOPE_TEMPLATE.format(prompt_path=prompt_path,
                                    seeds=", ".join(str(s) for s in seed_paths))


def composed_prompt_dir(staging):
    return os.path.join(str(staging), "_codex", "prompts")


def write_prompt_file(staging, name, text):
    """The verbatim mechanism IS a file on disk, so the composer's unit of delivery is this file.
    Kept after the run: it is the audit trail the fidelity check diffs against (§4.4, §4.6)."""
    d = composed_prompt_dir(staging)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{name}.txt")
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return path


def kill_process_tree(proc):
    """Kill the child AND every descendant. P2b's hung run left 4 live codex.exe children, so a
    single-PID kill is insufficient."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()


def run_codex_exec(*, envelope, cwd, timeout_s=None, resume_thread=None):
    """One cold `codex exec` turn. stdin=DEVNULL (p1 probe A saw `Reading additional input from
    stdin...`). Returns the parsed stream plus transport facts; classification happens elsewhere."""
    exe = resolve_codex_binary()
    tail = ["exec"] + (["resume", str(resume_thread)] if resume_thread else []) + \
           ["--json", "--sandbox", SANDBOX_MODE, "--cd", str(cwd), envelope]
    argv = [exe] + list(CODEX_ARGV_PREFIX[1:]) + tail
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" \
        else {"start_new_session": True}
    t0 = time.time()
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, cwd=str(cwd), **kwargs)
    timed_out = False
    try:
        raw, err = proc.communicate(timeout=timeout_s or TIMEOUT_S)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_process_tree(proc)
        raw, err = proc.communicate()
    text = (raw or b"").decode("utf-8", errors="replace")
    stderr = (err or b"").decode("utf-8", errors="replace")
    events, thread_id, usage = [], None, {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        events.append(ev)
        if ev.get("type") == "thread.started":
            thread_id = ev.get("thread_id")
        elif ev.get("type") == "turn.completed":
            usage = ev.get("usage", {}) or {}
    return {"events": events, "thread_id": thread_id, "usage": usage,
            "returncode": proc.returncode, "timed_out": timed_out,
            "stderr_tail": stderr.strip()[-160:], "wall_s": round(time.time() - t0, 1)}
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 37 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/_fake_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): file-based verbatim invocation with 240s timeout and process-tree kill"
```

---

## Task C7 — harvest by snapshot diff

Spec §4.6 harvest + test case 10 (harvest half). There is no `tool_call`/`tool_result` event
(p1 hard limit 4), so `thread_id` plus a directory diff is the only structural handle. Newest-by-mtime
is explicitly rejected: 17 gens across both logs never produced a second image, so there is no
evidence about what a second one means.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `IMAGE_ROOT`.
- Produces: `snapshot_thread_dir(thread_id, image_root=None) -> set[str]`,
  `harvest_new_pngs(thread_id, before, *, image_root=None, polls=5, delay=1.0) -> list[str]`
  (absolute paths, possibly empty or >1 — **counting is harvest's job, ruling on the count is
  `classify_turn`'s job in Task C10**, so the §6 class ids live in exactly one place).

**Steps**

- [ ] Add the failing tests:

```python
def _fc_with_roots(mode, tmp):
    import forge_codex as fc
    fc.CODEX_ARGV_PREFIX = fake_prefix(mode, tmp / "generated_images", tmp / "sessions")
    fc.IMAGE_ROOT = str(tmp / "generated_images")
    fc.SESSIONS_ROOT = str(tmp / "sessions")
    return fc


def test_harvest_accepts_exactly_one_new_png_and_ignores_pre_existing_files():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    env = fc.build_envelope(str(prompt), [str(seed)])
    first = fc.run_codex_exec(envelope=env, cwd=str(tmp), timeout_s=120)
    tid = first["thread_id"]
    before = fc.snapshot_thread_dir(tid)
    assert len(before) == 1                       # turn 1's frame is already there
    second = fc.run_codex_exec(envelope=env + " ", cwd=str(tmp), timeout_s=120,
                               resume_thread=tid)
    got = fc.harvest_new_pngs(tid, before, polls=3, delay=0.1)
    assert len(got) == 1 and os.path.isfile(got[0]) and got[0].endswith(".png")
    assert os.path.basename(got[0]) not in before
    assert second["returncode"] == 0


def test_harvest_returns_an_empty_list_when_nothing_was_written():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_image", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    assert fc.harvest_new_pngs(r["thread_id"], set(), polls=2, delay=0.05) == []


def test_harvest_returns_both_paths_when_two_images_landed():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("two_images", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    got = fc.harvest_new_pngs(r["thread_id"], set(), polls=2, delay=0.05)
    assert len(got) == 2 and got == sorted(got)


def test_harvest_leaves_the_source_file_in_place():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    got = fc.harvest_new_pngs(r["thread_id"], set(), polls=2, delay=0.05)[0]
    assert os.path.isfile(got)
    assert os.path.commonpath([got, fc.IMAGE_ROOT]) == os.path.normpath(fc.IMAGE_ROOT)
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'snapshot_thread_dir'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
def snapshot_thread_dir(thread_id, image_root=None):
    """Empty for a fresh thread, non-empty for a resumed session — which is why harvest is a DIFF
    and never 'the only file in the directory'."""
    d = os.path.join(image_root or IMAGE_ROOT, str(thread_id or ""))
    return set(os.listdir(d)) if thread_id and os.path.isdir(d) else set()


def harvest_new_pngs(thread_id, before, *, image_root=None, polls=5, delay=1.0):
    """Every *.png that appeared in this thread's directory since `before`, as absolute paths.
    Bounded poll covers write/close lag after turn.completed. Counting happens here; RULING on the
    count (exactly one => success, zero => no_image, more than one => multi_emit, take none) is
    `classify_turn`'s job, so the §6 class ids live in exactly one place.
    Newest-by-mtime is explicitly rejected: 17 gens across both probe logs never produced a second
    image, so there is no evidence about what a second one MEANS."""
    root = image_root or IMAGE_ROOT
    d = os.path.join(root, str(thread_id or ""))
    new = []
    for attempt in range(max(1, polls)):
        now = snapshot_thread_dir(thread_id, image_root=root)
        new = sorted(n for n in (now - set(before)) if n.lower().endswith(".png"))
        if new:
            break
        if attempt + 1 < polls:
            time.sleep(delay)
    return [os.path.join(d, n) for n in new]
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 41 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): snapshot-diff harvest, exactly-one-PNG or fail loud"
```

---

## Task C8 — the rollout-log fidelity audit

Spec §4.6 fidelity audit + test case 11. This is a **production** verification channel: the runner
opens only the rollout file matching its own `thread_id`, extracts two fields, copies nothing.
A mismatch publishes the frame but marks it — the reviewer, not the runner, rules on frames; what a
mismatch breaks is our claim to have authored the prompt.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `SESSIONS_ROOT`.
- Produces: `rollout_path(thread_id, sessions_root=None) -> str | None`,
  `extract_captured_prompt(body: str) -> str | None`,
  `audit_fidelity(thread_id, prompt_path, sessions_root=None) -> tuple[str, str | None]`
  returning one of `("verified"|"mismatch"|"unverifiable", captured_sha256_or_None)`,
  `count_pre_call_tool_calls(thread_id, sessions_root=None) -> int | None`.

**Steps**

- [ ] Add the failing tests (the variable-shorthand case uses the literal JS P2b banked in
  `<ARC>/probeA-gen1-actual-jscall.txt`):

```python
REAL_VARIABLE_JS = (
    'const reader = await tools.mcp__node_repl__js({code: "var p = await fsA.readFile(\'x.txt\');"});'
    '\nconst prompt = reader.content.find(x => x.type === "text").text;\n'
    'const result = await tools.image_gen__imagegen({prompt, referenced_image_paths: ["C:\\\\a.png"]});'
)


def test_fidelity_verified_on_a_literal_pass_through():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    verdict, sha = fc.audit_fidelity(r["thread_id"], str(prompt))
    assert verdict == "verified" and sha and len(sha) == 64


def test_fidelity_mismatch_is_detected_and_carries_the_captured_sha():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("paraphrase", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    verdict, sha = fc.audit_fidelity(r["thread_id"], str(prompt))
    assert verdict == "mismatch" and sha and len(sha) == 64


def test_fidelity_unverifiable_without_a_rollout_log_is_not_a_failure():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_rollout", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    verdict, sha = fc.audit_fidelity(r["thread_id"], str(prompt))
    assert verdict == "unverifiable" and sha is None


def test_fidelity_unverifiable_when_the_model_used_the_read_into_variable_mechanism():
    import forge_codex as fc
    assert fc.extract_captured_prompt(json.dumps(
        {"payload": {"type": "custom_tool_call", "input": REAL_VARIABLE_JS}})) is None


def test_audit_reads_only_the_rollout_file_matching_its_own_thread_id():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r1 = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                           timeout_s=120)
    other = tmp / "L44.txt"
    other.write_text("a completely different composed prompt\n", encoding="utf-8")
    r2 = fc.run_codex_exec(envelope=fc.build_envelope(str(other), [str(seed)]), cwd=str(tmp),
                           timeout_s=120)
    assert r1["thread_id"] != r2["thread_id"]
    assert fc.audit_fidelity(r1["thread_id"], str(prompt))[0] == "verified"
    assert fc.audit_fidelity(r2["thread_id"], str(other))[0] == "verified"
    assert fc.audit_fidelity(r1["thread_id"], str(other))[0] == "mismatch"


def test_pre_call_tool_calls_counts_the_ambient_detour():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    r = fc.run_codex_exec(envelope=fc.build_envelope(str(prompt), [str(seed)]), cwd=str(tmp),
                          timeout_s=120)
    assert fc.count_pre_call_tool_calls(r["thread_id"]) == 3
    assert fc.count_pre_call_tool_calls("019ff000-0000-7000-0000-000000000000") is None
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'audit_fidelity'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
import glob  # noqa: E402

# --- §4.6 FIDELITY AUDIT. `image_gen__imagegen` is invoked from a model-authored sandboxed JS
# --- snippet, not a native structured call, so the session rollout log is the only ground truth
# --- for what the tool actually saw. Shape-tolerant on purpose: P2b observed the prompt both as a
# --- JS string literal in `custom_tool_call.input` AND echoed in `custom_tool_call_output`.
_JS_PROMPT = re.compile(r'(?:"prompt"|\bprompt)\s*:\s*("(?:[^"\\]|\\.)*")')


def rollout_path(thread_id, sessions_root=None):
    root = sessions_root or SESSIONS_ROOT
    if not thread_id or not os.path.isdir(root):
        return None
    hits = sorted(glob.glob(os.path.join(root, "*", "*", "*", f"rollout-*-{thread_id}.jsonl")))
    return hits[-1] if hits else None


def extract_captured_prompt(body):
    """The prompt string the tool actually received, or None when it is not recoverable (the
    read-into-variable mechanism leaves no literal — which is the SAFER mechanism, not a failure)."""
    for line in (body or "").splitlines():
        if "image_gen__imagegen" not in line and '"prompt"' not in line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            row = line
        for leaf in _string_leaves(row):
            m = _JS_PROMPT.search(leaf)
            if m:
                try:
                    return json.loads(m.group(1))
                except json.JSONDecodeError:
                    continue
    return None


def _string_leaves(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _string_leaves(v)
    elif isinstance(node, (list, tuple)):
        for v in node:
            yield from _string_leaves(v)


def audit_fidelity(thread_id, prompt_path, sessions_root=None):
    """('verified'|'mismatch'|'unverifiable', sha256 of the captured prompt or None).
    Read-only, one file, two fields, nothing copied anywhere."""
    path = rollout_path(thread_id, sessions_root)
    if not path:
        return "unverifiable", None
    captured = extract_captured_prompt(
        open(path, encoding="utf-8", errors="replace").read())
    if captured is None:
        return "unverifiable", None
    composed = open(prompt_path, encoding="utf-8").read()
    sha = hashlib.sha256(captured.encode("utf-8")).hexdigest()
    return ("verified" if captured == composed else "mismatch"), sha


def count_pre_call_tool_calls(thread_id, sessions_root=None):
    """The ambient-detour meter (§5.1): custom_tool_call items before the image call. None when no
    rollout log exists for this thread."""
    path = rollout_path(thread_id, sessions_root)
    if not path:
        return None
    n = 0
    for line in open(path, encoding="utf-8", errors="replace"):
        if "custom_tool_call" not in line:
            continue
        if "image_gen__imagegen" in line:
            return n
        n += 1
    return n
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 47 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): rollout-log fidelity audit + ambient-detour meter"
```

---

## Task C9 — normalization to canvas

Spec §4.6 normalization + test case 13. Centre-crop then Lanczos, never anisotropic stretch: a 2%
stretch is invisible on a plate and obvious on a face. `validate_png` runs on the harvested bytes
before normalization and again on the normalized bytes before publication.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `validate_png`, `to_png_bytes`, `RatioError`.
- Produces: `RATIO_TOLERANCE: float`,
  `normalize_to_canvas(data: bytes, canvas: tuple[int, int]) -> tuple[bytes, tuple[int, int], float]`
  returning `(png_bytes_at_canvas, native_size, ratio_error)`.

**Steps**

- [ ] Add the failing tests:

```python
def _png_bytes(size, colour=(36, 26, 18)):
    import io
    from PIL import Image
    im = Image.new("RGB", size, (240, 240, 235))
    im.paste(Image.new("RGB", (size[0], max(1, size[1] // 8)), colour), (0, 0))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_normalization_crops_then_resizes_to_the_exact_canvas():
    import io
    import forge_codex as fc
    from PIL import Image
    data = _png_bytes((1659, 948))
    out, native, err = fc.normalize_to_canvas(data, (1376, 768))
    assert native == (1659, 948)
    assert 0 < err <= fc.RATIO_TOLERANCE
    assert Image.open(io.BytesIO(out)).size == (1376, 768)
    import forge
    forge.validate_png(out)


def test_normalization_is_a_pure_resize_when_the_ratio_already_matches():
    import io
    import forge_codex as fc
    from PIL import Image
    out, native, err = fc.normalize_to_canvas(_png_bytes((1672, 941)), (1376, 768))
    assert native == (1672, 941)
    assert err <= fc.RATIO_TOLERANCE
    assert Image.open(io.BytesIO(out)).size == (1376, 768)


def test_normalization_crops_the_excess_axis_not_both():
    import io
    import forge_codex as fc
    from PIL import Image
    # 1659x948 is WIDER-than-target?  target 16:9 = 1.7917, native = 1.7500 -> too TALL, crop height
    cropped = fc.crop_to_ratio(Image.open(io.BytesIO(_png_bytes((1659, 948)))), 1376 / 768)
    assert cropped.size[0] == 1659
    assert abs(cropped.size[0] / cropped.size[1] - 1376 / 768) < 1e-3


def test_normalization_raises_ratio_error_beyond_tolerance():
    import forge_codex as fc
    raised = None
    try:
        fc.normalize_to_canvas(_png_bytes((1200, 900)), (1376, 768))
    except fc.RatioError as e:
        raised = str(e)
    assert raised is not None and "1200" in raised and "900" in raised


def test_normalization_rejects_invalid_bytes_before_touching_pillow():
    import forge_codex as fc
    raised = None
    try:
        fc.normalize_to_canvas(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200, (1376, 768))
    except RuntimeError as e:
        raised = str(e)
    assert raised is not None and "too small" in raised
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'normalize_to_canvas'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
# --- §4.6 NORMALIZATION. Ratio is prose-steerable to ~0.1-2% but pixel dims are NEVER honored and
# --- the same ask returns a different resolution each run (p1 probe D). Downstream assumes a stated
# --- canvas, so every frame is brought to it exactly. Register consequence, stated not hidden: a
# --- codex frame is never RENDERED at the 1K era instrument; the downscale is a post-hoc proxy.
RATIO_TOLERANCE = 0.05


def crop_to_ratio(im, target_ratio):
    """Centre-crop the excess axis so the result is exactly `target_ratio`. Never stretches."""
    w, h = im.size
    if w / h > target_ratio:                       # too wide -> trim width
        new_w = int(round(h * target_ratio))
        left = (w - new_w) // 2
        return im.crop((left, 0, left + new_w, h))
    new_h = int(round(w / target_ratio))           # too tall -> trim height
    top = (h - new_h) // 2
    return im.crop((0, top, w, top + new_h))


def normalize_to_canvas(data, canvas):
    """(bytes at exactly `canvas`, native (W,H), ratio error). Validates before AND after, so
    nothing unvalidated ever reaches _publish_staging_png."""
    import io
    from PIL import Image
    data = to_png_bytes(data)
    validate_png(data)
    im = Image.open(io.BytesIO(data)).convert("RGB")
    native = im.size
    target_ratio = canvas[0] / canvas[1]
    r_err = abs((native[0] / native[1]) / target_ratio - 1.0)
    if r_err > RATIO_TOLERANCE:
        raise RatioError(f"native {native[0]}x{native[1]} is {r_err:.1%} off the "
                         f"{canvas[0]}x{canvas[1]} target ratio (tolerance "
                         f"{RATIO_TOLERANCE:.0%}) — the model mis-framed; re-author the framing "
                         f"line through the surgical-retry overlay")
    if r_err > 0:
        im = crop_to_ratio(im, target_ratio)
    im = im.resize(canvas, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    out = buf.getvalue()
    validate_png(out)
    return out, native, round(r_err, 4)
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 52 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): crop-then-Lanczos normalization to canvas with RatioError"
```

---

## Task C10 — failure classification, the transport re-issue, and the `generate()` seam

Spec §6 + §3.3 + test case 12. The transport re-issue re-sends the **identical** composed prompt file
because no image was produced at all: it never counts against the frame's one surgical retry, never
fires when an image *was* produced, is capped at one per frame ever, and always starts a fresh
thread.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `run_codex_exec` (C6), `snapshot_thread_dir` / `harvest_new_pngs` (C7),
  `audit_fidelity` / `count_pre_call_tool_calls` (C8), `normalize_to_canvas` (C9).
- Produces: `REISSUABLE: tuple[str, ...]`, `agent_texts(events) -> list[str]`,
  `classify_turn(result: dict, new_pngs: list[str]) -> str | None`,
  `generate(*, prompt_path, seeds, canvas, name, session=None, poll_delay=1.0) -> tuple[bytes, dict]`
  where metadata carries
  `thread_id, turn_index, session_mode, wall_s, usage, native, canvas, ratio_error, reissues,
  source_png, source_sha256, fidelity_audit, fidelity_sha256, pre_call_tool_calls, failure_class`.
- The `session=` parameter is typed against the `Session` class built in Task C14
  (`.thread_id`, `.turns`, `.snapshot`, `.record(thread_id)`, `.reset()`). **Every call site and
  every test in this task passes `session=None`**; do not stub a `Session` class here, the
  `if session` guards are sufficient. `CodexRunError` gains `.reissues` (int) in this task.

**Steps**

- [ ] Add the failing tests:

```python
def test_classify_turn_maps_every_documented_class():
    import forge_codex as fc
    ok = {"timed_out": False, "returncode": 0, "thread_id": "t", "events": []}
    assert fc.classify_turn(ok, ["a.png"]) is None
    assert fc.classify_turn(ok, []) == "no_image"
    assert fc.classify_turn(ok, ["a.png", "b.png"]) == "multi_emit"
    assert fc.classify_turn(dict(ok, timed_out=True), []) == "stall"
    assert fc.classify_turn(dict(ok, returncode=1), []) == "exec_failed"
    assert fc.classify_turn(dict(ok, thread_id=None), []) == "exec_failed"
    refuse = dict(ok, events=[{"type": "item.completed",
                               "item": {"type": "agent_message",
                                        "text": "I can't help with that."}}])
    assert fc.classify_turn(refuse, []) == "refusal"
    quota = dict(ok, events=[{"type": "item.completed",
                              "item": {"type": "agent_message",
                                       "text": "You've hit your usage limit."}}])
    assert fc.classify_turn(quota, []) == "quota"


def test_generate_happy_path_returns_canvas_bytes_and_full_metadata():
    import io
    from PIL import Image
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("ok", tmp)
    data, meta = fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768),
                             name="L29")
    assert Image.open(io.BytesIO(data)).size == (1376, 768)
    assert meta["native"] == [1672, 941]
    assert meta["canvas"] == [1376, 768]
    assert meta["reissues"] == 0 and meta["failure_class"] is None
    assert meta["fidelity_audit"] == "verified"
    assert meta["pre_call_tool_calls"] == 3
    assert meta["source_png"].endswith(".png") and len(meta["source_sha256"]) == 64
    assert meta["usage"]["input_tokens"] == 75742
    assert meta["turn_index"] == 1 and meta["session_mode"] == "isolated"


def test_generate_reissues_once_on_no_image_then_gives_up():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("no_image", tmp)
    raised = None
    try:
        fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29",
                    poll_delay=0.05)
    except fc.CodexRunError as e:
        raised = e
    assert raised is not None and raised.failure_class == "no_image"
    assert raised.reissues == 1, "exactly ONE transport re-issue, ever"


def test_generate_does_not_reissue_refusal_quota_or_multi_emit():
    tmp, prompt, seed = _scratch()
    for mode, cls in (("refuse", "refusal"), ("quota", "quota"), ("two_images", "multi_emit")):
        fc = _fc_with_roots(mode, tmp)
        raised = None
        try:
            fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768),
                        name="L29", poll_delay=0.05)
        except fc.CodexRunError as e:
            raised = e
        assert raised is not None and raised.failure_class == cls, mode
        assert raised.reissues == 0, mode


def test_generate_publishes_a_mismatch_frame_but_marks_it():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("paraphrase", tmp)
    data, meta = fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768),
                             name="L29")
    assert data and meta["fidelity_audit"] == "mismatch"
    assert meta["failure_class"] is None, "a mismatch is marked, never discarded"


def test_generate_raises_ratio_without_a_transport_reissue():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("wrong_ratio", tmp)
    raised = None
    try:
        fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29")
    except fc.CodexRunError as e:
        raised = e
    assert raised is not None and raised.failure_class == "ratio" and raised.reissues == 0


def test_generate_raises_on_invalid_bytes_with_no_reissue():
    tmp, prompt, seed = _scratch()
    fc = _fc_with_roots("tiny_png", tmp)
    raised = None
    try:
        fc.generate(prompt_path=str(prompt), seeds=[str(seed)], canvas=(1376, 768), name="L29")
    except fc.CodexRunError as e:
        raised = e
    assert raised is not None and raised.failure_class == "invalid_bytes" and raised.reissues == 0
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'classify_turn'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`. Note the one-line change to `CodexRunError` so every raise
  carries its re-issue count:

```python
# --- §6 FAILURE LAW. The doctrine is unchanged (SKILL.md L384-393: exactly ONE surgical retry per
# --- frame, ruled by the next fresh-eyes pass). This adds ONE strictly separate notion: a TRANSPORT
# --- re-issue of the IDENTICAL prompt file, because no image was produced at all.
REISSUABLE = ("no_image", "stall", "exec_failed")
_QUOTA_MARKERS = ("usage limit", "rate limit", "quota", "try again later")
_REFUSAL_MARKERS = ("can't help", "cannot help", "can't create", "cannot create", "i'm unable",
                    "i am unable", "won't be able")


def agent_texts(events):
    return [e.get("item", {}).get("text", "") for e in (events or [])
            if e.get("item", {}).get("type") == "agent_message"]


def classify_turn(result, new_pngs):
    """None means the turn produced exactly one image. Otherwise the §6 class id."""
    if result.get("timed_out"):
        return "stall"
    if result.get("returncode") != 0 or not result.get("thread_id"):
        return "exec_failed"
    if len(new_pngs) > 1:
        return "multi_emit"
    if not new_pngs:
        text = " ".join(agent_texts(result.get("events"))).lower()
        if any(m in text for m in _QUOTA_MARKERS):
            return "quota"
        if any(m in text for m in _REFUSAL_MARKERS):
            return "refusal"
        return "no_image"
    return None


def _fail(cls, message, reissues):
    err = CodexRunError(cls, message)
    err.reissues = reissues
    return err


def generate(*, prompt_path, seeds, canvas, name, session=None, poll_delay=1.0):
    """Invoke codex on an already-composed prompt FILE; return (validated PNG bytes, metadata).

    Returns BYTES so publication flows through forge's `_publish_staging_png` unchanged — one
    writer of staging (§3.2). `canvas` is explicit (W, H); aspect resolution happened in the
    composer."""
    envelope = build_envelope(prompt_path, seeds)
    reissues, last = 0, None
    while True:
        resume = session.thread_id if (session and session.thread_id and reissues == 0) else None
        cwd = tempfile.mkdtemp(prefix="forge-codex-")
        try:
            result = run_codex_exec(envelope=envelope, cwd=cwd, timeout_s=TIMEOUT_S,
                                    resume_thread=resume)
        finally:
            shutil.rmtree(cwd, ignore_errors=True)
        tid = result["thread_id"] or resume
        before = session.snapshot if (session and resume) else set()
        new = harvest_new_pngs(tid, before, polls=5, delay=poll_delay) if tid else []
        cls = classify_turn(result, new)
        if cls is None:
            break
        last = (cls, result)
        if cls in REISSUABLE and reissues == 0:
            reissues = 1
            if session:
                session.reset()          # a re-issue always starts a FRESH thread (§6 guard rail)
            continue
        detail = (", ".join(new) if cls == "multi_emit"
                  else (result.get("stderr_tail")
                        or " / ".join(agent_texts(result["events"]))[:160]))
        raise _fail(cls, f"{name}: {cls} — {detail}", reissues)
    src = new[0]
    raw = open(src, "rb").read()
    try:
        data, native, r_err = normalize_to_canvas(raw, canvas)
    except RatioError as e:
        raise _fail("ratio", f"{name}: {e}", reissues)
    except RuntimeError as e:
        raise _fail("invalid_bytes", f"{name}: {e}", reissues)
    verdict, fsha = audit_fidelity(tid, prompt_path)
    if verdict == "mismatch":
        sys.stderr.write(f"  !! {name}: FIDELITY MISMATCH — the tool did not receive the composed "
                         f"prompt; frame published and marked for the fresh-eyes pass\n")
    meta = {"thread_id": tid,
            "turn_index": (session.turns + 1) if session else 1,
            "session_mode": "session" if session else "isolated",
            "wall_s": result["wall_s"], "usage": result["usage"],
            "native": [native[0], native[1]], "canvas": [canvas[0], canvas[1]],
            "ratio_error": r_err, "reissues": reissues,
            "source_png": src.replace("\\", "/"),
            "source_sha256": hashlib.sha256(raw).hexdigest(),
            "fidelity_audit": verdict, "fidelity_sha256": fsha,
            "pre_call_tool_calls": count_pre_call_tool_calls(tid),
            "failure_class": None}
    if session:
        session.record(tid)
    return data, meta
```

  Also add `import shutil`/`import tempfile` to the module header if not already present, and add
  `self.reissues = 0` to `CodexRunError.__init__`:

```python
class CodexRunError(RuntimeError):
    """A per-item transport/provider failure. `.failure_class` names the §6 class."""

    def __init__(self, failure_class, message):
        super().__init__(message)
        self.failure_class = failure_class
        self.reissues = 0
```

  Remove the now-unused `last` local if your linter complains; `generate()` raises inside the loop,
  never after it.

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 58 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): failure classification, one-per-frame transport re-issue, generate() seam"
```

---

## Task C11 — engine log + composed-prompt archive + run totals

Spec §5.3 + test case 18. One JSONL row per generated frame; the composed prompt archive is the
audit trail. The cost ledger is explicitly **out of code** — a generation script must not perform a
coordination write (ops branch, CLAUDE.md branch rules); the orchestrator writes the $0 ledger row.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `generate()` metadata (C10), `composed_prompt_dir` (C6), `residual_idiom` (C2).
- Produces: `LOG_KEYS: tuple[str, ...]`, `engine_log_path(staging) -> str`,
  `build_log_row(*, name, meta, composed_path, composed_text, seed_shas, residual, kit_root) -> dict`,
  `append_log_row(path: str, row: dict) -> None`,
  `run_totals_text(rows: list[dict]) -> str`.

**Steps**

- [ ] Add the failing tests:

```python
def _meta_stub():
    return {"thread_id": "019ffabc-1111-7222-3333-444455556666", "turn_index": 1,
            "session_mode": "isolated", "wall_s": 107.4,
            "usage": {"input_tokens": 75742, "cached_input_tokens": 48384,
                      "output_tokens": 1593, "reasoning_output_tokens": 742},
            "native": [1672, 941], "canvas": [1376, 768], "ratio_error": 0.0039, "reissues": 0,
            "source_png": "C:/Users/x/.codex/generated_images/019ffabc/exec-5a2c2c62.png",
            "source_sha256": "a" * 64, "fidelity_audit": "verified", "fidelity_sha256": "b" * 64,
            "pre_call_tool_calls": 3, "failure_class": None}


def test_engine_log_row_carries_every_documented_key():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="log-"))
    composed = fc.write_prompt_file(str(tmp), "L29", L29_GOLDEN)
    row = fc.build_log_row(name="L29", meta=_meta_stub(), composed_path=composed,
                           composed_text=L29_GOLDEN, seed_shas={"C:/k/a.png": "c" * 64},
                           residual=[], kit_root=str(tmp))
    for key in fc.LOG_KEYS:
        assert key in row, key
    assert set(row) == set(fc.LOG_KEYS)
    assert row["engine"] == "codex-imagegen" and row["name"] == "L29"
    assert row["tokens_in"] == 75742 and row["tokens_cached"] == 48384
    assert row["tokens_out"] == 1593 and row["reasoning_out"] == 742
    assert row["composed_chars"] == len(L29_GOLDEN)
    assert row["composed_prompt_sha256"] == \
        __import__("hashlib").sha256(L29_GOLDEN.encode("utf-8")).hexdigest()
    assert row["composed_prompt"].endswith("_codex/prompts/L29.txt")
    assert row["seed_sha256"] == {"C:/k/a.png": "c" * 64}
    assert row["residual_idiom"] == [] and row["failure_class"] is None
    assert row["ts"].endswith("Z")


def test_engine_log_is_append_only_jsonl():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="log-"))
    path = fc.engine_log_path(str(tmp))
    fc.append_log_row(path, {"name": "L26"})
    fc.append_log_row(path, {"name": "L29"})
    rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    assert [r["name"] for r in rows] == ["L26", "L29"]
    assert Path(path) == tmp / "_codex" / "engine-log.jsonl"


def test_run_totals_names_every_non_verified_row():
    import forge_codex as fc
    rows = [dict(_meta_stub(), name="L26", tokens_in=1, tokens_cached=0, tokens_out=0,
                 reasoning_out=0, fidelity_audit="verified", pre_call_tool_calls=2),
            dict(_meta_stub(), name="L29", tokens_in=3, tokens_cached=0, tokens_out=0,
                 reasoning_out=0, fidelity_audit="mismatch", pre_call_tool_calls=4)]
    text = fc.run_totals_text(rows)
    assert "2 frame" in text
    assert "L29" in text and "mismatch" in text
    assert "L26" not in text
    assert "mean pre_call_tool_calls 3.0" in text
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'build_log_row'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
import datetime  # noqa: E402

# --- §5.3 OBSERVABILITY. `turn.completed.usage` is the authoritative token source (p1 probe A);
# --- the human-readable "tokens used" text is never scraped. The COST LEDGER row is written by the
# --- ORCHESTRATOR, not here: a generation script must not perform a coordination write.
LOG_KEYS = ("ts", "engine", "name", "thread_id", "turn_index", "session_mode", "wall_s",
            "tokens_in", "tokens_cached", "tokens_out", "reasoning_out", "pre_call_tool_calls",
            "native", "canvas", "ratio_error", "reissues", "source_png", "source_sha256",
            "composed_prompt", "composed_prompt_sha256", "composed_chars", "fidelity_audit",
            "seed_sha256", "residual_idiom", "failure_class")


def engine_log_path(staging):
    return os.path.join(str(staging), "_codex", "engine-log.jsonl")


def _rel_to_kit(path, kit_root):
    p = os.path.abspath(path).replace("\\", "/")
    root = os.path.abspath(kit_root).replace("\\", "/")
    return p[len(root) + 1:] if p.startswith(root + "/") else p


def build_log_row(*, name, meta, composed_path, composed_text, seed_shas, residual, kit_root):
    usage = meta.get("usage") or {}
    return {
        "ts": datetime.datetime.now(datetime.timezone.utc)
                      .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine": ENGINE_ID, "name": name,
        "thread_id": meta.get("thread_id"), "turn_index": meta.get("turn_index"),
        "session_mode": meta.get("session_mode"), "wall_s": meta.get("wall_s"),
        "tokens_in": usage.get("input_tokens"), "tokens_cached": usage.get("cached_input_tokens"),
        "tokens_out": usage.get("output_tokens"),
        "reasoning_out": usage.get("reasoning_output_tokens"),
        "pre_call_tool_calls": meta.get("pre_call_tool_calls"),
        "native": meta.get("native"), "canvas": meta.get("canvas"),
        "ratio_error": meta.get("ratio_error"), "reissues": meta.get("reissues"),
        "source_png": meta.get("source_png"), "source_sha256": meta.get("source_sha256"),
        "composed_prompt": _rel_to_kit(composed_path, kit_root),
        "composed_prompt_sha256": hashlib.sha256(composed_text.encode("utf-8")).hexdigest(),
        "composed_chars": len(composed_text),
        "fidelity_audit": meta.get("fidelity_audit"),
        "seed_sha256": dict(seed_shas or {}),
        "residual_idiom": list(residual or []),
        "failure_class": meta.get("failure_class"),
    }


def append_log_row(path, row):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def run_totals_text(rows):
    n = len(rows)
    def total(key):
        return sum(r.get(key) or 0 for r in rows)
    detours = [r.get("pre_call_tool_calls") for r in rows if r.get("pre_call_tool_calls") is not None]
    mean_detour = round(sum(detours) / len(detours), 1) if detours else 0.0
    flagged = [f"{r.get('name')}={r.get('fidelity_audit')}" for r in rows
               if r.get("fidelity_audit") not in (None, "verified")]
    lines = [f"  == {n} frame(s) | tokens in {total('tokens_in')} "
             f"(cached {total('tokens_cached')}) out {total('tokens_out')} "
             f"reasoning {total('reasoning_out')} | wall {round(total('wall_s'), 1)}s "
             f"| mean pre_call_tool_calls {mean_detour} =="]
    if flagged:
        lines.append("  == fidelity NOT verified: " + ", ".join(flagged) + " ==")
    return "\n".join(lines)
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 61 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): engine log, composed-prompt archive, run totals"
```

---

## Task C12 — `run_item`: staging discipline through forge's own primitives

Spec §4 request path + §3.2 + test case 14. `_reserve_staging_output` / `_publish_staging_png` /
`_release_staging_lock` are the ONLY correct way to write into staging: the exclusive PID-owned
sidecar lock, the atomic non-clobbering `os.link` and the escape check are what make two runners safe
against each other. Reimplementing them here would be a second, divergent writer of the same
directory.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: everything from C2-C11 plus forge's `_reserve_staging_output`, `_publish_staging_png`,
  `_release_staging_lock`, `_staging_png`, `validate_png`.
- Produces: `class RunOptions` (fields `force: bool = False`, `dry_run: bool = False`,
  `image_size: str | None = None`, `session_mode: str = "isolated"`, `session_span: int = 8`,
  `keep_composed: bool = True`), and
  `run_item(k, item, seeds, opts, session=None) -> tuple[str, dict]` returning
  `(status, row)` where status is `"OK"`, `"SKIP <reason>"`, `"DRY"` or `"ERR <class>"`.

**Steps**

- [ ] Add the failing tests:

```python
def _kit_for_run(mode):
    """A dry Kit whose staging is an ARC-style directory outside the kit (kit read-only)."""
    import forge
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="runitem-"))
    kit, root = make_kit(tmp)
    k = forge.Kit(kit, dry=True)
    staging = tmp / "arc-staging"
    staging.mkdir()
    k.staging = str(staging)
    (tmp / "generated_images").mkdir()
    (tmp / "sessions").mkdir()
    fc.CODEX_ARGV_PREFIX = fake_prefix(mode, tmp / "generated_images", tmp / "sessions")
    fc.IMAGE_ROOT = str(tmp / "generated_images")
    fc.SESSIONS_ROOT = str(tmp / "sessions")
    seed = _png(tmp / "seed.png")
    return fc, k, tmp, staging, seed


def test_run_item_publishes_through_forge_primitives_and_logs_one_row():
    import io
    from PIL import Image
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    item = _item_L29()
    status, row = fc.run_item(k, item, [seed], fc.RunOptions())
    assert status == "OK", status
    out = forge._staging_png(k, "L29")
    assert os.path.isfile(out)
    assert Image.open(io.BytesIO(open(out, "rb").read())).size == (1376, 768)
    assert not os.path.exists(out + ".lock")
    assert (staging / "_codex" / "prompts" / "L29.txt").is_file()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1 and rows[0]["name"] == "L29" and rows[0]["fidelity_audit"] == "verified"
    assert row["seed_sha256"] and list(row["seed_sha256"].values())[0]


def test_run_item_skips_an_existing_survivor_without_a_subprocess():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    (staging / "L29.png").write_bytes(_png_bytes((1376, 768)))
    fc.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status.startswith("SKIP")
    assert row is None
    assert forge._existing_staging_png(forge._staging_png(k, "L29")) is True


def test_run_item_force_overwrites_the_survivor():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    (staging / "L29.png").write_bytes(_png_bytes((900, 900)))
    status, _row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions(force=True))
    assert status == "OK"
    import io
    from PIL import Image
    assert Image.open(io.BytesIO((staging / "L29.png").read_bytes())).size == (1376, 768)


def test_run_item_respects_a_concurrent_lock():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    lock = forge._staging_png(k, "L29") + ".lock"
    Path(lock).write_text(json.dumps({"pid": os.getpid(), "token": "x",
                                      "created_at": __import__("time").time()}), encoding="utf-8")
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert "concurrent" in status and row is None
    assert not (staging / "L29.png").exists()


def test_a_failed_gen_leaves_no_file_and_no_stale_lock():
    import forge
    fc, k, tmp, staging, seed = _kit_for_run("no_image")
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions())
    assert status.startswith("ERR no_image"), status
    assert not (staging / "L29.png").exists()
    assert not os.path.exists(forge._staging_png(k, "L29") + ".lock")
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[-1]["failure_class"] == "no_image" and rows[-1]["reissues"] == 1


def test_dry_run_prints_the_prompt_and_spawns_no_subprocess():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    fc.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    status, row = fc.run_item(k, _item_L29(), [seed], fc.RunOptions(dry_run=True))
    assert status == "DRY" and row is None
    assert (staging / "_codex" / "prompts" / "L29.txt").is_file()
    assert not (staging / "L29.png").exists()
    assert not any(Path(tmp / "generated_images").rglob("*.png"))
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'RunOptions'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
from dataclasses import dataclass, field  # noqa: E402


@dataclass
class RunOptions:
    force: bool = False
    dry_run: bool = False
    image_size: str = None          # None => the item's own image_size, else "1K"
    session_mode: str = "isolated"
    session_span: int = 8
    keep_composed: bool = True


def run_item(k, item, seeds, opts, session=None):
    """One frame, end to end: compose -> write prompt file -> reserve -> re-verify digests ->
    invoke -> harvest -> audit -> validate -> normalize -> publish -> log row.
    Returns (status, row); `row` is None for SKIP and DRY."""
    name = item["name"]
    aspect = item.get("aspect") or "16:9"
    size = opts.image_size or item.get("image_size") or "1K"
    canvas = resolve_canvas(aspect, size)
    composed = compose_prompt(item, reg=k.reg, canvas=canvas, aspect=aspect)
    residual = residual_idiom(item.get("payload") or "")
    prepared = prepare_seeds(item, seeds or [])
    composed_path = write_prompt_file(k.staging, name, composed)

    if opts.dry_run:
        print(f"--- {name} ({aspect}, {size} -> {canvas[0]}x{canvas[1]}, "
              f"{len(prepared)} seed(s), {len(composed)} chars) ---", flush=True)
        print(composed, flush=True)
        if residual:
            print(f"  WARN {name}: residual staging idiom {residual}", flush=True)
        return "DRY", None

    out, lock, token, skip = _reserve_staging_output(k, name, opts.force)
    if skip:
        return f"SKIP {skip}", None
    shas = seed_digests(prepared)
    row = None
    try:
        reverify_seed_digests(name, shas)
        data, meta = generate(prompt_path=composed_path, seeds=prepared, canvas=canvas,
                              name=name, session=session)
        validate_png(data)
        _publish_staging_png(k, name, out, data, opts.force)
        row = build_log_row(name=name, meta=meta, composed_path=composed_path,
                            composed_text=composed, seed_shas=shas, residual=residual,
                            kit_root=k.kit)
        status = "OK"
    except CodexRunError as e:
        meta = {"session_mode": "session" if session else "isolated",
                "reissues": getattr(e, "reissues", 0), "failure_class": e.failure_class}
        row = build_log_row(name=name, meta=meta, composed_path=composed_path,
                            composed_text=composed, seed_shas=shas, residual=residual,
                            kit_root=k.kit)
        status = f"ERR {e.failure_class}: {e}"
    finally:
        if lock:
            _release_staging_lock(lock, token)
        if not opts.keep_composed and os.path.exists(composed_path):
            os.unlink(composed_path)
    append_log_row(engine_log_path(k.staging), row)
    if residual:
        sys.stderr.write(f"  WARN {name}: residual staging idiom {residual}\n")
    return status, row
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 67 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): run_item -- staging reserve/publish through forge primitives"
```

---

## Task C13 — the CLI

Spec §2.4 + test cases 15, 16, 17. Deliberately **not** offered: `--engine`, a per-item engine field,
and any flag that would make forge.py behave differently.

**Added beyond §2.4's table:** `--staging <dir>` (default `<kit>/_staging`) and `--video <dir>`.
`--staging` is what makes the arc's "kit read-only, outputs to arc staging" boundary mechanical
rather than a promise — it overrides `k.staging` only, touches nothing in forge.py, and cannot change
Gemini behaviour. `--video` mirrors the vocabulary merge (`Kit.use_video`, forge L324-329) the
composer needs to resolve a video's own cast slugs.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `RunOptions`, `run_item` (C12), `preflight_batch`, `Kit`.
- Produces: `parse_shots(values: list[str]) -> list[str] | None`,
  `filter_spec(spec: list[dict], shots: list[str] | None) -> list[dict]`,
  `main(argv: list[str] | None = None) -> int`.

**Steps**

- [ ] Add the failing tests:

```python
def _spec_file(tmp, items):
    p = Path(tmp) / "spec.json"
    p.write_text(json.dumps(items), encoding="utf-8")
    return str(p)


def _runnable_item(name, payload_seed):
    it = _item_L29()
    it["name"] = name
    it["seed"] = [payload_seed]
    it["seed_roles"] = [{"path": payload_seed, "role": "figure", "character": "miniscribe-rep"}]
    return it


def _cli_env(mode):
    fc, k, tmp, staging, seed = _kit_for_run(mode)
    return fc, k, tmp, staging, seed


def test_cli_shots_filter_consumes_only_the_named_items():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                  "--shots", "A1"])
    assert rc == 0
    assert (staging / "A1.png").is_file() and not (staging / "A2.png").exists()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["A1"]


def test_cli_unknown_shot_id_raises_naming_it():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    raised = None
    try:
        fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                 "--shots", "A1,NOPE"])
    except SystemExit as e:
        raised = str(e)
    assert raised is not None and "NOPE" in raised


def test_cli_without_shots_consumes_the_whole_spec():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 0
    assert (staging / "A1.png").is_file() and (staging / "A2.png").is_file()


def test_cli_dry_run_spawns_zero_subprocesses_and_writes_no_png():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    fc.CODEX_ARGV_PREFIX = ["definitely-not-a-real-binary-xyz"]
    rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging), "--dry-run"])
    assert rc == 0
    assert not list(staging.glob("*.png"))
    assert not list(Path(tmp / "generated_images").rglob("*.png"))
    assert (staging / "_codex" / "prompts" / "A1.txt").is_file()
    assert (staging / "_codex" / "prompts" / "A2.txt").is_file()
    assert not (staging / "_codex" / "engine-log.jsonl").exists()


def test_cli_split_run_isolation_over_one_spec():
    """§2.2: codex runs its subset; a Gemini-side publication of the other name is untouched and
    the codex log holds exactly one row."""
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                    "--shots", "A1"]) == 0
    (staging / "A2.png").write_bytes(_png_bytes((1376, 768)))     # the "Gemini half"
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["A1"]
    assert (staging / "A1.png").is_file() and (staging / "A2.png").is_file()
    assert not list(staging.glob("*.lock"))


def test_cli_reports_failures_with_a_nonzero_exit():
    fc, k, tmp, staging, seed = _cli_env("no_image")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 1


def test_cli_never_loads_a_key():
    fc, k, tmp, staging, seed = _cli_env("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    saved = os.environ.pop("GEMINI_API_KEY", None)
    try:
        assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 0
    finally:
        if saved is not None:
            os.environ["GEMINI_API_KEY"] = saved
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'main'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
import argparse  # noqa: E402


def parse_shots(values):
    """`--shots L26,L33 --shots L29` -> ['L26','L33','L29']; no flag -> None (the whole spec)."""
    if not values:
        return None
    out = []
    for v in values:
        for part in str(v).split(","):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return out or None


def filter_spec(spec, shots):
    if shots is None:
        return list(spec)
    have = {item["name"] for item in spec}
    missing = [s for s in shots if s not in have]
    if missing:
        raise SystemExit(f"--shots names {len(missing)} id(s) not in the spec: "
                         f"{', '.join(missing)}")
    wanted = set(shots)
    return [item for item in spec if item["name"] in wanted]


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(prog="forge_codex",
                                 description="codex CLI image engine (standalone peer runner)")
    ap.add_argument("cmd", choices=("gen",))
    ap.add_argument("--kit", required=True)
    ap.add_argument("--batch", required=True, help="a spec.json emitted by `forge.py batch`")
    ap.add_argument("--video", default=None, help="merge this video's own cast vocabulary")
    ap.add_argument("--staging", default=None,
                    help="output directory (default <kit>/_staging); the arc always passes its own")
    ap.add_argument("--shots", action="append", default=[])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--canvas", dest="image_size", choices=("1K", "2K"), default=None)
    ap.add_argument("--session-mode", choices=("isolated", "session"), default="isolated")
    ap.add_argument("--session-span", type=int, default=8)
    ap.add_argument("--keep-composed", dest="keep_composed", action="store_true", default=True)
    a = ap.parse_args(argv)

    k = Kit(a.kit, dry=True)              # §2.3: no key, no URL, cannot reach Gemini by mistake
    if a.video:
        k.use_video(a.video)
    if a.staging:
        k.staging = os.path.abspath(a.staging)
    os.makedirs(k.staging, exist_ok=True)

    spec = json.load(open(a.batch, encoding="utf-8"))
    reqs = filter_spec(spec, parse_shots(a.shots))
    plan = preflight_batch(k, reqs, a.force, a.dry_run)      # the SAME law, at $0, before any call
    for item, seeds in plan:                                 # §6 class 1 over the WHOLE plan, at $0
        if seeds is not None:
            prepare_seeds(item, seeds)
    opts = RunOptions(force=a.force, dry_run=a.dry_run, image_size=a.image_size,
                      session_mode=a.session_mode, session_span=a.session_span,
                      keep_composed=a.keep_composed)
    session = None
    rows, failures = [], 0
    for item, seeds in plan:
        if seeds is None:
            print(f"  {item['name']}: skip (exists in staging)", flush=True)
            continue
        session = _session_for(opts, session)
        status, row = run_item(k, item, seeds, opts, session=session)
        print(f"  {item['name']}: {status}", flush=True)
        if row is not None:
            rows.append(row)
        if status.startswith("ERR"):
            failures += 1
            if status.startswith("ERR quota"):
                print("  == QUOTA — stopping the run loud; a human decides (§5.3) ==", flush=True)
                break
    if rows:
        print(run_totals_text(rows), flush=True)
    return 1 if failures else 0


def _session_for(opts, session):
    """Isolated mode has no session object at all. Replaced in full by Task C14."""
    return None


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 74 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): CLI -- gen/--shots/--dry-run/--force/--staging with $0 preflight"
```

---

## Task C14 — session mode

Spec §5.2 + test case 19. Still ONE image per turn: process/prefix overhead amortizes while every
invariant survives. A resume failure falls back to `isolated` **once**, automatically, and records
the fallback. `session` is implemented but **not the default** until Task A3's probe reports and
Daniel rules (§9.3 item 4).

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `generate()`'s `session=` branch (C10), `_session_for` stub (C13, replaced here).
- Produces: `class Session` with `thread_id: str | None`, `turns: int`, `snapshot: set[str]`,
  `span: int`, `fallbacks: int`, methods `record(thread_id) -> None`, `reset() -> None`,
  `exhausted() -> bool`; and the real `_session_for(opts, session) -> Session | None`.

**Steps**

- [ ] Add the failing tests:

```python
def test_session_reuses_one_thread_and_harvests_turn_two():
    fc, k, tmp, staging, seed = _kit_for_run("resume_ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    rc = fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                  "--session-mode", "session"])
    assert rc == 0
    assert (staging / "A1.png").is_file() and (staging / "A2.png").is_file()
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["A1", "A2"]
    assert rows[0]["thread_id"] == rows[1]["thread_id"], "turn 2 must reuse the thread"
    assert [r["turn_index"] for r in rows] == [1, 2]
    assert all(r["session_mode"] == "session" for r in rows)


def test_session_span_starts_a_fresh_thread_after_n_turns():
    fc, k, tmp, staging, seed = _kit_for_run("resume_ok")
    spec = _spec_file(tmp, [_runnable_item(f"A{i}", seed) for i in range(3)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                    "--session-mode", "session", "--session-span", "2"]) == 0
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[0]["thread_id"] == rows[1]["thread_id"]
    assert rows[2]["thread_id"] != rows[1]["thread_id"]
    assert [r["turn_index"] for r in rows] == [1, 2, 1]


def test_session_object_records_and_resets():
    import forge_codex as fc
    s = fc.Session(span=2)
    assert s.thread_id is None and s.turns == 0 and s.exhausted() is False
    s.record("t1")
    assert s.thread_id == "t1" and s.turns == 1 and s.exhausted() is False
    s.record("t1")
    assert s.turns == 2 and s.exhausted() is True
    s.reset()
    assert s.thread_id is None and s.turns == 0 and s.fallbacks == 1


def test_isolated_mode_uses_a_fresh_thread_per_frame():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed), _runnable_item("A2", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging)]) == 0
    rows = [json.loads(l) for l in
            (staging / "_codex" / "engine-log.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[0]["thread_id"] != rows[1]["thread_id"]
    assert all(r["session_mode"] == "isolated" and r["turn_index"] == 1 for r in rows)
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'Session'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`, and REPLACE the `_session_for` stub from C13:

```python
class Session:
    """§5.2 optional `session` mode: `codex exec resume <thread_id>`, still ONE image per turn.
    Harvest stays a snapshot diff precisely so a shared per-thread image directory works unchanged.
    NOT the default until P4's resume probe reports and Daniel rules (§9.3 item 4)."""

    def __init__(self, span=8):
        self.span = max(1, int(span))
        self.thread_id = None
        self.turns = 0
        self.snapshot = set()
        self.fallbacks = 0

    def record(self, thread_id):
        self.thread_id = thread_id
        self.turns += 1
        self.snapshot = snapshot_thread_dir(thread_id)

    def reset(self):
        """A fresh thread: after span exhaustion, or after a re-issue (the session state is suspect)."""
        if self.thread_id is not None:
            self.fallbacks += 1
        self.thread_id = None
        self.turns = 0
        self.snapshot = set()

    def exhausted(self):
        return self.turns >= self.span


def _session_for(opts, session):
    if opts.session_mode != "session":
        return None
    if session is None:
        return Session(span=opts.session_span)
    if session.exhausted():
        session.reset()
    return session
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 78 passed ==`.

- [ ] Confirm zero blast radius one more time before leaving Phase C:

```
git -C C:/Users/danie/kb-worktrees/boss-codex-image-engine diff --exit-code orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py
```

  Expected: no output, exit 0.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): session mode with span bound and automatic isolated fallback"
```

---

## Task C15 — the study-only register seed (§4.7 option (a))

Spec §4.7 authorizes ONE narrow shortcut, **for the study only**: raise the runner's cap to 5 and
append the §5 scene style tile — a fixed kit path needing no slate knowledge — *after* the slate's
seeds, recorded in the log row as `added_by: "codex_register_policy"`. This is what §7's L1 lever
actually generates, so without it L1 cannot run. Promoting it to production routes through Wave 2
(§10): a seed added outside `cmd_batch`'s displacement walk has not competed under the
never-droppable floor, and that is a doctrine property, not a convenience.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `prepare_seeds` (C5), `run_item` (C12), `build_log_row` / `LOG_KEYS` (C11), `main` (C13).
- Produces: `STUDY_SEED_CAP = 5`, `REGISTER_SEED_ADDED_BY = "codex_register_policy"`,
  `with_register_seed(item: dict, seeds: list[str], tile_path: str | None) -> tuple[dict, list[str], bool]`.
- **Signature changes made here (both backward compatible):** `prepare_seeds(item, seeds, cap=CODEX_SEED_CAP)`
  gains a `cap` keyword; `build_log_row(..., added_by=None)` gains a keyword and `LOG_KEYS` gains
  `"added_by"`; `RunOptions` gains `register_seed_tile: str = None`; the CLI gains
  `--register-seed-tile <path>`. Update C12's `run_item` and C13's `main` accordingly.

**Steps**

- [ ] Add the failing tests:

```python
def test_register_seed_is_appended_after_the_slate_and_labelled_style_only():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="tile-"))
    tile = _png(tmp / "scene-style-tile.png")
    item = _item_L29()
    item2, seeds2, added = fc.with_register_seed(item, ["C:/k/a.png", "C:/k/b.png"], tile)
    assert added is True
    assert seeds2[-1] == os.path.realpath(tile) and len(seeds2) == 3
    assert item2["seed_roles"][-1]["role"] == "style-anchor"
    assert item is not item2 and len(item["seed_roles"]) == 2, "the original item is not mutated"
    line = fc.input_images_line(item2["seed_roles"])
    assert line.rstrip().endswith("Image 3: style reference only.")


def test_register_seed_is_not_added_twice_when_the_slate_already_carries_it():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="tile-"))
    tile = _png(tmp / "scene-style-tile.png")
    item = _item_L26()
    item["seed_roles"] = [{"path": tile, "role": "style-anchor", "character": None}]
    item2, seeds2, added = fc.with_register_seed(item, [tile], tile)
    assert added is False and seeds2 == [tile] and item2 is item


def test_register_seed_raises_the_cap_to_five_only_for_the_added_tile():
    import forge_codex as fc
    tmp = Path(tempfile.mkdtemp(prefix="tile-"))
    four = [_png(tmp / f"s{i}.png") for i in range(4)]
    tile = _png(tmp / "scene-style-tile.png")
    assert len(fc.prepare_seeds({"name": "L33"}, four + [tile],
                                cap=fc.STUDY_SEED_CAP)) == 5
    raised = None
    try:
        fc.prepare_seeds({"name": "L33"}, four + [tile])       # default cap is still 4
    except fc.CodexContractError as e:
        raised = str(e)
    assert raised is not None and "CODEX_SEED_CAP" in raised


def test_register_seed_is_recorded_in_the_log_row():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    tile = _png(tmp / "scene-style-tile.png")
    status, row = fc.run_item(k, _item_L29(), [seed],
                              fc.RunOptions(register_seed_tile=tile))
    assert status == "OK"
    assert row["added_by"] == "codex_register_policy"
    assert len(row["seed_sha256"]) == 2
    assert "added_by" in fc.LOG_KEYS
    plain_status, plain_row = fc.run_item(k, _item_L26(), [seed], fc.RunOptions())
    assert plain_status == "OK" and plain_row["added_by"] is None
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `AttributeError: module 'forge_codex' has no attribute 'with_register_seed'`.

- [ ] Apply these edits to `<SCRIPTS>/forge_codex.py`:

```python
# --- §4.7 option (a): STUDY-ONLY. The runner cannot ADD a seed the slate omitted without
# --- re-deriving the slate, and re-deriving is forge.py's job. The ONE exception this spec
# --- authorizes for the study is the §5 scene style tile: a fixed kit path needing no slate
# --- knowledge, appended AFTER the slate's seeds and recorded as added_by. Promoting this to
# --- production routes through Wave 2 (§10) — a seed added outside the displacement walk has not
# --- competed under the never-droppable floor.
STUDY_SEED_CAP = 5
REGISTER_SEED_ADDED_BY = "codex_register_policy"


def with_register_seed(item, seeds, tile_path):
    """(item, seeds, added). The item is copied, never mutated: the spec it came from is truth."""
    if not tile_path:
        return item, list(seeds), False
    tile = os.path.realpath(str(tile_path))
    if tile in [os.path.realpath(str(s)) for s in seeds]:
        return item, list(seeds), False            # cast-free plates carry it by law already
    copied = dict(item)
    copied["seed_roles"] = list(item.get("seed_roles") or []) + \
        [{"path": tile, "role": "style-anchor", "character": None}]
    return copied, list(seeds) + [tile], True
```

  Then: change `def prepare_seeds(item, seeds):` to `def prepare_seeds(item, seeds, cap=CODEX_SEED_CAP):`
  and its cap check to `if len(out) > cap:` with the message reading
  `f"{name}: slate carries {len(out)} seeds, over CODEX_SEED_CAP={cap} — refusing to truncate; "
  f"re-derive the slate with forge.py batch instead"`. Add `"added_by"` to the end of `LOG_KEYS`,
  give `build_log_row` an `added_by=None` keyword and emit `"added_by": added_by`. Add
  `register_seed_tile: str = None` to `RunOptions`. In `run_item`, immediately after
  `residual = residual_idiom(...)`, insert:

```python
    item, seeds, tile_added = with_register_seed(item, seeds or [], opts.register_seed_tile)
    prepared = prepare_seeds(item, seeds,
                             cap=STUDY_SEED_CAP if tile_added else CODEX_SEED_CAP)
```

  (replacing the existing `prepared = prepare_seeds(item, seeds or [])` line), recompute
  `composed = compose_prompt(item, ...)` **after** this call so the tile reaches `Input images:`,
  and pass `added_by=REGISTER_SEED_ADDED_BY if tile_added else None` to both `build_log_row` calls.
  Finally add to `main`'s parser:

```python
    ap.add_argument("--register-seed-tile", default=None,
                    help="STUDY ONLY (§4.7a): append the §5 scene style tile as a register seed")
```

  and pass `register_seed_tile=a.register_seed_tile` into `RunOptions(...)`.

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 82 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): study-only register seed (style tile) with added_by provenance"
```

---

## Task C16 — the second composer format (§7.3's L2 lever)

§7.3's **L2** compares the labeled-field schema (P2b format 2, ~1700 chars) against minimal-prose +
hard `Avoid:` (P2b format 3, ~617 chars) over the corpus, same facts. Both are measured winners with
a real trade: format 3 edged on ink (+2.5 vs +4.6) while format 2 volunteered less extra scene
content. Without a second format in the composer, L2 cannot run. `labeled` stays the default;
one paired run over the corpus decides whether that changes.

**Files**
- Modify: `<SCRIPTS>/forge_codex.py`
- Modify: `<SCRIPTS>/test_forge_codex.py`

**Interfaces**
- Consumes: `resolve_slugs`, `translate_idiom`, `quoted_literals`, `input_images_line`,
  `avoid_text`, `framing_line`, `CODEX_REGISTER_BLOCK` (C4).
- **Signature change (backward compatible):**
  `compose_prompt(item, *, reg, canvas, aspect, fmt="labeled")` gains `fmt` in `("labeled", "minimal")`;
  `RunOptions` gains `fmt: str = "labeled"`; the CLI gains `--format labeled|minimal`. Every existing
  call site and test keeps working on the default.
- Produces: `COMPOSER_FORMATS = ("labeled", "minimal")`,
  `compose_minimal(item, *, reg, canvas, aspect) -> str`.

**Steps**

- [ ] Add the failing tests:

```python
def test_minimal_format_is_short_carries_the_same_facts_and_keeps_the_avoid_field():
    import forge_codex as fc
    labeled = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9")
    minimal = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9",
                                fmt="minimal")
    assert len(minimal) < len(labeled) / 2
    assert len(minimal) <= 900
    for fact in ("miniscribe-rep", "delighted expression", "roller door", "tote bins"):
        assert fact in minimal, fact
    assert "on the left of the frame" in minimal            # idiom translation still applies
    assert '"MINISCRIBE"' in minimal
    assert minimal.rstrip().split("\n")[-1].startswith("Avoid: ")
    assert "16:9 landscape" in minimal
    assert minimal.count("#d7402b") == 1


def test_minimal_format_omits_the_labeled_schema_headers():
    import forge_codex as fc
    minimal = fc.compose_prompt(_item_L26(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9",
                                fmt="minimal")
    for label in ("Use case:", "Asset type:", "Primary request:", "Style/medium:",
                  "Materials/textures:", "Constraints:"):
        assert label not in minimal, label
    assert minimal.rstrip().split("\n")[-1].startswith("Avoid: any words, letters")


def test_minimal_format_is_deterministic_and_unknown_format_fails_loud():
    import forge_codex as fc
    a = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9",
                          fmt="minimal")
    b = fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9",
                          fmt="minimal")
    assert a == b
    raised = None
    try:
        fc.compose_prompt(_item_L29(), reg=REGISTRY, canvas=(1376, 768), aspect="16:9",
                          fmt="freestyle")
    except SystemExit as e:
        raised = str(e)
    assert raised is not None and "freestyle" in raised


def test_cli_format_flag_reaches_the_composer():
    fc, k, tmp, staging, seed = _kit_for_run("ok")
    spec = _spec_file(tmp, [_runnable_item("A1", seed)])
    assert fc.main(["gen", "--kit", k.kit, "--batch", spec, "--staging", str(staging),
                    "--format", "minimal"]) == 0
    text = (staging / "_codex" / "prompts" / "A1.txt").read_text(encoding="utf-8")
    assert "Use case:" not in text and text.rstrip().split("\n")[-1].startswith("Avoid: ")
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected failure: `TypeError: compose_prompt() got an unexpected keyword argument 'fmt'`.

- [ ] Add to `<SCRIPTS>/forge_codex.py`:

```python
COMPOSER_FORMATS = ("labeled", "minimal")


def compose_minimal(item, *, reg, canvas, aspect):
    """P2b format 3 shape (~600 chars): one prose paragraph carrying the same facts, one condensed
    register clause, the canvas sentence, then the mandatory dedicated Avoid field on its own line.
    Same inputs, same determinism — only the surface differs, which is what makes L2 a fair test."""
    payload = translate_idiom(resolve_slugs(item.get("payload") or item.get("delta") or "", reg))
    quotes = quoted_literals(item.get("payload") or "")
    images = input_images_line(item.get("seed_roles") or [])
    head = payload.rstrip()
    if images:
        head += " " + images
    head += (" Flat 2.5D vector cartoon, even medium-thick dark warm brown-black outline (#241a12), "
             "flat cel colour, locked 2-3 colour scene palette plus the red accent #d7402b only for "
             "the punch element.")
    head += " " + framing_line(aspect, canvas)[len("Composition/framing: "):]
    return f"{head}\n\nAvoid: {avoid_text(bool(quotes))}\n"
```

  Then change `compose_prompt`'s signature to
  `def compose_prompt(item, *, reg, canvas, aspect, fmt="labeled"):` and make its first two lines:

```python
    if fmt not in COMPOSER_FORMATS:
        raise SystemExit(f"unknown composer format {fmt!r} (allowed: {', '.join(COMPOSER_FORMATS)})")
    if fmt == "minimal":
        return compose_minimal(item, reg=reg, canvas=canvas, aspect=aspect)
```

  Add `fmt: str = "labeled"` to `RunOptions`, pass `fmt=opts.fmt` from `run_item`'s
  `compose_prompt(...)` call, add to `main`'s parser
  `ap.add_argument("--format", dest="fmt", choices=COMPOSER_FORMATS, default="labeled")` and pass
  `fmt=a.fmt` into `RunOptions(...)`.

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
```

  Expected: `== 86 passed ==`.

- [ ] Commit:

```
git add orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py orgs/faceless-youtube/.claude/skills/image-generation/scripts/test_forge_codex.py
git commit -m "feat(codex-engine): minimal-prose composer format for the L2 length lever"
```

---

# PHASE D — study tooling (built and tested here; **run** at P5, human-gated)

Phase D produces two tested deliverables under `<ARC>/`. Neither is executed against real
generations in this plan: running the ladder is P5, behind Daniel's gate, under the 40-gen budget.

---

## Task D1 — `study_metrics.py`: M1-M4 and baseline sha re-verification

Spec §7.2 + §7.5. Every metric is computed on frames at the SAME canvas — M2 is neighbourhood-based
and therefore resolution-sensitive, so comparing a native 1672×941 codex render against a 1376×768
baseline would measure the resize, not the register.

**Files**
- Create: `<ARC>/study_metrics.py`
- Create: `<ARC>/test_study_metrics.py`

**Interfaces**
- Consumes: `<ARC>/gemini-baseline/*.png` + `SHAS.txt` (read-only); NumPy + Pillow.
- Produces: `RED = (215, 64, 43)`, `RED_RADIUS = 60`,
  `luma(arr) -> np.ndarray`, `m1_ink_warmth(arr) -> float`, `m2_flatness(arr) -> float`,
  `m3_palette_concentration(arr) -> int`, `m4_red_discipline(arr) -> float`,
  `measure(path) -> dict` with keys `path, dims, m1, m2, m3, m4`,
  `verify_baseline_shas(baseline_dir) -> list[str]` (list of mismatching filenames; empty = clean).

**Steps**

- [ ] Write the failing test file `<ARC>/test_study_metrics.py`:

```python
#!/usr/bin/env python3
"""Unit tests for study_metrics.py (plain asserts, no pytest).
Run: py -3 test_study_metrics.py"""
import io
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
HERE = Path(__file__).resolve().parent


def _img(size, blocks):
    """blocks = [(x0, y0, x1, y1, (r,g,b)), ...] painted over a light ground."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size, (240, 240, 235))
    d = ImageDraw.Draw(im)
    for x0, y0, x1, y1, col in blocks:
        d.rectangle([x0, y0, x1, y1], fill=col)
    return im


def _save(im):
    tmp = Path(tempfile.mkdtemp(prefix="metrics-")) / "f.png"
    im.save(tmp, format="PNG")
    return str(tmp)


def test_m1_reads_the_darkest_three_percent_ink_warmth():
    import study_metrics as sm
    import numpy as np
    im = _img((400, 400), [(0, 0, 399, 39, (36, 26, 18))])      # 10% of the frame at #241a12
    arr = np.asarray(im).astype(float)
    assert abs(sm.m1_ink_warmth(arr) - 18.0) < 0.05
    cool = _img((400, 400), [(0, 0, 399, 39, (18, 26, 36))])
    assert abs(sm.m1_ink_warmth(np.asarray(cool).astype(float)) + 18.0) < 0.05


def test_m2_flatness_is_high_for_flat_cel_and_low_for_a_gradient():
    import study_metrics as sm
    import numpy as np
    from PIL import Image
    flat = np.asarray(_img((300, 300), [(0, 0, 299, 99, (36, 26, 18)),
                                        (0, 100, 299, 199, (90, 140, 150))])).astype(float)
    assert sm.m2_flatness(flat) > 0.9
    grad = Image.linear_gradient("L").convert("RGB").resize((300, 300))
    assert sm.m2_flatness(np.asarray(grad).astype(float)) < 0.5


def test_m3_counts_colours_to_ninety_percent_area():
    import study_metrics as sm
    import numpy as np
    im = _img((300, 300), [(0, 0, 299, 149, (36, 26, 18)), (0, 150, 299, 269, (90, 140, 150))])
    assert sm.m3_palette_concentration(np.asarray(im).astype(float)) == 2


def test_m4_measures_the_red_accent_share():
    import study_metrics as sm
    import numpy as np
    im = _img((400, 400), [(0, 0, 399, 39, (215, 64, 43))])      # exactly 10%
    got = sm.m4_red_discipline(np.asarray(im).astype(float))
    assert abs(got - 0.10) < 0.005
    plain = _img((400, 400), [])
    assert sm.m4_red_discipline(np.asarray(plain).astype(float)) == 0.0


def test_measure_returns_dims_and_all_four_metrics():
    import study_metrics as sm
    path = _save(_img((1376, 768), [(0, 0, 1375, 79, (36, 26, 18))]))
    got = sm.measure(path)
    assert got["dims"] == [1376, 768]
    assert set(got) == {"path", "dims", "m1", "m2", "m3", "m4"}
    assert abs(got["m1"] - 18.0) < 0.05


def test_baseline_shas_reverify_clean():
    import study_metrics as sm
    bad = sm.verify_baseline_shas(str(HERE / "gemini-baseline"))
    assert bad == [], f"baseline frames altered: {bad}"


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_metrics.py
```

  Expected failure: `ModuleNotFoundError: No module named 'study_metrics'`.

- [ ] Write `<ARC>/study_metrics.py`:

```python
#!/usr/bin/env python3
"""M1-M4 register metrics for the codex-engine study (spec §7.2) + baseline sha re-verification.

Every metric is computed on frames at the SAME canvas: M2 is neighbourhood-based and therefore
resolution-sensitive, so a native codex render must be normalized before it is measured.
M1 reproduces the method both probe logs used (validated: P2b reproduced p1's G1/G2 to ~0.1).

Usage:
  py -3 study_metrics.py --verify-shas
  py -3 study_metrics.py <frame.png> [<frame.png> ...]
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

RED = (215, 64, 43)          # #d7402b
RED_RADIUS = 60.0
DARK_FRACTION = 0.03
FLAT_RANGE = 4.0             # luma range <= 4/255 within a 5x5 neighbourhood
EDGE_PERCENTILE = 90


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(float)


def luma(arr):
    return 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]


def m1_ink_warmth(arr):
    """Mean R-B over the darkest 3% of pixels by luma."""
    flat = luma(arr).ravel()
    n = max(1, int(len(flat) * DARK_FRACTION))
    idx = np.argpartition(flat, n - 1)[:n]
    px = arr.reshape(-1, 3)[idx]
    return float(px[:, 0].mean() - px[:, 2].mean())


def _windows(a, k=5):
    return np.lib.stride_tricks.sliding_window_view(a, (k, k))


def m2_flatness(arr):
    """Fraction of NON-EDGE pixels whose 5x5 neighbourhood luma range is <= 4/255.
    High = flat cel fills; low = gradients / ambient shading."""
    y = luma(arr)
    win = _windows(y, 5)
    rng = win.max(axis=(-1, -2)) - win.min(axis=(-1, -2))
    gx = np.zeros_like(y); gy = np.zeros_like(y)
    gx[:, 1:-1] = y[:, 2:] - y[:, :-2]
    gy[1:-1, :] = y[2:, :] - y[:-2, :]
    mag = np.hypot(gx, gy)
    edge = mag > np.percentile(mag, EDGE_PERCENTILE)
    near_edge = _windows(edge.astype(float), 5).max(axis=(-1, -2)) > 0
    keep = ~near_edge
    if keep.sum() == 0:
        return 0.0
    return float(((rng <= FLAT_RANGE) & keep).sum() / keep.sum())


def m3_palette_concentration(arr):
    """Colours needed to cover 90% of frame area after 32-level-per-channel quantization."""
    q = (arr // 8).astype(np.int32)
    keys = q[:, :, 0] * 1024 + q[:, :, 1] * 32 + q[:, :, 2]
    counts = np.sort(np.bincount(keys.ravel()))[::-1]
    total = counts.sum()
    cum = np.cumsum(counts)
    return int(np.searchsorted(cum, 0.9 * total) + 1)


def m4_red_discipline(arr):
    """Fraction of pixels within a small RGB radius of #d7402b."""
    d = np.linalg.norm(arr - np.array(RED, dtype=float), axis=2)
    return float((d <= RED_RADIUS).mean())


def measure(path):
    arr = load(path)
    h, w, _ = arr.shape
    return {"path": str(path).replace("\\", "/"), "dims": [w, h],
            "m1": round(m1_ink_warmth(arr), 3), "m2": round(m2_flatness(arr), 4),
            "m3": m3_palette_concentration(arr), "m4": round(m4_red_discipline(arr), 5)}


def verify_baseline_shas(baseline_dir):
    """A silently altered reference can never move a gate (§7.5). Returns mismatching filenames."""
    bad = []
    shas = os.path.join(baseline_dir, "SHAS.txt")
    for line in open(shas, encoding="utf-8"):
        parts = line.split()
        if len(parts) != 3:
            continue
        digest, name, _size = parts
        path = os.path.join(baseline_dir, name)
        if not os.path.isfile(path):
            bad.append(name)
            continue
        if hashlib.sha256(open(path, "rb").read()).hexdigest() != digest:
            bad.append(name)
    return bad


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", nargs="*")
    ap.add_argument("--verify-shas", action="store_true")
    ap.add_argument("--baseline-dir",
                    default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "gemini-baseline"))
    a = ap.parse_args(argv)
    if a.verify_shas:
        bad = verify_baseline_shas(a.baseline_dir)
        print(json.dumps({"baseline_dir": a.baseline_dir, "mismatches": bad}, indent=2))
        return 1 if bad else 0
    for f in a.frames:
        print(json.dumps(measure(f)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_metrics.py
```

  Expected: `== 6 passed ==`.

- [ ] Sanity-run the metric over the real baselines (the §7.5 "a metric whose Gemini spread is
  absurdly wide is a broken metric, not a finding" check):

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/study_metrics.py C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/gemini-baseline/L29.png C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/gemini-baseline/L26.png
```

  Expected: two JSON lines, `dims: [1376, 768]` on both, and L29's `m1` close to **+0.5** (the value
  P2b measured with the same method). If L29's M1 is not within ~1.0 of +0.5, the metric is
  mis-implemented — fix it before proceeding, do not adjust the expectation.

- [ ] Commit:

```
git add scratch-codex-image-engine/study_metrics.py scratch-codex-image-engine/test_study_metrics.py
git commit -m "feat(codex-engine): M1-M4 register metrics + baseline sha re-verification, tested"
```

---

## Task D2 — paired distances, the 23-frame band, and the ratified-floor verdict

Spec §7.2 + §7.4 + §7.5. A codex frame is judged against the **real Gemini frame of the same shot**,
never against a constant: the channel's own accepted output spans a ~53-point M1 range.

**Ambiguity pinned here:** §7.4 states the 3-of-4 rule explicitly for `|ΔM1|` and says M2/M3/M4 must
be "within the baseline band" without naming a shot count. This code applies the **same 3-of-4 rule
to each of M1, M2, M3 and M4**, and reports every per-shot number so a stricter reading can be
applied by eye from the same table.

**Files**
- Modify: `<ARC>/study_metrics.py`
- Modify: `<ARC>/test_study_metrics.py`

**Interfaces**
- Consumes: `measure`, `verify_baseline_shas` (D1).
- Produces: `CORPUS = ("L26", "L44", "L33", "L29")`, `M1_FLOOR = 5.0`, `MIN_SHOTS_PASSING = 3`,
  `iqr_width(values) -> float`, `baseline_table(baseline_dir) -> dict[str, dict]`,
  `baseline_bands(baseline_dir) -> dict[str, float]`,
  `paired_distances(codex: dict, baseline: dict) -> dict[str, float]`,
  `evaluate_floor(distances_by_shot: dict[str, dict], bands: dict[str, float]) -> dict` returning
  `{"per_metric": {...}, "passing_shots": {...}, "pass": bool, "reason": str}`.

**Steps**

- [ ] Add the failing tests to `<ARC>/test_study_metrics.py`:

```python
def test_iqr_width_is_the_interquartile_span():
    import study_metrics as sm
    assert abs(sm.iqr_width([1, 2, 3, 4, 5, 6, 7, 8, 9]) - 4.0) < 1e-9
    assert sm.iqr_width([5.0]) == 0.0


def test_baseline_table_and_bands_over_the_23_verified_frames():
    import study_metrics as sm
    table = sm.baseline_table(str(HERE / "gemini-baseline"))
    assert len(table) == 23
    for shot in sm.CORPUS:
        assert shot in table, shot
        assert table[shot]["dims"] == [1376, 768]
    bands = sm.baseline_bands(str(HERE / "gemini-baseline"))
    assert set(bands) == {"m1", "m2", "m3", "m4"}
    assert all(v >= 0 for v in bands.values())
    assert bands["m1"] > 0, "a zero M1 band over 23 real frames means the metric is broken"


def test_paired_distances_are_absolute_per_metric():
    import study_metrics as sm
    d = sm.paired_distances({"m1": 4.6, "m2": 0.70, "m3": 9, "m4": 0.012},
                            {"m1": 0.5, "m2": 0.78, "m3": 7, "m4": 0.010})
    assert abs(d["m1"] - 4.1) < 1e-9
    assert abs(d["m2"] - 0.08) < 1e-9
    assert d["m3"] == 2 and abs(d["m4"] - 0.002) < 1e-9


def test_evaluate_floor_passes_on_three_of_four_shots():
    import study_metrics as sm
    bands = {"m1": 20.0, "m2": 0.20, "m3": 6.0, "m4": 0.05}
    good = {"m1": 2.0, "m2": 0.05, "m3": 1, "m4": 0.001}
    bad_m1 = {"m1": 9.0, "m2": 0.05, "m3": 1, "m4": 0.001}
    dist = {"L26": good, "L44": good, "L33": good, "L29": bad_m1}
    got = sm.evaluate_floor(dist, bands)
    assert got["pass"] is True
    assert got["passing_shots"]["m1"] == 3
    dist["L33"] = bad_m1
    assert sm.evaluate_floor(dist, bands)["pass"] is False


def test_evaluate_floor_fails_when_a_band_metric_slips():
    import study_metrics as sm
    bands = {"m1": 20.0, "m2": 0.02, "m3": 1.0, "m4": 0.001}
    d = {"m1": 1.0, "m2": 0.30, "m3": 5, "m4": 0.02}
    got = sm.evaluate_floor({s: d for s in sm.CORPUS}, bands)
    assert got["pass"] is False
    assert got["passing_shots"]["m2"] == 0
    assert "m2" in got["reason"]
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_metrics.py
```

  Expected failure: `AttributeError: module 'study_metrics' has no attribute 'iqr_width'`.

- [ ] Add to `<ARC>/study_metrics.py`:

```python
# --- §7.4 THE RATIFIED FLOOR (Daniel, 2026-08-11), in paired form:
# ---   |dM1| <= 5 per shot on at least 3 of the 4 corpus shots; AND
# ---   |dM2| no worse than the interquartile width of M2 across the 23 verified frames; AND
# ---   M3/M4 inside the same band.
# --- The 3-of-4 rule is stated for M1; this code applies it to every metric and reports the full
# --- per-shot table so a stricter reading can be applied by eye.
CORPUS = ("L26", "L44", "L33", "L29")
M1_FLOOR = 5.0
MIN_SHOTS_PASSING = 3
METRICS = ("m1", "m2", "m3", "m4")


def iqr_width(values):
    v = np.asarray(sorted(float(x) for x in values), dtype=float)
    if v.size < 2:
        return 0.0
    return float(np.percentile(v, 75) - np.percentile(v, 25))


def baseline_table(baseline_dir):
    out = {}
    for name in sorted(os.listdir(baseline_dir)):
        if name.lower().endswith(".png"):
            out[os.path.splitext(name)[0]] = measure(os.path.join(baseline_dir, name))
    return out


def baseline_bands(baseline_dir):
    table = baseline_table(baseline_dir)
    return {m: iqr_width([row[m] for row in table.values()]) for m in METRICS}


def paired_distances(codex, baseline):
    return {m: abs(codex[m] - baseline[m]) for m in METRICS}


def evaluate_floor(distances_by_shot, bands):
    """The study's PASS / STOP-and-escalate verdict, declared against the ratified floor."""
    limits = {"m1": M1_FLOOR, "m2": bands["m2"], "m3": bands["m3"], "m4": bands["m4"]}
    passing, per_metric = {}, {}
    for m in METRICS:
        rows = {shot: d[m] for shot, d in distances_by_shot.items()}
        ok = [shot for shot, v in rows.items() if v <= limits[m]]
        passing[m] = len(ok)
        per_metric[m] = {"limit": round(limits[m], 5), "distances": rows,
                         "passing": sorted(ok)}
    failed = [m for m in METRICS if passing[m] < MIN_SHOTS_PASSING]
    return {"per_metric": per_metric, "passing_shots": passing, "pass": not failed,
            "reason": ("all metrics clear the floor on >= %d of %d shots"
                       % (MIN_SHOTS_PASSING, len(distances_by_shot))) if not failed
                      else ("below floor on: " + ", ".join(failed))}
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_metrics.py
```

  Expected: `== 11 passed ==`.

- [ ] Commit:

```
git add scratch-codex-image-engine/study_metrics.py scratch-codex-image-engine/test_study_metrics.py
git commit -m "feat(codex-engine): paired distances, 23-frame IQR bands, ratified-floor verdict"
```

---

## Task D3 — `study_run.py`: the L0/L1/L2/L3 ladder under a hard 40-gen budget

Spec §7.3. **This task builds and tests the runner; it does not run the study.** Running it is P5,
behind Daniel's gate.

**Files**
- Create: `<ARC>/study_run.py`
- Create: `<ARC>/test_study_run.py`

**Interfaces**
- Consumes: `study_metrics` (D1/D2); at P5, `forge_codex.main` as the generator. The **L1** cells map
  onto `forge_codex --register-seed-tile <kit>/refs/env/scene-style-tile.png` (Task C15); **L2**
  cells map onto `--format labeled` vs `--format minimal` (Task C16); **L3** spends no generations
  and re-runs
  `forge_codex.normalize_to_canvas` over the frames L0 already produced.
- Produces: `GEN_BUDGET = 40`, `REPS = 2`, `EARLY_STOP_DELTA = 3.0`,
  `class BudgetExceeded(RuntimeError)`, `class Budget` (`spend(n)`, `.used`, `.remaining`),
  `ladder(levers: tuple[str, ...] = ("L0", "L1", "L2", "L3")) -> list[dict]` producing cells
  `{"lever","shot","variant","rep","gens"}`,
  `load_results(path) -> list[dict]`, `append_result(path, row) -> None`,
  `run_study(*, cells, generate_fn, measure_fn, results_path, budget) -> dict`.

**Steps**

- [ ] Write the failing test file `<ARC>/test_study_run.py`:

```python
#!/usr/bin/env python3
"""Unit tests for study_run.py (plain asserts, no pytest). NO GENERATIONS: generate_fn is a stub.
Run: py -3 test_study_run.py"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def _results():
    return str(Path(tempfile.mkdtemp(prefix="study-")) / "p5-study-results.jsonl")


def test_ladder_shape_and_gen_counts_match_the_spec_budget():
    import study_run as sr
    l0 = sr.ladder(("L0",))
    assert len(l0) == 8 and sum(c["gens"] for c in l0) == 8
    assert sorted({c["shot"] for c in l0}) == sorted(sr.CORPUS)
    assert sorted({c["rep"] for c in l0}) == [1, 2]
    assert sum(c["gens"] for c in sr.ladder(("L1",))) <= 16
    assert sum(c["gens"] for c in sr.ladder(("L2",))) == 8
    assert sum(c["gens"] for c in sr.ladder(("L3",))) == 0
    assert sum(c["gens"] for c in sr.ladder()) <= sr.GEN_BUDGET


def test_budget_is_hard_and_refuses_the_forty_first_generation():
    import study_run as sr
    b = sr.Budget(sr.GEN_BUDGET)
    b.spend(39)
    assert b.remaining == 1
    b.spend(1)
    raised = None
    try:
        b.spend(1)
    except sr.BudgetExceeded as e:
        raised = str(e)
    assert raised is not None and "40" in raised


def test_run_study_writes_results_incrementally_and_is_resumable():
    import study_run as sr
    path = _results()
    calls = []

    def gen(cell):
        calls.append(cell["shot"])
        return f"/fake/{cell['lever']}-{cell['shot']}-{cell['rep']}.png"

    def meas(_png):
        return {"m1": 2.0, "m2": 0.70, "m3": 8, "m4": 0.01}

    out = sr.run_study(cells=sr.ladder(("L0",)), generate_fn=gen, measure_fn=meas,
                       results_path=path, budget=sr.Budget(sr.GEN_BUDGET))
    assert out["gens_used"] == 8 and len(calls) == 8
    rows = sr.load_results(path)
    assert len(rows) == 8 and all("m1" in r for r in rows)

    calls.clear()
    out2 = sr.run_study(cells=sr.ladder(("L0",)), generate_fn=gen, measure_fn=meas,
                        results_path=path, budget=sr.Budget(sr.GEN_BUDGET))
    assert calls == [] and out2["gens_used"] == 0 and out2["skipped"] == 8


def test_run_study_stops_a_lever_that_worsens_m1_by_more_than_three():
    import study_run as sr
    path = _results()
    seen = []

    def gen(cell):
        seen.append(cell)
        return "/fake/x.png"

    def meas(_png):
        # every L1 cell is 4.0 worse than the best-so-far seeded below
        return {"m1": 9.0, "m2": 0.70, "m3": 8, "m4": 0.01}

    sr.append_result(path, {"lever": "L0", "shot": "L26", "variant": "base", "rep": 1,
                            "png": "/fake/base.png", "m1": 1.0, "m2": 0.7, "m3": 8, "m4": 0.01,
                            "d_m1": 1.0})
    out = sr.run_study(cells=sr.ladder(("L1",)), generate_fn=gen, measure_fn=meas,
                       results_path=path, budget=sr.Budget(sr.GEN_BUDGET),
                       baseline_m1={"L26": 0.0, "L44": 0.0, "L33": 0.0, "L29": 0.0})
    assert out["stopped_levers"] == ["L1"]
    assert out["gens_used"] < 16, "the lever must be abandoned, never rescued with more wordings"


def test_run_study_refuses_to_exceed_the_budget_mid_ladder():
    import study_run as sr
    path = _results()
    out = None
    raised = None
    try:
        out = sr.run_study(cells=sr.ladder(("L0",)), generate_fn=lambda c: "/fake/x.png",
                           measure_fn=lambda p: {"m1": 1.0, "m2": 0.7, "m3": 8, "m4": 0.01},
                           results_path=path, budget=sr.Budget(3))
    except sr.BudgetExceeded as e:
        raised = str(e)
    assert raised is not None and out is None
    assert len(sr.load_results(path)) == 3, "everything spent before the stop is banked"


ALL_TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    for fn in ALL_TESTS:
        fn()
        print(f"  ok  {fn.__name__}", flush=True)
    print(f"== {len(ALL_TESTS)} passed ==")
```

- [ ] Run to see it fail:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_run.py
```

  Expected failure: `ModuleNotFoundError: No module named 'study_run'`.

- [ ] Write `<ARC>/study_run.py`:

```python
#!/usr/bin/env python3
"""The codex-engine register study ladder (spec §7.3). BUILT AND TESTED at P4; RUN at P5 only,
behind Daniel's gate, under a HARD 40-generation budget. $0 (subscription).

Rungs:
  L0  baseline composer, 4 shots x 2 reps                              = 8 gens
  L1  style tile as an ink/register seed, 2 variants x 4 shots x 2 reps <= 16 gens
  L2  format length (labeled schema vs minimal prose), 4 shots x 2 reps = 8 gens
  L3  canvas choice: re-normalize the SAME renders to 1K vs 2K          = 0 gens
No lever gets a third variant: a third wording is where an unbounded chase starts.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import study_metrics as sm  # noqa: E402

GEN_BUDGET = 40
REPS = 2
EARLY_STOP_DELTA = 3.0
CORPUS = sm.CORPUS

LEVER_VARIANTS = {
    "L0": ("base",),
    "L1": ("tile-on", "tile-on-short-label"),
    "L2": ("format2-labeled", "format3-minimal"),
    "L3": (),                       # zero-gen: re-normalizes existing renders
}


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    def __init__(self, total=GEN_BUDGET):
        self.total = int(total)
        self.used = 0

    @property
    def remaining(self):
        return self.total - self.used

    def spend(self, n=1):
        if self.used + n > self.total:
            raise BudgetExceeded(f"generation budget exhausted: {self.used}+{n} > {self.total} "
                                 f"(plan-approved study budget is {GEN_BUDGET})")
        self.used += n


def ladder(levers=("L0", "L1", "L2", "L3")):
    cells = []
    for lever in levers:
        variants = LEVER_VARIANTS[lever]
        if not variants:
            continue
        # L2 compares two formats but spends only 8 gens: one rep per format per shot.
        reps = 1 if lever == "L2" else REPS
        for shot in CORPUS:
            for variant in variants:
                for rep in range(1, reps + 1):
                    cells.append({"lever": lever, "shot": shot, "variant": variant,
                                  "rep": rep, "gens": 1})
    return cells


def _key(cell):
    return f"{cell['lever']}|{cell['shot']}|{cell['variant']}|{cell['rep']}"


def load_results(path):
    if not os.path.isfile(path):
        return []
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def append_result(path, row):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")


def run_study(*, cells, generate_fn, measure_fn, results_path, budget, baseline_m1=None):
    """Walk the ladder, banking each cell to `results_path` the moment it lands (a crash mid-run
    never loses spent generations). Stops a lever whose |dM1| worsens by more than 3 against the
    best so far -- never rescues it with a third wording."""
    done = {(_key(r)) for r in load_results(results_path)}
    best_d_m1 = min([r["d_m1"] for r in load_results(results_path) if "d_m1" in r] or [None]) \
        if any("d_m1" in r for r in load_results(results_path)) else None
    stopped, used, skipped = [], 0, 0
    for cell in cells:
        if cell["lever"] in stopped:
            continue
        if _key(cell) in done:
            skipped += 1
            continue
        budget.spend(cell["gens"])
        png = generate_fn(cell)
        metrics = measure_fn(png)
        row = dict(cell, png=png, **metrics)
        if baseline_m1 is not None and cell["shot"] in baseline_m1:
            row["d_m1"] = abs(metrics["m1"] - baseline_m1[cell["shot"]])
        append_result(results_path, row)
        used += cell["gens"]
        if "d_m1" in row:
            if best_d_m1 is not None and row["d_m1"] > best_d_m1 + EARLY_STOP_DELTA:
                stopped.append(cell["lever"])
                print(f"  == lever {cell['lever']} STOPPED: |dM1| {row['d_m1']:.1f} is more than "
                      f"{EARLY_STOP_DELTA} worse than the best so far ({best_d_m1:.1f}) ==",
                      flush=True)
                continue
            best_d_m1 = row["d_m1"] if best_d_m1 is None else min(best_d_m1, row["d_m1"])
    return {"gens_used": used, "skipped": skipped, "stopped_levers": stopped,
            "budget_remaining": budget.remaining, "results_path": results_path}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan-only", action="store_true",
                    help="print the ladder and its gen cost; spend nothing")
    ap.add_argument("--levers", default="L0,L1,L2,L3")
    a = ap.parse_args(argv)
    cells = ladder(tuple(x.strip() for x in a.levers.split(",") if x.strip()))
    print(json.dumps({"cells": len(cells), "gens": sum(c["gens"] for c in cells),
                      "budget": GEN_BUDGET}, indent=2))
    if not a.plan_only:
        print("Running the study is a P5 step behind a human gate. Re-run with --plan-only, or "
              "drive run_study() from the P5 runbook with forge_codex as generate_fn.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] Run to pass:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_run.py
```

  Expected: `== 5 passed ==`.

- [ ] Confirm the ladder fits the approved budget and that the runner refuses to self-start:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/study_run.py --plan-only
```

  Expected: JSON with `"gens"` ≤ 40 and `"budget": 40`, exit 0. Without `--plan-only` it must print
  the human-gate line and exit 2.

- [ ] Commit:

```
git add scratch-codex-image-engine/study_run.py scratch-codex-image-engine/test_study_run.py
git commit -m "feat(codex-engine): study ladder runner -- 40-gen hard budget, incremental results, early stop"
```

---

# Final task — full-suite verification and definition of done

**Files**
- Modify: none (verification only). If a check fails, fix it in the file it names and re-run every
  check from the top.

**Interfaces**
- Consumes: every file this plan created.
- Produces: a verification transcript pasted into the task's completion note. No new code.

**Steps**

- [ ] Run the whole image-generation suite (every existing test plus the two new ones):

```
py -3 -c "import glob,subprocess,sys; d=r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts'; fails=[]; [fails.append(f) for f in sorted(glob.glob(d+'/test_forge_*.py'))+[d+'/test_stamp_review.py', d+'/test_build_review_artifact.py'] if subprocess.run([sys.executable,f]).returncode!=0]; print('FAILED:',fails or 'none'); sys.exit(1 if fails else 0)"
```

  Expected: `FAILED: none`, exit 0.

- [ ] Run the study tooling tests:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_metrics.py
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/test_study_run.py
```

  Expected: `== 11 passed ==` and `== 5 passed ==`.

- [ ] **The blast-radius check — the acceptance ruling 7 was made for:**

```
git -C C:/Users/danie/kb-worktrees/boss-codex-image-engine diff --exit-code orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py
```

  Expected: no output, exit 0. A non-empty diff is a **hard stop**: revert it, do not rationalize it.

- [ ] Confirm forge.py does not import forge_codex (the dependency is one-directional):

```
py -3 -c "import re,sys; s=open(r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge.py',encoding='utf-8').read(); sys.exit(0 if 'forge_codex' not in s else 1)"
```

  Expected: exit 0.

- [ ] Confirm no `.env` read and no `GEMINI_API_KEY` reference anywhere in the new code:

```
py -3 -c "import sys; bad=[f for f in (r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/forge_codex.py', r'C:/Users/danie/kb-worktrees/boss-codex-image-engine/orgs/faceless-youtube/.claude/skills/image-generation/scripts/_fake_codex.py') if 'GEMINI_API_KEY' in open(f,encoding='utf-8').read() or 'load_env' in open(f,encoding='utf-8').read()]; print('LEAKS:', bad or 'none'); sys.exit(1 if bad else 0)"
```

  Expected: `LEAKS: none`, exit 0.

- [ ] Confirm the kit is untouched and no stray outputs were left anywhere:

```
git -C C:/Users/danie/kb-worktrees/boss-codex-image-engine status --short
```

  Expected: no modifications under
  `orgs/faceless-youtube/channels/the-second-take/visual-kit/`, no `_staging/` directory inside the
  kit, and no untracked PNGs outside `scratch-codex-image-engine/`.

- [ ] Verify the baselines are byte-identical to what the study was calibrated against:

```
py -3 C:/Users/danie/kb-worktrees/boss-codex-image-engine/scratch-codex-image-engine/study_metrics.py --verify-shas
```

  Expected: `"mismatches": []`, exit 0.

- [ ] Commit the verification (no file changes expected; if the suite forced a fix, commit that
  fix with its own message instead):

```
git add -- orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md
git commit --allow-empty -m "chore(codex-engine): full-suite verification green, forge.py diff empty"
```

## Definition of done

1. `forge_codex.py`, `_fake_codex.py` and `test_forge_codex.py` exist under `<SCRIPTS>`; the whole
   `test_forge_*.py` + `test_stamp_review.py` + `test_build_review_artifact.py` suite is green.
2. `git diff --exit-code <SCRIPTS>/forge.py` is **empty**, and forge.py does not mention
   `forge_codex`.
3. `study_metrics.py`, `study_run.py` and their tests exist under `<ARC>` and are green;
   `study_run.py --plan-only` reports ≤ 40 generations; running it without `--plan-only` refuses.
4. All four P4 probe evidence files are banked and committed in `<ARC>`, and probe 1 carries an
   explicit PASS / PARTIAL / FAIL verdict on the empty-tempdir control.
5. No `.env` read, no `GEMINI_API_KEY` anywhere, $0 API spend, kit unmodified, nothing written
   outside `<ARC>` and the arc staging directory.
6. **Not done here, by design:** running the register study (P5, human-gated), the P5 live slice
   (§8.4), the escalation packet (§7.4), enabling `session` mode by default (§9.3 item 4), and
   Wave 2's in-process integration (§10).

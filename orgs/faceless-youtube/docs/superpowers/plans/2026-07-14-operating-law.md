# Operating Law Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every terminal in `faceless-youtube` boots already knowing the project's accumulated operating learnings, from one versioned source, with zero invocation.

**Architecture:** Promote the `channel-forge` Enforcement Contract (clauses A–H — already universal; only its label is channel-forge's) to `knowledge/operating-law.md`. Wire it into `CLAUDE.md` via an `@import` so it loads at launch in every session and every worktree. Then collapse the duplicate governing layers into it (CLAUDE.md rules 1–6, the process-law memories) and cut the noise that currently drowns it (a 264-line status changelog). Craft law routes to the skill docs that own it, not into the law.

**Tech Stack:** Markdown docs; Python 3 (`py -3`) hook scripts; pytest; Claude Code `settings.json` hooks and CLAUDE.md `@import`.

**Spec:** `docs/superpowers/specs/2026-07-14-operating-law-and-governing-structure-design.md`

## Global Constraints

- **No learning lost.** Migration is **copy → verify → delete**, never move-and-hope. Every deleted source line must be verifiably present at its destination before deletion. (Spec §8; clause E "enrich, don't replace".)
- **Verification is by fresh-eyes critic subagent, not self-review.** A doc task's author cannot certify its own coverage — that is the `fix-generation-not-prohibitions` defect this project exists to respect. (Spec §7.)
- **The law stays ≈110 lines.** Absorb learnings *into existing clauses*; never append new ones. Growth past ~130 lines signals craft law is leaking in. (Spec §4c.)
- **Never `git add -A / --all / .`** — a live PreToolUse hook blocks it. Stage explicit paths.
- **Dates absolute** (`YYYY-MM-DD`). Today = `2026-07-14`.
- **Branch:** `feat/operating-law` (already created off `master`).
- **Run Python as `py -3`** (Windows).
- **CLAUDE.md is contended** — another terminal is actively editing it. Tasks 2 and 6 touch it; re-read it immediately before editing and keep diffs surgical.

**Deviation from spec §10:** the `@import` (spec step 4) is pulled forward to **Task 2**, directly after the law exists. It is a one-line, low-conflict change and it is what delivers the stated goal; there is no reason to defer it behind the memory sort. Conflict-risk ordering is otherwise preserved — the CLAUDE.md shrink stays last but one.

---

## File Structure

| File | Responsibility |
|---|---|
| `knowledge/operating-law.md` | **new** — the single source of process law. Clauses A–H. |
| `CLAUDE.md` | router. Gains one `@import` line (Task 2); loses rules 1–6 and the 264-line status block (Task 6). |
| `docs/handoffs/STATUS.md` | **new** — rolling project status. Receives CLAUDE.md's status block. |
| `.claude/hooks/block_git_add_all.py` | **moved** from `.claude/skills/channel-forge/scripts/` — universal rule, repo-level home. |
| `.claude/hooks/inject_law_on_compact.py` | **new** — SessionStart hook, re-injects the law after compaction. |
| `.claude/hooks/test_hooks.py` | **new** — tests for both hooks. The existing hook has none. |
| `.claude/settings.json` | hook registration — path update + SessionStart entry. |
| `.claude/skills/channel-forge/references/enforcement-contract.md` | shrinks to a pointer + walk mechanics only (Task 7). |
| `~/.claude/projects/C--Users-danie-faceless-youtube/memory/` | pruned 27 → 6 (Tasks 3–4). |

---

## Reference: the memory sort

Established in spec §5. **Pile 1 → the law. Pile 2 → skill docs. Pile 3 → stays.**

**Pile 1 — process law (12).** Four are *already stated* in the contract and are verify-and-delete only:

| Memory | Destination clause | Status |
|---|---|---|
| `present-options-not-one-answer` | E ("Present options for taste/design calls") | already covered — verify + delete |
| `surface-progress-mind-agent-latency` | B ("Surface progress on long async work") | already covered — verify + delete |
| `feedback-is-a-learning-system` | G (whole clause) | already covered — verify + delete |
| `parallel-terminals-stage-explicit-paths` | F ("never `git add -A`") | already covered — verify + delete |
| `push-back-dont-yes-man` | E | fold in |
| `skills-do-the-work` | B | fold in |
| `keep-docs-structured` | F | fold in |
| `fix-generation-not-prohibitions` | B | fold in — **load-bearing; see §7 of spec** |
| `stay-on-the-agreed-task` | C + D | fold in |
| `parallelize-and-preserve-depth` | C | fold in |
| `derived-fields-not-generation-targets` | B | fold in |
| `agents-write-early-survive-limits` | F | fold in |

**Pile 2 — craft law (9) → the doc that owns the craft:**

| Memory | Destination |
|---|---|
| `camera-locked-by-default` | `channels/the-second-take/visual-kit/visual-grammar.md` |
| `exact-style-image-gen` | `channels/the-second-take/visual-kit/style-bible.md` |
| `verify-image-changes-with-a-diff` | `channels/the-second-take/visual-kit/style-bible.md` |
| `rig-gate-approved-not-idealized` | `channels/the-second-take/visual-kit/style-bible.md` |
| `dont-self-certify-finger-counts` | `channels/the-second-take/visual-kit/style-bible.md` |
| `be-critically-honest-on-visuals` | `.claude/skills/image-generation/SKILL.md` |
| `log-generation-reasoning` | `.claude/skills/image-generation/SKILL.md` |
| `audio-taste-is-human-judged` | `.claude/skills/audio-director/SKILL.md` |
| `prefer-layered-shared-base` | `.claude/skills/motion-planner/references/animation-rules.md` |

**Pile 3 — stays in memory (6):** `review-images-via-artifact-link`, `review-video-in-device-player`, `open-review-files-in-vscode`, `artifact-image-galleries`, `voice-auditions-artifact`, `yt-dlp-channel-top-videos`.

---

### Task 1: Author `knowledge/operating-law.md`

**Files:**
- Create: `knowledge/operating-law.md`
- Read (sources): `.claude/skills/channel-forge/references/enforcement-contract.md`, `CLAUDE.md:280-301`, the 8 pile-1 "fold in" memory files
- Verify: fresh-eyes critic subagent

**Interfaces:**
- Produces: `knowledge/operating-law.md` with clause headings `## A.` … `## H.` — Task 2 imports it, Task 3 verifies against it, Task 7 points at it.

- [ ] **Step 1: Read every source**

```bash
cd C:/Users/danie/faceless-youtube-channel-forge
cat .claude/skills/channel-forge/references/enforcement-contract.md
sed -n '280,301p' CLAUDE.md
cd C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory
cat push-back-dont-yes-man.md skills-do-the-work.md keep-docs-structured.md \
    fix-generation-not-prohibitions.md stay-on-the-agreed-task.md \
    parallelize-and-preserve-depth.md derived-fields-not-generation-targets.md \
    agents-write-early-survive-limits.md
```

- [ ] **Step 2: Write the law**

Copy the contract to `knowledge/operating-law.md`, then make exactly these changes:

1. **Replace the channel-forge preamble** (everything between the title and `## A.`) with:

```markdown
# Operating Law — how we work in this repo

**Binding on every terminal, every skill, and every subagent working in `faceless-youtube`.** Not
advisory. Loaded automatically into every session (`@`-imported by `CLAUDE.md`); re-injected after
compaction. It changes only via clause G, with human confirmation.

**What this is not:** business/policy law (that is `knowledge/playbook.md` — originality bar, excluded
formats, compliance, quota). Craft law (how to generate an image, place a sound) lives in the skill or
channel doc that owns that craft. This doc is *how to work*, nothing else.

**Grammar of a clause:** each clause is written to be *enforceable* — a structural gate, a
brief-injection, or a hook — not vague advice. "Be thorough" is not a clause; "don't fire a generative
step until its upstream input is validated" is. Where a clause cannot be mechanically checked, it is
still binding and still self-checked — see clause B on why self-checked rules are a floor, not a
guarantee.

**Reach:** subagent inheritance of this file is undocumented and MUST NOT be relied on. Any agent
dispatched to do work receives its governing clauses **injected into its brief**.
```

2. **Add to clause C** (right-size), folding in `stay-on-the-agreed-task` + `parallelize-and-preserve-depth`:

```markdown
- **Execute the agreed step.** Don't drift into adjacent work that wasn't asked for, and don't widen
  scope mid-task. If the work reveals a different job needs doing, say so and let the human re-aim.
- **Parallel is for breadth, never for depth.** Probe a capability once, then fan out agents to cover
  independent ground — but never trade analysis depth for wall-clock.
```

3. **Add to clause B** (right tool), folding in `skills-do-the-work` + `fix-generation-not-prohibitions` + `derived-fields-not-generation-targets`:

```markdown
- **Run the work through the skill; fix the skill, not the artifact.** When output is wrong, the defect
  is in the generator. Repairing the one file leaves the generator broken.
- **A taste/quality defect in a generative skill is not fixed by more rules.** Prohibitions self-checked
  by the same model share its blind spot — this cost the project a full scriptwriter rebuild. The fix is
  a **gold exemplar** plus a **fresh-eyes critic** in a separate context. This applies to *this document
  too*: prose law is a floor, not a guarantee.
- **Derived fields are never generation targets.** QA/coverage metadata must be derived from the
  artifact after the fact; it must never change how the generator conceives its unit of work.
```

4. **Add to clause E** (don't yes-man), folding in `push-back-dont-yes-man`:

```markdown
- **Narrow the scope throughout.** Surfacing a problem early beats delivering agreeable work late.
```

5. **Add to clause F** (files/git), folding in `keep-docs-structured` + `agents-write-early-survive-limits`:

```markdown
- **Logs append; docs integrate.** `knowledge/decisions.md` and `docs/handoffs/` are **logs** — append
  a dated entry. Everything else is a **doc** — integrate the change into the right section and delete
  what it supersedes. This is the whole of the old rule-3/rule-6 apparent conflict.
- **Long-running agents write findings to disk incrementally**, not only in a final message — a dead
  agent's unwritten analysis is lost, and the limit pool is shared across terminals.
```

6. **Add to clause A** (orient), folding in CLAUDE.md rules 2 and 4 which have no clause home:

```markdown
- **Self-maintain.** When work reveals that a doc, the file map, or the dashboard no longer matches
  reality, fix it without being asked, and log it in `decisions.md`. When `knowledge/` or project status
  changes materially, update `index.html` and bump its date.
```

7. **Delete** the contract's `## Usage grammar` section (channel-forge-specific; replaced by the new preamble).

- [ ] **Step 3: Verify with a fresh-eyes critic — the real test**

This replaces a unit test. The author cannot certify their own coverage.

Dispatch a subagent with this exact brief:

```
You are a fresh-eyes coverage critic. Read these SOURCE docs:
1. C:/Users/danie/faceless-youtube-channel-forge/.claude/skills/channel-forge/references/enforcement-contract.md
2. C:/Users/danie/faceless-youtube-channel-forge/CLAUDE.md lines 280-301 (the "How to work here" rules)
3. These memory files in C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory/ :
   push-back-dont-yes-man.md, skills-do-the-work.md, keep-docs-structured.md,
   fix-generation-not-prohibitions.md, stay-on-the-agreed-task.md,
   parallelize-and-preserve-depth.md, derived-fields-not-generation-targets.md,
   agents-write-early-survive-limits.md, present-options-not-one-answer.md,
   surface-progress-mind-agent-latency.md, feedback-is-a-learning-system.md,
   parallel-terminals-stage-explicit-paths.md

Then read the DESTINATION: C:/Users/danie/faceless-youtube-channel-forge/knowledge/operating-law.md

Your ONE job: name every distinct learning present in a SOURCE that is ABSENT or WEAKENED in the
DESTINATION. Quote the source line and say what was lost. Be adversarial — assume things were
dropped. Do not praise. Do not summarize. If nothing was lost, say exactly "NOTHING LOST".

Also flag the reverse: anything in the DESTINATION that is craft law (how to generate an image,
place a sound, hold a rig) rather than process law — that belongs in a skill doc, not here.
```

Expected on first run: a list of gaps. This is normal.

- [ ] **Step 4: Fix every gap the critic named, then re-run the critic**

Repeat Step 3 until the critic returns `NOTHING LOST`. Do not proceed otherwise.

- [ ] **Step 5: Check the size budget**

Run: `wc -l knowledge/operating-law.md`
Expected: **≤130**. If over, craft law has leaked in — re-read the critic's reverse-flag and move it out.

- [ ] **Step 6: Commit**

```bash
git add knowledge/operating-law.md
git commit -m "feat(law): operating-law.md — one source of process law

Clauses A-H promoted from the channel-forge Enforcement Contract (already
universal; only the label was channel-forge's), absorbing CLAUDE.md rules 1-6
and the process-law memories. Fresh-eyes critic verified no learning lost.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire the `@import` — the law goes ambient

**Files:**
- Modify: `CLAUDE.md` (add one line)

**Interfaces:**
- Consumes: `knowledge/operating-law.md` from Task 1.
- Produces: the law in every session's context at launch.

- [ ] **Step 1: Re-read CLAUDE.md's head — it is contended**

Run: `sed -n '1,15p' CLAUDE.md`
Another terminal may have changed it since Task 1. Keep the diff to one line.

- [ ] **Step 2: Add the import directly under the intro paragraph (after line 7)**

The path is relative to the importing file. `CLAUDE.md` is at repo root, so:

```markdown
**The operating law is binding and loaded with this file:**

@knowledge/operating-law.md
```

Placement matters: it must be **above** the 264-line status block so the law is not buried behind it.

- [ ] **Step 3: Verify the import resolves**

Run:
```bash
grep -n "@knowledge/operating-law.md" CLAUDE.md && test -f knowledge/operating-law.md && echo "IMPORT TARGET OK"
```
Expected: the grep hit plus `IMPORT TARGET OK`.

Note: the directive must NOT be inside a code fence or backticks — those are skipped by the importer. Confirm the line above is bare markdown.

- [ ] **Step 4: Prove it loads in a real fresh session — HUMAN GATE**

This cannot be self-tested; the current session already has the law in context from Task 1.

Ask Daniel to open a **new terminal** in `C:/Users/danie/faceless-youtube-channel-forge` and ask it:
> "Without reading any files, quote clause D of the operating law."

Expected: it quotes the validate-before-effort clause from context, with no file reads.
If it reads a file first or doesn't know: the import is not loading. **Stop and diagnose before Task 3.**

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "feat(law): @import operating-law into CLAUDE.md — ambient in every session

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Prune pile 1 from memory

**Files:**
- Delete: 12 files in `C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory/`
- Modify: `MEMORY.md` (same dir) — remove their index lines

**Interfaces:**
- Consumes: `knowledge/operating-law.md`, critic-verified complete (Task 1).

- [ ] **Step 1: Gate on Task 1's critic**

Do not start until Task 1's critic returned `NOTHING LOST`. That verdict **is** the permission to delete. Copy → verify → delete; never move-and-hope.

- [ ] **Step 2: Delete the 12 pile-1 files**

```bash
cd C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory
rm push-back-dont-yes-man.md skills-do-the-work.md keep-docs-structured.md \
   fix-generation-not-prohibitions.md stay-on-the-agreed-task.md \
   parallelize-and-preserve-depth.md derived-fields-not-generation-targets.md \
   agents-write-early-survive-limits.md present-options-not-one-answer.md \
   surface-progress-mind-agent-latency.md feedback-is-a-learning-system.md \
   parallel-terminals-stage-explicit-paths.md
```

- [ ] **Step 3: Remove their 12 lines from `MEMORY.md`**

Edit `MEMORY.md`, deleting exactly the bullet lines whose link targets are the 12 filenames above. Leave the remaining lines untouched.

- [ ] **Step 4: Verify the sort adds up**

Run:
```bash
cd C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory
echo "files (excl index): $(ls *.md | grep -vc '^MEMORY.md$')"
echo "index lines: $(grep -c '^- \[' MEMORY.md)"
```
Expected: `files: 15` and `index lines: 15` (27 − 12). The two numbers **must match** — a mismatch means a dangling index line or an orphaned file.

- [ ] **Step 5: Commit (repo side is unchanged; memory is machine-local and not in git)**

No commit. Note in the task log that memory is not version-controlled — this deletion is irreversible, which is exactly why Step 1's gate exists.

---

### Task 4: Route pile 2 (craft law) to the skill docs that own it

**Files:**
- Modify: `channels/the-second-take/visual-kit/visual-grammar.md`, `channels/the-second-take/visual-kit/style-bible.md`, `.claude/skills/image-generation/SKILL.md`, `.claude/skills/audio-director/SKILL.md`, `.claude/skills/motion-planner/references/animation-rules.md`
- Delete: 9 memory files

**Interfaces:**
- Consumes: nothing from prior tasks. Independent of Tasks 1–3.

- [ ] **Step 1: Read the 9 pile-2 memory files**

```bash
cd C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory
cat camera-locked-by-default.md exact-style-image-gen.md verify-image-changes-with-a-diff.md \
    rig-gate-approved-not-idealized.md dont-self-certify-finger-counts.md \
    be-critically-honest-on-visuals.md log-generation-reasoning.md \
    audio-taste-is-human-judged.md prefer-layered-shared-base.md
```

- [ ] **Step 2: For each, check whether the destination already says it**

Several likely already exist in the destination doc (e.g. the 4-digit hand rule is already in `style-bible.md §2c`; camera-locked is already in `visual-grammar.md §4`). Run, per memory:

```bash
grep -rin "4 digit\|four digit\|finger" channels/the-second-take/visual-kit/style-bible.md
grep -rin "camera\|drift\|zoom" channels/the-second-take/visual-kit/visual-grammar.md
```

If the destination already states the learning, this is **verify-and-delete** — do not duplicate it.

- [ ] **Step 3: Integrate the rest, per the routing table above**

Integrate **into the relevant existing section** — never append a dated block (clause F). Each addition states the learning generally (portable to a new channel/video), not tied to the video that taught it.

- [ ] **Step 4: Verify with a fresh-eyes critic**

Dispatch a subagent:

```
Read these 9 memory files in C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory/ :
camera-locked-by-default.md, exact-style-image-gen.md, verify-image-changes-with-a-diff.md,
rig-gate-approved-not-idealized.md, dont-self-certify-finger-counts.md,
be-critically-honest-on-visuals.md, log-generation-reasoning.md, audio-taste-is-human-judged.md,
prefer-layered-shared-base.md

For EACH, find whether its learning is now present in its destination doc:
- camera-locked-by-default -> channels/the-second-take/visual-kit/visual-grammar.md
- exact-style-image-gen, verify-image-changes-with-a-diff, rig-gate-approved-not-idealized,
  dont-self-certify-finger-counts -> channels/the-second-take/visual-kit/style-bible.md
- be-critically-honest-on-visuals, log-generation-reasoning -> .claude/skills/image-generation/SKILL.md
- audio-taste-is-human-judged -> .claude/skills/audio-director/SKILL.md
- prefer-layered-shared-base -> .claude/skills/motion-planner/references/animation-rules.md
(all under C:/Users/danie/faceless-youtube-channel-forge/)

Output one line per memory: PRESENT or MISSING: <what specifically is absent>.
Be adversarial. A vague paraphrase that loses the operative detail is MISSING, not PRESENT.
```

Expected: 9× `PRESENT`. Fix any `MISSING` and re-run.

- [ ] **Step 5: Delete the 9 files and their `MEMORY.md` index lines**

```bash
cd C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory
rm camera-locked-by-default.md exact-style-image-gen.md verify-image-changes-with-a-diff.md \
   rig-gate-approved-not-idealized.md dont-self-certify-finger-counts.md \
   be-critically-honest-on-visuals.md log-generation-reasoning.md \
   audio-taste-is-human-judged.md prefer-layered-shared-base.md
```
Then remove their 9 index lines from `MEMORY.md`.

- [ ] **Step 6: Verify final memory state**

Run:
```bash
cd C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory
ls *.md | grep -v '^MEMORY.md$'
grep -c '^- \[' MEMORY.md
```
Expected: exactly the 6 pile-3 files, and `6`.

- [ ] **Step 7: Commit the repo-side doc changes**

```bash
git add channels/the-second-take/visual-kit/visual-grammar.md \
        channels/the-second-take/visual-kit/style-bible.md \
        .claude/skills/image-generation/SKILL.md \
        .claude/skills/audio-director/SKILL.md \
        .claude/skills/motion-planner/references/animation-rules.md
git commit -m "docs(craft): absorb craft-law memories into the skill docs that own them

Craft law (rig holds, camera dials, diff-verify, audio ear-gate, layered base)
belongs in the skill/channel doc that owns the craft, not in a universal law or
an unversioned machine-local memory store. Fresh-eyes critic verified present.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Hooks — repo-level home, a test, and compaction re-inject

**Files:**
- Create: `.claude/hooks/block_git_add_all.py` (moved), `.claude/hooks/inject_law_on_compact.py`, `.claude/hooks/test_hooks.py`
- Delete: `.claude/skills/channel-forge/scripts/hook_block_git_add_all.py`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `knowledge/operating-law.md` (Task 1) — the compact hook reads it at runtime.
- Produces: two registered hooks.

- [ ] **Step 1: Write the failing test FIRST**

The existing hook has **no test** — the one piece of real enforcement in the repo is untested. Fix that before moving it.

Create `.claude/hooks/test_hooks.py`:

```python
import json
import subprocess
import sys
from pathlib import Path

HOOKS = Path(__file__).parent
BLOCK = HOOKS / "block_git_add_all.py"
INJECT = HOOKS / "inject_law_on_compact.py"


def _run(script, payload):
    return subprocess.run(
        [sys.executable, str(script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )


def test_blocks_git_add_dash_a():
    r = _run(BLOCK, {"tool_input": {"command": "git add -A"}})
    assert r.returncode == 2
    assert "BLOCKED" in r.stderr


def test_blocks_git_add_all_and_dot():
    for cmd in ("git add --all", "git add .", "git add . && git commit"):
        r = _run(BLOCK, {"tool_input": {"command": cmd}})
        assert r.returncode == 2, cmd


def test_allows_explicit_paths():
    r = _run(BLOCK, {"tool_input": {"command": "git add knowledge/operating-law.md"}})
    assert r.returncode == 0


def test_allows_unrelated_command():
    r = _run(BLOCK, {"tool_input": {"command": "ls -la"}})
    assert r.returncode == 0


def test_never_blocks_on_bad_json():
    r = subprocess.run(
        [sys.executable, str(BLOCK)], input="not json", capture_output=True, text=True
    )
    assert r.returncode == 0


def test_inject_emits_law_on_compact():
    r = _run(INJECT, {"source": "compact"})
    assert r.returncode == 0
    assert "Operating Law" in r.stdout


def test_inject_silent_on_startup():
    # @import already loads the law at launch; re-emitting would duplicate it.
    r = _run(INJECT, {"source": "startup"})
    assert r.returncode == 0
    assert r.stdout.strip() == ""
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd .claude/hooks && py -3 -m pytest test_hooks.py -q`
Expected: FAIL — the files don't exist yet.

- [ ] **Step 3: Move the block hook (content unchanged)**

```bash
cd C:/Users/danie/faceless-youtube-channel-forge
git mv .claude/skills/channel-forge/scripts/hook_block_git_add_all.py .claude/hooks/block_git_add_all.py
```

- [ ] **Step 4: Write the compaction re-inject hook**

Create `.claude/hooks/inject_law_on_compact.py`:

```python
"""SessionStart hook: re-inject the operating law after compaction.

Context does not decay on a clock, so there is no timer here. The ONE real decay mode is
compaction, which can drop the @import'd law out of context on a long session. This fires
only on `compact` — on `startup` the @import in CLAUDE.md already loads the law, and
emitting it again would just duplicate it.

stdout on exit 0 is added to the model's context.
"""
import json
import sys
from pathlib import Path

LAW = Path(__file__).resolve().parents[2] / "knowledge" / "operating-law.md"


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never disrupt a session on a parse error
    if data.get("source") != "compact":
        sys.exit(0)
    try:
        print(LAW.read_text(encoding="utf-8"))
    except OSError:
        pass  # law missing is not worth killing the session over
    sys.exit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd .claude/hooks && py -3 -m pytest test_hooks.py -q`
Expected: `7 passed`

- [ ] **Step 6: Update `.claude/settings.json`**

Change the PreToolUse command path and add the SessionStart entry. The `hooks` block becomes:

```json
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "py -3 .claude/hooks/block_git_add_all.py"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "py -3 .claude/hooks/inject_law_on_compact.py"
          }
        ]
      }
    ]
  }
```

- [ ] **Step 7: Verify the moved hook is still live end-to-end**

Run: `git add -A`
Expected: **blocked**, with the `BLOCKED: never git add -A ...` message. If it is not blocked, the settings path is wrong — fix before committing.

- [ ] **Step 8: Commit**

```bash
git add .claude/hooks/block_git_add_all.py .claude/hooks/inject_law_on_compact.py \
        .claude/hooks/test_hooks.py .claude/settings.json
git commit -m "feat(hooks): repo-level hooks dir, first tests, compaction law re-inject

The git-add trap was owned by channel-forge despite being a universal rule, and
had no test. Moves it to .claude/hooks/ and covers it. Adds a SessionStart hook
that re-injects the law after compaction - the only real context-decay mode.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Shrink CLAUDE.md to a router — HIGHEST CONFLICT

**Files:**
- Create: `docs/handoffs/STATUS.md`
- Modify: `CLAUDE.md` (remove lines 16–279 status block, remove rules 1–6)

**Interfaces:**
- Consumes: `knowledge/operating-law.md` (holds the rules now), the `@import` (Task 2).

- [ ] **Step 1: HUMAN GATE — confirm no other terminal is in CLAUDE.md**

Another terminal was actively editing it as of 2026-07-14; the last channel-forge handoff deferred a CLAUDE.md edit for this reason. **Ask Daniel to confirm other sessions are idle before touching it.** Then:

```bash
git -C C:/Users/danie/faceless-youtube status --short CLAUDE.md
```
Expected: clean. If dirty, stop — coordinate first.

- [ ] **Step 2: Move the status block to `docs/handoffs/STATUS.md`**

Create `docs/handoffs/STATUS.md`:

```markdown
# Project status — rolling

> The live state of the project. A fresh terminal reads this to know where things are.
> This is a **log**: append dated entries; do not integrate-in-place (clause F).
> Superseded detail belongs in `knowledge/decisions.md`; resume state belongs in a dated pickup handoff.

<!-- moved verbatim from CLAUDE.md 2026-07-14: the file is a router, not a changelog -->
```

Append CLAUDE.md's lines 16–279 **verbatim** below it — every line, unedited. Do not summarize during the move; losing content in a move is the failure mode this plan exists to prevent.

- [ ] **Step 3: Delete the status block and rules from CLAUDE.md**

- Delete lines 16–279 (`## Current status` through the line before `## How to work here`).
- Delete lines 280–301 (`## How to work here (operating rules)` and rules 1–6) — now in `knowledge/operating-law.md`.
- In their place, under `## What this is`, add:

```markdown
## Where things stand

Live project status: `docs/handoffs/STATUS.md`. Decisions + rationale: `knowledge/decisions.md`.
Resume state for in-flight work: the newest file in `docs/handoffs/`.

## How to work here

The operating law is imported above and is binding. Business/policy law: `knowledge/playbook.md`.
```

- [ ] **Step 4: Verify nothing was lost**

Run:
```bash
git show HEAD:CLAUDE.md | sed -n '16,279p' > /tmp/old-status.txt
diff <(sed -n '16,279p' /tmp/old-status.txt) <(grep -A100000 "moved verbatim" docs/handoffs/STATUS.md | tail -n +2) && echo "STATUS BLOCK INTACT"
```
Expected: `STATUS BLOCK INTACT`. Any diff means content was dropped in the move — fix before committing.

- [ ] **Step 5: Check the size budget**

Run: `wc -l CLAUDE.md`
Expected: **≈110–130** (down from 396). Spec §8 targets ambient context ≤400 lines total: ~120 router + ~110 law.

- [ ] **Step 6: Retitle `playbook.md` to clear the name collision**

In `knowledge/playbook.md`, change line 1 from `# Playbook — operating rules (cross-niche)` to:

```markdown
# Playbook — business & policy law (cross-niche)
```
Its content is the originality bar, excluded formats, compliance, quota, economics — business law, not process law. "Operating rules" now belongs solely to `operating-law.md`.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/handoffs/STATUS.md knowledge/playbook.md
git commit -m "refactor(claude-md): router only - status to handoffs, rules to the law

CLAUDE.md was 67% dated status changelog, auto-loaded into every session in
every terminal forever, and was the file that drifted between worktrees. It
self-describes as 'the router'; now it is one. 396 -> ~120 lines.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Point the channel-forge contract at the law

**Files:**
- Modify: `.claude/skills/channel-forge/references/enforcement-contract.md`
- Modify: `.claude/skills/channel-forge/SKILL.md:13` (the "Read `references/enforcement-contract.md` NOW" line)

**Interfaces:**
- Consumes: `knowledge/operating-law.md`.

- [ ] **Step 1: Replace the contract's clause body with a pointer**

`enforcement-contract.md` becomes:

```markdown
# channel-forge — Enforcement Contract

**The process law lives at `knowledge/operating-law.md`** — repo-level, binding on every terminal,
`@`-imported into every session. It is NOT restated here; a second copy would drift (clause F).

This file holds only what is specific to the channel-forge **walk**:

## Walk mechanics
- **Context read** before Stage 0 completes (law clause A).
- **Upstream validated** before any generative step (law clause D).
- **Critic / converge pass ran** before presenting (law clause E).
- **Workspace pruned** on every stage lock (law clause F).
- **Human approval** recorded before every lock (law clause H).
- **Stage briefs carry their governing clauses**, quoted from the law — subagent inheritance is not
  relied upon.

## Deferred (not yet active)
- **Compliance & business safety** — every new channel born compliant: materially differentiated from
  rivals, licensed assets only, AI-disclosure where required, the audit / human-publish gate intact.
  Deferred while the project is at Stage-0 full-human-publish-gate; **add before autonomy advances.**
```

- [ ] **Step 2: Update the SKILL.md reference**

In `.claude/skills/channel-forge/SKILL.md`, change the "Binding law (read first)" section to:

```markdown
## Binding law (read first — Stage 0 requires it)
The process law is `knowledge/operating-law.md`, already loaded in your context. It is binding. You
enforce its checkable clauses as gates: context-first (A), right-tool + self-application (B),
right-size (C), validate-before-effort (D), converge-then-present (E), clean-as-a-verb (F), and human
final say (H). Walk-specific mechanics: `references/enforcement-contract.md`.
```

- [ ] **Step 3: Verify channel-forge's tests still pass**

Run: `cd .claude/skills/channel-forge/scripts && py -3 -m pytest -q`
Expected: `36 passed`

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/channel-forge/references/enforcement-contract.md .claude/skills/channel-forge/SKILL.md
git commit -m "refactor(channel-forge): contract points at the repo law, keeps walk mechanics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Prove it — the success test

**Files:**
- Modify: `knowledge/decisions.md` (append the dated entry)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Measure the before/after**

Run:
```bash
cd C:/Users/danie/faceless-youtube-channel-forge
echo "CLAUDE.md:  $(wc -l < CLAUDE.md)  (was 396)"
echo "law:        $(wc -l < knowledge/operating-law.md)"
echo "memory:     $(ls C:/Users/danie/.claude/projects/C--Users-danie-faceless-youtube/memory/*.md | grep -vc MEMORY.md)  (was 27)"
```
Expected: CLAUDE.md ≈120, law ≤130, memory 6. Ambient total ≤400 lines (spec §8).

- [ ] **Step 2: Verify single-sourcing**

Run:
```bash
grep -rln "Integrate, don't append\|integrate-don't-append" --include="*.md" . | grep -v docs/superpowers
```
Expected: **exactly one** file — `knowledge/operating-law.md`. More than one means the duplication survived.

- [ ] **Step 3: The real test — HUMAN GATE**

Spec §8: *a fresh terminal, given a real task, visibly follows a clause it would previously have missed — without being told to.*

Ask Daniel to open a fresh terminal and give it a real piece of pipeline work (e.g. the parked Poyais image-gen props gate). Watch for whether it, unprompted:
- orients before acting (reads the handoff/status first — clause A)
- validates upstream before spending generation tokens (clause D)
- presents options rather than one pre-picked answer (clause E)

**Daniel judges.** This is the acceptance gate; nothing below proceeds without it.

- [ ] **Step 4: Log the decision**

Append to `knowledge/decisions.md` (it is a log — append, per clause F):

```markdown
## 2026-07-14 — Operating law: the Enforcement Contract promoted to repo law

Process law was smeared across three docs (CLAUDE.md rules 21 lines, the channel-forge Enforcement
Contract 110, ~12 memory files) with no declared winner, and drowned by a 264-line status changelog
auto-loaded into every session. Terminals were not working from our accumulated learnings.

**Decided:** clauses A-H — already universal; only the label was channel-forge's — become
`knowledge/operating-law.md`, `@import`ed by CLAUDE.md so every terminal loads it with zero
invocation. One axis per doc: law = how to work; playbook = what we're allowed to do; CLAUDE.md =
router; decisions/handoffs = logs; skill docs = craft law; memory = Daniel only (27 -> 6).
Logs append, docs integrate — this dissolves the old rule-3/rule-6 contradiction.

**Rejected:** merging into CLAUDE.md (bloats the router; no clean subset to inject into subagent
briefs); a law skill (opt-in — a law you can forget to invoke is not a law); re-reading on a timer
(context does not decay on a clock; compaction is the only real decay mode, and a SessionStart
`compact` hook targets it exactly); folding craft law into the law (would bloat it to ~300 lines and
re-create the dilution being fixed — it went to the skill docs instead).

**Honest ceiling:** `fix-generation-not-prohibitions` says self-checked prose rules share the model's
blind spot. The law is prose. It is a floor, not a guarantee — the cleanup is what makes it bind, and
mechanism (hooks, critics) follows evidence of real violations, not theory.
```

- [ ] **Step 5: Commit**

```bash
git add knowledge/decisions.md
git commit -m "docs(decisions): log the operating-law promotion + what was rejected

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 one axis per doc | 1, 4, 6 (playbook retitle: 6 step 6) |
| §4 law file: location, structure, brevity | 1 (steps 2, 5) |
| §5 memory sort — pile 1 / 2 / 3 | 3, 4 |
| §6 mechanism: `@import` | 2 |
| §6 mechanism: compact re-inject | 5 |
| §6 mechanism: hooks, repo-level | 5 |
| §6 mechanism: brief injection | 7 (step 1, walk mechanics) + law preamble (1 step 2) |
| §6 deferred critic | intentionally not built — evidence first (§6d) |
| §7 honest ceiling | 1 step 2 (clause B fold-in); 8 step 4 (logged) |
| §8 success test | 8 |
| §9.1 pile-2 placement | 4 (skill docs, per the design's recommendation) |
| §9.2 law name / playbook retitle | 1, 6 |
| §9.3 status destination | 6 (rolling `STATUS.md`) |
| §10 sequencing | task order; `@import` pulled forward, noted in Global Constraints |

No gaps.

**Placeholder scan:** none. Every doc edit shows its exact text; every critic shows its exact brief; every command shows expected output.

**Type consistency:** `block_git_add_all.py` and `inject_law_on_compact.py` are named identically in Task 5's test, implementation, `settings.json`, and file structure table. `knowledge/operating-law.md` is identical across Tasks 1, 2, 5, 7, 8. Clause letters A–H are consistent throughout.

**Known risk:** Task 3 deletes machine-local, unversioned, unrecoverable memory files. Its Step 1 gate (Task 1's critic returning `NOTHING LOST`) is the only thing standing between this plan and permanent loss of a learning. Do not soften it.

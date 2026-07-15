# `audio-cue-writer` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `audio-cue-writer` skill — it reads a scripted + storyboarded video and PROPOSES its `audio-cues.json` (the content-nuanced audio layer), tightened by a fresh-eyes critic and guarded by a mechanical lint, so Phase-2b runs without hand-authoring cues per video.

**Architecture:** A new niche-agnostic skill that runs after `visual-prompt-writer` (∥ `voiceover`). It DRAFTs cues grounded in `shots.json` `beat_type` + a script scan, a dispatched fresh-context critic tightens for restraint/role/sync/withhold, and a mechanical lint (`lint_audio_cues.py`, reusing render's ONE `vo_ref` matcher) HARD-fails unresolvable/invalid cues before the file ships. The 2b render mechanism already consumes `audio-cues.json`; this plan adds no schema and no engine code.

**Tech Stack:** Python 3.13 (`py -3`), plain-`assert` tests (repo convention). The skill body is a markdown SKILL.md + a critic reference; the only executable is the lint.

## Global Constraints

- **G1 — One matcher.** The lint resolves anchors via `render.match_shots_to_tokens` + `_NORM` (the SAME cursor-advancing first-4-word matcher render times against). No second matcher.
- **G2 — Timid by default.** The author under-proposes: fewer SFX, *not none, not everywhere*; a whole section with no cue is a valid, common answer. The correct failure direction is too few, not too many.
- **G3 — Grounded in `beat_type`.** The draft walks `shots.json`, mapping `beat_type` → cue intent (number-reveal→punch · aside→optional sting · gravity/dialogue→WITHHOLD) + a script scan (money→cash · deflate→womp · pivot→scratch `in_pause`). Not free-guessed.
- **G4 — Placement, not mix.** The author sets `anchor` + `role` + `in_pause?` + a sensible `pause_s`; it leaves `gain_db` at the role default unless there's a clear reason. Levels/feel are the human's ear-tune.
- **G5 — Positive/structural, fresh-eyes.** Author + critic docs say what GOOD looks like and name concrete defects to catch — not a wall of "don't" rules. The critic is a dispatched FRESH-CONTEXT subagent, not a self-check ([[fix-generation-not-prohibitions]]).
- **G6 — Integrate-don't-append + cross-file consistency.** Doc edits go into the right section, superseding stale text; the skill-count, skill list, and pipeline routing must AGREE wherever they appear (README + CLAUDE.md), updated together. SKILL.md POINTS to `audio-cues-schema.md` for field semantics — it does not copy them (a copy drifts).
- **G7 — Derived, not authored.** The lint is mechanical; its checks never become authoring pressure that changes how the author conceives a cue ([[derived-fields-not-generation-targets]]).
- **G8 — Skills do the work.** `audio-cues.json` is produced by the skill; the hand-authored `_chain-test` file stays a fixture / gold exemplar only ([[skills-do-the-work]]).
- **G9 — Explicit-path commits on `master`.** Parallel terminals share this tree — stage exact paths, never `git add -A`, never rewrite history ([[parallel-terminals-stage-explicit-paths]]).

## File Structure

- Create `.claude/skills/audio-cue-writer/scripts/lint_audio_cues.py` — the mechanical gate (reuses render's matcher).
- Create `.claude/skills/audio-cue-writer/scripts/test_lint_audio_cues.py` — hermetic tests.
- Create `.claude/skills/audio-cue-writer/SKILL.md` — orchestration: inputs · grounded-draft → critic → revise → lint flow · timid principle · the annotated gold exemplar · scope boundaries. Points to the schema doc.
- Create `.claude/skills/audio-cue-writer/references/critics.md` — the fresh-eyes critic rubric (the five checks, positive framing).
- Modify `.claude/skills/README.md` — add the skill to the roster (same wording as CLAUDE.md).
- Modify `CLAUDE.md` — bump the "Skills built" count + add a pipeline/routing mention (cross-file-consistent with README).
- Modify `knowledge/decisions.md` + `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md` — status (Task 5).

---

## Task 1: `lint_audio_cues.py` — the mechanical gate (TDD)

**Files:** Create `.claude/skills/audio-cue-writer/scripts/lint_audio_cues.py`, `.claude/skills/audio-cue-writer/scripts/test_lint_audio_cues.py`

**Interfaces:**
- Produces: `script_tokens(shots) -> list[(norm_word, index)]` (the VO word-stream reconstructed from shots' verbatim `vo_text`, fallback `vo_ref`, in narration order) · `lint_cues(cues, shots, tokens) -> list[str]` (human-readable errors; `[]` = clean) · a `main(video_dir)` CLI.

- [ ] **Step 1: Write the failing test** `test_lint_audio_cues.py`:
```python
import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from lint_audio_cues import lint_cues

SHOTS = [{"id": "L1", "vo_text": "In 1822 a few people sailed."},
         {"id": "L2", "vo_text": "The whole thing was made up."},
         {"id": "L3", "vo_text": "Eight million acres of it."}]
TOK = {"sfx_pools": {"cash": ["cash-1"], "boom": ["boom-1", "boom-2"], "record_scratch": ["record_scratch-1"]}}

def test_valid_cues_pass():
    cues = [{"anchor": "The whole thing was", "role": "boom"},
            {"anchor": "Eight million acres", "role": "cash"}]
    assert lint_cues(cues, SHOTS, TOK) == [], lint_cues(cues, SHOTS, TOK)

def test_unresolved_anchor_fails():
    e = lint_cues([{"anchor": "no such phrase here", "role": "cash"}], SHOTS, TOK)
    assert any("did not resolve" in x for x in e), e

def test_bad_role_fails():
    e = lint_cues([{"anchor": "Eight million acres", "role": "kazoo"}], SHOTS, TOK)
    assert any("not in sfx_pools" in x for x in e), e

def test_role_and_pause_both_missing_fails():
    e = lint_cues([{"anchor": "Eight million acres"}], SHOTS, TOK)
    assert any("at least one of" in x for x in e), e

def test_in_pause_needs_pause_s():
    e = lint_cues([{"anchor": "Eight million acres", "role": "record_scratch", "in_pause": True}], SHOTS, TOK)
    assert any("in_pause" in x for x in e), e

def test_out_of_order_fails():
    # both anchors resolve alone, but reversed the cursor can't reach the earlier one
    cues = [{"anchor": "Eight million acres", "role": "cash"},
            {"anchor": "The whole thing was", "role": "boom"}]
    e = lint_cues(cues, SHOTS, TOK)
    assert any("did not resolve" in x for x in e), e

print("running")
test_valid_cues_pass(); test_unresolved_anchor_fails(); test_bad_role_fails()
test_role_and_pause_both_missing_fails(); test_in_pause_needs_pause_s(); test_out_of_order_fails()
print("PASS")
```

- [ ] **Step 2: Run → FAIL** (`lint_audio_cues` not found).
Run: `py -3 .claude/skills/audio-cue-writer/scripts/test_lint_audio_cues.py`
Expected: `ModuleNotFoundError: No module named 'lint_audio_cues'`

- [ ] **Step 3: Implement `lint_audio_cues.py`:**
```python
#!/usr/bin/env python3
"""Mechanical lint for audio-cues.json (Phase 2b author guardrail). Mirrors the render's vo_ref matcher so a
cue that won't resolve at render time HARD-fails here. Derived check ONLY — no authoring semantics. Reuses the
ONE shared matcher (G1). See ../../render-builder/references/audio-cues-schema.md."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "render-builder" / "scripts"))
from render import _NORM, match_shots_to_tokens   # noqa: E402  (the ONE shared vo_ref matcher, G1)

_BRACKET = re.compile(r"\[[^\]]*\]")   # [PAUSE]/[BEAT] prosody markers are not in the spoken word-stream


def _shots_of(shots_json):
    return shots_json.get("shots") or (shots_json.get("long_form") or {}).get("shots") or []


def script_tokens(shots):
    """The VO word-stream from shots' verbatim vo_text (fallback vo_ref), in narration order, as
    [(normalized_word, index)] — the shape render feeds the matcher. Bracketed prosody cues stripped."""
    text = " ".join(_BRACKET.sub(" ", (s.get("vo_text") or s.get("vo_ref") or "")) for s in shots)
    toks = [(_NORM(w), i) for i, w in enumerate(text.split())]
    return [(w, i) for w, i in toks if w]


def lint_cues(cues, shots, tokens):
    """Return human-readable error strings ([] = clean). Field validity + anchor resolution (cursor-advancing,
    so an out-of-order or non-verbatim anchor fails to resolve)."""
    errors = []
    pools = (tokens or {}).get("sfx_pools") or {}
    for i, c in enumerate(cues):
        tag = f"cue[{i}] ({c.get('anchor')!r})"
        if not c.get("anchor"):
            errors.append(f"cue[{i}]: missing 'anchor'")
        if not c.get("role") and not c.get("pause_s"):
            errors.append(f"{tag}: needs at least one of 'role' / 'pause_s'")
        if c.get("in_pause") and not c.get("pause_s"):
            errors.append(f"{tag}: 'in_pause' requires a 'pause_s'")
        role = c.get("role")
        if role and role not in pools:
            errors.append(f"{tag}: role {role!r} not in sfx_pools")
    toks = script_tokens(shots)
    pseudo = [{"id": f"cue{i}", "vo_ref": c.get("anchor", "")} for i, c in enumerate(cues)]
    for i, m in enumerate(match_shots_to_tokens(pseudo, toks)):
        if cues[i].get("anchor") and m["start"] is None:
            errors.append(f"cue[{i}] ({cues[i]['anchor']!r}): anchor did not resolve in narration order "
                          f"(not a verbatim VO phrase, or cues out of order)")
    return errors


def main(video_dir):
    vd = Path(video_dir)
    cues = (json.loads((vd / "audio-cues.json").read_text(encoding="utf-8")).get("cues")) or []
    shots = _shots_of(json.loads((vd / "shots.json").read_text(encoding="utf-8")))
    tok_path = vd.parent.parent / "visual-kit" / "audio-tokens.json"
    tokens = json.loads(tok_path.read_text(encoding="utf-8")) if tok_path.exists() else {}
    errors = lint_cues(cues, shots, tokens)
    if errors:
        print(f"FAIL — {len(errors)} problem(s):")
        for e in errors:
            print("  -", e)
        raise SystemExit(1)
    print(f"OK — {len(cues)} cue(s) valid")


if __name__ == "__main__":
    main(sys.argv[1])
```

- [ ] **Step 4: Run → PASS.**
Run: `py -3 .claude/skills/audio-cue-writer/scripts/test_lint_audio_cues.py`
Expected: `running` / `PASS`

- [ ] **Step 5: Commit**
```bash
git add .claude/skills/audio-cue-writer/scripts/lint_audio_cues.py .claude/skills/audio-cue-writer/scripts/test_lint_audio_cues.py
git commit -m "feat(audio-cue-writer): lint_audio_cues.py — mechanical cue gate (reuses render matcher)"
```

---

## Task 2: `SKILL.md` — the skill orchestration

**Files:** Create `.claude/skills/audio-cue-writer/SKILL.md`

**Interfaces:** none (markdown). The deliverable is the skill doc that produces `videos/<slug>/audio-cues.json`.

- [ ] **Step 1: Write `SKILL.md`** with YAML frontmatter + these sections (prose, not code):
  - **Frontmatter** — `name: audio-cue-writer`; a `description:` that triggers on "author the audio cues", "propose audio-cues.json", "add sound effects to a video", "do the SFX cues", "the audio-cue step" for ANY channel with a `visual-kit/audio` setup, and states it authors PLACEMENT (the content-nuanced layer) and the human ear-gates FEEL. Explicitly says: NOT structural SFX (auto-fired by render), NOT music (Phase 3), NOT sourcing SFX files (sfx-forge).
  - **When it runs** — after `visual-prompt-writer` (needs `shots.json`), ∥ `voiceover`, before `render-builder`. Absent output = clean no-op (strictly additive).
  - **Inputs** — `script.md`, `shots.json` (`beat_type` + `vo_ref`), `dna.md` (register/comedy dial), the measured grammar `universal.md §13a-iii.8` + `audio-tokens.json` (roles + gains), and the contract **→ `render-builder/references/audio-cues-schema.md`** (POINT to it for field semantics; do NOT restate — G6).
  - **The flow** (numbered, matches the spec): (1) DRAFT grounded in `beat_type` (the intent map: number-reveal→a punch on the number (cash/boom) · aside→an optional sting · gravity/dialogue→WITHHOLD) + a script scan (money→cash · deflate→womp · hard pivot→record_scratch `in_pause`); anchor each cue to its shot's `vo_ref` opening words (sync-to-image). (2) DISPATCH the fresh-context critic (`references/critics.md`) → findings. (3) REVISE once → write `audio-cues.json`. (4) LINT: `py -3 scripts/lint_audio_cues.py <video_dir>` must print `OK` (HARD gate). (5) The human ear-gates the render.
  - **Timid by default** (G2) — state it as the governing principle: propose few, prefer to skip, a silent section is normal and good; the author owns the number-reveal punch (it's no longer automatic).
  - **Placement not mix** (G4) — set `anchor`/`role`/`in_pause?`/`pause_s`; leave `gain_db` default; the human tunes levels by ear.
  - **The gold exemplar** — embed the approved `_chain-test` cues with a one-line WHY each, INCLUDING the withhold: `boom` synced to the fiction-reveal image (anchored to the shot's `vo_ref` "The whole thing was", held before the grim turn) · `record_scratch` `in_pause` on the "So what happened" pivot · `cash` on "Eight million acres" · **and no cue on "…never came home"** (human cost → withhold). Frame as the positive target (sparse, synced, restrained).
  - **Scope boundaries** — what it does NOT author (structural SFX, music, device-cards, gain-by-feel).
- [ ] **Step 2: Verify** the doc is consistent + non-redundant:
Run: `py -3 -c "import re,sys; t=open('.claude/skills/audio-cue-writer/SKILL.md',encoding='utf-8').read(); assert t.startswith('---') and 'name: audio-cue-writer' in t, 'frontmatter'; assert 'audio-cues-schema.md' in t, 'must point to the schema contract'; assert 'gain_db' not in t.split('field semantics')[0] or 'schema' in t, 'ok'; print('SKILL ok, chars', len(t))"`
Expected: prints `SKILL ok, chars <n>` (frontmatter present + points to the schema doc). Manually confirm the field-semantics table is NOT copied from the schema (G6).
- [ ] **Step 3: Commit**
```bash
git add .claude/skills/audio-cue-writer/SKILL.md
git commit -m "feat(audio-cue-writer): SKILL.md — grounded draft -> critic -> revise -> lint; timid-by-default"
```

---

## Task 3: `references/critics.md` — the fresh-eyes critic rubric

**Files:** Create `.claude/skills/audio-cue-writer/references/critics.md`

**Interfaces:** none (markdown). Consumed by the SKILL.md flow step 2 (dispatched to a fresh-context subagent).

- [ ] **Step 1: Write `critics.md`** — the critic's job + the five checks, each phrased as *what GOOD looks like* then *the defect to flag* (positive/structural, G5). Inputs the critic reads: the drafted cues + `script.md` + the grammar + the gold exemplar. The five checks:
  1. **Restraint** — GOOD: sparse, only where content clearly warrants; a silent section is fine. FLAG: over-cueing / a cue on nearly every quippy line / density that would read as a laugh-track.
  2. **Right role** — GOOD: the role matches the content (deflation→womp, money→cash, reveal→boom/sting, hard pivot→scratch). FLAG: a role whose meaning doesn't fit (a womp on a line that isn't a deflation — the exact mistake caught by ear at the 2b gate).
  3. **Sync** — GOOD: an SFX meant to hit an image is anchored to that shot's `vo_ref` opening words. FLAG: a reveal/landing SFX anchored mid-sentence so it lands a beat off the cut.
  4. **Withhold** — GOOD: no comedic SFX on gravity / human-cost / dialogue beats. FLAG: any cue on a `beat_type: gravity`/`dialogue` shot.
  5. **No redundancy with 2a** — GOOD: the file authors only content-nuanced hits. FLAG: a cue duplicating a structural SFX render already auto-fires (scene→whoosh, chapter→boom, delta→pop, text→tick).
  - **Output format** — a short findings list (cue index + which check + the fix), consumed by the author's single revise pass. State the critic returns "no changes" cleanly when the draft is already good.
- [ ] **Step 2: Verify** the rubric covers all five checks:
Run: `py -3 -c "t=open('.claude/skills/audio-cue-writer/references/critics.md',encoding='utf-8').read().lower(); [print(k, k in t) for k in ['restraint','role','sync','withhold','redundan']]; assert all(k in t for k in ['restraint','role','sync','withhold','redundan'])"`
Expected: each check prints `True`.
- [ ] **Step 3: Commit**
```bash
git add .claude/skills/audio-cue-writer/references/critics.md
git commit -m "feat(audio-cue-writer): critics.md — fresh-eyes rubric (restraint/role/sync/withhold/2a-redundancy)"
```

---

## Task 4: Register the skill (cross-file consistency)

**Files:** Modify `.claude/skills/README.md`, `CLAUDE.md`

- [ ] **Step 1: Read** the current roster to get the exact count + format.
Run: `grep -n "Skills built\|audio-analyzer\|sfx-forge" CLAUDE.md; grep -rn "sfx-forge\|audio-analyzer" .claude/skills/README.md`
- [ ] **Step 2: Add to `.claude/skills/README.md`** — one roster entry for `audio-cue-writer` in the same format as its neighbors (`sfx-forge`, `audio-analyzer`): one line on what it does (authors the content-nuanced `audio-cues.json`; grounded in `beat_type`; timid; human ear-gates), niche-agnostic. Integrate into the existing list section (G6), do not append a stray block.
- [ ] **Step 3: Update `CLAUDE.md`** consistently (G6 cross-file): bump the "Skills built (N)" count by one and add `audio-cue-writer` to that inline list with a one-clause description; add a pipeline mention in the audio bullet (the 2b fast-follow is now BUILT: `audio-cue-writer` authors cues → critic → lint) — EDIT the existing audio bullet in place (the "NEXT = the 2b fast-follow" clause becomes "DONE"), do not append.
- [ ] **Step 4: Verify cross-file consistency** — the skill name appears in both, and the CLAUDE.md count matches the roster length:
Run: `grep -c "audio-cue-writer" CLAUDE.md .claude/skills/README.md`
Expected: `≥1` in each file.
- [ ] **Step 5: Commit**
```bash
git add .claude/skills/README.md CLAUDE.md
git commit -m "docs(audio-cue-writer): register the skill (README + CLAUDE.md, consistent count + routing)"
```

---

## Task 5: E2E dogfood + status log (human ear-gate)

**Files:** create a proposed cues file on a video with `shots.json` (untracked scratch); Modify `knowledge/decisions.md`, `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`

- [ ] **Step 1: Run the skill** on a video that has `shots.json`. Front-half batch videos are the target once they have `shots.json`; if only `_chain-test` qualifies today, dogfood there — it doubles as a reproduce-the-gold check (does the author independently land the same sparse, synced, restrained set?). Write the proposal to `videos/<slug>/audio-cues.json` (on `_chain-test`, write to `audio-cues.proposed.json` first and DIFF against the approved gold so the exemplar file is not clobbered).
- [ ] **Step 2: Lint it** — `py -3 .claude/skills/audio-cue-writer/scripts/lint_audio_cues.py <video_dir>` must print `OK` (fix any anchor that doesn't resolve). Then render: `py -3 .claude/skills/render-builder/scripts/build_motion.py <video_dir> --allow-missing`; open `assets/final.mp4` in the Windows default player ([[review-video-in-device-player]]).

> **CHECKPOINT (human — the acceptance gate):** LISTEN. Does the author land the number-reveal punch + a couple of tasteful hits, WITHHOLD on human cost, and read *sparser* than a hand pass — with no lint failures and no wrong-spot cues? Tune by ear if needed. Do NOT proceed until the user signs off. [[audio-taste-is-human-judged]]

- [ ] **Step 3: Log status.** Append a dated `decisions.md` entry (the 2b fast-follow BUILT: `audio-cue-writer` — grounded-in-`beat_type` draft → fresh-eyes critic → one revise → `lint_audio_cues.py` gate; timid-by-default; human ear-gates; dogfood result). Confirm the CLAUDE.md audio bullet + the handoff resume pointer (edited in Task 4 / here) now read "fast-follow DONE → next = Phase 3 music lane". EDIT in place (G6).
- [ ] **Step 4: Commit**
```bash
git add knowledge/decisions.md docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md
git commit -m "docs(audio-cue-writer): 2b fast-follow done + dogfooded; resume -> Phase 3 music lane"
```

---

## Self-Review (author, against the spec)

- **Spec coverage:** grounded-in-`beat_type` draft (Task 2, G3) · fresh-eyes critic (Task 3, G5) · one revise + ear-gate-only (Tasks 2+5) · mechanical lint reusing the ONE matcher (Task 1, G1/G7) · timid-by-default (Tasks 2+3, G2) · placement-not-mix (Task 2, G4) · gold exemplar w/ the withhold (Task 2) · scope boundaries (Tasks 2+3) · pipeline slot ∥ voiceover, no VO dependency (Task 1 word-stream from `vo_text`, Task 2) · cross-file-consistent registration (Task 4, G6) · e2e dogfood acceptance gate (Task 5). All spec sections map to a task.
- **Placeholder scan:** none — Task 1 ships full lint code + tests; Tasks 2–4 specify exact section content + a mechanical verify per doc; Task 5's only open variable is the dogfood target video (resolved: best-available with `shots.json`, `_chain-test` as the reproduce-the-gold fallback).
- **Type consistency:** `script_tokens`/`lint_cues`/`main` signatures match between the test and the implementation; `lint_cues(cues, shots, tokens)` argument order is identical in every call; the lint reads `shots.json.shots` + `visual-kit/audio-tokens.json.sfx_pools`, matching the confirmed file shapes.

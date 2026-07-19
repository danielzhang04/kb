# SFX Emission Phase 2a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-key the render's SFX emission off the real signals already in `shots.json` (`beat_type` + stage/entrance) instead of the dormant device-card overlays, add a synchronized full-stop inside breath gaps, and prove it by ear on `_chain-test` — no new file, no new skill, no engine change.

**Architecture:** `build_audio.py` already emits SFX but keys them to device-card overlays `build_motion` never produces (so only whoosh + tick fire). We rebuild `sfx_events` to fire structural SFX from `beat_type` (via a new data map `beat_type_sfx` in `audio-tokens.json`) + scene-change/text, keep the per-element overlay branches as *dormant* (correct trigger, no producer yet — Phase 2c), and add the full-stop to `build_audio_spec`. All deterministic; the engine's `{sfx, at_s, gain_db?}` event schema is unchanged.

**Tech Stack:** Python 3.13 (`py -3`), plain-`assert` tests (repo convention — no pytest). The render engine (Remotion/TS) is NOT touched.

## Global Constraints

- **G1 — Deterministic.** No `random`, no wall-clock in emission. Variety = per-role pool rotation by occurrence index (already present).
- **G2 — Data, not code, for tuning.** Which-SFX-per-beat_type + gains live in `audio-tokens.json` (`beat_type_sfx`, `sfx_gain_db`, `sfx_pools`), ear-tunable without touching Python.
- **G3 — Only reliable-every-instance beats auto-fire.** 2a fires SFX only where firing on *every* instance is correct (scene change, chapter-boundary, escalation-capper). Content-nuanced hits (`aside`→sting, the number-reveal punch) are **2b authored cues — NOT in this plan.**
- **G4 — Dormant ≠ dead.** The per-element overlay branches (`stat-card`/`counter`/`meter`/`progressive-reveal` → pop/riser/pluck) are the *correct* trigger for per-element SFX and have no `beat_type` equivalent; keep them, commented as dormant until Phase 2c. Remove ONLY `chapter-card`→boom (redundant now that `beat_type: chapter-boundary` owns boom).
- **G5 — Engine schema stable.** `build_audio` still emits `events: [{sfx, at_s, gain_db?}]`; `components.tsx` is not edited.
- **G6 — No dangling roles.** Every role named in `beat_type_sfx` must exist in `sfx_pools`.
- **G7 — Docs stay in sync (integrate-don't-append).** Every doc that currently describes the overlay-keyed emission (`motion-schema.md §2`, `universal.md §13a-iii.8`, `render-builder/SKILL.md`) is rewritten in the same change — no stale refs, no appended dated blocks.
- **G8 — Parallel terminals.** Stage explicit paths, never `git add -A`, never rewrite history. On `master` (project convention).

## File Structure

- Modify `channels/the-second-take/visual-kit/audio-tokens.json` — add the `beat_type_sfx` map.
- Modify `.claude/skills/render-builder/scripts/build_audio.py` — rebuild `sfx_events` (beat_type-driven + dormant comments + drop `chapter-card`); add the full-stop in `build_audio_spec`.
- Create `.claude/skills/render-builder/scripts/test_build_audio.py` — hermetic unit tests.
- Modify `.claude/skills/render-builder/references/motion-schema.md` — §2 `audioSpec` row + `_audioSpec_note`.
- Modify `knowledge/research/niche-playbooks/universal.md` — §13a-iii.8 SFX bullet consistency edit.
- Modify `.claude/skills/render-builder/SKILL.md` — sync the audio-emission description if present.
- Modify `knowledge/decisions.md`, `CLAUDE.md`, `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md` — log/status.

---

## Task 1: beat_type-driven structural emission (rebuild `sfx_events`)

**Files:**
- Modify: `channels/the-second-take/visual-kit/audio-tokens.json`
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (the `_OVERLAY_ROLE` comment + `sfx_events`)
- Test: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Consumes: `tokens["beat_type_sfx"]: {beat_type_str: [role_str, ...]}`, `tokens["sfx_pools"]`, `tokens["sfx_gain_db"]`.
- Produces: `sfx_events(shots, tokens, withhold=None) -> [{sfx, at_s, gain_db?}]` (signature unchanged; now beat_type-driven).

- [ ] **Step 1: Add the `beat_type_sfx` map to `audio-tokens.json`.** Insert this block after `"sfx_per_min_story_max": 20,` (a sibling top-level key):

```json
  "beat_type_sfx": {
    "_note": "Structural SFX auto-fired by beat_type (universal.md 13a-iii.8), one-per-shot at the shot start. ONLY reliable-every-instance beats belong here (a chapter boundary / escalation capper always warrants its sound). Content-nuanced hits (aside->sting, the number-reveal punch) are 2b AUTHORED cues, NOT here. Role must exist in sfx_pools; gain from sfx_gain_db; anti-repeat via pool rotation. Tune by ear.",
    "chapter-boundary": ["boom"],
    "escalation": ["thud"]
  },
```

Verify it parses: `py -3 -c "import json; json.load(open('channels/the-second-take/visual-kit/audio-tokens.json',encoding='utf-8')); print('ok')"` → `ok`.

- [ ] **Step 2: Write the failing test** `test_build_audio.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build_audio import sfx_events, build_audio_spec

TOK = {
    "sfx_pools": {"boom": ["boom-1", "boom-2"], "thud": ["thud-1"],
                  "whoosh": ["whoosh-1"], "tick": ["tick-1"]},
    "sfx_gain_db": {"boom": -6, "thud": -10, "whoosh": -7, "tick": -12},
    "beat_type_sfx": {"chapter-boundary": ["boom"], "escalation": ["thud"]},
    "sfx_per_min_story_max": 20,
}

def _shot(id, beat_type, start_s, **kw):
    s = {"id": id, "beat_type": beat_type, "start_s": start_s, "duration_s": 4.0, "overlays": []}
    s.update(kw); return s

def test_chapter_boundary_fires_boom():
    ev = sfx_events([_shot("A", "chapter-boundary", 10.0)], TOK)
    assert [e for e in ev if e["sfx"] == "audio/sfx/boom-1.mp3" and abs(e["at_s"] - 10.0) < 1e-6], ev

def test_escalation_fires_thud():
    ev = sfx_events([_shot("A", "escalation", 5.0)], TOK)
    assert [e for e in ev if e["sfx"] == "audio/sfx/thud-1.mp3"], ev

def test_number_reveal_fires_no_structural_sfx():
    # number-reveal is NOT in beat_type_sfx (its punch is 2b); it emits no structural event here
    ev = sfx_events([_shot("A", "number-reveal", 5.0)], TOK)
    assert ev == [], ev

def test_scene_change_fires_whoosh():
    ev = sfx_events([_shot("A", "narration", 0.0, stage_role="base")], TOK)
    assert [e for e in ev if e["sfx"] == "audio/sfx/whoosh-1.mp3"], ev

def test_text_overlay_fires_tick():
    ev = sfx_events([_shot("A", "narration", 0.0, overlays=[{"type": "text", "text": "x", "at_s": 0.5}])], TOK)
    assert [e for e in ev if e["sfx"] == "audio/sfx/tick-1.mp3"], ev

def test_gain_applied():
    ev = sfx_events([_shot("A", "chapter-boundary", 1.0)], TOK)
    boom = next(e for e in ev if "boom" in e["sfx"])
    assert boom["gain_db"] == -6, boom

print("running")
test_chapter_boundary_fires_boom(); test_escalation_fires_thud()
test_number_reveal_fires_no_structural_sfx(); test_scene_change_fires_whoosh()
test_text_overlay_fires_tick(); test_gain_applied()
print("PASS")
```

- [ ] **Step 3: Run → FAIL.** `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` → fails on `test_chapter_boundary_fires_boom` (current code only fires boom from a `chapter-card` overlay, not the beat_type).

- [ ] **Step 4: Rebuild `sfx_events` in `build_audio.py`.** Replace the `_OVERLAY_ROLE` comment + the whole `sfx_events` function with:

```python
# Per-element device-card overlays -> SFX. DORMANT: build_motion produces only `text` overlays today;
# stat-card/counter/definition-card/meter/progressive-reveal wait for the Phase-2c device-card producers
# (Remotion T3). Kept because they are the CORRECT per-element trigger (no beat_type equivalent) — not dead.
_OVERLAY_ROLE = {"stat-card": "pop", "counter": "pop", "definition-card": "pop",
                 "text": "tick", "meter": "riser"}


def sfx_events(shots, tokens, withhold=None):
    """Structural SFX, deterministic (§13a-iii.8). Fires ONLY on reliable-every-instance conditions:
      - a new scene (stage_role 'base' / whip entrance) -> whoosh
      - a `beat_type` listed in tokens `beat_type_sfx` -> its role(s) at the shot start
        (chapter-boundary -> boom, escalation -> thud; DATA in audio-tokens.json)
      - a `text` overlay -> tick
      - [dormant] device-card overlays -> pop/riser/pluck (no producer until Phase-2c device-cards)
    Content-nuanced hits (aside->sting, the number-reveal punch) are 2b AUTHORED cues, never emitted here.
    Variety = per-role pool rotation (deterministic occurrence index). Per-element 'chatter' is density-
    capped to the story band; structural markers pass through uncapped. Withheld inside register spans."""
    t = tokens or {}
    pool = t.get("sfx_pools") or {}
    gain = t.get("sfx_gain_db") or {}
    bt_sfx = t.get("beat_type_sfx") or {}
    role_idx = {}   # role -> running occurrence count (drives rotation)

    def emit(events, role, at_s, structural=False):
        i = role_idx.get(role, 0); role_idx[role] = i + 1
        e = {"sfx": _sfx_file(pool, role, i), "at_s": round(at_s, 3)}
        if role in gain:
            e["gain_db"] = gain[role]
        if not structural:
            e["_cap"] = True   # per-element chatter, subject to the density cap
        events.append(e)

    events = []
    for s in shots:
        start = s.get("start_s", 0.0)
        # scene change: a new named set-piece begins (whip is the same directional-snap family)
        if s.get("stage_role") == "base" or s.get("entrance") == "whip":
            emit(events, "whoosh", start, structural=True)
        # beat_type-driven structural hits (chapter-boundary -> boom, escalation -> thud; data-tunable)
        for role in bt_sfx.get(s.get("beat_type", "narration"), []):
            emit(events, role, start, structural=True)
        # overlays: text -> tick (produced today); device-card roles DORMANT until Phase-2c
        for o in s.get("overlays", []):
            typ = o.get("type")
            at = o.get("at_s", start)
            if typ == "progressive-reveal":                       # dormant (2c)
                items = o.get("items", [])
                if items:
                    emit(events, "riser", min(it["at_s"] for it in items), structural=True)
                for it in items:
                    emit(events, "pluck", it["at_s"])
            elif typ in _OVERLAY_ROLE:                            # text->tick live; stat/counter/meter dormant
                emit(events, _OVERLAY_ROLE[typ], at)

    # Density cap (format dial): thin only the per-element chatter to the earliest N over the piece;
    # structural markers pass through uncapped.
    if events and shots:
        piece_min = max(1e-6, (shots[-1].get("start_s", 0.0) + shots[-1].get("duration_s", 0.0)) / 60.0)
        cap = int(round(float(t.get("sfx_per_min_story_max", 20)) * piece_min))
        chatter = sorted((e for e in events if e.get("_cap")), key=lambda e: e["at_s"])[:cap]
        structural = [e for e in events if not e.get("_cap")]
        events = sorted(structural + chatter, key=lambda e: e["at_s"])
    # Register: withhold element SFX inside a gravity/dialogue/aside span (§13a-iii.8).
    if withhold:
        def _held(at):
            return any(w["at_s"] <= at < w["at_s"] + w["dur_s"] for w in withhold)
        events = [e for e in events if not _held(e["at_s"])]
    for e in events:
        e.pop("_cap", None)
    return events
```

Note vs the old code: the `chapter-card`→boom overlay branch is **gone** (beat_type owns boom); a new `beat_type_sfx` loop is added; the dormant branches + comments stay.

- [ ] **Step 5: Run → PASS.** `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` → `PASS`.

- [ ] **Step 6: Commit** (explicit paths):

```bash
git add channels/the-second-take/visual-kit/audio-tokens.json \
  .claude/skills/render-builder/scripts/build_audio.py \
  .claude/skills/render-builder/scripts/test_build_audio.py
git commit -m "feat(render-audio): beat_type-driven structural SFX (chapter->boom, escalation->thud); drop redundant chapter-card->boom"
```

---

## Task 2: The synchronized full-stop (withhold SFX inside a breath gap)

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (`build_audio_spec`)
- Test: `.claude/skills/render-builder/scripts/test_build_audio.py`

**Interfaces:**
- Consumes: `build_audio_spec(shots, tokens, words, has_vo, breath_gaps=None, audio_dir=None)`; `breath_gaps=[{at_s, dur_s, beat_type, shot_id}]` (from `breath.py`, unchanged).
- Produces: same `audioSpec` dict; its `events` now exclude any event landing **strictly inside** a breath gap (the intended hit lands AT the gap end and survives).

- [ ] **Step 1: Add the failing test** to `test_build_audio.py` (before the `print("running")` line, and add the calls to the run block):

```python
def test_full_stop_withholds_sfx_strictly_inside_a_gap():
    # a whoosh at t=5.3 sits inside a gap [5.0, 5.9]; it must be withheld. A boom at the gap end (5.9)
    # is the intended hit and must survive.
    shots = [_shot("A", "narration", 5.3, stage_role="base"),      # -> whoosh at 5.3 (inside the gap)
             _shot("B", "chapter-boundary", 5.9)]                  # -> boom at 5.9 (== gap end, survives)
    gaps = [{"at_s": 5.0, "dur_s": 0.9, "beat_type": "chapter-boundary", "shot_id": "B"}]
    spec = build_audio_spec(shots, TOK, words=[], has_vo=False, breath_gaps=gaps, audio_dir=None)
    ats = {round(e["at_s"], 3) for e in spec["events"]}
    assert 5.3 not in ats, spec["events"]     # whoosh inside the gap withheld
    assert 5.9 in ats, spec["events"]         # boom at the gap end kept
```

Add to the run block: `test_full_stop_withholds_sfx_strictly_inside_a_gap()`.

- [ ] **Step 2: Run → FAIL.** The whoosh at 5.3 is still present (no full-stop yet).

- [ ] **Step 3: Implement the full-stop in `build_audio_spec`.** Find the line `events = sfx_events(shots, t, withhold=withhold)` and insert, immediately AFTER it (before the `sfx_missing` / `audio_dir` filter block):

```python
    # Full-stop (§13a-iii.8): a breath gap is a synchronized silence — the bed dips AND element SFX drop.
    # Withhold events landing STRICTLY inside a gap; the intended hit lands at the gap END (the breath-beat
    # shot's first word, shifted past the gap) and survives. Keeps the gap a true stop, then the hit lands.
    for g in (breath_gaps or []):
        gs, ge = g["at_s"], g["at_s"] + g["dur_s"]
        events = [e for e in events if not (gs < e["at_s"] < ge)]
```

- [ ] **Step 4: Run → PASS.** `py -3 .claude/skills/render-builder/scripts/test_build_audio.py` → `PASS` (all tests).

- [ ] **Step 5: Commit:**

```bash
git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/test_build_audio.py
git commit -m "feat(render-audio): synchronized full-stop — withhold SFX inside a breath gap (bed dips, hit lands at gap end)"
```

---

## Task 3: Doc consistency (kill the stale overlay-keyed descriptions)

**Files:**
- Modify: `.claude/skills/render-builder/references/motion-schema.md` (the `audioSpec` derivation row + `_audioSpec_note`)
- Modify: `knowledge/research/niche-playbooks/universal.md` (§13a-iii.8 SFX bullet)
- Modify: `.claude/skills/render-builder/SKILL.md` (if it describes the audio emission)

- [ ] **Step 1: Find every stale reference.** Run:

```bash
grep -rn "chapter-card→boom\|chapter-card->boom\|stat/counter→pop\|from overlays/entrances" \
  .claude/skills/render-builder knowledge/research/niche-playbooks/universal.md
```

Expected hits: `motion-schema.md` line ~85 (the `audioSpec` row). Note each path/line to edit.

- [ ] **Step 2: Rewrite the `motion-schema.md` `audioSpec` derivation row.** In `.claude/skills/render-builder/references/motion-schema.md` §2, replace the sentence fragment that reads `element SFX from overlays/entrances (chapter-card→boom, base/whip→whoosh, stat/counter→pop, text→tick, meter/progressive-reveal→riser+pluck)` with:

```
structural SFX from beat_type + scene structure (base/whip→whoosh, `beat_type_sfx` map: chapter-boundary→boom, escalation→thud, text overlay→tick; per-element pop/riser/pluck stay overlay-keyed but DORMANT until the Phase-2c device-card producers ship). Content-nuanced hits (aside→sting, the number-reveal punch) are Phase-2b authored cues, not auto-fired
```

Then, in the same row, replace `**`number-reveal` → a `dips` entry that cuts the bed to near-silence inside the transition-breath gap**` with `**`number-reveal` → a `dips` entry that cuts the bed to near-silence inside the transition-breath gap; inside ANY breath gap element SFX are withheld (the synchronized full-stop), the intended hit landing at the gap end**`.

- [ ] **Step 3: Align `universal.md` §13a-iii.8.** In the SFX bullet ("SFX couple to the ELEMENT layer…"), change the clause listing triggers so it reads: structural SFX fire off `beat_type` + scene structure (scene-change→whoosh, chapter-boundary→boom, escalation-capper→thud, text→tick); per-element pop/pluck stay overlay-driven (dormant until device-cards); the number-reveal punch + comedic stings are authored (2b), not auto. Keep the surrounding measured-grammar text intact (integrate, don't append).

- [ ] **Step 4: Sync `render-builder/SKILL.md`.** `grep -n "overlay\|boom\|whoosh\|SFX" .claude/skills/render-builder/SKILL.md`; if any line describes the emission as overlay-driven, update it to "beat_type + scene-structure driven (see build_audio.py / audio-tokens beat_type_sfx)". If none, no edit.

- [ ] **Step 5: Verify no stale refs remain.** Re-run the Step-1 grep → **no hits** for `chapter-card→boom` / `stat/counter→pop` / `from overlays/entrances`. 

- [ ] **Step 6: Commit:**

```bash
git add .claude/skills/render-builder/references/motion-schema.md knowledge/research/niche-playbooks/universal.md .claude/skills/render-builder/SKILL.md
git commit -m "docs: sync SFX-emission description to beat_type-driven + full-stop (no stale overlay-keyed refs)"
```

---

## Task 4: Fixture render + ear gate (human checkpoint)

**Files:** none edited — this validates the build on the real fixture.

- [ ] **Step 1: Render `_chain-test`.** It carries varied `beat_type`s (cold-open, chapter-boundary, etc.). Run:

```bash
py -3 .claude/skills/render-builder/scripts/build_motion.py channels/the-second-take/videos/_chain-test --allow-missing
```

Expected: completes; the manifest prints an `sfx_count` > the pre-change baseline (boom on chapter-boundary etc. now fire). If a role's file is missing, the run warns + drops it (never crashes) — note which roles lack files.

- [ ] **Step 2: Confirm the emission is sane (deterministic check, not ear).** Read the written `assets/motion/long-form.motion.json` → the `audioSpec.events`: chapter-boundary shots have a boom at their start; no event sits strictly inside a `dips` gap; no event references a role absent from `sfx_pools`.

> **CHECKPOINT (human — the acceptance gate):** open the rendered MP4 in the Windows default player ([[review-video-in-device-player]]) and LISTEN. Do the structural SFX land right / not too much? Tune `audio-tokens.json` `beat_type_sfx` roles + `sfx_gain_db` by ear and re-render. [[audio-taste-is-human-judged]] — this is the human's call, not an assertion. Do NOT proceed to Task 5 until the user signs off on the sound.

---

## Task 5: Status + decision log

**Files:**
- Modify: `knowledge/decisions.md`, `CLAUDE.md`, `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`

- [ ] **Step 1: Log the decision.** Append a dated entry to `knowledge/decisions.md` (before the `## Open questions` section): Phase 2a done — structural SFX now beat_type-driven (`beat_type_sfx` map), the full-stop lands, dormant device-card branches parked, chapter-card→boom removed as redundant; number-reveal punch + comedic stings deferred to 2b; validated by the `_chain-test` ear gate.

- [ ] **Step 2: Update `CLAUDE.md` status.** In the audio-arc bullet, change "NEXT = Phase 2 (SFX emission)" to note Phase **2a DONE** (beat_type-driven structural emission + full-stop, ear-gated) and **NEXT = Phase 2b** (authored `audio-cues.json` comedic layer + author/critic — the content-nuanced hits).

- [ ] **Step 3: Update the handoff.** In `docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md`, move the resume pointer from "Phase 2" to "Phase 2b" and note 2a is built + ear-gated.

- [ ] **Step 4: Commit:**

```bash
git add knowledge/decisions.md CLAUDE.md docs/handoffs/2026-07-10-sfx-library-and-audio-analysis-pickup.md
git commit -m "docs: record SFX emission Phase 2a done; resume at 2b"
```

---

## Self-Review (author, against the spec)

- **Spec coverage:** re-key off beat_type (Task 1) · dormant-not-dead + drop chapter-card→boom (Task 1, G4) · beat_type_sfx as data (Task 1, G2) · full-stop (Task 2) · engine unchanged (G5, no engine task) · doc sync incl. the named stale refs (Task 3, G7) · hermetic tests (Tasks 1–2) · fixture ear-gate (Task 4) · number-reveal punch + stings deferred to 2b (G3, not built) · status/log (Task 5). Device-cards / music lane / checker correctly out of this plan.
- **Placeholder scan:** none — every code + doc edit is spelled out; the only human step (Task 4 checkpoint) is a deliberate ear-gate, not a TODO.
- **Type consistency:** `beat_type_sfx: {str: [str]}` consumed identically in Task 1 code + tests; `breath_gaps` dict keys (`at_s`, `dur_s`) match `breath.py` and the Task-2 full-stop; event dict `{sfx, at_s, gain_db?}` matches the engine (G5). Roles in the Task-1 `beat_type_sfx` (`boom`, `thud`) exist in `sfx_pools` (G6 — both are in the shipped library).

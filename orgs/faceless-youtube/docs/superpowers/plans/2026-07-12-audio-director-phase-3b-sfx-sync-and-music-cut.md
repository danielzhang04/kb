# Audio Director — Phase 3b: SFX visual-sync + clean music cut

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The two mechanism fixes the Phase-3 ear-gate surfaced, so the director's placement lands right: (1) an element-enunciating SFX **snaps to the nearest visual event** (a shot cut / overlay `at_s`) instead of a drifted VO word, and (2) a music **dry pull-back that abuts a track switch is one continuous silence** (no old-bed sliver). Plus the guidance + a re-authored `_chain-test` re-gate.

**Architecture:** Phase 3b of `2026-07-12-audio-director-rework-design.md` (the ear-gate expansion of Phase 3). Both fixes are deterministic realizer rules with unit tests; they REUSE the visual-event times already in the spec (shot `start_s` + overlay `at_s`). The *when* logic (which scene → whoosh, which delta → pop) stays the director's judgment in `grammar-guidance` — seeded here, refined by the ongoing ear-gate loop.

**Tech Stack:** Python 3 (`py -3`, plain-assert).

## Global Constraints

- Parallel terminals → explicit git paths, never `git add -A`.
- **Reuse existing times** — the snap uses shot `start_s` + overlay `at_s` from the derived shots; do NOT recompute them.
- **One home for the sync flag** — an optional `sync: "element"` on an `sfx` cue (director sets it for item-appearance sounds); default = word-time. Documented once in `audio-plan-schema.md`.
- Edit `grammar-guidance.md` / `audio-plan-schema.md` in place (no append piles). Tests for both mechanisms.
- Audio FEEL stays the human ear-gate.

---

### Task 1: Element-SFX snap-to-nearest-visual-event

**Files:**
- Modify: `.claude/skills/render-builder/scripts/audio_cues.py` (`cue_role_events` propagates a cue's `sync`)
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (`snap_element_sfx` + call it in `build_audio_spec`)
- Test: `.claude/skills/render-builder/scripts/test_sfx_snap.py`

**Interfaces:**
- Produces: `build_audio.py::snap_element_sfx(events, shots, window_s=0.7) -> events` — for each event with `sync == "element"`, move its `at_s` to the nearest visual event (any shot `start_s` or overlay `at_s`) within `window_s`; if none in range, leave it. `cue_role_events` copies a cue's `sync` onto its emitted event.

- [ ] **Step 1: Write the failing test** `test_sfx_snap.py`

```python
"""Element-SFX snaps to the nearest visual event within the window (plain-assert)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from build_audio import snap_element_sfx


def _shot(id, start, overlays=None):
    return {"id": id, "start_s": start, "duration_s": 3.0, "overlays": overlays or []}


def test_element_sfx_snaps_to_nearest_cut():
    shots = [_shot("A", 0.0), _shot("B", 5.0)]              # cuts at 0.0 and 5.0
    events = [{"at_s": 5.4, "role": "whoosh", "sync": "element"}]   # 0.4s after the cut
    out = snap_element_sfx(events, shots, window_s=0.7)
    assert out[0]["at_s"] == 5.0, out                      # snapped to the cut


def test_non_sync_event_is_untouched():
    shots = [_shot("A", 0.0), _shot("B", 5.0)]
    events = [{"at_s": 5.4, "role": "record_scratch"}]     # no sync -> word-time kept
    assert snap_element_sfx(events, shots, window_s=0.7)[0]["at_s"] == 5.4


def test_element_sfx_no_visual_in_window_stays():
    shots = [_shot("A", 0.0), _shot("B", 5.0)]
    events = [{"at_s": 3.0, "role": "cash", "sync": "element"}]   # nearest cut 2s away > window
    assert snap_element_sfx(events, shots, window_s=0.7)[0]["at_s"] == 3.0


def test_snaps_to_overlay_at_s():
    shots = [_shot("A", 0.0, overlays=[{"type": "text", "at_s": 4.0}])]
    events = [{"at_s": 4.3, "role": "cash", "sync": "element"}]
    assert snap_element_sfx(events, shots, window_s=0.7)[0]["at_s"] == 4.0


def main():
    for fn in [test_element_sfx_snaps_to_nearest_cut, test_non_sync_event_is_untouched,
               test_element_sfx_no_visual_in_window_stays, test_snaps_to_overlay_at_s]:
        fn(); print("ok", fn.__name__)
    print("OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run — expect FAIL** (`ImportError: cannot import name 'snap_element_sfx'`).
Run: `py -3 .claude/skills/render-builder/scripts/test_sfx_snap.py`

- [ ] **Step 3: Add `snap_element_sfx` to `build_audio.py`** (place near `sfx_events`)

```python
def snap_element_sfx(events, shots, window_s=0.7):
    """An element-enunciating SFX (`sync == "element"`) lands on the visual event it punctuates, not a
    drifted VO word: snap its at_s to the nearest shot cut (start_s) or overlay at_s within window_s.
    No visual in range -> leave it. Non-`element` events are untouched."""
    visual = []
    for s in shots:
        visual.append(float(s.get("start_s", 0.0)))
        for o in s.get("overlays", []):
            visual.append(float(o.get("at_s", s.get("start_s", 0.0))))
    visual.sort()
    if not visual:
        return events
    for e in events:
        if e.get("sync") != "element":
            continue
        at = float(e["at_s"])
        nearest = min(visual, key=lambda v: abs(v - at))
        if abs(nearest - at) <= window_s:
            e["at_s"] = round(nearest, 3)
    return events
```

- [ ] **Step 4: Propagate `sync` in `cue_role_events`** (`audio_cues.py`) — when it emits a role event from a cue, copy the cue's optional `sync` onto the event (so `snap_element_sfx` can see it). One line: `if c.get("sync"): ev["sync"] = c["sync"]` at the emit site.

- [ ] **Step 5: Call `snap_element_sfx` in `build_audio_spec`** — after the events stream is assembled (cue events merged) and before the withhold/full-stop filtering, call `events = snap_element_sfx(events, shots)`. (Snapping first means the full-stop/withhold see the final, cut-aligned times.)

- [ ] **Step 6: Run — expect PASS** + regression: `py -3 test_sfx_snap.py` → OK; `py -3 test_build_audio.py` → PASS.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/audio_cues.py .claude/skills/render-builder/scripts/test_sfx_snap.py
git commit -m "feat(audio): element-SFX snap to nearest visual event (audio-director phase 3b)"
```

---

### Task 2: Clean music cut — dry-abutting-switch = continuous silence

**Files:**
- Modify: `.claude/skills/render-builder/scripts/build_audio.py` (`build_music_lane`)
- Test: `.claude/skills/render-builder/scripts/test_build_audio.py` (add one test)

**Interfaces:**
- Produces: after carving dry holes, a short same-mood remnant that sits *between a carved hole and a different-mood switch* is absorbed into the silence (dropped), so the pull-back runs continuously into the new track.

- [ ] **Step 1: Add the failing test** to `test_build_audio.py`

```python
def test_dry_abutting_switch_is_continuous_silence():
    # sneaky runs to 20; a dry hole [10,14]; casual-bed switches in at 15. The sneaky remnant [14,15]
    # (a <2s sliver between the hole and a different-mood switch) is absorbed -> silence 10..15, then casual-bed.
    cues = [{"mood": "sneaky", "at_s": 0.0}, {"mood": "casual-bed", "at_s": 15.0}]
    ms, _ = build_music_lane(cues, [{"at_s": 10.0, "to_s": 14.0}], _shots(30.0), _MTOK)
    starts = [round(m["at_s"], 1) for m in ms]
    assert 14.0 not in starts and all(m["track"].endswith("casual-bed-1.mp3") or m["at_s"] < 10.0 for m in ms), ms
    # the sneaky segment ends at 10.0 (the hole start); no sneaky remnant between 14 and 15
    sneaky = [m for m in ms if "sneaky" in m["track"]]
    assert len(sneaky) == 1 and abs(sneaky[0]["at_s"] + sneaky[0]["dur_s"] - 10.0) < 1e-6, ms
```

- [ ] **Step 2: Run — expect FAIL** (the remnant currently survives).
Run: `py -3 .claude/skills/render-builder/scripts/test_build_audio.py`

- [ ] **Step 3: Implement the absorb rule in `build_music_lane`** — after `_subtract_holes` and before coalesce/track-switch-gap, drop any segment that (a) starts exactly at a carved hole's end, (b) is immediately followed by a *different-mood* segment (a switch), and (c) is shorter than `dry_switch_absorb_s` (default 3.0). This extends the silence from the hole into the switch. Keep the value data-tunable (read `tokens.get("dry_switch_absorb_s", 3.0)`).

- [ ] **Step 4: Run — expect PASS** + full audio suite green.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/render-builder/scripts/build_audio.py .claude/skills/render-builder/scripts/test_build_audio.py
git commit -m "feat(audio): dry pull-back abutting a track switch = continuous silence (audio-director phase 3b)"
```

---

### Task 3: Guidance + schema + re-author `_chain-test` + ear-gate

**Files:**
- Modify: `.claude/skills/render-builder/references/audio-plan-schema.md` (document the optional `sync` field)
- Modify: `.claude/skills/audio-director/references/grammar-guidance.md` (the element-sync principle + seed whoosh/pop rules)
- Modify: `channels/the-second-take/videos/_chain-test/audio-plan.json`

- [ ] **Step 1: Document `sync` in `audio-plan-schema.md`** — under the `sfx` kind: "`sync`: `"element"` (optional) — an item-appearance sound (cha-ching, a stamp pound, a scene whoosh, a delta pop) snaps to the nearest visual event (shot cut / overlay `at_s`) within ~0.7s. Omit for a VO-moment sound (a verbal-pivot scratch, an aside sting), which stays on its word." Edit in place.

- [ ] **Step 2: Update `grammar-guidance.md`** — rewrite the "structural sounds by judgment" bullet to encode the durable principle + the seed rules (edit in place, no append): *Element-enunciating SFX sync to the item's appearance (`sync: "element"`). Seed rules (refine by ear): `whoosh` on a scene change that opens a new plot section — not every cut, never inside a delta chain; `pop` when a small item/icon/sign-card enters a delta chain/layer — NOT a character or a costume change; `cash`/stamp-pound/etc. on the money/stamp/item appearing.*

- [ ] **Step 3: Re-author `_chain-test/audio-plan.json`** — apply the corrected judgment: mark the item-appearance SFX `sync: "element"` (the whooshes, the cash); place whooshes only on plot-transition scene changes; add `pop` cues (with `sync: "element"`) on the Poyais feature accretion if `_chain-test` has that delta structure (check `shots.json`); keep the fixed `dry`. Lint: `py -3 .../lint_audio_plan.py <plan> <audio-tokens.json>` → `0 error(s)`. (The lint accepts unknown optional fields; if it rejects `sync`, add `sync` to the allowed sfx keys.)

- [ ] **Step 4: Re-render + EAR-GATE (Daniel).** `py -3 .../build_motion.py channels/the-second-take/videos/_chain-test --only long-form`; open `assets/final.mp4`. Confirm: whooshes land ON the cuts; pops land as each Poyais feature appears; music cuts clean into the switch (no sneaky creep-back). Iterate by ear.

- [ ] **Step 5: Commit** (after approval)

```bash
git add .claude/skills/render-builder/references/audio-plan-schema.md .claude/skills/audio-director/references/grammar-guidance.md channels/the-second-take/videos/_chain-test/audio-plan.json
git commit -m "feat(audio): element-sync guidance + re-authored _chain-test (audio-director phase 3b)"
```

---

## Phase 3 (with 3b) done on ear-gate — director judgment + correct sync + clean cuts. Next: Phase 4 (delete beat_type + update the stale checker) → Phase 5 (hygiene).

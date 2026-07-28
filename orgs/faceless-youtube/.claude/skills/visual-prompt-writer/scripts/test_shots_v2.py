"""Behaviour tests for the shots.json **v2** contract in lint_shots.py.

v2 drops the v1 authoring/review metadata (`from_cue`, `beat`, `narration_type`,
`hold_reason`, `cast`, `props`, `needed_assets`, `house_style`, `shot_counts`,
`timing_status`). None of it was ever engine-read, so the rule that matters is:

  * a v2 file is the norm and lints silently;
  * a v1 file STILL LINTS AND STILL RENDERS — its leftovers are a **heads-up**,
    never a HARD violation. Failing them would break every archived video for a
    naming change.

The behaviour floor the v2 cut must NOT disturb (verbatim anchors in narration
order, supplied-text, lettering L1-L4, delta caps, runtime/5 + coverage) is pinned
by the sibling suites; this file pins the v2-specific behaviour plus the
end-to-end `--write` contract.
"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lint_shots

SCRIPT = (
    "The founder walked into the room and promised everyone a fortune by spring. "
    "Investors emptied their savings within a week. "
    "The ledgers told a very different story that autumn. "
    "By December the scheme had collapsed and the money was gone for good, "
    "leaving four hundred families holding nothing at all."
)

ANCHORS = [
    "The founder walked into",
    "Investors emptied their savings",
    "The ledgers told a",
    "By December the scheme",
]


def _shot(i, **extra):
    sh = {
        "id": f"L{i + 1:02d}",
        "vo_ref": ANCHORS[i],
        "duration_s": 5,
        "shot_class": "symbolic-stand-in",
        "source": "ai-gen",
        "still_prompt": "a plain cartoon scene with no lettering at all",
        "synthetic": False,
        "notes": "",
    }
    sh.update(extra)
    return sh


def _v2(**extra):
    data = {
        "schema": lint_shots.SCHEMA_V2,
        "channel": "the-second-take",
        "video_slug": "t",
        "generated": "2026-07-28",
        "status": "shots-drafted",
        "global_prompt_suffix": "clean flat cel cartoon, 16:9.",
        "long_form": {"aspect_ratio": "16:9", "shots": [_shot(i) for i in range(4)]},
        "thumbnail": {"primary": {"gen_prompt": "a plain cartoon poster"}, "challengers": []},
        "shorts": [],
    }
    data.update(extra)
    return data


def _soft(data):
    hard, soft = [], []
    lint_shots.schema_check(data, soft)
    lint_shots.legacy_field_check(data, soft)
    return hard, soft


# --- schema version -----------------------------------------------------------

def test_schema_v2_is_accepted_silently():
    assert _soft(_v2())[1] == []


def test_schema_v1_is_accepted_with_a_legacy_warning():
    hard, soft = _soft(_v2(schema=lint_shots.SCHEMA_V1))
    assert hard == []
    assert len(soft) == 1 and "shots@1" in soft[0]


def test_missing_schema_warns_but_never_fails():
    data = _v2()
    del data["schema"]
    hard, soft = _soft(data)
    assert hard == []
    assert len(soft) == 1 and "shots@2" in soft[0]


# --- dropped v1 fields --------------------------------------------------------

def test_legacy_shot_fields_are_a_warning_listing_them():
    data = _v2()
    data["long_form"]["shots"][0].update(
        {"from_cue": True, "beat": "hook", "narration_type": "scale",
         "hold_reason": "legibility", "cast": [], "props": []})
    hard, soft = _soft(data)
    assert hard == [], "legacy fields must NEVER be an error"
    assert len(soft) == 1
    for field in ("from_cue", "beat", "narration_type", "hold_reason", "cast", "props"):
        assert field in soft[0], f"{field} must be named in the warning"


def test_legacy_file_fields_are_a_warning_listing_them():
    data = _v2(house_style={"x": 1}, needed_assets=[], shot_counts={"long_form_shots": 4},
               timing_status="estimated-from-script")
    hard, soft = _soft(data)
    assert hard == []
    assert len(soft) == 1
    for field in ("house_style", "needed_assets", "shot_counts", "timing_status"):
        assert field in soft[0]


def test_legacy_fields_inside_a_short_are_counted_too():
    data = _v2(shorts=[{"file": "shorts/short-01.md", "shots": [_shot(0, beat="hook")]}])
    assert "beat" in _soft(data)[1][0]


def test_derived_vo_text_is_not_a_legacy_field():
    """`vo_text` survives v2 as the lint-WRITTEN review aid — warning on it would
    make every `--write` pass dirty its own output."""
    data = _v2()
    data["long_form"]["shots"][0]["vo_text"] = "The founder walked into the room"
    assert _soft(data)[1] == []


# --- the long hold: v1 demanded a `hold_reason`; v2 has no such field ----------

def test_a_long_hold_is_no_longer_an_error():
    shots = [_shot(i, duration_s=12) for i in range(4)]
    hard, soft = [], []
    with tempfile.TemporaryDirectory() as td:
        md = Path(td) / "script.md"
        md.write_text("---\n" + SCRIPT + "\n", encoding="utf-8")
        lint_shots.lint_piece("long-form", shots, md, hard, soft)
    assert not any("hold_reason" in m for m in hard + soft), (hard, soft)


# --- end-to-end ---------------------------------------------------------------

def _run(data, *args):
    td = tempfile.mkdtemp()
    (Path(td) / "script.md").write_text("---\n" + SCRIPT + "\n", encoding="utf-8")
    path = Path(td) / "shots.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    rc = lint_shots.main([str(path), *args])
    return rc, path


def test_a_clean_v2_file_lints_green_and_writes_vo_text():
    rc, path = _run(_v2(), "--write")
    assert rc == 0
    out = json.loads(path.read_text(encoding="utf-8"))
    assert out["long_form"]["shots"][0]["vo_text"].startswith("The founder walked into")
    assert "shot_counts" not in out, "v2 dropped the informational shot_counts block"


def test_a_legacy_v1_file_still_lints_green_and_loses_shot_counts_on_write():
    # Key ORDER mirrors a real v1 file: `shot_counts` sits mid-file, before
    # `long_form`, so the strip regex sees the trailing comma it keys off.
    data = {"schema": lint_shots.SCHEMA_V1, "channel": "the-second-take", "video_slug": "t",
            "generated": "2026-07-28", "status": "shots-drafted",
            "shot_counts": {"_note": "informational only", "long_form_shots": 4},
            "timing_status": "estimated-from-script", "house_style": {"x": 1},
            "needed_assets": []}
    data.update(_v2())
    data["schema"] = lint_shots.SCHEMA_V1
    data["long_form"]["shots"][0]["beat"] = "hook"
    rc, path = _run(data, "--write")
    assert rc == 0, "a v1 file must still pass — its fields are ignored, not illegal"
    out = json.loads(path.read_text(encoding="utf-8"))
    assert "shot_counts" not in out
    assert out["long_form"]["shots"][0]["beat"] == "hook", "--write must not strip v1 fields"
    assert "vo_text" in out["long_form"]["shots"][0]


def test_the_hard_floor_still_fails_a_paraphrased_anchor():
    """The one check the whole lint exists for, re-pinned on a v2 file."""
    data = _v2()
    data["long_form"]["shots"][1]["vo_ref"] = "he emptied their savings"
    rc, _ = _run(data)
    assert rc == 1

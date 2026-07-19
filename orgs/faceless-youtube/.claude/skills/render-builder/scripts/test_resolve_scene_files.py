"""resolve_scene_files exempts layered/hybrid shots from the scene gate (plain-assert)."""
import sys, os, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path
from render import resolve_scene_files


def test_layered_shot_is_exempt_non_layered_still_hard_errors():
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        shots = [{"id": "L07"}, {"id": "L08"}]   # neither has a PNG; both ai-gen
        # L07 is layered -> exempt; L08 is a normal ai-gen shot with no PNG -> hard error.
        raised = False
        try:
            resolve_scene_files(scenes, "long-form", shots, False, allow_missing=False,
                                layered_ids={"L07"})
        except SystemExit:
            raised = True
        assert raised, "expected a hard error for the un-materialized non-layered L08"


def test_all_layered_no_error_and_none_files():
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        shots = [{"id": "L07"}, {"id": "L09"}]
        files, allowed = resolve_scene_files(scenes, "long-form", shots, False,
                                             allow_missing=False, layered_ids={"L07", "L09"})
        assert files == [None, None], files
        assert allowed == [], allowed   # not counted as allow-missing fallbacks


if __name__ == "__main__":
    test_layered_shot_is_exempt_non_layered_still_hard_errors()
    test_all_layered_no_error_and_none_files()
    print("OK")

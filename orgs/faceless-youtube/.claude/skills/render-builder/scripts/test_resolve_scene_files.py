"""resolve_scene_files exempts layered/hybrid shots from the scene gate (plain-assert)."""
import sys, os, tempfile, json
sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path
from render import resolve_scene_files


def _valid_png(path: Path):
    """A real, non-truncated PNG (≥1KB + PNG magic) so it clears the S1-B image check."""
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2000)


def _write_manifest(scenes: Path, entries: list):
    """image-generation's verify record: scenes/manifest.json shaped {"shots": [entry, ...]}."""
    (scenes / "manifest.json").write_text(json.dumps({"shots": entries}), encoding="utf-8")


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


def test_review_status_verified_resolves():
    """review_status == "verified" is shippable on its own — NO legacy verified booleans."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L01.png")
        _write_manifest(scenes, [{"shot_id": "L01", "review_status": "verified"}])
        files, allowed = resolve_scene_files(scenes, "long-form", [{"id": "L01"}], False,
                                             allow_missing=False)
        assert files == [scenes / "L01.png"], files
        assert allowed == [], allowed


def test_review_status_parked_fails_with_reasons():
    """parked = reviewed, defects known, NOT shippable — the reason string must be honest
    (`parked: <'; '.join(parked_reasons)>`), not a mystery gate code."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L12.png")
        _write_manifest(scenes, [{"shot_id": "L12", "review_status": "parked",
                                  "parked_reasons": ["L12 lettering CHECKIG", "rig drift"]}])
        raised = None
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L12"}], False, allow_missing=False)
        except SystemExit as e:
            raised = str(e)
        assert raised is not None, "a parked shot must NOT be shippable"
        # brief pseudo-test says the reason startswith "parked:" and contains "CHECKIG";
        # this harness surfaces the reason verbatim inside the SystemExit gate message.
        assert "parked: L12 lettering CHECKIG; rig drift" in raised, raised
        assert "CHECKIG" in raised, raised


def test_review_status_unreviewed_fails_as_gate():
    """review_status is authoritative when present: "unreviewed" fails as the plain gate even
    though the legacy verified booleans are both True (the fyt-run-001 falsification path)."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L03.png")
        _write_manifest(scenes, [{"shot_id": "L03", "review_status": "unreviewed",
                                  "verified": {"scene": True, "rig": True}}])
        raised = None
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L03"}], False, allow_missing=False)
        except SystemExit as e:
            raised = str(e)
        assert raised is not None, "unreviewed is NOT shippable regardless of legacy booleans"
        assert "NOT verified in manifest.json" in raised, raised  # plain gate, not parked
        assert "parked" not in raised, raised


def test_legacy_manifest_without_review_status_keeps_old_behavior():
    """No review_status key -> unchanged boolean gate: scene&rig True ships; rig False gates."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L04.png")
        _write_manifest(scenes, [{"shot_id": "L04", "verified": {"scene": True, "rig": True}}])
        files, _ = resolve_scene_files(scenes, "long-form", [{"id": "L04"}], False,
                                       allow_missing=False)
        assert files == [scenes / "L04.png"], files
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L05.png")
        _write_manifest(scenes, [{"shot_id": "L05", "verified": {"scene": True, "rig": False}}])
        raised = False
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L05"}], False, allow_missing=False)
        except SystemExit:
            raised = True
        assert raised, "rig=false must still hard-gate"


if __name__ == "__main__":
    test_layered_shot_is_exempt_non_layered_still_hard_errors()
    test_all_layered_no_error_and_none_files()
    test_review_status_verified_resolves()
    test_review_status_parked_fails_with_reasons()
    test_review_status_unreviewed_fails_as_gate()
    test_legacy_manifest_without_review_status_keeps_old_behavior()
    print("OK")

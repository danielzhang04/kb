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


def test_layered_shot_with_parked_entry_fails():
    """The wells-fargo hole (119/119 exempted): a layered shot whose manifest entry is parked
    must NOT be shippable. Layered membership exempts the shot from the PNG-existence check ONLY
    (note: no PNG on disk here), never from the S2 status check."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _write_manifest(scenes, [{"shot_id": "L30", "review_status": "parked",
                                  "parked_reasons": ["L30 rig unresolved", "cutout seam"]}])
        raised = None
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L30"}], False,
                                allow_missing=False, layered_ids={"L30"})
        except SystemExit as e:
            raised = str(e)
        assert raised is not None, "a parked layered shot must NOT be shippable"
        assert "parked: L30 rig unresolved; cutout seam" in raised, raised


def test_layered_shot_with_verified_entry_resolves_without_png():
    """A layered shot with a verified manifest entry and NO scenes/<id>.png on disk is shippable
    (S1 exempt via layered membership, S2 satisfied by the verified entry)."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _write_manifest(scenes, [{"shot_id": "L31", "review_status": "verified"}])
        files, allowed = resolve_scene_files(scenes, "long-form", [{"id": "L31"}], False,
                                             allow_missing=False, layered_ids={"L31"})
        assert files == [None], files          # no PNG path, but no error — shippable
        assert allowed == [], allowed


def test_layered_shot_with_no_entry_resolves_legacy():
    """Compatibility carve-out: a manifest that exists but has NO entry for a layered shot passes
    (legacy manifests never listed layered shots)."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _write_manifest(scenes, [{"shot_id": "OTHER", "review_status": "verified"}])
        files, allowed = resolve_scene_files(scenes, "long-form", [{"id": "L32"}], False,
                                             allow_missing=False, layered_ids={"L32"})
        assert files == [None], files
        assert allowed == [], allowed


def test_all_flagged_manifest_resolves_nothing():
    """The fyt-run-001 shape: a manifest in which NOTHING is shippable must resolve 0 shots and
    report all 3 — one layered (with a PNG on disk, to prove membership no longer buys an exemption)
    and two plain, all parked."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L20.png")   # layered shot even HAS a valid PNG …
        _valid_png(scenes / "L21.png")
        _valid_png(scenes / "L22.png")
        _write_manifest(scenes, [
            {"shot_id": "L20", "review_status": "parked", "parked_reasons": ["drift"]},
            {"shot_id": "L21", "review_status": "parked", "parked_reasons": ["lettering"]},
            {"shot_id": "L22", "review_status": "parked", "parked_reasons": ["rig"]},
        ])
        shots = [{"id": "L20"}, {"id": "L21"}, {"id": "L22"}]
        files, allowed = resolve_scene_files(scenes, "long-form", shots, False,
                                             allow_missing=True, layered_ids={"L20"})
        assert files == [None, None, None], files   # … yet none resolve
        assert len(allowed) == 3, allowed


if __name__ == "__main__":
    test_layered_shot_is_exempt_non_layered_still_hard_errors()
    test_all_layered_no_error_and_none_files()
    test_review_status_verified_resolves()
    test_review_status_parked_fails_with_reasons()
    test_review_status_unreviewed_fails_as_gate()
    test_legacy_manifest_without_review_status_keeps_old_behavior()
    test_layered_shot_with_parked_entry_fails()
    test_layered_shot_with_verified_entry_resolves_without_png()
    test_layered_shot_with_no_entry_resolves_legacy()
    test_all_flagged_manifest_resolves_nothing()
    print("OK")

"""preview_parked shows a PARKED shot's real pixels for a human eye-gate — and relaxes nothing else.

The gate law these tests pin (render.resolve_scene_files):
  * default (preview_parked=False) behaviour is UNCHANGED — parked is still a hard error;
  * preview_parked=True includes a parked shot's actual scene PNG instead of None, and reports it
    separately from `allowed` (allow-missing placeholders) so the manifest can tell the two apart;
  * preview_parked NEVER rescues a shot that is unreviewed/unverified, has no valid PNG, or is
    otherwise non-shippable — it is scoped to `review_status == "parked"` and nothing else.
"""
import sys, os, tempfile, json
sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path
from render import resolve_scene_files


def _valid_png(path: Path):
    """A real, non-truncated PNG (>=1KB + PNG magic) so it clears the S1-B image check."""
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2000)


def _write_manifest(scenes: Path, entries: list):
    (scenes / "manifest.json").write_text(json.dumps({"shots": entries}), encoding="utf-8")


def _parked_fixture(d):
    """One parked shot (defects known) whose best-attempt PNG really is on disk."""
    scenes = Path(d) / "scenes"
    scenes.mkdir()
    _valid_png(scenes / "L01.png")
    _write_manifest(scenes, [{"shot_id": "L01", "review_status": "parked",
                             "parked_reasons": ["fidelity: MED"]}])
    return scenes


def test_default_still_hard_errors_on_parked():
    """REGRESSION GUARD: without the flag, parked remains a hard error (the style-lock promise)."""
    with tempfile.TemporaryDirectory() as d:
        scenes = _parked_fixture(d)
        raised = False
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L01"}], False, allow_missing=False)
        except SystemExit:
            raised = True
        assert raised, "parked must still hard-error when preview_parked is not passed"


def test_preview_parked_resolves_the_real_png():
    """The whole point: the eye-gate sees the actual best-attempt pixels, not a placeholder card."""
    with tempfile.TemporaryDirectory() as d:
        scenes = _parked_fixture(d)
        previewed = []
        files, allowed = resolve_scene_files(scenes, "long-form", [{"id": "L01"}], False,
                                             allow_missing=False, preview_parked=True,
                                             previewed_out=previewed)
        assert files == [scenes / "L01.png"], files
        assert allowed == [], f"a previewed parked shot is not an allow-missing placeholder: {allowed}"
        assert previewed == ["L01"], previewed


def test_preview_parked_does_not_rescue_unreviewed():
    """Scope guard: 'unreviewed' is NOT parked — it never got human eyes, so it stays a hard error."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L02.png")
        _write_manifest(scenes, [{"shot_id": "L02", "review_status": "unreviewed"}])
        raised = False
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L02"}], False,
                                allow_missing=False, preview_parked=True)
        except SystemExit:
            raised = True
        assert raised, "preview_parked must not rescue an unreviewed shot"


def test_preview_parked_does_not_invent_pixels_when_png_absent():
    """A parked shot with no usable PNG has no pixels to preview -> still non-shippable."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()          # note: no L03.png written
        _write_manifest(scenes, [{"shot_id": "L03", "review_status": "parked",
                                  "parked_reasons": ["rig: HIGH"]}])
        raised = False
        try:
            resolve_scene_files(scenes, "long-form", [{"id": "L03"}], False,
                                allow_missing=False, preview_parked=True)
        except SystemExit:
            raised = True
        assert raised, "preview_parked must not pass a parked shot that has no valid PNG"


def test_preview_parked_leaves_verified_shots_untouched():
    """A verified shot resolves identically with the flag on — the flag is additive, not a re-gate."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L04.png")
        _write_manifest(scenes, [{"shot_id": "L04", "review_status": "verified"}])
        previewed = []
        files, allowed = resolve_scene_files(scenes, "long-form", [{"id": "L04"}], False,
                                             allow_missing=False, preview_parked=True,
                                             previewed_out=previewed)
        assert files == [scenes / "L04.png"], files
        assert allowed == [] and previewed == [], (allowed, previewed)


def test_preview_parked_mixed_batch_separates_parked_from_placeholder():
    """Mixed real case: verified + parked(previewed) + a genuinely missing shot under allow_missing.
    The previewed parked shot must NOT be counted as a placeholder."""
    with tempfile.TemporaryDirectory() as d:
        scenes = Path(d) / "scenes"
        scenes.mkdir()
        _valid_png(scenes / "L05.png")
        _valid_png(scenes / "L06.png")
        _write_manifest(scenes, [
            {"shot_id": "L05", "review_status": "verified"},
            {"shot_id": "L06", "review_status": "parked", "parked_reasons": ["style: LOW"]},
            {"shot_id": "L07", "review_status": "verified"},      # entry exists, PNG does not
        ])
        previewed = []
        files, allowed = resolve_scene_files(
            scenes, "long-form", [{"id": "L05"}, {"id": "L06"}, {"id": "L07"}], False,
            allow_missing=True, preview_parked=True, previewed_out=previewed)
        assert files == [scenes / "L05.png", scenes / "L06.png", None], files
        assert allowed == ["L07"], allowed          # only the truly missing one is a placeholder
        assert previewed == ["L06"], previewed

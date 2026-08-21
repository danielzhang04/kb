import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import build_review_artifact as review

KIT = Path(__file__).resolve().parents[4] / "channels" / "the-second-take" / "visual-kit"


def _questions():
    return review.review_questions(str(KIT.parent / "videos" / "fixture"))


def test_question_text_is_read_from_the_style_bible():
    q = _questions()
    assert set(q) == set(review.INVARIANT_IDS)
    assert q["texture-strip"] == "No rig-register card introduces a sub-outline micro-pattern texture."


def test_only_authorized_machine_rows_exist():
    assert set(review.INVARIANT_IDS) == {
        "support-contact", "relative-scale", "place-owner", "lettering-register",
        "lettering-fidelity", "crowd", "texture-strip",
    }


def test_applicability_uses_canonical_questions_and_substitutes_owner_literal():
    q = _questions()
    shot = {"source": "ai-gen", "place": "hall", "place_owner": "Poyais Bank",
            "figures": {"crowd": True}, "still_prompt": "A sign reads 'Poyais Bank'."}
    rows = review.applicable_invariants(shot, "L01", ["one", "two"], set(),
                                        {"hall": "Poyais Bank"}, q)
    assert [slug for slug, _ in rows] == ["relative-scale", "place-owner", "crowd",
                                          "lettering-register", "lettering-fidelity"]
    assert rows[1][1] == q["place-owner"].replace("<LITERAL>", "Poyais Bank")


def test_support_contact_is_filtered_by_named_cast_and_seated_signal():
    q = _questions()
    assert review.applicable_invariants({}, "L01", ["cast"], {"L01"}, questions=q)[0] == (
        "support-contact", q["support-contact"])
    assert not review.applicable_invariants({}, "L01", [], {"L01"}, questions=q)


def test_asset_rows_use_only_the_texture_strip_identifier():
    assert review.invariants_for("_staging/fig-cast--pose.png") == ("texture-strip",)
    assert review.invariants_for("refs/env/scene-style-tile.png") == ("texture-strip",)
    assert review.invariants_for("refs/env/ordinary-prop.png") == ()


def test_missing_requested_asset_fails_clear(tmp_path):
    with pytest.raises(SystemExit, match="no PNG"):
        review.pending_assets(str(tmp_path / "_staging"), [str(tmp_path / "missing.png")])


def test_asset_skeleton_preserves_the_stamp_input_shape(tmp_path):
    staging = tmp_path / "_staging"
    staging.mkdir()
    frame = staging / "fig-cast--pose.png"
    frame.write_bytes(b"PNG")
    pending = review.pending_assets(str(staging))
    record = next(iter(review.asset_verdict_skeleton(pending, staging=str(staging))["figures"].values()))
    assert set(record) == {"canonical_sha256", "expression_sha256", "verdicts", "reviewer", "date"}
    assert record["verdicts"] == {"texture-strip": ""}


def test_board_embeds_images_at_ordinary_scale(tmp_path):
    frame = tmp_path / "frame.png"
    Image.new("RGB", (64, 36), "white").save(frame)
    card = {"sid": "L01", "label": "scene", "path": str(frame), "cls": "tableau",
            "vo": "line", "anim": "—", "flagged": False, "reason": "",
            "review_status": "unreviewed", "invariants": [], "canon": []}
    page, _bytes = review.build([card], "Review", "", 1600, 82)
    assert "data:image/" in page and "L01" in page
    assert "crop_battery" not in page


def _scene_video(tmp_path):
    video = tmp_path / "channels" / "x" / "videos" / "v"
    scenes = video / "assets" / "scenes"
    scenes.mkdir(parents=True)
    shots = {
        "long_form": {"shots": [
            {"id": "L01", "source": "ai-gen", "stage": "counter", "stage_role": "base",
             "still_prompt": "Cobalt daylight crosses walnut shelves.",
             "notes": "Palette basis: cobalt field — high-skylight daylight crosses walnut shelves."},
            {"id": "L02", "source": "ai-gen", "stage": "counter", "stage_role": "delta",
             "still_prompt": "The held counter gains a brass rail.", "notes": ""},
        ]}
    }
    (video / "shots.json").write_text(__import__("json").dumps(shots), encoding="utf-8")
    manifest = {"scenes": [{"shot_id": "L02", "flagged": False,
                             "notes": "manifest reason", "review_status": "unreviewed"}]}
    (scenes / "manifest.json").write_text(__import__("json").dumps(manifest), encoding="utf-8")
    frame = scenes / "L02.png"
    image = Image.new("RGB", (160, 90), (230, 120, 25))
    image.paste((20, 190, 200), (80, 0, 160, 90))
    image.save(frame)
    return video


def test_palette_basis_inherits_from_stage_base():
    shots = {
        "L01": {"stage": "s", "stage_role": "base", "notes": "Palette basis: umber — window light."},
        "L02": {"stage": "s", "stage_role": "delta", "notes": ""},
    }
    assert review.palette_basis_by_stage(shots) == {"s": "Palette basis: umber — window light."}


def test_scene_card_exposes_prompt_stage_basis_and_manifest_reason(tmp_path):
    cards = review.collect(str(_scene_video(tmp_path)), None)
    assert len(cards) == 1
    card = cards[0]
    assert card["still_prompt"] == "The held counter gains a brass rail."
    assert card["stage"] == "counter"
    assert card["palette_basis"].startswith("Palette basis: cobalt field")
    assert card["reason"] == "manifest reason"


def test_palette_card_uses_165_to_240_cool_pair_without_gating(tmp_path):
    card = review.collect(str(_scene_video(tmp_path)), None)[0]
    assert card["palette"]["cool_pair_chroma"] > 0
    assert card["palette"]["complementary_pair_chroma"] > 0
    assert card["flagged"] is False
    assert card["review_status"] == "unreviewed"


def test_scene_card_html_renders_prompt_stage_basis_and_advisories(tmp_path):
    card = review.collect(str(_scene_video(tmp_path)), None)[0]
    page, _ = review.build([card], "Review", "", 1600, 82)
    for text in ("still_prompt:", "counter", "Palette basis: cobalt field",
                 "warm:", "cool:", "complementary pair:"):
        assert text in page


def test_staging_assets_card_uses_safe_defaults(tmp_path, monkeypatch):
    video = tmp_path / "channels" / "x" / "videos" / "v"
    video.mkdir(parents=True)
    (video / "shots.json").write_text('{"long_form":{"shots":[]}}', encoding="utf-8")
    staging = tmp_path / "kit" / "_staging"
    staging.mkdir(parents=True)
    frame = staging / "fig-cast--pose.png"
    Image.new("RGB", (64, 96), "red").save(frame)
    out = tmp_path / "review.html"
    monkeypatch.setattr(sys, "argv", ["build_review_artifact.py", "--video", str(video),
                                      "--out", str(out), "--staging", str(staging),
                                      "--assets", str(frame)])
    review.main()
    page = out.read_text(encoding="utf-8")
    assert "fig-cast--pose" in page and "still_prompt: —" in page
    assert "palette basis: —" in page and "complementary pair: —" in page

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

"""Tests for the P4b content taxonomy and bounded format templates (creator-001, task 2).

These are pure data files (JSON-compatible YAML, i.e. literal JSON with a .yaml
extension) parsed directly with json.loads — no YAML dependency and no executable
behavior lives here. See docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md
Task 2 and orgs/figment/research/r18-instagram-content-playbook.md §1-§3.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

CONTENT_DIR = Path(__file__).resolve().parent.parent


def load(name: str) -> dict:
    return json.loads((CONTENT_DIR / name).read_text(encoding="utf-8"))


def ids(data: dict) -> list[str]:
    return [t["id"] for t in data["templates"]]


def carousels() -> list[dict]:
    return load("carousel-templates.yaml")["templates"]


def by_id(templates: list[dict], template_id: str) -> dict:
    return next(t for t in templates if t["id"] == template_id)


# --- Step 2.1: the seven content types + weekly mix + portfolio weights ---


def test_taxonomy_types_and_weekly_mix():
    data = load("taxonomy.yaml")
    assert [row["id"] for row in data["types"]] == list("ABCDEFG")
    assert data["weekly"] == {"reels": 3, "carousels": 3, "singles": 1, "stills": 14, "videos": 3}
    assert data["still_weights"] == {"A": 36, "B": 21, "C": 21, "D": 14, "E": 7}
    assert data["types"][5]["policy"] == "substitution-only"


def test_taxonomy_motion_is_a_surface_not_a_still_weight():
    data = load("taxonomy.yaml")
    assert "G" not in data["still_weights"]
    motion = next(row for row in data["types"] if row["id"] == "G")
    assert motion["policy"] == "motion-surface"


def test_taxonomy_surfaces():
    data = load("taxonomy.yaml")
    assert data["surfaces"]["still"] == {"aspect": "3:4", "width": 1080, "height": 1440}
    assert data["surfaces"]["reel"] == {"aspect": "9:16", "width": 1080, "height": 1920}


# --- Step 2.2: CT-1..CT-7, lifted exactly from r18 §1-§3 ---


def test_carousel_template_ids():
    assert ids(load("carousel-templates.yaml")) == [f"CT-{i}" for i in range(1, 8)]


def test_carousel_slot_counts_are_bounded_to_five():
    assert all(2 <= len(t["slots"]) <= 5 for t in carousels())


def test_carousel_slot_one_never_allows_filler():
    assert all("F" not in t["slots"][0]["allowed_types"] for t in carousels())


def test_carousel_every_template_has_caption_and_hashtag_constraints():
    assert all("caption_rule" in t and "max_hashtags" in t for t in carousels())
    # r18 §5: 0 hashtags on stills and carousels.
    assert all(t["max_hashtags"] == 0 for t in carousels())


def test_carousel_ct6_is_swipe_reveal_with_outfit_not_skin_payoff():
    ct6 = by_id(carousels(), "CT-6")
    assert ct6["name"] == "swipe-reveal"
    assert ct6["payoff"] == "outfit-not-skin"


# --- Step 2.3: RT-1..RT-6 + common delivery constraints ---


def test_reel_template_ids():
    data = load("reel-templates.yaml")
    assert ids(data) == [f"RT-{i}" for i in range(1, 7)]


def test_reel_delivery_constraints_shared_by_every_template():
    data = load("reel-templates.yaml")
    assert data["delivery"] == {
        "aspect": "9:16",
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "audio_lufs": -14,
        "burned_captions": False,
    }


def test_reel_hashtags_never_exceed_the_caption_policy_cap():
    data = load("reel-templates.yaml")
    assert all(t["max_hashtags"] <= data["caption_policy"]["max_hashtags"] for t in data["templates"])


def test_reel_templates_are_bounded_inputs_not_executable_upload_behavior():
    data = load("reel-templates.yaml")
    for template in data["templates"]:
        assert isinstance(template["length_seconds"], list) and len(template["length_seconds"]) == 2
        assert "hook" in template and "cuts" in template and "audio" in template
        assert "upload" not in json.dumps(template).lower()
        assert "publish" not in json.dumps(template).lower()


# --- Cross-file: bounded, no invented formats, no banned vocabulary ---


def test_no_content_file_declares_more_formats_than_r18_specifies():
    assert len(load("carousel-templates.yaml")["templates"]) == 7
    assert len(load("reel-templates.yaml")["templates"]) == 6


# Mirrors look-spec-v2.md §4a's banned-term families (soft-glam, bronzer/contour,
# plastic-skin, lip, brow/lash, styling-signature, body, light, and age). Do not put
# banned strings in production prompts or templates; this list only exists to detect
# them. The two bare-numeral entries ("18", "19") are age numerals per §4a and are
# checked with a word boundary so they do not false-positive on unrelated numbers
# that happen to contain those digits (e.g. a 1920px height or an "r18" doc citation).
BANNED_PHRASES = {
    "soft glam", "glam", "glamorous", "beauty shot", "professional makeup", "makeup artist",
    "full face of makeup", "beat", "snatched", "editorial", "high fashion", "vogue", "striking",
    "sultry", "smouldering", "seductive", "alluring",
    "bronzer", "bronzed", "luminous bronzer", "sun-kissed", "gilded", "contour", "contoured",
    "sculpted cheekbones", "chiselled", "defined jawline", "highlighter", "strobing", "cut crease",
    "baked", "bake-and-brush",
    "flawless skin", "poreless", "airbrushed", "porcelain skin", "glass skin", "glowing", "radiant",
    "luminous", "dewy glow", "filtered", "retouched", "perfect complexion",
    "glossy nude lip", "full lips", "plump lips", "pouty lips", "plush lips", "overlined",
    "lip filler",
    "groomed full brow", "perfectly arched brows", "laminated brows", "bold brows",
    "dramatic lashes", "lash extensions", "winged eyeliner", "smoky eye",
    "gold hoops", "gold hoop earrings", "statement jewelry", "layered gold", "caramel balayage",
    "honey balayage", "money piece", "blowout", "salon hair",
    "hourglass", "curvaceous", "voluptuous", "busty", "tiny waist", "snatched waist",
    "studio lighting", "beauty lighting", "softbox", "ring light", "seamless backdrop",
    "golden hour glow", "cinematic lighting", "professional photography",
    "girl", "young girl", "teen", "teenage", "schoolgirl", "high school", "barely legal",
    "youthful", "baby face", "babyface", "childlike", "innocent", "doll-like", "petite little",
    "cute little", "tiny body", "pigtails", "uniform", "18", "19",
}
_BARE_NUMERAL_PHRASES = {"18", "19"}


def _phrase_present(lowered_text: str, phrase: str) -> bool:
    if phrase in _BARE_NUMERAL_PHRASES:
        return re.search(rf"\b{phrase}\b", lowered_text) is not None
    return phrase in lowered_text


def test_no_content_file_carries_a_banned_look_spec_term():
    for name in ("taxonomy.yaml", "carousel-templates.yaml", "reel-templates.yaml"):
        lowered = (CONTENT_DIR / name).read_text(encoding="utf-8").lower()
        hits = sorted(p for p in BANNED_PHRASES if _phrase_present(lowered, p))
        assert not hits, f"{name} contains banned look-spec-v2 section-4a term(s): {hits}"

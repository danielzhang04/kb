#!/usr/bin/env python3
"""Regression contract for Forge fixes 1 and 4 (plain asserts; no provider calls).

Run: py -3 .claude/skills/image-generation/scripts/test_forge_seed_roles_and_delta.py

The batch item carries ordered ``seed_roles`` dictionaries.  Their order is the provider-part
order and each dictionary is ``{path, role, character?}``; Forge must derive its ordinal prose
from that final list after retry prepending/deduplication, then preflight the agreement.
"""
import contextlib
import copy
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from forge import (Kit, RETRY_OVERLAY_SCHEMA, SEED_CAP, cmd_batch, cmd_retry_batch,
                   placement_delta, preflight_batch)
from conftest import isolate_staging, stamp_kit
import forge as forge_module


KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]
PNG = b"\x89PNG\r\n\x1a\n"


def _kit():
    kit = Kit(str(KIT_DIR), dry=True)
    # `Kit` finds the repo root by walking up to the env marker, which exists only in the primary
    # checkout; a worktree has none, so pin the root the fixture's relative seed paths are written
    # against instead of resolving them off the filesystem root.
    kit.root = str(ROOT)
    # Per-test staging, never the channel's own: `Kit.staging` is the LIVE P3 review store.
    return isolate_staging(kit)


def _write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f)


def _drop_record(store, stem):
    """Withdraw one named asset's ruling. Records are keyed by kit-relative PATH, so the frame
    a key ends in is what identifies it — a bare stem names no record at all."""
    for key in [k for k in store["figures"] if k.endswith("/" + stem + ".png")]:
        store["figures"].pop(key)


def _batch(kit, shots_path, out_path, scope=None):
    # P3: the channel's standing library and this video's approved frames are REVIEWED assets.
    stamp_kit(kit, os.path.dirname(shots_path))
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_batch(kit, shots_path, out_path, shots=scope)
    with open(out_path, encoding="utf-8") as f:
        return json.load(f)


# L28's authored prose. P8 keys each STEP-1 card on the clause derived from its OWN beat, so the
# fixture stages the cards under the names the builder computes from this text, never a hard-coded
# recipe-only stem.
L28_PROMPT = ("`terry-johnson` and `miniscribe-rep` stand beside the drive "
              "assembly line, with `prop-drive` on the workbench.")
L28_CARDS = {c: forge_module.figure_frame_name(c, None, None,
                                           forge_module.beat_clause(L28_PROMPT, c))
             for c in ("terry-johnson", "miniscribe-rep")}


def _l28_retry_fixture():
    """The audited bad order: place, Terry, MiniScribe, then the drive prop."""
    video = tempfile.mkdtemp()
    scenes = os.path.join(video, "assets", "scenes")
    os.makedirs(scenes)
    place = os.path.join(scenes, "L26.png")
    with open(place, "wb") as f:
        f.write(PNG)
    _write_json(os.path.join(scenes, "manifest.json"), {
        "video_slug": "l28-role-regression",
        "shots": [{"shot_id": "L26", "file": "assets/scenes/L26.png",
                   "review_status": "verified"}],
    })
    shots = os.path.join(video, "shots.json")
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "l28-role-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [{
            "id": "L28", "source": "ai-gen", "stage": "factory", "stage_role": "base",
            "place_anchor": "assets/scenes/L26.png",
            "assets": {"prop-drive": "channels/the-second-take/visual-kit/refs/env/prop-drive.png"},
            "still_prompt": L28_PROMPT,
        }]},
    })
    overlay = os.path.join(video, "retry.json")
    _write_json(overlay, {
        "schema": RETRY_OVERLAY_SCHEMA, "video_slug": "l28-role-regression",
        "entries": [{
            "kind": "scene", "shot": "L28", "name": "L28-role-retry",
            "defect": "mechanism",
            # This is already the native place seed.  Retry stable-dedup moves it to FIRST.
            "prepend_seeds": ["assets/scenes/L26.png"],
        }],
    })
    return video, shots, overlay, os.path.join(video, "spec.json")


def _l28_retry_spec(entries=None):
    video, shots, overlay, out = _l28_retry_fixture()
    if entries is not None:      # same fixture, a different surgical authority under test
        _write_json(overlay, {"schema": RETRY_OVERLAY_SCHEMA,
                              "video_slug": "l28-role-regression", "entries": entries})
    kit = _kit()
    # A staged STEP-1 is reusable only with an all-pass review record pinned to its bytes (C-6),
    # so the fixture stages the frames the way an approved run leaves them: reviewed.
    reviewed = {}
    for stem in L28_CARDS.values():
        frame = os.path.join(kit.staging, stem + ".png")
        # DISTINCT pixels per card, keyed against the KIT the gate reads through: a ruling follows
        # the pixels, so three cards sharing one PNG constant would (correctly) be one asset, and a
        # root-keyed record is one the gate cannot look up at all.
        pixels = PNG + hashlib.sha256(stem.encode()).digest()
        with open(frame, "wb") as f:
            f.write(pixels)
        reviewed[forge_module.store_key(frame, kit.kit)] = {
            "canonical_sha256": hashlib.sha256(pixels).hexdigest(), "expression_sha256": None,
            "verdicts": {"rig": "pass"}, "reviewer": "fresh-eyes", "date": "2026-08-04"}
    _write_json(os.path.join(kit.staging, "review.json"), {"figures": reviewed})
    # P3: the plate and the prop this slate seeds are reviewed assets too — same store, same
    # key shape, merged on top of the STEP-1 records the fixture just pinned.
    stamp_kit(kit, video)
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_retry_batch(kit, shots, out, overlay)
    with open(out, encoding="utf-8") as f:
        return kit, json.load(f)


def _scene(spec, name):
    return next(item for item in spec if item["name"] == name)


def test_l28_final_seed_roles_and_ordinals_follow_the_final_retry_order():
    kit, spec = _l28_retry_spec()
    scene = _scene(spec, "L28-role-retry")
    stems = [Path(seed).stem for seed in scene["seed"]]
    assert stems == ["L26", L28_CARDS["terry-johnson"], L28_CARDS["miniscribe-rep"],
                     "prop-drive"], stems
    assert scene["seed_roles"] == [
        {"path": scene["seed"][0], "role": "place", "character": None},
        {"path": scene["seed"][1], "role": "figure", "character": "terry-johnson"},
        {"path": scene["seed"][2], "role": "figure", "character": "miniscribe-rep"},
        {"path": scene["seed"][3], "role": "prop", "character": "prop-drive"},
    ], scene.get("seed_roles")
    for clause in (
        "The FIRST image is the destination place",
        "The SECOND image is `terry-johnson`'s complete STEP-1 figure",
        "The THIRD image is `miniscribe-rep`'s complete STEP-1 figure",
        "The FOURTH image is the `prop-drive` prop canonical",
    ):
        assert clause in scene["delta"], scene["delta"]


def test_preflight_rejects_seed_role_metadata_that_disagrees_with_final_seed_prose():
    kit, spec = _l28_retry_spec()
    bad = copy.deepcopy(spec)
    scene = _scene(bad, "L28-role-retry")
    scene["seed_roles"] = list(reversed(scene["seed_roles"]))
    try:
        preflight_batch(kit, bad, force=True, dry=True)
    except SystemExit as exc:
        message = str(exc).lower()
        assert "seed role" in message and "l28-role-retry" in message, str(exc)
    else:
        assert False, "preflight must reject ordinal prose/role metadata that lies about final seed order"


def test_preflight_rejects_semantically_false_roles_even_when_prose_was_rebuilt_from_them():
    kit, spec = _l28_retry_spec()
    scene = _scene(spec, "L28-role-retry")
    scene["seed_roles"][0]["role"] = "figure"
    scene["seed_roles"][0]["character"] = "terry-johnson"
    scene["delta"] = placement_delta(scene["payload"], scene["seed_roles"])
    try:
        preflight_batch(kit, spec, force=True, dry=True)
    except SystemExit as exc:
        assert "not truthful" in str(exc), str(exc)
    else:
        assert False, "a place image relabelled as a figure must hard-fail preflight"


def test_preflight_rejects_roleless_manual_composite_specs():
    kit, spec = _l28_retry_spec()
    scene = _scene(spec, "L28-role-retry")
    scene.pop("seed_roles")
    try:
        preflight_batch(kit, spec, force=True, dry=True)
    except SystemExit as exc:
        assert "seed_roles" in str(exc), str(exc)
    else:
        assert False, "a hand-written composite may not bypass seed-role truth by omitting metadata"


def _delta_fixture(delta_primitives=None):
    video = tempfile.mkdtemp()
    shots = os.path.join(video, "shots.json")
    delta = {
        "id": "D02", "source": "ai-gen", "stage": "factory", "stage_role": "delta",
        "still_prompt": ("The same factory, with `miniscribe-rep`, `action-powerstance`, and "
                         "`expr-smug`, while only the contract on the desk changes."),
    }
    if delta_primitives is not None:
        # New explicit, per-character declaration: no generic primitive may enter a delta otherwise.
        delta["delta_primitives"] = delta_primitives
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "delta-seed-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [
            {"id": "D01", "source": "ai-gen", "stage": "factory", "stage_role": "base",
             "still_prompt": ("`miniscribe-rep`, `action-powerstance`, and `expr-smug` stand "
                              "at a factory desk."),},
            delta,
        ]},
    })
    return shots, os.path.join(video, "spec.json")


# P1 PIN (taste-forensics G2) — the DELTA RECIPE: parent + canonical, within SEED_CAP. This is the
# recipe behind the one liked money-delta chain, so no later proposal may buy an attribute (P9's face
# authority above all) with an extra delta SEED; role prose is the only channel that may widen.
def test_whole_scene_delta_uses_only_parent_and_canonical_identity_by_default():
    shots, out = _delta_fixture()
    spec = _batch(_kit(), shots, out)
    delta = _scene(spec, "D02")
    assert [Path(seed).stem for seed in delta["seed"]] == ["D01", "miniscribe-rep"], delta["seed"]
    assert delta["seed_roles"] == [
        {"path": delta["seed"][0], "role": "parent", "character": None},
        {"path": delta["seed"][1], "role": "canonical", "character": "miniscribe-rep"},
    ], delta.get("seed_roles")
    # The budget half of the recipe, pinned where the recipe lives: four is the ceiling, and the
    # default delta spends only two of it. A role that starts costing a seed shows up here first.
    assert SEED_CAP == 4, SEED_CAP
    assert len(delta["seed"]) == 2 <= SEED_CAP, delta["seed"]


# P1 PIN (taste-forensics G2) — the other half of the delta recipe: a primitive enters a delta ONLY
# on an explicit per-character declaration, and parent + canonical still lead. Protects the liked
# chain against any later proposal that widens the delta seed set implicitly.
def test_delta_allows_only_explicitly_proven_necessary_primitives_and_labels_them_in_order():
    shots, out = _delta_fixture({"miniscribe-rep": ["action-powerstance"]})
    spec = _batch(_kit(), shots, out)
    delta = _scene(spec, "D02")
    assert [Path(seed).stem for seed in delta["seed"]] == [
        "D01", "miniscribe-rep", "action-powerstance"], delta["seed"]
    assert len(delta["seed"]) <= SEED_CAP, delta["seed"]
    assert delta["seed_roles"] == [
        {"path": delta["seed"][0], "role": "parent", "character": None},
        {"path": delta["seed"][1], "role": "canonical", "character": "miniscribe-rep"},
        {"path": delta["seed"][2], "role": "pose", "character": "miniscribe-rep"},
    ], delta.get("seed_roles")
    assert "expr-smug" not in "\n".join(map(str, delta["seed"])), delta["seed"]


# P9 (taste-forensics G2, COMPLETED 10b) — FACE OWNERSHIP ON A DELTA. The recipe above is pinned
# (parent + canonical, no STEP-1 card), so the authority the r2 verifier's parked L34 "CANONICAL
# EXPRESSION LEAK" found missing is bought with PROSE, never a fifth seed. G2 gave the parent the
# held shape but left the canonical a REGISTER grant; the L34 identification proved that partial
# grant is itself the leak licence, because it keeps the slate's strongest face image nameable as a
# face authority. On a delta the grant is WITHDRAWN and the parent owns the face outright.
def test_delta_prose_gives_the_held_face_to_the_parent_and_withdraws_it_from_the_canonical():
    shots, out = _delta_fixture()
    spec = _batch(_kit(), shots, out)
    delta = _scene(spec, "D02")
    text = delta["delta"]
    assert "STANCE and EXPRESSION" in text and "(eye/brow/mouth) from its pixels" in text, text
    assert "unless this request also seeds a pose or expression reference" in text, text
    assert "never re-read off the canonical" in text, text
    # the REDUCTION: no register grant survives on a canonical sharing its slate with a parent.
    assert "RENDER REGISTER" not in text, text
    assert "never the face" in text, text
    assert "identity, head tone, hair, the pinned costume" in text, text
    # face authority costs no seed — the P1 delta-recipe pin, restated at the point of change.
    assert len(delta["seed"]) == 2, delta["seed"]


def _two_figure_delta_fixture(delta_primitives=None):
    """The AT-CAP legal delta: parent + canonical A + canonical B + one proved primitive == 4."""
    video = tempfile.mkdtemp()
    shots = os.path.join(video, "shots.json")
    delta = {
        "id": "D02", "source": "ai-gen", "stage": "boardroom", "stage_role": "delta",
        "still_prompt": ("The same boardroom, `miniscribe-rep` now `expr-smug` while "
                         "`terry-johnson` holds still, as the contract changes hands."),
    }
    if delta_primitives is not None:
        delta["delta_primitives"] = delta_primitives
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "two-figure-delta-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [
            {"id": "D01", "source": "ai-gen", "stage": "boardroom", "stage_role": "base",
             "still_prompt": "`miniscribe-rep` and `terry-johnson` stand at the boardroom table."},
            delta,
        ]},
    })
    return shots, os.path.join(video, "spec.json")


# P9 FIX ROUND 1 (I-1) — the expression release is per-CHARACTER. A two-figure delta may seed one
# proved expression and still sit at the cap, so an unscoped "replaces any expression held in a
# parent scene" would license putting THIS figure's mouth on the OTHER figure's held face: the same
# leak the parked L34 defect exhibits, one level down.
def test_a_proved_expression_on_a_two_figure_delta_releases_only_its_own_character():
    shots, out = _two_figure_delta_fixture({"miniscribe-rep": ["expr-smug"]})
    spec = _batch(_kit(), shots, out)
    delta = _scene(spec, "D02")
    assert [Path(seed).stem for seed in delta["seed"]] == [
        "D01", "miniscribe-rep", "terry-johnson", "expr-smug"], delta["seed"]
    assert len(delta["seed"]) == SEED_CAP, delta["seed"]      # the shape is legal AT the cap
    text = delta["delta"]
    assert ("replaces the expression `miniscribe-rep` holds in the parent scene, and no other "
            "figure's") in text, text
    # the unscoped wording must not survive anywhere in the request
    assert "replaces any expression held in a parent scene" not in text, text
    # and the untouched figure keeps its held face from the parent's pixels
    assert "take each held figure's STANCE and EXPRESSION" in text, text


def _prose(*roles):
    return forge_module.seed_roles_text(
        [forge_module._seed_role(f"refs/{name}.png", role, character)
         for role, name, character in roles])


# FINAL FIX ROUND (I-4 + I-5, 2026-08-12) — the canonical role string, on both its counts.
#
# I-4: "identity, head tone, hair and the pinned costume come from THIS IMAGE ONLY" contradicted the
# STEP-1 card payload, which sends the beat's DERIVED clause and lets it author dress ("Where that
# description AUTHORS clothing…"). Two of the strongest instructions in one request disagreed, and
# which one won was the model's call. The costume grant is now conditional in the same direction the
# payload already is, so the pair states one law.
#
# I-5: the role also carried a per-cast-member conditional enumerating what does NOT fix the
# expression's shape. It repeated on EVERY canonical, so a two-cast delta slate — the at-cap legal
# shape — pushed its prose past the ~600-1,100-char adherence band this file's recipes are held to.
# The parent and expression roles each assert their own ownership positively, so the enumeration is
# redundant and is dropped rather than restated once per figure.
def test_the_canonical_role_states_a_conditional_costume_and_no_this_image_only_claim():
    card = _prose(("canonical", "miniscribe-rep", "miniscribe-rep"))
    assert "unless this beat authors a change" in card, card
    assert "come from this image only" not in card, card
    # the register grant survives the compression, shape-scoped rather than enumerated
    assert "how eyes, brows and mouth are DRAWN" in card, card
    assert "never which shape they take where another seed carries it" in card, card
    assert "Never the pose" in card, card


# 10b — the reduction is CONDITIONAL on a PARENT sharing the slate. A fresh (no-parent) recipe's
# canonical is the only face authority such a slate has, so its register grant stands unchanged;
# withdrawing it there would leave the face unowned, which is the opposite defect.
def test_the_register_grant_is_withdrawn_only_when_a_parent_shares_the_slate():
    fresh = _prose(("canonical", "miniscribe-rep", "miniscribe-rep"),
                   ("pose", "action-powerstance", "miniscribe-rep"))
    assert "RENDER REGISTER" in fresh, fresh
    assert "never the face" not in fresh, fresh

    delta = _prose(("parent", "D01", None), ("canonical", "miniscribe-rep", "miniscribe-rep"))
    assert "RENDER REGISTER" not in delta, delta
    assert "never the face" in delta, delta
    # the surviving grants, and the pose refusal, are unchanged by the reduction
    for kept in ("identity, head tone, hair, the pinned costume", "unless this beat authors a "
                 "change", "Never the pose"):
        assert kept in delta, delta

    # a SECOND canonical on the same delta slate is reduced too — the leak is per-slate, not
    # per-figure, and an unreduced second canonical is the at-cap two-figure leak one level down.
    two_cast = _prose(("parent", "D01", None),
                      ("canonical", "miniscribe-rep", "miniscribe-rep"),
                      ("canonical", "terry-johnson", "terry-johnson"))
    assert "RENDER REGISTER" not in two_cast, two_cast
    assert two_cast.count("never the face") == 2, two_cast


def test_the_two_cast_delta_slate_prose_stays_inside_the_adherence_band():
    """The canonical role repeats ONCE PER CAST MEMBER, so its length is multiplied by every slate
    that seeds two. The two-cast delta (parent + canonical A + canonical B) is the shape I-5
    measured: the per-figure conditional pushed it past the ~600-1,100-char band these recipes are
    held to, and instructions read after the band are read weakly. Upper bound only — the prose may
    shrink further, never regrow."""
    two_cast_delta = _prose(("parent", "D01", None),
                            ("canonical", "miniscribe-rep", "miniscribe-rep"),
                            ("canonical", "terry-johnson", "terry-johnson"))
    assert len(two_cast_delta) < 1100, (len(two_cast_delta), two_cast_delta)
    # the other two live slate shapes stay inside it as well
    one_cast_delta = _prose(("parent", "D01", None),
                            ("canonical", "miniscribe-rep", "miniscribe-rep"))
    card = _prose(("canonical", "miniscribe-rep", "miniscribe-rep"),
                  ("expression", "expr-smug", "miniscribe-rep"),
                  ("pose", "action-powerstance", "miniscribe-rep"))
    assert len(one_cast_delta) < 1100, (len(one_cast_delta), one_cast_delta)
    assert len(card) < 1100, (len(card), card)
    # and no canonical on any of them still carries the dropped enumeration
    for slate in (two_cast_delta, one_cast_delta, card):
        assert "It fixes the" not in slate, slate


# P9 — the COMPLETENESS WALK: every recipe shape `seed_roles_text` can emit leaves zero attribute
# (identity, face shape, face render register, pose, costume, set) unowned.
def test_every_recipe_shape_states_complete_attribute_ownership():
    card = _prose(("canonical", "miniscribe-rep", "miniscribe-rep"),
                  ("expression", "expr-smug", "miniscribe-rep"),
                  ("pose", "action-powerstance", "miniscribe-rep"))
    for owned in ("identity, head tone, hair, the pinned costume unless this beat authors a change",
                  "RENDER REGISTER", "copy only eye/brow/mouth shape",
                  "copy only body pose, hands and limb placement"):
        assert owned in card, card

    scene = _prose(("figure", "fig-miniscribe-rep", "miniscribe-rep"),
                   ("place", "L26", None), ("prop", "prop-drive", "prop-drive"))
    # the STEP-1 card owns the whole figure; the place owns the set, so the card's own ground is
    # explicitly refused rather than left for the model to guess at.
    assert "identity, costume, pose, hands and expression exactly" in scene, scene
    assert "its blank ground is not this frame's set" in scene, scene
    assert "the destination place — preserve its set" in scene, scene

    delta = _prose(("parent", "D01", None), ("canonical", "miniscribe-rep", "miniscribe-rep"))
    assert "preserve its held set and existing composition" in delta, delta
    assert "STANCE and EXPRESSION" in delta, delta
    # face SHAPE *and* face register are both the parent's here, so the walk is still complete
    # without a canonical register grant — the parent's ownership is stated outright, not implied.
    assert "shape and register both" in delta, delta
    assert "Never the pose" in delta, delta

    # a delta that DOES author a change: the seeded reference takes the attribute back off the
    # parent, stated on the reference itself as well as on the parent — and scoped to ITS OWN
    # character, never to whatever face the parent frame happens to hold (fix round 1).
    changed = _prose(("parent", "D01", None), ("canonical", "miniscribe-rep", "miniscribe-rep"),
                     ("expression", "expr-smug", "miniscribe-rep"))
    assert ("replaces the expression `miniscribe-rep` holds in the parent scene, and no other "
            "figure's") in changed, changed

    crowd = _prose(("place", "L26", None), ("crowd", "crowd-exemplar", None))
    # 8h fix round 1. The grant now includes the bounded head-tone set the per-video exemplar is
    # minted to carry; "ONLY … proportion and face tier" excluded it at the payload, so P4's
    # mechanism never reached a frame. What this assertion guards is the ROLE PROSE — it is NOT a
    # P1 pin and never was: the P1 crowd pins (face tier, squat proportion, four-digit hand) live
    # in test_forge_figures.py and are untouched, so no P1 coverage passes through here to be
    # weakened. Within its own scope the pin still comes out strictly stronger:
    #   * the granted attributes stay named verbatim and adjacent (`anonymous crowd proportion`,
    #     `face tier`), so nothing the single old assertion checked is now unchecked;
    #   * the EXCLUDED half is pinned for the first time. No later edit can quietly widen the grant
    #     into dress/period/setting and homogenize every crowd in the video off one anchor frame —
    #     the exact failure Daniel's "anchor, not a uniform" amendment names, and one the old
    #     assertion would have passed green.
    assert "anonymous crowd proportion, face tier" in crowd, crowd
    assert "bounded 2-3 flat head-tone set" in crowd, crowd
    assert "take nothing of its dress, period or setting" in crowd, crowd
    assert "preserve its set, palette, outline weight and lighting" in crowd, crowd

    plate = _prose(("place", "L26", None))
    assert "preserve its set, palette, outline weight and lighting" in plate, plate

    tile = _prose((forge_module.STYLE_ANCHOR_ROLE, "style-tile", None))
    assert "Take NOTHING else" in tile and "PALETTE SATURATION and TEMPERATURE" in tile, tile


def test_manual_delta_declaration_must_bind_primitive_to_the_authored_character():
    shots, out = _delta_fixture()
    kit = _kit()
    spec = _batch(kit, shots, out)
    delta = _scene(spec, "D02")
    pose = next(a["file"] for a in kit.reg["assets"] if a["name"] == "action-powerstance")
    delta["delta_primitives"] = {"not-in-cast": ["action-powerstance"]}
    delta["seed"].append(pose)
    delta["seed_roles"].append(
        {"path": pose, "role": "pose", "character": "not-in-cast"})
    delta["delta"] = placement_delta(delta["payload"], delta["seed_roles"])
    try:
        preflight_batch(kit, spec, force=True, dry=True)
    except SystemExit as exc:
        assert "not-in-cast" in str(exc) and "delta_primitives" in str(exc), str(exc)
    else:
        assert False, "manual specs may not declare a primitive under a character absent from the shot cast"


def test_expression_defect_scene_retry_routes_to_step1_remint_not_contradictory_scene_prose():
    video = tempfile.mkdtemp()
    shots = os.path.join(video, "shots.json")
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "expression-retry-regression",
        "long_form": {"aspect_ratio": "16:9", "shots": [{
            "id": "E01", "source": "ai-gen", "stage_role": "base",
            "still_prompt": "`miniscribe-rep`, `action-powerstance`, and `expr-smug` at a desk.",
        }]},
    })
    overlay = os.path.join(video, "retry.json")
    _write_json(overlay, {
        "schema": RETRY_OVERLAY_SCHEMA, "video_slug": "expression-retry-regression",
        "entries": [{
            "kind": "scene", "shot": "E01", "name": "E01-expression-retry",
            "defect": "expression",
            "instruction": "Replace the smug face with a worried expression.",
        }],
    })
    kit = _kit()
    stamp_kit(kit, video)       # P3: the primitives this retry resolves are reviewed assets
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_retry_batch(kit, shots, os.path.join(video, "spec.json"), overlay)
    except SystemExit as exc:
        message = str(exc).lower()
        assert "expression" in message and "step-1" in message, str(exc)
    else:
        assert False, "expression-defect scene retries must route to a STEP-1 remint"


def test_expression_defect_cannot_hide_inside_an_exact_scene_replacement():
    item = {
        "name": "E01", "seed": [], "seed_roles": [],
        "payload": "`miniscribe-rep` holds `expr-smug` at the desk.",
        "delta": "`miniscribe-rep` holds `expr-smug` at the desk.",
    }
    entry = {
        "kind": "scene", "shot": "E01", "name": "E01-expression-retry",
        "defect": "expression",
        "replace": {"from": "`expr-smug`", "to": "`expr-worried`"},
    }
    try:
        from types import SimpleNamespace
        from forge import _retry_scene
        with tempfile.TemporaryDirectory() as video:
            _retry_scene(item, {"id": "E01"}, entry,
                         SimpleNamespace(root=video, kit=video, staging=video),
                         video, "retry entry 1")
    except SystemExit as exc:
        message = str(exc).lower()
        assert "expression" in message and "step-1" in message, str(exc)
    else:
        assert False, "an expression-tag replacement must route to STEP-1"


def _added_seed_retry(added_seed):
    """(kit, spec) for a retry that ADDS one kit asset to a scene, in the retry law's legal shape.

    The native place frame is re-prepended — the reorder that supplies the surgical authority a
    seed/mechanism retry must carry — and `added_seed` rides alongside it as the genuine addition,
    which is the one path `added_role` has to classify on its own."""
    video = tempfile.mkdtemp()
    scenes = os.path.join(video, "assets", "scenes")
    os.makedirs(scenes)
    with open(os.path.join(scenes, "L26.png"), "wb") as f:
        f.write(PNG)
    shots = os.path.join(video, "shots.json")
    _write_json(shots, {
        "schema": "shots/1", "video_slug": "retry-reference-hole",
        "long_form": {"aspect_ratio": "16:9", "shots": [
            {"id": "L26", "source": "ai-gen", "place": "records-room", "stage_role": "base",
             "still_prompt": "A warm records room with a bare central table."},
            {"id": "R1", "source": "ai-gen", "place": "records-room", "stage_role": "base",
             "place_anchor": "assets/scenes/L26.png",
             "still_prompt": "The records room, its long table bare under the strip light."},
        ]},
    })
    overlay = os.path.join(video, "retry.json")
    _write_json(overlay, {
        "schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-reference-hole",
        "entries": [{
            "kind": "scene", "shot": "R1", "name": "R1-added-seed", "defect": "mechanism",
            "prepend_seeds": ["assets/scenes/L26.png", added_seed],
        }],
    })
    kit = _kit()
    stamp_kit(kit, video)
    out = os.path.join(video, "spec.json")
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_retry_batch(kit, shots, out, overlay)
    return kit, json.load(open(out, encoding="utf-8"))


def test_a_retry_added_kit_asset_carries_its_real_kind_and_passes_the_review_gate():
    """I-1. `added_role`'s fallback stamped `reference` on every retry-added seed, and `reference`
    was gate-exempt for the cast-mint path — so a retry overlay naming any kit prop, environment
    or primitive seeded a scene with no review record. The role must state what the seed IS.

    The overlay is the legal shape: a reorder of the native place seed (the surgical authority the
    retry law demands) carrying one genuinely ADDED kit prop alongside it."""
    kit, spec = _added_seed_retry("refs/env/prop-drive.png")
    scene = _scene(spec, "R1-added-seed")
    added = next(r for r in scene["seed_roles"] if r["path"].endswith("prop-drive.png"))
    assert added["role"] == "prop", scene["seed_roles"]
    assert added["role"] != "reference", scene["seed_roles"]
    # ... and with its ruling withdrawn the gate refuses it, exactly as any other prop
    store_path = os.path.join(kit.staging, "review.json")
    store = json.load(open(store_path, encoding="utf-8"))
    _drop_record(store, "prop-drive")
    _write_json(store_path, store)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        forge_module.cmd_gen(kit, spec, force=True, dry=True)
    assert "R1-added-seed: skip (seed awaits review)" in buf.getvalue(), buf.getvalue()
    assert "prop-drive" in buf.getvalue(), buf.getvalue()


# --- fix round 2: a registry KIND is not automatically a legal seed ROLE -------------------------

_SCHEMA_REJECT = "must contain valid path/role/character fields"


def test_a_retry_added_crowd_exemplar_gets_a_legal_role_and_is_gated():
    """The registry calls the exemplar `crowd-anchor`; the provider vocabulary calls that seed
    `crowd`. Passing the KIND through as a ROLE made it schema-illegal, so the batch died naming
    neither the asset nor the reason — the one asset class this most needed to gate."""
    kit, spec = _added_seed_retry("refs/base/crowd-exemplar.png")
    scene = _scene(spec, "R1-added-seed")
    added = next(r for r in scene["seed_roles"] if r["path"].endswith("crowd-exemplar.png"))
    assert added["role"] == "crowd", scene["seed_roles"]
    store_path = os.path.join(kit.staging, "review.json")
    store = json.load(open(store_path, encoding="utf-8"))
    _drop_record(store, "crowd-exemplar")
    _write_json(store_path, store)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        forge_module.cmd_gen(kit, spec, force=True, dry=True)
    assert "R1-added-seed: skip (seed awaits review)" in buf.getvalue(), buf.getvalue()
    assert "crowd-exemplar" in buf.getvalue(), buf.getvalue()


def test_a_retry_added_action_primitive_refuses_by_doctrine_not_by_schema():
    """`action` is how the registry spells 13 of its pose primitives; `cmd_batch` routes them as
    `pose`. The role must be the legal one — and then the character-binding law refuses it in
    words that name the asset, instead of a schema error naming nothing."""
    try:
        _added_seed_retry("refs/base/action-powerstance.png")
    except SystemExit as exc:
        message = str(exc)
        assert _SCHEMA_REJECT not in message, message
        assert "action-powerstance" in message, message
        assert "`pose` is not truthful" in message, message
    else:
        assert False, "a character-less pose primitive may not be hand-added by a retry"


def test_a_retry_added_identity_or_base_frame_routes_back_to_the_builder():
    """An identity/base frame's only truthful role is `canonical`, which names the character it
    draws — a binding only the builder can make. The refusal says so and names the frame."""
    for seed, stem in (("refs/bolivar/bolivar.png", "bolivar"), ("refs/base/base.png", "base")):
        try:
            _added_seed_retry(seed)
        except SystemExit as exc:
            message = str(exc)
            assert _SCHEMA_REJECT not in message, message
            assert stem in message and "BUILDER" in message, message
        else:
            assert False, f"a retry may not hand-add the {stem} identity/base frame"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("PASS test_forge_seed_roles_and_delta")

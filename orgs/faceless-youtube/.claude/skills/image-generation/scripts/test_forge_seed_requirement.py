#!/usr/bin/env python3
"""Plain-assert tests for what a gen must CARRY before it is allowed to run (repo has no pytest):
the zero-seed environment/style guard, and THE SEEDING LAW — a gen that cannot inherit a figure's
rig from an existing frame hard-errors at $0, before the API call.
Run: py -3 .claude/skills/image-generation/scripts/test_forge_seed_requirement.py"""
import contextlib, io, json, os, sys, tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
from forge import (Kit, cmd_batch, cmd_gen, figure_frame_name, merge_vocabulary, preflight_batch,
                   resolve_request_seeds, scale_anchor, seeding_law_violations, shot_cast,
                   placement_delta, depicts_figures, video_root_for)

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")

REFS = "channels/c/visual-kit/refs/"
REG = {
    "characters": {
        "base": {"base": REFS + "base/base.png"},
        "hq-banker": {"base": REFS + "hq-banker/hq-banker.png"},
        "pc-boxy": {"base": REFS + "pc-boxy/pc-boxy.png", "no_hands": True},
    },
    "assets": [
        {"name": "action-armscrossed", "kind": "action", "file": REFS + "base/action-armscrossed.png"},
        {"name": "expr-deadpan", "kind": "expression", "file": REFS + "base/expr-deadpan.png"},
        {"name": "crowd-exemplar", "kind": "crowd-anchor", "file": REFS + "base/crowd-exemplar.png"},
    ],
}
K = SimpleNamespace(reg=REG, staging=tempfile.mkdtemp())
FIG = "_staging/fig-hq-banker--action-armscrossed--expr-deadpan.png"
CANON = REFS + "hq-banker/hq-banker.png"
PLATE = "channels/c/videos/v/assets/scenes/L10.png"
FRESH = ("`hq-banker`, `expr-deadpan`, `action-armscrossed`, behind a polished desk in a "
         "high-rise office.")


def _req(**kw):
    r = {"name": "L11", "mode": "environment", "delta": FRESH}
    r.update(kw); return r


def _stub_kit():
    # cmd_gen only touches k.staging before the seed check fires for a seedless environment/style req,
    # so a lightweight stub reaches the guard without a real Kit / bible / network.
    return SimpleNamespace(staging=tempfile.mkdtemp())


def test_environment_or_style_without_seed_hard_errors():
    for mode in ("environment", "style"):
        try:
            cmd_gen(_stub_kit(), [{"name": "plate", "mode": mode, "delta": "a swamp"}], True)
        except SystemExit as e:
            assert "style-anchor seed" in str(e), str(e)
        else:
            assert False, f"{mode} gen with no seed should have hard-errored"


def test_a_place_first_plate_may_generate_unseeded():
    """fix 2: the video's FIRST frame for a place has no earlier frame of its own to seed."""
    assert resolve_request_seeds(_stub_kit(), {"name": "L01", "mode": "environment",
                                               "delta": "an empty yard", "plate": True}) == []


def test_shot_cast_binds_each_primitive_to_the_figure_that_precedes_it():
    assert shot_cast(REG, FRESH) == [("hq-banker", ["expr-deadpan", "action-armscrossed"])]
    assert figure_frame_name("hq-banker", "action-armscrossed", "expr-deadpan") == \
        "fig-hq-banker--action-armscrossed--expr-deadpan"


def test_fresh_named_cast_needs_its_step1_figure_frame():
    bad = seeding_law_violations(K, _req(seed=[PLATE]), [PLATE])
    assert len(bad) == 1 and "staged FRESH with no STEP-1 figure frame" in bad[0], bad
    assert "fig-hq-banker--action-armscrossed--expr-deadpan" in bad[0], bad
    # the same shot WITH its step-1 frame satisfies the law
    assert seeding_law_violations(K, _req(), [FIG, PLATE]) == []


def test_a_swapped_step1_frame_is_not_the_pose_the_shot_authored():
    swapped = "_staging/fig-hq-banker--action-shrug--expr-deadpan.png"
    bad = seeding_law_violations(K, _req(), [swapped, PLATE])
    assert len(bad) == 1 and "carries a different pose/expression" in bad[0], bad


def test_a_delta_beat_inherits_from_canonical_plus_its_parent_frame():
    delta = _req(name="L12", stage_role="delta",
                 delta="The same office, unchanged, except `hq-banker` is now seated.")
    assert seeding_law_violations(K, delta, [CANON, PLATE]) == []
    assert "no canonical" in seeding_law_violations(K, delta, [PLATE])[0]
    assert "no in-chain parent" in seeding_law_violations(K, delta, [CANON])[0]


def test_the_abolished_tier_and_an_unseeded_crowd_hard_error():
    bad = seeding_law_violations(K, _req(delta="A dock at dawn.",
                                         figures={"anon_foreground": ["the worker"]}), [PLATE])
    assert len(bad) == 1 and "anon_foreground" in bad[0], bad
    bad = seeding_law_violations(K, _req(delta="A dock at dawn.", figures={"crowd": True}), [PLATE])
    assert len(bad) == 1 and "crowd exemplar" in bad[0], bad
    assert seeding_law_violations(
        K, _req(delta="A dock at dawn.", figures={"crowd": True}),
        [PLATE, REFS + "base/crowd-exemplar.png"]) == []


def test_over_cap_names_the_seed_that_did_not_fit_and_never_truncates():
    seeds = [FIG, PLATE, CANON, REFS + "base/expr-deadpan.png", REFS + "base/crowd-exemplar.png"]
    bad = [b for b in seeding_law_violations(K, _req(), seeds) if "over the cap" in b]
    assert len(bad) == 1 and "crowd-exemplar did not fit" in bad[0], bad


def test_a_personified_object_is_exempt_from_the_two_step_recipe():
    """A `no_hands` character has no pose primitives, so its canonical IS the inheritable base."""
    r = _req(delta="`pc-boxy`, `expr-deadpan`, planted on a laminate desk.")
    assert seeding_law_violations(K, r, [REFS + "pc-boxy/pc-boxy.png", PLATE]) == []
    assert "carries no seed" in seeding_law_violations(K, r, [PLATE])[0]


def test_a_deliberately_omitted_primitive_is_not_demanded_back():
    r = _req(delta="`pc-boxy`, `expr-deadpan`, `action-armscrossed`, on a desk.",
             assets_omitted=["action-armscrossed"])
    assert seeding_law_violations(K, r, [REFS + "pc-boxy/pc-boxy.png", PLATE]) == []


def test_step1_itself_must_carry_the_canonical_and_every_primitive_it_names():
    card = {"name": "fig-hq-banker--action-armscrossed--expr-deadpan", "mode": "environment",
            "delta": "The FIRST image is `hq-banker`'s canonical, `expr-deadpan`, `action-armscrossed`."}
    ok = [CANON, REFS + "base/expr-deadpan.png", REFS + "base/action-armscrossed.png"]
    assert seeding_law_violations(K, card, ok) == []
    bad = seeding_law_violations(K, card, ok[:2])
    assert len(bad) == 1 and "does not seed it" in bad[0], bad


def test_a_step1_seeded_scene_carries_its_rig_hold_signal_in_the_TEXT():
    """A step-1 frame lives outside /refs/, so `_is_char_seed` never fires on it — the placement
    block is what guarantees §2c reaches the prompt (probe 2026-07-30, 'Deliberate RIG-HOLD')."""
    text = placement_delta(FRESH, ["hq-banker"], scale_anchor(FRESH), True)
    assert depicts_figures(text), text
    assert "the desk" in text and "ground plane" in text and "occluded" in text, text


def test_a_seed_can_never_be_invented_by_a_LATER_batch_entry():
    k = SimpleNamespace(staging=tempfile.mkdtemp(), resolve_seed=lambda s: s)
    assert resolve_request_seeds(k, {"name": "B", "mode": "environment", "seed": ["_staging/A.png"]},
                                 pending={"A"})
    try:
        resolve_request_seeds(k, {"name": "A", "mode": "environment", "seed": ["_staging/B.png"]},
                              pending=set())
    except SystemExit as e:
        assert "not generated EARLIER in this batch" in str(e), str(e)
    else:
        assert False, "a seed naming a later/absent staged frame must hard-error"


def test_the_preflight_reports_the_WHOLE_batch_not_the_first_failure():
    lib_fig = "channels/c/videos/v/assets/library/fig-hq-banker--action-armscrossed--expr-deadpan.png"
    reqs = [_req(name="L11", seed=[PLATE]), _req(name="L13", seed=[PLATE]),
            _req(name="L14", seed=[lib_fig])]
    k = SimpleNamespace(reg=REG, staging=tempfile.mkdtemp(), resolve_seed=lambda s: s)
    try:
        preflight_batch(k, reqs, True, True)
    except SystemExit as e:
        assert "2 violation(s)" in str(e) and "L11" in str(e) and "L13" in str(e), str(e)
    else:
        assert False, "an under-seeded batch must hard-error before the first API call"


def _video_with_library(assets):
    """A video dir carrying Pass 1's own `assets/library/manifest.json`."""
    v = tempfile.mkdtemp()
    d = os.path.join(v, "assets", "library"); os.makedirs(d)
    json.dump({"video_slug": "v", "assets": assets},
              open(os.path.join(d, "manifest.json"), "w", encoding="utf-8"))
    return v


def test_a_videos_OWN_lead_cast_is_seen_by_the_law():
    """REGRESSION (bricks-fresh dogfood, 2026-07-30). Channel promotion is reserved for what
    RECURS, so a video's own leads live only in its library manifest. Resolving cast against the
    channel registry alone meant `shot_cast` returned EMPTY for them — so they were never seeded
    AND the law never noticed: L45 and L60 assembled with zero seeds for their named leads and
    preflight reported them clean. The validator shared the generator's blind spot."""
    v = _video_with_library([
        {"name": "qt-wiles", "kind": "identity", "file": "videos/v/assets/library/qt-wiles.png"},
        {"name": "expr-fear", "kind": "expression", "file": "videos/v/assets/library/expr-fear.png"},
    ])
    local = "`qt-wiles`, `expr-fear`, behind a polished desk in a high-rise office."
    assert shot_cast(REG, local) == [], "precondition: the channel registry cannot see this lead"
    merged = merge_vocabulary(REG, v)
    assert shot_cast(merged, local) == [("qt-wiles", ["expr-fear"])], shot_cast(merged, local)
    # ...and the law now demands its step-1 frame instead of passing it clean
    km = SimpleNamespace(reg=merged)
    bad = seeding_law_violations(km, _req(delta=local, seed=[PLATE]), [PLATE])
    assert len(bad) == 1 and "no STEP-1 figure frame" in bad[0], bad
    assert "fig-qt-wiles--expr-fear" in bad[0], bad
    assert seeding_law_violations(
        km, _req(delta=local), ["_staging/fig-qt-wiles--expr-fear.png", PLATE]) == []


def test_the_union_dedupes_and_the_channel_entry_wins():
    v = _video_with_library([
        {"name": "qt-wiles", "kind": "identity", "file": "videos/v/assets/library/qt-wiles.png"},
        {"name": "hq-banker", "kind": "identity", "file": "videos/v/assets/library/stale.png"},
        {"name": "expr-deadpan", "kind": "expression", "file": "videos/v/assets/library/dup.png"},
    ])
    merged = merge_vocabulary(REG, v)
    names = [a["name"] for a in merged["assets"]]
    assert len(names) == len(set(names)), names
    # a name the channel already owns keeps the CHANNEL file (the promoted canonical is the lock)
    by = {a["name"]: a["file"] for a in merged["assets"]}
    assert by["expr-deadpan"] == REFS + "base/expr-deadpan.png", by["expr-deadpan"]
    assert merged["characters"]["hq-banker"] == REG["characters"]["hq-banker"]
    # a field the manifest does not carry is simply absent -> false
    assert not merged["characters"]["qt-wiles"].get("no_hands")
    # the channel registry itself is never mutated
    assert "qt-wiles" not in REG["characters"]


def test_the_video_is_found_by_its_library_not_by_the_shots_file_position():
    """A shots.json extract under `scratchpad/` (how the dogfood slice was built) must still
    resolve to the video that owns it, or the cast union silently does nothing."""
    v = _video_with_library([{"name": "x", "kind": "identity", "file": "f.png"}])
    sub = os.path.join(v, "scratchpad"); os.makedirs(sub)
    slice_file = os.path.join(sub, "slice-shots.json")
    open(slice_file, "w", encoding="utf-8").close()
    assert video_root_for(slice_file, tempfile.gettempdir()) == v


# --- `batch --shots`: the OPT-IN repair scope ---------------------------------------------------
# Recycling is approved per-video; a FULL run stays what the engine is built for, so the no-flag
# path must not drift by a byte. These run the REAL Kit (real bible + registry) over a temp video,
# using channel cast whose refs exist on disk. Still zero API calls: `batch` loads no key.
_SCOPE_SHOTS = {
    "schema": "shots/1", "video_slug": "t",
    "long_form": {"aspect_ratio": "16:9", "shots": [
        {"id": "T01", "source": "ai-gen", "stage": "yard", "stage_role": "base",
         "still_prompt": "`miniscribe-rep`, `expr-smug`, `action-powerstance`, at a brickyard gate "
                         "beside a stack of pallets under open sky."},
        {"id": "T02", "source": "ai-gen", "stage": "yard", "stage_role": "delta",
         "still_prompt": "The same brickyard, unchanged, except `miniscribe-rep` is now "
                         "`expr-worried` — only this changes."},
        {"id": "T03", "source": "ai-gen", "stage": "dock",
         "still_prompt": "A dock at dawn, the worker at the edge hauling a crate.",
         "figures": {"anon_foreground": ["the worker at the dock edge"]}},
    ]},
}


def _scope_fixture():
    v = tempfile.mkdtemp()
    json.dump(_SCOPE_SHOTS, open(os.path.join(v, "shots.json"), "w", encoding="utf-8"))
    return v, os.path.join(v, "shots.json"), os.path.join(v, "spec.json")


def _batch(shots_path, out, scope):
    """Run cmd_batch quietly; return (spec or None, SystemExit text or None)."""
    k = Kit(str(KIT_DIR), dry=True)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_batch(k, shots_path, out, None, scope)
    except SystemExit as e:
        return None, str(e)
    return json.load(open(out, encoding="utf-8")), None


def test_without_shots_the_whole_file_is_validated_and_blocks():
    """No flag = exactly today's behavior: one violation anywhere refuses the spec."""
    _, shots, out = _scope_fixture()
    spec, err = _batch(shots, out, None)
    assert spec is None and "anon_foreground" in err and "T03" in err, err
    assert not os.path.exists(out), "no spec may be written while the file has a violation"


def test_a_scoped_run_emits_only_its_shots_and_is_not_blocked_from_outside():
    _, shots, out = _scope_fixture()
    spec, err = _batch(shots, out, ["T01", "T02"])
    assert err is None, err
    names = [i["name"] for i in spec]
    assert "T03" not in names and "T01" in names and "T02" in names, names
    # the slate quality is unchanged by scoping: step-1 figure, place-first plate, delta off parent
    fig = figure_frame_name("miniscribe-rep", "action-powerstance", "expr-smug")
    assert names[0] == fig, names
    assert [i for i in spec if i["name"] == "T01"][0].get("plate") is True
    t02 = [i for i in spec if i["name"] == "T02"][0]
    assert any("_staging/T01.png" in str(s) for s in t02["seed"]), t02["seed"]
    assert any(_stem_ok(s, "miniscribe-rep") for s in t02["seed"]), t02["seed"]


def _stem_ok(seed, char):
    return f"/refs/{char}/" in str(seed).replace("\\", "/")


def test_a_violation_INSIDE_the_scope_still_hard_errors():
    _, shots, out = _scope_fixture()
    spec, err = _batch(shots, out, ["T01", "T03"])
    assert spec is None and "T03" in err and "anon_foreground" in err, err


def test_an_unknown_shot_id_is_named_not_silently_ignored():
    _, shots, out = _scope_fixture()
    spec, err = _batch(shots, out, ["T01", "T99"])
    assert spec is None and "T99" in err and "not in" in err, err


def test_scoping_to_a_delta_alone_reuses_its_parent_instead_of_regenerating_it():
    """A delta target's parent may point at an existing on-disk asset — reuse-before-regenerate."""
    v, shots, out = _scope_fixture()
    scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
    open(os.path.join(scenes, "T01.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
    spec, err = _batch(shots, out, ["T02"])
    assert err is None, err
    assert [i["name"] for i in spec] == ["T02"], spec
    assert any(str(s).replace("\\", "/").endswith("assets/scenes/T01.png") for s in spec[0]["seed"]), \
        spec[0]["seed"]


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_"):
            fn()
    print("PASS test_forge_seed_requirement")

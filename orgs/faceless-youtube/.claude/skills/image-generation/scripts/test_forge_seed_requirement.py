#!/usr/bin/env python3
"""Plain-assert tests for what a gen must CARRY before it is allowed to run (repo has no pytest):
the root-only zero-seed exception, and THE SEEDING LAW — a gen that cannot inherit a figure's rig
from an existing frame hard-errors at $0, before the API call.
Run: py -3 .claude/skills/image-generation/scripts/test_forge_seed_requirement.py"""
import contextlib, hashlib, io, json, os, subprocess, sys, tempfile, time
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import forge as forge_module
from forge import (Kit, cmd_batch, cmd_gen, figure_frame_name, merge_vocabulary, preflight_batch,
                   resolve_request_seeds, seeding_law_violations, shot_cast,
                   place_anchor_for, video_root_for,
                   cmd_retry_batch, RETRY_OVERLAY_SCHEMA)

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]


def _real_kit():
    """The real Kit over the real bible/registry, with the repo root PINNED. `Kit` finds the root
    by walking up to the env marker, which exists only in the primary checkout — in a worktree the
    walk reaches the filesystem root and every registry-relative seed path stops resolving."""
    k = Kit(str(KIT_DIR), dry=True)
    k.root = str(ROOT)
    k.staging = os.path.join(tempfile.mkdtemp(), "_staging")
    os.makedirs(k.staging)   # never let a live run's staged frames alter a slate fixture
    return k

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
    r.update(kw)
    if r.get("seed") and "seed_roles" not in r:
        r["payload"] = r["delta"]
        r["seed_roles"] = [
            {"path": path, "role": "reference", "character": None} for path in r["seed"]]
        r["delta"] = forge_module.placement_delta(r["payload"], r["seed_roles"])
    return r


def _stub_kit():
    # cmd_gen only touches k.staging before the seed check fires for a seedless environment/style req,
    # so a lightweight stub reaches the guard without a real Kit / bible / network.
    return SimpleNamespace(staging=tempfile.mkdtemp())


def test_a_non_plate_environment_or_style_without_seed_hard_errors():
    for mode in ("environment", "style"):
        try:
            cmd_gen(_stub_kit(), [{"name": "swamp", "mode": mode, "delta": "a swamp"}], True)
        except SystemExit as e:
            assert "only a derived place plate" in str(e), str(e)
        else:
            assert False, f"non-plate {mode} gen with no seed should have hard-errored"


def test_a_derived_place_plate_may_run_unseeded_but_delta_and_anchor_may_not():
    for mode in ("environment", "style"):
        assert resolve_request_seeds(_stub_kit(), {
            "name": "L01", "mode": mode, "delta": "an empty yard", "plate": True}) == []
    for request in (
        {"name": "L02", "mode": "environment", "delta": "same yard", "stage_role": "delta",
         "plate": True},
        {"name": "L03", "mode": "environment", "delta": "same yard", "plate": True,
         "place_anchor": "assets/scenes/L00.png"},
    ):
        try:
            resolve_request_seeds(_stub_kit(), request)
        except SystemExit as e:
            assert "only a derived place plate" in str(e), str(e)
        else:
            assert False, f"continuity request accepted with no seed: {request}"


def test_cmd_gen_classifies_root_chain_and_anchored_requests_as_scenes_but_not_step1():
    root = tempfile.mkdtemp(); staging = os.path.join(root, "staging"); os.makedirs(staging)
    seed = os.path.join(root, "seed.png"); open(seed, "wb").write(b"seed")
    seen = []
    def prompt_for(mode, delta, **kwargs):
        seen.append((delta, kwargs.get("scene")))
        return delta
    k = SimpleNamespace(staging=staging, root=root, reg=REG, resolve_seed=lambda value: value,
                        prompt_for=prompt_for)
    def composite(name, mode, payload, **extra):
        roles = [{"path": seed, "role": "reference", "character": None}]
        return {"name": name, "mode": mode, "payload": payload,
                "delta": forge_module.placement_delta(payload, roles), "seed": [seed],
                "seed_roles": roles, **extra}
    reqs = [
        {"name": "root", "mode": "environment", "delta": "root authored", "seed": [],
         "plate": True},
        composite("chain", "environment", "chain authored", plate=False),
        composite("anchored", "style", "anchor authored", plate=False,
                  place_anchor="assets/scenes/L00.png"),
        composite("fig-reference", "environment", "STEP-1 authored"),
    ]
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_gen(k, reqs, True, dry=True)
    assert [scene for _, scene in seen] == [True, True, True, False], seen
    assert seen[0][0] == "root authored"
    assert [delta.rsplit("\n\n", 1)[-1] for delta, _ in seen[1:]] == [
        "chain authored", "anchor authored", "STEP-1 authored"], seen


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
        # An expression CHANGE on a delta declares its primitive: the parent frame holds the old
        # face, so the new one needs pixels of its own (C-10).
        {"id": "T02", "source": "ai-gen", "stage": "yard", "stage_role": "delta",
         "delta_primitives": {"miniscribe-rep": ["expr-worried"]},
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
    k = _real_kit()
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
    # the slate quality is unchanged by scoping: step-1 figure, root scene, delta off parent
    fig = figure_frame_name("miniscribe-rep", "action-powerstance", "expr-smug")
    assert names[0] == fig, names
    t01 = [i for i in spec if i["name"] == "T01"][0]
    assert t01["plate"] is False and [Path(s).stem for s in t01["seed"]] == [fig], t01
    t02 = [i for i in spec if i["name"] == "T02"][0]
    assert t02["plate"] is False, t02
    assert any("_staging/T01.png" in str(s) for s in t02["seed"]), t02["seed"]
    assert any(_stem_ok(s, "miniscribe-rep") for s in t02["seed"]), t02["seed"]


def test_explicit_nonfigure_tags_route_without_duplicating_figure_or_crowd_seeds():
    v, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    tagged = doc["long_form"]["shots"][0]
    tagged["figures"] = {"crowd": True}
    tagged["assets"] = {
        "miniscribe-rep": "channels/the-second-take/visual-kit/refs/miniscribe-rep/miniscribe-rep.png",
        "expr-smug": "channels/the-second-take/visual-kit/refs/base/expr-smug.png",
        "action-powerstance": "channels/the-second-take/visual-kit/refs/base/action-powerstance.png",
        "crowd-exemplar": "channels/the-second-take/visual-kit/refs/base/crowd-exemplar.png",
        "prop-beige-pc": "channels/the-second-take/visual-kit/refs/env/prop-beige-pc.png",
    }
    doc["long_form"]["shots"].append({
        "id": "T04", "source": "ai-gen", "stage": "stamp-desk", "stage_role": "base",
        "still_prompt": "A red approval stamp sits on a blank desk.",
        "assets": {"stamp-block-outlined":
                   "channels/the-second-take/visual-kit/refs/env/stamp-block-outlined.png"},
    })
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T01", "T04"])
    assert err is None, err
    scene = next(i for i in spec if i["name"] == "T01")
    assert [Path(s).stem for s in scene["seed"]] == [
        figure_frame_name("miniscribe-rep", "action-powerstance", "expr-smug"),
        "crowd-exemplar", "prop-beige-pc"], scene["seed"]
    assert [Path(s).stem for s in next(i for i in spec if i["name"] == "T04")["seed"]] == \
        ["stamp-block-outlined"]


def test_explicit_tags_over_cap_still_hard_error_instead_of_truncating():
    _, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    shot = doc["long_form"]["shots"][0]
    shot["figures"] = {"crowd": True}
    shot["assets"] = {n: f"channels/the-second-take/visual-kit/refs/env/{n}.png" for n in (
        "prop-beige-pc", "lettering-marker-italic", "stamp-block-outlined")}
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T01"])
    assert spec is None and "5 seeds over the cap" in err, err
    assert "stamp-block-outlined did not fit" in err and not os.path.exists(out), err


def test_character_free_place_plate_emits_with_no_image_seed():
    _, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    doc["long_form"]["shots"] = [{"id": "T00", "source": "ai-gen", "stage": "new-place",
                                    "still_prompt": "A warm records room with a bare central table."}]
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T00"])
    assert err is None, err
    assert spec == [{"name": "T00", "mode": "environment", "aspect": "16:9",
                     "delta": "A warm records room with a bare central table.",
                     "payload": "A warm records room with a bare central table.",
                     "seed": [], "seed_roles": [],
                     "figures": None, "stage_role": None, "assets_omitted": None,
                     "plate": True, "delta_primitives": None, "expression_change": None,
                     "parent_depth": 0, "lineage": 0,
                     "why": "PLATE — place-first frame, hardened descriptor, no image anchor"}], spec


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


def test_a_base_can_seed_its_videos_approved_place_after_two_step1_figures():
    v = tempfile.mkdtemp()
    scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
    approved = os.path.join(scenes, "L60.png")
    open(approved, "wb").write(b"\x89PNG\r\n\x1a\n")
    doc = {"schema": "shots/1", "video_slug": "t", "long_form": {"aspect_ratio": "16:9", "shots": [{
        "id": "L60", "source": "ai-gen", "stage": "brickyard", "stage_role": "base",
        "place_anchor": "assets/scenes/L60.png", "figures": {"crowd": True},
        "still_prompt": "`miniscribe-rep` and `ibm-suit` face a waiting crowd in the brickyard."}]}}
    shots, out = os.path.join(v, "shots.json"), os.path.join(v, "spec.json")
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["L60"])
    assert err is None, err
    scene = [i for i in spec if i["name"] == "L60"][0]
    assert scene["plate"] is False, scene
    assert len(scene["seed"]) == 4, scene["seed"]
    assert [Path(s).stem for s in scene["seed"][:2]] == ["fig-miniscribe-rep", "fig-ibm-suit"], scene["seed"]
    assert scene["seed"][2].replace("\\", "/").endswith("assets/scenes/L60.png"), scene["seed"]
    assert Path(scene["seed"][3]).stem == "crowd-exemplar", scene["seed"]


def test_a_missing_or_cross_video_place_anchor_hard_errors_before_emission():
    v, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    doc["long_form"]["shots"][0]["place_anchor"] = "assets/scenes/missing.png"
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T01"])
    assert spec is None and "T01" in err and "place_anchor" in err and "not found" in err, err
    doc["long_form"]["shots"][0]["place_anchor"] = "../other-video/assets/scenes/L60.png"
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T01"])
    assert spec is None and "cross-video" in err, err


def test_a_place_anchor_cannot_escape_through_a_windows_junction_or_posix_symlink():
    with tempfile.TemporaryDirectory() as v, tempfile.TemporaryDirectory() as foreign:
        scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
        open(os.path.join(foreign, "foreign.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
        linked = os.path.join(scenes, "linked")
        temp_root = os.path.abspath(tempfile.gettempdir())
        for path in (v, foreign, scenes, linked):
            assert os.path.commonpath((os.path.abspath(path), temp_root)) == temp_root, path
        if os.name == "nt":
            result = subprocess.run(
                ["cmd.exe", "/d", "/c", "mklink", "/J", linked, foreign],
                capture_output=True, text=True, check=False, shell=False)
            assert result.returncode == 0 and os.path.isdir(linked), (
                f"mklink /J junction setup failed (rc={result.returncode}): "
                f"stdout={result.stdout!r} stderr={result.stderr!r}")
        else:
            try:
                os.symlink(foreign, linked, target_is_directory=True)
            except (NotImplementedError, OSError) as e:
                assert False, f"symlink escape regression setup failed: {e}"
        try:
            try:
                place_anchor_for(v, "assets/scenes/linked/foreign.png", v, "L60")
            except SystemExit as e:
                assert "cross-video" in str(e), str(e)
            else:
                assert False, "a linked foreign place frame must hard-error"
        finally:
            if os.path.lexists(linked):
                os.rmdir(linked) if os.name == "nt" else os.unlink(linked)


def _retry(shots_path, out, overlay, staged=None):
    k = _real_kit()
    for name, data in (staged or {}).items():
        open(os.path.join(k.staging, name), "wb").write(data)
    overlay_path = os.path.join(os.path.dirname(shots_path), "retry-overlay.json")
    json.dump(overlay, open(overlay_path, "w", encoding="utf-8"))
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_retry_batch(k, shots_path, out, overlay_path)
    except SystemExit as e:
        return None, str(e)
    return json.load(open(out, encoding="utf-8")), None


def _retry_fixture():
    v = tempfile.mkdtemp()
    os.makedirs(os.path.join(v, "assets"))
    for name in ("prep.png", "extra.png"):
        open(os.path.join(v, "assets", name), "wb").write(b"\x89PNG\r\n\x1a\n")
    doc = {"schema": "shots/1", "video_slug": "retry-t", "long_form": {"aspect_ratio": "16:9", "shots": [
        {"id": "T01", "source": "ai-gen", "stage_role": "base", "figures": {"crowd": True},
         "assets": {"prop-drive":
                    "channels/the-second-take/visual-kit/refs/env/prop-drive.png"},
         "still_prompt": ("A small crowd waits at a factory gate beside `prop-drive` under "
                          "clear morning light.")},
        {"id": "T02", "source": "ai-gen", "stage_role": "base",
         "still_prompt": "`miniscribe-rep`, `expr-smug`, `action-powerstance`, at a brickyard gate."}
    ]}}
    shots, out = os.path.join(v, "shots.json"), os.path.join(v, "retry-spec.json")
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    return v, shots, out


def test_retry_overlay_derives_duplicate_scenes_and_one_step1_only_request():
    v, shots, out = _retry_fixture()
    overlay = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T01", "name": "T01-retry-a",
         "defect": "mechanism", "prepend_seeds": ["refs/env/prop-drive.png"]},
        {"kind": "scene", "shot": "T01", "name": "T01-retry-b",
         "defect": "content",
         "replace": {"from": "small crowd", "to": "small background crowd"}},
        {"kind": "step1", "shot": "T02", "character": "miniscribe-rep",
         "name": "fig-miniscribe-rep-retry", "defect": "rig",
         "instruction": "Both visible hands are open and empty."}
    ]}
    spec, err = _retry(shots, out, overlay)
    assert err is None, err
    assert [r["name"] for r in spec] == ["T01-retry-a", "T01-retry-b", "fig-miniscribe-rep-retry"], spec
    first = spec[0]
    assert first["plate"] is False and first["payload"].startswith("A small crowd"), first
    assert first["seed"][0].replace("\\", "/").endswith("refs/env/prop-drive.png"), first["seed"]
    step = spec[-1]
    assert step["name"].startswith("fig-") and "T02" not in [r["name"] for r in spec], spec
    assert "Both visible hands are open and empty." in step["delta"], step["delta"]


def test_retry_overlay_accepts_its_verified_video_local_place_anchor():
    v, shots, out = _retry_fixture()
    scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
    open(os.path.join(scenes, "T00.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
    json.dump({"video_slug": "retry-t", "shots": [{
        "shot_id": "T00", "file": "assets/scenes/T00.png", "review_status": "verified"
    }]}, open(os.path.join(scenes, "manifest.json"), "w", encoding="utf-8"))
    doc = json.load(open(shots, encoding="utf-8"))
    doc["long_form"]["shots"][0]["place_anchor"] = "assets/scenes/T00.png"
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    overlay = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T01", "name": "T01-anchor-retry",
         "defect": "content",
         "replace": {"from": "small crowd", "to": "small background crowd"}}
    ]}
    spec, err = _retry(shots, out, overlay)
    assert err is None, err
    assert any(str(s).replace("\\", "/").endswith("assets/scenes/T00.png")
               for s in spec[0]["seed"]), spec[0]["seed"]


def test_retry_overlay_still_rejects_a_nonverified_video_scene_frame():
    v, shots, out = _retry_fixture()
    scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
    open(os.path.join(scenes, "T01.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
    json.dump({"video_slug": "retry-t", "shots": [{
        "shot_id": "T01", "file": "assets/scenes/T01.png", "review_status": "parked"
    }]}, open(os.path.join(scenes, "manifest.json"), "w", encoding="utf-8"))
    doc = json.load(open(shots, encoding="utf-8"))
    doc["long_form"]["shots"][0].update({"stage": "factory", "stage_role": "base"})
    doc["long_form"]["shots"][1].update({
        "stage": "factory", "stage_role": "delta",
        "still_prompt": "The same factory and locked frame; only the gate is now open.",
    })
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    overlay = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T02", "name": "T02-stale-retry",
         "defect": "mechanism",
         "prepend_seeds": ["assets/scenes/T01.png"]}
    ]}
    spec, err = _retry(shots, out, overlay)
    assert spec is None and "old video scene output" in err and "verified" in err, err


def test_retry_overlay_accepts_a_digest_pinned_repaired_predecessor_and_drops_the_stale_parent():
    for repaired in ("_staging/T01-repair.png", "assets/scenes/T01-repair.png"):
        v, shots, out = _retry_fixture()
        scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
        open(os.path.join(scenes, "T01.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
        json.dump({"video_slug": "retry-t", "shots": [{
            "shot_id": "T01", "file": "assets/scenes/T01.png", "review_status": "parked"
        }]}, open(os.path.join(scenes, "manifest.json"), "w", encoding="utf-8"))
        doc = json.load(open(shots, encoding="utf-8"))
        doc["long_form"]["shots"][0].update({"stage": "factory", "stage_role": "base"})
        doc["long_form"]["shots"][1].update({
            "stage": "factory", "stage_role": "delta",
            "still_prompt": "The same factory and locked frame; only the gate is now open."
        })
        json.dump(doc, open(shots, "w", encoding="utf-8"))
        repaired_bytes = b"\x89PNG\r\n\x1a\nrepaired"
        staged = {"T01-repair.png": repaired_bytes} if repaired.startswith("_staging/") else None
        if not staged:
            repaired_path = os.path.join(v, *repaired.split("/"))
            os.makedirs(os.path.dirname(repaired_path), exist_ok=True)
            open(repaired_path, "wb").write(repaired_bytes)
        digest = hashlib.sha256(repaired_bytes).hexdigest()
        overlay = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
            {"kind": "scene", "shot": "T02", "name": "T02-retry",
             "defect": "mechanism",
             "prepend_seeds": [{"path": repaired, "sha256": digest}]}
        ]}
        spec, err = _retry(shots, out, overlay, staged)
        assert err is None, f"{repaired}: {err}"
        normalized = [str(s).replace("\\", "/") for s in spec[0]["seed"]]
        assert any(s.endswith(repaired) for s in normalized), normalized
        assert not any(s.endswith("assets/scenes/T01.png") for s in normalized), normalized
        repaired_seed = next(s for s in spec[0]["seed"]
                             if str(s).replace("\\", "/").endswith(repaired))
        assert spec[0]["seed_sha256"][repaired_seed] == digest, spec[0]


def test_retry_overlay_rejects_unknown_keys_output_collisions_and_old_scene_seeds():
    v, shots, out = _retry_fixture()
    base = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T01", "name": "T01-retry",
         "defect": "content",
         "replace": {"from": "small crowd", "to": "small background crowd"}}
    ]}
    bad = json.loads(json.dumps(base)); bad["entries"][0]["unexpected"] = True
    spec, err = _retry(shots, out, bad)
    assert spec is None and "unknown key" in err, err
    bad = json.loads(json.dumps(base)); bad["entries"][0]["name"] = "T01"
    spec, err = _retry(shots, out, bad)
    assert spec is None and "cannot equal canonical" in err, err
    scenes = os.path.join(v, "assets", "scenes"); os.makedirs(scenes)
    open(os.path.join(scenes, "T01.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
    bad = json.loads(json.dumps(base)); bad["entries"][0].pop("replace")
    bad["entries"][0]["defect"] = "mechanism"
    bad["entries"][0]["prepend_seeds"] = ["assets/scenes/T01.png"]
    spec, err = _retry(shots, out, bad)
    assert spec is None and "old video scene output" in err and "verified" in err, err
    open(os.path.join(scenes, "T01-retry.png"), "wb").write(b"\x89PNG\r\n\x1a\n")
    spec, err = _retry(shots, out, base)
    assert spec is None and "collides with existing" in err, err


def test_retry_overlay_replaces_one_exact_canonical_clause_only_once():
    v, shots, out = _retry_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    original = "A single card reads 'OLD'."
    doc["long_form"]["shots"][0]["still_prompt"] = original
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    overlay = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T01", "name": "T01-card-retry",
         "defect": "content",
         "replace": {"from": original, "to": "A single card reads 'NEW'."}}
    ]}
    spec, err = _retry(shots, out, overlay)
    assert err is None, err
    assert "A single card reads 'NEW'." in spec[0]["delta"], spec[0]["delta"]
    assert original not in spec[0]["delta"], spec[0]["delta"]

    doc["long_form"]["shots"][0]["still_prompt"] = original + " " + original
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _retry(shots, out, overlay)
    assert spec is None and "exactly once" in err, err


def test_retry_overlay_digest_is_emitted_and_mismatch_is_a_zero_cost_error():
    v, shots, out = _retry_fixture()
    prep = os.path.join(KIT_DIR, "refs", "env", "prop-drive.png")
    digest = hashlib.sha256(open(prep, "rb").read()).hexdigest()
    overlay = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T01", "name": "T01-digest-retry",
         "defect": "mechanism",
         "prepend_seeds": [{"path": "refs/env/prop-drive.png", "sha256": digest}]}
    ]}
    spec, err = _retry(shots, out, overlay)
    assert err is None, err
    assert spec[0]["seed_sha256"][spec[0]["seed"][0]] == digest, spec[0]
    bad = json.loads(json.dumps(overlay))
    bad["entries"][0]["prepend_seeds"][0]["sha256"] = "0" * 64
    spec, err = _retry(shots, out, bad)
    assert spec is None and "SHA-256 mismatch" in err, err


def test_retry_overlay_malformed_identity_fields_fail_as_controlled_errors():
    v, shots, out = _retry_fixture()
    base = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "scene", "shot": "T01", "name": "T01-retry",
         "defect": "content",
         "replace": {"from": "small crowd", "to": "small background crowd"}}
    ]}
    bad = json.loads(json.dumps(base)); bad["entries"][0]["shot"] = []
    spec, err = _retry(shots, out, bad)
    assert spec is None and "`shot` must be a non-empty string" in err, err
    bad = json.loads(json.dumps(base)); bad["entries"][0]["name"] = {}
    spec, err = _retry(shots, out, bad)
    assert spec is None and "`name` must be a non-empty string" in err, err
    bad = {"schema": RETRY_OVERLAY_SCHEMA, "video_slug": "retry-t", "entries": [
        {"kind": "step1", "shot": "T02", "name": "fig-retry", "defect": "rig",
         "character": []}
    ]}
    spec, err = _retry(shots, out, bad)
    assert spec is None and "`character` must be a non-empty string" in err, err


_LIVE_PNG = b"\x89PNG\r\n\x1a\n" + (b"x" * 2048)


def _live_kit(seed, mutate_prompt=None):
    staging = tempfile.mkdtemp()
    root = os.path.dirname(staging)
    def prompt_for(mode, delta, **kwargs):
        if mutate_prompt:
            mutate_prompt()
        return delta
    return SimpleNamespace(staging=staging, root=root, reg={}, url="offline", ctx=None,
                           resolve_seed=lambda value: value, prompt_for=prompt_for)


def _live_req(k, seed, name="retry-live", digest=None):
    req = {"name": name, "mode": "identity", "delta": "a checked offline frame", "seed": [seed]}
    if digest:
        req["seed_sha256"] = {os.path.relpath(seed, k.root).replace("\\", "/"): digest}
    return req


def test_live_gen_reservation_never_clobbers_a_concurrent_survivor_and_cleans_failures():
    seed_dir = tempfile.mkdtemp(); seed = os.path.join(seed_dir, "seed.png")
    open(seed, "wb").write(_LIVE_PNG)
    k = _live_kit(seed); out = os.path.join(k.staging, "retry-live.png")
    survivor = b"\x89PNG\r\n\x1a\n" + (b"s" * 2048)
    old_nano = forge_module.nano
    def concurrent_provider(*args):
        open(out, "wb").write(survivor)  # another producer finishes while this provider is in flight
        return _LIVE_PNG
    forge_module.nano = concurrent_provider
    try:
        cmd_gen(k, [_live_req(k, seed)], False)
    finally:
        forge_module.nano = old_nano
    assert open(out, "rb").read() == survivor
    assert not os.path.exists(out + ".lock")

    k = _live_kit(seed); out = os.path.join(k.staging, "retry-live.png")
    forge_module.nano = lambda *args: (_ for _ in ()).throw(RuntimeError("offline provider failure"))
    try:
        cmd_gen(k, [_live_req(k, seed)], False)
    finally:
        forge_module.nano = old_nano
    assert not os.path.exists(out) and not os.path.exists(out + ".lock")
    assert not list(Path(k.staging).glob("*.png.tmp"))
    try:
        cmd_gen(k, [_live_req(k, seed, name="../escaped")], False)
    except SystemExit as e:
        assert "filename stem" in str(e), str(e)
    else:
        assert False, "a generation target must never escape the resolved staging directory"


def test_live_gen_reclaims_a_dead_owner_lock_and_rechecks_digest_before_provider_use():
    seed_dir = tempfile.mkdtemp(); seed = os.path.join(seed_dir, "seed.png")
    open(seed, "wb").write(_LIVE_PNG)
    k = _live_kit(seed); out = os.path.join(k.staging, "retry-live.png")
    json.dump({"pid": 99999999, "token": "killed-owner", "created_at": 0},
              open(out + ".lock", "w", encoding="utf-8"))
    old_nano = forge_module.nano; forge_module.nano = lambda *args: _LIVE_PNG
    try:
        cmd_gen(k, [_live_req(k, seed)], False)
    finally:
        forge_module.nano = old_nano
    assert open(out, "rb").read() == _LIVE_PNG and not os.path.exists(out + ".lock")

    original = hashlib.sha256(open(seed, "rb").read()).hexdigest()
    k = _live_kit(seed, mutate_prompt=lambda: open(seed, "wb").write(b"changed"))
    called = []
    forge_module.nano = lambda *args: called.append(True) or _LIVE_PNG
    try:
        try:
            cmd_gen(k, [_live_req(k, seed, digest=original)], False)
        except SystemExit as e:
            assert "seed integrity failure" in str(e), str(e)
        else:
            assert False, "a post-preflight digest mismatch must abort before the provider"
    finally:
        forge_module.nano = old_nano
    assert not called and not os.path.exists(os.path.join(k.staging, "retry-live.png"))


def test_live_seed_integrity_failure_aborts_remaining_batch_and_cleans_reservation():
    seed_dir = tempfile.mkdtemp(); seed = os.path.join(seed_dir, "seed.png")
    open(seed, "wb").write(_LIVE_PNG)
    digest = hashlib.sha256(open(seed, "rb").read()).hexdigest()
    k = _live_kit(seed, mutate_prompt=lambda: open(seed, "wb").write(b"changed"))
    called = []
    old_nano = forge_module.nano; forge_module.nano = lambda *args: called.append(True) or _LIVE_PNG
    try:
        try:
            cmd_gen(k, [_live_req(k, seed, name="first", digest=digest),
                        _live_req(k, seed, name="second")], False)
        except SystemExit as e:
            assert "remaining batch aborted" in str(e), str(e)
        else:
            assert False, "a live exact-read digest mismatch must abort the batch"
    finally:
        forge_module.nano = old_nano
    assert not called
    for name in ("first", "second"):
        assert not os.path.exists(os.path.join(k.staging, name + ".png"))
        assert not os.path.exists(os.path.join(k.staging, name + ".png.lock"))
    assert not list(Path(k.staging).glob("*.png.tmp"))


def test_windows_live_owner_lock_is_not_reclaimed_or_signalled():
    if os.name != "nt":
        return
    k = _live_kit("")
    out = os.path.join(k.staging, "retry-live.png")
    json.dump({"pid": os.getpid(), "token": "live-owner", "created_at": 0},
              open(out + ".lock", "w", encoding="utf-8"))
    old = time.time() - forge_module.LOCK_STALE_SECONDS - 1
    os.utime(out + ".lock", (old, old))
    assert forge_module._pid_is_alive(os.getpid())
    assert not forge_module._reclaimable_staging_lock(out + ".lock")
    _, lock, token, skip = forge_module._reserve_staging_output(k, "retry-live", False)
    assert lock is None and token is None and "reserved by concurrent" in skip
    assert os.path.exists(out + ".lock") and forge_module._pid_is_alive(os.getpid())


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_"):
            fn()
    print("PASS test_forge_seed_requirement")

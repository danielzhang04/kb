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
from forge import (BASE_TEMPLATE, Kit, cmd_batch, cmd_gen, figure_frame_name, merge_vocabulary,
                   preflight_batch, resolve_request_seeds, seed_roles_text, seeding_law_violations,
                   shot_cast, place_anchor_for, video_root_for,
                   cmd_retry_batch, RETRY_OVERLAY_SCHEMA)
from conftest import stamp_all_pass, stamp_kit

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]
TILE = "channels/the-second-take/visual-kit/refs/env/scene-style-tile.png"


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


def test_cmd_gen_passes_each_requests_own_style_suffix_and_never_invents_one():
    root = tempfile.mkdtemp(); staging = os.path.join(root, "staging"); os.makedirs(staging)
    seed = os.path.join(root, "seed.png"); open(seed, "wb").write(b"seed")
    # `reference` is no longer gate-exempt BY ROLE (I-1) — only the ad-hoc `gen --seed` CALL SITE
    # is — so this batch-executor fixture supplies the ruling its seed would really carry.
    stamp_all_pass(staging, seed)
    seen = []
    def prompt_for(mode, delta, **kwargs):
        seen.append((delta, kwargs.get("suffix")))
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
         "plate": True, "prompt_suffix": "TAIL VOICE"},
        composite("chain", "environment", "chain authored", plate=False,
                  prompt_suffix="TAIL VOICE"),
        composite("anchored", "style", "anchor authored", plate=False,
                  place_anchor="assets/scenes/L00.png", prompt_suffix="TAIL VOICE"),
        # a STEP-1 identity card carries no suffix: `cmd_batch` does not put one on it
        composite("fig-reference", "environment", "STEP-1 authored"),
    ]
    with contextlib.redirect_stdout(io.StringIO()):
        cmd_gen(k, reqs, True, dry=True)
    assert [suffix for _, suffix in seen] == ["TAIL VOICE", "TAIL VOICE", "TAIL VOICE", ""], seen
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


# --- THE PERFORMER TIER IS ABOLISHED (P2, 2026-08-12) --------------------------------------------
# `base` is the shared RIG, never a cast identity: every human in frame is NAMED CAST or CROWD
# (visual-grammar §2), and an anonymous foreground human does not exist. The 2026-08-06 tier that
# cast it is rolled back to ea71f99's `shot_cast` exclusion. What is NOT rolled back is that
# exclusion's SILENCE — a `base` casting used to resolve to `[]` and travel on unremarked, minting
# no card, seeding nothing, then measuring `cast_free`. `seeding_law_violations` refuses it by name.

PERFORMER = ("A brick-yard clerk in a 1980s back office, `base`, `expr-deadpan`, "
            "`action-armscrossed`, stage-left behind the counter.")


def test_shot_cast_excludes_the_rig_template_from_every_shots_cast():
    """The ea71f99 condition, restored: `n in chars and n != BASE_TEMPLATE`. A prompt naming
    `base` builds NO cast entry for it, and its `expr-`/`action-` slugs bind to nothing."""
    assert shot_cast(REG, PERFORMER) == []
    # ...while a NAMED character in the same prompt shape still resolves with its full recipe
    named = ("A brick-yard clerk in a 1980s back office, `hq-banker`, `expr-deadpan`, "
             "`action-armscrossed`, stage-left behind the counter.")
    assert shot_cast(REG, named) == [("hq-banker", ["expr-deadpan", "action-armscrossed"])]
    # and the tier's `costume_key` is gone: the card's fourth dimension is now the clause the
    # card is MINTED holding (P8), derived from the beat itself and absent when none derives
    assert figure_frame_name("hq-banker", "action-armscrossed", "expr-deadpan") == \
        "fig-hq-banker--action-armscrossed--expr-deadpan"


def test_casting_the_rig_template_is_refused_fail_loud_never_dropped_in_silence():
    """THE GUARD 27bc7e2 BOUGHT, KEPT. The naked rollback re-opens one hole: `base` resolves to
    no cast entry, so the shot seeds nothing and then measures `cast_free`. Closed by re-pointing
    the existing `figures.anon_foreground` refusal at a `base` casting — a REFUSAL, at $0, naming
    the shot and the two legal dispositions."""
    bad = seeding_law_violations(K, _req(delta=PERFORMER), [PLATE])
    assert len(bad) == 1, bad
    assert "casts `base`" in bad[0] and "RIG TEMPLATE" in bad[0], bad
    assert "NEW named cast member" in bad[0] and "mass action" in bad[0], bad
    # no card can buy it off: the tier does not exist, so there is no slate that makes it legal
    assert any("casts `base`" in b for b in seeding_law_violations(
        K, _req(delta=PERFORMER),
        ["_staging/fig-base--action-armscrossed--expr-deadpan.png", PLATE])), \
        "a `base` casting was bought off with a card — the tier is abolished, not re-seedable"
    # ...and refused identically on a delta beat, where the raw prose is parsed the same way
    assert any("casts `base`" in b for b in seeding_law_violations(
        K, _req(stage_role="delta", delta="The same office, except `base` is now seated."),
        [REFS + "base/base.png", PLATE])), "a `base` casting slipped through on a delta"


def test_the_abolished_tier_leaves_no_seed_role_prose_behind():
    """P2 deletes the performer's `figure` role prose and the canonical-is-BASE_TEMPLATE branch.
    A `base`-charactered seed now falls through to the generic prose for its role, and NOTHING in
    the request tells a provider it is drawing an anonymous, un-named, un-recurring figure."""
    text = seed_roles_text([
        {"path": "_staging/fig-base--action-armscrossed--expr-deadpan.png", "role": "figure",
         "character": "base"},
        {"path": REFS + "base/base.png", "role": "canonical", "character": "base"}])
    for gone in ("seeded PERFORMER", "ANONYMOUS figure", "recurs nowhere",
                 "shared BASE RIG template", "era costume it wears"):
        assert gone not in text, (gone, text)
    # a named cast member's prose is byte-identical to before (P9 edits it later, not P2)
    cast_text = seed_roles_text(
        [{"path": CANON, "role": "canonical", "character": "hq-banker"}])
    assert "pinned costume come from this image only" in cast_text, cast_text


def test_the_anon_foreground_refusal_routes_to_cast_or_mass_action_not_a_performer():
    """Conflict row 2: the anti-demotion clause survives P2 with only its FALLBACK rewired. The
    refusal that used to send an author to the performer tier now sends them to the standard
    cast-generation waves, or to mass action."""
    bad = seeding_law_violations(K, _req(delta="A dock at dawn.",
                                         figures={"anon_foreground": ["the worker"]}), [PLATE])
    assert len(bad) == 1 and "anon_foreground" in bad[0], bad
    assert "seeded performer" not in bad[0] and "`base` plus" not in bad[0], bad
    assert "NEW named cast member" in bad[0] and "standard cast-generation waves" in bad[0], bad
    assert "mass action" in bad[0], bad


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


def _t01_card():
    """T01's STEP-1 card name. P8 keys a card on the clause derived from its OWN beat, so a fixture
    that hard-coded the recipe-only name would assert a card the builder never mints."""
    prompt = _SCOPE_SHOTS["long_form"]["shots"][0]["still_prompt"]
    return figure_frame_name("miniscribe-rep", "action-powerstance", "expr-smug",
                             forge_module.beat_clause(prompt, "miniscribe-rep"))


def _scope_fixture():
    v = tempfile.mkdtemp()
    json.dump(_SCOPE_SHOTS, open(os.path.join(v, "shots.json"), "w", encoding="utf-8"))
    return v, os.path.join(v, "shots.json"), os.path.join(v, "spec.json")


def _batch(shots_path, out, scope):
    """Run cmd_batch quietly; return (spec or None, SystemExit text or None)."""
    k = _real_kit()
    stamp_kit(k, os.path.dirname(shots_path))   # P3: a reviewed standing library
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
    fig = _t01_card()
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
        _t01_card(), "crowd-exemplar", "prop-beige-pc"], scene["seed"]
    # T01 carries figures, so it does NOT take the §5 style tile (its cast seeds draw the
    # register); T04 is CAST-FREE, so the tile is derived onto it beside its authored exemplar.
    assert [Path(s).stem for s in next(i for i in spec if i["name"] == "T04")["seed"]] == \
        ["stamp-block-outlined", "scene-style-tile"]


def test_explicit_tags_over_cap_still_hard_error_instead_of_truncating():
    """T01 declares no `place`, so the crowd exemplar (the ONE displacement step that needs a
    place plate to absorb the mass) can never legally clear here — and both explicit tags are
    `environment`, not `prop`, so step 3 has nothing to take either. With no droppable seed
    anywhere the refusal must stand, naming figure count rather than either locked tag."""
    _, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    shot = doc["long_form"]["shots"][0]
    shot["still_prompt"] = shot["still_prompt"].replace(
        "`miniscribe-rep`, `expr-smug`, `action-powerstance`, at",
        "`miniscribe-rep`, `expr-smug`, `action-powerstance`, and `ibm-suit`, `expr-deadpan`, at")
    shot["figures"] = {"crowd": True}
    shot["assets"] = {n: f"channels/the-second-take/visual-kit/refs/env/{n}.png" for n in (
        "lettering-marker-italic", "stamp-block-outlined")}
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T01"])
    assert spec is None, spec
    assert "5 seeds over the cap of 4" in err, err
    assert "figure count" in err, err
    assert "did not fit" not in err, err
    assert "lettering-marker-italic" not in err and "stamp-block-outlined" not in err, err
    assert not os.path.exists(out), err


def test_character_free_place_plate_carries_only_the_style_tile_and_stays_a_plate():
    """The §5 scene style tile is the ONE seed a cast-free place plate carries. It contributes
    register and palette, never content, so `plate` — derived from CONTENT seeds — stays True and
    the frame still mints its own place."""
    _, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    doc["long_form"]["shots"] = [{"id": "T00", "source": "ai-gen", "stage": "new-place",
                                    "still_prompt": "A warm records room with a bare central table."}]
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["T00"])
    assert err is None, err
    payload = "A warm records room with a bare central table."
    roles = [{"path": TILE, "role": "style-anchor", "character": "scene-style-tile"}]
    assert spec == [{"name": "T00", "mode": "environment", "aspect": "16:9",
                     "delta": forge_module.placement_delta(payload, roles),
                     "payload": payload, "prompt_suffix": None,
                     "seed": [TILE], "seed_roles": roles,
                     "figures": None, "stage_role": None,
                     "assets_omitted": None,
                     "plate": True, "delta_primitives": None,
                     # C-1: names the plate this shot inherits when its chain parent IS the place's
                     # own plate, so `cmd_gen` can gate that frame once it has bytes. A
                     # plate-minting root inherits nothing, so it carries None.
                     "plate_parent": None, "expression_change": None,
                     "parent_depth": 0, "lineage": 0,
                     "why": "STYLE TILE — cast-free frame; §5 anchor `scene-style-tile` derived "
                            "(line register + palette only); PLATE — place-first frame, bible "
                            "descriptor + style suffix, no content anchor"}], spec


def test_a_base_casting_refuses_the_whole_batch_and_mints_nothing():
    """End to end over the REAL registry: a shot casting `base` no longer mints a card and no
    longer assembles. It is refused at pre-flight, at $0, with the restaging instruction — the
    abolished tier's whole route (card mint, dressed payload, costume key) is gone with it."""
    _, shots, out = _scope_fixture()
    doc = json.load(open(shots, encoding="utf-8"))
    doc["long_form"]["shots"] = [{
        "id": "E01", "source": "ai-gen", "stage": "back-office",
        "still_prompt": ("A brick-yard clerk in a 1980s back office, `base`, `expr-worried`, "
                         "`action-slump`, stage-left behind a counter of ledgers.")}]
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["E01"])
    assert spec is None, [i["name"] for i in spec] if spec else spec
    assert "E01" in err and "casts `base`" in err, err
    assert "NEW named cast member" in err and "mass action" in err, err


def test_a_named_characters_card_is_minted_holding_the_beats_own_act():
    """P8: the card is minted DOING what the beat asks. The clause `beat_clause` derives from the
    shot's own prose (clothing + the act) reaches the card payload, and — because the card is now
    beat-derived — that derivation re-enters the card's NAME. The key is the reuse key, so two
    beats deriving different clauses for one (character, pose, expression) must not collide on one
    filename. No new item FIELD carries it: the law re-derives the same clause from the same prose
    (the abolished performer tier's `costume_key` stays gone)."""
    _, shots, out = _scope_fixture()
    spec, err = _batch(shots, out, ["T01"])
    assert err is None, err
    prompt = _SCOPE_SHOTS["long_form"]["shots"][0]["still_prompt"]
    clause = forge_module.beat_clause(prompt, "miniscribe-rep")
    assert clause and "brickyard gate" in clause, clause
    assert spec[0]["name"] == figure_frame_name(
        "miniscribe-rep", "action-powerstance", "expr-smug", clause), spec[0]["name"]
    assert spec[0]["name"].startswith("fig-miniscribe-rep--action-powerstance--expr-smug--"), \
        spec[0]["name"]
    assert "minted for reads" in spec[0]["payload"], spec[0]["payload"]
    assert "bodily ACT" in spec[0]["payload"], spec[0]["payload"]
    assert "dressed for" not in spec[0]["why"], spec[0]["why"]
    assert "costume_key" not in next(i for i in spec if i["name"] == "T01"), spec
    # the law names the SAME card the builder minted — re-derived from the prose, never a field
    scene = next(i for i in spec if i["name"] == "T01")
    bad = seeding_law_violations(_real_kit(), dict(scene, seed=[], seed_roles=[]), [])
    assert any(spec[0]["name"] in b for b in bad), bad


def test_one_beats_derived_clause_keys_the_card_and_an_identical_beat_still_reuses_it():
    """Two-sided: a DIFFERENT derived clause mints its own card (no silent collision — the warning
    `figure_frame_name` has carried since P2), while an IDENTICAL clause resolves to the same name,
    so reuse-before-regenerate survives the new dimension."""
    a = figure_frame_name("hq-banker", "action-slump", "expr-deadpan", "In a grey suit, slumping.")
    b = figure_frame_name("hq-banker", "action-slump", "expr-deadpan", "In a grey suit, hauling.")
    same = figure_frame_name("hq-banker", "action-slump", "expr-deadpan", "In a grey suit, slumping.")
    assert a != b and a == same, (a, b)
    # a clause-free call is byte-identical to the pre-P8 name: nothing hand-authored is re-keyed
    assert figure_frame_name("hq-banker", "action-slump", "expr-deadpan") == \
        "fig-hq-banker--action-slump--expr-deadpan"
    # ...and the character is still the FIRST component, which is how the board reads it back
    assert a.startswith("fig-hq-banker--action-slump--expr-deadpan--"), a


def test_a_pose_less_card_takes_the_clothing_and_is_never_told_to_perform_the_act():
    """The act rides ONLY where a pose reference is seeded. A pose-less card told to perform an act
    would free-draw the body — and with it the hands, which is the five-finger defect P8 exists to
    stop ("exposed hands are seeded, never free-drawn"). Its geometry lives scene-level (an
    interaction template), or the missing act is an authoring-side Pass-1 gate item."""
    clause = "A 1985 loading bay. In a brown shop coat, shoving the truck doors shut."
    posed = forge_module.figure_card_payload("action-armscrossed", clause)
    poseless = forge_module.figure_card_payload(None, clause)
    assert "bodily ACT" in posed and "pose reference" in posed, posed
    assert "bodily ACT" not in poseless, poseless
    assert "brown shop coat" in poseless and "standing squarely at rest" in poseless, poseless
    for p in (posed, poseless):
        assert "none of its setting, props, lettering or other people" in p, p


def test_the_beat_clause_is_the_era_opener_plus_the_figures_own_sentence():
    """The era source is PROSE — the same source a place plate takes its era from — bound to the
    sentence that names the figure, plus the opener that dates the scene. That ONE sentence also
    carries the beat's ACT ("leans over a ledger"), which is why P8 reuses this deriver rather than
    adding a second one. Control tokens and quoted literals never reach the card: the seeds already
    carry the vocabulary, and a card that draws lettering bleeds it into every scene seeding it. A
    figure the prompt does not name yields nothing, so the opener can never travel alone."""
    prompt = ("A 1974 sorting hall, rain on the skylights. `base`, `expr-worried`, in a brown "
              "shop coat and flat cap, leans over a ledger marked 'PAID'. Framing: waist-up.")
    clause = forge_module.beat_clause(prompt, "base")
    assert clause == ("A 1974 sorting hall, rain on the skylights. in a brown shop coat and flat "
                      "cap, leans over a ledger marked."), clause
    assert "leans over a ledger" in clause, clause          # the ACT, from the same sentence
    assert forge_module.beat_clause(prompt, "hq-banker") == ""
    # a card with no derived prose is exactly the pre-fix payload — no empty clause
    assert "minted for reads" not in forge_module.figure_card_payload("action-slump")
    assert "minted for reads" in forge_module.figure_card_payload("action-slump", clause)


MICRO_PATTERN_PROSE = ("A 1985 test bench under strip light. `base`, `expr-shock`, in a white lab "
                       "coat and quilted oven gloves, backs off from a board glowing cherry-red.")


def test_a_micro_pattern_texture_adjective_never_reaches_a_derived_rig_card():
    """`line-register` FAILS any hairline or micro-pattern field, and a NOUN PHRASE that authors one
    ("quilted oven gloves") beats negative prose arguing against it — proved twice on L32, against
    two escalating "ONE FLAT UNIFORM colour fill / NO quilting, NO crosshatch, NO diamond lattice"
    instructions. So the derived clause LOSES the adjective at the card instead of arguing with it
    there. The clause itself is untouched at its source, so the string a caller keys a card on stays
    the prose as authored — which is what P8's card key hashes."""
    clause = forge_module.beat_clause(MICRO_PATTERN_PROSE, "base")
    assert "quilted" in clause, clause                     # the KEY still hashes the prose as authored
    payload = forge_module.figure_card_payload("action-recoil", clause)
    assert "white lab coat and oven gloves" in payload, payload
    assert "quilt" not in payload.lower(), payload
    for word in ("crosshatched", "herringbone", "houndstooth", "pinstriped", "polka-dot",
                 "corduroy", "tweed", "ribbed", "woven", "chequered", "plaid", "fishnet",
                 "latticed", "argyle", "gingham", "seersucker", "checked", "tartan"):
        p = forge_module.figure_card_payload("action-recoil", f"In a {word} coat and flat boots.")
        assert word.split("-")[0] not in p.lower(), (word, p)
        assert "In a coat and flat boots." in p, (word, p)


def test_the_micro_pattern_strip_never_touches_a_cast_characters_pinned_costume():
    """SCOPE GUARD. The strip belongs to the FROM-PROSE derived-clause path and nowhere else. A
    named character's costume is pinned in its canonical and carried verbatim in the video library's
    vocabulary — `hq-banker`'s pinstripe suit is established, PASSING identity, so a re-mint of that
    card must still say pinstripe."""
    pinned = "a charcoal pinstriped three-piece suit with a woven silk tie"
    assert forge_module.strip_micro_pattern_texture(pinned) != pinned   # the strip IS live on this text
    video = tempfile.mkdtemp()
    lib = os.path.join(video, "assets", "library")
    os.makedirs(lib)
    json.dump({"assets": [{"name": "hq-banker", "kind": "identity", "costume": pinned,
                           "file": REFS + "hq-banker/hq-banker.png"}]},
              open(os.path.join(lib, "manifest.json"), "w", encoding="utf-8"))
    merged = merge_vocabulary({"characters": {}, "assets": []}, video)
    assert merged["characters"]["hq-banker"]["costume"] == pinned, merged["characters"]["hq-banker"]

    # ...and where a beat DOES author dress on a named character (P8 sends every cast card the
    # derived clause), the micro-pattern adjective is what the card loses: the garment survives,
    # `quilted` does not, and the seed-role prose still points identity and costume at the
    # canonical image rather than at the prose.
    reg = {"characters": {"hq-banker": {"base": "refs/hq-banker.png", "costume": pinned}},
           "assets": [{"name": "expr-fear", "kind": "expression", "file": "refs/expr-fear.png"}]}
    out = forge_module._retry_step1(
        {"kind": "step1", "shot": "T01", "character": "hq-banker",
         "name": "fig-hq-banker-remint", "defect": "expression"},
        {"still_prompt": "`hq-banker`, `expr-fear`, in his quilted overcoat at the gate."},
        SimpleNamespace(reg=reg), "retry entry 1")
    assert "minted for reads" in out["payload"], out["payload"]
    assert "overcoat" in out["payload"] and "quilted" not in out["payload"], out["payload"]
    assert "pinned costume come from this image only" in out["delta"], out["delta"]

    # I1: the dress half is CONDITIONAL, so the two strongest instructions in one request never
    # disagree. The common live shape is a clause with NO garment content at all (setting and
    # placement only) — there the canonical's pinned costume governs, unchanged, and the card is
    # costume-invariant exactly as P2 had it.
    setting_only = forge_module.figure_card_payload(
        "action-point", "A 1985 loading bay under strip light. At the far end of the bay.")
    assert "Where that description AUTHORS clothing" in setting_only, setting_only
    assert "the costume the canonical seed pins governs unchanged" in setting_only, setting_only


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
    # each card also carries its own derived-clause key (P8): assert the recipe part of the name
    assert [Path(s).stem.rsplit("--", 1)[0] for s in scene["seed"][:2]] == [
        "fig-miniscribe-rep", "fig-ibm-suit"], scene["seed"]
    assert scene["seed"][2].replace("\\", "/").endswith("assets/scenes/L60.png"), scene["seed"]
    assert Path(scene["seed"][3]).stem == "crowd-exemplar", scene["seed"]


def _crowd_only_video(with_video_exemplar):
    """One crowd-declaring shot, in a video that may or may not have minted its OWN exemplar."""
    v = tempfile.mkdtemp()
    if with_video_exemplar:
        lib = os.path.join(v, "assets", "library")
        os.makedirs(lib)
        open(os.path.join(lib, "crowd-exemplar.png"), "wb").write(b"\x89PNG\r\n\x1a\nthis video")
    doc = {"schema": "shots/1", "video_slug": "t", "long_form": {"aspect_ratio": "16:9", "shots": [{
        "id": "L60", "source": "ai-gen", "stage_role": "base", "figures": {"crowd": True},
        "still_prompt": "A waiting crowd fills the brickyard gate in the flat noon light."}]}}
    shots, out = os.path.join(v, "shots.json"), os.path.join(v, "spec.json")
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    spec, err = _batch(shots, out, ["L60"])
    assert err is None, err
    return [str(s).replace("\\", "/") for s in [i for i in spec if i["name"] == "L60"][0]["seed"]]


def test_p4_the_crowd_seed_prefers_THIS_VIDEOS_own_minted_exemplar():
    """P4 (2026-08-12): the crowd exemplar is minted PER VIDEO — its era dress, its head-tone set,
    its hair silhouettes — so the video's own frame outranks the channel's standing one. Same
    precedence shape `vfile` already uses (the nearest, most specific file wins), and it has to be
    stated because `merge_vocabulary` deliberately lets the CHANNEL entry win a name collision,
    which would otherwise make a video's own exemplar unreachable."""
    seeds = _crowd_only_video(True)
    assert any(s.endswith("assets/library/crowd-exemplar.png") for s in seeds), seeds
    assert not any(s.endswith("refs/base/crowd-exemplar.png") for s in seeds), seeds


def test_p4_without_a_video_exemplar_the_channels_standing_frame_still_seeds():
    """The fallback is the whole point of a preference: a video that has not minted its own
    exemplar yet keeps seeding the channel's, unchanged."""
    seeds = _crowd_only_video(False)
    assert any(s.endswith("refs/base/crowd-exemplar.png") for s in seeds), seeds


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
    stamp_kit(k, os.path.dirname(shots_path))   # P3: a reviewed standing library
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

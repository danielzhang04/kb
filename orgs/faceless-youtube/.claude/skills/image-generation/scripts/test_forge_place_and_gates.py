#!/usr/bin/env python3
"""The 2026-08-04 doctrine reset: the PLACE model and the batch integrity gates (plain asserts).

Run: py -3 .claude/skills/image-generation/scripts/test_forge_place_and_gates.py

Covers, in the order the doctrine states them:
  C-4  a `place` is the seeding identity (place > stage > shot name, ONE map), and the derived
       `plate` marker — not an authored `root_scene` flag — is the only zero-seed exception;
  C-5  a plate may only seed shots in its OWN place; `place_anchor` is legal on any non-delta shot;
  C-9  over the cap, the place plate displaces the crowd exemplar (it already holds the rear mass);
  C-6  a staged STEP-1 is reusable only with an all-pass, digest-current review record;
  C-10 a delta that authors an expression must carry that expression's pixels;
  C-11 every emitted scene records `parent_depth`/`lineage`, and a PARKED parent is never inherited.
"""
import contextlib, hashlib, inspect, io, json, os, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import forge as forge_module
from forge import Kit, cmd_batch, figure_frame_name, resolve_request_seeds, seeding_law_violations

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]
PNG = b"\x89PNG\r\n\x1a\n"
REFS = "channels/the-second-take/visual-kit/refs/"
CAST = "`miniscribe-rep`, `expr-smug`, `action-powerstance`,"


def _kit():
    k = Kit(str(KIT_DIR), dry=True)
    k.root = str(ROOT)          # a worktree has no env marker for `Kit` to walk up to
    k.staging = os.path.join(tempfile.mkdtemp(), "_staging")
    os.makedirs(k.staging)
    return k


def _doc(*shots):
    for s in shots:
        s.setdefault("source", "ai-gen")
    return {"schema": "shots/1", "video_slug": "t",
            "long_form": {"aspect_ratio": "16:9", "shots": list(shots)}}


def _video(*scene_names):
    v = tempfile.mkdtemp()
    if scene_names:
        scenes = os.path.join(v, "assets", "scenes")
        os.makedirs(scenes)
        for n in scene_names:
            open(os.path.join(scenes, n + ".png"), "wb").write(PNG)
    return v


def _manifest(video, shots):
    scenes = os.path.join(video, "assets", "scenes")
    os.makedirs(scenes, exist_ok=True)
    json.dump({"video_slug": "t", "shots": shots},
              open(os.path.join(scenes, "manifest.json"), "w", encoding="utf-8"))


def _run(doc, scope=None, video=None, kit=None):
    """(spec | None, SystemExit text | None, video dir) — cmd_batch, quietly."""
    v = video or tempfile.mkdtemp()
    shots, out = os.path.join(v, "shots.json"), os.path.join(v, "spec.json")
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_batch(kit or _kit(), shots, out, None, scope)
    except SystemExit as e:
        return None, str(e), v
    return json.load(open(out, encoding="utf-8")), None, v


def _by_name(spec, name):
    return next(i for i in spec if i["name"] == name)


# --- C-4: the place model ----------------------------------------------------------------------

def test_a_place_holds_across_its_stage_chains_and_only_its_first_frame_is_a_plate():
    """L89-L91's mechanism: shots on one set ran as independent seedless roots because `stage` —
    a chain capped at 1 base + 3 deltas — was the only place forge knew."""
    spec, err, _ = _run(_doc(
        {"id": "P1", "place": "records-room", "stage": "records-a", "stage_role": "base",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "P2", "place": "records-room", "stage": "records-a", "stage_role": "delta",
         "still_prompt": "The same records room, unchanged, except the table now holds one ledger."},
        {"id": "P3", "place": "records-room", "stage": "records-b", "stage_role": "base",
         "still_prompt": "The same records room from the doorway, a filing drawer standing open."}))
    assert err is None, err
    assert _by_name(spec, "P1")["plate"] is True and _by_name(spec, "P1")["seed"] == [], spec[0]
    assert _by_name(spec, "P2")["seed"] == ["_staging/P1.png"], spec[1]
    # a NEW stage chain in an ESTABLISHED place still seeds that place's first frame
    p3 = _by_name(spec, "P3")
    assert p3["plate"] is False and p3["seed"] == ["_staging/P1.png"], p3


def test_a_shot_declaring_no_place_keys_on_its_stage_then_on_its_own_id():
    """The legacy files carry no `place`; their seeding may not drift by a byte."""
    spec, err, _ = _run(_doc(
        {"id": "S1", "stage": "yard", "stage_role": "base",
         "still_prompt": "A brickyard gate beside a stack of pallets under open sky."},
        {"id": "S2", "stage": "yard", "stage_role": "delta",
         "still_prompt": "The same brickyard, unchanged, except the gate now stands open."},
        {"id": "S3", "still_prompt": "A single clay brick on its end against a flat backdrop."}))
    assert err is None, err
    assert _by_name(spec, "S2")["seed"] == ["_staging/S1.png"], spec
    assert _by_name(spec, "S3")["plate"] is True and _by_name(spec, "S3")["seed"] == [], spec


def test_the_zero_seed_exception_keys_on_the_derived_plate_not_an_authored_flag():
    stub = {"name": "L01", "mode": "environment", "delta": "an empty yard"}
    assert resolve_request_seeds(None, dict(stub, plate=True)) == []
    for illegal in (dict(stub, root_scene=True),
                    dict(stub, plate=True, stage_role="delta"),
                    dict(stub, plate=True, place_anchor="assets/scenes/P1.png")):
        try:
            resolve_request_seeds(None, illegal)
        except SystemExit as e:
            assert "only a derived place plate" in str(e), str(e)
        else:
            assert False, f"a zero-seed request was accepted without a derived plate: {illegal}"


def test_the_dead_plate_candidate_path_is_gone():
    assert "plate_candidates" not in inspect.signature(cmd_batch).parameters
    source = Path(forge_module.__file__).read_text(encoding="utf-8")
    assert "root_scene" not in source and "plate-candidates" not in source


# --- C-5: the same-place law -------------------------------------------------------------------

def test_a_place_anchor_is_legal_on_any_non_delta_shot_of_its_own_place():
    """The base-only restriction is reversed: 74 of the audited 214 shots carry no stage at all."""
    v = _video("P1")
    spec, err, _ = _run(_doc(
        {"id": "P1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "P9", "place": "records-room", "place_anchor": "assets/scenes/P1.png",
         "still_prompt": f"{CAST} standing at the records-room table."}), ["P9"], video=v)
    assert err is None, err
    assert any(str(s).replace("\\", "/").endswith("assets/scenes/P1.png")
               for s in _by_name(spec, "P9")["seed"]), spec


def test_a_place_anchor_from_another_place_is_the_probe_refuted_bleed_and_hard_errors():
    v = _video("P1")
    doc = _doc(
        {"id": "P1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "Y9", "place": "brick-yard", "place_anchor": "assets/scenes/P1.png",
         "still_prompt": f"{CAST} at the brickyard gate."})
    spec, err, _ = _run(doc, ["Y9"], video=v)
    assert spec is None and "cross-place image seeding" in err and "Y9" in err, err
    # an unattributable frame is not provably same-place either
    doc["long_form"]["shots"][1]["place"] = "records-room"
    doc["long_form"]["shots"][1]["place_anchor"] = "assets/scenes/stray.png"
    open(os.path.join(v, "assets", "scenes", "stray.png"), "wb").write(PNG)
    spec, err, _ = _run(doc, ["Y9"], video=v)
    assert spec is None and "cross-place image seeding" in err, err


def test_a_delta_may_not_carry_a_place_anchor():
    v = _video("P1")
    spec, err, _ = _run(_doc(
        {"id": "P1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "P2", "place": "records-room", "stage": "r", "stage_role": "delta",
         "place_anchor": "assets/scenes/P1.png",
         "still_prompt": "The same records room, unchanged, except the drawer is open."}),
        ["P2"], video=v)
    assert spec is None and "not valid on a delta beat" in err, err


# --- C-9: seed-cap displacement -----------------------------------------------------------------

_CROWDED = {"id": "C2", "place": "records-room", "figures": {"crowd": True},
            "assets": {"prop-beige-pc": REFS + "env/prop-beige-pc.png"},
            "still_prompt": ("`miniscribe-rep`, `expr-smug`, `action-powerstance`, and `ibm-suit`, "
                             "`expr-deadpan`, `action-armscrossed`, face a waiting crowd across the "
                             "records-room table beside a `prop-beige-pc`.")}


def test_over_cap_the_place_plate_displaces_the_crowd_exemplar():
    spec, err, _ = _run(_doc(
        {"id": "C1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."},
        dict(_CROWDED)))
    assert err is None, err
    c2 = _by_name(spec, "C2")
    stems = [Path(s).stem for s in c2["seed"]]
    assert len(stems) == 4 and "crowd-exemplar" not in stems, stems
    assert "_staging/C1.png" in c2["seed"], c2["seed"]
    assert "CAP DISPLACEMENT" in c2["why"], c2["why"]
    assert c2["assets_omitted"] == ["crowd-exemplar"], c2["assets_omitted"]


def test_a_shot_still_over_cap_after_displacement_is_restaged_never_truncated():
    crowded = dict(_CROWDED)
    crowded["assets"] = {"prop-beige-pc": REFS + "env/prop-beige-pc.png",
                         "stamp-block-outlined": REFS + "env/stamp-block-outlined.png"}
    crowded["still_prompt"] = crowded["still_prompt"].replace(
        "beside a `prop-beige-pc`", "beside a `prop-beige-pc` and a `stamp-block-outlined`")
    spec, err, _ = _run(_doc(
        {"id": "C1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."}, crowded))
    assert spec is None and "5 seeds over the cap" in err and "restage the shot" in err, err


# --- C-6: the staged-figure review record --------------------------------------------------------

_FIG = figure_frame_name("miniscribe-rep", "action-powerstance", "expr-smug")


def _staged_figure(k, digest_bytes=PNG):
    open(os.path.join(k.staging, _FIG + ".png"), "wb").write(digest_bytes)
    return hashlib.sha256(digest_bytes).hexdigest()


def _record(k, **overrides):
    entry = {"canonical_sha256": overrides.pop("canonical_sha256", None),
             "expression_sha256": None,
             "verdicts": overrides.pop("verdicts", {"rig": "pass", "flat-cel": "pass"}),
             "reviewer": "fresh-eyes", "date": "2026-08-04"}
    json.dump({"figures": {_FIG: entry}},
              open(os.path.join(k.staging, "review.json"), "w", encoding="utf-8"))


def _reuse_run(kit):
    return _run(_doc({"id": "R1", "place": "records-room",
                      "still_prompt": f"{CAST} alone at the records-room table."}), kit=kit)


def test_an_all_pass_current_review_record_admits_a_staged_step1_for_reuse():
    k = _kit()
    _record(k, canonical_sha256=_staged_figure(k))
    spec, err, _ = _reuse_run(k)
    assert err is None, err
    assert [i["name"] for i in spec] == ["R1"], spec      # no STEP-1 gen: the frame was reused
    assert "REUSED" in _by_name(spec, "R1")["why"], spec


def test_a_staged_step1_with_no_record_a_failed_record_or_a_stale_digest_is_refused():
    for reason, build in (
            ("no review record", lambda k: None),
            ("record FAILS rig", lambda k: _record(k, canonical_sha256=_staged_figure(k),
                                                   verdicts={"rig": "fail"})),
            ("record is stale", lambda k: _record(k, canonical_sha256="0" * 64))):
        k = _kit()
        _staged_figure(k)
        build(k)
        spec, err, _ = _reuse_run(k)
        assert spec is None and reason in err, (reason, err)
        assert _FIG in err and "forge.py gen" in err and "--force" in err, err


# --- C-10: the expression-delta gate --------------------------------------------------------------

CANON = REFS + "miniscribe-rep/miniscribe-rep.png"
PARENT = "channels/c/videos/v/assets/scenes/L74.png"


def _delta_request(**kw):
    r = {"name": "L75", "mode": "environment", "stage_role": "delta",
         "payload": "The same office, unchanged, except `miniscribe-rep` is now `expr-worried`.",
         "expression_change": {"miniscribe-rep": "expr-worried"}, "assets_omitted": None}
    r["delta"] = r["payload"]
    r.update(kw)
    return r


def test_a_delta_that_changes_an_expression_must_carry_that_expressions_pixels():
    k = _kit()
    bad = seeding_law_violations(k, _delta_request(), [CANON, PARENT])
    assert len(bad) == 1 and "changes `miniscribe-rep` to `expr-worried`" in bad[0], bad
    assert "delta_primitives" in bad[0], bad
    # the declared primitive satisfies it, and so does a STEP-1 frame already holding it
    ok = _delta_request(delta_primitives={"miniscribe-rep": ["expr-worried"]})
    assert seeding_law_violations(k, ok, [CANON, PARENT, REFS + "base/expr-worried.png"]) == []
    held = "_staging/" + figure_frame_name("miniscribe-rep", None, "expr-worried") + ".png"
    assert seeding_law_violations(k, _delta_request(), [CANON, PARENT, held]) == []


def test_a_delta_restating_the_expression_its_chain_holds_stays_parent_plus_canonical():
    """The default delta authoring re-states the whole recipe while only a prop changes; the
    builder derives that no expression CHANGED, so no primitive is demanded (and no cap slot)."""
    spec, err, _ = _run(_doc(
        {"id": "E1", "place": "office", "stage": "office", "stage_role": "base",
         "still_prompt": f"{CAST} standing at the office desk."},
        {"id": "E2", "place": "office", "stage": "office", "stage_role": "delta",
         "still_prompt": f"The same office, with {CAST} while only the contract on the desk changes."},
        {"id": "E3", "place": "office", "stage": "office", "stage_role": "delta",
         "still_prompt": "The same office, unchanged, except `miniscribe-rep` is now `expr-worried`."}))
    assert spec is None and "E3" in err and "changes `miniscribe-rep` to `expr-worried`" in err, err
    assert "E2" not in err, err


def test_the_expression_gate_exempts_seed_and_mechanism_retries_and_no_hands_objects():
    k = _kit()
    retry = _delta_request(retry_authority={"kind": "seed/mechanism", "changed_spans": 1,
                                            "replaced": [], "reordered": []})
    assert seeding_law_violations(k, retry, [CANON, PARENT]) == []
    boxy = _delta_request(
        payload="The same office, unchanged, except `pc-boxy` is now `expr-worried`.",
        expression_change={"pc-boxy": "expr-worried"})
    boxy["delta"] = boxy["payload"]
    assert seeding_law_violations(k, boxy, [REFS + "pc-boxy/pc-boxy.png", PARENT]) == []


# --- C-11: the provenance ledger -----------------------------------------------------------------

def test_every_emitted_scene_records_its_parent_depth_and_canonical_lineage():
    spec, err, _ = _run(_doc(
        {"id": "P1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "P2", "place": "records-room", "stage": "r", "stage_role": "base",
         "still_prompt": "The same records room, one chair pulled out."},
        {"id": "P3", "place": "records-room", "stage": "r", "stage_role": "delta",
         "still_prompt": "The same records room, unchanged, except the drawer is open."}))
    assert err is None, err
    assert [(i["parent_depth"], i["lineage"]) for i in spec] == [(0, 0), (1, 1), (2, 2)], spec


def test_an_approved_parent_resets_the_lineage_and_a_parked_parent_is_never_inherited():
    v = _video("P1")
    _manifest(v, [{"shot_id": "P1", "file": "assets/scenes/P1.png", "review_status": "verified",
                   "parent_depth": 0, "lineage": 0}])
    doc = _doc({"id": "P1", "place": "records-room",
                "still_prompt": "A warm records room with a bare central table."},
               {"id": "P2", "place": "records-room",
                "still_prompt": "The same records room, one chair pulled out."})
    spec, err, _ = _run(doc, ["P2"], video=v)
    assert err is None, err
    assert (_by_name(spec, "P2")["parent_depth"], _by_name(spec, "P2")["lineage"]) == (1, 1), spec
    _manifest(v, [{"shot_id": "P1", "file": "assets/scenes/P1.png", "review_status": "parked"}])
    spec, err, _ = _run(doc, ["P2"], video=v)
    assert spec is None and "PARKED" in err and "P2" in err, err
    assert "review_status" not in err, "the retry-path wording must not be duplicated here: " + err


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else ""      # optional substring filter, for TDD stages
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and only in name:
            fn()
    print("PASS test_forge_place_and_gates")

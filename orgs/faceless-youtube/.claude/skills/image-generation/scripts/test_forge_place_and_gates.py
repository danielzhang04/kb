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
  C-11 every emitted scene records `parent_depth`/`lineage`, and a PARKED parent is never inherited;
  P3   EVERY asset class that seeds a scene passes that same review gate — plate, environment,
       prop, crowd exemplar, pose/expression primitive, and the in-batch STEP-1 card — while a
       named cast member's own canonical stays exempt (the G2 cast-mint ruling).
"""
import contextlib, hashlib, inspect, io, json, os, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import forge as forge_module
from forge import Kit, cmd_batch, figure_frame_name, resolve_request_seeds, seeding_law_violations
from conftest import stamp_all_pass, stamp_kit

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]
PNG = b"\x89PNG\r\n\x1a\n"
REFS = "channels/the-second-take/visual-kit/refs/"
TILE = REFS + "env/scene-style-tile.png"    # §5 style anchor, derived onto every cast-free gen
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


def _run(doc, scope=None, video=None, kit=None, stamp=True):
    """(spec | None, SystemExit text | None, video dir) — cmd_batch, quietly.

    `stamp=False` runs against an UNREVIEWED library: the state P3's gate exists to refuse."""
    v = video or tempfile.mkdtemp()
    shots, out = os.path.join(v, "shots.json"), os.path.join(v, "spec.json")
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    k = kit or _kit()
    if stamp:
        stamp_kit(k, v)         # P3: the channel's standing library is a REVIEWED library
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_batch(k, shots, out, None, scope)
    except SystemExit as e:
        return None, str(e), v
    return json.load(open(out, encoding="utf-8")), None, v


def _by_name(spec, name):
    return next(i for i in spec if i["name"] == name)


# --- C-4: the place model ----------------------------------------------------------------------

def test_a_place_holds_across_its_stage_chains_and_only_its_first_frame_is_a_plate():
    """L89-L91's mechanism: shots on one set ran as independent seedless roots because `stage` —
    a chain capped at 1 base + 2 deltas — was the only place forge knew."""
    spec, err, _ = _run(_doc(
        {"id": "P1", "place": "records-room", "stage": "records-a", "stage_role": "base",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "P2", "place": "records-room", "stage": "records-a", "stage_role": "delta",
         "still_prompt": "The same records room, unchanged, except the table now holds one ledger."},
        {"id": "P3", "place": "records-room", "stage": "records-b", "stage_role": "base",
         "still_prompt": "The same records room from the doorway, a filing drawer standing open."}))
    assert err is None, err
    # The place plate is still the frame that MINTS its place — `plate` reads content seeds only,
    # so the §5 style tile (register/palette, no content) rides along without un-marking it.
    assert _by_name(spec, "P1")["plate"] is True and _by_name(spec, "P1")["seed"] == [TILE], spec[0]
    assert _by_name(spec, "P2")["seed"] == ["_staging/P1.png", TILE], spec[1]
    # a NEW stage chain in an ESTABLISHED place still seeds that place's first frame
    p3 = _by_name(spec, "P3")
    assert p3["plate"] is False and p3["seed"] == ["_staging/P1.png", TILE], p3


def test_a_shot_declaring_no_place_keys_on_its_stage_then_on_its_own_id():
    """The legacy files carry no `place`; their seeding may not drift by a byte."""
    spec, err, _ = _run(_doc(
        {"id": "S1", "stage": "yard", "stage_role": "base",
         "still_prompt": "A brickyard gate beside a stack of pallets under open sky."},
        {"id": "S2", "stage": "yard", "stage_role": "delta",
         "still_prompt": "The same brickyard, unchanged, except the gate now stands open."},
        {"id": "S3", "still_prompt": "A single clay brick on its end against a flat backdrop."}))
    assert err is None, err
    assert _by_name(spec, "S2")["seed"] == ["_staging/S1.png", TILE], spec
    assert _by_name(spec, "S3")["plate"] is True and _by_name(spec, "S3")["seed"] == [TILE], spec


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
    # M14 sanctioned mirror: forge's refusal carries lint's law sentence VERBATIM, so an author who
    # fixes the shot lint described cannot read forge's message as a different rule.
    assert spec is None and _PLACE_ANCHOR_DELTA_LAW in " ".join(err.split()), err


_PLACE_ANCHOR_DELTA_LAW = ("a delta continues its own base's held scene via the chain parent; "
                           "`place_anchor` is a different seed, for a base or standalone shot")


def test_the_place_anchor_delta_law_sentence_is_byte_identical_to_lints():
    """Drift canary for the M14 mirror. `lint_shots.py` lives in a sibling SKILL with no import
    path to this one, so the law sentence is copied, not imported — this reads lint's source as
    TEXT and proves the two copies have not drifted apart."""
    lint = (Path(__file__).resolve().parents[2] / "visual-prompt-writer" / "scripts"
            / "lint_shots.py")
    assert lint.exists(), lint
    for src in (lint, Path(forge_module.__file__)):
        # the sentence lives inside a wrapped string literal in both files: drop the quoting the
        # wrap introduces and collapse whitespace, then the two must read identically.
        flat = " ".join(src.read_text(encoding="utf-8").replace('"', " ").split())
        assert _PLACE_ANCHOR_DELTA_LAW in flat, src


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


def test_a_shot_still_over_cap_after_all_legal_drops_is_restaged_never_truncated():
    """Even the full 3-step priority order (crowd, interaction, prop) can only clear ONE of the
    two seeds this shot is over by — a droppable `prop-beige-pc` plus a non-droppable
    `stamp-block-outlined` (environment, never a displacement target) and a text-bearing prompt
    that locks in the §5 lettering exemplar. What remains after both legal drops (2 cast + place +
    stamp + lettering = 5) is entirely non-droppable, so the refusal must still stand."""
    crowded = dict(_CROWDED)
    crowded["assets"] = {"prop-beige-pc": REFS + "env/prop-beige-pc.png",
                         "stamp-block-outlined": REFS + "env/stamp-block-outlined.png"}
    crowded["still_prompt"] = crowded["still_prompt"].replace(
        "beside a `prop-beige-pc`.",
        "beside a `prop-beige-pc` and a `stamp-block-outlined` reading '26,000' in marker.")
    spec, err, _ = _run(_doc(
        {"id": "C1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."}, crowded))
    assert spec is None, spec
    assert "5 seeds over the cap of 4" in err, err
    assert "figure count" in err, err
    assert "did not fit" not in err, err
    assert "lettering-marker-italic" not in err and "stamp-block-outlined" not in err, err


# --- G3: the boss ruling of 2026-08-05 — displacement as an ORDERED, multi-step drop ------------
# `fix-G2-report.md`'s seed-cap exercise: act 2's real shape is 2 named cast + place + crowd +
# derived §5 lettering + ONE more (an interaction template or a tagged prop) = 6 seeds. The
# single-step crowd-only displacement landed at 5 and refused, naming the LOCKED lettering
# exemplar as the misfit and advising "fewer cast" — a mechanism steering a casting decision.
# Displacement now walks crowd -> interaction template -> tagged prop, one drop at a time, until
# the slate fits or nothing legal is left to drop.

_BOARDROOM_PLATE = {"id": "B0", "place": "miniscribe-boardroom",
                    "still_prompt": "The MiniScribe boardroom, a long table under fluorescent light."}


def test_the_interaction_shape_resolves_by_two_ordered_drops():
    """G2's shape 2a: 2 cast + interaction template + place + crowd + derived lettering = 6, over
    the cap by 2 — one single-step displacement cannot clear it, two ordered ones can."""
    spec, err, _ = _run(_doc(dict(_BOARDROOM_PLATE), {
        "id": "B1", "place": "miniscribe-boardroom", "figures": {"crowd": True},
        "still_prompt": ("`ibm-suit`, `expr-deadpan`, and `terry-johnson`, `expr-delighted`, meet "
                         "in `handshake` across the boardroom table, a whiteboard behind them "
                         "reading '20 MILLION' in marker.")}))
    assert err is None, err
    b1 = _by_name(spec, "B1")
    stems = [Path(s).stem for s in b1["seed"]]
    assert len(stems) == 4, stems
    assert "crowd-exemplar" not in stems and "handshake" not in stems, stems
    assert "lettering-marker-italic" in stems, stems     # LOCKED — never a displacement target
    assert "_staging/B0.png" in b1["seed"], b1["seed"]   # the place plate — never displaced
    assert sorted(b1["assets_omitted"]) == ["crowd-exemplar", "handshake"], b1["assets_omitted"]
    assert b1["why"].count("CAP DISPLACEMENT") == 2, b1["why"]
    assert "crowd exemplar dropped" in b1["why"], b1["why"]
    assert "interaction template `handshake` dropped" in b1["why"], b1["why"]


def test_the_prop_shape_resolves_by_two_ordered_drops():
    """G2's shape 2b: 2 cast + place + crowd + derived lettering + a tagged prop = 6, over the cap
    by 2 — resolved by dropping the crowd exemplar, then the tagged prop."""
    spec, err, _ = _run(_doc(dict(_BOARDROOM_PLATE), {
        "id": "B2", "place": "miniscribe-boardroom", "figures": {"crowd": True},
        "still_prompt": ("`ibm-suit`, `expr-deadpan`, and `terry-johnson`, `expr-delighted`, "
                         "review a `prop-drive` on the boardroom table, a ledger behind them "
                         "reading 'QUOTA 26,000' in marker.")}))
    assert err is None, err
    b2 = _by_name(spec, "B2")
    stems = [Path(s).stem for s in b2["seed"]]
    assert len(stems) == 4, stems
    assert "crowd-exemplar" not in stems and "prop-drive" not in stems, stems
    assert "lettering-marker-italic" in stems, stems
    assert "_staging/B0.png" in b2["seed"], b2["seed"]
    assert sorted(b2["assets_omitted"]) == ["crowd-exemplar", "prop-drive"], b2["assets_omitted"]
    assert b2["why"].count("CAP DISPLACEMENT") == 2, b2["why"]
    assert "tagged prop `prop-drive` dropped" in b2["why"], b2["why"]


def test_never_droppable_seeds_refuse_naming_figure_count_not_a_locked_seed():
    """3 named cast (3 STEP-1s) + place + derived lettering = 5, over the cap by 1, with NOTHING
    displaceable (no crowd, no interaction, no prop). The slate only fits if the LOCKED lettering
    exemplar is dropped — which the law forbids — so the refusal must stand, and it must name the
    true bind (figure count vs the cap), never call lettering the misfit."""
    spec, err, _ = _run(_doc(dict(_BOARDROOM_PLATE), {
        "id": "B3", "place": "miniscribe-boardroom",
        "still_prompt": ("`ibm-suit`, `expr-deadpan`, `terry-johnson`, `expr-delighted`, and "
                         "`miniscribe-rep`, `expr-smug`, stand at the boardroom table beneath a "
                         "whiteboard reading 'QUOTA 26,000' in marker.")}))
    assert spec is None, spec
    assert "5 seeds over the cap of 4" in err, err
    assert "figure count" in err, err
    assert "3 seeded-figure seed(s)" in err, err
    assert "did not fit" not in err, err
    assert "lettering-marker-italic" not in err, err


# --- C-6: the staged-asset review record --------------------------------------------------------

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
        # B4: the refusal routes back through the BUILDER — there is no second STEP-1 minter. A
        # hand-typed `gen --seed a,b,c` would carry `reference` seed roles (the CLI can build no
        # other kind), which is the untruthful-role-prose root cause the roles exist to remove.
        assert _FIG in err and "through the BUILDER" in err, err
        assert "forge.py batch" in err and "--shots R1" in err, err
        assert "gen --kit" in err and "--batch" in err, err
        assert "--delta" not in err and "--seed " not in err, err
        # ... and it names the closing step, so the loop terminates instead of re-minting forever.
        assert "stamp_review.py --figures" in err, err


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


def test_expression_state_is_keyed_on_the_stage_chain_not_the_place():
    """R2-M7. A place hosts MANY stage chains. Keyed on the place, chain A's last expression
    persisted into chain B, so a chain-B delta re-introducing that character at the SAME expression
    read as unchanged and the gate never fired — the L75 mechanism, through the gate built to stop
    it. Chain B's own base never named an expression, so its delta AUTHORS one and owes pixels."""
    spec, err, _ = _run(_doc(
        {"id": "X1", "place": "office", "stage": "fear", "stage_role": "base",
         "still_prompt": f"{CAST} at the office desk."},
        {"id": "X2", "place": "office", "stage": "fear", "stage_role": "delta",
         "still_prompt": f"The same office with {CAST} while only the contract changes."},
        {"id": "X3", "place": "office", "stage": "firing", "stage_role": "base",
         "still_prompt": "`miniscribe-rep` alone at the office desk."},
        {"id": "X4", "place": "office", "stage": "firing", "stage_role": "delta",
         "still_prompt": "The same office, unchanged, except `miniscribe-rep` is now `expr-smug`."}))
    assert spec is None and "X4" in err, err
    assert "changes `miniscribe-rep` to `expr-smug`" in err, err


def test_a_chain_root_resets_its_own_expression_record():
    """A re-base re-establishes the beat from canonicals, so nothing the chain previously held is
    still on the frame: the delta AFTER a re-base re-authoring the same expression owes pixels."""
    spec, err, _ = _run(_doc(
        {"id": "R1", "place": "office", "stage": "beat", "stage_role": "base",
         "still_prompt": f"{CAST} at the office desk."},
        {"id": "R2", "place": "office", "stage": "beat", "stage_role": "base",
         "still_prompt": "`miniscribe-rep` alone at the office desk, re-based."},
        {"id": "R3", "place": "office", "stage": "beat", "stage_role": "delta",
         "still_prompt": "The same office, unchanged, except `miniscribe-rep` is now `expr-smug`."}))
    assert spec is None and "R3" in err and "expr-smug" in err, err


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


def test_the_scenes_manifest_inherits_the_provenance_the_batch_derived():
    """C-11 was derived and then dropped on the floor: nothing copied the counters onto
    `scenes/manifest.json`, so `_scene_provenance` read 0 hops every run and `lineage` could never
    climb past 1. `manifest --from-batch` copies them from the spec `batch` already wrote."""
    k = _kit()
    tmp = tempfile.mkdtemp()
    batch_spec = os.path.join(tmp, "spec.json")
    json.dump([{"name": "P1", "parent_depth": 0, "lineage": 0},
               {"name": "P2", "parent_depth": 1, "lineage": 1},
               {"name": "P3", "parent_depth": 2, "lineage": 2}],
              open(batch_spec, "w", encoding="utf-8"))
    entries = os.path.join(tmp, "entries.json")
    json.dump([{"shot_id": "P1", "file": "assets/scenes/P1.png"},
               {"shot_id": "P2", "file": "assets/scenes/P2.png"},
               {"shot_id": "P3", "file": "assets/scenes/P3.png", "parent_depth": 9, "lineage": 4}],
              open(entries, "w", encoding="utf-8"))
    out = os.path.join(tmp, "manifest.json")
    with contextlib.redirect_stdout(io.StringIO()):
        forge_module.cmd_manifest(k, "scenes", entries, out, None, "t", "", batch_spec)
    shots = json.load(open(out, encoding="utf-8"))["shots"]
    assert [(s["parent_depth"], s["lineage"]) for s in shots] == [(0, 0), (1, 1), (9, 4)], shots
    # an entry stating its own counters keeps them; a library manifest carries no provenance at all
    try:
        forge_module.cmd_manifest(k, "library", entries, out, None, "t", "", batch_spec)
    except SystemExit as e:
        assert "only scenes entries" in str(e), e
    else:
        assert False, "--from-batch on a library manifest must be refused"


def test_one_derived_frame_binding_serves_both_the_place_law_and_the_retry_path():
    """M12. `<id>-fix` / `<id>.v2` naming is ONE binding. Written twice, a second naming form
    taught to only the retry path leaves the same-place law resolving a repaired frame to
    `place=None`, which silently permits a cross-place seed."""
    assert forge_module._derived_from("L28-fix", "L28")
    assert forge_module._derived_from("L28.v2", "L28")
    assert not forge_module._derived_from("L28", "L28")
    assert not forge_module._derived_from("L280", "L28")
    src = inspect.getsource(forge_module)
    assert src.count('r"[-.].+"') == 1, "the binding regex must live in exactly one place"


# --- P3: every seeding asset class passes the SAME gate ------------------------------------------

_PLATE_PROMPT = "A warm records room with a bare central table."


def _unstamped(doc, scope=None, video=None):
    """A batch over an unreviewed library — what P3 refuses."""
    return _run(doc, scope, video=video, stamp=False)


def _stamp_except(k, video, *stems):
    """The reviewed library MINUS the named assets — the one-asset-missing probe."""
    stamp_kit(k, video)
    store_path = os.path.join(k.staging, "review.json")
    store = json.load(open(store_path, encoding="utf-8"))
    for stem in stems:
        store["figures"].pop(stem, None)
    json.dump(store, open(store_path, "w", encoding="utf-8"))


def test_a_place_plate_may_not_seed_a_scene_without_a_passing_review_record():
    """The L28 hole: a plate that seeded 17 shots was reviewed by an OPERATOR, not the pipeline."""
    v = _video("P1")
    doc = _doc({"id": "P1", "place": "records-room", "still_prompt": _PLATE_PROMPT},
               {"id": "P9", "place": "records-room", "place_anchor": "assets/scenes/P1.png",
                "still_prompt": "The same records room, the table now stacked with ledgers."})
    spec, err, _ = _unstamped(doc, ["P9"], video=v)
    assert spec is None, spec
    assert "PRE-GEN REVIEW GATE" in err and "place `P1`" in err, err
    assert "no review record" in err and "P9" in err, err
    # ... and the same slate passes the moment the plate carries a ruling
    spec, err, _ = _run(doc, ["P9"], video=v)
    assert err is None, err
    assert any(str(s).replace("\\", "/").endswith("assets/scenes/P1.png")
               for s in _by_name(spec, "P9")["seed"]), spec


def test_a_tagged_prop_or_environment_asset_is_refused_without_a_record():
    doc = _doc({"id": "T1", "place": "records-room",
                "still_prompt": "A records-room desk with `prop-drive` set square on the blotter."})
    spec, err, _ = _unstamped(doc)
    assert spec is None, spec
    assert "prop `prop-drive`" in err, err
    # the derived §5 style tile is an environment asset like any other — it is gated, not special
    assert "scene-style-tile" in err, err


def test_a_pose_or_expression_primitive_is_refused_without_a_record():
    """P3's largest newly gated class: 30 body primitives + 18 expressions seeded on no ruling."""
    spec, err, _ = _unstamped(_doc(
        {"id": "M1", "place": "records-room",
         "still_prompt": f"{CAST} alone at the records-room table."}))
    assert spec is None, spec
    assert "expression `expr-smug`" in err, err
    assert "pose `action-powerstance`" in err, err


def test_the_crowd_exemplar_is_refused_without_a_record():
    spec, err, _ = _unstamped(_doc(
        {"id": "C9", "place": "records-room", "figures": {"crowd": True},
         "still_prompt": "The records room seen from the door, clerks working along the back."}))
    assert spec is None, spec
    assert "crowd `crowd-exemplar`" in err, err


def test_a_named_cast_members_own_canonical_is_never_gated():
    """The G2 modification, in code: "P2 seeds don't need their own human gates." A canonical with
    NO record still seeds, while its co-seeded primitives are gated — so the exemption is a role
    exemption, not a hole in the store."""
    k, v = _kit(), tempfile.mkdtemp()
    _stamp_except(k, v, "miniscribe-rep")
    spec, err, _ = _run(_doc(
        {"id": "K1", "place": "records-room", "stage": "r", "stage_role": "base",
         "still_prompt": f"{CAST} alone at the records-room table."}), kit=k, video=v, stamp=False)
    assert err is None, err
    assert [i["name"] for i in spec] == [_FIG, "K1"], spec
    assert any(r["role"] == "canonical" and r["path"].endswith("miniscribe-rep.png")
               for r in _by_name(spec, _FIG)["seed_roles"]), spec


def test_the_review_store_constant_is_asset_scoped_and_the_figure_only_name_is_gone():
    assert forge_module.ASSET_REVIEW == "review.json"
    assert not hasattr(forge_module, "FIGURE_REVIEW")
    src = Path(forge_module.__file__).read_text(encoding="utf-8")
    assert "FIGURE_REVIEW" not in src


# --- P3: the in-batch card is gated exactly like a reused one -------------------------------------

def _minted_card_run(k, spec, stamped):
    """`gen` over a slate whose STEP-1 card was minted BY this batch, as staging really looks."""
    card = os.path.join(k.staging, _FIG + ".png")
    open(card, "wb").write(PNG + b"\0" * 2048)   # a real staged frame passes `validate_png`
    if stamped:
        stamp_all_pass(k.staging, card)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        forge_module.cmd_gen(k, spec, force=True, dry=True)
    return buf.getvalue()


def test_a_card_minted_in_this_batch_may_not_seed_a_scene_until_it_is_ruled_on():
    """The 6c2 card-before-scene split was an operator convention in a genlog, never a forge law.
    `cmd_batch` cannot ask this — the card has no bytes when the slate is built, and refusing there
    would block the only path that mints one — so the same predicate asks it in `cmd_gen`, where
    the card exists. The scene is HELD, never fatal: the cards must still land for the board."""
    k, v = _kit(), tempfile.mkdtemp()
    spec, err, _ = _run(_doc({"id": "K1", "place": "records-room", "stage": "r",
                              "stage_role": "base",
                              "still_prompt": f"{CAST} alone at the records-room table."}),
                        kit=k, video=v)
    assert err is None, err
    held = _minted_card_run(k, spec, stamped=False)
    assert "K1: skip (seed awaits review)" in held, held
    assert _FIG in held and "no review record" in held, held
    assert f"{_FIG}: DRY" in held, held           # the CARD itself still generates
    # after the ruling, the same spec generates the scene it was holding
    passed = _minted_card_run(k, spec, stamped=True)
    assert "K1: DRY" in passed, passed
    assert "awaits review" not in passed, passed


# --- P3 fix round 1: a PLATE is gated even when it wears the `parent` label ----------------------

def _plate_chain_doc():
    """A place whose first frame is a cast-free PLATE, and an in-chain delta that inherits it."""
    return _doc(
        {"id": "P1", "place": "records-room", "stage": "r", "stage_role": "base",
         "still_prompt": _PLATE_PROMPT},
        {"id": "P2", "place": "records-room", "stage": "r", "stage_role": "delta",
         "still_prompt": "The same records room, the table now stacked with ledgers."})


def test_a_delta_may_not_inherit_an_unreviewed_plate_through_the_parent_role():
    """C-1. `place_role` wears `parent` on a delta and `place` on a base — the SAME plate frame.
    Exempting the label exempted the frame, so a plate refused on one path rode free on the other.
    The exemption belongs to an ordinary scene-to-scene chain parent, never to the place's plate."""
    v = _video("P1")
    k = _kit()
    _stamp_except(k, v, "P1")           # the whole library reviewed EXCEPT the plate
    spec, err, _ = _run(_plate_chain_doc(), ["P2"], video=v, kit=k, stamp=False)
    assert spec is None, spec
    assert "PRE-GEN REVIEW GATE" in err and "P2" in err, err
    assert "place plate `P1`" in err and "no review record" in err, err
    # ... and the ordinary chain parent keeps its exemption: stamp the plate and the delta runs
    spec, err, _ = _run(_plate_chain_doc(), ["P2"], video=v)
    assert err is None, err
    assert any(r["role"] == "parent" for r in _by_name(spec, "P2")["seed_roles"]), spec


def test_a_plate_minted_in_this_batch_is_gated_before_its_delta_inherits_it():
    """C-1, the in-batch half: at batch time the plate has no bytes, so the gate meets it at gen
    time — where `parent` is exempt by label. The batch's own `plate: true` items say which
    frames those are, so the exemption cannot swallow them."""
    k, v = _kit(), tempfile.mkdtemp()
    spec, err, _ = _run(_plate_chain_doc(), kit=k, video=v)
    assert err is None, err
    assert _by_name(spec, "P1")["plate"] is True, spec
    plate = os.path.join(k.staging, "P1.png")
    open(plate, "wb").write(PNG + b"\0" * 2048)          # P1 mints, as it would mid-run
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        forge_module.cmd_gen(k, spec, force=True, dry=True)
    held = buf.getvalue()
    assert "P2: skip (seed awaits review)" in held, held
    assert "P1: DRY" in held, held                        # the plate itself still generates
    stamp_all_pass(k.staging, plate)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        forge_module.cmd_gen(k, spec, force=True, dry=True)
    assert "P2: DRY" in buf.getvalue(), buf.getvalue()


def test_held_scenes_are_counted_separately_from_frames_that_already_exist():
    """I-3. An orchestrator reading `N skipped` cannot tell "already done" from "waiting on a
    human". The two states need different actions, so they get different counts."""
    k, v = _kit(), tempfile.mkdtemp()
    spec, err, _ = _run(_plate_chain_doc(), kit=k, video=v)
    assert err is None, err
    open(os.path.join(k.staging, "P1.png"), "wb").write(PNG + b"\0" * 2048)
    scene_only = [i for i in spec if i["name"] == "P2"]
    old_nano = forge_module.nano
    forge_module.nano = lambda *a: (_ for _ in ()).throw(
        AssertionError("a held scene must never reach the provider"))
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            forge_module.cmd_gen(k, scene_only, force=True)
    finally:
        forge_module.nano = old_nano
    out = buf.getvalue()
    assert "0 generated, 0 failed, 0 skipped, 1 held for review" in out, out


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else ""      # optional substring filter, for TDD stages
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and only in name:
            fn()
    print("PASS test_forge_place_and_gates")

#!/usr/bin/env python3
"""The 2026-08-05 line-register reset: the §5 SCENE STYLE TILE seeding law (plain asserts).

Run: py -3 .claude/skills/image-generation/scripts/test_forge_style_tile.py

The law, in one line: a CAST-FREE plate/scene gen carries `refs/env/scene-style-tile.png` and a
figure-bearing gen does not, because a figure-bearing gen already draws the channel's line register
in its cast seeds while a plate carries it only as prose — and prose alone is how the drift
happened. Covered here:
  * the tile is DERIVED (never authored) onto every cast-free gen, plate or chained;
  * every figure signal — named cast, declared crowd, figures in the prose — withholds it, i.e.
    the tile seeds exactly the gens the §2c rig-hold block does NOT;
  * the text-bearing route is untouched: a cast-free lettered frame takes BOTH exemplars;
  * `plate` is derived from CONTENT seeds, so the tile never un-marks a place-minting frame;
  * seed-cap arithmetic: the tile counts toward `SEED_CAP` and is NEVER the seed displacement drops;
  * its seed-role prose grants register + palette only, never content, layout, or a place;
  * only the registered tile may wear the `style-anchor` role.
"""
import contextlib, io, json, os, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import forge as forge_module
from forge import (Kit, cmd_batch, seed_role_violations, seed_roles_text, seeding_law_violations,
                   PLATE_COMPOSITION, SEED_CAP, STYLE_TILE, STYLE_ANCHOR_ROLE)
from conftest import isolate_staging, stamp_kit

KIT_DIR = (Path(__file__).resolve().parents[4]
           / "channels" / "the-second-take" / "visual-kit")
ROOT = KIT_DIR.parents[2]
REFS = "channels/the-second-take/visual-kit/refs/"
TILE = REFS + "env/scene-style-tile.png"
LETTERING = REFS + "env/lettering-marker-italic.png"
CAST = "`miniscribe-rep`, `expr-smug`, `action-powerstance`,"
PNG = b"\x89PNG\r\n\x1a\n"
EXPECTED_PLATE_COMPOSITION = (
    "PLATE COMPOSITION — this overrides generic depth framing: eye-level, frontal or only mildly "
    "oblique; reserve one continuous standable-ground zone from foreground into midground, roughly "
    "25–35% of the frame and wide enough for two full-body rig silhouettes to share one plane "
    "without furniture overlap. Any foreground depth prop stays at one edge and never crosses that "
    "zone. Outside it, keep the set rich and working with its real furniture, stock, and machinery."
)

# The poyais-era TWO VOICES, verbatim from the era import SHA `ff36f63`:
#   HEAD — style-bible.md:90-93 (§2b STYLE-ONLY descriptor)
#   TAIL — videos/2026-07-04-poyais/shots.json `global_prompt_suffix` (643 chars)
# Restored 2026-08-05. These literals are the drift-lock: the doc that drifts fails the test.
ERA_STYLE_ONLY = (
    "Draw in the SAME art style as the reference image: a clean FLAT cel-shaded CARTOON look, an "
    "even MEDIUM-THICK dark warm brown-black (#241a12) outline on everything, flat colours laid "
    "down at FULL cel strength — every fill a real colour, and any grey or neutral clearly TINTED WARM, "
    "so the frame never drains to greyscale; a genuinely cold scene cools its LIGHT, never its neutrals — with "
    "gentle soft cel shading, rounded friendly shapes, no realistic detail. No text, no "
    "words, no labels.")
ERA_SUFFIX = (
    "Clean flat 2.5D vector cartoon in The Second Take house style: even medium-thick dark warm "
    "brown-black (#241a12) outline on everything, flat cel colours with gentle soft shading, "
    "rounded friendly shapes, no realistic detail; built-but-flat environment (flat gradient "
    "sky/ground + minimal geometry + one foreground depth prop); any in-world lettering "
    "hand-lettered in the marker style, short and legible; locked 2-3 colour warm-biased scene palette plus "
    "the single red accent #d7402b used only semantically (alarm / prohibition / ownership / the "
    "last punch element); no photorealism, no on-screen narrator or host face, no unrequested "
    "text, no logos; 16:9.")


def _kit():
    k = Kit(str(KIT_DIR), dry=True)
    k.root = str(ROOT)          # a worktree has no env marker for `Kit` to walk up to
    # Per-test staging, never the channel's own: `Kit.staging` is the LIVE P3 review store.
    return isolate_staging(k)


def _doc(*shots):
    for s in shots:
        s.setdefault("source", "ai-gen")
    return {"schema": "shots/1", "video_slug": "t",
            "long_form": {"aspect_ratio": "16:9", "shots": list(shots)}}


def _run(doc, scope=None, video=None):
    """(spec | None, SystemExit text | None) — cmd_batch, quietly."""
    v = video or tempfile.mkdtemp()
    shots, out = os.path.join(v, "shots.json"), os.path.join(v, "spec.json")
    json.dump(doc, open(shots, "w", encoding="utf-8"))
    k = _kit()
    stamp_kit(k, v)             # P3: the channel's standing library is a REVIEWED library
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            cmd_batch(k, shots, out, None, scope)
    except SystemExit as e:
        return None, str(e)
    return json.load(open(out, encoding="utf-8")), None


def _by_name(spec, name):
    return next(i for i in spec if i["name"] == name)


def _stems(item):
    return [Path(s).stem for s in item["seed"]]


# --- the derivation condition --------------------------------------------------------------------

def test_a_cast_free_plate_derives_the_style_tile_and_stays_a_plate():
    spec, err = _run(_doc(
        {"id": "T1", "place": "records-room",
         "still_prompt": "A warm records room with a bare central table."}))
    assert err is None, err
    t1 = _by_name(spec, "T1")
    assert t1["seed"] == [TILE], t1["seed"]
    # `plate` reads CONTENT seeds only — the tile carries no place, so T1 still mints its own.
    assert t1["plate"] is True, t1
    assert "STYLE TILE" in t1["why"] and "PLATE" in t1["why"], t1["why"]


def test_a_cast_free_scene_chained_onto_a_plate_still_derives_the_tile():
    """A chained cast-free frame is still cast-free, and inheriting a parent that drifted is
    exactly the case that needs the register re-anchored — so the place/parent seed is NOT a
    figure signal."""
    spec, err = _run(_doc(
        {"id": "T1", "place": "records-room", "stage": "r", "stage_role": "base",
         "still_prompt": "A warm records room with a bare central table."},
        {"id": "T2", "place": "records-room", "stage": "r", "stage_role": "delta",
         "still_prompt": "The same records room, unchanged, except the table now holds one ledger."}))
    assert err is None, err
    t2 = _by_name(spec, "T2")
    assert _stems(t2) == ["T1", STYLE_TILE], t2["seed"]
    assert t2["plate"] is False, t2       # it inherits a place, so it does not mint one


def test_a_named_cast_gen_never_takes_the_tile():
    """Its STEP-1 card already draws the rig's own outline weight, which §2b pegs the frame to."""
    spec, err = _run(_doc(
        {"id": "T1", "place": "office",
         "still_prompt": f"{CAST} standing at the office desk."}))
    assert err is None, err
    assert STYLE_TILE not in _stems(_by_name(spec, "T1")), _by_name(spec, "T1")["seed"]


def test_a_declared_crowd_gen_never_takes_the_tile():
    spec, err = _run(_doc(
        {"id": "T1", "place": "hall", "figures": {"crowd": True},
         "still_prompt": "A waiting crowd fills the hall, seen across the counter."}))
    assert err is None, err
    assert STYLE_TILE not in _stems(_by_name(spec, "T1")), _by_name(spec, "T1")["seed"]


def test_prose_figure_words_do_NOT_withhold_the_tile():
    """The condition is the RESOLVED cast recipe, never `depicts_figures`. That predicate's
    asymmetry runs the wrong way here: it fires broadly on purpose (a false positive costs the
    §2c block one inert paragraph), and over bricks-fresh it excluded 12 of 23 plates — including
    the run's own drift exemplar L63, whose prompt contains the phrase 'CAST-FREE'. Withholding
    the register anchor from the frame that needs it is the expensive failure; the tile on a
    frame that turns out to hold people is the cheap one."""
    for prompt in ("A first-floor office at midday, cast-free, a broad walnut desk by the window.",
                   "A banker's box sits alone on a plain trestle, its lid squared up.",
                   "Two office workers cross the hall past a row of filing cabinets."):
        spec, err = _run(_doc({"id": "T1", "place": "hall", "still_prompt": prompt}))
        assert err is None, err
        assert STYLE_TILE in _stems(_by_name(spec, "T1")), (prompt, _by_name(spec, "T1")["seed"])


def test_the_tile_and_the_lettering_exemplar_derive_independently():
    """Both routes are derived from the frame; a cast-free LETTERED plate takes both."""
    spec, err = _run(_doc(
        {"id": "T1", "place": "records-room",
         "still_prompt": "A warm records room, one signboard on the wall reading 'LEDGERS'."}))
    assert err is None, err
    assert _stems(_by_name(spec, "T1")) == ["lettering-marker-italic", STYLE_TILE], \
        _by_name(spec, "T1")["seed"]


def test_the_tile_is_not_added_twice_when_a_shot_tags_it_by_hand():
    spec, err = _run(_doc(
        {"id": "T1", "place": "records-room", "assets": {STYLE_TILE: TILE},
         "still_prompt": "A warm records room with a bare central table."}))
    assert err is None, err
    assert _stems(_by_name(spec, "T1")) == [STYLE_TILE], _by_name(spec, "T1")["seed"]


def test_omitting_the_tile_by_name_suppresses_the_derived_seed():
    """`assets_omitted` is the slate's deliberate-exclusion channel; the tile honours it like
    every other derived seed, so a human can still author a frame without it."""
    spec, err = _run(_doc(
        {"id": "T1", "place": "records-room", "assets_omitted": [STYLE_TILE],
         "still_prompt": "A warm records room with a bare central table."}))
    assert err is None, err
    t1 = _by_name(spec, "T1")
    assert t1["seed"] == [] and t1["plate"] is True, t1


def test_plate_composition_is_exact_once_on_cast_free_place_firsts_including_lettered_ones():
    """The composition law keys to the place-first shape, not `plate`: lettering is content-seeded
    but the lettered L114-shaped root still establishes the actor-ready place for later scenes."""
    assert PLATE_COMPOSITION == EXPECTED_PLATE_COMPOSITION
    spec, err = _run(_doc(
        {"id": "L114", "place": "brick-yard",
         "still_prompt": "A working brick yard with a sign reading 'BRICKS' over the gate."},
        {"id": "L115", "place": "brick-yard", "stage": "yard", "stage_role": "delta",
         "still_prompt": "The same working brick yard, unchanged, with a ledger on the gate table."},
        {"id": "N01", "still_prompt": "A standalone ledger on a bare table."}))
    assert err is None, err
    lettered = _by_name(spec, "L114")
    delta = _by_name(spec, "L115")
    no_place = _by_name(spec, "N01")
    assert lettered["plate"] is False and lettered["plate_composition"] is True, lettered
    assert not delta.get("plate_composition") and not no_place.get("plate_composition")
    cast_spec, _ = _run(_doc(
        {"id": "C01", "place": "cast-office",
         "still_prompt": f"{CAST} standing at the office desk."}))
    with tempfile.TemporaryDirectory() as anchored_video:
        anchor = Path(anchored_video) / "assets" / "scenes" / "A00.png"
        anchor.parent.mkdir(parents=True)
        anchor.write_bytes(PNG)
        anchored_spec, _ = _run(_doc(
            {"id": "A00", "place": "anchored-office", "source": "library",
             "still_prompt": "The approved anchored office."},
            {"id": "A01", "place": "anchored-office", "place_anchor": "assets/scenes/A00.png",
             "still_prompt": "A cast-free anchored office."}), video=anchored_video)
    # The clause is only for a cast-free, unanchored place-first request.
    assert not _by_name(cast_spec, "C01").get("plate_composition")
    assert not _by_name(anchored_spec, "A01").get("plate_composition")
    k = _kit()
    prompt = k.prompt_for("environment", lettered["delta"],
                          generated_policy=PLATE_COMPOSITION if lettered["plate_composition"] else "")
    assert prompt.count(PLATE_COMPOSITION) == 1, prompt
    assert prompt.index(PLATE_COMPOSITION) < prompt.index(lettered["delta"]), prompt


# --- seed-cap arithmetic -------------------------------------------------------------------------

def test_the_tile_counts_toward_the_cap_and_a_prop_is_dropped_before_it():
    """A cast-free frame tagging three props plus a lettered literal reaches 5 with the tile
    present. Displacement drops a PROP; the tile — like the place plate and the §5 lettering
    exemplar — is never the seed that makes room."""
    spec, err = _run(_doc(
        {"id": "T1", "place": "shop",
         "assets": {"prop-beige-pc": REFS + "env/prop-beige-pc.png",
                    "prop-drive": REFS + "env/prop-drive.png",
                    "stamp-block-outlined": REFS + "env/stamp-block-outlined.png"},
         "still_prompt": ("A shop counter holding a `prop-beige-pc`, a `prop-drive`, and a "
                          "`stamp-block-outlined` card reading 'PAID'.")}))
    assert err is None, err
    t1 = _by_name(spec, "T1")
    assert len(t1["seed"]) <= SEED_CAP, t1["seed"]
    assert STYLE_TILE in _stems(t1), t1["seed"]
    assert "lettering-marker-italic" in _stems(t1), t1["seed"]
    assert t1["assets_omitted"], t1        # something WAS displaced, and it was a prop
    assert all(o.startswith("prop-") for o in t1["assets_omitted"]), t1["assets_omitted"]


def test_the_over_cap_refusal_names_the_tile_among_the_locked_seeds():
    k = _kit()
    seeds = [REFS + "base/base.png", REFS + "macgregor/macgregor-base.png",
             "_staging/L01.png", LETTERING, TILE]
    req = {"name": "L02", "mode": "environment", "payload": "a room",
           "seed": seeds,
           "seed_roles": [{"path": s, "role": r, "character": None} for s, r in zip(
               seeds, ("canonical", "canonical", "place", "environment", STYLE_ANCHOR_ROLE))]}
    bad = " ".join(seeding_law_violations(k, req, seeds))
    assert "over the cap" in bad and "scene style tile" in bad, bad
    assert "did not fit" not in bad, bad


# --- role truth ----------------------------------------------------------------------------------

def test_the_tiles_role_prose_grants_register_only_and_denies_the_place():
    text = seed_roles_text([{"path": TILE, "role": STYLE_ANCHOR_ROLE,
                             "character": STYLE_TILE}])
    for required in ("SCENE STYLE TILE", "register sample ONLY", "LINE WEIGHT",
                     "outline colour (#241a12)", "FLAT-CEL RENDER", "PALETTE SATURATION and TEMPERATURE", "Take NOTHING else",
                     "NOT the place it depicts"):
        assert required in text, (required, text)
    # the generic `environment` prose is the exact opposite instruction and must never appear
    assert "preserve its authored place facts" not in text, text


def test_only_the_registered_tile_may_wear_the_style_anchor_role():
    k = _kit()
    ok = {"name": "L01", "mode": "environment", "payload": "a room", "seed": [TILE],
          "seed_roles": [{"path": TILE, "role": STYLE_ANCHOR_ROLE, "character": STYLE_TILE}]}
    ok["delta"] = forge_module.placement_delta(ok["payload"], ok["seed_roles"])
    assert seed_role_violations(k, ok) == [], seed_role_violations(k, ok)
    smuggled = REFS + "env/prop-beige-pc.png"
    bad = dict(ok, seed=[smuggled],
               seed_roles=[{"path": smuggled, "role": STYLE_ANCHOR_ROLE, "character": STYLE_TILE}])
    bad["delta"] = forge_module.placement_delta(bad["payload"], bad["seed_roles"])
    assert any("is not truthful" in v for v in seed_role_violations(k, bad)), \
        seed_role_violations(k, bad)


# --- the doctrine the tile enforces --------------------------------------------------------------

def test_the_look_is_stated_in_exactly_two_voices_at_the_two_ends():
    """The 2026-08-05 era restoration changed this drift-lock's subject, not its job.

    Forge no longer carries a prose copy of the style (`HARDENED_SCENE_STYLE` is deleted), so there
    is no second copy to keep in sync with §2b. What the lock now guards is that the poyais-era TWO
    VOICES both still exist and still read verbatim: the bible's §2b blockquote (the HEAD of every
    prompt) and the channel's `global_prompt_suffix` (its TAIL, authored in `visual-grammar.md` and
    copied into each video's shots.json). A THIRD voice anywhere is the drift mechanism the
    2026-08-04 audit named first."""
    bible = (KIT_DIR / "style-bible.md").read_text(encoding="utf-8")
    style_only = forge_module.blockquote_after(bible, "STYLE-ONLY descriptor")
    assert style_only == ERA_STYLE_ONLY, style_only
    grammar = (KIT_DIR / "visual-grammar.md").read_text(encoding="utf-8")
    assert "> " + ERA_SUFFIX in grammar, "the TAIL style voice is not the era suffix, verbatim"
    assert not hasattr(forge_module, "HARDENED_SCENE_STYLE"), \
        "a third style voice reappeared in forge.py"


def test_the_tail_voice_reaches_every_scene_request_and_no_step1_card():
    """`cmd_batch` copies the file's `global_prompt_suffix` onto every scene request, and
    `prompt_for` appends it after the authored payload. A STEP-1 identity card is 2:3 on a plain
    ground and takes none of it (the suffix's `16:9` + built-but-flat ENVIRONMENT recipe would
    fight the card)."""
    doc = _doc({"id": "T1", "place": "office",
                "still_prompt": f"{CAST} standing at the office desk."})
    doc["global_prompt_suffix"] = ERA_SUFFIX
    spec, err = _run(doc)
    assert err is None, err
    scene = _by_name(spec, "T1")
    step1 = next(r for r in spec if r["name"].startswith("fig-"))
    assert scene["prompt_suffix"] == ERA_SUFFIX, scene.get("prompt_suffix")
    assert not step1.get("prompt_suffix"), step1.get("prompt_suffix")
    k = _kit()
    text = k.prompt_for("environment", scene["delta"], suffix=scene["prompt_suffix"])
    assert text.endswith(ERA_SUFFIX), text[-200:]
    assert text.startswith(ERA_STYLE_ONLY), text[:200]
    assert k.prompt_for("environment", step1["delta"],
                        suffix=step1.get("prompt_suffix") or "").endswith(step1["delta"])


def _tests():
    return [(n, o) for n, o in sorted(globals().items())
            if n.startswith("test_") and callable(o)]


if __name__ == "__main__":
    failed = 0
    for name, fn in _tests():
        try:
            fn()
            print(f"  ok   {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {name}: {e}")
    print(f"{len(_tests()) - failed}/{len(_tests())} passed")
    sys.exit(1 if failed else 0)

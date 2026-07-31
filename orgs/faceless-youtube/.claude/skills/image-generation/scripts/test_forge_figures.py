#!/usr/bin/env python3
"""Plain-assert test for the `figures` expansion + prompt assembly (repo has no pytest).

Runs on the REAL `the-second-take` style-bible so the §2d/§2e blockquotes under test are the ones
production reads. It touches only pure functions — no Kit, no .env, no key, no network, no file
written — so it is safe to run at any time and proves the expansion without a single gen token.

Run:  py -3 .claude/skills/image-generation/scripts/test_forge_figures.py
      py -3 .claude/skills/image-generation/scripts/test_forge_figures.py --show   (print the prompts)
"""
import base64
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import forge
from forge import (IMAGE_SIZES, IMAGE_SIZE_DEFAULT, Kit, assemble_prompt, blockquote_after,
                   cmd_gen, figures_expansion, should_hold)

BIBLE = (Path(__file__).resolve().parents[4]
         / "channels" / "the-second-take" / "visual-kit" / "style-bible.md")
KIT_ROOT = BIBLE.parent
_MD = BIBLE.read_text(encoding="utf-8")
DESC_STYLE = blockquote_after(_MD, "STYLE-ONLY descriptor")
DESC_RIGHOLD = blockquote_after(_MD, "RIG-HOLD descriptor")
CROWD_RIG = blockquote_after(_MD, "CROWD-RIG clause")
BASE_RIG = blockquote_after(_MD, "BASE-RIG clause")

# --- sample shots (hand-built; the shapes VPW emits) -------------------------------------------
# (a) a base shot staging two anonymous foreground figures over a crowd
SHOT_BASE = {
    "shot_id": "L07", "stage": "dock-1900", "stage_role": "base",
    "still_prompt": ("Wide shot of a brick dock at dawn: the worker at the dock edge hauls a crate "
                     "while the foreman with the clipboard counts it off, a crowd of dockhands "
                     "massed behind them under a rust-red crane."),
    "figures": {"anon_foreground": ["the worker at the dock edge",
                                    "the foreman with the clipboard"], "crowd": True},
}
# (b) the delta on the SAME stage: one element changes, the figures are HELD
SHOT_DELTA = {
    "shot_id": "L08", "stage": "dock-1900", "stage_role": "delta",
    "still_prompt": ("The same dock at dawn, unchanged, except the crate is now open on the "
                     "cobbles — only this changes."),
    "figures": {"anon_foreground": ["the worker at the dock edge",
                                    "the foreman with the clipboard"], "crowd": True},
}
# (c) a legacy shot: no `figures` key at all -> must assemble exactly as it did before the field
SHOT_LEGACY = {
    "shot_id": "L12", "stage_role": "base",
    "still_prompt": ("A parchment ledger page on a desk, the column of figures ruled in red ink, "
                     "one brass weight holding the corner down."),
}


def _assemble(shot, hold=True):
    return assemble_prompt(
        DESC_STYLE, shot["still_prompt"],
        figures_expansion(shot.get("figures"), BASE_RIG, CROWD_RIG, shot.get("stage_role")),
        DESC_RIGHOLD if hold else "")


# --- the bible still exposes the clauses forge expands ------------------------------------------
def test_bible_blockquotes_are_readable():
    assert "FULL base family rig" in BASE_RIG, BASE_RIG[:120]
    assert "CROWD RIG" in CROWD_RIG, CROWD_RIG[:120]
    assert DESC_RIGHOLD and DESC_STYLE


# --- (a) base shot ------------------------------------------------------------------------------
def test_base_shot_names_figures_verbatim_and_binds_the_clause():
    fig = figures_expansion(SHOT_BASE["figures"], BASE_RIG, CROWD_RIG, "base")
    # opens by naming every entry VERBATIM, pluralized
    assert fig.startswith("The following figures — the worker at the dock edge; "
                          "the foreman with the clipboard — are anonymous, non-recurring people "
                          "drawn on the FULL base family rig"), fig[:200]
    # keeps §2e's rig tail verbatim (the invariants are the bible's, not retyped here)
    assert "NO nose, NO ears" in fig and "THREE fingers plus ONE thumb" in fig
    # closes with the named-cast protection binding — present, and stated exactly ONCE whether it
    # comes from the bible's own §2e tail or from forge's append (a doubled binding is prompt bloat)
    low = fig.lower()
    assert "other figure in" in low and "canonical descri" in low, fig
    assert low.count("other figure in") == 1, fig
    # crowd: true -> the §2d clause, verbatim, as its own block
    assert CROWD_RIG in fig
    assert fig.index("FULL base family rig") < fig.index(CROWD_RIG), "crowd clause must come after §2e"


def test_single_anon_figure_is_singular():
    fig = figures_expansion({"anon_foreground": ["the clerk at the wicket"]}, BASE_RIG, CROWD_RIG)
    assert fig.startswith("The following figure — the clerk at the wicket — is an anonymous, "
                          "non-recurring person drawn on the FULL base family rig"), fig[:160]
    assert CROWD_RIG not in fig, "crowd omitted -> no §2d clause"


def test_binding_is_appended_when_the_template_lacks_it():
    """The append is idempotent, not absent: a §2e template with no binding of its own gets one."""
    bare = ("This figure is drawn on the FULL base family rig — NO nose, NO ears; "
            "hold ONLY this form.")
    fig = figures_expansion({"anon_foreground": ["the clerk"]}, bare, CROWD_RIG)
    low = fig.lower()
    assert "other figure in" in low and "canonical descri" in low, fig
    assert low.count("other figure in") == 1, fig


def test_crowd_only_shot_gets_only_the_crowd_clause():
    fig = figures_expansion({"crowd": True}, BASE_RIG, CROWD_RIG, "base")
    assert fig == CROWD_RIG, fig[:160]


# --- (b) delta shot ----------------------------------------------------------------------------
def test_delta_shot_holds_the_figures_and_never_invites_a_new_outfit():
    fig = figures_expansion(SHOT_DELTA["figures"], BASE_RIG, CROWD_RIG, "delta")
    assert fig.startswith("The anonymous figures — the worker at the dock edge; the foreman with "
                          "the clipboard — are unchanged, exactly as established"), fig[:200]
    # THE defect this wording exists to kill: §2e's first-establishment sentence on a held figure
    assert "era-appropriate outfit" not in fig, fig
    assert "non-recurring" not in fig, fig
    assert "do not redesign" in fig
    # the delta wording carries the binding itself (it never borrows the §2e template)
    assert fig.lower().count("other figure in") == 1, fig
    assert CROWD_RIG in fig, "a delta still states the crowd rig (a hold, not an invention)"


def test_delta_singular_agrees():
    fig = figures_expansion({"anon_foreground": ["the lone clerk"]}, BASE_RIG, CROWD_RIG, "delta")
    assert fig.startswith("The anonymous figure — the lone clerk — is unchanged, "
                          "exactly as established"), fig[:160]


# --- (c) legacy shot: byte-identical to pre-`figures` assembly ----------------------------------
def test_shot_without_figures_assembles_byte_identically():
    """REGRESSION GUARD. The pre-`figures` assembly was `descriptor + "\\n\\n" + delta` plus
    `"\\n\\n" + righold` when held. A shot with no `figures` key must produce those exact bytes —
    the field is additive or it silently re-prompts every legacy shot in the library."""
    legacy_before = DESC_STYLE + "\n\n" + SHOT_LEGACY["still_prompt"] + "\n\n" + DESC_RIGHOLD
    assert _assemble(SHOT_LEGACY, hold=True) == legacy_before
    no_hold_before = DESC_STYLE + "\n\n" + SHOT_LEGACY["still_prompt"]
    assert _assemble(SHOT_LEGACY, hold=False) == no_hold_before
    # an empty/false declaration is the same as no declaration
    for empty in (None, {}, {"anon_foreground": []}, {"crowd": False},
                  {"anon_foreground": [], "crowd": False}):
        assert figures_expansion(empty, BASE_RIG, CROWD_RIG) == "", repr(empty)


# --- assembly order + the rig-hold signal ------------------------------------------------------
def test_assembly_order_is_descriptor_delta_figures_righold():
    text = _assemble(SHOT_BASE)
    i_desc = text.index(DESC_STYLE)
    i_delta = text.index("Wide shot of a brick dock")
    i_fig = text.index("The following figures —")
    i_hold = text.index(DESC_RIGHOLD)
    assert i_desc < i_delta < i_fig < i_hold, (i_desc, i_delta, i_fig, i_hold)
    # §2c's crowd exemption must READ a §2d clause that the prompt already stated
    assert text.index(CROWD_RIG) < i_hold


def test_declared_figures_force_the_rig_hold():
    env = ["channels/x/visual-kit/refs/env/dock.png"]
    # a prompt whose figure words all hide behind proper nouns still holds, because the shot DECLARED
    assert should_hold("environment", env, "Dawn over the wharf.", SHOT_BASE["figures"]) is True
    assert should_hold("environment", env, "Dawn over the wharf.") is False   # unchanged without it
    assert should_hold("identity", env, "Dawn over the wharf.", SHOT_BASE["figures"]) is False


# --- malformed declarations hard-error rather than dropping the clause ---------------------------
def test_malformed_figures_hard_error():
    for bad in (["the clerk"], {"anon_fg": ["x"]}, {"anon_foreground": "the clerk"},
                {"crowd": "yes"}):
        try:
            figures_expansion(bad, BASE_RIG, CROWD_RIG)
        except SystemExit:
            pass
        else:
            assert False, f"malformed figures accepted: {bad!r}"


def test_resolution_tier_default_clears_the_delivery_frame():
    """1K (the engine default when `imageSize` is unset) is below the 1920x1080 delivery frame."""
    assert IMAGE_SIZES == ("1K", "2K", "4K")
    assert IMAGE_SIZE_DEFAULT in ("2K", "4K") and IMAGE_SIZE_DEFAULT != "1K"


# --------------------------------------------------------------------------- #
# FIX 10 (audit follow-up) — dry-run evidence: Kit(dry=True) touches neither key nor network,
# cmd_gen's --dry-run writes nothing, and the real request body carries the resolved imageSize.
# --------------------------------------------------------------------------- #
def test_kit_dry_true_loads_no_key_and_builds_no_url():
    k = Kit(str(KIT_ROOT), dry=True)
    assert k.key == "", k.key
    assert k.url is None, k.url
    assert k.ctx is None, k.ctx


def test_cmd_gen_dry_run_writes_zero_files_into_staging():
    """MEDIUM-9 (audit follow-up): git does not track empty directories and there is no
    `.gitkeep`, so `_staging/` may not exist yet on a fresh clone — `cmd_gen` itself is happy to
    create it (`os.makedirs(..., exist_ok=True)`), but this test used to list the directory
    BEFORE calling cmd_gen, raising FileNotFoundError before the assertion ever ran, on any clean
    checkout, not just this one. Create it (matching what cmd_gen does) before the `before` snapshot."""
    k = Kit(str(KIT_ROOT), dry=True)
    os.makedirs(k.staging, exist_ok=True)
    name = "zzz-audit-fix10-dry-run-guard"
    out_path = os.path.join(k.staging, name + ".png")
    if os.path.exists(out_path):
        os.remove(out_path)
    before = set(os.listdir(k.staging))
    cmd_gen(k, [{"name": name, "mode": "identity", "character": "base",
                "delta": "a plain test render, unchanged rig"}], True, dry=True)
    after = set(os.listdir(k.staging))
    assert after == before, after - before
    assert not os.path.exists(out_path)


def test_nano_request_body_carries_the_resolved_image_size():
    """`nano()` assembles the ONE request body the engine reads; this asserts `imageConfig.imageSize`
    in that JSON body actually IS the tier the caller resolved, for every tier (not just the default)."""
    for size in IMAGE_SIZES:
        captured = {}

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                blob = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 2000).decode()
                body = {"candidates": [{"content": {"parts": [{"inlineData": {"data": blob}}]}}]}
                return json.dumps(body).encode()

        def _fake_urlopen(req, context=None, timeout=None):
            captured["payload"] = json.loads(req.data.decode())
            return _FakeResp()

        orig = forge.urllib.request.urlopen
        forge.urllib.request.urlopen = _fake_urlopen
        try:
            forge.nano("https://example.invalid/", [{"text": "hi"}], "16:9", None, size)
        finally:
            forge.urllib.request.urlopen = orig
        assert captured["payload"]["generationConfig"]["imageConfig"]["imageSize"] == size, captured


def _show():
    for label, shot, hold in (("(a) BASE shot — 2 anon_foreground figures + crowd:true", SHOT_BASE, True),
                              ("(b) DELTA shot — same stage, figures HELD", SHOT_DELTA, True),
                              ("(c) LEGACY shot — no `figures` field", SHOT_LEGACY, True)):
        print("=" * 100)
        print(label, f"[{shot['shot_id']}]")
        print("=" * 100)
        print(_assemble(shot, hold))
        print()


def _run_all():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--show" in sys.argv:
        _show()
        sys.exit(0)
    sys.exit(_run_all())

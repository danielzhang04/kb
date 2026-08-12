#!/usr/bin/env python3
"""TDD regressions for surgical retry authority and provider prompt zones.

These tests deliberately describe the accepted retry contract.  They use the retry
builder's private seam where that is the only place an overlay is validated, and
the public prompt assembler where provider-text precedence is established.

Run: py -3 .claude/skills/image-generation/scripts/test_forge_surgical_retry_and_zones.py
"""
import contextlib
import io
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import forge


CANONICAL = (
    "Wide factory gate at dawn. The blue instruction card stays left of the gate. "
    "Three small workers carry crates beneath the red crane."
)


def _scene_retry(entry, item=None, source=None, video=None):
    """Exercise the overlay validator without batching or a provider call."""
    root = video or tempfile.mkdtemp()
    staging = os.path.join(root, "_staging")
    os.makedirs(staging, exist_ok=True)
    kit = tempfile.mkdtemp()
    k = SimpleNamespace(root=root, kit=kit, staging=staging)
    item = item or {"name": "T01", "delta": CANONICAL, "seed": ["canonical-seed.png"]}
    source = source or {"id": "T01"}
    return forge._retry_scene(item, source, entry, k, root, "retry entry 1")


def _must_reject(entry, item=None, video=None):
    try:
        _scene_retry(entry, item, video=video)
    except SystemExit:
        return
    assert False, f"retry was accepted without a surgical authority: {entry!r}"


def test_scene_content_retry_without_exact_replace_or_mechanism_swap_hard_fails():
    """A prose append is prompt accretion, not an authorized content retry."""
    _must_reject({
        "kind": "scene", "shot": "T01", "name": "T01-content-retry",
        "defect": "content",
        "instruction": "Make the instruction card more legible.",
    })


def test_exact_replace_changes_one_causal_span_and_preserves_all_other_bytes():
    old = "The blue instruction card stays left of the gate."
    new = "The blue instruction card reads BRICKS — B, R, I, C, K, S — left of the gate."
    out = _scene_retry({
        "kind": "scene", "shot": "T01", "name": "T01-card-retry",
        "defect": "content",
        "replace": {"from": old, "to": new},
    })
    expected = CANONICAL.replace(old, new)
    assert out["payload"] == expected, out["payload"]
    assert out["delta"].endswith(expected), out["delta"]
    assert out["payload"].count(new) == 1
    assert out["payload"].replace(new, old) == CANONICAL


def test_additive_instruction_that_restates_or_opposes_a_canonical_clause_rejects():
    for additive in (
        "The blue instruction card stays left of the gate.",
        "Move the blue instruction card to the right of the gate.",
    ):
        _must_reject({
            "kind": "scene", "shot": "T01", "name": "T01-additive-retry",
            "defect": "content",
            "instruction": additive,
        })


def test_seed_mechanism_reorder_is_permitted_without_content_append():
    with tempfile.TemporaryDirectory() as video:
        asset = Path(video, "assets", "approved-figure-frame.png")
        asset.parent.mkdir()
        asset.write_bytes(b"not a provider call")
        item = {"name": "T01", "delta": CANONICAL,
                "seed": ["canonical-seed.png", "assets/approved-figure-frame.png"]}
        out = _scene_retry({
            "kind": "scene", "shot": "T01", "name": "T01-mechanism-retry",
            "defect": "mechanism",
            "prepend_seeds": ["assets/approved-figure-frame.png"],
        }, item=item, video=video)
    assert out["payload"] == CANONICAL
    assert out["delta"].endswith(CANONICAL)
    assert out["seed"] == ["assets/approved-figure-frame.png", "canonical-seed.png"]
    assert out["retry_authority"]["kind"] == "seed/mechanism"


def test_pure_unrelated_seed_addition_is_not_a_mechanism_replacement():
    with tempfile.TemporaryDirectory() as video:
        asset = Path(video, "assets", "unrelated.png")
        asset.parent.mkdir()
        asset.write_bytes(b"not a provider call")
        _must_reject({
            "kind": "scene", "shot": "T01", "name": "T01-not-a-swap",
            "defect": "mechanism", "prepend_seeds": ["assets/unrelated.png"],
        }, video=video)


def test_repeating_a_seed_without_changing_final_order_is_not_a_reorder():
    with tempfile.TemporaryDirectory() as video:
        asset = Path(video, "assets", "already-first.png")
        asset.parent.mkdir()
        asset.write_bytes(b"not a provider call")
        item = {"name": "T01", "delta": CANONICAL,
                "seed": ["assets/already-first.png", "canonical-seed.png"]}
        _must_reject({
            "kind": "scene", "shot": "T01", "name": "T01-noop-retry",
            "defect": "mechanism", "prepend_seeds": ["assets/already-first.png"],
        }, item=item, video=video)


def test_policy_zones_precede_authored_payload_and_only_the_style_suffix_follows_it():
    """Ordering law, restored to the era shape 2026-08-05: policy zones, then the authored payload,
    then the file's fixed `global_prompt_suffix` and NOTHING else. The payload is still the last
    AUTHORED text — the only thing after it is channel data every request carries identically, so a
    shot's own closing clause keeps its weight."""
    descriptor = "DESCRIPTOR ZONE"
    crowd = "CROWD POLICY ZONE"
    rig = "RIG POLICY ZONE"
    replacement = "AUTHOR-PAYLOAD: the literal BRICKS clause."
    suffix = "FIXED CHANNEL STYLE SUFFIX"
    text = forge.assemble_prompt(descriptor, replacement, crowd, rig)
    assert text == "\n\n".join((descriptor, crowd, rig, replacement))
    assert text.endswith(replacement)
    tailed = forge.assemble_prompt(descriptor, replacement, crowd, rig, suffix)
    assert tailed == "\n\n".join((descriptor, crowd, rig, replacement, suffix))
    assert tailed.endswith(suffix) and tailed.index(replacement) < tailed.index(suffix)


def test_gen_dry_run_prints_the_one_span_retry_authority():
    with tempfile.TemporaryDirectory() as root:
        staging = os.path.join(root, "_staging")
        k = SimpleNamespace(root=root, staging=staging, reg={},
                            prompt_for=lambda mode, delta, **kwargs: delta)
        request = {
            "name": "T01-content-retry", "mode": "environment", "plate": True,
            "seed": [], "seed_roles": [], "payload": CANONICAL, "delta": CANONICAL,
            "retry_authority": {"kind": "replace", "changed_spans": 1,
                                "from": "old", "to": "new"},
        }
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            forge.cmd_gen(k, [request], force=True, dry=True)
    rendered = output.getvalue()
    assert "retry authority:" in rendered and '"changed_spans": 1' in rendered, rendered


def test_step1_retry_remains_the_permitted_expression_remint_route():
    reg = {
        "characters": {"hq-banker": {"base": "refs/hq-banker.png"}},
        "assets": [
            {"name": "expr-fear", "kind": "expression", "file": "refs/expr-fear.png"},
            {"name": "action-point", "kind": "action", "file": "refs/action-point.png"},
        ],
    }
    source = {
        "still_prompt": "`hq-banker`, `expr-fear`, `action-point`, at the factory gate.",
        "assets": {},
    }
    out = forge._retry_step1(
        {"kind": "step1", "shot": "T01", "character": "hq-banker",
         "name": "fig-hq-banker-remint", "defect": "expression"},
        source, SimpleNamespace(reg=reg), "retry entry 1")
    assert out["name"] == "fig-hq-banker-remint"
    assert out["mode"] == "environment" and out["aspect"] == "2:3"
    assert out["seed"] == ["refs/hq-banker.png", "refs/expr-fear.png", "refs/action-point.png"]
    assert "`expr-fear` expression reference" in out["delta"]
    # P8: a re-mint inherits the SAME card payload the batch minted — same deriver, same prose, so
    # the repaired card still holds the beat's own act instead of reverting to a neutral stance.
    clause = forge.beat_clause(source["still_prompt"], "hq-banker")
    assert out["payload"] == forge.figure_card_payload("action-point", clause), out["payload"]
    assert "bodily ACT" in out["payload"], out["payload"]
    # the scene's setting reaches the card ONLY inside the quoted clause, under its own fence —
    # never as an instruction to draw it (pre-P8 this asserted "no setting text at all")
    assert "factory gate" in out["payload"], out["payload"]
    assert "none of its setting, props, lettering or other people" in out["payload"], out["payload"]


if __name__ == "__main__":
    failures = []
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except BaseException as error:  # SystemExit is a useful red-TDD failure too.
                failures.append((name, error))
                print(f"FAIL {name}: {type(error).__name__}: {error}")
    print(f"{9 - len(failures)}/9 passed")
    sys.exit(bool(failures))

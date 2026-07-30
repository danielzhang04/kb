#!/usr/bin/env python3
"""Plain-assert tests for `cmd_gen`'s pre-flight HARD guards (repo has no pytest).

Covers three guards that abort the WHOLE batch loudly rather than degrading silently:
  1. an environment/style gen with ZERO seeds (no stock-clipart fallback; identity/new_character
     still auto-seed)
  2. the seed-payload size guard (audit FIX 2) — sum every inline seed's base64 size + the
     prompt, hard-error before the API call if it would exceed the safety margin under Google's
     20MB request cap, rather than silently downscaling
  3. the `--image-size` CEILING (audit FIX 4) — a per-item `image_size` above the batch ceiling
     hard-errors naming the item, and a passing gen's report line names its resolved size

Run: py -3 .claude/skills/image-generation/scripts/test_forge_seed_requirement.py
"""
import io
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import forge
from forge import cmd_gen


def _stub_kit(staging=None, root=None):
    # cmd_gen only touches a handful of Kit attributes on the paths under test here, so a
    # lightweight stub reaches every guard without a real Kit / bible / network. `prompt_for` is
    # replaced with a trivial stand-in — its own assembly is covered by test_forge_figures.py.
    d = staging or tempfile.mkdtemp()
    return SimpleNamespace(
        staging=d, root=root or d,
        resolve_seed=lambda s: s,
        prompt_for=lambda mode, delta, hold=False, figures=None, stage_role=None: "PROMPT " + (delta or ""),
    )


def _seed_file(tmpdir, name, n_bytes):
    p = os.path.join(tmpdir, name)
    with open(p, "wb") as f:
        f.write(b"\0" * n_bytes)
    return p


def test_environment_or_style_without_seed_hard_errors():
    for mode in ("environment", "style"):
        try:
            cmd_gen(_stub_kit(), [{"name": "plate", "mode": mode, "delta": "a swamp"}], True)
        except SystemExit as e:
            assert "style-anchor seed" in str(e), str(e)
        else:
            assert False, f"{mode} gen with no seed should have hard-errored"


# --------------------------------------------------------------------------- #
# FIX 2 — seed-payload size guard
# --------------------------------------------------------------------------- #
def test_oversized_seed_payload_hard_errors_listing_each_seed_and_the_total():
    tmp = tempfile.mkdtemp()
    # two ~10MB seeds -> base64-encoded that's already ~26.7MB, over the 19MB safety margin
    big1 = _seed_file(tmp, "big1.png", 10 * 1024 * 1024)
    big2 = _seed_file(tmp, "big2.png", 10 * 1024 * 1024)
    k = _stub_kit(staging=tmp)
    req = {"name": "heavy", "mode": "environment", "delta": "a vast hall", "seed": [big1, big2]}
    try:
        cmd_gen(k, [req], True)
    except SystemExit as e:
        msg = str(e)
        assert "heavy" in msg, msg
        assert "big1.png" in msg and "big2.png" in msg, msg
        assert "bytes" in msg, msg
    else:
        assert False, "oversized seed payload should have hard-errored"
    # do NOT auto-downscale: no file should have been written to staging
    assert not os.path.exists(os.path.join(tmp, "heavy.png"))


def test_small_seed_payload_is_not_flagged_by_the_size_guard():
    tmp = tempfile.mkdtemp()
    small = _seed_file(tmp, "small.png", 2048)
    k = _stub_kit(staging=tmp)
    req = {"name": "light", "mode": "environment", "delta": "a courtyard", "seed": [small]}
    # dry-run: reaches past the payload guard (small seed) and prints instead of erroring
    out = io.StringIO()
    with redirect_stdout(out):
        cmd_gen(k, [req], True, dry=True)
    assert "DRY" in out.getvalue()


# --------------------------------------------------------------------------- #
# FIX 4 — `--image-size` is a CEILING, and the success line names the resolved size
# --------------------------------------------------------------------------- #
def test_item_image_size_above_the_ceiling_hard_errors_naming_the_item():
    tmp = tempfile.mkdtemp()
    seed = _seed_file(tmp, "s.png", 1024)
    k = _stub_kit(staging=tmp)
    req = {"name": "toobig", "mode": "environment", "delta": "d", "seed": [seed], "image_size": "4K"}
    try:
        cmd_gen(k, [req], True, image_size="1K", dry=True)
    except SystemExit as e:
        assert "toobig" in str(e), str(e)
        assert "4K" in str(e) and "1K" in str(e), str(e)
    else:
        assert False, "an item image_size above the batch ceiling should have hard-errored"


def test_item_image_size_at_or_below_the_ceiling_passes():
    tmp = tempfile.mkdtemp()
    seed = _seed_file(tmp, "s.png", 1024)
    k = _stub_kit(staging=tmp)
    for item_size in ("1K", "2K"):
        req = {"name": "ok", "mode": "environment", "delta": "d", "seed": [seed], "image_size": item_size}
        out = io.StringIO()
        with redirect_stdout(out):
            cmd_gen(k, [req], True, image_size="2K", dry=True)  # no raise
        assert "DRY" in out.getvalue()


def test_success_log_line_prints_the_resolved_size():
    tmp = tempfile.mkdtemp()
    seed = _seed_file(tmp, "s.png", 1024)
    k = _stub_kit(staging=tmp)
    k.url, k.ctx = "https://example.invalid/", None
    req = {"name": "shot", "mode": "environment", "delta": "d", "seed": [seed], "image_size": "2K"}
    png_bytes = forge.PNG_MAGIC + b"\0" * 2000
    orig_nano, orig_to_png, orig_validate = forge.nano, forge.to_png_bytes, forge.validate_png
    forge.nano = lambda *a, **kw: b"stand-in engine bytes"
    forge.to_png_bytes = lambda data: png_bytes
    forge.validate_png = lambda data: None
    try:
        out = io.StringIO()
        with redirect_stdout(out):
            cmd_gen(k, [req], True, image_size="2K", dry=False)
        printed = out.getvalue()
        assert "OK size=2K" in printed, printed
    finally:
        forge.nano, forge.to_png_bytes, forge.validate_png = orig_nano, orig_to_png, orig_validate


if __name__ == "__main__":
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
    sys.exit(1 if failed else 0)

#!/usr/bin/env python3
"""Plain-assert tests for route-mode `expectedArtifactPath` namespacing (repo has no pytest).

Background: Unit E's route mode POSTs image gens to the daemon's paid-action route with an
`expectedArtifactPath` that `dashboard/server/control/paidActionService.ts` validates (SAFE_ARTIFACT_PATH
+ PAID_ARTIFACT_NAMESPACE, ~lines 7/15/434-443) and REJECTS ('invalid-input') unless it is
repo-root-relative, forward-slashed, ends `.png`, carries no `..`/drive/leading-slash, and starts
with `orgs/faceless-youtube/channels/the-second-take/videos/`.

Before the path-namespace fix, route mode built `expectedArtifactPath` from `<kit>/_staging/` — the
CHANNEL-level staging dir every `forge.py gen` call uses (`orgs/faceless-youtube/channels/<channel>/
visual-kit/_staging/`), one directory short of the required `videos/<slug>/` segment. Every route-mode
gen would have been rejected. The fix: route mode now requires `--to <videos/<slug>/assets/...>` (the
real intended video-asset destination) and writes directly there instead of staging.

These tests use a lightweight stub Kit (no bible, no network, no real Gemini call) exactly like
`test_forge_seed_requirement.py`'s `_stub_kit`, extended with `route`/`route_root` to exercise the
route-mode branch of `cmd_gen`. `nano_via_route` itself is monkeypatched (it does the real HTTP round
trip) so these tests assert what `cmd_gen` COMPUTES and SENDS as `expectedArtifactPath`, not the
daemon's own validation logic (that lives in the dashboard test suite).

Run: py -3 .claude/skills/image-generation/scripts/test_forge_route_mode.py
"""
import os
import re
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))
import forge
from forge import cmd_gen, validate_route_artifact_path, PAID_ARTIFACT_NAMESPACE

# The daemon's exact `SAFE_ARTIFACT_PATH` regex (dashboard/server/control/paidActionService.ts
# ~line 7), transcribed verbatim (JS and Python regex syntax agree on this pattern) so these tests
# prove the emitted path against the REAL service rule, not just this script's own mirror of it.
SAFE_ARTIFACT_PATH = re.compile(
    r"^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\.{1,2}(?:/|$))[A-Za-z0-9._ -]+(?:/[A-Za-z0-9._ -]+)*$"
)


def _seed_file(tmpdir, name="seed.png", n_bytes=2048):
    p = os.path.join(tmpdir, name)
    with open(p, "wb") as f:
        f.write(b"\0" * n_bytes)
    return p


def _route_kit(route_root, staging):
    """A stub Kit carrying exactly the attributes route-mode `cmd_gen` touches: `staging` (the
    channel-level dir a bad implementation would wrongly target) plus `route`/`route_root` (the
    grant + its directory, as `find_route` returns them)."""
    return SimpleNamespace(
        staging=staging, root=route_root,
        route={"routeUrl": "http://127.0.0.1:0/api/control/paid-action", "token": "t"},
        route_root=route_root,
        resolve_seed=lambda s: s,
        prompt_for=lambda mode, delta, hold=False, figures=None, stage_role=None: "PROMPT " + (delta or ""),
    )


def _would_pass_the_service(rel_out):
    return (
        len(rel_out) <= 512
        and SAFE_ARTIFACT_PATH.match(rel_out) is not None
        and rel_out.lower().endswith(".png")
        and rel_out.lower().startswith(PAID_ARTIFACT_NAMESPACE)
    )


# --------------------------------------------------------------------------- #
# The representative case: a thin-slice image output, routed, with --to pointing at the real
# video-asset destination (mirrors the `images` stage's declared artifact,
# videos/<slug>/assets/scenes/manifest.json, in orgs/faceless-youtube/workflows/thin-slice-run.md).
# --------------------------------------------------------------------------- #
def test_route_mode_expected_artifact_path_is_videos_namespaced_not_staging():
    tmp = tempfile.mkdtemp()
    route_root = os.path.join(tmp, "worktree")
    staging = os.path.join(route_root, "orgs", "faceless-youtube", "channels", "the-second-take",
                            "visual-kit", "_staging")
    os.makedirs(staging, exist_ok=True)
    seed = _seed_file(tmp)
    k = _route_kit(route_root, staging)

    captured = {}

    def fake_nano_via_route(route, text, seeds, rel_out, abs_out):
        captured["rel_out"] = rel_out
        captured["abs_out"] = abs_out
        os.makedirs(os.path.dirname(abs_out), exist_ok=True)
        data = forge.PNG_MAGIC + b"\0" * 2000
        with open(abs_out, "wb") as f:
            f.write(data)
        return data

    orig = forge.nano_via_route
    forge.nano_via_route = fake_nano_via_route
    try:
        to_dir = "orgs/faceless-youtube/channels/the-second-take/videos/thin-slice-demo/assets/scenes"
        cmd_gen(k, [{"name": "L01", "mode": "identity", "character": "base",
                     "delta": "d", "seed": [seed]}], True, dry=False, to_dir=to_dir)
    finally:
        forge.nano_via_route = orig

    rel_out = captured.get("rel_out")
    assert rel_out is not None, "nano_via_route was never called"

    # (a) starts with the videos/ namespace the service requires — NOT the channel _staging/ dir
    assert rel_out.startswith("orgs/faceless-youtube/channels/the-second-take/videos/"), rel_out
    assert "_staging" not in rel_out, rel_out
    assert "visual-kit" not in rel_out, rel_out
    # (b) ends .png
    assert rel_out.endswith(".png"), rel_out
    # (c) forward slashes only, even though this test runs on Windows (os.sep == '\\')
    assert "\\" not in rel_out, rel_out
    # (d) no .., no drive letter, no leading slash
    assert ".." not in rel_out.split("/"), rel_out
    assert not re.match(r"^[A-Za-z]:", rel_out), rel_out
    assert not rel_out.startswith("/"), rel_out
    # The service's own SAFE_ARTIFACT_PATH + PAID_ARTIFACT_NAMESPACE rule, transcribed verbatim
    assert _would_pass_the_service(rel_out), rel_out
    # The daemon commits server-side to abs_out; the on-disk file actually landed under videos/,
    # never under the channel-level staging dir. Compare via normpath: `out` is built with
    # os.path.join against a forward-slashed `to_dir` string, so on Windows it may mix separators
    # even though it resolves to the identical filesystem path.
    expected_abs = os.path.normpath(os.path.join(route_root, to_dir, "L01.png"))
    assert os.path.normpath(captured["abs_out"]) == expected_abs, captured["abs_out"]
    assert os.path.exists(captured["abs_out"])


def test_direct_mode_gen_is_completely_unaffected_by_to_dir():
    """Backward-compat guard: `to_dir` must be a pure no-op with no `route` set (direct mode) — the
    existing stage-into-_staging/ behavior, unchanged, even when a caller happens to pass --to."""
    tmp = tempfile.mkdtemp()
    staging = os.path.join(tmp, "_staging")
    os.makedirs(staging, exist_ok=True)
    seed = _seed_file(tmp)
    k = SimpleNamespace(
        staging=staging, root=tmp,
        resolve_seed=lambda s: s,
        prompt_for=lambda mode, delta, hold=False, figures=None, stage_role=None: "PROMPT " + (delta or ""),
    )  # no `route` attribute at all, exactly like the pre-existing direct-mode stub tests
    req = {"name": "shot", "mode": "environment", "delta": "d", "seed": [seed]}
    cmd_gen(k, [req], True, dry=True, to_dir="orgs/faceless-youtube/channels/the-second-take/videos/x/assets/scenes")
    # dry-run never writes; re-run for real would target k.staging regardless of to_dir. Assert the
    # destination computation directly by checking cmd_gen's skip-if-exists path uses k.staging:
    marker = os.path.join(staging, "shot.png")
    with open(marker, "wb") as f:
        f.write(forge.PNG_MAGIC + b"\0" * 2000)
    import io
    from contextlib import redirect_stdout
    out = io.StringIO()
    with redirect_stdout(out):
        cmd_gen(k, [req], False, dry=False, to_dir="orgs/faceless-youtube/channels/the-second-take/videos/x/assets/scenes")
    assert "skip (exists)" in out.getvalue(), out.getvalue()


def test_route_mode_without_to_hard_errors_before_any_call():
    tmp = tempfile.mkdtemp()
    route_root = os.path.join(tmp, "worktree")
    staging = os.path.join(route_root, "orgs", "faceless-youtube", "channels", "the-second-take",
                            "visual-kit", "_staging")
    os.makedirs(staging, exist_ok=True)
    seed = _seed_file(tmp)
    k = _route_kit(route_root, staging)

    called = []
    orig = forge.nano_via_route
    forge.nano_via_route = lambda *a, **kw: called.append(1)
    try:
        try:
            cmd_gen(k, [{"name": "L01", "mode": "identity", "character": "base",
                        "delta": "d", "seed": [seed]}], True, dry=False, to_dir=None)
        except SystemExit as e:
            assert "--to" in str(e), str(e)
        else:
            assert False, "route mode with no --to should have hard-errored"
    finally:
        forge.nano_via_route = orig
    assert not called, "nano_via_route must never be reached without a valid --to"


def test_a_to_dir_outside_the_videos_namespace_is_rejected_locally():
    """If --to is misconfigured (e.g. still pointing at the channel-level staging convention or a
    sibling channel), the local validator must catch it BEFORE any daemon round trip — mirrors what
    the daemon's own SAFE_ARTIFACT_PATH/PAID_ARTIFACT_NAMESPACE check would reject."""
    tmp = tempfile.mkdtemp()
    route_root = os.path.join(tmp, "worktree")
    staging = os.path.join(route_root, "orgs", "faceless-youtube", "channels", "the-second-take",
                            "visual-kit", "_staging")
    os.makedirs(staging, exist_ok=True)
    seed = _seed_file(tmp)
    k = _route_kit(route_root, staging)

    called = []
    orig = forge.nano_via_route
    forge.nano_via_route = lambda *a, **kw: called.append(1)
    try:
        for bad_to in (
            "orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging",  # the old (wrong) dir
            "orgs/faceless-youtube/channels/other-channel/videos/x/assets/scenes",  # wrong channel
            "videos/x/assets/scenes",  # missing the orgs/... prefix entirely
        ):
            try:
                cmd_gen(k, [{"name": "L01", "mode": "identity", "character": "base",
                            "delta": "d", "seed": [seed]}], True, dry=False, to_dir=bad_to)
            except SystemExit as e:
                assert "namespace" in str(e) or "REJECTED" in str(e), str(e)
            else:
                assert False, f"--to {bad_to!r} should have been rejected locally"
    finally:
        forge.nano_via_route = orig
    assert not called, "nano_via_route must never be reached with an out-of-namespace --to"


# --------------------------------------------------------------------------- #
# Direct unit coverage of the validator against the service's own rule shape.
# --------------------------------------------------------------------------- #
def test_validate_route_artifact_path_accepts_a_representative_thin_slice_path():
    good = "orgs/faceless-youtube/channels/the-second-take/videos/thin-slice-demo/assets/scenes/L01.png"
    validate_route_artifact_path(good, "L01")  # must not raise
    assert _would_pass_the_service(good)


def test_validate_route_artifact_path_rejects_backslashes_dotdot_drive_and_wrong_namespace():
    bad_paths = [
        "orgs\\faceless-youtube\\channels\\the-second-take\\videos\\x\\assets\\scenes\\L01.png",
        "orgs/faceless-youtube/channels/the-second-take/videos/../../../etc/passwd.png",
        "C:/orgs/faceless-youtube/channels/the-second-take/videos/x/assets/scenes/L01.png",
        "/orgs/faceless-youtube/channels/the-second-take/videos/x/assets/scenes/L01.png",
        "orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/L01.png",
        "orgs/faceless-youtube/channels/the-second-take/videos/x/assets/scenes/L01.jpg",
    ]
    for p in bad_paths:
        try:
            validate_route_artifact_path(p, "L01")
        except SystemExit:
            pass
        else:
            assert False, f"should have rejected: {p!r}"


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

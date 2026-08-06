#!/usr/bin/env python3
"""Tests for route-mode `expectedArtifactPath` namespacing in voiceover.py's audio route.

Background: route mode (Phase 3 Unit E) POSTs one TTS call per piece to the daemon's paid-action
route with an `expectedArtifactPath` that `dashboard/server/control/paidActionService.ts` validates
(SAFE_ARTIFACT_PATH + PAID_ARTIFACT_NAMESPACE, ~lines 7/15/434-443) and REJECTS ('invalid-input')
unless it is repo-root-relative, forward-slashed, ends `.mp3`, carries no `..`/drive/leading-slash,
and starts with `orgs/faceless-youtube/channels/the-second-take/videos/`.

Route-mode voiceover output already lands under the video's own `assets/` dir (`vo.mp3` or
`shorts/short-NN.mp3`), which satisfies that namespace by construction whenever `video_dir` sits at
its documented location — but nothing enforced that LOCALLY before this change, unlike
`forge.py`'s `validate_route_artifact_path` for the image route. These tests exercise
`validate_route_artifact_path` directly (mirroring `test_forge_route_mode.py`'s direct-unit tests)
and `tts_request_via_route`'s call site, proving a misconfigured destination hard-errors before any
network round trip.

Run: py -3 .claude/skills/voiceover/scripts/test_voiceover_route_mode.py (or via pytest)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import voiceover as vo
from voiceover import PAID_ARTIFACT_NAMESPACE, tts_request_via_route, validate_route_artifact_path

# The daemon's exact `SAFE_ARTIFACT_PATH` regex (dashboard/server/control/paidActionService.ts
# ~line 7), transcribed verbatim, so these tests prove the emitted path against the REAL service
# rule, not just this script's own mirror of it.
SAFE_ARTIFACT_PATH = re.compile(
    r"^(?![A-Za-z]:)(?!/)(?!.*(?:^|/)\.{1,2}(?:/|$))[A-Za-z0-9._ -]+(?:/[A-Za-z0-9._ -]+)*$"
)


def _would_pass_the_service(rel_out):
    return (
        len(rel_out) <= 512
        and SAFE_ARTIFACT_PATH.match(rel_out) is not None
        and rel_out.lower().endswith(".mp3")
        and rel_out.lower().startswith(PAID_ARTIFACT_NAMESPACE)
    )


# --------------------------------------------------------------------------- #
# Direct unit coverage of the validator against the service's own rule shape.
# --------------------------------------------------------------------------- #
def test_validate_route_artifact_path_accepts_a_representative_thin_slice_vo_path():
    good = "orgs/faceless-youtube/channels/the-second-take/videos/thin-slice-demo/assets/vo.mp3"
    validate_route_artifact_path(good, "vo")  # must not raise
    assert _would_pass_the_service(good)


def test_validate_route_artifact_path_accepts_a_representative_short_vo_path():
    good = "orgs/faceless-youtube/channels/the-second-take/videos/thin-slice-demo/assets/shorts/short-01.mp3"
    validate_route_artifact_path(good, "short-01")  # must not raise
    assert _would_pass_the_service(good)


def test_validate_route_artifact_path_rejects_backslashes_dotdot_drive_and_wrong_namespace():
    bad_paths = [
        "orgs\\faceless-youtube\\channels\\the-second-take\\videos\\x\\assets\\vo.mp3",
        "orgs/faceless-youtube/channels/the-second-take/videos/../../../etc/passwd.mp3",
        "C:/orgs/faceless-youtube/channels/the-second-take/videos/x/assets/vo.mp3",
        "/orgs/faceless-youtube/channels/the-second-take/videos/x/assets/vo.mp3",
        "orgs/faceless-youtube/channels/the-second-take/visual-kit/_staging/vo.mp3",  # wrong dir entirely
        "orgs/faceless-youtube/channels/other-channel/videos/x/assets/vo.mp3",       # wrong channel
        "orgs/faceless-youtube/channels/the-second-take/videos/x/assets/vo.png",     # wrong extension
    ]
    for p in bad_paths:
        try:
            validate_route_artifact_path(p, "vo")
        except SystemExit:
            pass
        else:
            assert False, f"should have rejected: {p!r}"


# --------------------------------------------------------------------------- #
# `tts_request_via_route` call-site coverage: the validator must fire BEFORE any network round
# trip, for both a good destination (network still reached, but only after validation passes) and
# a misconfigured one (network never reached at all).
# --------------------------------------------------------------------------- #
def test_tts_request_via_route_hard_errors_locally_before_any_network_call_when_out_of_namespace(monkeypatch, tmp_path):
    route_root = tmp_path / "worktree"
    # A video_dir OUTSIDE the videos/ namespace (e.g. a channel-level path) -> the computed
    # expectedArtifactPath can never satisfy PAID_ARTIFACT_NAMESPACE.
    out_path = route_root / "orgs" / "faceless-youtube" / "channels" / "the-second-take" / "visual-kit" / "_staging" / "vo.mp3"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def no_network(*args, **kwargs):
        raise AssertionError("must not reach the network when the path is locally invalid")

    monkeypatch.setattr(vo, "_route_urlopen", no_network)

    route = {"routeUrl": "http://127.0.0.1:0/api/control/paid-action", "token": "t"}
    try:
        tts_request_via_route(route, route_root, "hello", out_path)
    except SystemExit as e:
        assert "namespace" in str(e) or "REJECTED" in str(e), str(e)
    else:
        assert False, "should have hard-errored before any network call"


def test_tts_request_via_route_computes_the_videos_namespaced_path_for_a_valid_destination(monkeypatch, tmp_path):
    route_root = tmp_path / "worktree"
    out_path = (route_root / "orgs" / "faceless-youtube" / "channels" / "the-second-take" /
                "videos" / "thin-slice-demo" / "assets" / "vo.mp3")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    captured = {}

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            out_path.write_bytes(b"\0" * 16)  # simulate the daemon committing the file server-side
            import json as _json
            return _json.dumps({"status": "succeeded"}).encode("utf-8")

    def fake_route_urlopen(req, timeout):
        captured["body"] = req.data
        return _Resp()

    monkeypatch.setattr(vo, "_route_urlopen", fake_route_urlopen)

    route = {"routeUrl": "http://127.0.0.1:0/api/control/paid-action", "token": "t"}
    tts_request_via_route(route, route_root, "hello", out_path)

    import json
    body = json.loads(captured["body"].decode("utf-8"))
    rel_out = body["expectedArtifactPath"]
    assert rel_out == "orgs/faceless-youtube/channels/the-second-take/videos/thin-slice-demo/assets/vo.mp3", rel_out
    assert _would_pass_the_service(rel_out), rel_out


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            import inspect
            if "monkeypatch" in inspect.signature(fn).parameters or "tmp_path" in inspect.signature(fn).parameters:
                print(f"SKIP {fn.__name__} (needs pytest fixtures; run via pytest)")
                continue
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed (fixture-dependent tests need pytest)")
    sys.exit(1 if failed else 0)

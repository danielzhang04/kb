"""Tests for `train/verify_pins.py` (REVIEW-2026-09-06-phase-a.md HIGH-1 / LOW-15).

Reuses the repo's ad-hoc `load_module` file loader (same pattern as
`test_render_aitoolkit_config.py`). Every test monkeypatches the module-level
`head_etag` name so nothing here makes a real network call.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import urllib.error
from pathlib import Path

import pytest

TRAIN = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def vp():
    # Fresh module object per test (not module-scoped) so one test's monkeypatch of
    # `head_etag` never leaks into another.
    return load_module("figment_verify_pins_test_module", TRAIN / "verify_pins.py")


def _pins(models: list[dict]) -> dict:
    return {
        "schema": "figment/tensor-pins@1",
        "pins": {"anchor": {"models": models, "custom_nodes": []}},
    }


def _model(**overrides) -> dict:
    base = {
        "repo_id": "Comfy-Org/z_image_turbo",
        "filename": "split_files/diffusion_models/z_image_turbo_bf16.safetensors",
        "revision": "08d04455279082882deaabc8d0d09fc914c071e1",
        "sha256": "2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6",
        "destination_dir": "/workspace/ComfyUI/models/diffusion_models",
    }
    base.update(overrides)
    return base


def test_matching_pin_verifies_clean(vp, monkeypatch):
    model = _model()

    def fake_head(url, *, timeout=30.0):
        assert url == vp._pin_url(model)
        return 302, {
            "x-linked-etag": f'"{model["sha256"]}"',
            "x-repo-commit": model["revision"],
        }

    monkeypatch.setattr(vp, "head_etag", fake_head)
    assert vp.verify_model_pin(model) == []
    assert vp.verify_pins(_pins([model])) == {}


def test_sha256_mismatch_is_reported(vp, monkeypatch):
    model = _model()
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": '"' + "0" * 64 + '"',
                                  "x-repo-commit": model["revision"]}),
    )
    problems = vp.verify_model_pin(model)
    assert len(problems) == 1 and "sha256 mismatch" in problems[0]
    results = vp.verify_pins(_pins([model]))
    assert list(results) == ["anchor"]


def test_missing_file_reported_as_unresolved(vp, monkeypatch):
    model = _model()
    monkeypatch.setattr(vp, "head_etag", lambda url, **kw: (404, {}))
    problems = vp.verify_model_pin(model)
    assert len(problems) == 1 and "did not resolve (HTTP 404" in problems[0]


def test_revision_that_does_not_resolve_to_itself_is_reported(vp, monkeypatch):
    model = _model()
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": f'"{model["sha256"]}"',
                                  "x-repo-commit": "deadbeef" * 5}),
    )
    problems = vp.verify_model_pin(model)
    assert len(problems) == 1 and "does not resolve to itself" in problems[0]


def test_missing_etag_header_is_reported(vp, monkeypatch):
    model = _model()
    monkeypatch.setattr(vp, "head_etag", lambda url, **kw: (200, {}))
    problems = vp.verify_model_pin(model)
    assert len(problems) == 1 and "no x-linked-etag" in problems[0]


def test_head_etag_reads_the_redirect_headers_without_following(vp, monkeypatch):
    """The real HTTP mechanics: a raised HTTPError on the blocked redirect carries the
    headers this script needs — verifies the (status, headers) contract head_etag promises,
    with urllib.request itself stubbed rather than the network."""
    class FakeHTTPError(urllib.error.HTTPError):
        def __init__(self):
            super().__init__("https://example.invalid", 302, "Found",
                              {"x-linked-etag": '"abc123"'}, None)

    class FakeOpener:
        def open(self, request, timeout=None):
            raise FakeHTTPError()

    monkeypatch.setattr(vp, "_OPENER", FakeOpener())
    status, headers = vp.head_etag("https://example.invalid/x")
    assert status == 302
    assert dict(headers)["x-linked-etag"] == '"abc123"'


def test_unknown_stage_raises(vp):
    with pytest.raises(vp.VerifyPinsError, match="unknown stage"):
        vp.verify_pins(_pins([]), stages=["not-a-real-stage"])


def test_stage_filter_only_checks_the_selected_stage(vp, monkeypatch):
    good = _model()
    bad = _model(repo_id="some/other-repo")
    pins = {
        "schema": "figment/tensor-pins@1",
        "pins": {
            "anchor": {"models": [good], "custom_nodes": []},
            "dataset": {"models": [bad], "custom_nodes": []},
        },
    }
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": f'"{good["sha256"]}"',
                                  "x-repo-commit": good["revision"]}),
    )
    # "dataset" would fail (wrong etag for `bad`'s url) if it were checked; limiting the
    # stage selection to "anchor" must skip it entirely.
    assert vp.verify_pins(pins, stages=["anchor"]) == {}


def test_keyed_variant_group_pin_is_verified_like_a_flat_stage(vp, monkeypatch):
    """Track-2 Task B1 (D26): `pins.skin_loras` is a *keyed* group -- one named optional
    LoRA per key, each `{"model": {...}}` -- not the flat `{"models": [...]}` shape every
    other stage uses. A stage lookup that only checks `.get("models")` would silently skip
    it (report zero problems without ever calling `head_etag`); it must instead be
    checked exactly like any other pin."""
    model = _model(repo_id="tlennon-ie/qwen-edit-skin", filename="qwen-edit-skin.safetensors")
    pins = {
        "schema": "figment/tensor-pins@1",
        "pins": {"skin_loras": {"qwen-edit-skin": {"model": model, "licence": "apache-2.0"}}},
    }
    calls = []

    def fake_head(url, *, timeout=30.0):
        calls.append(url)
        return 302, {"x-linked-etag": f'"{model["sha256"]}"', "x-repo-commit": model["revision"]}

    monkeypatch.setattr(vp, "head_etag", fake_head)
    assert vp.verify_pins(pins, stages=["skin_loras"]) == {}
    assert calls == [vp._pin_url(model)]

    # And a real mismatch on the keyed model must still be caught, not skipped.
    def wrong_etag(url, *, timeout=30.0):
        return 302, {"x-linked-etag": '"' + "0" * 64 + '"', "x-repo-commit": model["revision"]}

    monkeypatch.setattr(vp, "head_etag", wrong_etag)
    problems = vp.verify_pins(pins, stages=["skin_loras"])
    assert "skin_loras" in problems and "sha256 mismatch" in problems["skin_loras"][0]


def test_missing_pin_field_is_reported_without_a_network_call(vp, monkeypatch):
    def _unreachable(url, **kw):
        raise AssertionError("head_etag must not be called for a structurally invalid pin")

    monkeypatch.setattr(vp, "head_etag", _unreachable)
    problems = vp.verify_model_pin({"repo_id": "x/y", "filename": "f.safetensors"})
    assert len(problems) == 1 and "missing a non-empty" in problems[0]


# ---------------------------------------------------------------------------
# E5: --stage video checks video/wan22_ti2v_5b.model-pins.json -- a second file
# source for the identical verify_model_pin/head_etag check, not a new loader.
# ---------------------------------------------------------------------------

def _video_pins(models: list[dict]) -> dict:
    return {"schema": "figment/video-model-pins@1", "models": models}


def test_verify_video_pins_matches_clean(vp, monkeypatch):
    model = _model(repo_id="Comfy-Org/Wan_2.2_ComfyUI_Repackaged",
                    filename="split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors")
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": f'"{model["sha256"]}"',
                                  "x-repo-commit": model["revision"]}),
    )
    assert vp.verify_video_pins(_video_pins([model])) == []


def test_verify_video_pins_reports_a_sha256_mismatch(vp, monkeypatch):
    model = _model(repo_id="Comfy-Org/Wan_2.2_ComfyUI_Repackaged")
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": '"' + "0" * 64 + '"',
                                  "x-repo-commit": model["revision"]}),
    )
    problems = vp.verify_video_pins(_video_pins([model]))
    assert len(problems) == 1 and "sha256 mismatch" in problems[0]


def test_verify_video_pins_requires_a_models_list(vp):
    with pytest.raises(vp.VerifyPinsError, match="no 'models' list"):
        vp.verify_video_pins({"schema": "figment/video-model-pins@1"})


def test_default_video_pins_path_points_at_the_real_checked_in_document(vp):
    assert vp.DEFAULT_VIDEO_PINS_PATH.name == "wan22_ti2v_5b.model-pins.json"
    assert vp.DEFAULT_VIDEO_PINS_PATH.is_file()
    # And it is really that second file source, not tensor-pins.yaml re-read.
    assert vp.DEFAULT_VIDEO_PINS_PATH != vp.DEFAULT_PINS_PATH


def test_cli_stage_video_checks_only_the_video_pins_file(vp, monkeypatch, tmp_path, capsys):
    pins_path = tmp_path / "tensor-pins.yaml"
    pins_path.write_text(json.dumps(_pins([_model()])), encoding="utf-8")
    video_model = _model(repo_id="Comfy-Org/Wan_2.2_ComfyUI_Repackaged")
    video_path = tmp_path / "video-pins.json"
    video_path.write_text(json.dumps(_video_pins([video_model])), encoding="utf-8")

    calls = []

    def fake_head(url, **kw):
        calls.append(url)
        # matches only the video model's own url -- if the "anchor" stage were also
        # checked, this generic match would still pass, so the real proof that only
        # video ran is the call count below.
        return 302, {"x-linked-etag": f'"{video_model["sha256"]}"',
                      "x-repo-commit": video_model["revision"]}

    monkeypatch.setattr(vp, "head_etag", fake_head)
    rc = vp.main([
        "--pins", str(pins_path), "--video-pins", str(video_path), "--stage", "video",
    ])
    assert rc == 0
    assert calls == [vp._pin_url(video_model)], "only the video pin should have been HEADed"
    assert "verified 1 stage(s) clean: video" in capsys.readouterr().out


def test_cli_stage_video_reports_problems_with_the_video_prefix(vp, monkeypatch, tmp_path, capsys):
    pins_path = tmp_path / "tensor-pins.yaml"
    pins_path.write_text(json.dumps(_pins([_model()])), encoding="utf-8")
    video_model = _model(repo_id="Comfy-Org/Wan_2.2_ComfyUI_Repackaged")
    video_path = tmp_path / "video-pins.json"
    video_path.write_text(json.dumps(_video_pins([video_model])), encoding="utf-8")

    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (404, {}),
    )
    rc = vp.main([
        "--pins", str(pins_path), "--video-pins", str(video_path), "--stage", "video",
    ])
    assert rc == 1
    err = capsys.readouterr().err
    assert "STOP [video]" in err and "did not resolve (HTTP 404" in err


def test_cli_default_sweep_includes_video_only_for_the_real_default_pins(
    vp, monkeypatch, tmp_path, capsys,
):
    """The convenience default ("no --stage" checks video too) applies only when
    --pins is the real tensor-pins.yaml -- monkeypatching the module's own
    DEFAULT_PINS_PATH/DEFAULT_VIDEO_PINS_PATH (rather than passing --pins/--video-pins
    explicitly) is what proves that "real default" path, not an explicit override."""
    model = _model()
    pins_path = tmp_path / "tensor-pins.yaml"
    pins_path.write_text(json.dumps(_pins([model])), encoding="utf-8")
    video_model = _model(repo_id="Comfy-Org/Wan_2.2_ComfyUI_Repackaged")
    video_path = tmp_path / "video-pins.json"
    video_path.write_text(json.dumps(_video_pins([video_model])), encoding="utf-8")
    monkeypatch.setattr(vp, "DEFAULT_PINS_PATH", pins_path)
    monkeypatch.setattr(vp, "DEFAULT_VIDEO_PINS_PATH", video_path)

    def fake_head(url, **kw):
        for candidate in (model, video_model):
            if url == vp._pin_url(candidate):
                return 302, {"x-linked-etag": f'"{candidate["sha256"]}"',
                              "x-repo-commit": candidate["revision"]}
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(vp, "head_etag", fake_head)
    rc = vp.main([])
    assert rc == 0
    out = capsys.readouterr().out
    assert "verified 2 stage(s) clean: anchor, video" in out


def test_cli_explicit_custom_pins_default_sweep_does_not_pick_up_video(
    vp, monkeypatch, tmp_path, capsys,
):
    """A caller pointing --pins at an unrelated document (e.g. a bakeoff's own tiny
    pins.yaml, `expand/tests/test_bakeoff.py::test_verify_pins_cli_accepts_our_pins_path`)
    must keep the old "every stage in THAT document" meaning for "no --stage given" --
    never silently reach into this repo's real video pins file too."""
    model = _model()
    pins_path = tmp_path / "some-other-pins.yaml"
    pins_path.write_text(json.dumps(_pins([model])), encoding="utf-8")
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": f'"{model["sha256"]}"',
                                  "x-repo-commit": model["revision"]}),
    )
    rc = vp.main(["--pins", str(pins_path)])
    assert rc == 0
    assert "verified 1 stage(s) clean: anchor" in capsys.readouterr().out


def test_cli_explicit_stage_video_works_against_any_pins_document(
    vp, monkeypatch, tmp_path, capsys,
):
    """--stage video is always available, even against a non-default --pins document,
    since video is checked from --video-pins entirely, never from --pins itself."""
    model = _model()
    pins_path = tmp_path / "some-other-pins.yaml"
    pins_path.write_text(json.dumps(_pins([model])), encoding="utf-8")
    video_model = _model(repo_id="Comfy-Org/Wan_2.2_ComfyUI_Repackaged")
    video_path = tmp_path / "video-pins.json"
    video_path.write_text(json.dumps(_video_pins([video_model])), encoding="utf-8")
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": f'"{video_model["sha256"]}"',
                                  "x-repo-commit": video_model["revision"]}),
    )
    rc = vp.main([
        "--pins", str(pins_path), "--video-pins", str(video_path), "--stage", "video",
    ])
    assert rc == 0
    assert "verified 1 stage(s) clean: video" in capsys.readouterr().out


def test_cli_unknown_stage_message_lists_video_as_known(vp, tmp_path, capsys):
    pins_path = tmp_path / "tensor-pins.yaml"
    pins_path.write_text(json.dumps(_pins([_model()])), encoding="utf-8")
    rc = vp.main(["--pins", str(pins_path), "--stage", "not-a-real-stage"])
    assert rc == 1
    err = capsys.readouterr().err
    assert "unknown stage(s): ['not-a-real-stage']" in err
    assert "'video'" in err


def test_cli_main_exits_nonzero_and_prints_every_problem_on_stderr(vp, monkeypatch, tmp_path, capsys):
    model = _model()
    pins_path = tmp_path / "tensor-pins.yaml"
    pins_path.write_text(json.dumps(_pins([model])), encoding="utf-8")
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": '"' + "0" * 64 + '"',
                                  "x-repo-commit": model["revision"]}),
    )
    rc = vp.main(["--pins", str(pins_path)])
    assert rc == 1
    err = capsys.readouterr().err
    assert "STOP [anchor]" in err and "sha256 mismatch" in err


def test_cli_main_exits_zero_when_every_pin_verifies(vp, monkeypatch, tmp_path, capsys):
    model = _model()
    pins_path = tmp_path / "tensor-pins.yaml"
    pins_path.write_text(json.dumps(_pins([model])), encoding="utf-8")
    monkeypatch.setattr(
        vp, "head_etag",
        lambda url, **kw: (302, {"x-linked-etag": f'"{model["sha256"]}"',
                                  "x-repo-commit": model["revision"]}),
    )
    rc = vp.main(["--pins", str(pins_path), "--stage", "anchor"])
    assert rc == 0
    assert "verified 1 stage(s) clean: anchor" in capsys.readouterr().out

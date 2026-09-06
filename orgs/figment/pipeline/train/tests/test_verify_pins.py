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


def test_missing_pin_field_is_reported_without_a_network_call(vp, monkeypatch):
    def _unreachable(url, **kw):
        raise AssertionError("head_etag must not be called for a structurally invalid pin")

    monkeypatch.setattr(vp, "head_etag", _unreachable)
    problems = vp.verify_model_pin({"repo_id": "x/y", "filename": "f.safetensors"})
    assert len(problems) == 1 and "missing a non-empty" in problems[0]


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

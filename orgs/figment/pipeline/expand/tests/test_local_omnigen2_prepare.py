from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest


EXPAND = Path(__file__).resolve().parents[1]
MODULE_PATH = EXPAND / "local_omnigen2_prepare.py"


def load_module():
    spec = importlib.util.spec_from_file_location("local_omnigen2_prepare_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(
        self,
        body: bytes,
        *,
        final_url: str,
        content_length: int | None = None,
        fail_on_read: int | None = None,
    ):
        self._body = io.BytesIO(body)
        self._final_url = final_url
        self._fail_on_read = fail_on_read
        self.read_calls = 0
        self.status = 200
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def geturl(self) -> str:
        return self._final_url

    def read(self, size: int) -> bytes:
        self.read_calls += 1
        if self._fail_on_read == self.read_calls:
            raise OSError("mock transport failed")
        return self._body.read(size)


class FakeOpener:
    def __init__(self, responses: dict[str, FakeResponse]):
        self.responses = responses
        self.calls: list[tuple[str, int]] = []

    def open(self, request, timeout: int):
        self.calls.append((request.full_url, timeout))
        return self.responses[request.full_url]


def safetensors_payload(label: str) -> bytes:
    data = label.encode("ascii")
    header = json.dumps(
        {
            "value": {
                "dtype": "U8",
                "shape": [len(data)],
                "data_offsets": [0, len(data)],
            }
        },
        separators=(",", ":"),
    ).encode("utf-8")
    header += b" " * ((8 - len(header) % 8) % 8)
    return len(header).to_bytes(8, "little") + header + data


@pytest.fixture()
def prepared(tmp_path, monkeypatch):
    module = load_module()
    private = tmp_path / "private"
    private.mkdir()
    destination = private / "o2"
    payloads = tuple(
        safetensors_payload(label)
        for label in ("diffusion-model", "text-vision-encoder", "vae")
    )
    targets = (
        "diffusion_models/omnigen2_fp16.safetensors",
        "text_encoders/qwen_2.5_vl_fp16.safetensors",
        "vae/ae.safetensors",
    )
    sources = tuple(f"split_files/{target}" for target in targets)
    models = tuple(
        {
            "id": f"model_{index}",
            "source_path": source,
            "target": target,
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "component_license": "test-only",
        }
        for index, (source, target, payload) in enumerate(
            zip(sources, targets, payloads, strict=True), start=1
        )
    )
    monkeypatch.setattr(module, "PRIVATE_BASE", private)
    monkeypatch.setattr(module, "PRIVATE_ROOT", destination)
    monkeypatch.setattr(module, "MODELS", models)
    monkeypatch.setattr(module, "EXPECTED_TOTAL_BYTES", sum(map(len, payloads)))
    monkeypatch.setattr(module, "MIN_START_FREE_BYTES", 1)
    monkeypatch.setattr(module, "MIN_REMAINING_FREE_BYTES", 1)
    monkeypatch.setattr(module, "_free_bytes", lambda _path: 10**12)
    monkeypatch.setattr(
        module,
        "_inspect_feasibility",
        lambda: {"repo_path": module.FEASIBILITY_PATH, "bytes": 10, "sha256": module.FEASIBILITY_SHA256},
    )
    monkeypatch.setattr(
        module,
        "_inspect_comfy",
        lambda: {
            "root": "mock-ComfyUI",
            "commit": module.COMFY_COMMIT,
            "tracked_clean": True,
            "untracked_inventory": ["server.pid"],
            "critical_files": [],
        },
    )
    return module, private, destination, payloads


def opener_for(module, payloads, *, replacements=None):
    replacements = replacements or {}
    responses = {}
    for item, payload in zip(module.MODELS, payloads, strict=True):
        url = module._source_url(item)
        responses[url] = replacements.get(
            item["id"],
            FakeResponse(
                payload,
                final_url=f"https://cas-bridge.xethub.hf.co/object/{item['id']}?signed=secret",
                content_length=len(payload),
            ),
        )
    return FakeOpener(responses)


def assert_no_staging(private: Path, destination: Path) -> None:
    assert not destination.exists()
    assert list(private.iterdir()) == []


def assert_failure_retained(
    private: Path, destination: Path, expected_error_code: str
) -> dict:
    assert not destination.exists()
    retained = list(private.glob(f"{destination.name}-failed-*"))
    assert len(retained) == 1
    assert not list(private.glob(f".{destination.name}.*.staging"))
    receipt = json.loads(
        (retained[0] / "preparation-failed.json").read_text(encoding="utf-8")
    )
    assert receipt["state"] == "failed-preparation; retained-for-review"
    assert receipt["error_code"] == expected_error_code
    assert receipt["admission"] is False
    assert receipt["gpu_used"] is False
    assert "?" not in json.dumps(receipt)
    return receipt


def test_default_prints_plan_without_network_or_write(prepared, monkeypatch, capsys):
    module, private, destination, _payloads = prepared
    monkeypatch.setattr(
        module, "_new_opener", lambda: (_ for _ in ()).throw(AssertionError("network attempted"))
    )
    assert module.main([]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["mode"] == "plan-only; no writes or network"
    assert plan["apply_is_preparation_not_admission"] is True
    assert plan["commercial_deployment_cleared"] is False
    assert plan["gpu_used"] is False
    assert_no_staging(private, destination)


def test_mock_downloads_publish_exact_tree_and_non_admission_receipt(prepared):
    module, _private, destination, payloads = prepared
    opener = opener_for(module, payloads)
    assert module._run_apply(opener) == destination
    assert len(opener.calls) == 3
    for item, payload in zip(module.MODELS, payloads, strict=True):
        assert destination.joinpath(*Path(item["target"]).parts).read_bytes() == payload
    receipt = json.loads((destination / "preparation.json").read_text(encoding="utf-8"))
    assert receipt["state"] == "verified-files; not-admitted"
    assert receipt["total_bytes"] == sum(map(len, payloads))
    assert receipt["admission"] is False
    assert receipt["promotable"] is False
    assert receipt["commercial_deployment_cleared"] is False
    assert receipt["gpu_used"] is False
    assert all(row["final_host"] == "cas-bridge.xethub.hf.co" for row in receipt["files"])
    assert "?signed=" not in json.dumps(receipt)


def test_content_length_mismatch_refuses_before_read_and_retains_failure(prepared):
    module, private, destination, payloads = prepared
    first = module.MODELS[0]
    response = FakeResponse(
        payloads[0],
        final_url="https://cdn-lfs.huggingface.co/model",
        content_length=len(payloads[0]) + 1,
    )
    opener = opener_for(module, payloads, replacements={first["id"]: response})
    with pytest.raises(module.OmniGen2PreparationError, match="byte count mismatch"):
        module._run_apply(opener)
    assert response.read_calls == 0
    assert_failure_retained(private, destination, "byte_count_mismatch")


def test_hash_mismatch_retains_partial_evidence(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    changed = tuple(dict(item) for item in module.MODELS)
    changed[0]["sha256"] = "0" * 64
    monkeypatch.setattr(module, "MODELS", changed)
    opener = opener_for(module, payloads)
    with pytest.raises(module.OmniGen2PreparationError, match="SHA-256 mismatch"):
        module._run_apply(opener)
    receipt = assert_failure_retained(private, destination, "sha_256_mismatch")
    assert any(row["path"].endswith(".part") for row in receipt["retained_inventory"]["files"])


def test_redirect_outside_allowlist_is_refused_before_body_read(prepared):
    module, private, destination, payloads = prepared
    first = module.MODELS[0]
    response = FakeResponse(
        payloads[0],
        final_url="https://example.com/stolen-model?token=secret",
        content_length=len(payloads[0]),
    )
    opener = opener_for(module, payloads, replacements={first["id"]: response})
    with pytest.raises(module.OmniGen2PreparationError, match="host allowlist"):
        module._run_apply(opener)
    assert response.read_calls == 0
    assert_failure_retained(private, destination, "host_allowlist")


def test_destination_outside_direct_private_child_is_refused_before_download(
    prepared, monkeypatch
):
    module, private, _destination, payloads = prepared
    outside = private.parent / "outside-models"
    monkeypatch.setattr(module, "PRIVATE_ROOT", outside)
    opener = opener_for(module, payloads)
    with pytest.raises(module.OmniGen2PreparationError, match="direct child"):
        module._run_apply(opener)
    assert opener.calls == []
    assert not outside.exists()


def test_transport_failure_retains_verified_first_file_and_partial_second(prepared):
    module, private, destination, payloads = prepared
    second = module.MODELS[1]
    response = FakeResponse(
        payloads[1],
        final_url="https://cdn-lfs-us-1.hf.co/model",
        content_length=len(payloads[1]),
        fail_on_read=2,
    )
    opener = opener_for(module, payloads, replacements={second["id"]: response})
    with pytest.raises(module.OmniGen2PreparationError, match="transport failed"):
        module._run_apply(opener)
    receipt = assert_failure_retained(private, destination, "transport_failed")
    assert len(receipt["completed_files"]) == 1
    assert any(row["path"].endswith(".part") for row in receipt["retained_inventory"]["files"])


def test_apply_does_not_start_subprocess_or_touch_gpu(prepared, monkeypatch):
    module, _private, destination, payloads = prepared
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("subprocess or GPU probe attempted")
        ),
    )
    opener = opener_for(module, payloads)
    module._run_apply(opener)
    receipt = json.loads((destination / "preparation.json").read_text(encoding="utf-8"))
    assert receipt["gpu_used"] is False
    assert receipt["model_loaded"] is False
    assert receipt["generation_run"] is False


def test_safetensors_header_bound_fails_closed_and_is_retained(prepared):
    module, private, destination, payloads = prepared
    first = module.MODELS[0]
    malformed = (
        (module.MAX_SAFETENSORS_HEADER_BYTES + 1).to_bytes(8, "little")
        + payloads[0][8:]
    )
    response = FakeResponse(
        malformed,
        final_url="https://cdn-lfs.huggingface.co/model",
        content_length=len(malformed),
    )
    opener = opener_for(module, payloads, replacements={first["id"]: response})
    with pytest.raises(module.OmniGen2PreparationError, match="header exceeds bound"):
        module._run_apply(opener)
    assert_failure_retained(private, destination, "safetensors")


def test_streaming_disk_floor_stops_and_retains_failure(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    calls = 0

    def free_bytes(_path):
        nonlocal calls
        calls += 1
        return 10**12 if calls == 1 else 0

    monkeypatch.setattr(module, "DISK_CHECK_INTERVAL_BYTES", 1)
    monkeypatch.setattr(module, "_free_bytes", free_bytes)
    opener = opener_for(module, payloads)
    with pytest.raises(module.OmniGen2PreparationError, match="free during download"):
        module._run_apply(opener)
    assert_failure_retained(private, destination, "free_during_download")


def test_global_deadline_refuses_before_network(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    monkeypatch.setattr(module, "APPLY_DEADLINE_SECONDS", -1)
    opener = opener_for(module, payloads)
    with pytest.raises(module.OmniGen2PreparationError, match="deadline expired"):
        module._run_apply(opener)
    assert opener.calls == []
    assert_no_staging(private, destination)


def test_preparer_source_must_match_before_and_after_download(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    original = module._sha256_file
    source_calls = 0

    def changing_source(path, **kwargs):
        nonlocal source_calls
        observed = original(path, **kwargs)
        if path.resolve() == Path(module.__file__).resolve():
            source_calls += 1
            if source_calls == 2:
                observed = {**observed, "sha256": "f" * 64}
        return observed

    monkeypatch.setattr(module, "_sha256_file", changing_source)
    with pytest.raises(module.OmniGen2PreparationError, match="source changed"):
        module._run_apply(opener_for(module, payloads))
    assert_failure_retained(private, destination, "source_changed")


def test_new_opener_ignores_ambient_proxy_configuration(monkeypatch):
    import urllib.request

    module = load_module()
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.invalid:3128")
    opener = module._new_opener()
    proxies = [h for h in opener.handlers if isinstance(h, urllib.request.ProxyHandler)]
    # An empty ProxyHandler has no protocol methods, so OpenerDirector omits it.
    # Its constructor still suppresses build_opener's environment-backed default.
    assert proxies == []
    control = urllib.request.build_opener()
    assert any(isinstance(h, urllib.request.ProxyHandler) and h.proxies.get("https") == "http://proxy.invalid:3128" for h in control.handlers)
    assert any(isinstance(h, module._PinnedRedirectHandler) for h in opener.handlers)
    with pytest.raises(module.OmniGen2PreparationError, match="host allowlist"):
        module._validated_url("https://example.com/x")


def test_inventory_failure_still_writes_receipt_and_preserves_original_error(
    prepared, monkeypatch
):
    module, private, destination, payloads = prepared
    changed = tuple(dict(item) for item in module.MODELS)
    changed[0]["sha256"] = "0" * 64
    monkeypatch.setattr(module, "MODELS", changed)
    monkeypatch.setattr(
        module,
        "_tree_inventory",
        lambda _root: (_ for _ in ()).throw(RuntimeError("inventory exploded")),
    )
    with pytest.raises(module.OmniGen2PreparationError, match="SHA-256 mismatch"):
        module._run_apply(opener_for(module, payloads))
    receipt = assert_failure_retained(private, destination, "sha_256_mismatch")
    assert receipt["retained_inventory"] is None
    assert receipt["retained_inventory_error_code"] == "retained_inventory_unavailable"
    assert "exploded" not in json.dumps(receipt)
    retained = next(private.glob(f"{destination.name}-failed-*"))
    assert list(retained.rglob("*.part"))


def test_local_rename_failure_is_not_transport_and_keeps_part(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    second = module.MODELS[1]
    original_replace = module.os.replace
    victim = Path(second["target"]).name

    def failing_replace(src, dst):
        if Path(dst).name == victim:
            raise OSError("disk rename failed")
        return original_replace(src, dst)

    monkeypatch.setattr(module.os, "replace", failing_replace)
    with pytest.raises(module.OmniGen2PreparationError, match="local write failed"):
        module._run_apply(opener_for(module, payloads))
    receipt = assert_failure_retained(private, destination, "local_write_failed")
    assert len(receipt["completed_files"]) == 1
    assert any(row["path"].endswith(".part") for row in receipt["retained_inventory"]["files"])
    assert "disk rename" not in json.dumps(receipt)


def test_completed_file_altered_during_later_download_refuses_publish(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    original = module._download_one
    first_target = Path(module.MODELS[0]["target"]).parts

    def tamper_after_second(opener, item, target, **kwargs):
        record = original(opener, item, target, **kwargs)
        if item["id"] == module.MODELS[1]["id"]:
            first_path = target.parents[1].joinpath(*first_target)
            first_path.write_bytes(bytes(len(payloads[0])))
        return record

    monkeypatch.setattr(module, "_download_one", tamper_after_second)
    with pytest.raises(module.OmniGen2PreparationError, match="final inventory SHA-256"):
        module._run_apply(opener_for(module, payloads))
    receipt = assert_failure_retained(private, destination, "final_inventory")
    assert len(receipt["completed_files"]) == 3


def test_unexpected_final_file_refuses_publish_and_is_retained(prepared, monkeypatch):
    module, private, destination, payloads = prepared
    original = module._write_receipt
    injected = False

    def write_and_inject(path, receipt):
        nonlocal injected
        original(path, receipt)
        if not injected:
            (path.parent / "unexpected.bin").write_bytes(b"unexpected")
            injected = True

    monkeypatch.setattr(module, "_write_receipt", write_and_inject)
    with pytest.raises(module.OmniGen2PreparationError, match="final inventory"):
        module._run_apply(opener_for(module, payloads))
    assert_failure_retained(private, destination, "final_inventory")

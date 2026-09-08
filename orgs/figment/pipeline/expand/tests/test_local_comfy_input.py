from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

EXPAND = Path(__file__).resolve().parents[1]
MODULE_PATH = EXPAND / "local_comfy_input.py"


def load_module():
    spec = importlib.util.spec_from_file_location("local_comfy_input_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def pinned(path: Path, module) -> dict[str, object]:
    return {"filename": path.name, "path": path, "sha256": module.sha256_file(path)}


@pytest.fixture()
def local(tmp_path, monkeypatch):
    module = load_module()
    comfy = tmp_path / "ComfyUI"
    node = comfy / "custom_nodes" / "ComfyUI_IPAdapter_plus"
    node.mkdir(parents=True)
    (node / "IPAdapterPlus.py").write_text(
        'NODE_CLASS_MAPPINGS = {"IPAdapterModelLoader": x, "IPAdapterAdvanced": y}', encoding="utf-8"
    )
    checkpoint = comfy / "models" / "checkpoints" / "RealVisXL_V5.0_fp16.safetensors"
    ipa = comfy / "models" / "ipadapter" / "ip-adapter-plus-face_sdxl_vit-h.safetensors"
    clip = comfy / "models" / "clip_vision" / "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
    for path, value in ((checkpoint, b"checkpoint"), (ipa, b"ipadapter"), (clip, b"clip")):
        path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(value)
    source = tmp_path / "repo" / module.CANONICAL
    source.parent.mkdir(parents=True); source.write_bytes(b"canonical-g01")
    persona = tmp_path / "repo" / module.PERSONA
    persona.parent.mkdir(parents=True, exist_ok=True)
    persona.write_text(json.dumps({"identity": {"look": {"age_stage": "a woman in her early twenties, about twenty-one, an adult woman's face", "hair": "jet-black hair parted in the middle and falling past the shoulders", "eyes": "dark brown eyes", "skin": "fair skin", "brows": "full dark brows", "makeup": "natural makeup", "build": "slim adult figure", "clothing": "a black opaque top"}}}), encoding="utf-8")
    monkeypatch.setattr(module, "COMFY_ROOT", comfy)
    monkeypatch.setattr(module, "NODE_DIR", node)
    monkeypatch.setattr(module, "CANONICAL_SHA256", module.sha256_file(source))
    monkeypatch.setattr(module, "MODELS", {"checkpoint": pinned(checkpoint, module), "ipadapter": pinned(ipa, module), "clip_vision": pinned(clip, module)})
    monkeypatch.setattr(module, "git_head", lambda _: module.COMFY_COMMIT if _ == comfy else module.NODE_COMMIT)
    monkeypatch.setattr(module, "git_clean", lambda _: True)
    return module, source.parents[5]


def test_offline_manifest_binds_source_pins_prompt_and_one_image(local):
    module, repo = local
    manifest = module.build_manifest(repo)
    assert manifest["mode"] == "offline-plan-only"
    assert manifest["execution_requires_parent_review"] is True
    assert manifest["reference"]["sole_pixel_reference"] is True
    assert "about twenty-one" in manifest["prompt"]["positive"]
    assert "jet-black hair parted in the middle" in manifest["prompt"]["positive"]
    assert manifest["persona"]["sha256"]
    assert {key: manifest["generation"][key] for key in ("seed", "width", "height", "images")} == {"seed": 481516234, "width": 1024, "height": 1024, "images": 1}
    assert manifest["generation"]["steps"] == 24
    graph = manifest["workflow"]["api_prompt"]
    assert set(node["class_type"] for node in graph.values()) >= {"CheckpointLoaderSimple", "IPAdapterAdvanced", "CLIPVisionLoader", "KSampler", "VAEDecode", "SaveImage"}
    assert "FaceID" not in json.dumps(graph)


def test_pin_or_source_mismatch_refuses_before_manifest(local):
    module, repo = local
    (repo / module.CANONICAL).write_bytes(b"mutated")
    with pytest.raises(module.LocalComfyError, match="hash mismatch"):
        module.build_manifest(repo)


def test_static_plugin_mapping_must_exist(local):
    module, repo = local
    (module.NODE_DIR / "IPAdapterPlus.py").write_text("NODE_CLASS_MAPPINGS = {}", encoding="utf-8")
    with pytest.raises(module.LocalComfyError, match="mapping missing"):
        module.build_manifest(repo)


def test_offline_cli_never_calls_execute(local, monkeypatch, capsys):
    module, repo = local
    monkeypatch.setattr(module, "execute", lambda *_: (_ for _ in ()).throw(AssertionError("execute called")))
    assert module.main(["--repo-root", str(repo)]) == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "offline-plan-only"


def test_execute_requires_fresh_private_owned_run_root(local, tmp_path):
    module, _ = local
    existing = tmp_path / "_private" / "figment-local-comfy-existing"
    existing.mkdir(parents=True)
    with pytest.raises(module.LocalComfyError, match="fresh"):
        module._fresh_run_root(existing, existing.parent)
    with pytest.raises(module.LocalComfyError, match="immediate"):
        module._fresh_run_root(existing.parent / "nested" / "figment-local-comfy-run", existing.parent)


def test_execute_command_is_loopback_isolated_and_whitelisted(local, tmp_path, monkeypatch):
    module, repo = local
    run = tmp_path / "_private" / "figment-local-comfy-run"
    run.parent.mkdir()
    calls = []
    class Process:
        pid = 1234
        def poll(self): return 0
        def terminate(self): pass
        def wait(self, timeout): return 0
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True)
    test_python.write_bytes(b"python")
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda *_: None)
    monkeypatch.setattr(module, "_require_owned_listener", lambda *_: None)
    monkeypatch.setattr(module.subprocess, "Popen", lambda args, **kwargs: (calls.append((args, kwargs)) or Process()))
    monkeypatch.setattr(module, "_local_json", lambda *_a, **_k: (_ for _ in ()).throw(module.urllib.error.URLError("not-ready")))
    monkeypatch.setattr(module.time, "monotonic", iter((0, 601)).__next__)
    with pytest.raises(module.urllib.error.URLError):
        module.execute(repo, run)
    args, kwargs = calls[0]
    assert kwargs["shell"] is False and kwargs["cwd"] == module.COMFY_ROOT
    assert args[0] == str(module.COMFY_ROOT / "venv" / "Scripts" / "python.exe")
    assert kwargs["env"]["HF_HUB_OFFLINE"] == "1" and kwargs["env"]["PYTHONDONTWRITEBYTECODE"] == "1"
    assert kwargs["env"]["TORCH_HOME"].endswith("torch") and kwargs["env"]["XDG_CACHE_HOME"].endswith("xdg")
    assert kwargs["creationflags"] == getattr(module.subprocess, "CREATE_NO_WINDOW", 0)
    assert args[args.index("--listen") + 1] == "127.0.0.1"
    assert {"--input-directory", "--output-directory", "--temp-directory", "--user-directory", "--disable-api-nodes", "--disable-all-custom-nodes", "--disable-auto-launch"} <= set(args)
    assert args[args.index("--whitelist-custom-nodes") + 1] == "ComfyUI_IPAdapter_plus"
    assert (run / "input" / "g01.jpg").read_bytes() == b"canonical-g01"


def test_occupied_listener_refuses_without_launch(local, monkeypatch):
    module, _ = local
    class Socket:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def connect_ex(self, _): return 0
    monkeypatch.setattr(module.socket, "socket", lambda *_: Socket())
    with pytest.raises(module.LocalComfyError, match="occupied"):
        module._port_available()




def test_loopback_opener_disables_proxies_and_redirects(local):
    module, _ = local
    opener = module._loopback_opener()
    assert not any(isinstance(handler, module.urllib.request.ProxyHandler) for handler in opener.handlers)
    redirect = next(handler for handler in opener.handlers if isinstance(handler, module.urllib.request.HTTPRedirectHandler))
    request = module.urllib.request.Request("http://127.0.0.1:8190/prompt")
    with pytest.raises(module.urllib.error.HTTPError, match="redirect refused"):
        redirect.redirect_request(request, None, 302, "moved", {}, "http://elsewhere.invalid")


def test_foreign_listener_is_never_treated_as_owned(local, monkeypatch):
    module, _ = local
    class Process:
        pid = 1234
        def poll(self): return None
    monkeypatch.setattr(module, "_listener_pid", lambda: 9876)
    monkeypatch.setattr(module.time, "monotonic", iter((0, 601)).__next__)
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    with pytest.raises(module.LocalComfyError, match="owned ComfyUI listener"):
        module._wait_for_owned_listener(Process(), 600)


def test_completed_output_refuses_wrong_dimensions(local, tmp_path):
    module, _ = local
    from PIL import Image
    output = tmp_path / "output"; output.mkdir()
    Image.new("RGB", (32, 32), "black").save(output / "bad.png")
    history = {"p": {"outputs": {"11": {"images": [{"filename": "bad.png", "type": "output", "subfolder": ""}]}}}}
    with pytest.raises(module.LocalComfyError, match="wrong format or dimensions"):
        module._completed_output(history, "p", output)


def test_ambiguous_post_has_one_attempt_marker_and_no_retry(local, tmp_path, monkeypatch):
    module, repo = local
    run = tmp_path / "_private" / "figment-local-comfy-one"; run.parent.mkdir()
    class Process:
        pid = 1234
        returncode = None
        def poll(self): return self.returncode
        def terminate(self): self.returncode = 0
        def wait(self, timeout): return 0
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    process = Process(); seen = []
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda *_: None)
    monkeypatch.setattr(module, "_require_owned_listener", lambda *_: None)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    def ambiguous(*args):
        seen.append(args[1:3]); raise module.urllib.error.URLError("response lost")
    monkeypatch.setattr(module, "_local_json", ambiguous)
    with pytest.raises(module.urllib.error.URLError):
        module.execute(repo, run)
    assert seen == [("POST", "/prompt")]
    assert (run / "dispatch-attempt.json").is_file()
    assert process.returncode == 0


def test_completed_receipt_is_written_after_owned_teardown(local, tmp_path, monkeypatch):
    module, repo = local
    from PIL import Image
    run = tmp_path / "_private" / "figment-local-comfy-complete"; run.parent.mkdir()
    class Process:
        pid = 1234
        returncode = None
        def poll(self): return self.returncode
        def terminate(self): self.returncode = 0
        def wait(self, timeout): return 0
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    process = Process(); requests = []
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda *_: None)
    monkeypatch.setattr(module, "_require_owned_listener", lambda *_: None)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    def response(_opener, method, endpoint, _payload=None):
        requests.append((method, endpoint))
        if method == "POST": return {"prompt_id": "p"}
        Image.new("RGB", (1024, 1024), "black").save(run / "output" / "done.png")
        return {"p": {"outputs": {"11": {"images": [{"filename": "done.png", "type": "output", "subfolder": ""}]}}}}
    monkeypatch.setattr(module, "_local_json", response)
    receipt = module.execute(repo, run)
    saved = json.loads((run / "receipt.json").read_text())
    assert requests == [("POST", "/prompt"), ("GET", "/history/p")]
    assert receipt["output"]["dimensions"] == [1024, 1024]
    assert saved["teardown"]["verified_stopped"] is True and process.returncode == 0
    assert (run / "manifest.json").is_file()


def test_listener_rebind_after_readiness_refuses_before_post(local, tmp_path, monkeypatch):
    module, repo = local
    run = tmp_path / "_private" / "figment-local-comfy-rebind"; run.parent.mkdir()
    class Process:
        pid = 1234
        returncode = None
        def poll(self): return self.returncode
        def terminate(self): self.returncode = 0
        def wait(self, timeout): return 0
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    process = Process(); requests = []
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda *_: None)
    monkeypatch.setattr(module, "_listener_pid", lambda: 9999)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    monkeypatch.setattr(module, "_local_json", lambda *_a, **_k: requests.append(_a))
    with pytest.raises(module.LocalComfyError, match="not owned"):
        module.execute(repo, run)
    assert requests == [] and process.returncode == 0


def test_post_queue_failure_records_sanitized_teardown(local, tmp_path, monkeypatch):
    module, repo = local
    run = tmp_path / "_private" / "figment-local-comfy-history-failure"; run.parent.mkdir()
    class Process:
        pid = 1234
        returncode = None
        def poll(self): return self.returncode
        def terminate(self): self.returncode = 0
        def wait(self, timeout): return 0
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    process = Process()
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda *_: None)
    monkeypatch.setattr(module, "_require_owned_listener", lambda *_: None)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    calls = iter(({"prompt_id": "p"}, module.LocalComfyError("history malformed")))
    def response(*_args):
        value = next(calls)
        if isinstance(value, Exception): raise value
        return value
    monkeypatch.setattr(module, "_local_json", response)
    with pytest.raises(module.LocalComfyError, match="history malformed"):
        module.execute(repo, run)
    journal = json.loads((run / "journal.json").read_text())
    assert journal["status"] == "failed"
    assert journal["error_class"] == "LocalComfyError"
    assert journal["teardown"]["verified_stopped"] is True


def test_teardown_failure_writes_failed_journal_without_receipt(local, tmp_path, monkeypatch):
    module, repo = local
    from PIL import Image
    run = tmp_path / "_private" / "figment-local-comfy-teardown-failure"; run.parent.mkdir()
    class Process:
        pid = 1234
        def poll(self): return None
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda *_: None)
    monkeypatch.setattr(module, "_require_owned_listener", lambda *_: None)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: Process())
    monkeypatch.setattr(module, "_teardown", lambda _: (_ for _ in ()).throw(module.LocalComfyError("teardown failed")))
    def response(_opener, method, _endpoint, _payload=None):
        if method == "POST": return {"prompt_id": "p"}
        Image.new("RGB", (1024, 1024), "black").save(run / "output" / "done.png")
        return {"p": {"outputs": {"11": {"images": [{"filename": "done.png", "type": "output", "subfolder": ""}]}}}}
    monkeypatch.setattr(module, "_local_json", response)
    with pytest.raises(module.LocalComfyError, match="teardown failed"):
        module.execute(repo, run)
    journal = json.loads((run / "journal.json").read_text())
    assert journal["status"] == "failed"
    assert journal["teardown"]["verified_stopped"] is False
    assert not (run / "receipt.json").exists()

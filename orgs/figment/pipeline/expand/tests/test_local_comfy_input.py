from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import time
import uuid
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


def stub_owned_execution(module, monkeypatch, process):
    """Keep execute tests focused on their transport/receipt condition, not Win32."""
    wrapper = module.ProcessIdentity(process.pid, 100, None)
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else None)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda got, _deadline, *_: {got.pid: got})
    monkeypatch.setattr(module, "_require_owned_listener", lambda got, known: {got.pid: got})
    def teardown(got, known, *_):
        process.returncode = 0
        return {"wrapper": got.record(), "owned_processes": [], "verified_stopped": True}
    monkeypatch.setattr(module, "_teardown", teardown)
    return wrapper


def cleanup_owned_fixture(module, root: Path) -> None:
    """Remove only this test's direct private child without following reparses."""
    if (root.parent != module.WORKSPACE_PRIVATE_ROOT or not root.name.startswith("figment-owned-loopback-fixture-")
            or module._is_reparse(root)):
        raise AssertionError("unsafe fixture cleanup root")
    for current, directories, filenames in os.walk(root, topdown=False, followlinks=False):
        directory = Path(current)
        if module._is_reparse(directory):
            raise AssertionError("fixture cleanup encountered reparse directory")
        for name in filenames:
            entry = directory / name
            if module._is_reparse(entry):
                raise AssertionError("fixture cleanup encountered reparse file")
            entry.unlink()
        for name in directories:
            entry = directory / name
            if module._is_reparse(entry):
                raise AssertionError("fixture cleanup encountered reparse child")
            entry.rmdir()
    root.rmdir()


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


def test_face_crop_plan_only_binds_helper_and_changes_only_loadimage(local):
    module, repo = local
    full = module.build_manifest(repo)
    crop = module.build_manifest(repo, module.FACE_CROP_CONDITIONING)
    assert crop["conditioning"]["name"] == module.FACE_CROP_CONDITIONING
    assert crop["conditioning"]["materialized"] is False
    assert crop["conditioning"]["derivative"] is None
    assert crop["conditioning"]["helper"]["sha256"] == module.sha256_file(
        MODULE_PATH.with_name("local_conditioning_crop.py"))
    normalized = json.loads(json.dumps(crop["workflow"]["api_prompt"]))
    normalized["2"]["inputs"]["image"] = "g01.jpg"
    assert normalized == full["workflow"]["api_prompt"]


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
    monkeypatch.setattr(module.subprocess, "Popen", lambda args, **kwargs: (calls.append((args, kwargs)) or Process()))
    process = Process()
    monkeypatch.setattr(module.subprocess, "Popen", lambda args, **kwargs: (calls.append((args, kwargs)) or process))
    stub_owned_execution(module, monkeypatch, process)
    monkeypatch.setattr(module, "_local_json", lambda *_a, **_k: (_ for _ in ()).throw(module.urllib.error.URLError("not-ready")))
    monkeypatch.setattr(module.time, "monotonic", iter((0, 601)).__next__)
    with pytest.raises(module.urllib.error.URLError):
        module.execute(repo, run)
    args, kwargs = calls[0]
    assert kwargs["shell"] is False and kwargs["cwd"] == module.COMFY_ROOT
    assert args[0] == str(module.COMFY_ROOT / "venv" / "Scripts" / "python.exe")
    assert kwargs["env"]["HF_HUB_OFFLINE"] == "1" and kwargs["env"]["PYTHONDONTWRITEBYTECODE"] == "1"
    assert kwargs["env"]["TORCH_HOME"].endswith("torch") and kwargs["env"]["TORCHINDUCTOR_CACHE_DIR"].endswith("inductor") and kwargs["env"]["XDG_CACHE_HOME"].endswith("xdg")
    assert kwargs["creationflags"] == getattr(module.subprocess, "CREATE_NO_WINDOW", 0)
    assert args[args.index("--listen") + 1] == "127.0.0.1"
    assert {"--input-directory", "--output-directory", "--temp-directory", "--user-directory", "--database-url", "--disable-api-nodes", "--disable-all-custom-nodes", "--disable-auto-launch"} <= set(args)
    assert args[args.index("--database-url") + 1].startswith("sqlite:///")
    assert args[args.index("--database-url") + 1].endswith("/user/comfyui.db")
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
    wrapper = module.ProcessIdentity(1234, 100, None)
    monkeypatch.setattr(module, "_listener_pid", lambda: 9876)
    monkeypatch.setattr(module, "_discover_owned_processes", lambda _wrapper, known: known)
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else None)
    monkeypatch.setattr(module.time, "monotonic", iter((0, 601)).__next__)
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    with pytest.raises(module.LocalComfyError, match="owned ComfyUI listener"):
        module._wait_for_owned_listener(wrapper, 600)


def test_listener_wait_keeps_discovered_descendant_before_readiness(local, monkeypatch):
    module, _ = local
    wrapper = module.ProcessIdentity(1234, 100, None)
    child = module.ProcessIdentity(2345, 101, 1234)
    seen = []
    def discover(_wrapper, known):
        seen.append(dict(known))
        return {wrapper.pid: wrapper, child.pid: child}
    monkeypatch.setattr(module, "_discover_owned_processes", discover)
    monkeypatch.setattr(module, "_listener_pid", lambda: None)
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else child if pid == child.pid else None)
    monkeypatch.setattr(module.time, "monotonic", iter((0, 1, 601)).__next__)
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    with pytest.raises(module.LocalComfyError, match="did not become ready"):
        module._wait_for_owned_listener(wrapper, 600)
    assert child.pid not in seen[0]
    assert child.pid in seen[1]


def test_predated_parent_pid_collision_is_ignored_as_foreign(local, monkeypatch):
    module, _ = local
    wrapper = module.ProcessIdentity(1234, 100, None)
    stale = module.ProcessIdentity(2345, 99, wrapper.pid)
    fresh = module.ProcessIdentity(3456, 101, wrapper.pid)
    monkeypatch.setattr(module, "_process_parents", lambda: {stale.pid: wrapper.pid, fresh.pid: wrapper.pid})
    def identity(pid, parent_pid=None):
        if pid == wrapper.pid:
            return wrapper
        if pid == stale.pid:
            return stale
        if pid == fresh.pid:
            return fresh
        return None
    monkeypatch.setattr(module, "_process_identity", identity)
    owned = module._discover_owned_processes(wrapper, {})
    assert owned == {wrapper.pid: wrapper, fresh.pid: fresh}
    monkeypatch.setattr(module, "_listener_pid", lambda: stale.pid)
    with pytest.raises(module.LocalComfyError, match="not owned"):
        module._require_owned_listener(wrapper, owned)


def test_execute_startup_failure_preserves_discovered_child_for_teardown(local, tmp_path, monkeypatch):
    module, repo = local
    run = tmp_path / "_private" / "figment-local-comfy-startup-child"; run.parent.mkdir()
    class Process:
        pid = 1234
    process = Process()
    wrapper = module.ProcessIdentity(process.pid, 100, None)
    child = module.ProcessIdentity(2345, 101, process.pid)
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    captured = {}
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    monkeypatch.setattr(module, "_bounded_stderr", lambda *_: (None, None))
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else child if pid == child.pid else None)
    def readiness(got, _deadline, known, record):
        known.update({got.pid: got, child.pid: child})
        record(known)
        raise module.LocalComfyError("owned ComfyUI process exited before listener readiness")
    monkeypatch.setattr(module, "_wait_for_owned_listener", readiness)
    def teardown(got, known, *_):
        captured.update({"wrapper": got, "known": dict(known)})
        return {"wrapper": got.record(), "owned_processes": [], "verified_stopped": True}
    monkeypatch.setattr(module, "_teardown", teardown)
    with pytest.raises(module.LocalComfyError, match="exited before listener"):
        module.execute(repo, run)
    assert captured["wrapper"] == wrapper
    assert captured["known"] == {wrapper.pid: wrapper, child.pid: child}
    journal = json.loads((run / "journal.json").read_text())
    assert child.record() in journal["owned_processes"]


def test_execute_refuses_uninspectable_descendant_and_tears_down_known_wrapper(local, tmp_path, monkeypatch):
    module, repo = local
    run = tmp_path / "_private" / "figment-local-comfy-uninspectable-child"; run.parent.mkdir()
    class Process:
        pid = 1234
    process = Process()
    wrapper = module.ProcessIdentity(process.pid, 100, None)
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    captured = {}
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    monkeypatch.setattr(module, "_bounded_stderr", lambda *_: (None, None))
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else None)
    monkeypatch.setattr(module, "_discover_owned_processes", lambda *_:
                        (_ for _ in ()).throw(module.LocalComfyError("cannot inspect owned process identity")))
    def teardown(got, known, *_):
        captured.update({"wrapper": got, "known": dict(known)})
        return {"wrapper": got.record(), "owned_processes": [], "discovery_error": "LocalComfyError",
                "verified_stopped": False}
    monkeypatch.setattr(module, "_teardown", teardown)
    with pytest.raises(module.LocalComfyError, match="cannot inspect owned process identity"):
        module.execute(repo, run)
    assert captured == {"wrapper": wrapper, "known": {wrapper.pid: wrapper}}
    journal = json.loads((run / "journal.json").read_text())
    assert journal["status"] == "failed" and journal["teardown"]["verified_stopped"] is False


def test_teardown_allows_naturally_exited_wrapper_when_all_retained_identities_are_absent(local, monkeypatch):
    module, _ = local
    wrapper = module.ProcessIdentity(1234, 100, None)
    child = module.ProcessIdentity(2345, 101, wrapper.pid)
    monkeypatch.setattr(module, "_discover_owned_processes", lambda *_:
                        (_ for _ in ()).throw(module.LocalComfyError("wrapper exited")))
    monkeypatch.setattr(module, "_process_identity", lambda *_: None)
    monkeypatch.setattr(module, "_process_parents", lambda: {})
    monkeypatch.setattr(module, "_terminate_identity", lambda identity:
                        {**identity.record(), "state": "already-exited"})
    teardown = module._teardown(wrapper, {wrapper.pid: wrapper, child.pid: child}, object())
    assert teardown["verified_stopped"] is True
    assert teardown["discovery_error"] == "LocalComfyError"


def test_new_unreadable_descendant_is_preserved_in_unverified_teardown_record(local, monkeypatch):
    module, _ = local
    wrapper = module.ProcessIdentity(1234, 100, None)
    new_child_pid = 2345
    def refuse_discovery(_wrapper, _tracked):
        error = module.LocalComfyError("cannot inspect owned process identity")
        error.unreadable_pid = new_child_pid
        raise error
    monkeypatch.setattr(module, "_discover_owned_processes", refuse_discovery)
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else None)
    monkeypatch.setattr(module, "_process_parents", lambda: {})
    monkeypatch.setattr(module, "_terminate_held_wrapper", lambda _process, identity:
                        {**identity.record(), "state": "terminated"})
    teardown = module._teardown(wrapper, {wrapper.pid: wrapper}, object())
    assert teardown["verified_stopped"] is False
    assert teardown["unresolved_processes"] == [{"pid": new_child_pid, "error_class": "LocalComfyError"}]


def test_naturally_exited_wrapper_does_not_override_new_unreadable_descendant(local, monkeypatch):
    module, _ = local
    wrapper = module.ProcessIdentity(1234, 100, None)
    error = module.LocalComfyError("cannot inspect owned process identity")
    error.unreadable_pid = 2345
    monkeypatch.setattr(module, "_discover_owned_processes", lambda *_: (_ for _ in ()).throw(error))
    monkeypatch.setattr(module, "_process_identity", lambda *_: None)
    monkeypatch.setattr(module, "_process_parents", lambda: {})
    monkeypatch.setattr(module, "_terminate_identity", lambda identity:
                        {**identity.record(), "state": "already-exited"})
    teardown = module._teardown(wrapper, {wrapper.pid: wrapper}, object())
    assert teardown["verified_stopped"] is False
    assert teardown["unresolved_processes"] == [{"pid": 2345, "error_class": "LocalComfyError"}]


def test_naturally_exited_wrapper_does_not_override_parent_snapshot_failure(local, monkeypatch):
    module, _ = local
    wrapper = module.ProcessIdentity(1234, 100, None)
    monkeypatch.setattr(module, "_discover_owned_processes", lambda *_:
                        (_ for _ in ()).throw(module.LocalComfyError("wrapper exited")))
    monkeypatch.setattr(module, "_process_identity", lambda *_: None)
    monkeypatch.setattr(module, "_process_parents", lambda:
                        (_ for _ in ()).throw(module.LocalComfyError("snapshot unavailable")))
    monkeypatch.setattr(module, "_terminate_identity", lambda identity:
                        {**identity.record(), "state": "already-exited"})
    teardown = module._teardown(wrapper, {wrapper.pid: wrapper}, object())
    assert teardown["verified_stopped"] is False
    assert teardown["parent_snapshot_error"] is True


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
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    stub_owned_execution(module, monkeypatch, process)
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
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    stub_owned_execution(module, monkeypatch, process)
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
    assert saved["teardown"]["wrapper"] == {"pid": 1234, "creation_filetime": 100, "parent_pid": None}
    assert (run / "manifest.json").is_file()


def test_crop_execute_materializes_only_owned_input_and_binds_derivative(local, tmp_path, monkeypatch):
    module, repo = local
    from PIL import Image
    source = repo / module.CANONICAL
    Image.new("RGB", (1408, 768), "navy").save(source, format="JPEG")
    monkeypatch.setattr(module, "CANONICAL_SHA256", module.sha256_file(source))
    run = tmp_path / "_private" / "figment-local-comfy-crop"; run.parent.mkdir()
    class Process:
        pid = 1234
        returncode = None
        def poll(self): return self.returncode
    process = Process()
    test_python = module.COMFY_ROOT / "venv" / "Scripts" / "python.exe"
    test_python.parent.mkdir(parents=True); test_python.write_bytes(b"python")
    monkeypatch.setattr(module, "COMFY_PYTHON", test_python)
    monkeypatch.setattr(module, "_port_available", lambda: None)
    monkeypatch.setattr(module, "_workspace_private_root", lambda _: run.parent)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    stub_owned_execution(module, monkeypatch, process)
    verified_helper = module._crop_helper()
    changed_helper = type("ChangedHelper", (), {"CROP_NAME": "changed-after-check.png"})()
    helpers = iter((verified_helper, verified_helper, changed_helper))
    monkeypatch.setattr(module, "_crop_helper", lambda: next(helpers))
    def response(_opener, method, _endpoint, _payload=None):
        if method == "POST": return {"prompt_id": "p"}
        Image.new("RGB", (1024, 1024), "black").save(run / "output" / "done.png")
        return {"p": {"outputs": {"11": {"images": [{"filename": "done.png", "type": "output", "subfolder": ""}]}}}}
    monkeypatch.setattr(module, "_local_json", response)
    receipt = module.execute(repo, run, module.FACE_CROP_CONDITIONING)
    manifest = json.loads((run / "manifest.json").read_text())
    derivative = manifest["conditioning"]["derivative"]
    assert receipt["status"] == "completed"
    assert manifest["conditioning"]["materialized"] is True
    assert manifest["workflow"]["api_prompt"]["2"]["inputs"]["image"] == "g01-face384-crop-v1.png"
    assert derivative["sha256"] == module.sha256_file(run / "input" / derivative["filename"])
    assert manifest["conditioning"]["crop_provenance"]["derivation"]["pillow_version"]
    assert manifest["conditioning"]["crop_provenance"]["derivation"]["png_encoder"] == {
        "format": "PNG", "optimize": False, "compress_level": 9}
    assert not (run / "g01-face384-crop-v1.png").exists()


def test_wait_terminated_handle_tolerates_transient_metadata_reopen_error(local, monkeypatch):
    module, _repo = local
    identity = module.ProcessIdentity(1234, 100, None)
    monkeypatch.setattr(module, "_process_identity", lambda *_:
                        (_ for _ in ()).throw(module.LocalComfyError("metadata reopen denied")))
    assert module._wait_terminated_record(identity)["state"] == "terminated-wait-verified"


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
    monkeypatch.setattr(module, "_listener_pid", lambda: 9999)
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    wrapper = module.ProcessIdentity(process.pid, 100, None)
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else None)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda got, _deadline, *_: {got.pid: got})
    monkeypatch.setattr(module, "_require_owned_listener", lambda *_: (_ for _ in ()).throw(module.LocalComfyError("local listener is not owned by this ComfyUI process")))
    monkeypatch.setattr(module, "_teardown", lambda got, known, *_: (setattr(process, "returncode", 0) or {"wrapper": got.record(), "owned_processes": [], "verified_stopped": True}))
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
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    stub_owned_execution(module, monkeypatch, process)
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
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: Process())
    process = Process()
    monkeypatch.setattr(module.subprocess, "Popen", lambda *_a, **_k: process)
    wrapper = module.ProcessIdentity(process.pid, 100, None)
    monkeypatch.setattr(module, "_process_identity", lambda pid, parent_pid=None:
                        wrapper if pid == wrapper.pid else None)
    monkeypatch.setattr(module, "_wait_for_owned_listener", lambda got, _deadline, *_: {got.pid: got})
    monkeypatch.setattr(module, "_require_owned_listener", lambda got, known: {got.pid: got})
    monkeypatch.setattr(module, "_teardown", lambda *_: (_ for _ in ()).throw(module.LocalComfyError("teardown failed")))
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


@pytest.mark.skipif(os.name != "nt", reason="Toolhelp process identity tracking is Windows-only")
def test_real_venv_redirector_tracks_listener_and_tears_down_all_owned_processes(monkeypatch):
    """Exercise the real venv redirector, without starting ComfyUI or submitting a job."""
    module = load_module()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    monkeypatch.setattr(module, "PORT", port)
    root = module.WORKSPACE_PRIVATE_ROOT / f"figment-owned-loopback-fixture-{uuid.uuid4().hex}"
    root.mkdir()
    for name in ("temp", "user", "home"):
        (root / name).mkdir()
    server = root / "tiny_loopback.py"
    server.write_text(
        "from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\n"
        "import json, sys\n"
        "class Handler(BaseHTTPRequestHandler):\n"
        "    def do_GET(self):\n"
        "        body = b'{\\\"ok\\\":true}'\n"
        "        self.send_response(200)\n"
        "        self.send_header('Content-Type', 'application/json')\n"
        "        self.send_header('Content-Length', str(len(body)))\n"
        "        self.end_headers()\n"
        "        self.wfile.write(body)\n"
        "    def log_message(self, *args): pass\n"
        "ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()\n",
        encoding="utf-8",
    )
    process = None
    wrapper = None
    owned = {}
    cleaned = False
    try:
        process = subprocess.Popen([str(module.COMFY_PYTHON), str(server), str(port)], shell=False,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env=module._isolated_environment(root),
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + 60
        while wrapper is None and time.monotonic() < deadline:
            wrapper = module._process_identity(process.pid)
            time.sleep(0.05)
        assert wrapper is not None
        owned = module._wait_for_owned_listener(wrapper, deadline)
        listener = module._listener_pid()
        assert listener is not None and listener in owned
        assert listener != wrapper.pid, "fixture must exercise the venv redirector child"
        assert module._local_json(module._loopback_opener(), "GET", "/health") == {"ok": True}
        teardown = module._teardown(wrapper, owned, process)
        assert teardown["verified_stopped"] is True, teardown
        assert all(module._process_identity(item["pid"], item["parent_pid"]) is None
                   for item in teardown["owned_processes"])
        assert module._listener_pid() is None
        process = None
        cleaned = True
    finally:
        if process is not None and wrapper is not None:
            module._teardown(wrapper, owned, process)
        elif process is not None:
            process.terminate()
            process.wait(timeout=15)
        if cleaned:
            cleanup_owned_fixture(module, root)


@pytest.mark.skipif(os.name != "nt", reason="Toolhelp process identity tracking is Windows-only")
def test_real_listener_discovery_refusal_stops_known_identities_and_marks_unverified(monkeypatch):
    """Inject a discovery inspection refusal after a real redirector owns the listener."""
    module = load_module()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    monkeypatch.setattr(module, "PORT", port)
    root = module.WORKSPACE_PRIVATE_ROOT / f"figment-owned-loopback-fixture-{uuid.uuid4().hex}"
    root.mkdir()
    for name in ("temp", "user", "home"):
        (root / name).mkdir()
    server = root / "tiny_loopback.py"
    server.write_text(
        "from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer\n"
        "import sys\n"
        "class Handler(BaseHTTPRequestHandler):\n"
        "    def do_GET(self):\n"
        "        body = b'{\\\"ok\\\":true}'\n"
        "        self.send_response(200); self.send_header('Content-Length', str(len(body)))\n"
        "        self.end_headers(); self.wfile.write(body)\n"
        "    def log_message(self, *args): pass\n"
        "ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()\n",
        encoding="utf-8",
    )
    process = None
    wrapper = None
    owned = {}
    cleaned = False
    try:
        process = subprocess.Popen([str(module.COMFY_PYTHON), str(server), str(port)], shell=False,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                   env=module._isolated_environment(root),
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + 60
        while wrapper is None and time.monotonic() < deadline:
            wrapper = module._process_identity(process.pid)
            time.sleep(0.05)
        assert wrapper is not None
        owned = module._wait_for_owned_listener(wrapper, deadline)
        listener = module._listener_pid()
        assert listener is not None and listener in owned
        denial = module.LocalComfyError("cannot inspect owned process identity")
        denial.unreadable_pid = listener
        monkeypatch.setattr(module, "_discover_owned_processes", lambda *_: (_ for _ in ()).throw(denial))
        teardown = module._teardown(wrapper, owned, process)
        assert teardown["verified_stopped"] is False
        assert teardown["discovery_error"] == "LocalComfyError"
        assert teardown["unresolved_processes"] == [{"pid": listener, "error_class": "LocalComfyError"}]
        assert all(module._process_identity(item["pid"], item["parent_pid"]) is None
                   for item in teardown["owned_processes"])
        cleanup = module._terminate_identity(owned[listener])
        assert cleanup["state"] in {"terminated", "already-exited"}
        assert module._listener_pid() is None
        process = None
        cleaned = True
    finally:
        if process is not None and wrapper is not None:
            module._teardown(wrapper, owned, process)
        elif process is not None:
            process.terminate()
            process.wait(timeout=15)
        if cleaned:
            cleanup_owned_fixture(module, root)

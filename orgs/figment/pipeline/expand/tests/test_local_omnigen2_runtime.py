"""Controller tests: bootstrap pin, decoder strictness, prelaunch preflight, and a fake two-row run on the shared engine."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
import sys
import time
import types
from pathlib import Path

import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo

HERE = Path(__file__).resolve().parent
EXPAND = HERE.parent
STUDIO = EXPAND.parents[3]


def _import(name: str, path: Path) -> types.ModuleType:
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runtime = _import("test_rt_runtime", EXPAND / "local_omnigen2_runtime.py")
admission = _import("test_rt_admission", EXPAND / "local_omnigen2_admission.py")
resources = _import("test_rt_resources", EXPAND / "local_omnigen2_resources.py")
engine = _import("test_rt_engine", STUDIO / "orgs/figment/pipeline/train/local_lora_pair_engine.py")

GIB = 1024 ** 3
GOOD_SAMPLE = {"available_ram_bytes": 20 * GIB, "commit_headroom_bytes": 40 * GIB, "owned_private_bytes": GIB, "gpu_used_mib": 100, "gpu_free_mib": 9000, "page_reads_per_sec": None, "page_reads_unavailable_reason": "counter-not-integrated"}
GRAPHS = {seed: {"3": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 20, "cfg": 2.5}}, "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "figment-local-omnigen2", "images": ["8", 0]}}} for seed in runtime.SEEDS}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _png(graph: dict, size: int = 768) -> bytes:
    info = PngInfo()
    info.add_text("prompt", json.dumps(graph))
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), (graph["3"]["inputs"]["seed"] % 255, 0, 0)).save(buffer, format="PNG", pnginfo=info)
    return buffer.getvalue()


class Identity:
    def __init__(self, pid: int) -> None:
        self.pid, self.parent_pid = pid, 1

    def record(self) -> dict:
        return {"pid": self.pid}


class FakeProcess:
    def __init__(self, *args, **kwargs) -> None:
        self.pid, self.stderr, self.args = 4242, io.BytesIO(b""), args

    def poll(self):
        return None

    def wait(self, timeout=None):
        return 0

    def terminate(self):
        pass


class FakeHelper:
    """Minimal immutable-helper stand-in; the engine only touches these names."""

    COMFY_PYTHON, COMFY_ROOT, PORT = Path("C:/fake/python.exe"), Path("C:/fake"), 8190

    def __init__(self, state: dict) -> None:
        self.state, self.output, self.calls, self.n = state, None, [], 0

    def _port_available(self):
        self.calls.append("port")

    def _isolated_environment(self, root):
        self.output = root / "output"
        return {}

    def _process_identity(self, pid, parent=None):
        return Identity(pid)

    def _wait_for_owned_listener(self, wrapper, deadline, tracked, on_discovery=None):
        return tracked

    def _require_owned_listener(self, wrapper, tracked):
        return tracked

    def _loopback_opener(self):
        return object()

    def _local_json(self, opener, method, endpoint, payload=None):
        self.calls.append((method, endpoint))
        if method == "POST":
            self.n += 1
            return {"prompt_id": f"p{self.n}"}
        prompt_id = endpoint.rsplit("/", 1)[1]
        seed = runtime.SEEDS[int(prompt_id[1:]) - 1]
        name = runtime.EXPECTED_FILENAMES[seed]
        (self.output / name).write_bytes(_png(GRAPHS[seed]))
        return {prompt_id: {"status": {"status_str": "success"}, "outputs": {"9": {"images": [{"filename": name, "subfolder": "", "type": "output"}]}}}}

    def _teardown(self, wrapper, tracked, process):
        self.calls.append("teardown")
        hook = self.state.get("on_teardown")
        if hook:
            hook()
        return {"wrapper": wrapper.record(), "owned_processes": [wrapper.record()], "verified_stopped": True}

    _kernel32 = _identity_from_handle = staticmethod(lambda *a: None)


class FakeSampler:
    def __init__(self, helper, sample=None):
        self.sample = sample or GOOD_SAMPLE

    def __call__(self, owned):
        return dict(self.sample)


class FakeAdmission:
    def __init__(self, real, tmp: Path, evidence: dict) -> None:
        self._real, self.evidence = real, evidence
        self.RUN_ROOT, self.MODELS_ROOT, self.REFERENCE_PATH, self.STUDIO_PRIVATE = tmp / "run", tmp / "models", tmp / "studio" / "g01.jpg", tmp / "private"
        self.fresh = copy.deepcopy(evidence)

    def __getattr__(self, name):
        return getattr(self._real, name)

    def validate_admission(self):
        return {"admission_id": "adm", "admission_sha256": "a" * 64, "admission_file_sha256": "b" * 64, "admission_file_bytes": 10, "canonical_sha256": "c" * 64, "evidence": copy.deepcopy(self.evidence)}

    def build_evidence(self):
        return copy.deepcopy(self.fresh)


@pytest.fixture
def world(tmp_path, monkeypatch):
    (tmp_path / "studio").mkdir(), (tmp_path / "private").mkdir(), (tmp_path / "models").mkdir()
    reference = tmp_path / "studio" / "g01.jpg"
    reference.write_bytes(b"\xff\xd8fake-jpeg-bytes\xff\xd9")
    evidence = {"schema": "figment/local-omnigen2-evidence@1", "run_root": str(tmp_path / "run"), "manifest": {"runs": [{"seed": s, "graph": GRAPHS[s], "graph_sha256": _sha(admission.canonical(GRAPHS[s]))} for s in runtime.SEEDS]}, "reference": {"filename": "g01.jpg", "bytes": reference.stat().st_size, "sha256": _sha(reference.read_bytes())}, "models": {"vae": {"sha256": "d" * 64}}, "code": {rel: {"sha256": "e" * 64, "bytes": 1} for rel in (runtime.ADMISSION_REL, runtime.RUNTIME_REL, runtime.RESOURCES_REL, runtime.HELPER_REL, runtime.ENGINE_REL)}, "bounds": dict(admission.BOUNDS)}
    evidence["manifest"]["manifest_sha256"] = _sha(admission.canonical(evidence["manifest"]))
    fake = FakeAdmission(admission, tmp_path, evidence)
    state: dict = {}
    helper = FakeHelper(state)
    monkeypatch.setattr(runtime, "STUDIO", tmp_path / "studio")
    monkeypatch.setattr(runtime, "MAIN_PRIVATE", tmp_path)
    monkeypatch.setattr(runtime, "_load_admission", lambda: fake)
    monkeypatch.setattr(runtime, "_load_checked", lambda rel, sha: {runtime.ENGINE_REL: engine, runtime.RESOURCES_REL: resources, runtime.HELPER_REL: helper}[rel])
    monkeypatch.setattr(resources, "WindowsSampler", FakeSampler)
    monkeypatch.setattr(engine.subprocess, "Popen", FakeProcess)
    return types.SimpleNamespace(tmp=tmp_path, admission=fake, helper=helper, state=state, evidence=evidence)


def _controller(world):
    return runtime.Controller(world.admission, engine, resources, world.helper, world.admission.validate_admission())


# ----- bootstrap ------------------------------------------------------------
def test_unreviewed_bootstrap_blocks_before_any_load(monkeypatch):
    monkeypatch.setattr(runtime, "ADMISSION_SHA256", "UNREVIEWED")
    with pytest.raises(runtime.RuntimeControllerError, match="no reviewed hash"):
        runtime.execute()


def test_mismatched_bootstrap_blocks(monkeypatch):
    monkeypatch.setattr(runtime, "ADMISSION_SHA256", "0" * 64)
    with pytest.raises(runtime.RuntimeControllerError, match="hash mismatch"):
        runtime.execute()
    assert f"{runtime._MODULE_PREFIX}.local_omnigen2_admission" not in sys.modules


def test_load_checked_accepts_exact_hash():
    data = (EXPAND / "local_omnigen2_resources.py").read_bytes()
    module = runtime._load_checked(runtime.RESOURCES_REL, _sha(data))
    assert module.PREFLIGHT_RAM_BYTES == 12 * GIB and module.__file__.endswith("local_omnigen2_resources.py")


# ----- decoder --------------------------------------------------------------
def _history(name, node="9", pid="p1"):
    return {pid: {"status": {"status_str": "success"}, "outputs": {node: {"images": [{"filename": name, "subfolder": "", "type": "output"}]}}}}


@pytest.fixture
def decoder(world):
    controller = _controller(world)
    controller.bind_prompt(runtime.SEEDS[0], {"prompt_id": "p1"}, time.monotonic())
    output = world.tmp / "out"
    output.mkdir()
    return controller, output


def test_decoder_accepts_exact_png(decoder):
    controller, output = decoder
    name = runtime.EXPECTED_FILENAMES[runtime.SEEDS[0]]
    (output / name).write_bytes(_png(GRAPHS[runtime.SEEDS[0]]))
    result = controller.completed_output(_history(name), "p1", output)
    assert result["filename"] == name and result["dimensions"] == [768, 768] and result["verified_graph_sha256"] == controller.rows[0]["graph_sha256"]
    assert controller.metadata["rows"][str(runtime.SEEDS[0])]["elapsed_seconds"] >= 0


def test_decoder_pending_and_missing_return_none(decoder):
    controller, output = decoder
    assert controller.completed_output({}, "p1", output) is None
    assert controller.completed_output(_history(runtime.EXPECTED_FILENAMES[runtime.SEEDS[0]]), "p1", output) is None
    with pytest.raises(runtime.RuntimeControllerError, match="never bound"):
        controller.completed_output({}, "zz", output)


@pytest.mark.parametrize("case", ["wrong-seed", "other-node", "size", "escape", "float", "bool", "error"])
def test_decoder_rejects_tampering(decoder, case):
    controller, output = decoder
    seed = runtime.SEEDS[0]
    name = runtime.EXPECTED_FILENAMES[seed]
    history, graph, size = _history(name), copy.deepcopy(GRAPHS[seed]), 768
    if case == "wrong-seed":
        history = _history(runtime.EXPECTED_FILENAMES[runtime.SEEDS[1]])
        name = runtime.EXPECTED_FILENAMES[runtime.SEEDS[1]]
    elif case == "other-node":
        history = _history(name, node="11")
    elif case == "size":
        size = 1024
    elif case == "escape":
        history = _history("../" + name)
    elif case == "float":
        graph["3"]["inputs"]["steps"] = 20.0
    elif case == "bool":
        graph["3"]["inputs"]["cfg"] = True
    elif case == "error":
        history["p1"]["status"] = {"status_str": "error"}
    (output / name).write_bytes(_png(graph, size))
    with pytest.raises(runtime.RuntimeControllerError):
        controller.completed_output(history, "p1", output)


def test_dispatch_binding_enforces_row_order(world):
    controller = _controller(world)
    with pytest.raises(runtime.RuntimeControllerError, match="next admitted row"):
        controller.bind_dispatch({"prompt": GRAPHS[runtime.SEEDS[1]]})
    assert controller.bind_dispatch({"prompt": GRAPHS[runtime.SEEDS[0]]}) == runtime.SEEDS[0]


# ----- full fake run ------------------------------------------------------------
def test_full_two_row_run_on_shared_engine(world):
    receipt = runtime.execute()
    root = world.tmp / "run"
    assert receipt["status"] == "complete" and (root / "receipt.json").exists()
    assert [r["output"]["filename"] for r in receipt["rows"]] == [runtime.EXPECTED_FILENAMES[s] for s in runtime.SEEDS]
    assert len({r["output"]["sha256"] for r in receipt["rows"]}) == 2
    assert (root / "input" / "g01.jpg").read_bytes() == world.admission.REFERENCE_PATH.read_bytes() and list(p.name for p in (root / "input").iterdir()) == ["g01.jpg"]
    run = receipt["resource_observer"]["runtime"]
    assert run["preflight"]["ok"] is True and run["teardown"]["within_30s_acceptance"] is True
    assert set(run["rows"]) == {str(s) for s in runtime.SEEDS} and all(r["elapsed_seconds"] is not None for r in run["rows"].values())
    assert receipt["teardown"]["verified_stopped"] is True and "elapsed_seconds" in receipt["teardown"]
    assert world.helper.calls.count("teardown") == 1 and world.helper.calls[0] == "port"
    assert receipt["inputs"]["admission_id"] == "adm" and not any("elapsed" in k for k in json.dumps(receipt["inputs"]).split('"'))
    assert receipt["inputs"]["runtime_bounds"]["deadline_seconds"] == 6000.0
    assert receipt["inputs"]["manifest_sha256"] == world.evidence["manifest"]["manifest_sha256"]
    assert receipt["inputs"]["manifest_record_sha256"] == _sha(admission.canonical(world.evidence["manifest"]))
    assert receipt["inputs"]["manifest_sha256"] != receipt["inputs"]["manifest_record_sha256"]


def test_preflight_failure_prevents_launch(world, monkeypatch):
    low = {**GOOD_SAMPLE, "available_ram_bytes": 4 * GIB}
    monkeypatch.setattr(resources, "WindowsSampler", lambda helper: FakeSampler(helper, low))
    launched = []
    monkeypatch.setattr(engine.subprocess, "Popen", lambda *a, **k: launched.append(a) or FakeProcess())
    with pytest.raises(resources.ResourceError, match="RAM below floor"):
        runtime.execute()
    assert launched == [] and (world.tmp / "run" / "failure.json").exists() and world.helper.calls == ["port"]


def test_late_code_change_fails_with_failure_json(world):
    world.state["on_teardown"] = lambda: world.admission.fresh["code"].__setitem__(runtime.RUNTIME_REL, {"sha256": "f" * 64, "bytes": 2})
    with pytest.raises(admission.AdmissionError, match="does not match"):
        runtime.execute()
    failure = json.loads((world.tmp / "run" / "failure.json").read_text())
    assert failure["status"] == "failed" and failure["teardown"]["verified_stopped"] is True and len(failure["rows"]) == 2


def test_slow_teardown_preserves_verified_stop_but_fails(world, monkeypatch):
    offset = [0.0]
    real = time.monotonic
    monkeypatch.setattr(runtime.time, "monotonic", lambda: real() + offset[0])
    world.state["on_teardown"] = lambda: offset.__setitem__(0, 31.0)
    with pytest.raises(runtime.RuntimeControllerError, match="30 second"):
        runtime.execute()
    failure = json.loads((world.tmp / "run" / "failure.json").read_text())
    assert failure["teardown"]["verified_stopped"] is True and failure["teardown"]["elapsed_seconds"] >= 31
    assert failure["resource_observer"]["runtime"]["teardown"]["within_30s_acceptance"] is False


def test_default_cli_is_static(capsys):
    assert runtime.main([]) == 0
    assert json.loads(capsys.readouterr().out)["executing"] is False

"""Offline transport contracts; simulated bytes are not rendering evidence."""
import copy
import hashlib
import json
import logging
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runpod_run as rr
import test_runpod_run as legacy


def contract(companion=False):
    return {"schema": rr.OUTPUT_CONTRACT_SCHEMA, "outputs": [{
        "node_id": "49", "role": "video", "media_type": "video/mp4",
        "count": 1, "max_bytes": 1024, "workflow_png": companion,
    }]}


def history():
    return {"outputs": {"49": {"gifs": [{
        "filename": "clip.mp4", "subfolder": "run", "type": "output",
        "format": "video/h264-mp4", "workflow": "clip.png", "fullpath": "/ignored/private",
    }]}}}


@pytest.mark.parametrize("key,value", [
    ("count", True), ("count", 2), ("max_bytes", True), ("max_bytes", 0),
    ("max_bytes", rr.OUTPUT_VIDEO_CAP + 1), ("workflow_png", 1),
    ("role", "../video"), ("role", "video-workflow"), ("node_id", ""),
    ("media_type", "video/webm"), ("unknown", 1),
])
def test_closed_declarations(key, value):
    c = contract()
    c["outputs"][0][key] = value
    with pytest.raises(rr.HarnessError):
        rr.job_output_contract({"output_contract": c})


@pytest.mark.parametrize("key", ["expected_images", "expected_videos", "output_nodes"])
def test_rejects_competing_selectors(key):
    with pytest.raises(rr.HarnessError):
        rr.job_output_contract({"output_contract": contract(), key: 1})


def test_rejects_duplicate_and_unknown_schema():
    c = contract()
    c["outputs"] *= 2
    with pytest.raises(rr.HarnessError):
        rr.job_output_contract({"output_contract": c})
    c = contract()
    c["schema"] += "unknown"
    with pytest.raises(rr.HarnessError):
        rr.job_output_contract({"output_contract": c})


def test_vhs_companion_and_node_binding():
    records = rr.contract_history_outputs(history(), contract(True))
    assert [(r["node_id"], r["role"]) for r in records] == [("49", "video"), ("49", "video-workflow")]
    assert records[1]["companion_of"] == "video"
    assert records[1]["max_bytes"] == rr.OUTPUT_IMAGE_CAP
    assert records[0]["remote"] == {"filename": "clip.mp4", "subfolder": "run", "type": "output"}
    assert len(rr.contract_history_outputs(history(), contract(False))) == 1


def test_live_history_reader_keeps_declared_node_and_prompt():
    h = history()
    h["status"] = {"completed": True, "status_str": "success"}
    session = SimpleNamespace(get=lambda *a, **k: legacy.StubResponse(200, {"prompt-1": h}))
    rows = rr.ComfyClient("http://fixture", session=session).wait_outputs(
        "prompt-1", 5, WATCHDOG, output_contract=contract())
    assert rows[0]["node_id"] == "49"
    assert rows[0]["remote"]["filename"] == "clip.mp4"


def test_mp4_uses_existing_bounded_upload_route(tmp_path):
    local = tmp_path / "clip.mp4"
    payload = b"synthetic mp4 transport fixture"
    local.write_bytes(payload)
    m = legacy.manifest()
    m["uploads"] = [{"files": ["clip.mp4"], "subfolder": "video", "overwrite": False, "type": "input"}]
    expanded = rr.expand_manifest_uploads(m, tmp_path / "manifest.json")
    assert len(expanded) == 1
    assert expanded[0].local_path == local.resolve()
    assert expanded[0].remote_name == "clip.mp4"
    class Upload:
        headers = {}
        def post(self, url, **kwargs):
            assert url == "http://fixture/upload/image"
            filename, handle = kwargs["files"]["image"][:2]
            assert filename == "clip.mp4"
            assert handle.read() == payload
            return legacy.StubResponse(200, {"name": "clip.mp4", "subfolder": "video", "type": "input"})
    assert rr.ComfyClient("http://fixture", session=Upload()).upload_file(
        local, "video", False)["name"] == "clip.mp4"


@pytest.mark.parametrize("mutation", ["missing", "extra", "duplicate", "wrong-node", "wrong-format", "missing-workflow", "wrong-kind"])
def test_history_fails_closed(mutation):
    h = history()
    node = h["outputs"]["49"]
    if mutation == "missing": node["gifs"] = []
    if mutation == "extra": h["outputs"]["50"] = copy.deepcopy(node)
    if mutation == "duplicate": node["gifs"] *= 2
    if mutation == "wrong-node": h["outputs"]["50"] = h["outputs"].pop("49")
    if mutation == "wrong-format": node["gifs"][0]["format"] = "image/gif"
    if mutation == "missing-workflow": del node["gifs"][0]["workflow"]
    if mutation == "wrong-kind": node["images"] = [node["gifs"][0]]
    with pytest.raises(rr.HarnessError):
        rr.contract_history_outputs(h, contract(True))


@pytest.mark.parametrize("key,value", [
    ("filename", "../a.mp4"), ("filename", "a\\b.mp4"), ("filename", "C:a.mp4"),
    ("filename", "a.png"), ("filename", "a.mp4 "), ("filename", "a\x00.mp4"),
    ("subfolder", "../x"), ("subfolder", "/x"), ("subfolder", "a\\b"),
    ("type", "input"), ("type", "temp"),
])
def test_remote_paths_are_output_only(key, value):
    h = history()
    h["outputs"]["49"]["gifs"][0][key] = value
    with pytest.raises(rr.HarnessError):
        rr.contract_history_outputs(h, contract())


def test_image_roles_are_order_independent_and_case_collisions_rejected():
    c = contract()
    c["outputs"] = [{"node_id": n, "role": role, "media_type": "image/png", "count": 1,
                     "max_bytes": 1024, "workflow_png": False} for n, role in [("3", "base"), ("4", "enhanced")]]
    h = {"outputs": {"4": {"images": [{"filename": "b.png", "type": "output"}]},
                     "3": {"images": [{"filename": "a.png", "type": "output"}]}}}
    assert [r["role"] for r in rr.contract_history_outputs(h, c)] == ["base", "enhanced"]
    h["outputs"]["4"]["images"][0]["filename"] = "A.png"
    with pytest.raises(rr.HarnessError): rr.contract_history_outputs(h, c)


class Response:
    status_code = 200
    headers = {}
    closed = False
    def __init__(self, chunks=(b"clip",)):
        self.chunks = chunks
    def iter_content(self, chunk_size):
        yield from self.chunks
    def close(self): self.closed = True


def client(response):
    obj = object.__new__(rr.ComfyClient)
    obj.base_url = "http://fixture"
    obj.session = SimpleNamespace(get=lambda *a, **k: response)
    return obj


WATCHDOG = SimpleNamespace(check=lambda: None)


def test_streamed_download_and_hashed_role_receipt(tmp_path):
    response = Response()
    records = rr.contract_history_outputs(history(), contract())
    rows = rr.download_contract_outputs(client(response), records, tmp_path, "job", 5, WATCHDOG, "prompt-1")
    assert rows[0]["sha256"] == hashlib.sha256(b"clip").hexdigest()
    assert rows[0]["prompt_id"] == "prompt-1"
    assert rows[0]["path"] == "job--video.mp4"
    assert rows[0]["node_id"] == "49"
    assert response.closed


@pytest.mark.parametrize("mode", ["oversize", "empty", "length", "truncated", "http", "deadline"])
def test_download_failure_cleans_partial(tmp_path, mode):
    response = Response((b"a" * 1025,)) if mode == "oversize" else Response()
    if mode == "empty": response.chunks = ()
    if mode == "length": response.headers = {"Content-Length": "1025"}
    if mode == "truncated": response.headers = {"Content-Length": "5"}
    if mode == "http": response.status_code = 404
    deadline = time.monotonic() + (5 if mode != "deadline" else -1)
    record = rr.contract_history_outputs(history(), contract())[0]
    path = tmp_path / "clip.mp4"
    with pytest.raises(rr.HarnessError):
        client(response).download_contract_output(record, path, deadline, WATCHDOG)
    assert not path.exists()
    assert not path.with_suffix(".mp4.partial").exists()


def test_required_companion_http_failure_is_not_skipped(tmp_path):
    obj = client(Response())
    def get(url, *, params, **kwargs):
        response = Response()
        if params["filename"].endswith(".png"): response.status_code = 404
        return response
    obj.session.get = get
    with pytest.raises(rr.HarnessError, match="404"):
        rr.download_contract_outputs(obj, rr.contract_history_outputs(history(), contract(True)),
                                     tmp_path, "job", 5, WATCHDOG, "prompt-1")


def test_real_harness_dryrun_contract_and_legacy(tmp_path, monkeypatch):
    monkeypatch.setattr(rr, "requests", None)
    m = legacy.manifest()
    m["workflow"]["49"] = {"class_type": "VHS_VideoCombine", "inputs": {"filename_prefix": "old"}}
    m["jobs"][0]["output_contract"] = contract(True)
    m["jobs"].append({"seed": 43, "output_name": "legacy"})
    result = rr.run_harness(m, tmp_path / "m.yaml", tmp_path / "out", max_usd=1,
                            max_minutes=1, dry_run=True, logger=logging.getLogger("contract-test"),
                            ledger_dir=tmp_path / "ledger", allow_empty_ledger=True)
    assert result["termination_verified"]
    job = result["jobs"][0]
    assert len(job["files"]) == 2
    effective = rr.apply_job(m["workflow"], m["jobs"][0])
    assert job["effective_workflow_sha256"] == hashlib.sha256(json.dumps(effective, sort_keys=True,
        separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    assert result["jobs"][1]["files"][0]["path"] == "legacy.png"
    review = json.loads((tmp_path / "out" / "manifest.json").read_text())
    assert [row["path"] for row in review["images"]] == ["legacy.png"]
    assert b"dry-run simulated" in (tmp_path / "out" / job["files"][0]["path"]).read_bytes()


@pytest.mark.parametrize("format_value", ["video/mp4", "video/h265-mp4", "video/webm", None])
def test_source_vhs_format_is_not_a_mime_alias(format_value):
    h = history()
    h["outputs"]["49"]["gifs"][0]["format"] = format_value
    with pytest.raises(rr.HarnessError, match="video/h264-mp4"):
        rr.contract_history_outputs(h, contract())


@pytest.mark.parametrize("cancel", [False, True])
def test_slow_http_body_obeys_whole_deadline_and_watchdog(tmp_path, cancel):
    """Each byte arrives before idle timeout, but never fills a64KiB chunk."""
    disconnected = threading.Event()
    class SlowBody(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", "1000")
            self.end_headers()
            try:
                for _ in range(1000):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.02)
            except (OSError, ConnectionError):
                disconnected.set()
    server = ThreadingHTTPServer(("127.0.0.1", 0), SlowBody)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    path = tmp_path / "clip.mp4"
    started = time.monotonic()
    def check():
        if cancel and time.monotonic() - started > 0.1:
            raise rr.HarnessError("fixture watchdog cancelled")
    obj = rr.ComfyClient(f"http://127.0.0.1:{server.server_port}")
    try:
        with pytest.raises(rr.HarnessError, match="cancelled" if cancel else "deadline"):
            obj.download_contract_output(rr.contract_history_outputs(history(), contract())[0],
                path, started + (3 if cancel else 0.2), SimpleNamespace(check=check))
        assert time.monotonic() - started < 1.5
        assert disconnected.wait(2)
        assert not path.exists()
        assert not path.with_suffix(".mp4.partial").exists()
    finally:
        obj.close()
        server.shutdown()
        server.server_close()

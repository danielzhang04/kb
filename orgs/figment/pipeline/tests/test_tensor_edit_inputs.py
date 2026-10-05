"""Module07 input contracts, entirely synthetic; no rendered quality claims."""
import copy
import hashlib
import importlib.util
import json
import io
from pathlib import Path

import pytest
from PIL import Image

SPEC = importlib.util.spec_from_file_location("edit_inputs_test", Path(__file__).parents[1] / "tensor_edit.py")
edit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(edit)


def pin(path):
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


@pytest.fixture
def pair(tmp_path):
    base, identity = tmp_path / "BASE.png", tmp_path / "IDENTITY.png"
    Image.new("RGB", (48, 64), "navy").save(base)
    Image.new("RGB", (64, 48), "grey").save(identity)
    source = tmp_path / "identity-plan.json"
    source.write_text("{}", encoding="utf-8")
    text = "Preserve image1 scene; use image2 facial identity."
    request = {"schema": edit.REQUEST_SCHEMA, "creator": "creator-fixture",
        "job_type": "still-touch-up", "fixture": True, "base": pin(base),
        "identity": {"kind": "passport", "source_plan": str(source), "image_id": "passport-fixture"},
        "prompt": {"text": text, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                   "decided_by": "fixture", "decided_at": "2026-10-05T00:00:00Z"}}
    authority = {"fixture": True, "image": pin(identity)}
    def run(value=request, proof=authority):
        path = tmp_path / "request.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        return edit.read_request(path, "creator-fixture", resolve_identity=lambda *args: proof)
    return request, authority, run


def test_pair_roles_exact_prompt_and_frozen_hash(pair):
    request, authority, run = pair
    result = run()
    assert result["base"]["sha256"] == request["base"]["sha256"]
    assert result["identity"]["sha256"] == authority["image"]["sha256"]
    assert result["prompt"] == request["prompt"]
    assert result["input_sha256"] == edit.canonical_sha256({k:v for k,v in result.items() if k != "input_sha256"})


@pytest.mark.parametrize("change", ["base-bytes", "prompt", "job-type", "unknown", "live", "frame-on-touchup", "traversal"])
def test_request_mutations_refuse(pair, change):
    request, authority, run = pair
    bad = copy.deepcopy(request)
    if change == "base-bytes":
        Path(bad["base"]["path"]).write_bytes(b"changed")
    elif change == "prompt":
        bad["prompt"]["text"] += " changed"
    elif change == "job-type":
        bad["job_type"] = "other"
    elif change == "unknown":
        bad["ignored"] = True
    elif change == "live":
        bad["fixture"] = False
    elif change == "frame-on-touchup":
        bad["frame_source"] = {}
    else:
        bad["base"]["path"] = "../BASE.png"
    with pytest.raises(edit.EditInputError):
        run(bad)


def test_case_insensitive_upload_collision_refuses(pair, tmp_path):
    request, authority, run = pair
    other = tmp_path / "other"
    other.mkdir()
    image = other / "base.PNG"
    Image.new("RGB", (48,64), "red").save(image)
    with pytest.raises(edit.EditInputError, match="basenames"):
        run(request, {"fixture":True,"image":pin(image)})


def test_disguised_tiff_refuses(pair):
    request, authority, run = pair
    path = Path(request["base"]["path"])
    Image.new("RGB", (48,64)).save(path, format="TIFF")
    request["base"] = pin(path)
    with pytest.raises(edit.EditInputError, match="decoded"):
        run()


def test_exact_frame0_receipt_and_clip_binding(pair, tmp_path):
    request, authority, run = pair
    request["job_type"] = "start-frame-head-swap"
    clip = tmp_path / "fixture.mp4"
    clip.write_bytes(b"synthetic clip fixture, no video quality proof")
    clip_record = {**pin(clip), "bytes":clip.stat().st_size}
    receipt = {"schema":edit._PATHS.SCHEMA,"video_before":clip_record,"video_after":clip_record,
        "frames":[{**request["base"],"bytes":Path(request["base"]["path"]).stat().st_size,"label":"first","index":0}]}
    receipt_path = tmp_path / "frame-extraction.json"
    receipt_path.write_text(json.dumps(receipt))
    request["frame_source"] = {"clip":pin(clip),"extraction_receipt":pin(receipt_path),"frame_index":0}
    result = run()
    assert result["frame_source"]["frame_index"] == 0
    request["frame_source"]["frame_index"] = True
    with pytest.raises(edit.EditInputError, match="frame0"):
        run()
    request["frame_source"]["frame_index"] = 0
    clip.write_bytes(b"changed clip")
    with pytest.raises(edit.EditInputError, match="hash"):
        run()


def test_missing_identity_approval_is_not_replaced_by_input_hash(pair, tmp_path):
    request, _, _ = pair
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request))
    def refuse(*args):
        raise edit.EditInputError("original approval unavailable")
    with pytest.raises(edit.EditInputError, match="approval unavailable"):
        edit.read_request(path, request["creator"], resolve_identity=refuse)


@pytest.mark.parametrize("value", ["x", "2026-10-05", "2026-10-05T00:00:00"])
def test_prompt_decision_requires_timezone(pair, value):
    request, _, run = pair
    request["prompt"]["decided_at"] = value
    with pytest.raises(edit.EditInputError, match="timezone"):
        run()


def test_growth_after_stat_remains_bounded(pair, tmp_path, monkeypatch):
    request, proof, _ = pair
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request))
    original = Path.open
    amounts = []
    class GrowingFile(io.BytesIO):
        def read(self, size=-1):
            amounts.append(size)
            return super().read(size)
    def opened(self, *args, **kwargs):
        if self == path and args and args[0] == "rb":
            return GrowingFile(b"x" * (edit.MAX_JSON_BYTES + 500))
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Path, "open", opened)
    with pytest.raises(edit.EditInputError, match="oversized"):
        edit.read_request(path, request["creator"], resolve_identity=lambda *a:proof)
    assert amounts == [edit.MAX_JSON_BYTES + 1]


@pytest.mark.parametrize("raw", [b"[]", b'{"schema":1,"schema":2}'])
def test_json_objects_reject_duplicate_keys_and_lists(tmp_path, raw):
    path = tmp_path / "bad.json"
    path.write_bytes(raw)
    with pytest.raises(edit.EditInputError, match="object|duplicate"):
        edit.read_request(path, "creator-fixture", resolve_identity=lambda *a:None)

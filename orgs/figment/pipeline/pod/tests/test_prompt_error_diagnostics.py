from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


POD_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(POD_DIR))

import runpod_run as rr  # noqa: E402


class Response:
    def __init__(self, status_code: int, content: bytes):
        self.status_code = status_code
        self.content = content

    def json(self):
        return json.loads(self.content)


class Session:
    headers: dict[str, str] = {}

    def __init__(self, response: Response):
        self.response = response

    def post(self, _url, **_kwargs):
        return self.response


def client(status: int, body: object) -> rr.ComfyClient:
    content = body if isinstance(body, bytes) else json.dumps(body).encode()
    return rr.ComfyClient("http://comfy", session=Session(Response(status, content)))


def test_http_400_reports_only_known_code_and_submitted_class():
    body = {
        "error": {"type": "prompt_outputs_failed_validation", "message": "secret-top"},
        "node_errors": {
            "17": {
                "class_type": "AttackerClass",
                "errors": [{
                    "type": "required_input_missing",
                    "message": "secret-message",
                    "details": "secret-details",
                    "extra_info": {"input_name": "resolution_steps", "value": "secret-value"},
                }],
            },
        },
        "credentials": "secret-credential",
    }
    workflow = {"17": {"class_type": "WanVideoSampler", "inputs": {}}}

    with pytest.raises(rr.HarnessError) as caught:
        client(400, body).submit(workflow)

    message = str(caught.value)
    assert message.startswith("ComfyUI POST /prompt returned HTTP 400 diagnostic=")
    assert '"node_id":"17"' in message
    assert '"class_type":"WanVideoSampler"' in message
    assert '"error_types":["required_input_missing"]' in message
    for secret in ("secret-top", "secret-message", "secret-details", "secret-value",
                   "secret-credential", "AttackerClass", "resolution_steps"):
        assert secret not in message


@pytest.mark.parametrize(
    "body",
    [b"{malformed", b"x" * (64 * 1024 + 1), b"[" * 1500 + b"0" + b"]" * 1500],
    ids=["malformed", "oversized", "deeply-nested"],
)
def test_unusable_body_uses_status_only(body):
    with pytest.raises(rr.HarnessError) as caught:
        client(400, body).submit({"17": {"class_type": "Known", "inputs": {}}})

    assert str(caught.value) == "ComfyUI POST /prompt returned HTTP 400"


def test_unknown_nodes_and_types_are_ignored_and_node_count_is_capped():
    workflow = {
        str(index): {"class_type": f"Class{index}", "inputs": {}}
        for index in range(12)
    }
    node_errors = {
        str(index): {"errors": [{"type": "invalid_input_type"}]}
        for index in range(12)
    }
    node_errors["unknown-node"] = {"errors": [{"type": "required_input_missing"}]}
    node_errors["0"]["errors"].append({"type": "unknown_secret_type"})

    with pytest.raises(rr.HarnessError) as caught:
        client(400, {"node_errors": node_errors}).submit(workflow)

    diagnostic = json.loads(str(caught.value).split(" diagnostic=", 1)[1])
    assert len(diagnostic["node_errors"]) == 8
    assert all(node["node_id"] in workflow for node in diagnostic["node_errors"])
    assert "unknown-node" not in str(caught.value)
    assert "unknown_secret_type" not in str(caught.value)
    assert len(str(caught.value).split(" diagnostic=", 1)[1]) <= 1024


def test_success_returns_same_prompt_id():
    assert client(200, {"prompt_id": "prompt-7"}).submit({}) == "prompt-7"

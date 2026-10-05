"""Offline module08 source parity and immutable dependency inventory.

Public metadata was checked 2026-10-05 (exact LFS/HEAD receipts in the session
phase4-pin-evidence.json). No successful model execution or installed-runtime
compatibility is implied by graph parity or these source-verified pins.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent / "research/10sorlabs-package/08_motion_control"
VIDEO_GRAPH = PACKAGE / "10sorlabs_motion_control.json"
VIDEO_GRAPH_SHA256 = "1241dbe6572fdd4d77350a4bb748f9bf704eebe7a47e4af6e247f9fad8a2fc2a"
VIDEO_INSTALLER_SHA256 = "3e423bc32ec0db0c3303d3e9cb975623e759c2564eada97213dba87831c0e9dc"
VIDEO_WORKFLOW = HERE / "video/tensor_video_m08_api.json"
VIDEO_RUNTIME_COMMIT = "135abed8da169e33ab0b86550e05e3ae55d6df8c"
VIDEO_RUNTIME_SOURCE_URL = "https://github.com/Comfy-Org/ComfyUI"
VIDEO_RUNTIME_TARBALL_URL = "https://codeload.github.com/Comfy-Org/ComfyUI/tar.gz/" + VIDEO_RUNTIME_COMMIT
VIDEO_VHS_COMMIT = "a7ce59e381934733bfae03b1be029756d6ce936d"
VIDEO_MAX_BYTES = 512 * 1024 * 1024
# Flat dotted DynamicCombo inputs are expanded by this exact core's _io.py and
# execution.py before ResizeImageMaskNode.execute receives its nested argument.
VIDEO_DYNAMIC_SCHEMA_STATUS = "source-verified flat dotted fields at " + VIDEO_RUNTIME_COMMIT + "; runtime execution unproved"
VIDEO_LEDGER = {
    "117,118": "UI mask previews; dependencies retained through output49",
    "123,124": "Disconnected notes",
    "49,113.videopreview": "Editor playback state, not API inputs",
    "58.upload": "Editor upload selector, not API input",
    "3.control_after_generate": "Fixed seed123, editor control flag omitted",
}


class ParityError(RuntimeError):
    """Required source evidence is missing, changed, or structurally unexpected."""


def _verified(path, digest):
    try:
        raw = Path(path).read_bytes()
    except OSError as exc:
        raise ParityError(f"module08 source unavailable: {path}") from exc
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ParityError(f"module08 source digest changed: {path}")
    return raw


def video_pin_group():
    """Fresh copies; caller cannot mutate the fixed public-metadata baseline."""
    return {
        "_note": "Exact module08 installer files; public immutable LFS/HEAD metadata verified2026-10-05. "
                 "SAM3.1 has SAM licence, not MIT/Apache. VHS a7 is output49 source revision; "
                 "both required class schemas match loader113's298 revision. Core v0.25.0 required "
                 "for SCAIL2 schema; external installer SAM3 clone is unused. Runtime smoke unproved.",
        "models": copy.deepcopy(VIDEO_MODEL_PINS),
        "custom_nodes": [{"name": "ComfyUI-VideoHelperSuite",
                          "git_url": "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git",
                          "git_ref": VIDEO_VHS_COMMIT, "licence": "GPL-3.0"}],
    }


def video_workflow():
    """Export only ancestors of49 from verified source, with exact typed widgets."""
    source = json.loads(_verified(VIDEO_GRAPH, VIDEO_GRAPH_SHA256))
    _verified(PACKAGE / "motion_control_models.bat", VIDEO_INSTALLER_SHA256)
    nodes = {str(node["id"]): node for node in source["nodes"]}
    links = {edge[0]: edge for edge in source["links"]}
    result = {}
    visiting = set()

    def visit(node_id):
        if node_id in result:
            return
        if node_id in visiting:
            raise ParityError("module08 source contains a cycle")
        visiting.add(node_id)
        node = nodes[node_id]
        fields = [i["name"] for i in node["inputs"] if "widget" in i]
        values = node.get("widgets_values", [])
        if isinstance(values, dict):
            if node_id not in {"49", "113"} or set(values) != set(fields) | {"videopreview"}:
                raise ParityError(f"module08 unexpected dictionary widgets at{node_id}")
            inputs = {field: values[field] for field in fields}
        else:
            values = list(values)
            if node_id == "3":
                if values.pop(1) != "fixed":
                    raise ParityError("module08 sampler seed policy changed")
            if len(fields) != len(values):
                raise ParityError(f"module08 unmapped widget at{node_id}")
            inputs = dict(zip(fields, values))
        for item in node["inputs"]:
            if item.get("link") is not None:
                _, src, slot, *_ = links[item["link"]]
                visit(str(src))
                inputs[item["name"]] = [str(src), slot]
        if node_id == "58":
            inputs.pop("upload")
            inputs["image"] = "__START_IMAGE__"
        if node_id == "113":
            inputs["video"] = "__DRIVING_VIDEO__"
        if node_id == "6":
            inputs["text"] = "__VIDEO_PROMPT__"
        result[node_id] = {"class_type": node["type"], "inputs": inputs}
        if node_id in {"102", "103"}:
            result[node_id]["_meta"] = {"runtime_schema_status": VIDEO_DYNAMIC_SCHEMA_STATUS}
        visiting.remove(node_id)

    visit("49")
    return result


def _same(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, list):
        return len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_same(left[k], right[k]) for k in left)
    return left == right


def _pin_problems(manifest):
    problems = []
    expected = {row["filename"]: row for row in VIDEO_MODEL_PINS}
    rows = manifest.get("models", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        return ["video models: malformed inventory"]
    actual = {row.get("filename"): row for row in rows}
    if len(rows) != len(actual) or actual.keys() != expected.keys():
        problems.append("video models: exact six installer files required without duplicates")
    for filename in actual.keys() & expected.keys():
        for field in ("repo_id", "filename", "revision", "sha256", "destination_dir"):
            if actual[filename].get(field) != expected[filename][field]:
                problems.append(f"video model {PurePosixPath(filename).name}: {field} differs from verified pin")
        if "pickle_ack" in actual[filename]:
            problems.append("video models: no pickle hatch permitted")
    nodes = manifest.get("custom_nodes", [])
    wanted = video_pin_group()["custom_nodes"][0]
    if not isinstance(nodes, list) or len(nodes) != 1 or not isinstance(nodes[0], dict):
        problems.append("video custom nodes: exactly the required VHS dependency is permitted")
    else:
        node = nodes[0]
        if (node.get("git_url") != wanted["git_url"] or
                node.get("git_ref", node.get("installer_pin")) != VIDEO_VHS_COMMIT or
                node.get("installer_pin", VIDEO_VHS_COMMIT) != VIDEO_VHS_COMMIT):
            problems.append("video custom nodes: VHS immutable source revision differs")
    return problems


def video_readiness_problems(manifest):
    """Static pin/runtime integrity only, never execution or approval evidence.

    Driver must separately enforce real input authority, current pin preflight,
    funded live approval and actual movie execution provenance before promotion.
    """
    problems = _pin_problems(manifest)
    comfy = manifest.get("comfyui", {})
    if (comfy.get("git_ref") != VIDEO_RUNTIME_COMMIT or
            comfy.get("source_url") != VIDEO_RUNTIME_SOURCE_URL or
            comfy.get("tarball_url") != VIDEO_RUNTIME_TARBALL_URL):
        problems.append("video runtime: exact source-compatible core commit, repository and tarball required")
    if any(manifest.get(key) for key in ("fixture", "fixture_only", "synthetic")):
        problems.append("video fixture/synthetic evidence is not production readiness")
    return problems


def video_output_contract(*, workflow_png=False):
    """Native movie output; false requires core to verify embedded MP4 provenance.

    True asks transport for a required bounded workflow-PNG companion. Neither
    setting makes successful transport sufficient for accepting model execution.
    """
    if type(workflow_png) is not bool:
        raise ParityError("workflow_png policy must be boolean")
    return {"schema": "figment/comfy-output-contract@1", "outputs": [{
        "node_id": "49", "role": "video", "media_type": "video/mp4", "count": 1,
        "max_bytes": VIDEO_MAX_BYTES, "workflow_png": workflow_png,
    }]}


def _output_contract_problems(job):
    problems = []
    if any(key in job for key in ("expected_images", "expected_videos", "output_nodes")):
        problems.append("video job: output contract cannot coexist with legacy/count-only declarations")
    contract = job.get("output_contract")
    if (not isinstance(contract, dict) or set(contract) != {"schema", "outputs"} or
            contract.get("schema") != "figment/comfy-output-contract@1"):
        return problems + ["video job: closed comfy-output-contract@1 required"]
    rows = contract["outputs"]
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        return problems + ["video job: one node49 movie output required"]
    row = rows[0]
    wanted = video_output_contract()["outputs"][0]
    if set(row) != set(wanted):
        problems.append("video job: output contract fields differ")
    for field in ("node_id", "role", "media_type", "count"):
        if not _same(row.get(field), wanted[field]):
            problems.append(f"video job: output {field} differs from node49 movie contract")
    limit = row.get("max_bytes")
    if type(limit) is not int or not 0 < limit <= VIDEO_MAX_BYTES:
        problems.append("video job: movie max_bytes must be positive and at most512MiB")
    if type(row.get("workflow_png")) is not bool:
        problems.append("video job: explicit boolean workflow-PNG policy required")
    return problems


def check_video(workflow, manifest, *, prompt=None, driving_video=None, start_image=None):
    """Exact effective-source recipe; caller binds the frozen text and media names."""
    expected = video_workflow()
    bindings = (("6", "text", prompt), ("113", "video", driving_video), ("58", "image", start_image))
    for node, field, value in bindings:
        if value is not None:
            expected[node]["inputs"][field] = value
    problems = _pin_problems(manifest)
    if set(workflow) != set(expected):
        problems.append("video nodes: effective source node set differs")
    for node in set(workflow) & set(expected):
        actual = workflow[node]
        if not isinstance(actual, dict) or actual.get("class_type") != expected[node]["class_type"]:
            problems.append(f"video node{node}: class differs")
            continue
        inputs = actual.get("inputs", {})
        if not isinstance(inputs, dict):
            problems.append(f"video node{node}: malformed inputs")
            continue
        wanted = expected[node]["inputs"]
        if set(inputs) != set(wanted):
            problems.append(f"video node{node}: input keys differ")
        for field, value in wanted.items():
            if (node, field) == ("49", "filename_prefix"):
                if not isinstance(inputs.get(field), str) or not inputs[field].strip():
                    problems.append("video output: nonempty filename prefix required")
            elif not _same(inputs.get(field), value):
                problems.append(f"video node{node}.{field}: differs from effective source")
    for node, field, _ in bindings:
        value = workflow.get(node, {}).get("inputs", {}).get(field)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"video node{node}.{field}: nonempty request binding required")
    if manifest.get("seed_fields") != ["seed"]:
        problems.append("video seed_fields: require seed only")
    jobs = manifest.get("jobs", [])
    if not isinstance(jobs, list) or len(jobs) != 1:
        problems.append("video jobs: exactly one source clip generation required")
        return problems
    job = jobs[0]
    if not isinstance(job, dict):
        return problems + ["video job: malformed record"]
    problems.extend(_output_contract_problems(job))
    if type(job.get("seed")) is not int or job["seed"] != 123:
        problems.append("video job: fixed source seed123 required")
    substitutions = job.get("substitutions", [])
    mapped = {(str(s.get("node_id")), s.get("field")): s.get("value") for s in substitutions}
    if len(mapped) != len(substitutions) or set(mapped) - {("49", "filename_prefix")}:
        problems.append("video job: unsupported or duplicate substitution")
    return problems
VIDEO_MODEL_PINS = [{'repo_id': 'Comfy-Org/sam3.1',
  'filename': 'checkpoints/sam3.1_multiplex_fp16.safetensors',
  'revision': '7bb8374780a725b4353ed31f3a9395c9742b5621',
  'sha256': '9ba99c92703c2e8b4f47de2d34a539bb8e18923049e238b780d70dbe6368eb03',
  'destination_dir': '/workspace/ComfyUI/models/checkpoints',
  'licence': 'sam-license'},
 {'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  'filename': 'split_files/clip_vision/clip_vision_h.safetensors',
  'revision': '123acf1cc74bccbb9bfff8ac1ee72edc08c2341d',
  'sha256': '64a7ef761bfccbadbaa3da77366aac4185a6c58fa5de5f589b42a65bcc21f161',
  'destination_dir': '/workspace/ComfyUI/models/clip_vision',
  'licence': 'apache-2.0'},
 {'repo_id': 'Comfy-Org/SCAIL-2',
  'filename': 'diffusion_models/wan2.1_14B_SCAIL_2_fp8_scaled.safetensors',
  'revision': 'fe3c728bc793ba21ca674688f822afb709ad44fb',
  'sha256': '11513b4697ecf566de0cb74660c478f301fb6699a62b10369e91a6ed0fd6b083',
  'destination_dir': '/workspace/ComfyUI/models/diffusion_models',
  'licence': 'mit'},
 {'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  'filename': 'split_files/vae/wan_2.1_vae.safetensors',
  'revision': '123acf1cc74bccbb9bfff8ac1ee72edc08c2341d',
  'sha256': '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b',
  'destination_dir': '/workspace/ComfyUI/models/vae',
  'licence': 'apache-2.0'},
 {'repo_id': 'lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v',
  'filename': 'loras/Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors',
  'revision': 'fef288b326f4fed6d2983b9800c35363da31fcfe',
  'sha256': '8833bd4fd7c8eabebf0bc8ee5cfaf47f4f310ce116928a02c1adf8941dd4b0f1',
  'destination_dir': '/workspace/ComfyUI/models/loras',
  'licence': 'apache-2.0'},
 {'repo_id': 'Comfy-Org/Wan_2.1_ComfyUI_repackaged',
  'filename': 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  'revision': '123acf1cc74bccbb9bfff8ac1ee72edc08c2341d',
  'sha256': 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68',
  'destination_dir': '/workspace/ComfyUI/models/text_encoders',
  'licence': 'apache-2.0'}]

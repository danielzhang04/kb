"""Module09 offline source parity, U5 variants, and approved pin inventory.

Verified public metadata is not runtime/quality proof. The gravedigga mirror's
per-file licences and RES4LYF licence classification remain unresolved; production
readiness must fail, without guessing licence inheritance from another model.
"""
from __future__ import annotations

import copy
import json
import importlib.util
import sys
from pathlib import Path, PurePosixPath

def _local_parity():
    name = "_figment_stills_source_parity"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("tensor_parity.py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


_source = _local_parity()
ParityError, _read_verified, _widget_values = _source.ParityError, _source._read_verified, _source._widget_values

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent / "research/10sorlabs-package/09_krea2_image"
STILLS_GRAPH = PACKAGE / "10sorlabs_krea2_image.json"
STILLS_GRAPH_SHA256 = "44d6200d36ae7ea73194451fa6dcf9f6af33767062b43865984e571a9d0b7eb6"
STILLS_INSTALLER_SHA256 = "4e47ee8dcd45bb011abd1640e5295fe04d0d97a0900f301aa0ca24d327af0cfc"
STILLS_WORKFLOW = HERE / "train/workflows/tensor_stills_m09_api.json"
FRAMINGS = {"close-up", "medium", "full", "wide"}
DETAIL_SEED = 137053700462745
MAX_IMAGE_BYTES = 32 * 1024 * 1024
U5_REMOVED = {"1635", "1636", "1625", "1626", "1637", "1627", "1702"}
STILLS_LEDGER = {
    "Set/Get": "Resolve matching named setter's actual incoming edge",
    "1641,1704": "UI comparisons excluded; dependencies retained by saves",
    "1633": "D28 enabled style order expanded to two core LoraLoaders, equal model/clip strengths",
    "1633_identity": "D28 transcript-added accepted persona LoRA after styles, model/clip1.0",
    "1686.text": "Frozen approved scene prompt replaces saved scene prose; no look prefix",
    "close-up": "U5 remove upscale/refine group and its save; base decode feeds FaceDetailer",
}


def _framing(framing):
    if framing not in FRAMINGS:
        raise ParityError("stills framing must be explicitly close-up, medium, full, or wide")


def stills_output_roles(framing="full"):
    _framing(framing)
    return ({"base": "1699", "enhanced": "1703"} if framing == "close-up" else
            {"base": "1699", "upscaled": "1702", "enhanced": "1703"})


def stills_output_contract(framing="full"):
    return {"schema": "figment/comfy-output-contract@1", "outputs": [
        {"node_id": node, "role": role, "media_type": "image/png", "count": 1,
         "max_bytes": MAX_IMAGE_BYTES, "workflow_png": False}
        for role, node in stills_output_roles(framing).items()]}


def stills_pin_group(framing="full"):
    _framing(framing)
    return {
        "_note": "Module09 exact installer hashes and public immutable metadata. Disabled style excluded. "
                 "Two style/NMKD mirror licences and RES4LYF classification unresolved; no production clearance. "
                 "rgthree/KJ editor plumbing collapsed; core LoraLoader chain retains model/clip strengths.",
        "diagnostic_non_commercial": True,
        "models": [copy.deepcopy(m) for m in STILLS_MODEL_PINS if
                   framing != "close-up" or not m["filename"].endswith("4xNMKDSuperscale_4xNMKDSuperscale.pt")],
        "custom_nodes": copy.deepcopy(STILLS_NODE_PINS),
    }


def stills_workflow(framing="full", *, reads=None):
    _framing(framing)
    source = json.loads(_read_verified(STILLS_GRAPH, STILLS_GRAPH_SHA256, reads=reads))
    _read_verified(PACKAGE / "krea2_model_installer.bat", STILLS_INSTALLER_SHA256, reads=reads)
    nodes = {str(n["id"]): n for n in source["nodes"]}
    links = {e[0]: e for e in source["links"]}
    setters = {n["widgets_values"][0]: n for n in source["nodes"] if n["type"] == "SetNode"}
    result = {}

    def edge(link):
        _, src, slot, *_ = links[link]
        node = nodes[str(src)]
        if node["type"] == "GetNode":
            return edge(setters[node["widgets_values"][0]]["inputs"][0]["link"])
        if node["type"] == "SetNode":
            return edge(node["inputs"][0]["link"])
        visit(str(src))
        return ["1633_identity" if src == 1633 else str(src), slot]

    def visit(node_id):
        if node_id in result:
            return
        node = nodes[node_id]
        if node_id == "1633":
            enabled = [v for v in node["widgets_values"] if isinstance(v, dict) and v.get("on") is True]
            if [(s["lora"], s["strength"]) for s in enabled] != [
                    ("RealisticSnapshotKrea2.safetensors", 1.5), ("pawg_krea2.safetensors", 0.65)]:
                raise ParityError("module09 enabled style inventory changed")
            inputs = {i["name"]: edge(i["link"]) for i in node["inputs"]}
            for index, slot in enumerate(enabled):
                key = "1633" if index == 0 else "1633_style2"
                clip_strength = slot["strength"] if slot.get("strengthTwo") is None else slot["strengthTwo"]
                result[key] = {"class_type": "LoraLoader", "inputs": dict(
                    inputs if index == 0 else {"model": ["1633", 0], "clip": ["1633", 1]},
                    lora_name=slot["lora"], strength_model=slot["strength"], strength_clip=clip_strength)}
            result["1633_identity"] = {"class_type": "LoraLoader", "inputs": {
                "model": ["1633_style2", 0], "clip": ["1633_style2", 1],
                "lora_name": "__IDENTITY_LORA__", "strength_model": 1.0, "strength_clip": 1.0}}
            return
        inputs = _widget_values(node)
        for item in node["inputs"]:
            if item.get("link") is not None:
                inputs[item["name"]] = edge(item["link"])
        if node_id == "1686":
            inputs["text"] = "__STILLS_PROMPT__"
        result[node_id] = {"class_type": node["type"], "inputs": inputs}

    for save in ("1699", "1702", "1703"):
        visit(save)
    if framing == "close-up":
        for node in U5_REMOVED:
            del result[node]
        result["1611"]["inputs"]["image"] = ["1622", 0]
    return result


def _same(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, list):
        return len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_same(left[k], right[k]) for k in left)
    return left == right


def _pin_problems(manifest, framing):
    expected = stills_pin_group(framing)
    problems = []
    rows = manifest.get("models", [])
    names = [r.get("filename") for r in rows]
    wanted = {m["filename"]: m for m in expected["models"]}
    if len(names) != len(set(names)) or set(names) != set(wanted):
        problems.append("stills models: exact approved inventory without duplicates required")
    for row in rows:
        model = wanted.get(row.get("filename"))
        if model is None:
            continue
        for field in ("repo_id", "filename", "revision", "sha256", "destination_dir", "pickle_ack"):
            if row.get(field) != model.get(field):
                problems.append(f"stills model {PurePosixPath(model['filename']).name}: {field} differs")
    if manifest.get("diagnostic_non_commercial") is not True:
        problems.append("stills: exact approved pickle files require diagnostic_non_commercial=true")
    nodes = manifest.get("custom_nodes", [])
    actual = {n.get("git_url"): n.get("git_ref", n.get("installer_pin")) for n in nodes}
    required = {n["git_url"]: n["git_ref"] for n in expected["custom_nodes"]}
    if len(nodes) != len(actual) or actual != required:
        problems.append("stills custom nodes: exact effective dependency revisions required")
    if any(n.get("installer_pin", n.get("git_ref")) != n.get("git_ref", n.get("installer_pin")) for n in nodes):
        problems.append("stills custom nodes: conflicting revision aliases")
    return problems


def stills_readiness_problems(manifest, framing="full"):
    """Fail unknown licence provenance independently of editable manifest labels."""
    _framing(framing)
    problems = _pin_problems(manifest, framing)
    for model in stills_pin_group(framing)["models"]:
        if model.get("licence_status") == "unresolved":
            problems.append(f"stills licence unresolved: {PurePosixPath(model['filename']).name}")
    problems.append("stills licence unresolved: RES4LYF standard classification/provenance")
    if any(manifest.get(k) for k in ("fixture", "fixture_only", "synthetic")):
        problems.append("stills fixture evidence is not production readiness")
    return problems


def _contract_problems(job, framing):
    expected = stills_output_contract(framing)
    actual = job.get("output_contract")
    if any(k in job for k in ("expected_images", "expected_videos", "output_nodes")):
        return ["stills job: contract cannot coexist with legacy output count declarations"]
    if not isinstance(actual, dict) or set(actual) != set(expected) or actual.get("schema") != expected["schema"]:
        return ["stills job: closed output-contract@1 required"]
    rows = actual["outputs"]
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        return ["stills job: malformed output contract"]
    roles = {r.get("role"): r for r in rows}
    required = {r["role"]: r for r in expected["outputs"]}
    if len(rows) != len(roles) or roles.keys() != required.keys():
        return ["stills job: exact source output roles required"]
    problems = []
    for role, wanted in required.items():
        row = roles[role]
        if set(row) != set(wanted):
            problems.append(f"stills output {role}: contract fields differ")
        for field in ("node_id", "role", "media_type", "count", "workflow_png"):
            if not _same(row.get(field), wanted[field]):
                problems.append(f"stills output {role}: {field} differs")
        limit = row.get("max_bytes")
        if type(limit) is not int or not 0 < limit <= MAX_IMAGE_BYTES:
            problems.append(f"stills output {role}: invalid32MiB byte cap")
    return problems


def check_stills(workflow, manifest, *, framing="full", prompt=None, identity_lora=None, approved_prompts=None, reads=None):
    expected = stills_workflow(framing, reads=reads)
    for node, field, value in (("1686", "text", prompt), ("1633_identity", "lora_name", identity_lora)):
        if value is not None:
            expected[node]["inputs"][field] = value
    problems = _pin_problems(manifest, framing)
    if set(workflow) != set(expected):
        problems.append("stills nodes: effective source/U5 set differs")
    save_nodes = set(stills_output_roles(framing).values())
    mutable = {(node, "filename_prefix") for node in save_nodes} | {("1634", "seed")}
    for node in set(workflow) & set(expected):
        actual = workflow[node]
        if actual.get("class_type") != expected[node]["class_type"]:
            problems.append(f"stills node{node}: class differs")
        inputs = actual.get("inputs", {})
        wanted = expected[node]["inputs"]
        if set(inputs) != set(wanted):
            problems.append(f"stills node{node}: input fields differ")
        for field, value in wanted.items():
            if (node, field) not in mutable and not _same(inputs.get(field), value):
                problems.append(f"stills node{node}.{field}: differs from source")
    for node, field in (("1686", "text"), ("1633_identity", "lora_name")):
        value = workflow.get(node, {}).get("inputs", {}).get(field)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"stills node{node}.{field}: nonempty frozen binding required")
    if manifest.get("output_roles") != stills_output_roles(framing):
        problems.append("stills output_roles: exact node-role mapping required")
    if manifest.get("seed_fields") != ["seed"]:
        problems.append("stills seed_fields: seed with fixed-tail restoration required")
    jobs = manifest.get("jobs", [])
    if not jobs:
        problems.append("stills jobs: nonempty scene sequence required")
    seen_indices = set()
    if approved_prompts is not None:
        if (not isinstance(approved_prompts, dict) or not approved_prompts
                or any(not isinstance(k, str) or not k.isdecimal() or str(int(k)) != k
                       or not isinstance(v, str) or not v.strip() for k, v in approved_prompts.items())):
            problems.append("stills approved_prompts: exact scene-index string to prompt map required")
            approved_prompts = {}
    for index, job in enumerate(jobs):
        problems.extend(_contract_problems(job, framing))
        scene_index = job.get("scene_index", index)
        if type(scene_index) is not int or scene_index < 0 or scene_index in seen_indices:
            problems.append(f"stills job{index}: invalid/duplicate source scene index")
        else:
            seen_indices.add(scene_index)
            if type(job.get("seed")) is not int or job["seed"] != 1594 + scene_index:
                problems.append(f"stills job{index}: main seed must follow1594+scene_index")
        substitutions = job.get("substitutions", [])
        mapped = {(str(s.get("node_id")), s.get("field")): s.get("value") for s in substitutions}
        tail = {("1611", "seed"): DETAIL_SEED}
        if framing != "close-up":
            tail[("1637", "seed")] = 40
        allowed = {(node, "filename_prefix") for node in save_nodes} | set(tail)
        if approved_prompts is not None:
            allowed.add(("1686", "text"))
            if mapped.get(("1686", "text")) != approved_prompts.get(str(scene_index)) or str(scene_index) not in approved_prompts:
                problems.append(f"stills job{index}: prompt differs from approved scene binding")
        if len(mapped) != len(substitutions) or set(mapped) - allowed:
            problems.append(f"stills job{index}: unsupported/duplicate substitution")
        if any(not _same(mapped.get(key), value) for key, value in tail.items()):
            problems.append(f"stills job{index}: fixed refine/detail seeds must survive harness seed assignment")
    if approved_prompts is not None and set(approved_prompts) != {str(i) for i in seen_indices}:
        problems.append("stills approved_prompts: exact job scene set required")
    return problems
STILLS_MODEL_PINS = [{'repo_id': 'Comfy-Org/Krea-2',
  'filename': 'diffusion_models/krea2_turbo_fp8_scaled.safetensors',
  'revision': 'eb1eddd3983a54678545a9b2c178c5853b30f7be',
  'sha256': 'eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1',
  'destination_dir': '/workspace/ComfyUI/models/diffusion_models',
  'licence': 'krea-2-community-license'},
 {'repo_id': 'Comfy-Org/Krea-2',
  'filename': 'text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
  'revision': 'eb1eddd3983a54678545a9b2c178c5853b30f7be',
  'sha256': '54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094',
  'destination_dir': '/workspace/ComfyUI/models/text_encoders',
  'licence': 'krea-2-community-license'},
 {'repo_id': 'Comfy-Org/Krea-2',
  'filename': 'vae/qwen_image_vae.safetensors',
  'revision': 'eb1eddd3983a54678545a9b2c178c5853b30f7be',
  'sha256': 'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
  'destination_dir': '/workspace/ComfyUI/models/vae',
  'licence': 'krea-2-community-license'},
 {'repo_id': 'gravedigga/loras',
  'filename': 'pawg_krea2.safetensors',
  'revision': '9b30695ba342f56131d1131f9788b0fd9cb9dfd4',
  'sha256': '6df1ae992e4ac7ae2e5576b01074f31cc6ba20c442711d9b87e920996c24c30d',
  'destination_dir': '/workspace/ComfyUI/models/loras',
  'licence': 'unknown',
  'licence_status': 'unresolved'},
 {'repo_id': 'gravedigga/loras',
  'filename': 'RealisticSnapshotKrea2.safetensors',
  'revision': '9b30695ba342f56131d1131f9788b0fd9cb9dfd4',
  'sha256': 'dfd67eb881bec4caeb9409e5b7c127adcb9fb724e6007e1e77165af51e6f908d',
  'destination_dir': '/workspace/ComfyUI/models/loras',
  'licence': 'unknown',
  'licence_status': 'unresolved'},
 {'repo_id': 'gravedigga/loras',
  'filename': '4xNMKDSuperscale_4xNMKDSuperscale.pt',
  'revision': '9b30695ba342f56131d1131f9788b0fd9cb9dfd4',
  'sha256': '1d1b0078fe71446e0469d8d4df59e96baa80d83cda600d68237d655830821bcc',
  'destination_dir': '/workspace/ComfyUI/models/upscale_models',
  'licence': 'unknown',
  'licence_status': 'unresolved',
  'pickle_ack': 'Approved module09 diagnostic-only exact-file exception: 4xNMKDSuperscale_4xNMKDSuperscale.pt; '
                'immutable installer SHA verified.'},
 {'repo_id': 'Bingsu/adetailer',
  'filename': 'face_yolov8m.pt',
  'revision': '53cc19de382014514d9d4038601d261a7faa9b7b',
  'sha256': '717923c19b3f4bbf5250b728f1fa6b2cb72a33aed1d236ea9caf0e21ad943e5f',
  'destination_dir': '/workspace/ComfyUI/models/ultralytics/bbox',
  'licence': 'apache-2.0',
  'pickle_ack': 'Approved module09 diagnostic-only exact-file exception: face_yolov8m.pt; immutable installer SHA '
                'verified.'},
 {'repo_id': 'datasets/Gourieff/ReActor',
  'filename': 'models/sams/sam_vit_b_01ec64.pth',
  'revision': '788477a1c8088e664f10a74b95ce65dcdd3c56dc',
  'sha256': 'ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912',
  'destination_dir': '/workspace/ComfyUI/models/sams',
  'licence': 'mit',
  'pickle_ack': 'Approved module09 diagnostic-only exact-file exception: sam_vit_b_01ec64.pth; immutable '
                'installer SHA verified.'}]
STILLS_NODE_PINS = [{'name': 'ComfyUI-Impact-Pack',
  'git_url': 'https://github.com/ltdrdata/ComfyUI-Impact-Pack.git',
  'git_ref': '429d0159ad429e64d2b3916e6e7be9c22d025c3c',
  'licence': 'GPL-3.0'},
 {'name': 'ComfyUI-Impact-Subpack',
  'git_url': 'https://github.com/ltdrdata/ComfyUI-Impact-Subpack.git',
  'git_ref': '50c7b71a6a224734cc9b21963c6d1926816a97f1',
  'licence': 'AGPL-3.0'},
 {'name': 'RES4LYF',
  'git_url': 'https://github.com/ClownsharkBatwing/RES4LYF.git',
  'git_ref': 'e716cd1cb2c5cff90131bf4914b75b75a0489d48',
  'licence': 'NOASSERTION'}]

"""Pure module09 fixture planning fragments; no approval or launch authority.

The driver owns fresh canonical passport/checkpoint validation, checkpoint staging,
pod configuration, generic receipt/path/byte validation and approval writers.
Call revalidate_scenes immediately before compilation and again at freshness gates.
Compilation accepts trusted projections, not independently authenticated approvals.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import hashlib
import sys
import re
from pathlib import Path

def _module(name, filename):
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


prompt_intake = _module("_figment_stills_intake", "prompt_intake.py")
parity = _module("_figment_stills_parity", "tensor_stills_parity.py")


class StillsError(ValueError):
    pass


def read_request(path, creator, *, passport_adapter, reads=None):
    """Bounded local fixture request; all paths are relative to its evidence root."""
    path = Path(path)
    if reads is not None:
        if not path.is_absolute():
            raise StillsError("observed request path must be absolute")
        path = reads.resolve_exact_file(path)
    else:
        path = path.absolute()
    root = path.parent
    def document(relative, expected=None):
        raw = prompt_intake._read(root, relative, reads=reads)
        digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected:
            raise StillsError("scene evidence digest changed")
        def unique(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise StillsError("duplicate scene document key")
                value[key] = item
            return value
        try:
            value = json.loads(raw, object_pairs_hook=unique)
        except (ValueError, RecursionError) as exc:
            raise StillsError("scene document must be strict JSON") from exc
        return value, digest
    request, digest = document(path.name)
    if (not isinstance(request, dict) or set(request) != {"schema", "creator", "fixture", "passport", "scenes"}
            or request["schema"] != "figment/tensor-stills-request@1" or request["creator"] != creator
            or request["fixture"] is not True):
        raise StillsError("closed fixture tensor-stills-request@1 required")
    passport = prompt_intake.canonical_passport_binding(creator=creator, selection=request["passport"], passport_adapter=passport_adapter, reads=reads)
    if not isinstance(request["scenes"], list) or not 1 <= len(request["scenes"]) <= 128:
        raise StillsError("request needs one to128 scenes")
    requests, files = [], []
    for row in request["scenes"]:
        if not isinstance(row, dict) or set(row) != {"scene_index", "draft", "approval"}:
            raise StillsError("closed scene evidence row required")
        parsed = {"scene_index": row["scene_index"]}
        for kind in ("draft", "approval"):
            binding = row[kind]
            if (not isinstance(binding, dict) or set(binding) != {"path", "sha256"}
                    or not isinstance(binding["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", binding["sha256"])):
                raise StillsError("digest-bound scene evidence required")
            parsed[kind], _ = document(binding["path"], binding["sha256"])
            files.append({"kind": kind, "scene_index": row["scene_index"], **binding})
        requests.append(parsed)
    scenes = revalidate_scenes(root, requests, creator=creator, current_passport=passport, passport_adapter=passport_adapter, reads=reads)
    return {"request": {"path": str(path), "sha256": digest}, "fixture": True,
            "passport": passport, "scene_files": files, "scenes": scenes}


def _index(value):
    if type(value) is not int or value < 0:
        raise StillsError("scene_index must be a nonnegative integer")
    return value


def revalidate_scenes(root, requests, *, creator, current_passport, passport_adapter, reads=None):
    """Re-read frozen fixture scenes through the trusted canonical intake adapter.

No scene photo is returned or uploaded. Canonical callbacks must freshly resolve
the driver's registered-passport proof and persona descriptor slots.
"""
    if not isinstance(current_passport, dict) or current_passport.get("kind") != "canonical-registration-fixture-intake":
        raise StillsError("canonical passport intake binding required")
    if not isinstance(requests, list) or not requests:
        raise StillsError("nonempty scene requests required")
    result, seen = [], set()
    for request in requests:
        if not isinstance(request, dict) or set(request) != {"scene_index", "draft", "approval"}:
            raise StillsError("scene request requires index, draft and approval")
        index = _index(request["scene_index"])
        if index in seen:
            raise StillsError("duplicate scene_index")
        seen.add(index)
        projection = prompt_intake.approved_prompt_projection(
            root, request["draft"], request["approval"], current_passport=current_passport,
            passport_adapter=passport_adapter, live=False, reads=reads)
        if projection["creator"] != creator:
            raise StillsError("scene creator differs from requested creator")
        result.append({**projection, "scene_index": index})
    return result


def compile_scene_groups(projections, *, identity_lora, output_prefix, reads=None):
    """Group scenes by framing, preserving global seed offsets and prompt authority.

identity_lora must be the canonical staged name from the existing accepted
checkpoint resolver. This helper neither resolves nor approves a checkpoint.
Fragments deliberately omit uploads/models/pod fields; the driver adds them.
"""
    if (not isinstance(identity_lora, str) or not identity_lora.endswith(".safetensors")
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", identity_lora)):
        raise StillsError("canonical checkpoint basename required")
    if not isinstance(output_prefix, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", output_prefix):
        raise StillsError("safe output prefix required")
    if not isinstance(projections, list) or not projections:
        raise StillsError("nonempty revalidated projections required")
    required = {"fixture", "creator", "text", "framing", "text_sha256", "approval_sha256",
                "draft_sha256", "passport_authority_sha256", "descriptor_projection_sha256", "scene_index"}
    groups, seen = {}, set()
    for scene in projections:
        if not isinstance(scene, dict) or set(scene) != required or scene["fixture"] is not True:
            raise StillsError("canonical fixture text projection required")
        index = _index(scene["scene_index"])
        if index in seen:
            raise StillsError("duplicate scene_index")
        seen.add(index)
        framing = scene["framing"]
        if framing not in parity.FRAMINGS or not isinstance(scene["text"], str) or not scene["text"].strip():
            raise StillsError("explicit framing and approved prompt required")
        if framing not in groups:
            workflow = parity.stills_workflow(framing, reads=reads)
            workflow["1633_identity"]["inputs"]["lora_name"] = identity_lora
            groups[framing] = {"framing": framing, "prompt_authorities": [],
                "approved_prompts": {}, "workflow": workflow, "seed_fields": ["seed"],
                "output_roles": parity.stills_output_roles(framing), "jobs": []}
        group = groups[framing]
        name = f"{output_prefix}-{index + 1:03d}"
        substitutions = [{"node_id": "1686", "field": "text", "value": scene["text"]},
                         {"node_id": "1611", "field": "seed", "value": parity.DETAIL_SEED}]
        if framing != "close-up":
            substitutions.append({"node_id": "1637", "field": "seed", "value": 40})
        roles = parity.stills_output_roles(framing)
        substitutions.extend({"node_id": node, "field": "filename_prefix", "value": name + "--" + role}
                             for role, node in roles.items())
        group["prompt_authorities"].append(copy.deepcopy(scene))
        group["approved_prompts"][str(index)] = scene["text"]
        group["jobs"].append({"scene_index": index, "seed": 1594 + index, "output_name": name,
                      **({"wait_for": "_loras.assembled"} if not group["jobs"] else {}),
                      "substitutions": substitutions, "output_contract": parity.stills_output_contract(framing)})
    return list(groups.values())


def normalize_stills_outputs(fragment, receipt):
    """Map every saved image by node/role after generic receipt verification.

The caller must first validate actual bytes, safe paths, prompt IDs and effective
workflow digest with the shared driver validator. This pure role adapter does not
read files, certify provenance, or issue gen approvals.
"""
    roles = parity.stills_output_roles(fragment["framing"])
    if fragment.get("output_roles") != roles:
        raise StillsError("exact output roles required")
    jobs = [job for job in fragment.get("jobs", []) if job.get("output_name") == receipt.get("output_name")]
    if len(jobs) != 1:
        raise StillsError("receipt belongs to another scene")
    job = jobs[0]
    files = receipt.get("files")
    if not isinstance(files, list) or len(files) != len(roles):
        raise StillsError("receipt must contain every saved still role")
    by_role = {}
    for row in files:
        if not isinstance(row, dict):
            raise StillsError("malformed still receipt")
        role = row.get("role")
        if (not isinstance(role, str) or role not in roles or role in by_role
                or row.get("node_id") != roles[role] or row.get("media_type") != "image/png"
                or "companion_of" in row):
            raise StillsError("duplicate, extra or mismatched still output role")
        by_role[role] = row
    return [{**copy.deepcopy(by_role[role]), "image_id": job["output_name"] + "--" + role,
             "scene_index": job["scene_index"], "framing": fragment["framing"]}
            for role in roles]

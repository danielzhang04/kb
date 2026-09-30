"""Offline recipe-parity check: a 10sorlabs package graph against our API export
(spec docs/superpowers/specs/2026-09-29-figment-tensor-parity-design.md §9).
Phase 1 covers the passport stage (module 03). Run by tests/test_tensor_parity.py and
as a `figment_train.py plan` preflight whenever the tensor profile plans the passport."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

HERE = Path(__file__).resolve().parent
PACKAGE_ROOT = HERE.parent / "research" / "10sorlabs-package"
PASSPORT_GRAPH = PACKAGE_ROOT / "03_generating_your_character" / "10sorlabs_image_generator.json"
PASSPORT_GRAPH_SHA256 = "5b57403f3d8aff49fe4799c533de2b70bf14e94637d832f91d03a59904a42df5"
MODULES_JSON = PACKAGE_ROOT / "modules.json"
MODULES_JSON_SHA256 = "23b883ab0bc8f138a657f8cf62a32f73c7725c327ee23e549f3cee7f8721309d"
PASSPORT_WORKFLOW = HERE / "expand" / "workflows" / "tensor_passport_m03_api.json"
CONTROL_AFTER_GENERATE = {"fixed", "increment", "decrement", "randomize"}
SLOT_RE = re.compile(r"\{[^{}]+\}")
HARNESS_FIELDS = {"seed", "filename_prefix"}
PASSPORT_SEEDS = list(range(148, 160))
# Spec §5 rows this stage relies on. Every other difference fails.
PASSPORT_LEDGER = {
    "ui_only": {"101": "D18 Fast Groups Bypasser", "105": "D18 Image Comparer"},
    "dropped": {"31": "D18 extra save after detailer 1", "94": "D18 extra save of the base"},
    "lora_loader": {"102": "D16 Power Lora Loader -> core LoraLoader, equal strengths"},
    "overrides": {("30", "denoise"): (0.23, "P3"), ("66", "denoise"): (0.23, "P3")},
    "prompt_node": ("4", "text"),
}
# Spec §6: the only files a tensor manifest may admit through the pickle hatch.
PICKLE_HATCH_FILES = {
    "face_yolov8m.pt", "sam_vit_b_01ec64.pth", "4xNMKDSuperscale_4xNMKDSuperscale.pt",
}
# sha256 the package's installers state for these exact URLs (module 03's own installer
# states none; see 10_dataset_generator_v2/dataset_generator_model_installer.bat and
# 09_krea2_image/krea2_model_installer.bat).
INSTALLER_SHA256 = {
    "zit_upscaler.safetensors": "009671cec5a384db31052b52e344e5989b0c51a5ad4d25a8c2c629f658754d13",
    "sam_vit_b_01ec64.pth": "ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912",
}


class ParityError(RuntimeError):
    """A package file is missing, altered, or not in the expected shape."""


def _read_verified(path: Path, sha256: str) -> bytes:
    try:
        data = Path(path).read_bytes()
    except OSError as exc:
        raise ParityError(
            f"package file unavailable (gitignored; restore the package snapshot): {path}"
        ) from exc
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ParityError(f"package file digest changed: {path}")
    return data


def passport_prompt_template() -> str:
    for module in json.loads(_read_verified(MODULES_JSON, MODULES_JSON_SHA256)):
        if module.get("id") != "03_generating_your_character":
            continue
        for block in module.get("copy_blocks") or []:
            if block.get("label") == "Passport photo prompt":
                if len(SLOT_RE.findall(block["text"])) != 2:
                    raise ParityError("module 03 passport prompt no longer has exactly two slots")
                return block["text"]
    raise ParityError("modules.json has no module 03 'Passport photo prompt' copy block")


def render_passport_prompt(template: str, hair: str, eyes: str) -> str:
    """Fill the copy block's two slots in order -- hair, then eye colour (spec §4.1)."""
    for value in (hair, eyes):
        if not isinstance(value, str) or not value.strip() or "{" in value or "}" in value:
            raise ParityError(f"passport slot value must be non-empty text without braces: {value!r}")
    values = iter((hair.strip(), eyes.strip()))
    return SLOT_RE.sub(lambda _match: next(values), template)


def _widget_values(node: dict[str, Any]) -> dict[str, Any]:
    names = [item["name"] for item in node.get("inputs", []) if "widget" in item]
    values = list(node.get("widgets_values") or [])
    mapped: dict[str, Any] = {}
    index = 0
    for name in names:
        if index >= len(values):
            raise ParityError(f"node {node['id']} has fewer widget values than widget inputs")
        mapped[name] = values[index]
        index += 1
        if (name in ("seed", "noise_seed") and index < len(values)
                and values[index] in CONTROL_AFTER_GENERATE):
            index += 1
    if index != len(values):
        raise ParityError(f"node {node['id']} has {len(values) - index} unmapped widget values")
    return mapped


def _package_edges(graph: dict[str, Any], skip: set[str]) -> set[tuple[str, int, str, str]]:
    nodes = {str(node["id"]): node for node in graph["nodes"]}
    edges = set()
    for _link, src, src_slot, dst, dst_slot, _type in graph["links"]:
        src, dst = str(src), str(dst)
        if src not in skip and dst not in skip:
            edges.add((src, int(src_slot), dst, nodes[dst]["inputs"][dst_slot]["name"]))
    return edges


def _api_edges(workflow: dict[str, Any]) -> set[tuple[str, int, str, str]]:
    edges = set()
    for node_id, node in workflow.items():
        for name, value in node.get("inputs", {}).items():
            if (isinstance(value, list) and len(value) == 2
                    and isinstance(value[0], str) and isinstance(value[1], int)):
                edges.add((value[0], value[1], node_id, name))
    return edges


def _active_lora(node: dict[str, Any]) -> dict[str, Any]:
    active = [slot for slot in node.get("widgets_values") or []
              if isinstance(slot, dict) and "lora" in slot and slot.get("on")]
    if len(active) != 1:
        raise ParityError(f"node {node['id']}: expected exactly one active LoRA slot, got {len(active)}")
    return active[0]


def _same(actual: Any, expected: Any) -> bool:
    # Type-strict: JSON `true` must not pass for a package `1`, nor 1.0 for `1`.
    return type(actual) is type(expected) and actual == expected


def check_passport(workflow: dict[str, Any], manifest: dict[str, Any],
                   look: dict[str, str]) -> list[str]:
    graph = json.loads(_read_verified(PASSPORT_GRAPH, PASSPORT_GRAPH_SHA256))
    template = passport_prompt_template()
    skip = set(PASSPORT_LEDGER["ui_only"]) | set(PASSPORT_LEDGER["dropped"])
    package_nodes = {str(node["id"]): node for node in graph["nodes"]}
    expected_ids = set(package_nodes) - skip
    problems: list[str] = []
    extra, missing = sorted(set(workflow) - expected_ids), sorted(expected_ids - set(workflow))
    if extra or missing:
        problems.append(f"nodes: extra {extra}, missing {missing}")
    for node_id, node in workflow.items():
        for name, value in (node.get("inputs") or {}).items():
            if isinstance(value, list) and not (
                    len(value) == 2 and type(value[0]) is str and type(value[1]) is int):
                problems.append(f"node {node_id}.{name}: list {value!r} is not a [node_id, slot] link")
    package_files: set[str] = set()
    for node_id in sorted(expected_ids & set(workflow), key=int):
        package, ours = package_nodes[node_id], workflow[node_id]
        inputs = ours.get("inputs", {})
        linked = {item["name"] for item in package.get("inputs", []) if item.get("link") is not None}
        if node_id in PASSPORT_LEDGER["lora_loader"]:
            slot = _active_lora(package)
            package_files.add(slot["lora"])
            allowed = linked | {"lora_name", "strength_model", "strength_clip"}
            if (ours.get("class_type") != "LoraLoader" or inputs.get("lora_name") != slot["lora"]
                    or not _same(inputs.get("strength_model"), slot["strength"])
                    or not _same(inputs.get("strength_clip"), slot["strength"])
                    or set(inputs) - allowed):
                problems.append(f"node {node_id}: ours {ours!r} != D16 LoraLoader "
                                f"{slot['lora']} {slot['strength']}/{slot['strength']}")
            continue
        if ours.get("class_type") != package["type"]:
            problems.append(f"node {node_id}: class {ours.get('class_type')!r} != package {package['type']!r}")
            continue
        widgets = _widget_values(package)
        for name, value in widgets.items():
            if isinstance(value, str) and value.endswith((".safetensors", ".pt", ".pth")):
                package_files.add(PurePosixPath(value).name)
            if name in HARNESS_FIELDS or (node_id, name) == PASSPORT_LEDGER["prompt_node"]:
                # Exempt in value only: the harness overwrites the key, so it must exist.
                kind = int if name == "seed" else str
                if type(inputs.get(name)) is not kind:
                    problems.append(f"node {node_id}.{name}: harness-substituted field missing "
                                    f"or not {kind.__name__}")
                continue
            expected, row = PASSPORT_LEDGER["overrides"].get((node_id, name), (value, None))
            actual = inputs.get(name, "<missing>")
            if not _same(actual, expected):
                source = f"ledger {row}" if row else "package"
                problems.append(f"node {node_id}.{name}: ours {actual!r} != {source} {expected!r}")
        unknown = sorted(k for k in inputs if k not in widgets and k not in linked)
        if unknown:
            problems.append(f"node {node_id}: extra inputs {unknown}")
    only_ours = _api_edges(workflow) - _package_edges(graph, skip)
    only_package = _package_edges(graph, skip) - _api_edges(workflow)
    if only_ours or only_package:
        problems.append(f"topology: only ours {sorted(only_ours)}; only package {sorted(only_package)}")
    models = manifest.get("models", [])
    names = [PurePosixPath(model["filename"]).name for model in models]
    repeated = sorted({name for name in names if names.count(name) > 1})
    if repeated:
        problems.append(f"models: duplicate basenames {repeated}")
    if set(names) != package_files:
        problems.append(f"models: ours {sorted(set(names))} != package {sorted(package_files)}")
    for name, model in zip(names, models):
        stated = INSTALLER_SHA256.get(name)
        if stated and model.get("sha256") != stated:
            problems.append(f"model {name}: sha256 {model.get('sha256')} != installer-stated {stated}")
        if "pickle_ack" in model and name not in PICKLE_HATCH_FILES:
            problems.append(f"model {name}: pickle hatch not allowed for this file (spec §6)")
    jobs = manifest.get("jobs") or []
    if [job.get("seed") for job in jobs] != PASSPORT_SEEDS:
        problems.append(f"seeds: {[job.get('seed') for job in jobs]} != 148-159 (ledger D19)")
    expected_prompt = render_passport_prompt(template, look["hair"], look["eyes"])
    for index, job in enumerate(jobs):
        substitutions = job.get("substitutions") or []
        if [(s.get("node_id"), s.get("field")) for s in substitutions] != [("4", "text")]:
            problems.append(f"job {index}: substitutions must target only node 4 text")
            continue
        prompt = substitutions[0].get("value")
        if prompt != expected_prompt:
            problems.append(f"prompt {index}: differs from the copy block with only the hair/eye slots filled")
        for key, phrase in look.items():
            if key not in ("hair", "eyes") and phrase and phrase in str(prompt):
                problems.append(f"prompt {index}: carries identity.look.{key} ({phrase!r})")
    return problems

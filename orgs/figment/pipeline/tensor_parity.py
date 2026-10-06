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
        for key in ("age_stage", "hair", "eyes", "skin", "brows", "makeup", "build", "clothing"):
            phrase = look.get(key)
            if key not in ("hair", "eyes") and phrase and phrase in str(prompt):
                problems.append(f"prompt {index}: carries identity.look.{key} ({phrase!r})")
    return problems

DATASET_GRAPH = PACKAGE_ROOT / "10_dataset_generator_v2" / "10sorlabs_dataset_generator_v2.json"
DATASET_GRAPH_SHA256 = "06a2fa9f2f572f1281d85ae38b790a6c1806f05affb714d2b4995d7374751b04"
TESTER_GRAPH = PACKAGE_ROOT / "11_lora_training_krea" / "10sorlabs_dataset_tester.json"
TESTER_GRAPH_SHA256 = "864819c10d910cae6190d781eaaca9eccd8d29507c4a09416bf9dcbb56a4f8a6"
R1_GRAPH = PACKAGE_ROOT / "04_generating_a_dataset" / "10sorlabs_dataset_generator.json"
R1_GRAPH_SHA256 = "2beb21a118b600d01a520367593f9bb920ec680e6885cb4894e0f628bcf9bd6e"
DATASET_WORKFLOW = HERE / "expand/workflows/tensor_dataset_m10_api.json"
TESTER_WORKFLOW = HERE / "train/workflows/tensor_tester_m11_api.json"


def _source(path, digest):
    return json.loads(_read_verified(path, digest))


def _effective_export(graph, roots):
    """Walk live inputs, not stale widgets; collapse only typed UI indirections."""
    nodes = {str(n["id"]): n for n in graph["nodes"]}
    links = {edge[0]: edge for edge in graph["links"]}
    setters = {n["widgets_values"][0]: n for n in nodes.values() if n["type"] == "SetNode"}
    result = {}

    def edge(link):
        _, src, slot, *_ = links[link]
        node = nodes[str(src)]
        kind = node["type"]
        if kind == "GetNode":
            return edge(setters[node["widgets_values"][0]]["inputs"][0]["link"])
        if kind == "SetNode" or node.get("mode") == 4:
            live = [i for i in node["inputs"] if i.get("link") is not None]
            if len(live) != 1:
                raise ParityError("ambiguous bypass")
            return edge(live[0]["link"])
        if kind == "PrimitiveStringMultiline":
            return "__PROMPT_" + str(src) + "__"
        if kind == "CR Prompt List":
            return "__ROW_" + str(src) + "__"
        visit(str(src))
        return [str(src), slot]

    def visit(node_id):
        if node_id in result:
            return
        node = nodes[node_id]
        # R1 replaces all three outputs of the excluded AIO checkpoint.
        if node_id == "701" and graph is not None:
            return
        inputs = _widget_values(node)
        for item in node.get("inputs", []):
            if item.get("link") is not None:
                inputs[item["name"]] = edge(item["link"])
        if node["type"] == "LoadImage":
            inputs.pop("upload", None)  # frontend upload button, not an API input
            inputs["image"] = "__FACE_IMAGE__" if node_id == "836" else "__BODY_IMAGE__"
        result[node_id] = {"class_type": node["type"], "inputs": inputs}
    for root in roots:
        visit(str(root))
    return result


def dataset_workflow():
    graph = _source(DATASET_GRAPH, DATASET_GRAPH_SHA256)
    result = _effective_export(graph, [832, 833])
    del result["833"]  # U7: one final output selected per harness job
    r1 = _source(R1_GRAPH, R1_GRAPH_SHA256)
    stack = _effective_export(r1, [2, 3, 4])
    for key, node in stack.items():
        for field, value in node["inputs"].items():
            if isinstance(value, list):
                node["inputs"][field] = ["r1_" + value[0], value[1]]
        result["r1_" + key] = node
    replacements = {0: ["r1_2", 0], 1: ["r1_3", 0], 2: ["r1_4", 0]}
    for node in result.values():
        for field, value in node["inputs"].items():
            if isinstance(value, list) and value[0] == "701":
                node["inputs"][field] = replacements[value[1]]
    return result


def dataset_prompt_blocks(hair, eyes, body_description):
    for value in (hair, eyes, body_description):
        if not isinstance(value, str) or not value.strip() or "{" in value or "}" in value:
            raise ParityError("dataset slots require nonempty text without braces")
    graph = _source(DATASET_GRAPH, DATASET_GRAPH_SHA256)
    nodes = {n["id"]: n for n in graph["nodes"]}
    # Spec 4.2 names these exact editable spans of the two primitive strings.
    face = nodes[761]["widgets_values"][0].replace("long platinum blone hair", hair.strip()).replace("grey eyes", eyes.strip() if eyes.strip().endswith("eyes") else eyes.strip() + " eyes")
    body = nodes[760]["widgets_values"][0]
    body = body[:body.index("she has ") + len("she has ")].replace("platinum blonde hair", hair.strip()) + body_description.strip()
    result = {}
    for branch, node_id, prefix in (("face", 179, face), ("body", 697, body)):
        widgets = _widget_values(nodes[node_id])
        rows = widgets["multiline_text"].splitlines()
        start = widgets["start_index"]
        rows = rows[start:start + widgets["max_rows"]]
        if len(rows) != 15 or widgets["append_text"]:
            raise ParityError("module 10 prompt list shape changed")
        result[branch] = {"identity": prefix, "rows": rows}
    return result


def tester_workflow():
    graph = _source(TESTER_GRAPH, TESTER_GRAPH_SHA256)
    result = _effective_export(graph, [407])
    result["408"]["inputs"]["text"] = "__TESTER_PROMPT__"
    result["411"]["inputs"]["lora_name"] = "__CHECKPOINT__"
    result["900"] = {"class_type": "SaveImage", "inputs": {"images": ["407", 0], "filename_prefix": "tester"}}
    return result


def _compare_export(workflow, expected, mutable):
    problems = []
    if set(workflow) != set(expected):
        problems.append("nodes: export differs from effective source graph")
    for node_id in set(workflow) & set(expected):
        actual, wanted = workflow[node_id], expected[node_id]
        if actual.get("class_type") != wanted["class_type"]:
            problems.append(f"node {node_id}: class differs from source")
        inputs = actual.get("inputs", {})
        if set(inputs) != set(wanted["inputs"]):
            problems.append(f"node {node_id}: input keys differ from source")
        for field, value in wanted["inputs"].items():
            if (node_id, field) in mutable:
                continue
            if not _same(inputs.get(field), value):
                problems.append(f"node {node_id}.{field}: differs from effective source")
    return problems


def _phase2_model_hashes():
    installer = DATASET_GRAPH.parent / "dataset_generator_model_installer.bat"
    text = _read_verified(installer, "f46cdb5a8151c65fb68b7a246a5e10e3e0b2cf7986858daea623533690c0785f").decode("utf-8")
    stated = {}
    for _url, destination, digest in re.findall(r'call :download\s+"([^"\n]+)"\s+"([^"\n]+)"\s+"([a-f0-9]{64})"', text):
        stated[destination.replace("\\", "/").split("/")[-1]] = digest
    # Previously verified HF pins, and R1's 2026-10-05 public HEAD receipt.
    stated.update({
        "qwen_image_vae.safetensors": "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
        "qwen_image_edit_2511_bf16.safetensors": "ae42d927b5fac4f278b9a894554c727e619727a63622976f2d95625be4bce08c",
        "qwen_2.5_vl_7b_fp8_scaled.safetensors": "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4",
        "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors": "22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f",
        "krea2_turbo_fp8_scaled.safetensors": "eb4dd8c612cfd10f64f25b057e6e6bbcb5737c94a7372177e456dbf7579502f1",
        "qwen3vl_4b_fp8_scaled.safetensors": "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094",
    })
    return stated


def _model_check(workflow, manifest):
    expected = {PurePosixPath(v).name for n in workflow.values() for k, v in n["inputs"].items()
                if k in {"unet_name", "clip_name", "vae_name", "lora_name", "model_name"}
                and isinstance(v, str) and v.endswith((".safetensors", ".pt", ".pth"))}
    models = manifest.get("models", [])
    names = [PurePosixPath(m["filename"]).name for m in models]
    problems = []
    if len(names) != len(set(names)) or set(names) != expected:
        problems.append("models: names differ from effective source or duplicate basenames")
    hashes = _phase2_model_hashes()
    for model in models:
        name = PurePosixPath(model["filename"]).name
        if not re.fullmatch(r"[0-9a-f]{64}", str(model.get("sha256", ""))):
            problems.append(f"model {name}: verified sha256 unavailable")
        if "pickle_ack" in model and name not in PICKLE_HATCH_FILES:
            problems.append(f"model {name}: pickle hatch not allowed")
        if name not in hashes or model.get("sha256") != hashes[name]:
            problems.append(f"model {name}: installer hash mismatch")
    return problems



def _node_pin_check(manifest, dataset):
    expected = {"https://github.com/ClownsharkBatwing/RES4LYF": "e716cd1cb2c5cff90131bf4914b75b75a0489d48"}
    if dataset:
        expected.update({
            "https://github.com/ltdrdata/ComfyUI-Impact-Pack": "429d0159ad429e64d2b3916e6e7be9c22d025c3c",
            "https://github.com/cubiq/ComfyUI_FaceAnalysis": "8846653446a6b13582da11793faf950325a398e0",
            "https://github.com/kijai/ComfyUI-KJNodes": "8692bc8ef8beaaeee80fd52ba80477dc9e61547b",
        })
    rows = manifest.get("custom_nodes", [])
    actual = {n.get("git_url", "").removesuffix(".git"): n.get("installer_pin", n.get("git_ref")) for n in rows}
    return [] if len(rows) == len(actual) and actual == expected else ["custom nodes: dependency pins differ from approved source mapping"]

def check_dataset(workflow, manifest, look, body_description):
    expected = dataset_workflow()
    mutable = {(n, f) for n, f in (("836", "image"), ("837", "image"), ("832", "filename_prefix"), ("832", "images"), ("174", "prompt"), ("676", "prompt"), ("800", "text"), ("780", "text"))}
    mutable |= {(n, "seed") for n in ("646", "672", "788", "778")}
    problems = _compare_export(workflow, expected, mutable) + _model_check(expected, manifest) + _node_pin_check(manifest, True)
    blocks = dataset_prompt_blocks(look["hair"], look["eyes"], body_description)
    for n, branch in (("800", "face"), ("780", "body")):
        value = workflow.get(n, {}).get("inputs", {}).get("text")
        if value not in (expected[n]["inputs"]["text"], blocks[branch]["identity"]):
            problems.append(f"node {n}.text: refine prefix mismatch")
    for n in ("174", "676"):
        if workflow.get(n, {}).get("inputs", {}).get("prompt") != expected[n]["inputs"]["prompt"]:
            problems.append(f"node {n}.prompt: only per-job source prompt substitution allowed")
    face_image = workflow.get("836", {}).get("inputs", {}).get("image")
    body_image = workflow.get("837", {}).get("inputs", {}).get("image")
    if not isinstance(face_image, str) or not isinstance(body_image, str) or not face_image or not body_image or face_image == body_image:
        problems.append("images: face and body require distinct nonempty bindings")
    jobs = manifest.get("jobs", [])
    seen = set()
    for index, job in enumerate(jobs):
        subs = {(str(s.get("node_id")), s.get("field")): s.get("value") for s in job.get("substitutions", [])}
        target = subs.get(("832", "images"), workflow.get("832", {}).get("inputs", {}).get("images"))
        branch = "face" if target == ["791", 0] else "body" if target == ["776", 0] else None
        if branch is None:
            problems.append(f"job {index}: invalid final output")
            continue
        block = blocks[branch]
        prompt_key = ("174", "prompt") if branch == "face" else ("676", "prompt")
        refine_key = ("800", "text") if branch == "face" else ("780", "text")
        prompt = subs.get(prompt_key)
        valid = [block["identity"] + row for row in block["rows"]]
        if prompt not in valid or subs.get(refine_key) != block["identity"]:
            problems.append(f"job {index}: effective prompt mismatch")
        identity = (branch, prompt)
        if identity in seen:
            problems.append(f"job {index}: duplicate prompt row")
        seen.add(identity)
        allowed = mutable
        if len(subs) != len(job.get("substitutions", [])) or set(subs) - allowed:
            problems.append(f"job {index}: unsupported or duplicate substitution")
    # A shard may contain fewer than 30 rows; complete fanout is enforced by the planner.
    return problems


def check_tester(workflow, manifest, prompt=None):
    expected = tester_workflow()
    mutable = {("408", "text"), ("411", "lora_name"), ("900", "filename_prefix")}
    problems = _compare_export(workflow, expected, mutable) + _model_check(expected, manifest) + _node_pin_check(manifest, False)
    texts = []
    jobs = manifest.get("jobs", [])
    checkpoints = []
    if len(jobs) != 12:
        problems.append("tester: require the complete 12-checkpoint ladder")
    for index, job in enumerate(jobs):
        subs = {(str(s.get("node_id")), s.get("field")): s.get("value") for s in job.get("substitutions", [])}
        if len(subs) != len(job.get("substitutions", [])) or set(subs) - mutable:
            problems.append(f"job {index}: unsupported or duplicate substitution")
        text = subs.get(("408", "text"), workflow.get("408", {}).get("inputs", {}).get("text"))
        texts.append(text)
        checkpoints.append(subs.get(("411", "lora_name"), workflow.get("411", {}).get("inputs", {}).get("lora_name")))
        if job.get("seed") != 1595:
            problems.append(f"job {index}: seed must be 1595")
        if prompt is not None and text != prompt:
            problems.append(f"job {index}: approved prompt mismatch")
    if len(set(checkpoints)) != len(checkpoints) or any(not isinstance(c, str) or not c.endswith(".safetensors") for c in checkpoints):
        problems.append("tester: checkpoint names must be distinct safetensors files")
    if texts and (len(set(texts)) != 1 or not isinstance(texts[0], str) or not texts[0].strip()):
        problems.append("tester: all checkpoints require one nonempty scene prompt")
    return problems


# Module07: U12 chooses the official installer fp8 model; U13 replaces the
# saved unrelated slider with the installer's head-swap LoRA at transcript1.0.
EDIT_GRAPH = PACKAGE_ROOT / "07_editing_images" / "10sorlabs_image_edit_workflow.json"
EDIT_GRAPH_SHA256 = "0d99bee74c93802d9537cafaa8b80e3ab46df9c2313fc02c60ea9feab3b2905b"
EDIT_INSTALLER_SHA256 = "458d1768ede819a441b5405cae47804102800502ef083cdf3d7dd570c70d3d5d"
EDIT_WORKFLOW = HERE / "train" / "workflows" / "tensor_edit_m07_api.json"
EDIT_LEDGER = {
    "126": "Inline prompt primitive into113.text; caller binds exact approved text",
    "145": "Singleton UI switch:143 output3 is effective width",
    "146": "Singleton UI switch:143 output4 is effective height",
    "165,167,170,171": "Disconnected notes, not executable nodes",
    "104.unet_name": "U12 official installer fp8 weights",
    "164.lora_name,strength_model": "U13 installer head-swap LoRA, transcript1.0",
}
# Public metadata receipts 2026-10-05; exact URLs in edit_tensor pin group.
# Klein SHA is installer-stated, not a claim that gated weights were fetched.
EDIT_MODEL_PINS = {
    "flux-2-klein-9b-fp8.safetensors": (
        "black-forest-labs/FLUX.2-klein-9b-fp8", "flux-2-klein-9b-fp8.safetensors",
        "902d9d510b51533e07729f19211414a3648b77d2",
        "865ba09f5b4c3cbd3468a4bd3acb9fcb2f8740c54317482f0bcd4ed1d3655cee", "diffusion_models"),
    "qwen_3_8b_fp8mixed.safetensors": (
        "Comfy-Org/vae-text-encorder-for-flux-klein-9b", "split_files/text_encoders/qwen_3_8b_fp8mixed.safetensors",
        "3f62d9d8ae1fec33c6e91453d5c712855b096b55",
        "abad16806e0cbabc54e0325d6565847443fe396d5f0be38bb3cd3fe75a1201d6", "text_encoders"),
    "flux2-vae.safetensors": (
        "Comfy-Org/flux2-dev", "split_files/vae/flux2-vae.safetensors",
        "ed33133cd56476eac818c0943b6f9419b3e4a3a1",
        "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5", "vae"),
    "bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors": (
        "Alissonerdx/BFS-Best-Face-Swap", "bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors",
        "0ca3913ade4b4ada458d60c232354e8586c4c181",
        "70d8aaf332d710b905d5085afaa87c3ef577edffd54ffcfadeb8c47a854f9044", "loras"),
}
EDIT_NODE_PINS = {
    "https://github.com/yolain/ComfyUI-Easy-Use": "070001b36be2bbdfcf766b6a2d6f14c36cb62906",
    "https://github.com/chflame163/ComfyUI_LayerStyle": "3d53de09d8c1fb904d5cb0a137b9bc75e9d77108",
}


def edit_workflow():
    """Derive executable edges from the hash-bound UI graph, retaining easy int."""
    graph = _source(EDIT_GRAPH, EDIT_GRAPH_SHA256)
    _read_verified(EDIT_GRAPH.parent / "image_edit_models.bat", EDIT_INSTALLER_SHA256)
    nodes = {str(n["id"]): n for n in graph["nodes"]}
    links = {edge[0]: edge for edge in graph["links"]}
    result = {}

    def edge(link):
        _, source, slot, *_ = links[link]
        source = str(source)
        if source == "126":
            return "__EDIT_PROMPT__"
        if source in {"145", "146"}:
            incoming = [i["link"] for i in nodes[source]["inputs"] if i.get("link") is not None]
            if len(incoming) != 1:
                raise ParityError(f"edit switch {source} is not a singleton")
            return edge(incoming[0])
        visit(source)
        return [source, slot]

    def visit(node_id):
        if node_id in result:
            return
        node = nodes[node_id]
        inputs = _widget_values(node)
        for item in node["inputs"]:
            if item.get("link") is not None:
                inputs[item["name"]] = edge(item["link"])
        if node_id in {"76", "169"}:
            inputs.pop("upload")
            inputs["image"] = "__BASE_IMAGE__" if node_id == "76" else "__IDENTITY_IMAGE__"
        if node_id == "104":
            inputs["unet_name"] = "flux-2-klein-9b-fp8.safetensors"
        if node_id == "164":
            inputs.update(lora_name="bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors", strength_model=1.0)
        result[node_id] = {"class_type": node["type"], "inputs": inputs}

    visit("163")
    return result


def _edit_pin_problems(manifest):
    problems = []
    models = manifest.get("models", [])
    names = [PurePosixPath(str(m.get("filename", ""))).name for m in models]
    if len(names) != len(set(names)) or set(names) != set(EDIT_MODEL_PINS):
        problems.append("edit models: expected exact four files without duplicate basenames")
    for name, model in zip(names, models):
        wanted = EDIT_MODEL_PINS.get(name)
        if wanted is None:
            continue
        actual = tuple(model.get(k) for k in ("repo_id", "filename", "revision", "sha256", "destination_dir"))
        expected = (*wanted[:4], "/workspace/ComfyUI/models/" + wanted[4])
        if actual != expected:
            problems.append(f"edit model {name}: immutable source pin mismatch")
        if "pickle_ack" in model:
            problems.append(f"edit model {name}: pickle hatch not permitted")
    rows = manifest.get("custom_nodes", [])
    actual_nodes = {}
    for row in rows:
        url = row.get("git_url", "").removesuffix(".git")
        pin = row.get("git_ref", row.get("installer_pin"))
        if row.get("installer_pin", pin) != pin:
            problems.append("edit custom nodes: conflicting pin aliases")
        actual_nodes[url] = pin
    if len(rows) != len(actual_nodes) or actual_nodes != EDIT_NODE_PINS:
        problems.append("edit custom nodes: source-declared immutable dependency mapping differs")
    return problems


def edit_readiness_problems(manifest):
    """Offline dependency integrity only; live HEAD/access checks remain mandatory.

    A clear return does not prove runtime compatibility, gated model access, or
    production approval. Caller must still enforce its live preflight/fixture gate.
    """
    problems = _edit_pin_problems(manifest)
    if manifest.get("fixture") or manifest.get("synthetic") or manifest.get("fixture_only"):
        problems.append("edit fixture/synthetic evidence is not production readiness")
    return problems


def check_edit(workflow, manifest, *, prompt=None, base_image=None, identity_image=None):
    """Check frozen request bindings and every effective module07 graph field."""
    expected = edit_workflow()
    for node, field, value in (("113", "text", prompt), ("76", "image", base_image), ("169", "image", identity_image)):
        if value is not None:
            expected[node]["inputs"][field] = value
    mutable = {("103", "noise_seed"), ("163", "filename_prefix")}
    problems = _compare_export(workflow, expected, mutable) + _edit_pin_problems(manifest)
    for node, field in (("113", "text"), ("76", "image"), ("169", "image")):
        value = workflow.get(node, {}).get("inputs", {}).get(field)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"edit node {node}.{field}: nonempty request binding required")
    base = workflow.get("76", {}).get("inputs", {}).get("image")
    identity = workflow.get("169", {}).get("inputs", {}).get("image")
    if isinstance(base, str) and isinstance(identity, str) and base.casefold() == identity.casefold():
        problems.append("edit images: base and identity require distinct bindings")
    if manifest.get("seed_fields") != ["noise_seed"]:
        problems.append("edit seed_fields: require noise_seed only")
    jobs = manifest.get("jobs", [])
    if not jobs:
        problems.append("edit jobs: at least one job required")
    for index, job in enumerate(jobs):
        subs = {(str(s.get("node_id")), s.get("field")): s.get("value") for s in job.get("substitutions", [])}
        if len(subs) != len(job.get("substitutions", [])) or set(subs) - mutable:
            problems.append(f"edit job {index}: unsupported or duplicate substitution")
        if job.get("expected_images") != 1:
            problems.append(f"edit job {index}: require exactly one output image")
        seed = job.get("seed")
        if type(seed) is not int or not 0 <= seed <= 2**64 - 1:
            problems.append(f"edit job {index}: invalid seed")
        if ("103", "noise_seed") in subs and subs[("103", "noise_seed")] != seed:
            problems.append(f"edit job {index}: substituted seed differs from job seed")
    return problems


def _video_parity_helper():
    # Load by our own file path, independent of the caller's cwd/sys.path.
    import importlib.util
    spec = importlib.util.spec_from_file_location("figment_tensor_video_parity", HERE / "tensor_video_parity.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def video_workflow():
    helper = _video_parity_helper()
    try:
        return helper.video_workflow()
    except helper.ParityError as exc:
        raise ParityError(str(exc)) from exc


def video_pin_group():
    return _video_parity_helper().video_pin_group()


def video_output_contract(*, workflow_png=False):
    helper = _video_parity_helper()
    try:
        return helper.video_output_contract(workflow_png=workflow_png)
    except helper.ParityError as exc:
        raise ParityError(str(exc)) from exc


def video_readiness_problems(manifest):
    return _video_parity_helper().video_readiness_problems(manifest)


def check_video(workflow, manifest, *, prompt=None, driving_video=None, start_image=None):
    helper = _video_parity_helper()
    try:
        return helper.check_video(workflow, manifest, prompt=prompt, driving_video=driving_video, start_image=start_image)
    except helper.ParityError as exc:
        raise ParityError(str(exc)) from exc


def _stills_parity_helper():
    import importlib.util
    spec = importlib.util.spec_from_file_location("figment_tensor_stills_parity", HERE / "tensor_stills_parity.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stills_workflow(framing="full"):
    return _stills_parity_helper().stills_workflow(framing)


def stills_pin_group(framing="full"):
    return _stills_parity_helper().stills_pin_group(framing)


def stills_readiness_problems(manifest, framing="full"):
    return _stills_parity_helper().stills_readiness_problems(manifest, framing)


def check_stills(workflow, manifest, *, framing="full", prompt=None, identity_lora=None, approved_prompts=None):
    return _stills_parity_helper().check_stills(workflow, manifest, framing=framing,
        prompt=prompt, identity_lora=identity_lora, approved_prompts=approved_prompts)

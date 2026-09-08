"""Closed four-row profile-prompt manifest; it has no runtime capability."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
import types
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
C1_PATH = HERE / "local_lora_matched_inference.py"
C1_SHA256 = "bca8be929852fe19eab724f878f8985e4b3f6146050e564af91d0c83e6570d6f"
C1_MAX_SOURCE = 256 * 1024
SCHEMA = "figment/local-lora-profile-inference-plan@1"
SEEDS = (481516234, 90210)
STAGES = ("profile-base", "profile-current-20")
PROFILE_PROMPT = " ".join("""figmentlocalg01probe. Photograph of one fictional adult woman around twenty-one,
framed from the top of her head to below her waist, with both elbows visible and
space above her head. Her torso and head face slightly toward image-left while
her eyes look directly into the camera. She has long center-parted jet-black
hair, dark brown almond-shaped eyes with subtly lifted outer corners, dark
arched brows, full pink lips, a tapered jaw and small chin. She wears a plain
opaque black crew-neck T-shirt. Soft daylight against a plain warm off-white wall.""".split())


class ProfileInferenceError(ValueError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical(value: dict[str, Any]) -> bytes:
    copy = dict(value)
    copy.pop("frozen_sha256", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _load_c1() -> Any:
    try:
        before = C1_PATH.stat()
        if C1_PATH.is_symlink() or not stat.S_ISREG(C1_PATH.lstat().st_mode) or not 0 < before.st_size <= C1_MAX_SOURCE:
            raise ProfileInferenceError("pinned C1 graph source has an unsafe shape")
        with C1_PATH.open("rb") as handle:
            raw = handle.read(C1_MAX_SOURCE + 1)
        after = C1_PATH.stat()
    except OSError as exc:
        raise ProfileInferenceError("pinned C1 graph source is unavailable") from exc
    if len(raw) != before.st_size or len(raw) > C1_MAX_SOURCE or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns:
        raise ProfileInferenceError("pinned C1 graph source changed while read")
    if _sha(raw) != C1_SHA256:
        raise ProfileInferenceError("pinned C1 graph source changed")
    module = types.ModuleType("figment_profile_c1")
    module.__file__ = os.fspath(C1_PATH)
    sys.modules[module.__name__] = module
    exec(compile(raw, module.__file__, "exec"), module.__dict__)
    return module


def _stage(stage: str) -> str:
    if stage == "profile-base":
        return "base"
    if stage == "profile-current-20":
        return "current-20"
    raise ProfileInferenceError("profile stage is invalid")


def _seed(seed: int) -> int:
    if seed not in SEEDS:
        raise ProfileInferenceError("seed is outside the fixed profile pair")
    return seed


def _replace_positive(c1_graph: dict[str, dict[str, Any]], c1: Any) -> dict[str, dict[str, Any]]:
    graph = json.loads(json.dumps(c1_graph, sort_keys=True, separators=(",", ":")))
    positives = [node for node in graph.values() if node.get("class_type") == "CLIPTextEncode" and node.get("inputs", {}).get("text") == c1.PROMPT]
    if len(positives) != 1:
        raise ProfileInferenceError("pinned C1 graph has no unique positive prompt")
    positives[0]["inputs"]["text"] = PROFILE_PROMPT
    return graph


def _without_positive(graph: dict[str, dict[str, Any]], *, prompt: str) -> bytes:
    copy = json.loads(json.dumps(graph, sort_keys=True, separators=(",", ":")))
    positives = [node for node in copy.values() if node.get("class_type") == "CLIPTextEncode" and node.get("inputs", {}).get("text") == prompt]
    if len(positives) != 1:
        raise ProfileInferenceError("profile graph has no unique positive prompt")
    positives[0]["inputs"]["text"] = "<positive-prompt-removed>"
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def graph(stage: str, seed: int) -> dict[str, dict[str, Any]]:
    c1 = _load_c1()
    seed = _seed(seed)
    c1_stage = _stage(stage)
    name = None if c1_stage == "base" else c1.SLOTS["current-20"]["filename"]
    original = c1.graph(c1_stage, seed, staged_lora_name=name)
    profile = _replace_positive(original, c1)
    if _without_positive(original, prompt=c1.PROMPT) != _without_positive(profile, prompt=PROFILE_PROMPT):
        raise ProfileInferenceError("profile graph changed a non-prompt field")
    return profile


def build_manifest() -> dict[str, Any]:
    c1 = _load_c1()
    rows: list[dict[str, Any]] = []
    for stage_index, stage in enumerate(STAGES):
        c1_stage = _stage(stage)
        checkpoint = None if c1_stage == "base" else dict(c1.SLOTS["current-20"])
        for seed in SEEDS:
            rows.append({"id": f"{stage}-seed-{seed}", "stage": stage, "stage_index": stage_index, "seed": seed,
                         "baseline_id": None if c1_stage == "base" else f"profile-base-seed-{seed}",
                         "c1_stage": c1_stage, "checkpoint": checkpoint, "graph": graph(stage, seed)})
    plan: dict[str, Any] = {
        "schema": SCHEMA,
        "purpose": "one-off-local-profile-prompt-calibration",
        "not_promotable": True,
        "phase": "C3-B-profile-manifest-only",
        "execution": {"implemented": False, "reason": "planner emits data only; execution requires a separately verified controller and admission"},
        "c1_sha256": C1_SHA256,
        "prompt": {"normalized": PROFILE_PROMPT, "negative": c1.NEGATIVE, "sha256": _sha((PROFILE_PROMPT + "\n" + c1.NEGATIVE).encode())},
        "seeds": list(SEEDS),
        "sampler": dict(c1.SAMPLER),
        "rows": rows,
        "batches": [
            {"index": 0, "stage": "profile-base", "row_ids": [f"profile-base-seed-{seed}" for seed in SEEDS], "requires_profile_base_diagnostic_records": []},
            {"index": 1, "stage": "profile-current-20", "row_ids": [f"profile-current-20-seed-{seed}" for seed in SEEDS], "requires_profile_base_diagnostic_records": ["root", "independent"]},
        ],
    }
    plan["frozen_sha256"] = _sha(_canonical(plan))
    return plan


def validate_manifest(plan: dict[str, Any]) -> None:
    if not isinstance(plan, dict):
        raise ProfileInferenceError("profile manifest is invalid")
    frozen = plan.get("frozen_sha256")
    if not isinstance(frozen, str) or _sha(_canonical(plan)) != frozen:
        raise ProfileInferenceError("profile manifest frozen hash is invalid")
    if plan != build_manifest():
        raise ProfileInferenceError("profile manifest differs from its closed C3-B plan")

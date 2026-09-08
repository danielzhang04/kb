"""Offline graph and manifest builder for the staged local LoRA comparison.

Phase C1 deliberately has no filesystem checkpoint reader, ComfyUI client,
process launcher, image writer, or producer-receipt implementation.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA = "figment/local-lora-matched-inference-plan@1"
SEEDS = (481516234, 90210)
PROMPT = " ".join("""Photographic waist-up portrait of a fictional adult woman around twenty-one,
turned slightly toward her own right with eyes to camera, wearing a plain opaque
black top, in soft daylight against a plain warm off-white wall,
figmentlocalg01probe.""".split())
NEGATIVE = "child, minor, nude, lingerie, explicit, extra person, duplicate person, distorted face"
SAMPLER = {"width": 1024, "height": 1024, "steps": 24, "cfg": 6.0,
           "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0}
HEX = re.compile(r"^[0-9a-f]{64}$")
STAGES = ("base", "current-20", "current-50", "current-final100", "concise-50")
SLOTS = {
    "current-20": {"branch": "current", "filename": "figmentlocalg01quality-current-100-step00000020.safetensors", "steps": "20"},
    "current-50": {"branch": "current", "filename": "figmentlocalg01quality-current-100-step00000050.safetensors", "steps": "50"},
    "current-final100": {"branch": "current", "filename": "figmentlocalg01quality-current-100.safetensors", "steps": "100"},
    "concise-50": {"branch": "concise", "filename": "figmentlocalg01quality-concise-100-step00000050.safetensors", "steps": "50"},
}


class MatchedInferenceError(ValueError):
    pass


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical(value: dict[str, Any]) -> bytes:
    copy = dict(value)
    copy.pop("frozen_sha256", None)
    return json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _hash(value: str, label: str) -> str:
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise MatchedInferenceError(f"{label} must be a SHA-256")
    return value


def _seed(value: int) -> int:
    if value not in SEEDS:
        raise MatchedInferenceError("seed is outside the fixed matched pair")
    return value


def _staged_name(value: str) -> str:
    if not isinstance(value, str) or not value.endswith(".safetensors") or value != value.rsplit("/", 1)[-1] or "\\" in value:
        raise MatchedInferenceError("LoRA name must be a staged safetensors basename")
    return value


def graph(stage: str, seed: int, *, staged_lora_name: str | None = None) -> dict[str, dict[str, Any]]:
    """Build one core-only, one-image Comfy API graph without invoking Comfy."""
    _seed(seed)
    if stage == "base":
        if staged_lora_name is not None:
            raise MatchedInferenceError("base graph cannot select a LoRA")
        model, clip = ["1", 0], ["1", 1]
        positive, negative, latent, sampler, decoded = "2", "3", "4", "5", "6"
        result = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "RealVisXL_V5.0_fp16.safetensors"}},
            positive: {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": clip}},
            negative: {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": clip}},
            latent: {"class_type": "EmptyLatentImage", "inputs": {"width": SAMPLER["width"], "height": SAMPLER["height"], "batch_size": 1}},
        }
    elif stage in SLOTS:
        name = _staged_name(staged_lora_name or "")
        if name != SLOTS[stage]["filename"]:
            raise MatchedInferenceError("LoRA name does not match the selected checkpoint slot")
        model, clip = ["2", 0], ["2", 1]
        positive, negative, latent, sampler, decoded = "3", "4", "5", "6", "7"
        result = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "RealVisXL_V5.0_fp16.safetensors"}},
            "2": {"class_type": "LoraLoader", "inputs": {"model": ["1", 0], "clip": ["1", 1], "lora_name": name, "strength_model": 1.0, "strength_clip": 0.0}},
            positive: {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": clip}},
            negative: {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": clip}},
            latent: {"class_type": "EmptyLatentImage", "inputs": {"width": SAMPLER["width"], "height": SAMPLER["height"], "batch_size": 1}},
        }
    else:
        raise MatchedInferenceError("unknown comparison stage")
    result[sampler] = {"class_type": "KSampler", "inputs": {"model": model, "seed": seed, **{key: SAMPLER[key] for key in ("steps", "cfg", "sampler_name", "scheduler", "denoise")}, "positive": [positive, 0], "negative": [negative, 0], "latent_image": [latent, 0]}}
    result[decoded] = {"class_type": "VAEDecode", "inputs": {"samples": [sampler, 0], "vae": ["1", 2]}}
    result["11"] = {"class_type": "SaveImage", "inputs": {"images": [decoded, 0], "filename_prefix": "figment-local-lora-matched"}}
    return result


def _slot(stage: str, current_plan_sha256: str, concise_plan_sha256: str) -> dict[str, Any] | None:
    if stage == "base":
        return None
    selected = dict(SLOTS[stage])
    selected["producer_plan_sha256"] = current_plan_sha256 if selected["branch"] == "current" else concise_plan_sha256
    selected["producer_receipt_validation"] = "not-implemented-phase-c1"
    return selected


def build_manifest(current_plan_sha256: str, *, concise_plan_sha256: str) -> dict[str, Any]:
    """Return a frozen graph-only plan. It is not executable in Phase C1."""
    current = _hash(current_plan_sha256, "current quality plan hash")
    concise = _hash(concise_plan_sha256, "concise quality plan hash")
    rows: list[dict[str, Any]] = []
    for stage_index, stage in enumerate(STAGES):
        selected = _slot(stage, current, concise)
        for seed in SEEDS:
            name = None if selected is None else selected["filename"]
            rows.append({"id": f"{stage}-seed-{seed}", "stage": stage, "stage_index": stage_index, "seed": seed,
                         "baseline_id": f"base-seed-{seed}", "checkpoint": selected,
                         "graph": graph(stage, seed, staged_lora_name=name)})
    plan: dict[str, Any] = {
        "schema": SCHEMA, "purpose": "staged-local-one-source-lora-comparison", "not_promotable": True,
        "phase": "C1-graph-manifest-only", "execution": {"implemented": False, "reason": "producer receipt interface and runtime executor are not implemented"},
        "prompt": {"normalized": PROMPT, "negative": NEGATIVE, "sha256": _sha((PROMPT + "\n" + NEGATIVE).encode())},
        "seeds": list(SEEDS), "sampler": dict(SAMPLER), "rows": rows,
        "batches": [{"index": index, "stage": stage, "row_ids": [f"{stage}-seed-{seed}" for seed in SEEDS],
                     "requires_prior_review": index > 0,
                     "requires_concise_training": stage == "concise-50"} for index, stage in enumerate(STAGES)],
        "producer_bindings": {"current_plan_sha256": current, "concise_plan_sha256": concise},
        "recognized_unet_keys": {"required_prefix": "lora_unet_", "minimum_recognized_keys": "not-implemented-phase-c1", "missing_key_log": "required-before-execution"},
    }
    plan["frozen_sha256"] = _sha(_canonical(plan))
    return plan


def validate_manifest(plan: dict[str, Any]) -> None:
    if not isinstance(plan, dict):
        raise MatchedInferenceError("matched inference plan is invalid")
    bindings = plan.get("producer_bindings")
    if not isinstance(bindings, dict):
        raise MatchedInferenceError("producer plan bindings are invalid")
    current = _hash(bindings.get("current_plan_sha256"), "current quality plan hash")
    concise = bindings.get("concise_plan_sha256")
    if concise is not None:
        concise = _hash(concise, "concise quality plan hash")
    expected = build_manifest(current, concise_plan_sha256=concise)
    if plan != expected:
        raise MatchedInferenceError("matched inference plan differs from its closed C1 manifest")


def validate_producer_receipt(_receipt: dict[str, Any]) -> None:
    """Phase C1 intentionally refuses a producer receipt until Phase B defines it."""
    raise MatchedInferenceError("producer receipt validation is not implemented in Phase C1")

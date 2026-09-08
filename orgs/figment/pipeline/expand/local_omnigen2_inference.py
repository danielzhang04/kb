"""Pure-data planner for the fixed local OmniGen2 single-reference research probe.

Source of truth: docs/figment/2026-09-08-local-omnigen2-feasibility.md. This module
only builds and validates frozen data (ComfyUI API graphs + a pinned manifest). It
never reads model or reference bytes, never imports ComfyUI or torch, and does not
execute anything. Research-only; non-promotable; commercial use uncleared.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

SCHEMA = "figment/local-omnigen2-inference-plan@1"
FEASIBILITY_DOC = "docs/figment/2026-09-08-local-omnigen2-feasibility.md"
FEASIBILITY_SHA256 = "daf48e21a2eabd2b9f9d4e44f5ec464108a884a95cacc81bb12f952379823939"
COMFY_COMMIT = "95d755cd8107a72258d452b5d3657273d571f07d"
TEMPLATE_SNAPSHOT = {
    "name": "figment-omnigen2-template-20260908-v1/workflow.json",
    "origin": "Comfy-Org/workflow_templates templates/image_omnigen2_image_edit.json",
    "bytes": 26553,
    "sha256": "3a63f64bf3b58ad8fa761e4606d7d5ca1e6efd42fc1df57afe9e3e6d075ca593",
}
MODEL_REVISION = "4876f2222e35e269029e8d72aaff5b2aaaf73e1b"
MODELS = {
    "diffusion": {
        "file": "omnigen2_fp16.safetensors",
        "directory": "diffusion_models",
        "repo": "Comfy-Org/Omnigen2_ComfyUI_repackaged",
        "revision": MODEL_REVISION,
        "path": "split_files/diffusion_models/omnigen2_fp16.safetensors",
        "bytes": 7934384176,
        "sha256": "60dbde45107762d164bac463e1cf365e074b377fa843dc90cb2985fb211cd4de",
    },
    "clip": {
        "file": "qwen_2.5_vl_fp16.safetensors",
        "directory": "text_encoders",
        "repo": "Comfy-Org/Omnigen2_ComfyUI_repackaged",
        "revision": MODEL_REVISION,
        "path": "split_files/text_encoders/qwen_2.5_vl_fp16.safetensors",
        "bytes": 7509337224,
        "sha256": "ba05dd266ad6a6aa90f7b2936e4e775d801fb233540585b43933647f8bc4fbc3",
    },
    "vae": {
        "file": "ae.safetensors",
        "directory": "vae",
        "repo": "Comfy-Org/Omnigen2_ComfyUI_repackaged",
        "revision": MODEL_REVISION,
        "path": "split_files/vae/ae.safetensors",
        "bytes": 335304388,
        "sha256": "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
    },
}
MODEL_PAYLOAD_BYTES = 15779025788
REFERENCE = {
    "filename": "g01.jpg",
    "sha256": "e2f5cca280b7753a0d0d562c7f23f2ee0ea5322e9a82b2ac75f76397227536ed",
    "width": 1408,
    "height": 768,
}
SEEDS = (481516234, 90210)
WIDTH = 768
HEIGHT = 768
BATCH_SIZE = 1
SAMPLER = "euler"
SCHEDULER = "simple"
STEPS = 20
DENOISE = 1.0
TEXT_CFG = 5.0
IMAGE_CFG = 2.5
GUIDER_STYLE = "regular"
SCALE_METHOD = "area"
SCALE_MEGAPIXELS = 1.0
SAVE_PREFIX = "figment-local-omnigen2"
POSITIVE_PROMPT = (
    "Using the woman in image 1 as the identity reference, create a waist-up "
    "photograph of the same fictional adult woman around twenty-one. Frame from the "
    "top of her head to below her waist, with both elbows visible and space above "
    "her head. Her torso and head turn slightly toward her own right (image-left) "
    "while her eyes look directly into the camera. She wears a plain opaque black "
    "crew-neck T-shirt in soft daylight against a plain warm off-white wall. "
    "Preserve her facial structure, eyelids, brows, nose, lips, jaw, hairline, and "
    "long center-parted jet-black hair; do not copy the source pose, crop, "
    "background, lighting, or clothing."
)
NEGATIVE_PROMPT = (
    "child, minor, nude, lingerie, explicit, extra person, duplicate person, "
    "deformed, blurry, bad anatomy, distorted face, extra limb, fused fingers, "
    "text, watermark, censor bar"
)

# Node ids follow the official template so the API graph can be read against it.
# Template nodes 33/34/37/38/39 (second reference chain), 32 (GetImageSize) and
# 40/42/43 (notes) are intentionally absent: this is the ONE-reference path.
N_UNET, N_CLIP, N_VAE, N_LOAD, N_SCALE, N_ENCODE = "12", "10", "13", "16", "17", "14"
N_POS, N_NEG, N_REF_POS, N_REF_NEG, N_LATENT = "6", "7", "15", "29", "11"
N_NOISE, N_GUIDER, N_SAMPLER, N_SCHED, N_ADV, N_DECODE, N_SAVE = "21", "27", "20", "23", "28", "8", "9"


class ManifestMismatch(ValueError):
    """Raised when a manifest is not byte-for-byte the frozen plan."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_of(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _node(class_type: str, **inputs: Any) -> dict[str, Any]:
    return {"class_type": class_type, "inputs": inputs}


def graph(seed: int) -> dict[str, dict[str, Any]]:
    """ComfyUI API-format graph for one of the two fixed seeds."""
    if type(seed) is not int or seed not in SEEDS:
        raise ValueError(f"seed must be one of {SEEDS}, got {seed!r}")
    return {
        N_UNET: _node("UNETLoader", unet_name=MODELS["diffusion"]["file"], weight_dtype="default"),
        N_CLIP: _node("CLIPLoader", clip_name=MODELS["clip"]["file"], type="omnigen2", device="default"),
        N_VAE: _node("VAELoader", vae_name=MODELS["vae"]["file"]),
        N_LOAD: _node("LoadImage", image=REFERENCE["filename"]),
        N_SCALE: _node("ImageScaleToTotalPixels", image=[N_LOAD, 0], upscale_method=SCALE_METHOD, megapixels=SCALE_MEGAPIXELS),
        N_ENCODE: _node("VAEEncode", pixels=[N_SCALE, 0], vae=[N_VAE, 0]),
        N_POS: _node("CLIPTextEncode", text=POSITIVE_PROMPT, clip=[N_CLIP, 0]),
        N_NEG: _node("CLIPTextEncode", text=NEGATIVE_PROMPT, clip=[N_CLIP, 0]),
        # Official wiring: cond1 = positive+reference, cond2 = negative+reference,
        # negative = plain negative text with NO reference latent.
        N_REF_POS: _node("ReferenceLatent", conditioning=[N_POS, 0], latent=[N_ENCODE, 0]),
        N_REF_NEG: _node("ReferenceLatent", conditioning=[N_NEG, 0], latent=[N_ENCODE, 0]),
        N_LATENT: _node("EmptySD3LatentImage", width=WIDTH, height=HEIGHT, batch_size=BATCH_SIZE),
        N_NOISE: _node("RandomNoise", noise_seed=seed),
        N_GUIDER: _node(
            "DualCFGGuider",
            model=[N_UNET, 0],
            cond1=[N_REF_POS, 0],
            cond2=[N_REF_NEG, 0],
            negative=[N_NEG, 0],
            cfg_conds=TEXT_CFG,
            cfg_cond2_negative=IMAGE_CFG,
            style=GUIDER_STYLE,
        ),
        N_SAMPLER: _node("KSamplerSelect", sampler_name=SAMPLER),
        N_SCHED: _node("BasicScheduler", model=[N_UNET, 0], scheduler=SCHEDULER, steps=STEPS, denoise=DENOISE),
        N_ADV: _node(
            "SamplerCustomAdvanced",
            noise=[N_NOISE, 0],
            guider=[N_GUIDER, 0],
            sampler=[N_SAMPLER, 0],
            sigmas=[N_SCHED, 0],
            latent_image=[N_LATENT, 0],
        ),
        N_DECODE: _node("VAEDecode", samples=[N_ADV, 0], vae=[N_VAE, 0]),
        N_SAVE: _node("SaveImage", images=[N_DECODE, 0], filename_prefix=SAVE_PREFIX),
    }


def manifest_hash(manifest: dict[str, Any]) -> str:
    body = {k: v for k, v in manifest.items() if k != "manifest_sha256"}
    return sha256_of(body)


def build_manifest() -> dict[str, Any]:
    """Frozen plan: pins, fixed parameters, both API graphs, per-graph and whole hashes."""
    runs = [{"seed": s, "graph_sha256": sha256_of(graph(s)), "graph": graph(s)} for s in SEEDS]
    manifest: dict[str, Any] = {
        "schema": SCHEMA,
        "status": {
            "research_only": True,
            "promotable": False,
            "commercial_use_cleared": False,
            "execution": "unimplemented; planner data only",
            "quality_acceptance_implied": False,
        },
        "source": {"feasibility_doc": FEASIBILITY_DOC, "feasibility_sha256": FEASIBILITY_SHA256, "comfy_commit": COMFY_COMMIT},
        "template": dict(TEMPLATE_SNAPSHOT),
        "models": {k: dict(v) for k, v in MODELS.items()},
        "model_payload_bytes": MODEL_PAYLOAD_BYTES,
        "reference": dict(REFERENCE),
        "fixed": {
            "width": WIDTH,
            "height": HEIGHT,
            "batch_size": BATCH_SIZE,
            "sampler": SAMPLER,
            "scheduler": SCHEDULER,
            "steps": STEPS,
            "denoise": DENOISE,
            "text_cfg": TEXT_CFG,
            "image_cfg": IMAGE_CFG,
            "guider_style": GUIDER_STYLE,
            "scale_method": SCALE_METHOD,
            "scale_megapixels": SCALE_MEGAPIXELS,
            "save_prefix": SAVE_PREFIX,
            "positive_prompt": POSITIVE_PROMPT,
            "negative_prompt": NEGATIVE_PROMPT,
        },
        "seeds": list(SEEDS),
        "runs": runs,
    }
    manifest["manifest_sha256"] = manifest_hash(manifest)
    return manifest


def _first_difference(a: Any, b: Any, path: str = "$") -> str:
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                return f"{path}.{key} (missing on one side)"
            found = _first_difference(a[key], b[key], f"{path}.{key}")
            if found:
                return found
        return ""
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            found = _first_difference(x, y, f"{path}[{i}]")
            if found:
                return found
        return ""
    return path if canonical_json(a) != canonical_json(b) else ""


def validate_manifest(manifest: Any) -> None:
    """Accept only a manifest canonically identical to build_manifest(); raise otherwise."""
    if not isinstance(manifest, dict):
        raise ManifestMismatch("manifest must be a JSON object")
    if manifest.get("schema") != SCHEMA:
        raise ManifestMismatch(f"schema mismatch: {manifest.get('schema')!r}")
    if manifest.get("manifest_sha256") != manifest_hash(manifest):
        raise ManifestMismatch("manifest_sha256 does not match manifest body")
    expected = build_manifest()
    if canonical_json(manifest) != canonical_json(expected):
        raise ManifestMismatch(f"manifest differs from frozen plan at {_first_difference(manifest, expected)}")

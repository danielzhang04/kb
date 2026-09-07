"""Load persona.yaml plus the temporary, optional training.yaml overlay.

The sidecar exists only so the live creator-001 run can finish without changing its
persona fixture. At the next quiet point its ``training`` object moves unchanged into
persona.yaml and the sidecar is removed. Two simultaneous definitions fail closed.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
PERSONA_MODULE = HERE / "persona.py"
TRAINING_KEYS = {
    "trigger", "base_arch", "steps", "save_every", "caption_mode",
    "pod_class", "price_ceiling_usd_per_hour", "skin_lora",
    "style_lora", "style_lora_strength", "chosen_checkpoint_step",
    "dop_enabled", "dop_multiplier", "dop_class",
}
DEFAULT_TRAINING = {
    "trigger": None,
    "base_arch": "krea2",
    "steps": 2000,
    "save_every": 250,
    "caption_mode": "provided",
    "pod_class": "l40s",
    "price_ceiling_usd_per_hour": 1.30,
    # Track-2 Task B1 (D26): null by default -- enabling the Qwen-edit skin LoRA on the
    # full-body second pass requires a single-cell live A/B check first (r22 §3's base-model
    # caveat: the card demonstrates Qwen-Image-Edit-2509, not our 2511 pipeline).
    "skin_lora": None,
    # Track-2 Task D2 (D28): null by default -- the gen stage's style-LoRA slot
    # (LoraLoaderModelOnly after the identity LoRA) is opt-in per persona, keyed into
    # pins.style_loras (train/tensor-pins.yaml).
    "style_lora": None,
    "style_lora_strength": 0.8,
    # Track-2 Task A3/D2: set only by `apply-rulings --stage tester` (GATE 3) once the
    # operator has picked a checkpoint. `build_plan(..., stage="gen")` refuses to plan
    # until this names a real step.
    "chosen_checkpoint_step": None,
    # Path-A train-first (r24 method 4 + r21 DOP + r25 causes #4/#5): Ostris ai-toolkit's
    # Differential Output Preservation, OFF by default. Confirmed at the pinned commit
    # (train/runs/creator-001-tensor-train.yaml training.git_ref
    # b36bb3998ae596a566d85513299696a3a78f0dcb), `toolkit/config_modules.py`
    # `TrainConfig.__init__` (`diff_output_preservation`, `diff_output_preservation_multiplier`
    # default 1.0, `diff_output_preservation_class` default ''): costs ~3x train time
    # (re-runs every step once more with the trigger replaced by `dop_class` and uses
    # that as an extra regularization target), REQUIRES a trigger word to be present in
    # the config (`extensions_built_in/sd_trainer/SDTrainer.py`: "diff_output_preservation
    # requires a trigger_word to be set"), and is REJECTED outright when
    # `train_text_encoder: true` ("is not supported with train_text_encoder" -- moot here,
    # the template always trains with it False). `dop_class` defaults to "person" per r21's
    # own community citation (chengyansen-ai/krea2-lora-training) even though every caption
    # this pipeline writes says "<trigger> woman" -- the class DOP substitutes the trigger
    # with is a deliberately more generic identity-preservation target, not required to
    # echo the caption's own descriptive noun.
    "dop_enabled": False,
    "dop_multiplier": 1.0,
    "dop_class": "person",
}
ALLOWED_ARCHES = {"krea2"}
ALLOWED_CAPTION_MODES = {"provided", "auto", "single_word"}
SAFE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SAFE_TRIGGER = re.compile(r"^[a-z][a-z0-9]*$")


class TrainingConfigError(ValueError):
    """The persona training extension is missing, ambiguous, or unsafe."""


def _load_persona_module():
    name = "_figment_training_config_persona"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, PERSONA_MODULE)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {PERSONA_MODULE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def creator_short_code(creator_id: str) -> str:
    if not isinstance(creator_id, str) or not SAFE_ID.fullmatch(creator_id):
        raise TrainingConfigError(
            "persona.id must use lowercase letters, digits, and internal hyphens"
        )
    return creator_id.replace("-", "")


def derived_trigger(creator_id: str, base_arch: str) -> str:
    arch = re.sub(r"[^a-z0-9]", "", base_arch.lower())
    if not arch:
        raise TrainingConfigError("training.base_arch cannot derive a trigger token")
    return creator_short_code(creator_id) + arch


def validate_training(raw: Any, creator_id: str) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise TrainingConfigError("persona.training must be an object")
    unknown = sorted(set(raw) - TRAINING_KEYS)
    if unknown:
        raise TrainingConfigError(f"persona.training has unknown key(s): {unknown}")
    config = dict(DEFAULT_TRAINING)
    config.update(raw)

    if config["base_arch"] not in ALLOWED_ARCHES:
        raise TrainingConfigError(
            f"persona.training.base_arch must be one of {sorted(ALLOWED_ARCHES)}"
        )
    for key in ("steps", "save_every"):
        if isinstance(config[key], bool) or not isinstance(config[key], int) or config[key] <= 0:
            raise TrainingConfigError(f"persona.training.{key} must be a positive integer")
    if config["steps"] % config["save_every"]:
        raise TrainingConfigError("persona.training.steps must be divisible by save_every")
    if config["steps"] < 2 * config["save_every"]:
        raise TrainingConfigError(
            "persona.training must produce at least one intermediate save plus the final"
        )
    if config["caption_mode"] not in ALLOWED_CAPTION_MODES:
        raise TrainingConfigError(
            f"persona.training.caption_mode must be one of {sorted(ALLOWED_CAPTION_MODES)}"
        )
    if not isinstance(config["pod_class"], str) or not config["pod_class"].strip():
        raise TrainingConfigError("persona.training.pod_class must be a non-empty string")
    if config["skin_lora"] is not None and (
        not isinstance(config["skin_lora"], str) or not config["skin_lora"].strip()
    ):
        raise TrainingConfigError(
            "persona.training.skin_lora must be a non-empty string key or null"
        )
    if config["style_lora"] is not None and (
        not isinstance(config["style_lora"], str) or not config["style_lora"].strip()
    ):
        raise TrainingConfigError(
            "persona.training.style_lora must be a non-empty string key or null"
        )
    strength = config["style_lora_strength"]
    if isinstance(strength, bool) or not isinstance(strength, (int, float)) or strength <= 0:
        raise TrainingConfigError(
            "persona.training.style_lora_strength must be a positive number"
        )
    config["style_lora_strength"] = float(strength)
    chosen_step = config["chosen_checkpoint_step"]
    if chosen_step is not None and (
        isinstance(chosen_step, bool) or not isinstance(chosen_step, int) or chosen_step <= 0
    ):
        raise TrainingConfigError(
            "persona.training.chosen_checkpoint_step must be a positive integer or null"
        )
    price = config["price_ceiling_usd_per_hour"]
    if isinstance(price, bool) or not isinstance(price, (int, float)) or price <= 0:
        raise TrainingConfigError(
            "persona.training.price_ceiling_usd_per_hour must be a positive number"
        )
    if not isinstance(config["dop_enabled"], bool):
        raise TrainingConfigError("persona.training.dop_enabled must be a boolean")
    multiplier = config["dop_multiplier"]
    if isinstance(multiplier, bool) or not isinstance(multiplier, (int, float)) or multiplier <= 0:
        raise TrainingConfigError("persona.training.dop_multiplier must be a positive number")
    config["dop_multiplier"] = float(multiplier)
    if not isinstance(config["dop_class"], str) or not config["dop_class"].strip():
        raise TrainingConfigError("persona.training.dop_class must be a non-empty string")

    expected = derived_trigger(creator_id, config["base_arch"])
    declared = config["trigger"]
    if declared is not None:
        if not isinstance(declared, str) or not SAFE_TRIGGER.fullmatch(declared):
            raise TrainingConfigError("persona.training.trigger must be a lowercase token or null")
        if declared != expected:
            raise TrainingConfigError(
                f"persona.training.trigger must equal the derived trigger {expected!r}"
            )
    config["trigger"] = expected
    config["price_ceiling_usd_per_hour"] = float(price)
    return config


def load_persona_with_training(
    persona_path: Path, *, require_assets: bool = True,
) -> dict[str, Any]:
    """Validate the base persona and merge one optional training definition."""
    persona_path = Path(persona_path)
    persona_module = _load_persona_module()
    raw = persona_module.load_document(persona_path)
    if not isinstance(raw, dict):
        raise TrainingConfigError("persona document must be an object")
    base = dict(raw)
    inline = base.pop("training", None)
    persona_module.validate_persona(
        base, base_dir=persona_path.parent, require_assets=require_assets,
    )

    sidecar_path = persona_path.with_name("training.yaml")
    sidecar = None
    if sidecar_path.is_file():
        document = persona_module.load_document(sidecar_path)
        if not isinstance(document, dict) or set(document) != {"training"}:
            raise TrainingConfigError(
                f"{sidecar_path} must contain exactly one top-level 'training' object"
            )
        sidecar = document["training"]
    if inline is not None and sidecar is not None:
        raise TrainingConfigError(
            "training is defined in both persona.yaml and training.yaml; remove the sidecar "
            "after the quiet-point migration"
        )

    merged = dict(base)
    merged["training"] = validate_training(
        inline if inline is not None else sidecar, base["id"],
    )
    return merged

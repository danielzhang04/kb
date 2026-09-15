#!/usr/bin/env python3
"""Plan, run, and grade the persona-driven Figment Track-1 chain.

Planning and grading are local. ``run`` is the only live path and delegates every
pod to pod/runpod_run.py with the exact argv recorded in plan.json. It never retries.
"""
from __future__ import annotations

import argparse
import csv
import glob
import html
import importlib.util
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PERSONAS_ROOT = ROOT / "orgs" / "figment" / "personas"
POD_RUNNER = HERE / "pod" / "runpod_run.py"
TRAIN_DIR = HERE / "train"
EXPAND_DIR = HERE / "expand"
PINS_PATH = TRAIN_DIR / "tensor-pins.yaml"
PROMPTS_PATH = EXPAND_DIR / "templates" / "tensor-dataset-prompts.yaml"
WORKFLOW_PATH = EXPAND_DIR / "workflows" / "tensor_dataset_v2_api.json"
FULLBODY_WORKFLOW_PATH = EXPAND_DIR / "workflows" / "tensor_dataset_fullbody_api.json"
ANCHOR_PROMPTS_PATH = EXPAND_DIR / "templates" / "anchor-prompts.yaml"
ANCHOR_WORKFLOW_PATH = EXPAND_DIR / "workflows" / "zimage_passport_api.json"
GEN_PROMPTS_PATH = EXPAND_DIR / "templates" / "gen-prompts.yaml"
GEN_WORKFLOW_PATH = TRAIN_DIR / "workflows" / "krea2_gen_api.json"
DETAIL_WORKFLOW_PATH = TRAIN_DIR / "workflows" / "krea2_detail_only_api.json"
AI_TEMPLATE_PATH = TRAIN_DIR / "ai-toolkit-krea2.yaml.template"
TRAIN_START_PATH = TRAIN_DIR / "runs" / "start-training-aitoolkit.sh.template"
TESTER_START_PATH = TRAIN_DIR / "runs" / "start-comfy-lorapath.sh.template"
QWEN3VL_CAPTION_START_PATH = TRAIN_DIR / "runs" / "start-qwen3vl-caption.sh.template"
CAPTION_ARTIFACT_NAME = "captions.json"
# MINOR 9 (REVIEW): same bound `video/video_manifest.py`'s own `MAX_JSON_BYTES` uses --
# a pod-produced captions.json is read through the generic, otherwise-unbounded
# `_read_json`, so this caps it explicitly before that read.
CAPTIONS_MAX_JSON_BYTES = 256 * 1024
TESTER_NATIVE_DIMENSIONS = {"width": 1448, "height": 2176}
TRAINING_CONFIG_MODULE = HERE / "training_config.py"
RENDER_MODULE = TRAIN_DIR / "render_aitoolkit_config.py"
BUILD_SET_MODULE = TRAIN_DIR / "build_training_set.py"
QA_MODULE = HERE / "qa_stamp.py"
SCORE_CELLS_MODULE = HERE / "score_cells.py"
IDENTITY_GATE_MODULE = HERE / "identity_gate.py"
LINEAGE_MODULE = HERE / "lineage.py"
GATES_MODULE = HERE / "gates.py"
PERSONA_MODULE = HERE / "persona.py"
VERIFY_PINS_MODULE = TRAIN_DIR / "verify_pins.py"
VIDEO_DIR = HERE / "video"
VIDEO_MANIFEST_MODULE = VIDEO_DIR / "video_manifest.py"
FRAME_ASSEMBLE_MODULE = VIDEO_DIR / "frame_assemble.py"
# F6a: `pipeline --out` defaults here so a `video` stage is always plannable -- see
# `_video_authority_root` and orgs/figment/runs/README.md. Gitignored except that README.
RUNS_ROOT = ROOT / "orgs" / "figment" / "runs"
VIDEO_MANIFEST_NAME = "video-manifest.json"
# The one short, clothed motion instruction `video_manifest._motion` composes with the
# persona's own identity.look.age_stage and identity.look.clothing. Overridable per plan
# (`plan --stage video --video-action ...`); never persona-specific here, because the
# persona supplies every persona-specific word already.
VIDEO_DEFAULT_ACTION = "stands still and turns her head slowly toward the camera"
# GATE video grades every Nth of the harness's own 81 native frames (1, 9, ... 81 -> 11
# cells), so the existing identity gate scores identity/age/realism ACROSS the motion.
VIDEO_FRAME_SAMPLE_EVERY = 8
# Compatibility export for older callers. New plans resolve through the pod harness's
# configured_ledger_dir() so they cannot silently bind this worktree-local fallback.
LEDGER_DIR = ROOT / "ledgers" / "cost"
# Operator approval 2026-09-15 (Daniel): +$20 for the passport-set rebuild + 3000-step
# train; arc cap 50 -> 60.
ARC_CAP_USD = "60.00"
ARC_LEDGER_GLOB = "figment-*.tsv"
STAGES = ("anchor", "dataset", "smoke", "train", "tester", "gen", "detail", "video")
# Track-2 Task D2 (review H3): the one, single source of truth for "which stages have a
# grading board" -- `build_grade`, `apply_rulings`, and `command_gate` each used to carry
# their own local tuple, so widening one and not the others silently reopened the exact
# gap H3 first closed for "anchor". "gen"/"detail"/"video" are gradeable; "smoke"/"train"
# never are (no per-cell operator ruling makes sense for either).
GRADEABLE_STAGES = ("anchor", "dataset", "tester", "gen", "detail", "video")
# m5/F6a: `pipeline --from-stage` may name any stage the driver actually runs itself,
# which since F6a includes "video" -- `command_pipeline`'s own loop plans and runs it
# exactly like every other stage. Naming `--from-stage video` still never jumps
# straight to the deliverable: `deliverable_path()`'s own `_build_deliverable` guard
# refuses to write a deliverable until `detail`'s approval-lineage exists on disk
# (B1), whatever stage the resume started from.
PIPELINE_FROM_STAGES = STAGES
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
KEY_MISMATCH_RE = re.compile(
    r"missing_keys|unexpected_keys|missing key\(s\)|unexpected key\(s\)", re.I,
)
# Matches an "anchors/<filename>" token inside the dataset-prompts template's descriptive
# note, in first-face-then-body order, so the note can be re-templated onto whichever two
# reference filenames the current persona actually has -- never by string-matching
# creator-001's old g01.jpg/g07.jpg literals.
_ANCHOR_FILENAME_RE = re.compile(r"anchors/\S+?\.(?:png|jpe?g|webp)", re.I)

REPLICATION_NOTE = (
    "orgs/figment/research/10sorlabs-package/10_dataset_generator_v2/"
    "10sorlabs_dataset_generator_v2.json (module 10, dataset generator 2.0). "
    "Node mapping, deviations, licences and grading protocol: "
    "orgs/figment/pipeline/expand/TENSOR-REPLICATION.md"
)
PIN_ENFORCEMENT_NOTE = (
    "installer_pin records the commit dataset_generator_model_installer.bat (and, for "
    "KJNodes, krea2_model_installer.bat) checks out. The pod harness clones custom "
    "nodes with `git clone --depth 1` from the default branch and cannot check out a "
    "ref, so these pins are RECORDED, NOT ENFORCED. Tightening this means changing "
    "runpod_run.py, not this file."
)
# Which `pins.pins` profile(s) each STAGES entry consumes -- the anchor stage alone spans
# two profiles (passport + edit arms); "smoke" reuses the "train" profile exactly as
# `_train_manifest` does. Drives the `plan` preflight's pin verification (HIGH-1 / LOW-15):
# only the profiles an actual `--stage` selection will use are HEAD-checked.
STAGE_PIN_PROFILES = {
    "anchor": ("anchor", "anchor_edit"),
    "dataset": ("dataset",),
    "smoke": ("train",),
    "train": ("train",),
    "tester": ("tester",),
    "gen": ("gen",),
    "detail": ("detail",),
    # "video" is deliberately absent: its pins live in
    # video/wan22_ti2v_5b.model-pins.json, which verify_pins.py does not cover today
    # (AUDIT-2026-09-15.md E5) -- unchanged by F6, which is scoped to the stage entry,
    # not a new pin-verification path.
}
SHARD_NOTES = (
    "face-row and half-body-row cells (framing: half), part 1 of 3",
    "face-row and half-body-row cells (framing: half), part 2 of 3",
    "face-row and half-body-row cells (framing: half), part 3 of 3",
)
FULLBODY_SHARD_NOTE = (
    "full-body-row cells (framing: full) routed through the face-repair second pass "
    "(D25) on tensor_dataset_fullbody_api.json -- wide/low-angle/walking framings where "
    "the face would otherwise read too small at native scale"
)


class FigmentTrainError(RuntimeError):
    """A plan, live record, or operator ruling failed closed."""


def _load_module(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _training_config_module():
    return _load_module("_figment_train_training_config", TRAINING_CONFIG_MODULE)


def _render_module():
    return _load_module("_figment_train_render_config", RENDER_MODULE)


def _build_set_module():
    return _load_module("_figment_train_build_set", BUILD_SET_MODULE)


def _qa_module():
    return _load_module("_figment_train_qa_stamp", QA_MODULE)


def _score_cells_module():
    return _load_module("_figment_train_score_cells", SCORE_CELLS_MODULE)


def _identity_gate_module():
    return _load_module("_figment_train_identity_gate", IDENTITY_GATE_MODULE)


def _lineage_module():
    return _load_module("_figment_train_lineage", LINEAGE_MODULE)


def _gates_module():
    return _load_module("_figment_train_gates", GATES_MODULE)


def _persona_module():
    return _load_module("_figment_train_persona", PERSONA_MODULE)


def _pod_runner_module():
    return _load_module("_figment_train_pod_runpod_run", POD_RUNNER)


def _verify_pins_module():
    return _load_module("_figment_train_verify_pins", VERIFY_PINS_MODULE)


def _video_manifest_module():
    return _load_module("_figment_train_video_manifest", VIDEO_MANIFEST_MODULE)


def _frame_assemble_module():
    """Also the way to reach `frame_extract.py` (`.frames`): frame_assemble already
    loads it as the shared containment/extraction primitive, so this driver never
    creates a second instance of it."""
    return _load_module("_figment_train_frame_assemble", FRAME_ASSEMBLE_MODULE)


def _video_authority_root(path: Path, label: str) -> Path:
    """F6a (boss ruling): a `video` plan, the persona it is bound to, the approved still
    it starts from and every output it produces must share ONE containment root, because
    `video_manifest.build_manifest`'s review-candidate mode binds the candidate to the
    REAL in-repo `persona.yaml` the approved plan names and requires that file, the plan,
    its six `grade/gen` evidence documents, the frame and the manifest to all sit below
    its own `--root`. That root is this repository, so a `pipeline` run root must too --
    which is exactly why `pipeline --out` defaults to
    `orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/`.

    `gen` and `detail` plans are unaffected: they may still be built anywhere (the
    runbook's own `C:/tmp/creator-001-plan` keeps working). Only `video` refuses.

    MINOR 3 (REVIEW): contained to `RUNS_ROOT` (`orgs/figment/runs/`), not merely `ROOT`
    -- an otherwise-in-repo path like `orgs/figment/personas/<id>` is not a run root
    (nothing gitignores it, `pipeline` never writes there, and the whole point of this
    function is to bind every video-plan-related path to the one gitignored run tree
    `pipeline --out` defaults to), so it must refuse here too."""
    resolved = Path(path).resolve()
    try:
        resolved.relative_to(RUNS_ROOT.resolve())
    except ValueError as exc:
        raise FigmentTrainError(
            f"the video stage requires {label} inside the run-root authority root "
            f"({RUNS_ROOT}); `pipeline --out` defaults to "
            "orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/ for exactly this reason "
            "(video_manifest's review-candidate mode binds the plan's own in-repo "
            "persona.yaml digest under one common --root, and only orgs/figment/runs/ "
            "is that shared run-root tree). gen and detail may still be planned "
            f"anywhere, including elsewhere in the repo; video may not. Got: {resolved}"
        ) from exc
    return resolved


def _default_pipeline_out(creator_id: str) -> Path:
    """The in-repo run root `pipeline --out` defaults to (F6a)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return RUNS_ROOT / creator_id / stamp


def _verify_pins_preflight(
    pins: dict[str, Any], selected_stages: list[str], training: dict[str, Any] | None = None,
) -> None:
    """Run `verify_pins.verify_pins` for every pin profile `selected_stages` will actually
    consume, before a single model is ever bootstrapped on a pod (review HIGH-1: all four
    `pins.anchor` sha256 digests were wrong and only failed at pod readiness, burning the
    full cost ceiling for zero images). Raises `FigmentTrainError` on any mismatch.

    M3/m8: `gen`/`detail` additionally pull in the `style_loras` keyed-variant pin
    profile (`verify_pins._stage_models` already recognizes that shape, precedent
    `skin_loras`) whenever `training["style_lora"]` names one -- caller resolves that
    key (the plan-time `--style-lora` override, or a persona default, or -- for
    `detail` -- the upstream gen plan's own choice) into `training` before calling."""
    profiles: list[str] = []
    for stage in selected_stages:
        for profile in STAGE_PIN_PROFILES.get(stage, ()):
            if profile not in profiles:
                profiles.append(profile)
        if (stage in ("gen", "detail") and training and training.get("style_lora")
                and "style_loras" not in profiles):
            profiles.append("style_loras")
    if not profiles:
        return
    module = _verify_pins_module()
    try:
        results = module.verify_pins(pins, stages=profiles)
    except module.VerifyPinsError as exc:
        raise FigmentTrainError(f"pin verification could not run: {exc}") from exc
    if results:
        lines = [
            f"[{stage}] {problem}"
            for stage, problems in results.items() for problem in problems
        ]
        raise FigmentTrainError("pin verification failed:\n" + "\n".join(lines))


STYLE_LORA_MAX_STRENGTH = 1.5


def _resolve_gen_style_lora(
    training: dict[str, Any], pins: dict[str, Any], *,
    style_lora: str | None, style_lora_strength: float | None,
) -> dict[str, Any]:
    """M3: a `plan --stage gen --style-lora <key> --style-lora-strength <0..1.5>`
    override for this one plan -- never a persona fork
    (`personas/creator-001-skin` deleted; a style LoRA no longer forces a second,
    un-comparable ~$36 train run just to change one field). Absent the flag,
    `training["style_lora"]`/`["style_lora_strength"]` -- the persona's own
    `training.yaml` default (null unless the persona opts in, `training_config.py`
    `DEFAULT_TRAINING`) -- passes through unchanged, so `_gen_workflow`/`_gen_manifest`
    behave exactly as before this change for every existing persona.

    `style_lora_strength` without `style_lora` is refused (nothing to apply it to).
    The key is validated against `pins.pins.style_loras` (`_gen_workflow` already
    raises on an unknown key -- this raises earlier, at plan time, before any other
    plan-building work). The strength floor mirrors `training_config.py`'s own "must
    be a positive number" rule for `training.style_lora_strength`, plus an explicit
    <=1.5 ceiling for a flag override (no persona has ever validated a number this high
    -- a plan-time typo like `15` must not reach a live gen render).

    MINOR 10 (REVIEW): the SAME pins-key and <=1.5-strength validation now also applies
    to `training["style_lora"]` when it comes from the persona's own `training.yaml`
    default, not only from the `--style-lora` flag -- previously a persona-declared
    style LoRA reached `_gen_workflow`/`_gen_manifest` unvalidated (an unknown key there
    fails later, mid-plan-build, with a less specific error; an out-of-range persona
    strength was never checked at all)."""
    if style_lora_strength is not None and style_lora is None:
        raise FigmentTrainError("--style-lora-strength requires --style-lora")
    effective_key = style_lora if style_lora is not None else training.get("style_lora")
    flag_source = style_lora is not None
    if effective_key is None:
        return training
    label = "--style-lora" if flag_source else "training.style_lora"
    if not isinstance(effective_key, str) or not effective_key.strip():
        raise FigmentTrainError(f"{label} must be a non-empty string key")
    known = pins.get("pins", {}).get("style_loras", {})
    if not isinstance(known, dict) or effective_key not in known:
        raise FigmentTrainError(
            f"unknown {label} key {effective_key!r}; known: {sorted(known) if isinstance(known, dict) else []}"
        )
    strength_label = "--style-lora-strength" if flag_source else "training.style_lora_strength"
    strength = training.get("style_lora_strength") if style_lora_strength is None else style_lora_strength
    if (isinstance(strength, bool) or not isinstance(strength, (int, float))
            or not (0 < strength <= STYLE_LORA_MAX_STRENGTH)):
        raise FigmentTrainError(
            f"{strength_label} must be a positive number, at most "
            f"{STYLE_LORA_MAX_STRENGTH} (got {strength!r})"
        )
    return {**training, "style_lora": effective_key, "style_lora_strength": float(strength)}


def _read_json(path: Path, *, reads=None) -> Any:
    try:
        if reads is not None:
            return reads.read_json(Path(path))
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FigmentTrainError(f"cannot read JSON document {path}: {exc}") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_text(
            json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_frozen_json(path: Path, value: Any) -> None:
    """Create one immutable JSON protocol without replacing a racing writer's file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError as exc:
        raise FigmentTrainError(f"refusing to overwrite frozen diagnostic protocol: {path}") from exc


def _sha256(path: Path, *, reads=None) -> str:
    if reads is not None:
        return reads.sha256(Path(path))
    return _gates_module().sha256_file(Path(path))


def _relative(path: Path, root: Path, *, reads=None, walk_up: bool = False) -> str:
    """`walk_up` (3.12+) permits a `../`-prefixed result. Used by exactly one caller --
    `_planned_run` for the `video` stage, whose manifest is required by
    `video_manifest.build_manifest` to be written beside the approved still it starts
    from (APPROVED_GEN_ADAPTER.md: "--out must be beside the selected frame so the
    existing harness can stage both without widening its upload boundary"), i.e. inside
    the upstream `gen` plan's own output tree rather than the video plan's. It still
    resolves through `root`, and `build_plan` independently proves both ends lie under
    the repository authority root (`_video_authority_root`)."""
    if reads is not None:
        if walk_up:
            raise FigmentTrainError("observed-reads mode does not support walk-up relative paths")
        resolved = reads.resolve(Path(path))
        base = reads.resolve(Path(root))
        return resolved.relative_to(base).as_posix()
    return path.resolve().relative_to(root.resolve(), walk_up=walk_up).as_posix()


def _creator_output_code(creator_id: str) -> str:
    match = re.fullmatch(r"creator-(\d+)", creator_id)
    if match:
        return "c" + match.group(1)
    return re.sub(r"[^a-z0-9]", "", creator_id.lower())


def _checkpoint_steps(steps: int, save_every: int) -> list[int]:
    return list(range(save_every, steps, save_every))


def _checkpoint_name(trigger: str, step: int | None) -> str:
    return f"{trigger}.safetensors" if step is None else f"{trigger}_{step:09d}.safetensors"


IMPORTED_CHECKPOINT_MIN_BYTES = 1024 * 1024
IMPORTED_CHECKPOINT_REPARSE_ATTR = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)


def _is_reparse_point(path: Path) -> bool:
    """True for a symlink, an NTFS junction, or any other reparse point -- `is_symlink()`
    alone misses a Windows junction. Mirrors `lineage.py`'s own `_single_seed_is_reparse`
    (same check, kept local here so the import-ladder discovery below has no dependency
    on the single-seed curation machinery it is unrelated to)."""
    try:
        attributes = getattr(os.lstat(path), "st_file_attributes", 0)
    except OSError:
        return False
    isjunction = getattr(os.path, "isjunction", lambda _p: False)
    return path.is_symlink() or isjunction(path) or bool(attributes & IMPORTED_CHECKPOINT_REPARSE_ATTR)


def _import_checkpoint_stem_match(trigger: str, filename: str, final_step: int) -> int | None:
    """Return the checkpoint step `filename` names under this persona's derived stem, or
    None if it does not match at all. Round-trips through `_checkpoint_name` itself
    (never a hand-rolled digit count) so a file is accepted only when its own name is
    byte-identical to what this trigger/step would produce."""
    if filename == _checkpoint_name(trigger, None):
        return final_step
    match = re.fullmatch(rf"{re.escape(trigger)}_(\d+)\.safetensors", filename)
    if match is None:
        return None
    candidate_step = int(match.group(1))
    return candidate_step if filename == _checkpoint_name(trigger, candidate_step) else None


def _discover_imported_checkpoints(
    directory: Path, trigger: str, final_step: int,
) -> list[dict[str, Any]]:
    """MANDATE.md's tier constraint: the explicit-tier LoRA is trained on operator
    hardware and enters the pipeline from OUTSIDE it, as loose checkpoint files rather
    than an in-plan `train` receipt. Discover and validate that ladder fail-closed:
    only `<trigger>[_<9-digit step>].safetensors` files, no symlink/reparse point, no
    file under 1 MiB, no duplicate step, no other extension, no empty ladder."""
    directory = Path(directory)
    if not directory.is_dir():
        raise FigmentTrainError(f"--import-checkpoints directory does not exist: {directory}")
    by_step: dict[int, Path] = {}
    for entry in sorted(directory.iterdir()):
        if entry.is_dir():
            continue
        if _is_reparse_point(entry):
            raise FigmentTrainError(
                f"imported checkpoint ladder entry is a symlink or reparse point: {entry}"
            )
        if entry.suffix.lower() != ".safetensors":
            raise FigmentTrainError(
                f"imported checkpoint ladder contains a non-safetensors file: {entry.name}"
            )
        step = _import_checkpoint_stem_match(trigger, entry.name, final_step)
        if step is None:
            raise FigmentTrainError(
                f"imported checkpoint ladder file does not match the persona checkpoint "
                f"stem {trigger!r}: {entry.name}"
            )
        size = entry.stat().st_size
        if size < IMPORTED_CHECKPOINT_MIN_BYTES:
            raise FigmentTrainError(
                f"imported checkpoint {entry.name!r} is below the 1 MiB minimum ({size} bytes)"
            )
        if step in by_step:
            raise FigmentTrainError(f"imported checkpoint ladder has a duplicate step {step}")
        by_step[step] = entry
    if not by_step:
        raise FigmentTrainError(
            f"--import-checkpoints directory has no matching checkpoints: {directory}"
        )
    return [
        {
            "step": step,
            "filename": by_step[step].name,
            "source_path": str(by_step[step].resolve()),
            "bytes": by_step[step].stat().st_size,
            "sha256": _sha256(by_step[step]),
        }
        for step in sorted(by_step)
    ]


def _stage_imported_checkpoints(
    out: Path, persona: dict[str, Any], ladder: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Copy the discovered ladder into the plan's own upload tree, the same
    `train/runs/_uploads/<persona>/` convention `_copy_detail_images` uses, so
    `pod/runpod_run.py`'s upload expansion never reaches outside the manifest's own
    directory for a file that started life anywhere else on disk. Re-hashes the staged
    copy immediately so a mid-copy change is never staged silently."""
    upload_dir = out / "train" / "runs" / "_uploads" / persona["id"]
    upload_dir.mkdir(parents=True, exist_ok=True)
    staged: list[dict[str, Any]] = []
    for row in ladder:
        source = Path(row["source_path"])
        destination = upload_dir / row["filename"]
        shutil.copy2(source, destination)
        if destination.stat().st_size != row["bytes"] or _sha256(destination) != row["sha256"]:
            raise FigmentTrainError(
                f"staged imported checkpoint changed while copying: {row['filename']}"
            )
        staged.append({**row, "staged_path": f"_uploads/{persona['id']}/{row['filename']}"})
    return staged


def _load_imported_training_config(creator_id: str, path: Path) -> dict[str, Any]:
    """`--import-training-config <training.yaml>`: an operator-supplied training sidecar
    (same one-key `{"training": {...}}` shape `training_config.load_persona_with_training`
    reads from a persona's own sidecar) describing the RECORDED config the imported
    ladder was actually trained with -- never the current persona's, unless it happens
    to be the same file."""
    path = Path(path).resolve()
    if not path.is_file():
        raise FigmentTrainError(f"--import-training-config file not found: {path}")
    document = _persona_module().load_document(path)
    if not isinstance(document, dict) or set(document) != {"training"}:
        raise FigmentTrainError(
            f"{path} must contain exactly one top-level 'training' object"
        )
    training_config = _training_config_module()
    try:
        return training_config.validate_training(document["training"], creator_id)
    except training_config.TrainingConfigError as exc:
        raise FigmentTrainError(str(exc)) from exc


def _reload_imported_training_projection(
    creator_id: str, path: Path, *, reads=None,
) -> dict[str, Any]:
    """Re-derive an imported checkpoint's training-input projection straight from its
    named `imported_training_config` file (gen-time drift check, P4i) -- tolerant of
    either the training-only `{"training": {...}}` shape `--import-training-config`
    requires, or a full persona document (the default-fallback case, where the config
    path IS the persona's own persona.yaml/training.yaml sidecar, which legitimately
    gains `chosen_checkpoint_*` selection fields after promotion). Comparing projections
    rather than raw bytes means that legitimate write-back never registers as drift --
    `training_input_projection` already excludes SELECTION_KEYS -- while any real change
    to a training-relevant field does."""
    exists = reads.file(path, required=False) is not None if reads is not None else path.is_file()
    if not exists:
        raise FigmentTrainError(f"imported training config is missing after checkpoint promotion: {path}")
    document = _persona_module().load_document(path, reads=reads)
    if not isinstance(document, dict) or not isinstance(document.get("training"), dict):
        raise FigmentTrainError(f"imported training config no longer names a training object: {path}")
    training_config = _training_config_module()
    try:
        reloaded = training_config.validate_training(document["training"], creator_id)
    except training_config.TrainingConfigError as exc:
        raise FigmentTrainError(f"imported training config is no longer valid: {exc}") from exc
    return _lineage_module().training_input_projection(reloaded)


def manifest_ceiling(manifest: dict[str, Any]) -> str:
    estimate = Decimal(str(manifest["price_usd_per_hour"])) * Decimal(
        str(manifest["max_minutes"])
    ) / Decimal(60)
    cents = (estimate * 100).to_integral_value(rounding="ROUND_CEILING") / Decimal(100)
    return f"{cents:.2f}"


# Live defect: the train stage's wall-clock budget used to be a static pod-class pin
# (tensor-pins.yaml train.job_timeout_seconds/max_minutes) regardless of
# training.steps/training.dop_enabled. Measured rates: 1.3-2.5s/step cached without DOP,
# a steady 8.6s/step with DOP's 3 forward passes/step (r21) -- a long DOP run can blow
# through the fixed 3h job_timeout / 270min ceiling mid-training. TRAIN_STEP_RATE_DOP_S
# carries a small margin over the measured 8.6s/step.
TRAIN_STEP_RATE_NO_DOP_S = 2.5
TRAIN_STEP_RATE_DOP_S = 9.0
TRAIN_WARMUP_SECONDS = 900
TRAIN_BUDGET_MARGIN = 1.35


def _train_step_rate(dop_enabled: bool) -> float:
    return TRAIN_STEP_RATE_DOP_S if dop_enabled else TRAIN_STEP_RATE_NO_DOP_S


def _apply_train_budget(
    manifest: dict[str, Any], training: dict[str, Any], *, num_artifacts: int,
) -> dict[str, Any]:
    """Derive the train stage's job_timeout_seconds/max_minutes from `training.steps`
    and `training.dop_enabled`, mutating `manifest` in place, and return the numbers for
    plan.json's run entry (`budget`). The pod-class pins in tensor-pins.yaml (already
    populated into `manifest` by `_pod_base`) stay FLOORS -- this only ever raises
    job_timeout_seconds/max_minutes above the pinned value, never below it.
    readiness_timeout_seconds and artifact_download_seconds are left exactly as pinned.
    max_minutes is computed with the SAME harness helper
    (`pod/runpod_run.minimum_runtime_minutes`) every manifest's live preflight already
    uses -- never a second, independently hand-rolled formula that could drift from it.
    """
    floor_job_timeout_seconds = manifest["job_timeout_seconds"]
    floor_max_minutes = manifest["max_minutes"]
    per_step_s = _train_step_rate(training["dop_enabled"])
    steps = training["steps"]
    job_timeout_seconds = max(
        floor_job_timeout_seconds,
        math.ceil((steps * per_step_s + TRAIN_WARMUP_SECONDS) * TRAIN_BUDGET_MARGIN),
    )
    probe_manifest = {
        "readiness_timeout_seconds": manifest["readiness_timeout_seconds"],
        "job_timeout_seconds": job_timeout_seconds,
        "artifact_download_seconds": manifest["artifact_download_seconds"],
        "artifacts": [{} for _ in range(num_artifacts)],
    }
    minimum_minutes = _pod_runner_module().minimum_runtime_minutes(probe_manifest)
    max_minutes = max(floor_max_minutes, math.ceil(minimum_minutes))
    manifest["job_timeout_seconds"] = job_timeout_seconds
    manifest["max_minutes"] = max_minutes
    ceiling_usd = manifest_ceiling({
        "price_usd_per_hour": manifest["price_usd_per_hour"], "max_minutes": max_minutes,
    })
    return {
        "per_step_s": per_step_s,
        "steps": steps,
        "job_timeout_seconds": job_timeout_seconds,
        "max_minutes": max_minutes,
        "ceiling_usd": ceiling_usd,
    }


def _pod_base(pins: dict[str, Any], pod_class: str, stage: str) -> dict[str, Any]:
    try:
        selected = pins["pod_classes"][pod_class]
        stage_values = selected["stages"][stage]
    except (KeyError, TypeError) as exc:
        raise FigmentTrainError(f"pod class {pod_class!r} has no {stage!r} stage") from exc
    result = {
        "gpu": deepcopy(selected["gpu"]),
        "price_usd_per_hour": selected["price_usd_per_hour"],
        "max_minutes": stage_values["max_minutes"],
        "max_placement_attempts": selected["max_placement_attempts"],
        "container_disk_gb": stage_values["container_disk_gb"],
        "volume_gb": stage_values["volume_gb"],
        "volume_mount_path": selected["volume_mount_path"],
        "image": selected["image"],
    }
    if stage_values.get("avoid_machine_hosts"):
        result["avoid_machine_hosts"] = deepcopy(stage_values["avoid_machine_hosts"])
    result.update({
        "readiness_timeout_seconds": stage_values["readiness_timeout_seconds"],
        "job_timeout_seconds": stage_values["job_timeout_seconds"],
    })
    if "artifact_download_seconds" in stage_values:
        result["artifact_download_seconds"] = stage_values["artifact_download_seconds"]
    if "upload_allowance_seconds" in stage_values:
        result["upload_allowance_seconds"] = stage_values["upload_allowance_seconds"]
    if "job_wait_for_seconds" in stage_values:
        result["job_wait_for_seconds"] = stage_values["job_wait_for_seconds"]
    result["comfyui"] = deepcopy(stage_values["comfyui"])
    return result


def _load_inputs(creator_id: str, personas_root: Path) -> tuple[dict, dict, dict]:
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    if not persona_path.is_file():
        raise FigmentTrainError(f"persona not found: {persona_path}")
    try:
        persona = _training_config_module().load_persona_with_training(persona_path)
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    if persona.get("id") != creator_id:
        raise FigmentTrainError(
            f"persona.id {persona.get('id')!r} does not match requested creator {creator_id!r}"
        )
    pins = _read_json(PINS_PATH)
    training = persona["training"]
    try:
        pod_price = float(pins["pod_classes"][training["pod_class"]]["price_usd_per_hour"])
    except (KeyError, TypeError, ValueError) as exc:
        raise FigmentTrainError(
            f"unknown training pod class {training['pod_class']!r}"
        ) from exc
    if pod_price > training["price_ceiling_usd_per_hour"]:
        raise FigmentTrainError(
            f"pod class hourly price ${pod_price:.2f} exceeds persona ceiling "
            f"${training['price_ceiling_usd_per_hour']:.2f}"
        )
    return persona, training, pins


def _resolve_body_reference(persona: dict, references: list[Path]) -> Path:
    """Pick the reference image `body.identity` should describe.

    Review MED-9: after anchor-stage promotion, `identity.references` collapses to the one
    picked anchor while `body_target.exemplars` still names the old g-set stems it can no
    longer match -- the old code fell through to `references[-1]` in that case with no
    warning, which happened to work only because a promoted persona has exactly one
    reference. Fail closed instead: a non-empty `exemplars` that matches nothing is treated
    as stale persona.yaml state, not a coincidence to paper over.
    """
    exemplar_stems = list(persona["body_target"].get("exemplars") or [])
    for stem in reversed(exemplar_stems):
        for ref in references:
            if ref.stem == stem:
                return ref
    if exemplar_stems:
        raise FigmentTrainError(
            f"persona.body_target.exemplars {exemplar_stems!r} match none of "
            f"persona.identity.references {[ref.stem for ref in references]!r} -- this "
            "looks like stale post-anchor-promotion state (identity.references collapsed "
            "to the picked anchor without body_target.exemplars being updated); correct or "
            "clear body_target.exemplars by hand before planning the dataset stage"
        )
    return references[-1]


def _generalized_prompts(persona: dict) -> dict[str, Any]:
    prompts = _read_json(PROMPTS_PATH)
    references = [Path(value) for value in persona["identity"]["references"]]
    body_ref = _resolve_body_reference(persona, references)
    prompts["persona"] = persona["id"]
    note = prompts["structure"]["prepend_is_the_hand_typed_description"]
    replacements = iter([references[0].as_posix(), body_ref.as_posix()])
    note = _ANCHOR_FILENAME_RE.sub(lambda match: next(replacements, match.group(0)), note)
    prompts["structure"]["prepend_is_the_hand_typed_description"] = note

    # Fix (dataset-stage face/body identity contamination): compose face/body identity
    # the same way `_generalized_anchor_prompts` composes passport/edit identity below --
    # entirely from the persona's own `identity.look` (never a face/body description
    # hardcoded in the shared template). Guarded on "face"/"body" being present so a
    # minimal/legacy template (e.g. test_figment_train.py's note-derivation fixture,
    # which supplies neither section nor a persona `identity.look`) keeps working
    # unchanged -- only the real tensor-dataset-prompts.yaml template (which has both)
    # takes this path.
    if "face" in prompts and "body" in prompts:
        look = persona.get("identity", {}).get("look")
        if not isinstance(look, dict):
            raise FigmentTrainError(
                "persona.identity.look is required to compose the dataset-stage "
                "face/body identity"
            )
        clause = _compose_look_clause(look)
        # Track-2 dataset-stage fix: the shared, non-persona skin-texture rendering
        # instruction (a photorealism directive, not a look description) stays intact --
        # popped from the template rather than left hardcoded on both "face" and "body".
        skin_texture_clause = prompts.pop("skin_texture_clause")
        identity = f"{clause}, {skin_texture_clause}, "
        prompts["face"]["identity"] = identity
        prompts["body"]["identity"] = identity
    return prompts


def _compose_look_clause(look: dict[str, Any]) -> str:
    """Join `identity.look`'s eight fields into one comma-separated descriptive clause,
    with no trailing punctuation -- the caller decides how the clause continues."""
    return ", ".join(
        look[key] for key in
        ("age_stage", "hair", "eyes", "skin", "brows", "makeup", "build", "clothing")
    )


def _generalized_anchor_prompts(persona: dict) -> dict[str, Any]:
    """Build the anchor-stage prompts entirely from the template's structure/rows/camera
    and framing clauses plus the persona's own `identity.look` (Track-2 review HIGH-2) --
    never from a face/body description hardcoded in the shared template. `persona.py`
    already fails closed on a missing or malformed `identity.look` before a persona
    document is ever returned by `_load_inputs`; the check here is defense in depth for a
    persona dict built by hand (e.g. in a test) that bypassed that validation.
    """
    prompts = _read_json(ANCHOR_PROMPTS_PATH)
    prompts["persona"] = persona["id"]
    look = persona.get("identity", {}).get("look")
    if not isinstance(look, dict):
        raise FigmentTrainError(
            "persona.identity.look is required to compose the anchor-stage prompts"
        )
    clause = _compose_look_clause(look)
    prompts["passport"]["identity"] = clause + ","
    prompts["edit"]["identity"] = clause + ". " + prompts["edit"].pop("constraint_clause")

    framing_prefix = prompts["passport"].pop("framing_prefix")
    prompts["passport"]["rows"] = [
        row if row.startswith(framing_prefix) else f"{framing_prefix} {row}"
        for row in prompts["passport"]["rows"]
    ]
    camera_clause = prompts["camera_clause"]
    for arm in ("passport", "edit"):
        prompts[arm]["rows"] = [
            row if camera_clause in row else f"{row} {camera_clause}"
            for row in prompts[arm]["rows"]
        ]
    return prompts


def _generalized_dataset_workflow(persona: dict, prompts: dict[str, Any]) -> dict[str, Any]:
    workflow = _read_json(WORKFLOW_PATH)
    references = [Path(value) for value in persona["identity"]["references"]]
    body_ref = _resolve_body_reference(persona, references)
    workflow["836"]["inputs"]["image"] = f"{persona['id']}/{references[0].name}"
    workflow["837"]["inputs"]["image"] = f"{persona['id']}/{body_ref.name}"
    workflow["800"]["inputs"]["text"] = prompts["face"]["identity"]
    workflow["780"]["inputs"]["text"] = prompts["body"]["identity"]
    workflow["832"]["inputs"]["filename_prefix"] = f"{persona['id']}-tensor-dataset"
    return workflow


FULLBODY_OUTPUT_NODE = "958"


def _chunks(items: list[Any], count: int) -> list[list[Any]]:
    """Split `items` into `count` as-equal-as-possible contiguous chunks."""
    size, extra = divmod(len(items), count)
    chunks: list[list[Any]] = []
    start = 0
    for index in range(count):
        take = size + (1 if index < extra else 0)
        chunks.append(items[start:start + take])
        start += take
    return chunks


def _dataset_jobs(persona: dict, prompts: dict[str, Any]) -> list[dict[str, Any]]:
    """Build every face + body job, each tagged with its own `framing` ("half"|"full",
    Track-2 Task B1/D24-D25). Face rows are always plain strings (already close framings,
    never routed to the fullbody face-repair pass); body rows are now `{"text",
    "framing"}` objects. A "full" body job's `832`/`images` substitution points at the
    fullbody workflow's face-repair composite output instead of the raw refine decode, so
    the same job dict works unchanged whichever manifest (`_dataset_manifests`) it lands in.
    """
    short = _creator_output_code(persona["id"])
    jobs: list[dict[str, Any]] = []
    branches = (
        ("f", "174", "791", "788", 241731167782064, prompts["face"]),
        ("b", "676", "776", "778", 269789944143426, prompts["body"]),
    )
    for label, prompt_node, image_node, seed_node, outer_seed, block in branches:
        for index, row in enumerate(block["rows"], start=1):
            if isinstance(row, dict):
                text, framing = row["text"], row["framing"]
            else:
                text, framing = row, "half"
            output_node = FULLBODY_OUTPUT_NODE if framing == "full" else image_node
            substitutions = [
                {"node_id": "832", "field": "images", "value": [output_node, 0]},
                {"node_id": seed_node, "field": "seed", "value": 1098688918602660},
                {"node_id": prompt_node, "field": "prompt", "value": block["identity"] + text},
            ]
            if framing == "full":
                # D25: the face-repair tail's own TextEncodeQwenImageEditPlus (node 952)
                # needs its placeholder prompt substituted too -- a fixed instruction, not
                # a per-row scene description (see fullbody_repair_prompt_note).
                substitutions.append({
                    "node_id": "952", "field": "prompt",
                    "value": prompts["fullbody_repair_prompt"],
                })
            jobs.append({
                "seed": outer_seed,
                "output_name": f"{short}-tds-{label}{index:02d}",
                "expected_images": 1,
                "framing": framing,
                "substitutions": substitutions,
            })
    return jobs


def _dataset_manifests(
    persona: dict, training: dict, pins: dict, prompts: dict[str, Any],
) -> list[dict[str, Any]]:
    """Three shards of face + half-body-framed cells on the v2 workflow, plus one
    `fullbody` manifest of full-body-framed cells on the face-repair workflow (Track-2
    Task B1). `full` cells are never mixed into the v2 shards -- the repair tail only
    exists in `tensor_dataset_fullbody_api.json`."""
    jobs = _dataset_jobs(persona, prompts)
    half_jobs: list[dict[str, Any]] = []
    full_jobs: list[dict[str, Any]] = []
    for job in jobs:
        framing = job.pop("framing")
        (full_jobs if framing == "full" else half_jobs).append(job)
    references = [Path(value).name for value in persona["identity"]["references"]]
    upload = {
        "files": [f"_uploads/{persona['id']}/{name}" for name in references],
        "subfolder": persona["id"],
        "type": "input",
        "overwrite": True,
    }
    manifests: list[dict[str, Any]] = []
    for index, shard_jobs in enumerate(_chunks(half_jobs, 3)):
        manifests.append({
            "_replicates": REPLICATION_NOTE,
            "_shard": SHARD_NOTES[index],
            "_pin_enforcement": PIN_ENFORCEMENT_NOTE,
            **_pod_base(pins, training["pod_class"], "dataset"),
            "models": deepcopy(pins["pins"]["dataset"]["models"]),
            "custom_nodes": deepcopy(pins["pins"]["dataset"]["custom_nodes"]),
            "workflow": "../workflows/tensor_dataset_v2_api.json",
            "seed_fields": ["seed"],
            "uploads": [dict(upload)],
            "jobs": shard_jobs,
        })
    manifests.append({
        "_replicates": REPLICATION_NOTE,
        "_shard": FULLBODY_SHARD_NOTE,
        "_pin_enforcement": PIN_ENFORCEMENT_NOTE,
        **_pod_base(pins, training["pod_class"], "dataset_fullbody"),
        # Review-precedent D23 (anchor_edit): the fullbody manifest reuses the dataset
        # profile's own models/custom_nodes verbatim -- the repair tail (FaceBoundingBox,
        # ImageResizeKJv2, core KSampler/VAEEncode/VAEDecode/ImageScale/
        # ImageCompositeMasked/ConditioningZeroOut) needs no model or node this profile
        # doesn't already carry.
        "models": deepcopy(pins["pins"]["dataset"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["dataset"]["custom_nodes"]),
        "workflow": "../workflows/tensor_dataset_fullbody_api.json",
        "seed_fields": ["seed"],
        "uploads": [dict(upload)],
        "jobs": full_jobs,
    })
    return manifests


def _fullbody_dataset_workflow(dataset_workflow: dict[str, Any]) -> dict[str, Any]:
    """Graft the fullbody face-repair tail (nodes 950-958) onto an already
    persona-generalized dataset workflow dict, so the copy `_copy_support_files` writes
    into the plan is persona-specific (references, identity clauses) the same way the v2
    workflow copy is -- never a second, independently-substituted read of the source
    file."""
    workflow = deepcopy(dataset_workflow)
    tail = _read_json(FULLBODY_WORKFLOW_PATH)
    for node_id in ("950", "951", "952", "953", "954", "955", "956", "957", "958"):
        workflow[node_id] = deepcopy(tail[node_id])
    workflow["832"]["inputs"]["images"] = ["958", 0]
    return workflow


def _anchor_manifests(
    persona: dict, training: dict, pins: dict, prompts: dict[str, Any],
) -> list[dict[str, Any]]:
    short = _creator_output_code(persona["id"])
    passport = {
        **_pod_base(pins, training["pod_class"], "anchor"),
        "models": deepcopy(pins["pins"]["anchor"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["anchor"]["custom_nodes"]),
        "workflow": "../workflows/zimage_passport_api.json",
        "seed_fields": ["seed"],
        "jobs": [{"seed": 148 + i, "output_name": f"{short}-anchor-p{i + 1:02d}",
                  "expected_images": 1,
                  "substitutions": [{"node_id": "4", "field": "text",
                      "value": prompts["passport"]["identity"] + " " + row}]}
                 for i, row in enumerate(prompts["passport"]["rows"])],
    }
    names = [Path(v).name for v in persona["identity"]["references"]]
    # Review LOW-11: no per-job filename_prefix override belongs here -- `apply_job`
    # (pod/runpod_run.py) always overwrites any node's `filename_prefix` input with the
    # job's own `output_name`, so setting it on this shared workflow template was a no-op
    # that read as load-bearing.
    workflow = _generalized_dataset_workflow(persona, _generalized_prompts(persona))
    edit = {
        **_pod_base(pins, training["pod_class"], "anchor_edit"),
        "models": deepcopy(pins["pins"]["anchor_edit"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["anchor_edit"]["custom_nodes"]),
        "workflow": workflow, "seed_fields": ["seed"],
        "uploads": [{"files": [f"_uploads/{persona['id']}/{n}" for n in names],
                     "subfolder": persona["id"], "type": "input", "overwrite": True}],
        "jobs": [{"seed": 241731167782064,
                  "output_name": f"{short}-anchor-e{i + 1:02d}", "expected_images": 1,
                  "substitutions": [
                      {"node_id": "788", "field": "seed", "value": 1098688918602660 + i},
                      {"node_id": "174", "field": "prompt",
                       "value": prompts["edit"]["identity"] + " " + row},
                      # Review MED-6: node 800 is a second CLIPTextEncode later in the
                      # inherited dataset graph (a face-repair resample at denoise 0.23) that
                      # otherwise keeps the DATASET template's makeup register, contradicting
                      # node 174's anchor identity clause within the same job. Both nodes now
                      # carry the identical persona-derived clause.
                      {"node_id": "800", "field": "text",
                       "value": prompts["edit"]["identity"]}]}
                 for i, row in enumerate(prompts["edit"]["rows"])],
    }
    return [passport, edit]


def _training_runtime(trigger: str, caption_mode: str, steps: list[int], final: int) -> dict:
    return {
        "repository": "https://github.com/ostris/ai-toolkit.git",
        "git_ref": "b36bb3998ae596a566d85513299696a3a78f0dcb",
        "trainer_root": "/workspace/ai-toolkit",
        "train_output": "/workspace/train-output",
        "trigger": trigger,
        "config_name": "training.json",
        "caption_mode": caption_mode,
        "caption_word": "woman",
        "caption_model": "Qwen/Qwen3-VL-8B-Instruct",
        "dataset_min_images": 20,
        "checkpoint_steps": " ".join(f"{step:09d}" for step in steps),
        "final_step": f"{final:09d}",
        "hf_home": "/workspace/hf",
        "reinstall_torch": "0",
        "torch_spec": "torch==2.13.0",
        "torchvision_spec": "torchvision==0.28.0",
        "torch_index_url": "https://download.pytorch.org/whl/cu130",
        "ready_marker": f"/workspace/ComfyUI/input/{trigger}/_dataset.ready",
        "complete_marker": "/workspace/output/_training.complete",
        "failed_marker": "/workspace/output/_training.failed",
        "start_script_path": "/workspace/start-training-aitoolkit.sh",
        "start_script_file": "start-training-aitoolkit.sh.template",
    }


def _smoke_note(creator_id: str, trigger: str) -> str:
    return (
        "Findings 13/14 dependency+compatibility smoke for the training stage (not the "
        "module-10 dependency-smoke in expand/). Same image, same trainer pin, same "
        "Krea-2 raw model pin, and the SAME start script "
        f"(start-training-aitoolkit.sh.template) as {creator_id}-tensor-train.yaml, but "
        "training.json is rendered with steps=100/save_every=50 "
        "(render_aitoolkit_config.py --set steps=100 --set save_every=50 --allow-drift) "
        "before this manifest runs, so the pod exercises the identical install -> "
        "torch.cuda -> ai-toolkit import -> Krea raw state-dict load -> N training steps "
        "-> save -> publish -> marker path at minimum cost. training.checkpoint_steps "
        "names the single step-50 intermediate save and training.final_step is 100, a "
        "DIFFERENT step, on purpose: smoke #4 (steps=50/save_every=50, "
        "checkpoint_steps==final_step==50) proved ai-toolkit only ever writes the "
        "step-AT-final under the bare trigger name, never a step-suffixed one, so "
        "aliasing the smoke's one intermediate save onto the final step made the wrapper "
        "look for a step-suffixed final file that could never exist. With final_step > "
        "the one checkpoint_steps entry, the publish logic that copies 7 intermediates "
        "plus a bare final on the full run is exercised at 1+1 instead, with the "
        "intermediate and final genuinely distinct saves. A third artifact, "
        "_training.log, is declared (same wait_for marker, .log is an allowed artifact "
        "suffix per pod/README.md) purely so the harness downloads the full ai-toolkit "
        "stdout/stderr locally — TENSOR-TRAINING.md documents that the full run is gated "
        "on this file showing the state dict loaded without missing/unexpected keys."
    )


def _train_manifest(
    persona: dict, training: dict, pins: dict, *, smoke: bool, dataset_dirname: str | None = None,
) -> dict[str, Any]:
    creator_id = persona["id"]
    trigger = training["trigger"]
    if smoke:
        final = 100
        intermediates = [50]
        stage = "smoke"
    else:
        final = training["steps"]
        intermediates = _checkpoint_steps(final, training["save_every"])
        stage = "train"
    manifest: dict[str, Any] = {}
    if smoke:
        manifest["_smoke"] = _smoke_note(creator_id, trigger)
    # Path-A train-first (r24 method 4) points uploads at its OWN copied dataset
    # directory (never `<id>-tensor-dataset`, which is the module-10 dataset stage's
    # operator-graded output) so the two lineages can never collide on disk.
    dataset_dirname = dataset_dirname or f"{creator_id}-tensor-dataset"
    upload_files = [f"{dataset_dirname}/*.png"]
    # M4: "qwen3vl" already has real .txt sidecars on disk by train time (written by
    # apply_rulings' dataset-stage assembly through the live captioning pod job) --
    # upload them exactly like "provided" does.
    if training["caption_mode"] in ("provided", "qwen3vl"):
        upload_files.append(f"{dataset_dirname}/*.txt")
    upload_files.append(f"{dataset_dirname}/training.json")
    manifest.update(_pod_base(pins, training["pod_class"], stage))
    if not smoke:
        # Defect fix: derive job_timeout_seconds/max_minutes from steps + dop_enabled
        # instead of leaving the static pod-class pin in place regardless of them.
        manifest["_budget"] = _apply_train_budget(
            manifest, training, num_artifacts=len(intermediates) + 1,
        )
    manifest.update({
        "models": deepcopy(pins["pins"]["train"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["train"]["custom_nodes"]),
        "workflow": {"1": {"class_type": "KSampler", "inputs": {"seed": 100001}}},
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [
            {
                "files": upload_files,
                "subfolder": trigger,
                "type": "input",
                "overwrite": True,
            },
            {
                "files": [f"{dataset_dirname}/_dataset.ready"],
                "subfolder": trigger,
                "type": "input",
                "overwrite": True,
            },
        ],
        "training": _training_runtime(
            trigger,
            # M4: the pod's own start script (start-training-aitoolkit.sh.template)
            # has no "qwen3vl" case -- by train time the captions already exist as
            # real .txt sidecars (written locally, same as "provided"), so the pod
            # only ever needs to verify them, never live-caption anything itself.
            "provided" if training["caption_mode"] == "qwen3vl" else training["caption_mode"],
            intermediates, final,
        ),
        "jobs": [{
            "seed": 100001,
            "output_name": (
                f"training-transport-sentinel-{trigger}-smoke" if smoke
                else f"training-transport-sentinel-{trigger}"
            ),
            "substitutions": [],
            "expected_images": 1,
        }],
        "artifacts": [
            {
                "remote": _checkpoint_name(trigger, step),
                "type": "output",
                "local": _checkpoint_name(trigger, step),
                "wait_for": "_training.complete",
            }
            for step in intermediates
        ] + [{
            "remote": _checkpoint_name(trigger, None),
            "type": "output",
            "local": _checkpoint_name(trigger, None),
            "wait_for": "_training.complete",
        }],
    })
    if smoke:
        manifest["artifacts"].append({
            "remote": "_training.log",
            "type": "output",
            "local": "_training.log",
            "wait_for": "_training.complete",
        })
    return manifest


def _persona_trigger_clause(training: dict) -> str:
    """The `"<trigger> <noun>, "` prefix every tester/gen/detail-only prompt must open
    with (r24/r25 evidence: the train-first LoRA's own tester prompt carried NO trigger
    word, so every checkpoint rendered as the base model's generic woman -- facenet
    0.17-0.23 vs anchors, i.e. a stranger -- because ai-toolkit's LoRA identity is only
    ever invoked by naming the trigger in the prompt text, never implicitly just by being
    loaded). `training["dop_class"]` is the class-DOP regularization target
    (training_config.py DEFAULT_TRAINING) -- it is NOT required to echo the caption's own
    descriptive noun and happens to read "woman" on every real persona today, so "woman"
    is the explicit fallback. Applies to every persona, DOP-enabled or not.

    E1: the `"<trigger> <noun>"` pairing itself is `training_config.persona_trigger_clause`
    -- the one shared, dependency-free home also used by `build_training_set.py` and
    `select_training_cells.py`'s DOP-required captions -- so this function only adds the
    trailing punctuation a *prompt* (as opposed to a bare caption) needs."""
    trigger = training["trigger"]
    noun = training.get("dop_class") or "woman"
    return _training_config_module().persona_trigger_clause(trigger, noun) + ", "


def _compose_triggered_prompt(training: dict, body: str) -> str:
    """Prefix `body` (an already-composed scene/look/description clause) with the
    persona's own trigger so the LoRA is always explicitly invoked -- the single helper
    `_tester_manifest` (`_tester_workflow`), `_gen_manifest` (`_generalized_gen_prompts`),
    and `_detail_manifest` all route through. `anchor`/`dataset` prompts do NOT route
    through this: those stages generate the training material itself, before any LoRA
    exists to invoke, so they compose from `persona.identity.look` via
    `_compose_look_clause` instead (`_generalized_anchor_prompts`, `_generalized_prompts`)
    -- a categorically different clause, not a fourth independent trigger composer."""
    return _persona_trigger_clause(training) + body


def _tester_age_stage(persona: dict[str, Any]) -> str:
    """Return the persona-owned apparent-age wording for tester prompts.

    A tester is a measurement of one creator, so it must not silently substitute a
    shared age band.  ``persona.py`` validates ``identity.look`` for normal callers;
    this check also protects direct helper use in tests and future local tools.
    """
    look = persona.get("identity", {}).get("look")
    age_stage = look.get("age_stage") if isinstance(look, dict) else None
    if not isinstance(age_stage, str) or not age_stage.strip():
        raise FigmentTrainError(
            "persona.identity.look.age_stage is required to compose the tester prompt"
        )
    age_stage = age_stage.strip()
    lower = age_stage.casefold()
    if re.search(r"\b(?:child(?:ren)?|minor|underage|teen(?:age|ager)?|adolescent|schoolgirl)\b", lower):
        raise FigmentTrainError(
            "persona.identity.look.age_stage contains child/minor wording and cannot be used "
            "for a tester prompt"
        )
    if not re.search(r"\badult\b", lower):
        raise FigmentTrainError(
            "persona.identity.look.age_stage must explicitly describe an adult for a tester prompt"
        )
    return age_stage


def _tester_prompt(persona: dict[str, Any], training: dict[str, Any]) -> str:
    """Build the fixed, clothed portrait prompt for a persona's checkpoint ladder."""
    return _compose_triggered_prompt(training, (
        f"Close-up portrait photograph of {_tester_age_stage(persona)}. "
        "She is an adult woman, fully clothed in a plain fitted black crew-neck top, "
        "shoulders up, facing the camera, neutral relaxed expression with a faint "
        "smile. Natural skin texture with visible pores and fine flyaway hairs, no "
        "retouching. Soft even daylight from a window camera-left, plain warm off-white "
        "wall behind her, shallow depth of field, shot on a phone camera."
    ))


def _tester_base_workflow(prompt_text: str, filename_prefix: str) -> dict[str, Any]:
    """Pinned native Flux Krea2 tester graph, no LoRA node.

    Shared by `_tester_workflow` (which inserts a `LoraLoader` node "4" and
    rewires nodes "5"/"8" onto it) and non-persona callers that want the same
    tester pipeline run directly off the base checkpoint.
    """
    return {
        "1": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default",
        }},
        "2": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2",
            "device": "default",
        }},
        "3": {"class_type": "VAELoader", "inputs": {
            "vae_name": "qwen_image_vae.safetensors",
        }},
        "5": {"class_type": "CLIPTextEncode", "inputs": {
            "text": prompt_text,
            "clip": ["2", 0],
        }},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {
            "conditioning": ["5", 0],
        }},
        "7": {"class_type": "EmptyLatentImage", "inputs": {
            "width": TESTER_NATIVE_DIMENSIONS["width"],
            "height": TESTER_NATIVE_DIMENSIONS["height"],
            "batch_size": 1,
        }},
        "8": {"class_type": "KSampler", "inputs": {
            "seed": 1595,
            "steps": 4,
            "cfg": 1.0,
            "sampler_name": "res_2s",
            "scheduler": "beta",
            "denoise": 1.0,
            "model": ["1", 0],
            "positive": ["5", 0],
            "negative": ["6", 0],
            "latent_image": ["7", 0],
        }},
        "9": {"class_type": "VAEDecode", "inputs": {
            "samples": ["8", 0], "vae": ["3", 0],
        }},
        "10": {"class_type": "SaveImage", "inputs": {
            "filename_prefix": filename_prefix, "images": ["9", 0],
        }},
    }


def _tester_workflow(persona: dict[str, Any], training: dict[str, Any]) -> dict[str, Any]:
    creator_id = persona["id"]
    trigger = training["trigger"]
    workflow = _tester_base_workflow(
        _tester_prompt(persona, training), f"{creator_id}-tensor-tester",
    )
    workflow["4"] = {"class_type": "LoraLoader", "inputs": {
        "lora_name": f"{trigger}.safetensors",
        "strength_model": 1.0,
        "strength_clip": 1.0,
        "model": ["1", 0],
        "clip": ["2", 0],
    }}
    workflow["5"]["inputs"]["clip"] = ["4", 1]
    workflow["8"]["inputs"]["model"] = ["4", 0]
    return {key: workflow[key] for key in ("1", "2", "3", "4", "5", "6", "7", "8", "9", "10")}


def _tester_manifest(
    persona: dict, training: dict, pins: dict, *, train_out_dirname: str | None = None,
    checkpoint_steps: list[int] | None = None, include_final: bool = True,
    upload_glob: str | None = None,
) -> dict[str, Any]:
    creator_id = persona["id"]
    trigger = training["trigger"]
    # Path-A train-first (r24 method 4): the tester's checkpoint upload glob must point
    # at the SAME `out/<dirname>/` the matching train manifest's harness run wrote its
    # local output into (`_planned_run`'s `run_root / path.stem`), never the module-10
    # dataset lineage's `<id>-tensor-train` unconditionally.
    train_out_dirname = train_out_dirname or f"{creator_id}-tensor-train"
    # An imported checkpoint ladder (operator-trained LoRA path, MANDATE.md's tier
    # constraint) has no in-plan train stage to derive intermediates from -- the caller
    # passes the exact discovered steps instead, and this stays the ONE function that
    # builds tester's ladder jobs either way (never forked).
    intermediates = (
        checkpoint_steps if checkpoint_steps is not None
        else _checkpoint_steps(training["steps"], training["save_every"])
    )
    checkpoints: list[tuple[int | None, str]] = [
        (step, f"{step:09d}") for step in intermediates
    ]
    if include_final:
        checkpoints.append((None, "final"))
    return {
        **_pod_base(pins, training["pod_class"], "tester"),
        "models": deepcopy(pins["pins"]["tester"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["tester"]["custom_nodes"]),
        "workflow": _tester_workflow(persona, training),
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [upload_glob or f"out/{train_out_dirname}/*.safetensors"],
            "subfolder": trigger,
            "type": "input",
            "overwrite": True,
            "chunk_bytes": 16777216,
        }],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{trigger}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": "start-comfy-lorapath.sh.template",
        },
        "jobs": [{
            "seed": 1595,
            "output_name": f"{_creator_output_code(creator_id)}-tensor-tester-{label}",
            "expected_images": 1,
            **({"wait_for": "_loras.assembled"} if index == 0 else {}),
            "substitutions": [{
                "node_id": "4",
                "field": "lora_name",
                "value": _checkpoint_name(trigger, step),
            }],
        } for index, (step, label) in enumerate(checkpoints)],
    }


DIAGNOSTIC_PROTOCOL_SCHEMA = "figment/held-out-diagnostic-protocol@1"
# These are deliberately fixed rather than sampled by a caller.  A candidate and its
# no-LoRA control therefore receive identical latent noise on every diagnostic rerun.
DIAGNOSTIC_PROTOCOL_SEEDS = (1595, 481516234, 90210, 314159, 271828)
DIAGNOSTIC_PROTOCOL_CRITERIA = (
    ("realism", "Does this image read as an unretouched, plausible photograph?"),
    ("within_batch_identity", "Do images in this arm read as the same person?"),
    ("reference_identity", "Does this arm resemble the selected canonical anchor?"),
)


def _diagnostic_criteria(age_stage: str) -> list[dict[str, str]]:
    """Return the four unscored diagnostic questions for this frozen persona wording."""
    return [
        {"id": criterion_id, "question": question, "status": "unscored"}
        for criterion_id, question in DIAGNOSTIC_PROTOCOL_CRITERIA
    ] + [{
        "id": "apparent_persona_age",
        "question": (
            "Does the image read as an adult matching this frozen persona age stage: "
            f"{age_stage}"
        ),
        "status": "unscored",
    }]


def _diagnostic_file_entry(path: Path) -> dict[str, Any]:
    """Return the minimum reproducibility record for one local diagnostic input."""
    original = Path(path)
    if original.is_symlink():
        raise FigmentTrainError(f"diagnostic input must not be a symlink: {original}")
    path = original.resolve()
    if not path.is_file() or path.stat().st_size <= 0:
        raise FigmentTrainError(f"diagnostic input is missing or empty: {path}")
    return {
        "name": path.name,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
    }


def build_held_out_diagnostic_protocol(
    creator_id: str,
    candidate_checkpoint: Path,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
    canonical_anchor: str | None = None,
) -> dict[str, Any]:
    """Freeze an unscored candidate-versus-control image evaluation slate.

    This is deliberately a protocol record, not a pod manifest and not a grade or
    approval.  It preserves the candidate and reference hashes plus the identical
    seeds/prompts needed to later compare a LoRA arm against the pinned no-LoRA tester
    base.  A multi-reference persona must name its audited canonical anchor; the full
    set remains recorded as context and is never silently treated as an average target.
    Its output is non-promotable by construction.
    """
    out = Path(out).resolve()
    candidate_checkpoint = Path(candidate_checkpoint).resolve()
    if candidate_checkpoint.suffix.lower() != ".safetensors":
        raise FigmentTrainError("diagnostic candidate checkpoint must be a .safetensors file")

    persona, training, pins = _load_inputs(creator_id, Path(personas_root))
    persona = dict(persona)
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    persona["_persona_path"] = str(persona_path)
    candidate = _diagnostic_file_entry(candidate_checkpoint)

    anchors: list[dict[str, Any]] = []
    for relative in persona["identity"]["references"]:
        entry = _diagnostic_file_entry(persona_path.parent / relative)
        anchors.append({"reference": relative, **entry})

    references = [row["reference"] for row in anchors]
    if canonical_anchor is None:
        if len(references) != 1:
            raise FigmentTrainError(
                "held-out diagnostic needs --canonical-anchor when persona has multiple "
                f"references: {references}"
            )
        canonical_anchor = references[0]
    if canonical_anchor not in references:
        raise FigmentTrainError(
            "canonical anchor must exactly name one current persona.identity.references "
            f"entry: {canonical_anchor!r}"
        )
    selected_anchor = next(row for row in anchors if row["reference"] == canonical_anchor)

    prompt = _tester_prompt(persona, training)
    prompts = [{
        "id": "persona-age-portrait-v1",
        "text": prompt,
        "age_source": "persona.identity.look.age_stage",
    }]
    checkpoints = [
        {"id": "candidate-lora", "kind": "lora", "candidate": candidate},
        {
            "id": "base-control-no-lora",
            "kind": "base-model-no-lora",
            "models": deepcopy(pins["pins"]["tester"]["models"]),
        },
    ]
    cells = [
        {
            "id": f"{checkpoint['id']}--{prompt_row['id']}--seed-{seed}",
            "checkpoint": checkpoint["id"],
            "prompt": prompt_row["id"],
            "seed": seed,
        }
        for checkpoint in checkpoints
        for prompt_row in prompts
        for seed in DIAGNOSTIC_PROTOCOL_SEEDS
    ]
    protocol = {
        "schema": DIAGNOSTIC_PROTOCOL_SCHEMA,
        "creator": creator_id,
        "purpose": "held-out candidate-versus-no-lora diagnostic; not a promotion record",
        "promotion": {"allowed": False},
        "persona": {
            "id": persona["id"],
            "age_stage": _tester_age_stage(persona),
            "canonical_anchor": selected_anchor,
            "reference_set": anchors,
        },
        "checkpoints": checkpoints,
        "prompts": prompts,
        "seeds": list(DIAGNOSTIC_PROTOCOL_SEEDS),
        "cells": cells,
        "criteria": _diagnostic_criteria(_tester_age_stage(persona)),
    }
    _write_frozen_json(out, protocol)
    return protocol


HELD_OUT_DIAGNOSTIC_PREPARATION_SCHEMA = "figment/held-out-diagnostic-preparation@1"


def _source_fingerprint(path: Path) -> dict[str, Any]:
    original = Path(path)
    if original.is_symlink():
        raise FigmentTrainError(f"diagnostic source must not be a symlink: {original}")
    path = original.resolve()
    if not path.is_file() or path.is_symlink():
        raise FigmentTrainError(f"diagnostic source must be a regular file: {path}")
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": _sha256(path)}


def _assert_source_fingerprint(snapshot: dict[str, Any]) -> None:
    current = _source_fingerprint(Path(snapshot["path"]))
    if current != snapshot:
        raise FigmentTrainError(f"diagnostic source changed during preparation: {snapshot['path']}")


def _validated_held_out_diagnostic(
    creator_id: str,
    protocol_path: Path,
    candidate_checkpoint: Path,
    *,
    personas_root: Path,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """Load one frozen diagnostic protocol and prove it still matches current local inputs."""
    protocol = _read_json(protocol_path)
    if not isinstance(protocol, dict) or protocol.get("schema") != DIAGNOSTIC_PROTOCOL_SCHEMA:
        raise FigmentTrainError("held-out diagnostic protocol schema is not supported")
    if protocol.get("creator") != creator_id or protocol.get("promotion") != {"allowed": False}:
        raise FigmentTrainError("held-out diagnostic must belong to this creator and be non-promotable")

    persona, training, pins = _load_inputs(creator_id, personas_root)
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    persona = dict(persona)
    persona["_persona_path"] = str(persona_path)
    expected_prompt = _tester_prompt(persona, training)
    expected_anchors = []
    for relative in persona["identity"]["references"]:
        expected_anchors.append({
            "reference": relative,
            **_diagnostic_file_entry(persona_path.parent / relative),
        })
    protocol_persona = protocol.get("persona")
    if not isinstance(protocol_persona, dict):
        raise FigmentTrainError("held-out diagnostic persona is malformed")
    if (protocol_persona.get("id") != creator_id
            or protocol_persona.get("age_stage") != _tester_age_stage(persona)
            or protocol_persona.get("reference_set") != expected_anchors):
        raise FigmentTrainError("held-out diagnostic persona or reference set is stale")
    canonical = protocol_persona.get("canonical_anchor")
    if not isinstance(canonical, dict) or canonical not in expected_anchors:
        raise FigmentTrainError("held-out diagnostic canonical anchor is stale or malformed")

    prompts = protocol.get("prompts")
    expected_prompts = [{
        "id": "persona-age-portrait-v1",
        "text": expected_prompt,
        "age_source": "persona.identity.look.age_stage",
    }]
    if prompts != expected_prompts:
        raise FigmentTrainError("held-out diagnostic prompt is stale or malformed")
    if protocol.get("seeds") != list(DIAGNOSTIC_PROTOCOL_SEEDS):
        raise FigmentTrainError("held-out diagnostic seeds are not the fixed protocol seeds")
    if protocol.get("criteria") != _diagnostic_criteria(_tester_age_stage(persona)):
        raise FigmentTrainError("held-out diagnostic criteria are stale or malformed")

    candidate_checkpoint = Path(candidate_checkpoint)
    candidate = _diagnostic_file_entry(candidate_checkpoint)
    checkpoints = protocol.get("checkpoints")
    expected_checkpoints = [
        {"id": "candidate-lora", "kind": "lora", "candidate": candidate},
        {
            "id": "base-control-no-lora",
            "kind": "base-model-no-lora",
            "models": deepcopy(pins["pins"]["tester"]["models"]),
        },
    ]
    if checkpoints != expected_checkpoints:
        raise FigmentTrainError("held-out diagnostic checkpoint or tester pins are stale")
    expected_cells = [
        {
            "id": f"{checkpoint['id']}--persona-age-portrait-v1--seed-{seed}",
            "checkpoint": checkpoint["id"],
            "prompt": "persona-age-portrait-v1",
            "seed": seed,
        }
        for checkpoint in expected_checkpoints
        for seed in DIAGNOSTIC_PROTOCOL_SEEDS
    ]
    if protocol.get("cells") != expected_cells:
        raise FigmentTrainError("held-out diagnostic cells are stale or malformed")
    return protocol, persona, training, pins, expected_cells


def compile_held_out_diagnostic(
    creator_id: str,
    protocol_path: Path,
    candidate_checkpoint: Path,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
    ledger_dir: Path | None = None,
) -> dict[str, Any]:
    """Compile one frozen ten-cell LoRA/control diagnostic without running it.

    The output is deliberately a native harness manifest plus a non-promotable preparation
    record, not a train plan, approval, or execution result.  Candidate/control graphs are
    reconstructed independently per job so control rewires cannot affect a LoRA arm.
    """
    raw_out = Path(out)
    raw_protocol = Path(protocol_path)
    raw_candidate = Path(candidate_checkpoint)
    if raw_out.is_symlink() or raw_protocol.is_symlink() or raw_candidate.is_symlink():
        raise FigmentTrainError("held-out diagnostic inputs and output must not be symlinks")
    out = raw_out.resolve()
    protocol_path = raw_protocol.resolve()
    candidate_checkpoint = raw_candidate.resolve()
    if out.exists() or raw_out.is_symlink():
        raise FigmentTrainError(f"refusing to overwrite held-out diagnostic output: {out}")
    protocol, persona, training, pins, cells = _validated_held_out_diagnostic(
        creator_id, protocol_path, candidate_checkpoint, personas_root=Path(personas_root),
    )
    persona_path = Path(persona["_persona_path"])
    snapshots = [
        _source_fingerprint(protocol_path),
        _source_fingerprint(candidate_checkpoint),
        _source_fingerprint(persona_path),
        *[_source_fingerprint(persona_path.parent / relative)
          for relative in persona["identity"]["references"]],
        _source_fingerprint(PINS_PATH),
        _source_fingerprint(Path(__file__)),
        _source_fingerprint(TESTER_START_PATH),
    ]
    # Real personas normally keep mutable training values in a sidecar; compact fixtures
    # and older personas embed them in persona.yaml, which is already fingerprinted.
    training_path = persona_path.with_name("training.yaml")
    if training_path.is_file():
        snapshots.append(_source_fingerprint(training_path))
    # A source can change after the first validation but before its snapshot. Re-run the
    # complete contract after snapshots so the snapshot is bound to the exact candidate,
    # anchors, prompt, training configuration and pins that the protocol validated.
    protocol, persona, training, pins, cells = _validated_held_out_diagnostic(
        creator_id, protocol_path, candidate_checkpoint, personas_root=Path(personas_root),
    )

    try:
        out.mkdir(parents=True, exist_ok=False)
    except FileExistsError as exc:
        raise FigmentTrainError(f"refusing to overwrite held-out diagnostic output: {out}") from exc
    staged_dir = out / "inputs"
    staged_dir.mkdir()
    staged = staged_dir / candidate_checkpoint.name
    shutil.copy2(candidate_checkpoint, staged)
    candidate = _diagnostic_file_entry(candidate_checkpoint)
    if _diagnostic_file_entry(staged) != candidate:
        raise FigmentTrainError("staged held-out checkpoint does not match candidate bytes")
    start_script = out / TESTER_START_PATH.name
    start_script.write_text(
        TESTER_START_PATH.read_text(encoding="utf-8")
        .replace("creator-001", creator_id)
        .replace("creator001krea2", training["trigger"]),
        encoding="utf-8",
    )

    manifest = {
        **_pod_base(pins, training["pod_class"], "tester"),
        "models": deepcopy(pins["pins"]["tester"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["tester"]["custom_nodes"]),
        "workflow": _tester_workflow(persona, training),
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [f"inputs/{candidate_checkpoint.name}"],
            "subfolder": training["trigger"],
            "type": "input",
            "overwrite": True,
            "chunk_bytes": 16777216,
        }],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{training['trigger']}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": TESTER_START_PATH.name,
        },
        "jobs": [],
    }
    short = _creator_output_code(creator_id)
    for index, cell in enumerate(cells):
        is_candidate = cell["checkpoint"] == "candidate-lora"
        substitutions = [
            {"node_id": "5", "field": "text", "value": protocol["prompts"][0]["text"]},
            {"node_id": "4", "field": "lora_name", "value": candidate_checkpoint.name},
            {"node_id": "4", "field": "strength_model", "value": 1.0 if is_candidate else 0.0},
            {"node_id": "4", "field": "strength_clip", "value": 1.0 if is_candidate else 0.0},
        ]
        if not is_candidate:
            substitutions.extend([
                {"node_id": "5", "field": "clip", "value": ["2", 0]},
                {"node_id": "8", "field": "model", "value": ["1", 0]},
            ])
        manifest["jobs"].append({
            "seed": cell["seed"],
            "output_name": f"{short}-heldout-{'lora' if is_candidate else 'base'}-{cell['seed']}",
            "expected_images": 1,
            **({"wait_for": "_loras.assembled"} if index == 0 else {}),
            "substitutions": substitutions,
        })
    minimum_minutes = math.ceil(_pod_runner_module().minimum_runtime_minutes(manifest))
    if minimum_minutes > manifest["max_minutes"]:
        raise FigmentTrainError(
            "held-out diagnostic exceeds the existing tester runtime cap: "
            f"minimum={minimum_minutes}, cap={manifest['max_minutes']}"
        )
    for snapshot in snapshots:
        _assert_source_fingerprint(snapshot)
    protocol, persona, training, pins, cells = _validated_held_out_diagnostic(
        creator_id, protocol_path, candidate_checkpoint, personas_root=Path(personas_root),
    )
    if _diagnostic_file_entry(staged) != candidate:
        raise FigmentTrainError("staged held-out checkpoint changed during preparation")
    manifest_path = out / "held-out-diagnostic-manifest.json"
    _write_frozen_json(manifest_path, manifest)
    resolved_ledger_dir = _resolved_ledger_dir(ledger_dir)
    run_out = out / "run"
    planned_run = _planned_run(out, manifest_path, run_out, ledger_dir=resolved_ledger_dir)
    preparation = {
        "schema": HELD_OUT_DIAGNOSTIC_PREPARATION_SCHEMA,
        "creator": creator_id,
        "promotion": {"allowed": False},
        "protocol": {"path": str(protocol_path), "sha256": _sha256(protocol_path)},
        "candidate": candidate,
        "sources": snapshots,
        "manifest": {"path": _relative(manifest_path, out), "sha256": _sha256(manifest_path)},
        "minimum_runtime_minutes": minimum_minutes,
        "run": planned_run,
    }
    _write_frozen_json(out / "preparation.json", preparation)
    return preparation


# ---------------------------------------------------------------------------
# Generation (module 09, Track-2 Task D2) + the cheap re-detail mode (r25 cause #2)
# ---------------------------------------------------------------------------

GEN_ROW_SEED_BASE = 269789944143426
DETAIL_SEED_BASE = 100200300


def _generalized_gen_prompts(persona: dict, training: dict) -> dict[str, Any]:
    """Build the gen-stage's rows entirely from `gen-prompts.yaml`'s generic photography
    vocabulary plus the persona's own `identity.look` (same discipline as
    `_generalized_anchor_prompts` -- never a template-hardcoded face/body clause), each
    row opening with the persona's own trigger (`_compose_triggered_prompt`) so the LoRA
    is always explicitly invoked."""
    prompts = _read_json(GEN_PROMPTS_PATH)
    prompts["persona"] = persona["id"]
    look = persona.get("identity", {}).get("look")
    if not isinstance(look, dict):
        raise FigmentTrainError(
            "persona.identity.look is required to compose the gen-stage prompts"
        )
    clause = _compose_look_clause(look)
    prompts["rows"] = [
        _compose_triggered_prompt(
            training, prompts["base_clause"].format(look=clause, scene=scene),
        )
        for scene in prompts["scenes"]
    ]
    return prompts


def _gen_workflow(training: dict, pins: dict) -> dict[str, Any]:
    """Load `krea2_gen_api.json` and, when `training.style_lora` is unset, delete node
    `40` (the style `LoraLoaderModelOnly`) and rewire nodes `8`/`15`/`33`'s `model` input
    back to the identity LoRA (node `4`) -- no bypassed node ever ships in a manifest
    (Track-2 Task D2)."""
    workflow = _read_json(GEN_WORKFLOW_PATH)
    style_key = training.get("style_lora")
    if style_key is None:
        del workflow["40"]
        for node_id in ("8", "15", "33"):
            if workflow[node_id]["inputs"].get("model") == ["40", 0]:
                workflow[node_id]["inputs"]["model"] = ["4", 0]
    else:
        try:
            pins["pins"]["style_loras"][style_key]
        except KeyError as exc:
            raise FigmentTrainError(
                f"unknown training.style_lora key {style_key!r}"
            ) from exc
        workflow["40"]["inputs"]["strength_model"] = training["style_lora_strength"]
    return workflow


def _gen_manifest(
    persona: dict, training: dict, pins: dict, *, checkpoint_upload: str | None = None,
) -> dict[str, Any]:
    """`_gen_manifest` mirrors `_tester_manifest` -- `_pod_base`, `pins.gen`
    models/nodes, the lorapath launcher's `training` block, a chunked upload of ONLY the
    chosen checkpoint, `seed_fields: ["seed", "noise_seed"]` -- but plans generation, not
    testing: one job per gen-prompts row, each producing base + refined + detailed
    (`expected_images: 3`). Raises until GATE 3 has recorded a checkpoint (Task A3/C2)."""
    chosen_step = training.get("chosen_checkpoint_step")
    if chosen_step is None:
        raise FigmentTrainError(
            "gen requires a chosen checkpoint; run apply-rulings --stage tester first"
        )
    creator_id = persona["id"]
    trigger = training["trigger"]
    short = _creator_output_code(creator_id)
    checkpoint_name = _checkpoint_name(trigger, chosen_step)
    prompts = _generalized_gen_prompts(persona, training)
    workflow = _gen_workflow(training, pins)

    models = deepcopy(pins["pins"]["gen"]["models"])
    style_key = training.get("style_lora")
    if style_key is not None:
        style_pin = pins["pins"]["style_loras"][style_key]
        models.append(deepcopy(style_pin["model"]))

    jobs = []
    for index, row in enumerate(prompts["rows"]):
        substitutions = [
            {"node_id": "5", "field": "text", "value": row},
            {"node_id": "4", "field": "lora_name", "value": checkpoint_name},
            # seed_fields sweeps every "seed" input (including nodes 15/33) to the job's
            # own seed for base-image diversity; pin the refine and detail passes back to
            # a fixed seed the same way the hand-written manifest pinned node 15 (module
            # 09's own convention -- only the base render varies per job).
            {"node_id": "15", "field": "seed", "value": 40},
            {"node_id": "33", "field": "seed", "value": 40},
        ]
        if style_key is not None:
            substitutions.append({
                "node_id": "40", "field": "lora_name",
                "value": pins["pins"]["style_loras"][style_key]["model"]["filename"],
            })
        jobs.append({
            "seed": GEN_ROW_SEED_BASE + index,
            "output_name": f"{short}-tensor-gen-{index + 1:02d}",
            "expected_images": 3,
            **({"wait_for": "_loras.assembled"} if index == 0 else {}),
            "substitutions": substitutions,
        })

    checkpoint_upload = checkpoint_upload or f"out/{creator_id}-tensor-train/{checkpoint_name}"
    return {
        **_pod_base(pins, training["pod_class"], "gen"),
        "models": models,
        "custom_nodes": deepcopy(pins["pins"]["gen"]["custom_nodes"]),
        "workflow": workflow,
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [checkpoint_upload],
            "subfolder": trigger,
            "type": "input",
            "overwrite": True,
            "chunk_bytes": 16777216,
        }],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{trigger}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": "start-comfy-lorapath.sh.template",
        },
        "jobs": jobs,
    }


def _copy_detail_images(out: Path, persona: dict, image_paths: list[Path]) -> list[str]:
    """Copy each `--detail-images` match into the plan's own upload tree
    (`_uploads/<persona>/<name>`, the same convention `_copy_support_files` uses for
    anchor references) -- `pod/runpod_run.py`'s upload expansion refuses any path outside
    the manifest's own directory, so a source image living anywhere else on disk must be
    staged inside `out` before a manifest can reference it."""
    upload_dir = out / "train" / "runs" / "_uploads" / persona["id"]
    upload_dir.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    seen: set[str] = set()
    for source in image_paths:
        source = Path(source).resolve()
        if not source.is_file():
            raise FigmentTrainError(f"--detail-images match is not a file: {source}")
        name = source.name
        if name in seen:
            raise FigmentTrainError(
                f"--detail-images matched two files with the same name {name!r}"
            )
        seen.add(name)
        shutil.copy2(source, upload_dir / name)
        names.append(name)
    return names


def _detail_manifest(
    persona: dict, training: dict, pins: dict, names: list[str], *,
    checkpoint_upload: str | None = None,
) -> dict[str, Any]:
    """r25 ranked cause #2, made durable: re-detail already-rendered Track-1
    tester/dataset cells (named by `names`, already staged under
    `train/runs/_uploads/<persona>/` by `_copy_detail_images`) at the package's own
    denoise band without spending a full regeneration. Two jobs per image -- `denoise
    0.15` and `denoise 0.27` -- both loading the same chosen checkpoint `_gen_manifest`
    uses, sharing one seed per source image so the pair is a controlled A/B."""
    chosen_step = training.get("chosen_checkpoint_step")
    if chosen_step is None:
        raise FigmentTrainError(
            "gen requires a chosen checkpoint; run apply-rulings --stage tester first"
        )
    creator_id = persona["id"]
    trigger = training["trigger"]
    short = _creator_output_code(creator_id)
    checkpoint_name = _checkpoint_name(trigger, chosen_step)
    workflow = _read_json(DETAIL_WORKFLOW_PATH)
    workflow["5"]["inputs"]["text"] = _compose_triggered_prompt(
        training, workflow["5"]["inputs"]["text"],
    )

    jobs = []
    for image_index, name in enumerate(names):
        for variant_index, denoise in enumerate((0.15, 0.27)):
            job_index = image_index * 2 + variant_index
            jobs.append({
                "seed": DETAIL_SEED_BASE + image_index,
                "output_name": f"{short}-tensor-detail-{image_index + 1:02d}-d{str(denoise).replace('.', '')}",
                "expected_images": 1,
                **({"wait_for": "_loras.assembled"} if job_index == 0 else {}),
                "substitutions": [
                    {"node_id": "1", "field": "image", "value": f"{creator_id}/{name}"},
                    {"node_id": "4", "field": "lora_name", "value": checkpoint_name},
                    {"node_id": "15", "field": "denoise", "value": denoise},
                ],
            })

    checkpoint_upload = checkpoint_upload or f"out/{creator_id}-tensor-train/{checkpoint_name}"
    return {
        **_pod_base(pins, training["pod_class"], "detail"),
        "models": deepcopy(pins["pins"]["detail"]["models"]),
        "custom_nodes": deepcopy(pins["pins"]["detail"]["custom_nodes"]),
        "workflow": workflow,
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [
            {
                "files": [f"_uploads/{creator_id}/{name}" for name in names],
                "subfolder": creator_id,
                "type": "input",
                "overwrite": True,
            },
            {
                "files": [checkpoint_upload],
                "subfolder": trigger,
                "type": "input",
                "overwrite": True,
                "chunk_bytes": 16777216,
            },
        ],
        "training": {
            "lora_source_dir": f"/workspace/ComfyUI/input/{trigger}",
            "start_script_path": "/workspace/start-comfy-lorapath.sh",
            "start_script_file": "start-comfy-lorapath.sh.template",
        },
        "jobs": jobs,
    }


def _caption_manifest(
    pins: dict[str, Any], creator_id: str, trigger: str, names: list[str],
    *, pod_class: str = "l40s",
) -> dict[str, Any]:
    """M4: qwen3vl captioning as one pinned pod job through the existing harness --
    same manifest shape `_train_manifest` already uses (`_pod_base`, a ComfyUI
    transport-sentinel job satisfying the harness's own job-completion contract while
    `training.start_script_*` does the real work in the background, `artifacts` +
    `wait_for` for the downloaded result), never a second framework.

    `names` are filenames already staged under
    `train/runs/_uploads/<creator_id>/` (`_copy_detail_images`'s own convention,
    reused here -- pod/runpod_run.py's upload expansion refuses any path outside the
    manifest's own directory, so an arbitrary source image must be staged first).

    The pinned `caption` pin profile's safetensors shards (verified sha256,
    tensor-pins.yaml) download through the SAME `manifest["models"]` mechanism every
    other stage uses -- no separate transport. The small companion config/tokenizer
    files are fetched at the SAME pinned, immutable revision at pod time (same
    precedent as `start-training-aitoolkit.sh.template`'s own module-11
    companion-model prewarm for Qwen3-VL-4B-Instruct / Qwen-Image)."""
    caption_pin = pins["pins"]["caption"]
    models = caption_pin.get("models")
    if not isinstance(models, list) or not models:
        raise FigmentTrainError("pins.pins.caption.models must be a non-empty list")
    model_pin = models[0]
    for field in ("repo_id", "revision", "destination_dir"):
        if not isinstance(model_pin.get(field), str) or not model_pin[field].strip():
            raise FigmentTrainError(f"pins.pins.caption model pin is missing {field!r}")
    settings = _build_set_module().QWEN3VL_CAPTION_SETTINGS
    return {
        **_pod_base(pins, pod_class, "caption"),
        "models": deepcopy(models),
        "custom_nodes": deepcopy(caption_pin.get("custom_nodes", [])),
        "workflow": {"1": {"class_type": "KSampler", "inputs": {"seed": 100001}}},
        "seed_fields": ["seed", "noise_seed"],
        "uploads": [{
            "files": [f"_uploads/{creator_id}/{name}" for name in names]
                     + [f"_uploads/{creator_id}/_images.ready"],
            "subfolder": trigger,
            "type": "input",
            "overwrite": True,
        }],
        "training": {
            "trigger": trigger,
            "caption_model_repo": model_pin["repo_id"],
            "caption_model_revision": model_pin["revision"],
            "caption_model_dir": model_pin["destination_dir"],
            "caption_model_dtype": settings["dtype"],
            "caption_max_resolution": settings["max_resolution"],
            "caption_max_new_tokens": settings["max_new_tokens"],
            "hf_home": "/workspace/hf",
            "complete_marker": "/workspace/output/_caption.complete",
            "failed_marker": "/workspace/output/_caption.failed",
            "start_script_path": "/workspace/start-qwen3vl-caption.sh",
            "start_script_file": "start-qwen3vl-caption.sh.template",
        },
        "artifacts": [{
            "remote": CAPTION_ARTIFACT_NAME,
            "local": CAPTION_ARTIFACT_NAME,
            "type": "output",
            "wait_for": "_caption.complete",
        }],
        "jobs": [{
            "seed": 100001,
            "output_name": f"caption-transport-sentinel-{trigger}",
            "substitutions": [],
            "expected_images": 1,
        }],
    }


def _render_training_config(
    trigger: str, steps: int, save_every: int, *,
    dop_enabled: bool = False, dop_multiplier: float = 1.0, dop_class: str = "person",
    training_seed: int | None = None,
) -> dict[str, Any]:
    renderer = _render_module()
    intermediate_count = len(_checkpoint_steps(steps, save_every))
    context = dict(renderer.MODULE_11)
    context.update({
        "trigger": trigger,
        "dataset_dir": f"/workspace/ComfyUI/input/{trigger}",
        "output_dir": "/workspace/train-output",
        "base_model_path": "/workspace/models/krea2/krea2_raw_bf16.safetensors",
        "steps": steps,
        "save_every": save_every,
        "max_step_saves_to_keep": max(15, intermediate_count),
        # Path-A train-first (r24 method 4 + r21 DOP): off by default -- every existing
        # `build_plan` caller below passes none of these, so it keeps rendering exactly
        # the same config it always has.
        "dop_enabled": str(dop_enabled).lower(),
        "dop_multiplier": str(dop_multiplier),
        "dop_class": dop_class,
    })
    rendered = renderer.render(AI_TEMPLATE_PATH.read_text(encoding="utf-8"), context)
    config = renderer.yaml.safe_load(rendered)
    renderer.apply_dop_trigger_word(config, trigger)
    # Optional trainer seed: the pinned ai-toolkit (BaseTrainProcess) reads
    # `config.process[0].training_seed` and seeds torch/CUDA/Python `random` before it
    # builds the model and dataloader. NumPy and CUDA kernels stay nondeterministic, so
    # this pins the seed, not the outcome. `None` adds no key, so every existing caller
    # keeps rendering exactly the config it always has; the template is untouched.
    if training_seed is not None:
        if type(training_seed) is not int or not 0 <= training_seed < 2**32:
            raise FigmentTrainError("training_seed must be an integer in [0, 2**32)")
        try:
            process = config["config"]["process"][0]
        except (KeyError, IndexError, TypeError) as exc:
            raise FigmentTrainError("rendered training config has no process to seed") from exc
        if not isinstance(process, dict):
            raise FigmentTrainError("rendered training config has no process to seed")
        process["training_seed"] = training_seed
    try:
        renderer.validate_rendered_pod_paths(config)
    except ValueError as exc:
        raise FigmentTrainError(f"rendered training config is unsafe: {exc}") from exc
    return config


def _copy_anchors(out: Path, persona: dict) -> list[str]:
    """Copy this persona's identity reference images into `out`'s own upload tree and
    return their `out`-relative paths, in `persona.yaml` order. Shared by `build_plan`
    (via `_copy_support_files`) and `build_train_first_plan` -- both plan.json flavors
    need `plan["assets"]["anchors"]` populated with real, `out`-relative files for
    `build_grade`/`_run_identity_gate` to find, regardless of whether this plan also
    stages a fresh anchor/dataset run."""
    anchor_paths = []
    persona_dir = Path(persona["_persona_path"]).parent
    anchor_dir = out / "expand" / "runs" / "_uploads" / persona["id"]
    anchor_dir.mkdir(parents=True, exist_ok=True)
    for relative in persona["identity"]["references"]:
        source = (persona_dir / relative).resolve()
        target = anchor_dir / source.name
        shutil.copy2(source, target)
        anchor_paths.append(_relative(target, out))
    return anchor_paths


def _persona_dir_asset(persona: dict) -> str:
    """ROOT-relative (never `out`-relative, review MED-8: the persona dir usually lives
    outside `out` entirely) path for `plan["assets"]["persona_dir"]`. Shared by
    `build_plan` and `build_train_first_plan` so both plan.json flavors resolve it the
    same way (`_load_persona_document_for_gate`, apply_rulings' anchor promotion)."""
    return Path(persona["_persona_path"]).resolve().parent.relative_to(
        ROOT.resolve(), walk_up=True,
    ).as_posix()


def _copy_support_files(out: Path, persona: dict, prompts: dict, workflow: dict) -> dict[str, Any]:
    expand_workflow = out / "expand" / "workflows" / WORKFLOW_PATH.name
    fullbody_workflow = out / "expand" / "workflows" / FULLBODY_WORKFLOW_PATH.name
    anchor_workflow = out / "expand" / "workflows" / ANCHOR_WORKFLOW_PATH.name
    expand_prompts = out / "expand" / "templates" / PROMPTS_PATH.name
    # Review LOW-10: the anchor prompts were the one thing `_copy_support_files` didn't
    # bundle -- `plan.json` copied the dataset template but not this one, so it was not a
    # self-contained reproduction of what the anchor stage actually rendered.
    expand_anchor_prompts = out / "expand" / "templates" / ANCHOR_PROMPTS_PATH.name
    train_runs = out / "train" / "runs"
    _write_json(expand_workflow, workflow)
    _write_json(fullbody_workflow, _fullbody_dataset_workflow(workflow))
    _write_json(anchor_workflow, _read_json(ANCHOR_WORKFLOW_PATH))
    _write_json(expand_prompts, prompts)
    _write_json(expand_anchor_prompts, _generalized_anchor_prompts(persona))
    train_runs.mkdir(parents=True, exist_ok=True)
    for source in (TRAIN_START_PATH, TESTER_START_PATH):
        text = source.read_text(encoding="utf-8")
        text = text.replace("creator-001", persona["id"])
        text = text.replace("creator001krea2", persona["training"]["trigger"])
        (train_runs / source.name).write_text(text, encoding="utf-8")

    return {
        "anchors": _copy_anchors(out, persona),
        "dataset_workflow": _relative(expand_workflow, out),
        "dataset_fullbody_workflow": _relative(fullbody_workflow, out),
        "dataset_prompts": _relative(expand_prompts, out),
        "anchor_prompts": _relative(expand_anchor_prompts, out),
    }


def _resolved_ledger_dir(explicit: Path | None = None) -> Path:
    """Freeze the harness's ledger selection into a plan before any run is emitted."""
    pod_module = _pod_runner_module()
    return Path(pod_module.configured_ledger_dir(explicit)).resolve()


def _planned_run(
    out: Path, manifest_path: Path, run_out: Path, *, ledger_dir: Path,
    external_manifest: bool = False,
) -> dict[str, Any]:
    """`external_manifest` is the `video` stage only -- see `_relative`'s own docstring
    for why that one manifest cannot live inside its plan's root."""
    manifest = _read_json(manifest_path)
    ceiling = manifest_ceiling(manifest)
    argv = [
        sys.executable,
        str(POD_RUNNER),
        "run",
        "--manifest", str(manifest_path.resolve()),
        "--out", str(run_out.resolve()),
        "--max-usd", ceiling,
        "--max-minutes", str(manifest["max_minutes"]),
        "--ledger-dir", str(ledger_dir),
        "--arc-cap-usd", ARC_CAP_USD,
        "--arc-ledger-glob", ARC_LEDGER_GLOB,
    ]
    result = {
        "manifest": _relative(manifest_path, out, walk_up=external_manifest),
        "sha256": _sha256(manifest_path),
        "ceiling_usd": ceiling,
        "out": _relative(run_out, out),
        "argv": argv,
        "cli": subprocess.list2cmdline(argv),
    }
    if "_budget" in manifest:
        result["budget"] = manifest["_budget"]
    return result


def plan_qwen3vl_caption(
    creator_id: str, trigger: str, image_paths: list[Path], plan_root: Path,
    *, pod_class: str = "l40s", ledger_dir: Path | None = None,
    skip_pin_verify: bool = False,
) -> dict[str, Any]:
    """M4: plan (never run) one qwen3vl captioning pod job -- the exact `_planned_run`
    pattern `build_plan` uses for every other stage. Exposed for
    `build_training_set.py --mode qwen3vl --plan-root <root>` (a local, never-a-pod
    planning step, consistent with that tool's own "runs locally, never on a pod"
    charter) and for `_live_qwen3vl_job_runner` below, which plans then actually
    dispatches. Writes `<plan_root>/train/runs/<trigger>-tensor-caption.yaml` and
    stages every image under `_uploads/<creator_id>/` (`_copy_detail_images`'s own
    convention -- the harness refuses any upload path outside the manifest's own
    directory). Never calls `subprocess`."""
    plan_root = Path(plan_root).resolve()
    pins = _read_json(PINS_PATH)
    if not skip_pin_verify:
        module = _verify_pins_module()
        try:
            results = module.verify_pins(pins, stages=["caption"])
        except module.VerifyPinsError as exc:
            raise FigmentTrainError(f"pin verification could not run: {exc}") from exc
        if results:
            lines = [
                f"[caption] {problem}"
                for problems in results.values() for problem in problems
            ]
            raise FigmentTrainError("pin verification failed:\n" + "\n".join(lines))
    names = _copy_detail_images(plan_root, {"id": creator_id}, image_paths)
    upload_dir = plan_root / "train" / "runs" / "_uploads" / creator_id
    (upload_dir / "_images.ready").write_text("", encoding="utf-8")
    manifest = _caption_manifest(pins, creator_id, trigger, names, pod_class=pod_class)
    manifest_path = plan_root / "train" / "runs" / f"{trigger}-tensor-caption.yaml"
    if manifest_path.exists():
        raise FigmentTrainError(
            f"refusing to overwrite an existing caption manifest: {manifest_path}"
        )
    _write_json(manifest_path, manifest)
    resolved_ledger_dir = _resolved_ledger_dir(ledger_dir)
    run_out = plan_root / "train" / "runs" / "out" / manifest_path.stem
    return _planned_run(plan_root, manifest_path, run_out, ledger_dir=resolved_ledger_dir)


def _live_qwen3vl_job_runner(
    creator_id: str, trigger: str, plan_root: Path, *, pod_class: str = "l40s",
    ledger_dir: Path | None = None, skip_pin_verify: bool = False,
):
    """M4: the real dispatcher `build_training_set.py`'s `qwen3vl` caption mode
    requires -- never invoked by build_training_set.py itself (GUARDRAILS:
    build_training_set.py runs locally, never on a pod), only by a caller that owns a
    plan root and a ledger (apply_rulings's own dataset-stage assembly, below). Plans
    the job (`plan_qwen3vl_caption`), dispatches and verifies it exactly the way
    `run_planned_stage` dispatches every other stage's run (`subprocess.run` the
    frozen argv, then `verify_run_record`) -- not a second, parallel dispatch
    mechanism, the same one, inlined for a job that isn't a STAGES plan entry. Reads
    the downloaded `captions.json` artifact and returns bodies in the job's own image
    order, satisfying `build_training_set.JobRunner`'s exact contract."""
    resolved_ledger_dir = _resolved_ledger_dir(ledger_dir)

    def _runner(job: dict[str, Any]) -> list[str]:
        images = [Path(path) for path in job["images"]]
        planned = plan_qwen3vl_caption(
            creator_id, trigger, images, plan_root, pod_class=pod_class,
            ledger_dir=resolved_ledger_dir, skip_pin_verify=skip_pin_verify,
        )
        manifest_path = plan_root / planned["manifest"]
        run_out = plan_root / planned["out"]
        try:
            result = subprocess.run(planned["argv"], cwd=ROOT)
        except OSError as exc:
            raise FigmentTrainError(
                f"could not launch the caption harness command: {exc}"
            ) from exc
        if result.returncode != 0:
            raise FigmentTrainError(
                f"caption harness stopped with exit code {result.returncode}; no retry attempted"
            )
        manifest = _read_json(manifest_path)
        verify_run_record("caption", manifest, run_out, resolved_ledger_dir)
        captions_path = run_out / CAPTION_ARTIFACT_NAME
        if not captions_path.is_file():
            raise FigmentTrainError(f"caption pod job did not produce {captions_path}")
        # MINOR 9 (REVIEW): bounded the same way the video/ readers bound their own JSON
        # reads (`video_manifest.MAX_JSON_BYTES`) -- a pod's captions.json is never
        # trusted to be a reasonable size before it is parsed.
        if captions_path.stat().st_size > CAPTIONS_MAX_JSON_BYTES:
            raise FigmentTrainError(
                f"caption pod job artifact exceeds {CAPTIONS_MAX_JSON_BYTES} bytes: {captions_path}"
            )
        captions = _read_json(captions_path)
        try:
            return [captions[image.name] for image in images]
        except KeyError as exc:
            raise FigmentTrainError(f"caption pod job did not caption {exc}") from exc

    return _runner


def _budget_preflight(
    plan_stages: dict[str, Any], *, ledger_dir: Path, arc_cap_usd: str, accept_budget: bool,
) -> dict[str, Any]:
    """M2: a plan-time budget preflight so a multi-stage plan is never discovered to be
    unaffordable mid-chain (train would otherwise be refused by `enforce_arc_cap` only
    AFTER anchor+dataset already spent). Reads the SAME ledger the live harness reads
    (`pod/runpod_run.py`'s `arc_budget_state`/`daily_budget_state`) -- never a second,
    independently hand-rolled reader -- and computes:
      (a) the sum of every run this `build_plan` call is about to write, against the
          whole-arc cap remaining (arc_cap_usd - arc already spent). Over this refuses
          the plan unless `accept_budget` is passed.
      (b) each single run's own ceiling against `governance/budget.yaml`'s
          `daily_usd_limit`. This is reported in the table (a run bigger than one day's
          budget is real and, for `train` at DOP step counts, expected -- F5 ruling) but
          never blocks by itself: `enforce_daily_budget` still gates the live run itself
          on its own spend day, unchanged.
    Never touches the harness's own run-time guards -- this only ever runs earlier, at
    plan time, so an unaffordable chain is visible before a single pod boots.
    """
    pod_runner = _pod_runner_module()
    rows: list[dict[str, Any]] = []
    total = Decimal("0")
    for stage_name, stage_plan in plan_stages.items():
        for run in stage_plan["runs"]:
            ceiling = Decimal(str(run["ceiling_usd"]))
            total += ceiling
            rows.append({
                "stage": stage_name, "manifest": run["manifest"], "ceiling_usd": run["ceiling_usd"],
            })
    try:
        arc_cap, arc_spent = pod_runner.arc_budget_state(
            arc_cap_usd=float(arc_cap_usd), ledger_dir=ledger_dir,
        )
        daily_limit, daily_spent = pod_runner.daily_budget_state(ledger_dir=ledger_dir)
    except pod_runner.HarnessError as exc:
        raise FigmentTrainError(f"budget preflight could not read the ledger: {exc}") from exc
    arc_cap_d, arc_spent_d = Decimal(str(arc_cap)), Decimal(str(arc_spent))
    daily_limit_d = Decimal(str(daily_limit))
    arc_remaining = arc_cap_d - arc_spent_d
    over_arc = total > arc_remaining
    over_daily_manifests = [row["manifest"] for row in rows if Decimal(str(row["ceiling_usd"])) > daily_limit_d]

    header = f"{'stage':<10} {'manifest':<55} {'ceiling_usd':>12}  over_daily_limit"
    lines = [
        "BUDGET PREFLIGHT",
        f"  arc:   spent=${arc_spent_d:.4f} + planned=${total:.2f} vs cap=${arc_cap_d:.2f} "
        f"(remaining=${arc_remaining:.2f}) -- {'REFUSED' if over_arc else 'clears'}",
        f"  daily: limit=${daily_limit_d:.2f} (today spent=${Decimal(str(daily_spent)):.4f}, "
        "not summed against the plan -- each run is checked against the limit alone)",
        f"  {header}",
    ]
    for row in rows:
        flag = "YES" if row["manifest"] in over_daily_manifests else ""
        lines.append(f"  {row['stage']:<10} {row['manifest']:<55} {row['ceiling_usd']:>12}  {flag}")
    table = "\n".join(lines)

    if over_arc and not accept_budget:
        raise FigmentTrainError(
            "budget preflight refused this plan (pass --accept-budget to override, or "
            "shrink the plan):\n" + table
        )
    return {
        "table": table,
        "total_planned_usd": f"{total:.2f}",
        "arc_cap_usd": f"{arc_cap_d:.2f}",
        "arc_spent_usd": f"{arc_spent_d:.4f}",
        "arc_remaining_usd": f"{arc_remaining:.2f}",
        "over_arc": over_arc,
        "daily_usd_limit": f"{daily_limit_d:.2f}",
        "runs_over_daily_limit": over_daily_manifests,
        "accepted": bool(accept_budget),
    }


def _stage_run_root(out: Path, stage: str) -> Path:
    if stage in ("anchor", "dataset"):
        return out / "expand" / "runs" / "out"
    if stage == "video":
        return out / "video" / "runs" / "out"
    return out / "train" / "runs" / "out"


def _plan_video_manifest(
    creator_id: str, persona: dict[str, Any], out: Path, *,
    approved_gen_plan: Path | None, approved_gen_image_id: str | None,
    action: str | None,
) -> tuple[dict[str, Any], Path]:
    """Compile this plan's ONE Wan 2.2 I2V review candidate through the existing
    `video_manifest.build_manifest`/`write_manifest` (F6a).

    Everything the compiler's `review-candidate-v1` mode checks -- the ruled `gen` plan,
    its six `grade/gen` evidence documents, the persona the plan itself names, the
    approved still's bytes and the output manifest -- is resolved relative to one root,
    and that root is the repository (`_video_authority_root`, already enforced by
    `build_plan` for the plan's own `--out`). The manifest is written BESIDE the approved
    still, as APPROVED_GEN_ADAPTER.md requires, which is why the planned run records it
    with a walk-up relative path (see `_relative`).

    Narrowed deliberately: the first frame is the approved *gen* still, not the approved
    *detail* image. `validate_approved_gen_still`, `video_manifest._candidate_preflight`,
    `video_review._rebuild_candidate` and `content/content_asset_binding.py`'s slot join
    all bind the string "gen" (grade dir, approval stage, approved-list stage), so a
    detail-sourced candidate needs a stage threaded through four reviewed authorities and
    a widened on-disk candidate-manifest schema -- a design change, not a wiring one.
    """
    if approved_gen_plan is None:
        raise FigmentTrainError(
            "video requires --approved-gen-plan; run apply-rulings --stage gen first"
        )
    gen_plan_dir = _video_authority_root(Path(approved_gen_plan), "the approved gen plan")
    approved_list_path = gen_plan_dir / "grade" / "gen" / "approved-list.json"
    if not approved_list_path.is_file():
        raise FigmentTrainError(
            f"video requires a kept gen still; no {approved_list_path} -- "
            "run apply-rulings --stage gen first"
        )
    approved = _read_json(approved_list_path)
    kept = sorted(
        row["image_id"] for row in approved.get("images", [])
        if isinstance(row, dict) and isinstance(row.get("image_id"), str)
    )
    if not kept:
        raise FigmentTrainError(f"gen approved-list has no kept images: {approved_list_path}")
    image_id = approved_gen_image_id if approved_gen_image_id is not None else kept[0]
    if image_id not in kept:
        raise FigmentTrainError(
            f"gen image {image_id!r} was not kept by this plan's rulings; kept: {kept}"
        )
    authority = validate_approved_gen_still(creator_id, gen_plan_dir / "plan.json", image_id)

    authority_root = ROOT.resolve()
    frame_path = Path(authority["path"]).resolve()
    manifest_path = frame_path.parent / VIDEO_MANIFEST_NAME
    persona_path = Path(persona["_persona_path"]).resolve()
    video = _video_manifest_module()
    try:
        manifest = video.write_manifest(
            root=authority_root,
            persona_path=persona_path.relative_to(authority_root),
            approved_gen_plan=(gen_plan_dir / "plan.json").relative_to(authority_root),
            approved_gen_image_id=image_id,
            action=action if action is not None else VIDEO_DEFAULT_ACTION,
            out=manifest_path.relative_to(authority_root),
            mode=video.CANDIDATE_MODE,
        )
    except video.VideoManifestError as exc:
        raise FigmentTrainError(f"video manifest could not be compiled: {exc}") from exc
    except ValueError as exc:
        raise FigmentTrainError(f"video manifest inputs escape the authority root: {exc}") from exc
    return {
        "approved_gen_plan": str(gen_plan_dir),
        "image_id": image_id,
        "sha256": authority["sha256"],
        "bytes": authority["bytes"],
        "candidate_id": manifest["candidate_id"],
        "manifest": str(manifest_path),
        "action": manifest["motion"]["action"],
    }, manifest_path


def build_plan(
    creator_id: str,
    stage: str,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
    skip_pin_verify: bool = False,
    detail_images: str | None = None,
    approved_gen_plan: Path | None = None,
    approved_gen_image_id: str | None = None,
    video_action: str | None = None,
    ledger_dir: Path | None = None,
    accept_budget: bool = False,
    style_lora: str | None = None,
    style_lora_strength: float | None = None,
    import_checkpoints: Path | None = None,
    import_training_config: Path | None = None,
) -> dict[str, Any]:
    """Generate a complete, immutable plan without touching the hand-written runs.

    `import_checkpoints` (operator-trained LoRA path, MANDATE.md's tier constraint) is a
    local directory of loose `*.safetensors` checkpoint ladder files -- meaningful only
    with `--stage tester` -- discovered and validated by `_discover_imported_checkpoints`,
    staged into the plan's own upload tree, and recorded at
    `plan["stages"]["tester"]["imported_checkpoints"]`. `_tester_manifest` builds the
    SAME ladder-job shape it builds for an in-plan train, just against the discovered
    steps instead of `training["steps"]`/`["save_every"]`. `import_training_config`
    (optional, only meaningful together with `import_checkpoints`) names the training.yaml
    the ladder was actually trained with; absent it, the persona's own current training
    config is used and recorded the same way (`plan["imported_training_config"]`).

    `detail_images` (Track-2 Task D2, r25 cause #2) is a local glob pattern, meaningful
    only when `"gen"` is being planned: each match is staged into the plan's own upload
    tree and an extra `<id>-tensor-detail.yaml` manifest is emitted alongside
    `<id>-tensor-gen.yaml`, re-detailing those existing cells instead of regenerating.
    This is the legacy ad hoc re-detail path (any operator-chosen cells, not
    necessarily gen's own kept output) -- kept unchanged for that use.

    `approved_gen_plan` (F2) is required when `"detail"` is being planned as its own
    STAGES entry: the directory of an already-graded, already-ruled `gen` plan whose
    `grade/gen/approved-list.json` names the KEPT gen stills. Every kept image is
    re-validated through `validate_approved_gen_still` (never trusted from the approved
    list's bytes alone) and re-detailed at the package's own denoise band
    (`_detail_manifest`), always "gen`'s own kept outputs", never an arbitrary glob.

    `style_lora`/`style_lora_strength` (M3) are a `"gen"`-only override of
    `training.style_lora`/`["style_lora_strength"]` for this one plan -- see
    `_resolve_gen_style_lora`. A style LoRA is a gen-plan choice, never a persona fork:
    `training.style_lora` in the persona's own `training.yaml` stays the default when
    neither flag is given.

    `approved_gen_plan` is also required for `"video"` (F6a), where it names the ruled
    `gen` plan whose kept still becomes the I2V first frame: `approved_gen_image_id`
    selects one (default: the first kept id in sorted order) and `video_action` overrides
    `VIDEO_DEFAULT_ACTION`. The manifest itself is compiled by the EXISTING
    `video_manifest.build_manifest` in its `review-candidate-v1` mode -- imported, never
    reimplemented -- so the video first frame keeps the one still-lineage authority
    (`validate_approved_gen_still`) the whole `video/` subsystem, `video_review.py`'s
    candidate rebuild and `content/content_asset_binding.py`'s slot join already share.
    Its output root must therefore be inside this repository (`_video_authority_root`).
    """
    if stage not in (*STAGES, "all"):
        raise FigmentTrainError(f"unknown stage {stage!r}")
    if detail_images is not None and stage not in ("gen", "all"):
        raise FigmentTrainError("--detail-images is only meaningful for --stage gen")
    if import_checkpoints is not None and stage != "tester":
        raise FigmentTrainError("--import-checkpoints is only meaningful for --stage tester")
    if import_training_config is not None and import_checkpoints is None:
        raise FigmentTrainError(
            "--import-training-config is only meaningful together with --import-checkpoints"
        )
    if approved_gen_plan is not None and stage not in ("detail", "video"):
        raise FigmentTrainError(
            "--approved-gen-plan is only meaningful for --stage detail or --stage video"
        )
    if (style_lora is not None or style_lora_strength is not None) and stage != "gen":
        raise FigmentTrainError(
            "--style-lora/--style-lora-strength is only meaningful for --stage gen"
        )
    if approved_gen_image_id is not None and stage != "video":
        raise FigmentTrainError("--approved-gen-image-id is only meaningful for --stage video")
    if video_action is not None and stage != "video":
        raise FigmentTrainError("--video-action is only meaningful for --stage video")
    if stage == "video":
        _video_authority_root(out, "a video plan's --out")
    out = Path(out).resolve()
    if (out / "plan.json").exists():
        raise FigmentTrainError(f"refusing to overwrite an existing plan: {out / 'plan.json'}")
    if out.exists() and any(out.iterdir()):
        raise FigmentTrainError(f"plan output directory must be empty: {out}")
    out.mkdir(parents=True, exist_ok=True)
    resolved_ledger_dir = _resolved_ledger_dir(ledger_dir)

    persona, training, pins = _load_inputs(creator_id, Path(personas_root))
    persona = dict(persona)
    persona["_persona_path"] = str(Path(personas_root) / creator_id / "persona.yaml")

    imported_training_config: dict[str, str] | None = None
    if import_checkpoints is not None:
        if import_training_config is not None:
            imported_training_config_path = Path(import_training_config).resolve()
            training = _load_imported_training_config(creator_id, imported_training_config_path)
        else:
            # Default to the persona's own current training.yaml (or persona.yaml's
            # inline training block when there is no sidecar) -- `training` above is
            # already that document, parsed; this just records ITS provenance.
            sidecar_path = Path(persona["_persona_path"]).with_name("training.yaml")
            imported_training_config_path = (
                sidecar_path if sidecar_path.is_file() else Path(persona["_persona_path"])
            )
        imported_training_config = {
            "path": _config_path_value(imported_training_config_path),
            "sha256": _sha256(imported_training_config_path),
        }

    # M3: apply the plan-time style-LoRA override (a no-op when neither flag is given)
    # before anything downstream reads `training` -- manifests, configs, pin preflight.
    training = _resolve_gen_style_lora(
        training, pins, style_lora=style_lora, style_lora_strength=style_lora_strength,
    )
    # m8: `detail` doesn't consume a style LoRA itself (it re-details gen's already-
    # rendered pixels -- the style LoRA's effect is already baked into them), but its
    # own pin preflight still verifies the upstream gen plan's choice, and its
    # `detail_source` records it for gate/board metadata (an A/B stays visible).
    detail_upstream_style_lora: dict[str, Any] | None = None
    if stage == "detail" and approved_gen_plan is not None:
        upstream_plan_path = Path(approved_gen_plan).resolve() / "plan.json"
        if upstream_plan_path.is_file():
            upstream_training = _read_json(upstream_plan_path).get("training")
            if isinstance(upstream_training, dict) and upstream_training.get("style_lora"):
                detail_upstream_style_lora = {
                    "key": upstream_training["style_lora"],
                    "strength": upstream_training.get("style_lora_strength"),
                }

    selected = list(STAGES if stage == "all" else (stage,))
    if persona["identity"].get("history") and "anchor" in selected:
        if stage != "all":
            raise FigmentTrainError(
                f"{creator_id} already has a promoted anchor (identity.history is non-empty); "
                "the anchor stage cannot be replanned without clearing it by hand"
            )
        selected.remove("anchor")
    # "gen" is only ever planned explicitly, after GATE 3 (Task D2 step5) -- never as
    # part of a `--stage all` chain, alongside the promoted-anchor exclusion above.
    # "detail" and "video" (F2/F6) are likewise always planned explicitly, by name,
    # each pointed at an already-approved upstream stage's output -- neither can be
    # known at `--stage all` planning time.
    for _later_stage in ("gen", "detail", "video"):
        if stage == "all" and _later_stage in selected:
            selected.remove(_later_stage)

    if not skip_pin_verify:
        preflight_training = training
        if detail_upstream_style_lora is not None:
            preflight_training = {**training, "style_lora": detail_upstream_style_lora["key"]}
        _verify_pins_preflight(pins, selected, preflight_training)
        if detail_images and "gen" in selected:
            # `detail` is not a top-level STAGES entry (it rides along with a "gen"
            # plan when --detail-images is given), so STAGE_PIN_PROFILES's per-stage
            # lookup never reaches it -- verify it directly, same fail-closed contract.
            module = _verify_pins_module()
            try:
                results = module.verify_pins(pins, stages=["detail"])
            except module.VerifyPinsError as exc:
                raise FigmentTrainError(f"pin verification could not run: {exc}") from exc
            if results:
                lines = [
                    f"[detail] {problem}"
                    for problems in results.values() for problem in problems
                ]
                raise FigmentTrainError("pin verification failed:\n" + "\n".join(lines))

    prompts = _generalized_prompts(persona)
    workflow = _generalized_dataset_workflow(persona, prompts)
    assets = _copy_support_files(out, persona, prompts, workflow)
    # Review MED-8: store repo-relative (against ROOT), never an absolute machine path --
    # every other asset is `out`-relative, but the persona directory usually lives OUTSIDE
    # `out` entirely (a scratch/tmp plan dir vs. `orgs/figment/personas/<id>`), so it is
    # made relative to ROOT instead: a plan moved to a different checkout of the same repo
    # still resolves to the right tree. `walk_up=True` (3.12+) also covers the common test
    # fixture where the persona lives under a tmp_path outside ROOT entirely.
    assets["persona_dir"] = _persona_dir_asset(persona)

    configs_dir = out / "train" / "configs"
    smoke_config = configs_dir / "training-smoke.json"
    full_config = configs_dir / "training.json"
    _write_json(smoke_config, _render_training_config(training["trigger"], 100, 50))
    _write_json(
        full_config,
        _render_training_config(training["trigger"], training["steps"], training["save_every"]),
    )

    plan_stages: dict[str, Any] = {}
    gen_authority: dict[str, str] | None = None
    detail_source: dict[str, Any] | None = None
    video_source: dict[str, Any] | None = None
    imported_checkpoints: list[dict[str, Any]] | None = None
    for current in selected:
        if current == "anchor":
            manifests = _anchor_manifests(
                persona, training, pins, _generalized_anchor_prompts(persona),
            )
            paths = [
                out / "expand" / "runs" / f"{creator_id}-anchor-{arm}.yaml"
                for arm in ("passport", "edit")
            ]
        elif current == "dataset":
            manifests = _dataset_manifests(persona, training, pins, prompts)
            paths = [
                out / "expand" / "runs" / f"{creator_id}-tensor-dataset-shard-{n:02d}.yaml"
                for n in range(1, 4)
            ] + [out / "expand" / "runs" / f"{creator_id}-tensor-dataset-fullbody.yaml"]
        elif current == "smoke":
            manifests = [_train_manifest(persona, training, pins, smoke=True)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-train-smoke.yaml"]
        elif current == "train":
            manifests = [_train_manifest(persona, training, pins, smoke=False)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-train.yaml"]
        elif current == "tester":
            if import_checkpoints is not None:
                ladder = _discover_imported_checkpoints(
                    Path(import_checkpoints), training["trigger"], training["steps"],
                )
                staged = _stage_imported_checkpoints(out, persona, ladder)
                intermediate_steps = [
                    row["step"] for row in staged if row["step"] != training["steps"]
                ]
                include_final = any(row["step"] == training["steps"] for row in staged)
                manifests = [_tester_manifest(
                    persona, training, pins,
                    checkpoint_steps=intermediate_steps, include_final=include_final,
                    upload_glob=f"_uploads/{creator_id}/*.safetensors",
                )]
                imported_checkpoints = staged
            else:
                manifests = [_tester_manifest(persona, training, pins)]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-tester.yaml"]
        elif current == "gen":
            accepted_checkpoint = _validated_accepted_checkpoint(persona, training)
            checkpoint_upload = _stage_accepted_checkpoint(
                out, persona, training, accepted_checkpoint=accepted_checkpoint,
            )
            gen_authority = _accepted_checkpoint_snapshot(accepted_checkpoint)
            gen_manifest = _gen_manifest(
                persona, training, pins, checkpoint_upload=checkpoint_upload,
            )
            gen_workflow_path = out / "train" / "workflows" / "krea2_gen_api.json"
            _write_json(gen_workflow_path, gen_manifest.pop("workflow"))
            gen_manifest["workflow"] = "../workflows/krea2_gen_api.json"
            manifests = [gen_manifest]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-gen.yaml"]
            if detail_images:
                image_paths = sorted(Path(p) for p in glob.glob(detail_images))
                if not image_paths:
                    raise FigmentTrainError(
                        f"--detail-images matched no files: {detail_images!r}"
                    )
                names = _copy_detail_images(out, persona, image_paths)
                detail_manifest = _detail_manifest(
                    persona, training, pins, names, checkpoint_upload=checkpoint_upload,
                )
                detail_workflow_path = out / "train" / "workflows" / "krea2_detail_only_api.json"
                _write_json(detail_workflow_path, detail_manifest.pop("workflow"))
                detail_manifest["workflow"] = "../workflows/krea2_detail_only_api.json"
                manifests.append(detail_manifest)
                paths.append(out / "train" / "runs" / f"{creator_id}-tensor-detail.yaml")
        elif current == "detail":
            # F2: `detail` as its own STAGES entry always re-detailts a `gen` plan's own
            # KEPT outputs -- never an operator-chosen glob (that remains the legacy
            # `--detail-images` side mode on "gen", untouched above).
            if approved_gen_plan is None:
                raise FigmentTrainError(
                    "detail requires --approved-gen-plan; run apply-rulings --stage gen first"
                )
            gen_plan_dir = Path(approved_gen_plan).resolve()
            approved_list_path = gen_plan_dir / "grade" / "gen" / "approved-list.json"
            if not approved_list_path.is_file():
                raise FigmentTrainError(
                    f"detail requires kept gen images; no {approved_list_path} -- "
                    "run apply-rulings --stage gen first"
                )
            approved = _read_json(approved_list_path)
            approved_image_ids = [
                row["image_id"] for row in approved.get("images", [])
                if isinstance(row, dict) and isinstance(row.get("image_id"), str)
            ]
            if not approved_image_ids:
                raise FigmentTrainError(f"gen approved-list has no kept images: {approved_list_path}")
            validated = [
                validate_approved_gen_still(creator_id, gen_plan_dir / "plan.json", image_id)
                for image_id in sorted(approved_image_ids)
            ]
            accepted_checkpoint = _validated_accepted_checkpoint(persona, training)
            checkpoint_upload = _stage_accepted_checkpoint(
                out, persona, training, accepted_checkpoint=accepted_checkpoint,
            )
            gen_authority = _accepted_checkpoint_snapshot(accepted_checkpoint)
            names = _copy_detail_images(out, persona, [Path(row["path"]) for row in validated])
            detail_source = {
                "approved_gen_plan": str(gen_plan_dir),
                "images": [
                    {"image_id": row["image_id"], "sha256": row["sha256"], "bytes": row["bytes"]}
                    for row in validated
                ],
            }
            if detail_upstream_style_lora is not None:
                # M3/m8: detail doesn't consume the style LoRA itself, but this is the
                # only record of the upstream gen plan's choice a detail plan carries --
                # gate/board metadata reads it here for A/B visibility.
                detail_source["style_lora"] = detail_upstream_style_lora
            detail_manifest = _detail_manifest(
                persona, training, pins, names, checkpoint_upload=checkpoint_upload,
            )
            detail_workflow_path = out / "train" / "workflows" / "krea2_detail_only_api.json"
            _write_json(detail_workflow_path, detail_manifest.pop("workflow"))
            detail_manifest["workflow"] = "../workflows/krea2_detail_only_api.json"
            manifests = [detail_manifest]
            paths = [out / "train" / "runs" / f"{creator_id}-tensor-detail.yaml"]
        elif current == "video":
            video_source, manifest_path = _plan_video_manifest(
                creator_id, persona, out,
                approved_gen_plan=approved_gen_plan,
                approved_gen_image_id=approved_gen_image_id,
                action=video_action,
            )
            # `video_manifest.write_manifest` already wrote this manifest, and its exact
            # bytes (sort_keys, indent 2, trailing newline) are what `frame_assemble.py`
            # re-hashes into its own assembly receipt -- rewriting it through `_write_json`
            # here would change them. Nothing left to write.
            manifests = []
            paths = [manifest_path]
        else:
            raise FigmentTrainError(f"unknown stage {current!r}")
        for path, manifest in zip(paths, manifests):
            _write_json(path, manifest)
        run_root = _stage_run_root(out, current)
        runs = [
            _planned_run(
                out, path, run_root / path.stem, ledger_dir=resolved_ledger_dir,
                external_manifest=current == "video",
            )
            for path in paths
        ]
        plan_stages[current] = {"runs": runs}
        if current == "tester" and imported_checkpoints is not None:
            plan_stages[current]["imported_checkpoints"] = imported_checkpoints
        if current == "gen" and style_lora is not None:
            # M3: distinguish a plan-time flag override from a persona default in the
            # gen stage's own record -- gate/board metadata reads this for A/B
            # visibility (same precedent as detail_source["style_lora"] above).
            plan_stages[current]["style_lora"] = {
                "key": training["style_lora"], "strength": training["style_lora_strength"],
                "source": "flag",
            }

    budget_preflight = _budget_preflight(
        plan_stages, ledger_dir=resolved_ledger_dir, arc_cap_usd=ARC_CAP_USD,
        accept_budget=accept_budget,
    )
    print(budget_preflight["table"])

    plan = {
        "schema": "figment/train-plan@1",
        "creator": creator_id,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "generator": _sha256(Path(__file__)),
        "persona_sha256": _sha256(Path(persona["_persona_path"])),
        "training": training,
        "assets": assets,
        "configs": {
            "smoke": _relative(smoke_config, out),
            "train": _relative(full_config, out),
        },
        "ledger_dir": str(resolved_ledger_dir),
        "arc_cap_usd": ARC_CAP_USD,
        "arc_ledger_glob": ARC_LEDGER_GLOB,
        "budget_preflight": budget_preflight,
        "stages": plan_stages,
    }
    if gen_authority is not None:
        plan["gen_authority"] = gen_authority
    if detail_source is not None:
        plan["detail_source"] = detail_source
    if video_source is not None:
        plan["video_source"] = video_source
    if imported_training_config is not None:
        plan["imported_training_config"] = imported_training_config
    _write_json(out / "plan.json", plan)
    return plan


TRAIN_FIRST_DATASET_MARKERS = ("_dataset.ready", "dataset_manifest.json")


def accept_train_first_dataset(
    creator_id: str, dataset_dir: Path, *, decided_by: str, decided_at: str,
) -> dict[str, Any]:
    """Record an explicit operator acceptance of an existing captioned dataset."""
    if not decided_by.strip() or not decided_at.strip():
        raise FigmentTrainError("dataset acceptance requires decided_by and decided_at")
    dataset_dir = Path(dataset_dir).resolve()
    approval_path = dataset_dir / "dataset-approval.json"
    if approval_path.exists():
        raise FigmentTrainError(f"refusing to overwrite dataset approval: {approval_path}")
    try:
        subject = _lineage_module().dataset_subject(dataset_dir)
    except ValueError as exc:
        raise FigmentTrainError(f"dataset cannot be accepted: {exc}") from exc
    if subject["count"] < 20:
        raise FigmentTrainError(
            f"dataset has only {subject['count']} images; training requires at least 20"
        )
    document = _lineage_module().wrap_subject(
        _lineage_module().DATASET_APPROVAL_SCHEMA, subject,
        creator=creator_id, decision="verified",
        decided_by=decided_by.strip(), decided_at=decided_at.strip(),
    )
    _write_json(approval_path, document)
    return document


def _validated_train_first_dataset(creator_id: str, dataset_dir: Path) -> dict[str, Any]:
    approval_path = dataset_dir / "dataset-approval.json"
    if not approval_path.is_file():
        raise FigmentTrainError(
            f"train-first dataset has no operator provenance at {approval_path}. For an "
            "existing historical dataset, inspect its full-resolution images and captions, "
            "then run `figment_train.py accept-dataset --creator ... --dataset-dir ... "
            "--decided-by ... --decided-at ...`; a legacy ready marker is insufficient."
        )
    approval = _read_json(approval_path)
    if (approval.get("schema") != _lineage_module().DATASET_APPROVAL_SCHEMA
            or approval.get("creator") != creator_id
            or approval.get("decision") != "verified"
            or not isinstance(approval.get("decided_by"), str)
            or not approval["decided_by"].strip()
            or not isinstance(approval.get("decided_at"), str)
            or not approval["decided_at"].strip()):
        raise FigmentTrainError("train-first dataset approval is malformed or belongs to another creator")
    try:
        current = _lineage_module().dataset_subject(dataset_dir)
        _lineage_module().assert_current(
            approval, current, label="train-first dataset operator approval",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    if current["count"] < 20:
        raise FigmentTrainError(
            f"train-first dataset has only {current['count']} images; training requires at least 20"
        )
    return approval


def _approved_dataset_names(approval: dict[str, Any]) -> set[str]:
    subject = approval.get("subject") or {}
    rows = subject.get("files") or []
    names = {"dataset_manifest.json", "dataset-approval.json"}
    for row in rows:
        if not isinstance(row, dict):
            raise FigmentTrainError("dataset approval has a malformed file inventory")
        for kind in ("image", "caption"):
            entry = row.get(kind)
            name = entry.get("name") if isinstance(entry, dict) else None
            if not isinstance(name, str) or Path(name).name != name:
                raise FigmentTrainError("dataset approval has a malformed file inventory")
            names.add(name)
    # A single-seed curation record is evidence, never an acceptance signal.  Once
    # an operator separately accepts the resulting dataset, its immutable record
    # and retained source/provenance snapshots must accompany the staged dataset so
    # the approval subject remains reviewable and fresh.
    curation = subject.get("curation")
    if curation is not None:
        if not isinstance(curation, dict):
            raise FigmentTrainError("dataset approval has malformed curation evidence")
        rows = [curation.get("record"), *(curation.get("snapshots") or [])]
        if len(rows) < 2:
            raise FigmentTrainError("dataset approval curation evidence is incomplete")
        for row in rows:
            name = row.get("name") if isinstance(row, dict) else None
            if not isinstance(name, str) or Path(name).name != name:
                raise FigmentTrainError("dataset approval has malformed curation evidence")
            names.add(name)
    return names


def _assert_exact_staged_dataset(dataset_dir: Path, approval: dict[str, Any]) -> None:
    expected = _approved_dataset_names(approval) | {"_dataset.ready", "training.json"}
    actual = {item.name for item in dataset_dir.iterdir()}
    if actual != expected:
        raise FigmentTrainError(
            "staged training dataset has unexpected or missing entries; "
            f"missing={sorted(expected - actual)}, unexpected={sorted(actual - expected)}"
        )
    for name in sorted(expected):
        item = dataset_dir / name
        if item.is_symlink() or not item.is_file():
            raise FigmentTrainError(
                f"staged training dataset entry must be a regular file, not a symlink: {name}"
            )


def build_train_first_plan(
    creator_id: str,
    dataset_dir: Path,
    out: Path,
    *,
    personas_root: Path = PERSONAS_ROOT,
    skip_pin_verify: bool = False,
    ledger_dir: Path | None = None,
    accept_budget: bool = False,
) -> dict[str, Any]:
    """Path-A train-first (r24 method 4 + r21 DOP + r25 causes #4/#5): plan a train +
    tester run directly against an ALREADY-BUILT, ALREADY-CAPTIONED dataset directory
    -- `select_training_cells.py` + `build_training_set.py --mode provided`'s output --
    instead of the module-10 dataset stage's fresh generate-then-grade loop.

    Emits the SAME `plan.json` (`figment/train-plan@1`) `build_plan` does, just with
    `stages` limited to `{train, tester}` and a top-level `variant: "train-first"`
    marker (`_install_stage_config`'s only fork on it -- this plan's dataset copy and
    training.json are already fully rendered below, so there is no module-10
    "grade/dataset" ruling step to gate on). That one shared schema is what lets
    `run --stage train|tester|all`, `grade --stage tester`, `apply-rulings`, and `gate`
    all work unchanged against a train-first plan: only `build_plan` itself (never
    `run`/`grade`/`gate`) needs to know how a plan.json was produced. `build_plan`
    still never plans "anchor" or "dataset" for this lineage -- `train-first` is a
    thin sibling entry point, not a `build_plan` stage choice -- and the manifests it
    emits (`<id>-tensor-train-first.yaml`, `<id>-tensor-tester-first.yaml`) are named
    so their local upload/output directories (`<id>-tensor-dataset-train-first`,
    `out/<id>-tensor-train-first/`) can never collide with the module-10 lineage's own
    `<id>-tensor-dataset` / `out/<id>-tensor-train/`. DOP rides whatever
    `training.dop_enabled` / `dop_multiplier` / `dop_class` the persona already
    declares (default off, training_config.py) -- this function never overrides them;
    the "train-first" idea and DOP are independent choices that happen to ship
    together here.

    `dataset_dir` must carry `_dataset.ready`, `dataset_manifest.json`, and a current
    operator `dataset-approval.json`. Every image hash, caption, count, and approval
    subject is verified before copying; this function never selects or captions cells.
    """
    dataset_dir = Path(dataset_dir).resolve()
    if not all((dataset_dir / marker).is_file() for marker in TRAIN_FIRST_DATASET_MARKERS):
        raise FigmentTrainError(
            f"dataset_dir is not ready (missing {' or '.join(TRAIN_FIRST_DATASET_MARKERS)}): "
            f"{dataset_dir}"
        )
    dataset_approval = _validated_train_first_dataset(creator_id, dataset_dir)
    out = Path(out).resolve()
    # Same guard build_plan uses, against the same filename -- a train-first plan is a
    # `plan.json` like any other, not a separately-named artifact.
    if (out / "plan.json").exists():
        raise FigmentTrainError(f"refusing to overwrite an existing plan: {out / 'plan.json'}")
    if out.exists() and any(out.iterdir()):
        raise FigmentTrainError(f"plan output directory must be empty: {out}")
    out.mkdir(parents=True, exist_ok=True)
    resolved_ledger_dir = _resolved_ledger_dir(ledger_dir)

    persona, training, pins = _load_inputs(creator_id, Path(personas_root))
    persona = dict(persona)
    persona["_persona_path"] = str(Path(personas_root) / creator_id / "persona.yaml")
    # The "training" block build_plan's plan.json already carries (dop_*, steps,
    # save_every, trigger, ...) plus this variant's one extra fact: which already-built
    # dataset directory it trained from. `_train_manifest`/`_tester_manifest`/
    # `_render_training_config` only ever read the specific keys they know about, so
    # this extra key rides along harmlessly wherever `training` is passed on below.
    training = {**training, "dataset_dir": str(dataset_dir)}

    if not skip_pin_verify:
        _verify_pins_preflight(pins, ["train", "tester"])

    # Same anchor files `build_plan` stages via `_copy_support_files` -- `grade --stage
    # tester` (`build_grade`) needs `plan["assets"]["anchors"]` to resolve to real,
    # `out`-relative files exactly the same way for either plan.json flavor.
    assets = {"anchors": _copy_anchors(out, persona), "persona_dir": _persona_dir_asset(persona)}

    train_runs_dir = out / "train" / "runs"
    train_runs_dir.mkdir(parents=True, exist_ok=True)
    # Same launcher templates every other stage's plan copies alongside its manifests
    # (`_copy_support_files`) -- the harness resolves `training.start_script_file`
    # relative to the manifest's own directory, so a train-first plan needs its own
    # copy too, not a reference back into the module-10 lineage's plan tree.
    for source in (TRAIN_START_PATH, TESTER_START_PATH):
        text = source.read_text(encoding="utf-8")
        text = text.replace("creator-001", creator_id)
        text = text.replace("creator001krea2", training["trigger"])
        (train_runs_dir / source.name).write_text(text, encoding="utf-8")

    plan_dataset_dirname = f"{creator_id}-tensor-dataset-train-first"
    plan_dataset_dir = train_runs_dir / plan_dataset_dirname
    plan_dataset_dir.mkdir(parents=True, exist_ok=True)
    # Copy only the operator-approved inventory. Arbitrary source side files never
    # enter a plan, even if their extension would match a later upload glob.
    for name in sorted(_approved_dataset_names(dataset_approval)):
        item = dataset_dir / name
        if item.is_symlink() or not item.is_file():
            raise FigmentTrainError(
                f"approved dataset entry must be a regular file, not a symlink: {name}"
            )
        shutil.copy2(item, plan_dataset_dir / name)

    config = _render_training_config(
        training["trigger"], training["steps"], training["save_every"],
        dop_enabled=training["dop_enabled"], dop_multiplier=training["dop_multiplier"],
        dop_class=training["dop_class"],
    )
    _write_json(plan_dataset_dir / "training.json", config)
    (plan_dataset_dir / "_dataset.ready").write_text("", encoding="utf-8")

    train_manifest = _train_manifest(
        persona, training, pins, smoke=False, dataset_dirname=plan_dataset_dirname,
    )
    train_path = train_runs_dir / f"{creator_id}-tensor-train-first.yaml"
    _write_json(train_path, train_manifest)

    train_out_dirname = f"{creator_id}-tensor-train-first"
    tester_manifest = _tester_manifest(
        persona, training, pins, train_out_dirname=train_out_dirname,
    )
    tester_path = train_runs_dir / f"{creator_id}-tensor-tester-first.yaml"
    _write_json(tester_path, tester_manifest)

    run_root = train_runs_dir / "out"
    train_run = _planned_run(out, train_path, run_root / train_path.stem, ledger_dir=resolved_ledger_dir)
    tester_run = _planned_run(out, tester_path, run_root / tester_path.stem, ledger_dir=resolved_ledger_dir)
    stages = {"train": {"runs": [train_run]}, "tester": {"runs": [tester_run]}}

    # M2: a real-spend planning path exactly like `build_plan`'s -- same preflight,
    # same --accept-budget contract.
    budget_preflight = _budget_preflight(
        stages, ledger_dir=resolved_ledger_dir, arc_cap_usd=ARC_CAP_USD,
        accept_budget=accept_budget,
    )
    print(budget_preflight["table"])

    plan = {
        "schema": "figment/train-plan@1",
        "creator": creator_id,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "generator": _sha256(Path(__file__)),
        "persona_sha256": _sha256(Path(persona["_persona_path"])),
        "training": training,
        "assets": assets,
        "configs": {"train": _relative(plan_dataset_dir / "training.json", out)},
        "ledger_dir": str(resolved_ledger_dir),
        "arc_cap_usd": ARC_CAP_USD,
        "arc_ledger_glob": ARC_LEDGER_GLOB,
        "budget_preflight": budget_preflight,
        "stages": stages,
        # The one thing that makes this plan.json different from a `build_plan` one --
        # `_install_stage_config`'s only fork point (see this function's own docstring).
        "variant": "train-first",
        "dataset_approval": {
            "path": str((dataset_dir / "dataset-approval.json").resolve()),
            "sha256": _sha256(dataset_dir / "dataset-approval.json"),
            "subject_sha256": dataset_approval["subject_sha256"],
        },
    }
    _write_json(out / "plan.json", plan)
    return plan


def _ledger_rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise FigmentTrainError(f"cost ledger is missing: {path}")
    try:
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            if reader.fieldnames != ["model", "step", "usd"]:
                raise FigmentTrainError(f"unexpected cost ledger schema: {path}")
            return list(reader)
    except OSError as exc:
        raise FigmentTrainError(f"cannot read cost ledger {path}: {exc}") from exc


def _verify_ledger(data: dict[str, Any], manifest: dict[str, Any], ledger_dir: Path) -> None:
    day = data.get("ledger_day")
    if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise FigmentTrainError("run.json has no valid ledger_day")
    rows = _ledger_rows(Path(ledger_dir) / f"figment-{day}.tsv")
    pod_module = _pod_runner_module()
    try:
        model = pod_module.gpu_model_label(manifest.get("gpu", {}).get("type"))
    except pod_module.HarnessError as exc:
        raise FigmentTrainError(f"run.json GPU type cannot form a ledger model: {exc}") from exc
    placements = data.get("placement_attempts") or []
    if not placements and data.get("pod_id"):
        placements = [{
            "pod_id": data["pod_id"],
            "estimated_actual_usd": data.get("estimated_actual_usd"),
        }]
    if not placements:
        raise FigmentTrainError("run.json has no placement ledger evidence")
    for placement in placements:
        pod_id = placement.get("pod_id")
        expected = placement.get("estimated_actual_usd")
        if not isinstance(pod_id, str) or expected is None:
            raise FigmentTrainError("run.json placement lacks pod_id or estimated_actual_usd")
        matches = [
            row for row in rows
            if row.get("model") == model and row.get("step") == f"pod-create {pod_id}"
        ]
        if len(matches) != 1:
            raise FigmentTrainError(
                f"ledger agreement failed for pod {pod_id}: expected one row, found {len(matches)}"
            )
        try:
            ledger_usd = Decimal(matches[0]["usd"]).quantize(Decimal("0.000001"))
            run_usd = Decimal(str(expected)).quantize(Decimal("0.000001"))
        except (InvalidOperation, KeyError) as exc:
            raise FigmentTrainError(f"ledger row for pod {pod_id} has invalid USD") from exc
        if ledger_usd != run_usd:
            raise FigmentTrainError(
                f"ledger agreement failed for pod {pod_id}: run.json={run_usd}, ledger={ledger_usd}"
            )


def verify_run_record(
    stage: str,
    manifest: dict[str, Any],
    out_dir: Path,
    ledger_dir: Path,
) -> dict[str, Any]:
    """Apply the old driver's checks plus exact cost-ledger reconciliation."""
    out_dir = Path(out_dir)
    data = _read_json(out_dir / "run.json")
    if not isinstance(data, dict):
        raise FigmentTrainError("run.json must be an object")
    if data.get("error"):
        raise FigmentTrainError(f"run.json recorded an error: {data['error']}")
    if data.get("termination_verified") is not True:
        raise FigmentTrainError("run.json termination_verified is not true")
    for placement in data.get("placement_attempts") or []:
        if placement.get("termination_verified") is not True:
            raise FigmentTrainError(
                f"placement {placement.get('pod_id')!r} lacks verified termination"
            )

    expected_artifacts = [row["remote"] for row in manifest.get("artifacts") or []]
    if expected_artifacts:
        actual = {row.get("remote"): row for row in data.get("artifacts") or []}
        for name in expected_artifacts:
            if name not in actual:
                raise FigmentTrainError(f"run.json is missing artifact {name!r}")
            if not isinstance(actual[name].get("bytes"), int) or actual[name]["bytes"] <= 0:
                raise FigmentTrainError(f"run.json artifact {name!r} has non-positive bytes")
    else:
        expected_jobs = manifest.get("jobs") or []
        jobs = data.get("jobs") or []
        if len(jobs) != len(expected_jobs):
            raise FigmentTrainError(
                f"run.json has {len(jobs)} jobs; expected {len(expected_jobs)}"
            )
        for expected, actual in zip(expected_jobs, jobs):
            if actual.get("output_name") != expected.get("output_name"):
                raise FigmentTrainError("run.json job order/output_name disagrees with manifest")
            files = actual.get("files") or []
            if len(files) != expected.get("expected_images", 1):
                raise FigmentTrainError(
                    f"job {actual.get('output_name')!r} output count disagrees with manifest"
                )
            if any(not isinstance(row.get("bytes"), int) or row["bytes"] <= 0 for row in files):
                raise FigmentTrainError(
                    f"job {actual.get('output_name')!r} has a non-positive output"
                )

    if "_training.log" in expected_artifacts:
        log_path = out_dir / "_training.log"
        if not log_path.is_file():
            raise FigmentTrainError("_training.log was not downloaded")
        text = log_path.read_text(encoding="utf-8", errors="replace")
        if KEY_MISMATCH_RE.search(text):
            raise FigmentTrainError("state-dict missing/unexpected keys found in _training.log")
    _verify_ledger(data, manifest, Path(ledger_dir))
    return data


def _load_plan(creator_id: str, plan_path: Path, *, reads=None) -> tuple[dict[str, Any], Path]:
    if reads is not None:
        plan_path = reads.resolve(Path(plan_path))
    else:
        plan_path = Path(plan_path).resolve()
    plan = _read_json(plan_path, reads=reads)
    if not isinstance(plan, dict) or plan.get("schema") != "figment/train-plan@1":
        raise FigmentTrainError("plan.json has an unsupported schema")
    if plan.get("creator") != creator_id:
        raise FigmentTrainError(
            f"plan creator {plan.get('creator')!r} does not match {creator_id!r}"
        )
    return plan, plan_path.parent


def _stage_state(path: Path, creator_id: str, plan_path: Path, *, reads=None) -> dict[str, Any]:
    plan_digest = _sha256(plan_path, reads=reads)
    exists = reads.file(Path(path), required=False) if reads is not None else Path(path).is_file()
    if exists:
        state = _read_json(path, reads=reads)
        if state.get("creator") != creator_id or state.get("plan_sha256") != plan_digest:
            raise FigmentTrainError("stage.json belongs to a different creator or plan")
        return state
    return {
        "schema": "figment/train-stage@1",
        "creator": creator_id,
        "plan_sha256": plan_digest,
        "status": "ready",
        "runs": {},
        "completed_stages": [],
    }


def _write_stage_state(path: Path, state: dict[str, Any]) -> None:
    state["updated_utc"] = datetime.now(timezone.utc).isoformat()
    _write_json(path, state)


def _validate_staged_checkpoint_upload(
    plan: dict[str, Any], root: Path, stage: str, expected: str, *, reads=None,
) -> None:
    """Shared by `gen` and `detail` (F2): the manifest's own checkpoint upload must
    still be the exact bytes recorded at planning time, and must not escape the
    reviewed plan root. Extracted verbatim from the gen-only check this used to be --
    no behaviour change for gen's own tests."""
    for run in plan["stages"][stage]["runs"]:
        manifest_path = root / run["manifest"]
        manifest = _read_json(manifest_path, reads=reads)
        checkpoint_files = [
            value
            for upload in manifest.get("uploads") or []
            for value in upload.get("files") or []
            if isinstance(value, str) and value.endswith(".safetensors")
        ]
        if len(checkpoint_files) != 1 or any(ch in checkpoint_files[0] for ch in "*?[]"):
            raise FigmentTrainError(f"{stage} manifest must upload exactly one explicit checkpoint")
        staged_operand = manifest_path.parent / checkpoint_files[0]
        if reads is not None:
            staged = reads.resolve(staged_operand)
            root_resolved = reads.resolve(root)
        else:
            staged = staged_operand.resolve()
            root_resolved = root.resolve()
        try:
            staged.relative_to(root_resolved)
        except ValueError as exc:
            raise FigmentTrainError(f"{stage} checkpoint upload escapes the reviewed plan root") from exc
        if reads is not None:
            observed = reads.file(staged, required=False)
            if observed is None or _sha256(staged, reads=reads) != expected:
                raise FigmentTrainError(
                    f"staged {stage} checkpoint changed after planning; create a fresh {stage} plan"
                )
        else:
            if not staged.is_file() or _sha256(staged) != expected:
                raise FigmentTrainError(
                    f"staged {stage} checkpoint changed after planning; create a fresh {stage} plan"
                )


def _validate_gen_source_inputs(plan: dict[str, Any], root: Path, *, reads=None) -> None:
    _revalidate_planned_gen_authority(plan, reads=reads)
    expected = plan.get("training", {}).get("chosen_checkpoint_sha256")
    if not isinstance(expected, str):
        raise FigmentTrainError("gen plan has no accepted checkpoint digest")
    _validate_staged_checkpoint_upload(plan, root, "gen", expected, reads=reads)


def _validate_detail_source_inputs(plan: dict[str, Any], root: Path, *, reads=None) -> None:
    """F2: `detail` always re-detailts a specific gen plan's KEPT images, staged with the
    same accepted checkpoint gen uses. Re-checked at every launch boundary the same way
    `_validate_gen_source_inputs` re-checks gen's own checkpoint: the checkpoint upload
    must be unchanged, and every source still image must still be the current, approved
    gen output (re-run through `validate_approved_gen_still`, never trusted from the
    plan's own frozen copy alone)."""
    _revalidate_planned_gen_authority(plan, reads=reads)
    expected = plan.get("training", {}).get("chosen_checkpoint_sha256")
    if not isinstance(expected, str):
        raise FigmentTrainError("detail plan has no accepted checkpoint digest")
    _validate_staged_checkpoint_upload(plan, root, "detail", expected, reads=reads)
    source = plan.get("detail_source")
    if (not isinstance(source, dict) or not isinstance(source.get("approved_gen_plan"), str)
            or not isinstance(source.get("images"), list) or not source["images"]):
        raise FigmentTrainError("detail plan has no captured gen source provenance; replan")
    approved_gen_plan_path = Path(source["approved_gen_plan"])
    for row in source["images"]:
        if not isinstance(row, dict) or not isinstance(row.get("image_id"), str):
            raise FigmentTrainError("detail plan gen source provenance is malformed")
        current = validate_approved_gen_still(
            plan["creator"], approved_gen_plan_path / "plan.json", row["image_id"], reads=reads,
        )
        if current.get("sha256") != row.get("sha256"):
            raise FigmentTrainError(
                f"gen source image {row['image_id']!r} changed after detail planning; "
                "create a fresh detail plan"
            )


def _validate_imported_checkpoint_ladder(plan: dict[str, Any], root: Path, *, reads=None) -> None:
    """Re-check every imported checkpoint's staged bytes against what `build_plan`
    recorded, at the tester launch boundary -- the same "staged checkpoint changed
    after planning" refusal class `_validate_staged_checkpoint_upload` gives gen/
    detail's single explicit checkpoint upload, extended here to an imported ladder's
    several files. A no-op for an ordinary in-plan train-first tester plan (no
    `imported_checkpoints` recorded)."""
    ladder = plan.get("stages", {}).get("tester", {}).get("imported_checkpoints")
    if not ladder:
        return
    for row in ladder:
        staged_operand = root / "train" / "runs" / "_uploads" / plan["creator"] / row["filename"]
        if reads is not None:
            staged = reads.resolve(staged_operand)
            observed = reads.file(staged, required=False)
            changed = observed is None or _sha256(staged, reads=reads) != row["sha256"]
        else:
            staged = staged_operand.resolve()
            changed = not staged.is_file() or _sha256(staged) != row["sha256"]
        if changed:
            raise FigmentTrainError(
                f"staged imported tester checkpoint changed after planning: "
                f"{row['filename']!r}; create a fresh tester plan with --import-checkpoints"
            )


def _validate_video_source_inputs(plan: dict[str, Any], root: Path, *, reads=None) -> None:
    """M2: video's first frame is one specific approved gen still, recorded once at
    plan time as `plan["video_source"]` (`_plan_video_manifest`). Re-checked at the
    launch boundary the same way `_validate_detail_source_inputs` re-checks detail's
    gen source: never trust the plan's own frozen copy alone -- re-run
    `validate_approved_gen_still` against the SAME approved-gen authority the frame
    was drawn from, and refuse if its bytes moved since this video plan was built."""
    source = plan.get("video_source")
    if (not isinstance(source, dict) or not isinstance(source.get("approved_gen_plan"), str)
            or not isinstance(source.get("image_id"), str)):
        raise FigmentTrainError("video plan has no captured gen source provenance; replan")
    approved_gen_plan_path = Path(source["approved_gen_plan"])
    current = validate_approved_gen_still(
        plan["creator"], approved_gen_plan_path / "plan.json", source["image_id"], reads=reads,
    )
    if current.get("sha256") != source.get("sha256") or current.get("bytes") != source.get("bytes"):
        raise FigmentTrainError(
            f"video source frame {source['image_id']!r} changed after video planning; "
            "create a fresh video plan"
        )


def _install_stage_config(stage: str, plan: dict[str, Any], root: Path) -> None:
    if stage == "gen":
        _validate_gen_source_inputs(plan, root)
        return
    if stage == "detail":
        _validate_detail_source_inputs(plan, root)
        return
    if stage == "tester":
        _validate_imported_checkpoint_ladder(plan, root)
        return
    if stage == "video":
        _validate_video_source_inputs(plan, root)
        return
    if stage not in ("smoke", "train"):
        return
    if plan.get("variant") == "train-first":
        # build_train_first_plan already rendered training.json (with this plan's DOP
        # settings) and wrote `_dataset.ready` directly into its own
        # `<id>-tensor-dataset-train-first` copy -- there is no module-10
        # "grade/dataset" operator-ruling step in this lineage to gate on.
        if stage == "train":
            dataset_dir = root / "train" / "runs" / f"{plan['creator']}-tensor-dataset-train-first"
            approval = _validated_train_first_dataset(plan["creator"], dataset_dir)
            _assert_exact_staged_dataset(dataset_dir, approval)
            planned = plan.get("dataset_approval") or {}
            copied_path = dataset_dir / "dataset-approval.json"
            if (_sha256(copied_path) != planned.get("sha256")
                    or approval.get("subject_sha256") != planned.get("subject_sha256")):
                raise FigmentTrainError(
                    "train-first dataset approval differs from the approval captured by plan.json"
                )
            training = plan["training"]
            expected_config = _render_training_config(
                training["trigger"], training["steps"], training["save_every"],
                dop_enabled=training["dop_enabled"],
                dop_multiplier=training["dop_multiplier"], dop_class=training["dop_class"],
            )
            if _read_json(dataset_dir / "training.json") != expected_config:
                raise FigmentTrainError(
                    "train-first training.json changed after planning; create a fresh plan"
                )
        return
    dataset_dir = root / "train" / "runs" / f"{plan['creator']}-tensor-dataset"
    approved = root / "grade" / "dataset" / "approved-list.json"
    if not approved.is_file() or not (dataset_dir / "_dataset.ready").is_file():
        raise FigmentTrainError(
            "operator dataset rulings have not been applied; run grade and apply-rulings first"
        )
    _load_current_approval(plan, root, "dataset")
    dataset_approval = _validated_train_first_dataset(plan["creator"], dataset_dir)
    _assert_exact_staged_dataset(dataset_dir, dataset_approval)
    config_source = root / plan["configs"][stage]
    if not config_source.is_file():
        raise FigmentTrainError(f"planned {stage} config is missing: {config_source}")
    training = plan["training"]
    expected_config = (
        _render_training_config(training["trigger"], 100, 50)
        if stage == "smoke" else
        _render_training_config(training["trigger"], training["steps"], training["save_every"])
    )
    if _read_json(config_source) != expected_config:
        raise FigmentTrainError(
            f"planned {stage} training config changed; create a fresh plan"
        )
    shutil.copy2(config_source, dataset_dir / "training.json")


def _video_evidence_dirs(root: Path) -> dict[str, Path]:
    return {
        "assembly": root / "video" / "assembled",
        "reel": root / "video" / "reel",
        "samples": root / "video" / "samples",
    }


def _build_video_evidence(plan: dict[str, Any], root: Path) -> dict[str, Any]:
    """The local, free half of the `video` stage (F6a): exactly the chain the video CLIs
    already define -- `video_manifest` (at plan time) -> harness receipt -> `frame_assemble`
    -> `frame_assemble reel` -> `frame_extract` -- driven here instead of by hand, against
    the same repository authority root the manifest was compiled under. Each of the three
    refuses a non-fresh output directory, so this is idempotent by re-reading an existing
    receipt rather than rebuilding it; a re-invocation after a crash between two of them
    resumes at the missing one. Spends nothing and starts no pod."""
    authority = ROOT.resolve()
    _video_authority_root(root, "the video plan root")
    assembly_module = _frame_assemble_module()
    runs = plan.get("stages", {}).get("video", {}).get("runs") or []
    if len(runs) != 1:
        raise FigmentTrainError("a video plan carries exactly one bounded 81-frame I2V run")
    run = runs[0]
    manifest_relative = (root / run["manifest"]).resolve().relative_to(authority)
    receipt_relative = (root / run["out"] / "run.json").resolve().relative_to(authority)
    directories = _video_evidence_dirs(root)
    relative = {
        key: value.resolve().relative_to(authority) for key, value in directories.items()
    }
    try:
        if not (directories["assembly"] / "frame-assembly.json").is_file():
            assembly_module.assemble_frames(
                root=authority, manifest_path=manifest_relative,
                run_receipt_path=receipt_relative, output_dir=relative["assembly"],
            )
        assembly = _read_json(directories["assembly"] / "frame-assembly.json")
        if not (directories["reel"] / "reel-derivative.json").is_file():
            assembly_module.build_reel_derivative(
                root=authority,
                assembly_receipt_path=relative["assembly"] / "frame-assembly.json",
                output_dir=relative["reel"],
            )
        reel = _read_json(directories["reel"] / "reel-derivative.json")
        if not (directories["samples"] / "frame-extraction.json").is_file():
            assembly_module.frames.extract_frames(
                root=authority, video_path=Path(assembly["movie"]["path"]),
                output_dir=relative["samples"],
            )
        extraction = _read_json(directories["samples"] / "frame-extraction.json")
    except (assembly_module.FrameAssembleError, assembly_module.frames.FrameExtractError) as exc:
        raise FigmentTrainError(f"video evidence could not be built: {exc}") from exc
    return {"assembly": assembly, "reel": reel, "extraction": extraction}


def _tester_checkpoint_inputs(plan: dict[str, Any], root: Path, run: dict[str, Any]) -> list[dict[str, Any]]:
    manifest_path = root / run["manifest"]
    if _sha256(manifest_path) != run["sha256"]:
        raise FigmentTrainError("tester manifest changed after planning")
    manifest = _read_json(manifest_path)
    expected = {
        item["value"]
        for job in manifest.get("jobs") or []
        for item in job.get("substitutions") or []
        if item.get("field") == "lora_name" and isinstance(item.get("value"), str)
    }
    matches: dict[str, Path] = {}
    for upload in manifest.get("uploads") or []:
        for pattern in upload.get("files") or []:
            if not isinstance(pattern, str) or ".safetensors" not in pattern:
                continue
            for raw in glob.glob(str(manifest_path.parent / pattern)):
                path = Path(raw).resolve()
                try:
                    path.relative_to(root.resolve())
                except ValueError as exc:
                    raise FigmentTrainError("tester checkpoint input escapes the plan root") from exc
                if path.name in matches:
                    raise FigmentTrainError(f"duplicate tester checkpoint input {path.name!r}")
                if not path.is_file() or path.stat().st_size <= 0:
                    raise FigmentTrainError(f"tester checkpoint input is missing or empty: {path}")
                matches[path.name] = path
    if set(matches) != expected:
        raise FigmentTrainError(
            f"tester checkpoint inputs do not match its candidate slate; "
            f"missing={sorted(expected - set(matches))}, unexpected={sorted(set(matches) - expected)}"
        )
    return [
        {
            "filename": name, "path": _relative(matches[name], root),
            "bytes": matches[name].stat().st_size, "sha256": _sha256(matches[name]),
        }
        for name in sorted(matches)
    ]


def _verify_tester_receipt_evidence(manifest: dict[str, Any], out_dir: Path, *, reads=None) -> None:
    """Recheck the durable, non-cost portion of a completed tester receipt.

    Live execution already performs full ledger reconciliation before recording a run
    complete. Promotion repeats the receipt/job checks so later edits cannot turn a
    failed or unrelated tester run into checkpoint provenance.
    """
    receipt = _read_json(Path(out_dir) / "run.json", reads=reads)
    if not isinstance(receipt, dict) or receipt.get("error"):
        raise FigmentTrainError("checkpoint promotion requires a successful tester receipt")
    if receipt.get("dry_run") is not False:
        raise FigmentTrainError(
            "tester receipt dry_run must be boolean false to authorize checkpoint promotion"
        )
    if receipt.get("termination_verified") is not True:
        raise FigmentTrainError("checkpoint promotion requires tester teardown verification")
    if any(
        row.get("termination_verified") is not True
        for row in receipt.get("placement_attempts") or []
    ):
        raise FigmentTrainError("checkpoint promotion requires every tester placement terminated")
    expected_jobs = manifest.get("jobs") or []
    actual_jobs = receipt.get("jobs") or []
    if len(actual_jobs) != len(expected_jobs):
        raise FigmentTrainError("tester receipt job count disagrees with its reviewed manifest")
    for expected, actual in zip(expected_jobs, actual_jobs):
        if actual.get("output_name") != expected.get("output_name"):
            raise FigmentTrainError("tester receipt jobs disagree with its reviewed manifest")
        files = actual.get("files") or []
        if len(files) != expected.get("expected_images", 1) or any(
            not isinstance(row.get("bytes"), int) or row["bytes"] <= 0 for row in files
        ):
            raise FigmentTrainError(
                f"tester receipt output evidence is invalid for {expected.get('output_name')!r}"
            )


def run_planned_stage(creator_id: str, stage: str, plan_path: Path) -> dict[str, Any]:
    """Run one stage (or the bounded chain), recording progress and never retrying."""
    if stage not in (*STAGES, "all"):
        raise FigmentTrainError(f"unknown stage {stage!r}")
    plan, root = _load_plan(creator_id, plan_path)
    ledger_value = plan.get("ledger_dir")
    if not isinstance(ledger_value, str) or not ledger_value:
        raise FigmentTrainError("plan has no resolved ledger_dir")
    plan_ledger_dir = Path(ledger_value).resolve()
    if stage == "all":
        # A promoted persona's plan never contains "anchor" (build_plan already refused
        # to (re-)plan it) -- walk only the stages the plan actually carries, in STAGES
        # order, rather than the full STAGES tuple.
        requested = tuple(current for current in STAGES if current in plan.get("stages", {}))
    else:
        requested = (stage,)
    for current in requested:
        if current not in plan.get("stages", {}):
            raise FigmentTrainError(f"plan does not contain stage {current!r}")
    state_path = root / "stage.json"
    state = _stage_state(state_path, creator_id, Path(plan_path).resolve())

    for current in requested:
        if current in state["completed_stages"]:
            if stage != "all":
                raise FigmentTrainError(
                    f"stage {current!r} is already complete or graded; refusing a live retry"
                )
            if current in GRADEABLE_STAGES:
                approval = _load_current_approval(plan, root, current)
                if current == "anchor" and approval.get("transition", {}).get("requires_replan"):
                    raise FigmentTrainError(
                        "anchor approval is current and the completed anchor run will not be repeated, "
                        "but promotion changed the persona references; create a fresh plan for dataset "
                        "and later stages"
                    )
            continue
        _install_stage_config(current, plan, root)
        state["status"] = f"running:{current}"
        _write_stage_state(state_path, state)
        for run in plan["stages"][current]["runs"]:
            key = run["manifest"]
            prior = state["runs"].get(key)
            if prior and prior.get("status") == "complete":
                continue
            if prior and prior.get("status") == "failed":
                raise FigmentTrainError(
                    f"planned run {key} already failed; create a reviewed new plan to retry"
                )
            if prior and prior.get("status") == "running":
                # n12: this is the recovery message a SECOND concurrent `pipeline`/`run`
                # invocation on the SAME plan actually hits (stage.json's own "running"
                # mark is the lock) -- most of the time that other process is simply
                # still working the exact same run, not a crash, so the fix is patience
                # and a re-run, never a fresh plan (which would abandon a run that may
                # already be paying for a pod).
                raise FigmentTrainError(
                    f"planned run {key} is still marked running. If another `pipeline`/"
                    "`run` invocation on this same plan is still active, this is expected "
                    "-- wait for it to exit, then re-run `pipeline` (or `run`) on this plan "
                    "again; the run may already have succeeded there and this call will "
                    "pick that up. If no other invocation is active, a prior one was likely "
                    "interrupted before recording completion or failure: confirm the true "
                    "pod state with `runpod_run.py status`/`probe` (and terminate it if "
                    "still live) before retrying. Never launch a second pod for the same "
                    "manifest, and never start a fresh plan over this one for that alone."
                )
            # A gen plan may carry a base run and optional legacy --detail-images run;
            # a detail STAGES plan (F2) has its own external checkpoint + gen-source
            # authority. Recheck at every launch boundary, not merely once before the
            # stage loop.
            if current in ("gen", "detail"):
                try:
                    _install_stage_config(current, plan, root)
                except FigmentTrainError:
                    state["status"] = f"stopped:{current}"
                    _write_stage_state(state_path, state)
                    raise
            manifest_path = root / key
            if _sha256(manifest_path) != run["sha256"]:
                raise FigmentTrainError(f"planned manifest digest changed: {manifest_path}")
            expected_run = _planned_run(
                root, manifest_path, root / run["out"], ledger_dir=plan_ledger_dir,
                external_manifest=current == "video",
            )
            for field in ("ceiling_usd", "out", "argv", "cli"):
                if run.get(field) != expected_run[field]:
                    raise FigmentTrainError(
                        f"planned run field {field!r} no longer matches the bounded harness command"
                    )
            tester_inputs = (
                _tester_checkpoint_inputs(plan, root, run) if current == "tester" else None
            )
            attempt = {
                "status": "running", "started_utc": datetime.now(timezone.utc).isoformat(),
            }
            if tester_inputs is not None:
                attempt["checkpoint_inputs"] = tester_inputs
            state["runs"][key] = attempt
            _write_stage_state(state_path, state)
            try:
                result = subprocess.run(run["argv"], cwd=ROOT)
            except OSError as exc:
                state["runs"][key] = {"status": "failed", "error": type(exc).__name__}
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise FigmentTrainError(f"could not launch the planned harness command: {exc}") from exc
            if result.returncode != 0:
                state["runs"][key] = {"status": "failed", "returncode": result.returncode}
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise FigmentTrainError(
                    f"harness stopped for {key} with exit code {result.returncode}; no retry attempted"
                )
            manifest = _read_json(manifest_path)
            try:
                verify_run_record(
                    current, manifest, root / run["out"], Path(plan["ledger_dir"]),
                )
                if tester_inputs is not None:
                    current_inputs = _tester_checkpoint_inputs(plan, root, run)
                    if current_inputs != tester_inputs:
                        raise FigmentTrainError(
                            "tester checkpoint inputs changed while the tester run was active; "
                            "the rendered candidates cannot be promoted"
                        )
            except FigmentTrainError as exc:
                state["runs"][key] = {
                    **attempt, "status": "failed", "error": str(exc),
                }
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise
            state["runs"][key] = {**attempt, "status": "complete"}
            _write_stage_state(state_path, state)
        if current == "video":
            # The stage is not complete until its own local evidence exists: grading
            # reads the native frames, and the deliverable reads the reel derivative
            # and the native<->derivative correspondence. Failing here leaves the pod
            # run recorded complete, so a re-invocation resumes at the assembly rather
            # than launching a second pod.
            try:
                _build_video_evidence(plan, root)
            except FigmentTrainError:
                state["status"] = f"stopped:{current}"
                _write_stage_state(state_path, state)
                raise
        state["completed_stages"].append(current)
        state["status"] = f"complete:{current}"
        _write_stage_state(state_path, state)
        if current in ("anchor", "dataset") and stage == "all":
            state["status"] = f"waiting:{current}-rulings"
            _write_stage_state(state_path, state)
            raise FigmentTrainError(
                f"{current} stage completed; STOP for full-resolution operator grading and "
                "apply-rulings, then invoke --stage all again to resume without rerunning it"
            )
    state["status"] = "complete"
    _write_stage_state(state_path, state)
    return state


def _find_job_image(run_out: Path, output_name: str) -> Path:
    """A single-image job (`expected_images` 1, every stage before Track-2 gen) writes
    `<output_name><ext>`. A multi-image job (gen's `expected_images: 3`: base, refined,
    detailed) writes `<output_name>_01<ext>`..`_NN<ext>` in ComfyUI history-completion
    order (`download_job_outputs`, pod/runpod_run.py) -- base (from the earliest-ready
    decode), refined, then detailed last (the mask/SEGS/detailer branch has the longest
    dependency chain). Grade only the last one, `_03`: the detailed output is the one
    result a gen-stage board should ever show (Track-2 Task D2)."""
    detailed = [
        run_out / f"{output_name}_03{suffix}" for suffix in IMAGE_EXTENSIONS
        if (run_out / f"{output_name}_03{suffix}").is_file()
    ]
    matches = detailed or [
        run_out / f"{output_name}{suffix}" for suffix in IMAGE_EXTENSIONS
        if (run_out / f"{output_name}{suffix}").is_file()
    ]
    if len(matches) != 1:
        raise FigmentTrainError(
            f"expected exactly one full-resolution output for {output_name!r} in "
            f"{run_out}, found {len(matches)}"
        )
    if matches[0].stat().st_size <= 0:
        raise FigmentTrainError(f"grading image is empty: {matches[0]}")
    return matches[0].resolve()


def _video_grading_images(plan: dict[str, Any], root: Path) -> list[dict[str, Any]]:
    """GATE video is "does the face hold under motion", so its graded cells are the
    harness's OWN native frames, sampled every `VIDEO_FRAME_SAMPLE_EVERY`-th of the 81
    (1, 9, ... 81 -> 11 cells). That makes the whole existing grading stack do the right
    thing with no new machinery: `build_grade` runs `identity_gate` over exactly those
    frames, so `gate.json` carries per-frame identity/age/realism rows ACROSS the motion,
    written by the single writer `identity_gate.write_gate_document`; the board shows the
    same frames beside the anchors; and the operator rules the same seven axes per frame,
    where `identity` on each sampled frame IS "the face holds here".

    No temporal axis is added: `video/video_review.py` already owns the richer temporal
    vocabulary (`SEQUENCE_AXES` -- `identity_stability`, `anatomy_stability`,
    `background_stability`, ... -- and `PLAYBACK_AXES`) for its own attributed
    accepted-video authority, and duplicating a second, weaker copy of it inside the
    still-grading axes is exactly the divergence APPROVED_GEN_ADAPTER.md warns about."""
    images: list[dict[str, Any]] = []
    for run in plan["stages"]["video"]["runs"]:
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path) != run["sha256"]:
            raise FigmentTrainError(f"planned manifest digest changed: {manifest_path}")
        manifest = _read_json(manifest_path)
        run_out = root / run["out"]
        for job in manifest.get("jobs") or []:
            expected = job.get("expected_images", 1)
            for index in range(1, expected + 1, VIDEO_FRAME_SAMPLE_EVERY):
                image_id = f"{job['output_name']}_{index:02d}"
                matches = [
                    run_out / f"{image_id}{suffix}" for suffix in IMAGE_EXTENSIONS
                    if (run_out / f"{image_id}{suffix}").is_file()
                ]
                if len(matches) != 1:
                    raise FigmentTrainError(
                        f"expected exactly one native video frame for {image_id!r} in "
                        f"{run_out}, found {len(matches)}"
                    )
                if matches[0].stat().st_size <= 0:
                    raise FigmentTrainError(f"grading image is empty: {matches[0]}")
                images.append({
                    "image_id": image_id,
                    "path": str(matches[0].resolve()),
                    "review_status": "unreviewed",
                    "parked_reasons": [],
                    "safety_failed": False,
                    "safety_reasons": [],
                })
    if not images:
        raise FigmentTrainError("stage 'video' has no grading frames")
    return images


def _grading_images(plan: dict[str, Any], root: Path, stage: str) -> list[dict[str, Any]]:
    if stage not in plan.get("stages", {}):
        raise FigmentTrainError(f"plan does not contain stage {stage!r}")
    if stage == "video":
        return _video_grading_images(plan, root)
    images: list[dict[str, Any]] = []
    for run in plan["stages"][stage]["runs"]:
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path) != run["sha256"]:
            raise FigmentTrainError(f"planned manifest digest changed: {manifest_path}")
        manifest = _read_json(manifest_path)
        run_out = root / run["out"]
        for job in manifest.get("jobs") or []:
            image = _find_job_image(run_out, job["output_name"])
            images.append({
                "image_id": job["output_name"],
                "path": str(image),
                "review_status": "unreviewed",
                "parked_reasons": [],
                "safety_failed": False,
                "safety_reasons": [],
            })
    if not images:
        raise FigmentTrainError(f"stage {stage!r} has no grading images")
    return images


def _advisory_annotation(advisory_row: dict[str, Any] | None) -> str:
    """Track-2 Task B3: render one cell's advisory numbers as
    `cos <x.xxx> · Δage <±y.y> · lap <n> · clip <p%>`, `n/a` for any field that is
    `None` or the row is missing entirely (a scorer outage, or advisory scoring never ran).
    Advisory-only -- this is annotation text, never a decision."""
    if not advisory_row:
        return ""

    def _fmt(value: Any, template: str) -> str:
        return template.format(value) if isinstance(value, (int, float)) else "n/a"

    cos = _fmt(advisory_row.get("anchor_cosine"), "{:.3f}")
    age = _fmt(advisory_row.get("age_delta_years"), "±{:.1f}")
    lap = _fmt(advisory_row.get("laplacian_variance"), "{:.0f}")
    clip = _fmt(advisory_row.get("clipped_highlight_fraction"), "{:.1%}")
    return f"cos {cos} · Δage {age} · lap {lap} · clip {clip}"


def _judge_annotation(judge_row: dict[str, Any] | None) -> str:
    """Stage 2's numbers + notes for one cell, rendered
    `judge: same X · age Y→Z (Δd) · skin S · gloss G · artifacts A · "notes"`, or a
    short explanatory string when the judge never ran for this cell (skipped, or
    genuinely unavailable) -- ALWAYS informational text, the pass/fail decision itself
    already lives in the gate reasons, never here."""
    if judge_row is None:
        return ""
    if judge_row.get("unavailable"):
        return f'judge: {judge_row["unavailable"].get("judge", "unavailable")}'

    def _fmt(value: Any) -> str:
        return str(value) if isinstance(value, (int, float)) else "n/a"

    same = _fmt(judge_row.get("same_person"))
    age_ref = _fmt(judge_row.get("apparent_age_reference"))
    age_cand = _fmt(judge_row.get("apparent_age_candidate"))
    delta = _fmt(judge_row.get("age_delta"))
    skin = _fmt(judge_row.get("skin_realism"))
    gloss = _fmt(judge_row.get("gloss"))
    artifacts = _fmt(judge_row.get("artifacts"))
    notes = judge_row.get("notes") or ""
    return (
        f"judge: same {same} · age {age_ref}→{age_cand} (Δ{delta}) · "
        f"skin {skin} · gloss {gloss} · artifacts {artifacts}"
        + (f' · "{notes}"' if notes else "")
    )


def _figure_html(
    row: dict[str, Any], advisory_by_id: dict[str, Any], *,
    gate_by_id: dict[str, Any] | None = None, number: int | None = None,
    reasons: list[str] | None = None,
) -> str:
    annotation = _advisory_annotation(advisory_by_id.get(row["image_id"]))
    gate_row = (gate_by_id or {}).get(row["image_id"])
    judge_annotation = _judge_annotation((gate_row or {}).get("judge"))
    caption = f"{number}. {html.escape(row['image_id'])}" if number is not None else html.escape(row["image_id"])
    extra = ""
    if annotation:
        extra += f'<br><span class="advisory">{html.escape(annotation)}</span>'
    if judge_annotation:
        extra += f'<br><span class="judge">{html.escape(judge_annotation)}</span>'
    if reasons:
        extra += f'<br><span class="gate-reasons">{html.escape("; ".join(reasons))}</span>'
    return (
        f'<figure><a href="{html.escape(Path(row["path"]).as_uri())}">'
        f'<img loading="lazy" src="{html.escape(Path(row["path"]).as_uri())}" '
        f'alt="{html.escape(row["image_id"])}"></a>'
        f'<figcaption>{caption}{extra}</figcaption></figure>'
    )


def _grading_html(
    creator_id: str,
    stage: str,
    anchors: list[Path],
    images: list[dict[str, Any]],
    advisory: dict[str, Any] | None = None,
    gate_document: dict[str, Any] | None = None,
) -> str:
    advisory_by_id = {
        row["image_id"]: row for row in (advisory or {}).get("rows", [])
    }
    gate_by_id = {row["image_id"]: row for row in (gate_document or {}).get("rows", [])}
    anchor_cards = "\n".join(
        f'<figure><a href="{html.escape(path.as_uri())}"><img loading="eager" '
        f'src="{html.escape(path.as_uri())}" alt="anchor {html.escape(path.name)}"></a>'
        f'<figcaption>anchor · {html.escape(path.name)}</figcaption></figure>'
        for path in anchors
    )

    passed_rows: list[dict[str, Any]] = []
    failed_rows: list[tuple[dict[str, Any], list[str]]] = []
    for row in images:
        gate_row = gate_by_id.get(row["image_id"])
        if gate_row is not None and gate_row.get("pass"):
            passed_rows.append(row)
        else:
            reasons = list((gate_row or {}).get("reasons") or ["gate did not run for this cell"])
            failed_rows.append((row, reasons))

    passed_cells = "\n".join(
        _figure_html(row, advisory_by_id, gate_by_id=gate_by_id, number=index)
        for index, row in enumerate(passed_rows, start=1)
    )
    failed_cells = "\n".join(
        _figure_html(row, advisory_by_id, gate_by_id=gate_by_id, reasons=reasons)
        for row, reasons in failed_rows
    )
    research_note = ""
    local_research = (gate_document or {}).get("review_mode") == "local-research"
    if local_research:
        research_note = (
            '<p class="advisory-note">Local research mode ran stage-1 diagnostics only. '
            'No external image judge was called; every automatic verdict remains unavailable and failed. '
            'A kept cell requires a real attributed ruling and an explicit gate-override reason.</p>'
        )
        review_cells = "\n".join(
            _figure_html(
                row, advisory_by_id, gate_by_id=gate_by_id, number=index,
                reasons=list((gate_by_id.get(row["image_id"]) or {}).get("reasons") or ["unavailable: judge"]),
            )
            for index, row in enumerate(images, start=1)
        )
        cells_section = (
            f'<main><h2>Research review candidates ({len(images)}; automatic gate unavailable)</h2>'
            f'<div class="grid">{review_cells}</div></main>'
        )
        gate_summary = (
            "The gate has no automatic passes in this research mode. Candidates are numbered only for the "
            "attributed ruling template; they remain unavailable and failed until a valid explicit override."
        )
    else:
        cells_section = (
            f'<main><h2>Cells passing the gate ({len(passed_rows)})</h2><div class="grid">{passed_cells}</div></main>'
            f'<details class="failed-gate"><summary>failed gate ({len(failed_rows)})</summary>'
            f'<div class="grid">{failed_cells}</div></details>'
        )
        gate_summary = "The gate below IS fail-closed: only PASS cells are numbered for the ruling sheet."
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(creator_id)} · {html.escape(stage)} grading</title>
<style>
body{{font:16px system-ui;background:#111;color:#eee;margin:24px}}
h1,h2{{margin:0 0 16px}}p{{color:#bbb}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}}
figure{{margin:0;background:#1b1b1b;padding:12px;border-radius:8px}}img{{display:block;width:100%;height:auto;background:#222}}figcaption{{padding-top:8px;font-family:ui-monospace,monospace}}
.anchors{{border:2px solid #8ab4f8;padding:16px;margin-bottom:28px}}
.advisory{{color:#888;font-size:0.85em}}
.judge{{color:#8ab4f8;font-size:0.85em}}
.advisory-note{{color:#bbb;font-style:italic}}
.gate-reasons{{color:#e08080;font-size:0.85em}}
summary{{cursor:pointer;font-size:1.2em;margin:16px 0}}
</style></head><body>
<h1>{html.escape(creator_id)} · {html.escape(stage)}</h1>
<p>full-resolution source files: click any image to inspect its original pixels. Rule beside the anchors; never grade a thumbnail alone.</p>
<p class="advisory-note">advisory annotations (cos/Δage/lap/clip) are advisory only — never keep or cull. {gate_summary}</p>
{research_note}
<section class="anchors"><h2>Identity anchors</h2><div class="grid">{anchor_cards}</div></section>
{cells_section}
</body></html>
"""


_GATE_FALLBACK_METRICS = ("identity_own", "age_delta", "gloss", "niqe", "face_px")


def _load_persona_document_for_gate(plan: dict[str, Any]) -> dict[str, Any]:
    # plan["assets"]["persona_dir"] is ROOT-relative (see build_plan's own comment on
    # that field), never `root`-relative (the plan's own output directory) -- the
    # persona directory usually lives outside `root` entirely.
    persona_path = (ROOT / plan["assets"]["persona_dir"] / "persona.yaml").resolve()
    return _read_json(persona_path)


def _persona_path_for_plan(plan: dict[str, Any], *, reads=None) -> Path:
    persona_path = ROOT / plan["assets"]["persona_dir"] / "persona.yaml"
    return reads.resolve(persona_path) if reads is not None else persona_path.resolve()


def _current_persona_training(
    plan: dict[str, Any], *, reads=None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    persona_path = _persona_path_for_plan(plan, reads=reads)
    try:
        merged = _training_config_module().load_persona_with_training(
            persona_path, reads=reads,
        )
    except (OSError, ValueError) as exc:
        raise FigmentTrainError(f"current persona/training configuration is invalid: {exc}") from exc
    return merged, merged["training"]


def _current_review_subject(
    plan: dict[str, Any], root: Path, stage: str, grading: dict[str, Any], *, reads=None,
) -> dict[str, Any]:
    persona, training = _current_persona_training(plan, reads=reads)
    manifest_paths = [root / run["manifest"] for run in plan["stages"][stage]["runs"]]
    anchors = [
        reads.resolve(root / value) if reads is not None else (root / value).resolve()
        for value in plan["assets"]["anchors"]
    ]
    checkpoint_inputs = None
    if stage == "tester":
        state_path = root / "stage.json"
        state_exists = (
            reads.file(state_path, required=False) if reads is not None else state_path.is_file()
        )
        if state_exists:
            state = _stage_state(state_path, plan["creator"], root / "plan.json", reads=reads)
            checkpoint_inputs = [
                {
                    "manifest": run["manifest"],
                    "manifest_sha256": run["sha256"],
                    "status": state.get("runs", {}).get(run["manifest"], {}).get("status"),
                    "inputs": state.get("runs", {}).get(run["manifest"], {}).get(
                        "checkpoint_inputs"
                    ),
                }
                for run in plan["stages"][stage]["runs"]
            ]
    try:
        return _lineage_module().review_subject(
            creator=plan["creator"], stage=stage, plan_path=root / "plan.json",
            manifest_paths=manifest_paths, images=grading["images"], anchors=anchors,
            persona=persona, training=training, threshold_path=HERE / "gate.yaml",
            score_path=root / "grade" / stage / "gate.json",
            checkpoint_inputs=checkpoint_inputs,
            reads=reads,
        )
    except (OSError, ValueError) as exc:
        raise FigmentTrainError(f"cannot establish {stage} review lineage: {exc}") from exc


def _load_current_approval(
    plan: dict[str, Any], root: Path, stage: str, *, required: bool = True, reads=None,
) -> dict[str, Any] | None:
    grade_dir = root / "grade" / stage
    approval_path = grade_dir / "approval-lineage.json"
    approval_exists = (
        reads.file(approval_path, required=False) if reads is not None else approval_path.is_file()
    )
    if not approval_exists:
        if required:
            raise FigmentTrainError(
                f"{stage} has no current operator approval; run grade and apply-rulings first"
            )
        return None
    grading = _read_json(grade_dir / "grading-manifest.json", reads=reads)
    approval = _read_json(approval_path, reads=reads)
    if approval.get("schema") != _lineage_module().APPROVAL_SCHEMA:
        raise FigmentTrainError(f"unsupported approval lineage at {approval_path}")
    # m9: a direct, explicit check against evaluation-inputs.json's recorded
    # gate_sha256, BEFORE the broader subject-hash check below -- both would
    # eventually catch a swapped gate.json (review_subject's own "numeric_gate"
    # field already covers it transitively), but this one fails first with a
    # precise "gate.json changed" message rather than a generic "stale, rebuild",
    # worth the one extra read for how load-bearing a fail-closed gate swap is.
    evaluation_path = grade_dir / "evaluation-inputs.json"
    evaluation_exists = (
        reads.file(evaluation_path, required=False) if reads is not None
        else evaluation_path.is_file()
    )
    if evaluation_exists:
        evaluation = _read_json(evaluation_path, reads=reads)
        recorded_gate_sha256 = evaluation.get("gate_sha256")
        if recorded_gate_sha256 is not None:
            gate_path = grade_dir / "gate.json"
            gate_exists = (
                reads.file(gate_path, required=False) if reads is not None
                else gate_path.is_file()
            )
            current_gate_sha256 = (
                _sha256(gate_path, reads=reads) if gate_exists else None
            )
            if recorded_gate_sha256 != current_gate_sha256:
                raise FigmentTrainError(
                    f"{stage} gate.json changed after evaluation; rebuild the grade "
                    "and obtain fresh operator rulings"
                )
    try:
        _lineage_module().assert_current(
            approval, _current_review_subject(plan, root, stage, grading, reads=reads),
            label=f"{stage} operator approval",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    return approval


def _validate_approved_still(
    creator_id: str, plan_path: Path, image_id: str, stage: str, *, reads=None,
) -> dict[str, Any]:
    """Return one current, kept `stage` still without changing any Figment record.

    Shared by `validate_approved_gen_still` (video, detail source provenance) and
    `validate_approved_detail_still` (the deliverable, B1): neither may treat an
    arbitrary `approved-list.json` entry as authority -- this repeats the existing
    rulings, gate, and freshness checks before returning the selected image bytes.
    """
    if not isinstance(image_id, str) or not image_id:
        raise FigmentTrainError(f"approved {stage} image id must be a non-empty string")
    resolved_plan = (
        reads.resolve(Path(plan_path)) if reads is not None else Path(plan_path).resolve()
    )
    root = resolved_plan.parent
    grade_dir = root / "grade" / stage
    approval_path = grade_dir / "approval-lineage.json"
    approved_path = grade_dir / "approved-list.json"
    rulings_path = grade_dir / "rulings.json"
    grading_path = grade_dir / "grading-manifest.json"
    evaluation_path = grade_dir / "evaluation-inputs.json"
    gate_path = grade_dir / "gate.json"
    evidence_paths = {
        "source_plan": resolved_plan, "approval_lineage": approval_path,
        "approved_list": approved_path, "rulings": rulings_path,
        "grading": grading_path, "evaluation": evaluation_path, "gate": gate_path,
    }
    try:
        initial_digests = {
            label: (_sha256(path) if reads is None else _sha256(path, reads=reads)) for label, path in evidence_paths.items()
        }
    except OSError as exc:
        raise FigmentTrainError(f"{stage} approval evidence is incomplete") from exc
    plan, loaded_root = (_load_plan(creator_id, resolved_plan) if reads is None else _load_plan(creator_id, resolved_plan, reads=reads))
    if loaded_root != root:
        raise FigmentTrainError(f"approved {stage} plan root changed while loading")
    approval = (_load_current_approval(plan, root, stage) if reads is None else _load_current_approval(plan, root, stage, reads=reads))
    if (approval.get("creator") != creator_id or approval.get("stage") != stage
            or approval.get("decision") != "verified"):
        raise FigmentTrainError(f"{stage} approval lineage does not authorize this creator/stage")
    if not (all(
        (
            reads.file(path, required=False) is not None
            if reads is not None
            else path.is_file()
        )
        for path in (approved_path, rulings_path, grading_path, evaluation_path, gate_path)
    )):
        raise FigmentTrainError(f"{stage} approval evidence is incomplete")
    if approval.get("rulings_sha256") != (_sha256(rulings_path) if reads is None else _sha256(rulings_path, reads=reads)):
        raise FigmentTrainError(f"{stage} rulings changed after approval")
    grading = (_read_json(grading_path) if reads is None else _read_json(grading_path, reads=reads))
    images = grading.get("images") if isinstance(grading, dict) else None
    if (not isinstance(grading, dict) or grading.get("creator") != creator_id
            or grading.get("stage") != stage or not isinstance(images, list) or not images):
        raise FigmentTrainError(f"{stage} grading manifest creator/stage or images are invalid")
    image_ids = [row.get("image_id") if isinstance(row, dict) else None for row in images]
    if any(not isinstance(value, str) for value in image_ids) or len(set(image_ids)) != len(image_ids):
        raise FigmentTrainError(f"{stage} grading manifest has invalid or duplicate image ids")
    evaluation = (_read_json(evaluation_path) if reads is None else _read_json(evaluation_path, reads=reads))
    if (not isinstance(evaluation, dict) or evaluation.get("schema") != _lineage_module().EVALUATION_SCHEMA
            or evaluation.get("subject_sha256") != approval.get("reviewed_subject_sha256")):
        raise FigmentTrainError(f"{stage} approval is not bound to its current evaluation")
    normalized = _normalize_rulings(
        creator_id, stage, (_read_json(rulings_path) if reads is None else _read_json(rulings_path, reads=reads)), image_ids, evaluation["subject_sha256"],
    )
    gate = (_read_json(gate_path) if reads is None else _read_json(gate_path, reads=reads))
    if gate.get("schema") != "figment/gate@1" or not isinstance(gate.get("rows"), list):
        raise FigmentTrainError(f"{stage} gate evidence is invalid")
    gate_by_id = {
        row.get("image_id"): row for row in gate["rows"]
        if isinstance(row, dict) and isinstance(row.get("image_id"), str)
    }
    if len(gate_by_id) != len(gate["rows"]) or set(gate_by_id) != set(image_ids):
        raise FigmentTrainError(f"{stage} gate does not cover exactly the reviewed images")
    review = deepcopy(grading)
    try:
        _qa_module().stamp(review, normalized)
    except ValueError as exc:
        raise FigmentTrainError(f"{stage} rulings are invalid: {exc}") from exc
    ruling_by_id = {row["image_id"]: row for row in normalized["rulings"]}
    expected: list[dict[str, str]] = []
    for row in review["images"]:
        ruling = ruling_by_id[row["image_id"]]
        if ruling["decision"] != "keep":
            continue
        gate_row = gate_by_id[row["image_id"]]
        override = ruling.get("gate_override")
        if gate_row.get("pass") is not True and (not isinstance(override, str) or not override.strip()):
            raise FigmentTrainError(f"kept {stage} image {row['image_id']!r} lacks a gate pass or override")
        if row.get("safety_failed") or row.get("review_status") != "verified":
            raise FigmentTrainError(f"kept {stage} image {row['image_id']!r} is not quality/safety verified")
        if not isinstance(row.get("path"), str):
            raise FigmentTrainError(f"{stage} grading image path is invalid")
        expected.append({"image_id": row["image_id"], "path": row["path"]})
    approved = (_read_json(approved_path) if reads is None else _read_json(approved_path, reads=reads))
    if (not isinstance(approved, dict) or approved.get("schema") != "figment/approved-images@1"
            or approved.get("creator") != creator_id or approved.get("stage") != stage
            or approved.get("images") != expected):
        raise FigmentTrainError(f"approved {stage} list is not the current kept review set")
    selected = next((row for row in expected if row["image_id"] == image_id), None)
    if selected is None:
        raise FigmentTrainError(f"requested {stage} image was not approved")
    image = Path(selected["path"])
    try:
        resolved = reads.resolve(image) if reads is not None else image.resolve(strict=True)
        resolved.relative_to(reads.resolve(root) if reads is not None else root.resolve())
    except (OSError, ValueError) as exc:
        raise FigmentTrainError(f"approved {stage} image escapes its reviewed plan root") from exc
    if reads is not None:
        observation = reads.file(resolved, required=True)
        if observation is None or resolved.suffix.lower() not in IMAGE_EXTENSIONS:
            raise FigmentTrainError(f"approved {stage} image is not a regular supported image")
    else:
        if image.is_symlink() or not resolved.is_file() or resolved.suffix.lower() not in IMAGE_EXTENSIONS:
            raise FigmentTrainError(f"approved {stage} image is not a regular supported image")
    subject_images = approval.get("subject", {}).get("images") if isinstance(approval.get("subject"), dict) else None
    subject = next((row for row in subject_images or [] if isinstance(row, dict) and row.get("image_id") == image_id), None)
    if not isinstance(subject, dict):
        raise FigmentTrainError(f"approved {stage} image is absent from approval lineage")
    bytes_seen = observation.size if reads is not None else resolved.stat().st_size
    digest = (_sha256(resolved) if reads is None else _sha256(resolved, reads=reads))
    if bytes_seen <= 0 or subject.get("bytes") != bytes_seen or subject.get("sha256") != digest:
        raise FigmentTrainError(f"approved {stage} image bytes changed after approval")
    try:
        if any(
            (_sha256(path) if reads is None else _sha256(path, reads=reads)) != initial_digests[label]
            for label, path in evidence_paths.items()
        ):
            raise FigmentTrainError(f"{stage} approval evidence changed while validating")
    except OSError as exc:
        raise FigmentTrainError(f"{stage} approval evidence changed while validating") from exc
    return {
        "image_id": image_id, "path": str(resolved), "bytes": bytes_seen, "sha256": digest,
        "source_plan": {"path": str(resolved_plan), "sha256": initial_digests["source_plan"]},
        "approval_lineage": {
            "path": str(reads.resolve(approval_path)) if reads is not None else str(approval_path.resolve()),
            "sha256": initial_digests["approval_lineage"],
        },
        "approved_list": {
            "path": str(reads.resolve(approved_path)) if reads is not None else str(approved_path.resolve()),
            "sha256": initial_digests["approved_list"],
        },
    }


def validate_approved_gen_still(
    creator_id: str, plan_path: Path, image_id: str, *, reads=None,
) -> dict[str, Any]:
    """Return one current, kept `gen` still -- see `_validate_approved_still`."""
    return _validate_approved_still(creator_id, plan_path, image_id, "gen", reads=reads)


def validate_approved_detail_still(
    creator_id: str, plan_path: Path, image_id: str, *, reads=None,
) -> dict[str, Any]:
    """Return one current, kept `detail` still -- see `_validate_approved_still`. Used
    by the deliverable (B1) so a crafted `detail/grade/approved-list.json` row (an
    out-of-root path, a gate-failed or unruled image) is refused rather than shipped."""
    return _validate_approved_still(creator_id, plan_path, image_id, "detail", reads=reads)


def _run_identity_gate(
    plan: dict[str, Any], anchors: list[Path], images: list[dict[str, Any]],
    grade_dir: Path, *, skip_judge: bool = False, judge_backend: str = "claude",
) -> dict[str, Any]:
    """Fail-closed per-cell TWO-STAGE gate (operator ruling 2026-09-03: no board reaches
    the operator until every shown cell holds identity, age and realism; ruling
    2026-09-06 added stage 2, the vlm_judge.py Claude vision judge, after calibration
    showed facenet/the age classifier/the gloss proxy/NIQE do not separate the
    operator's own verdicts -- see identity_gate.py's `two_stage_gate` docstring).

    Stage 2 is only ever invoked for a cell whose stage 1 (`identity_floor_gate`) has
    already passed -- a gross identity miss or an unusable face crop never spends a
    judge call, so `--skip-judge` (offline/test use only -- never used on a real grading
    run) and "genuinely had no usable face" both leave a cell's `judge` field `None`,
    but the top-level `judge_skipped` flag distinguishes the two for the board/operator.

    Unlike `score_cells.score`'s advisory annotations -- which degrade to `None` fields
    on a scorer outage and never gate anything -- a TOTAL outage here still produces a
    `gate.json`, but with every cell explicitly FAILED closed (never silently promoted
    to pass, never silently omitted from the document).

    This is now a thin plan-specific wrapper: the actual two-stage composition (score,
    stage 1, stage 2 only for stage-1 passes, outage handling) lives in
    `identity_gate.run_two_stage_gate` so a plan-driven grading stage and
    `identity_gate.py run`'s own plan-independent CLI (for a bake-off run dir, a batch
    folder, or any other ad hoc image set) gate identically and produce the exact same
    `figment/gate@1` schema. `load_persona` is a thunk rather than an
    already-resolved dict so a persona-resolution failure is caught by the SAME
    outage handling as a scorer/judge failure, exactly as it was before this
    extraction."""
    gate_module = _identity_gate_module()
    return gate_module.run_two_stage_gate(
        lambda: _load_persona_document_for_gate(plan),
        anchors, images, grade_dir, skip_judge=skip_judge, judge_backend=judge_backend,
    )


def build_grade(
    creator_id: str, stage: str, plan_path: Path, *, skip_judge: bool = False,
    judge_backend: str = "claude",
) -> dict[str, str]:
    """Build a non-destructive, original-pixel grading surface and blank rulings.

    `skip_judge` (offline/test use only -- NEVER pass this on a real grading run)
    entirely omits stage 2 (the vlm_judge.py Claude vision judge, subscription-billed):
    every cell's overall pass/fail then rests on stage 1 alone failing closed, or on
    stage 2 being recorded as `unavailable: judge` for any cell whose stage 1 passed --
    see `_run_identity_gate`'s own docstring. `judge_backend=local-research` is a
    separate explicit mode: it runs stage 1, never calls an external image judge,
    and records every automatic verdict as unavailable/failed for attributed research
    review; it is not a production pass or a synonym for `skip_judge`."""
    if stage not in GRADEABLE_STAGES:
        raise FigmentTrainError(f"grade stage must be one of {GRADEABLE_STAGES}")
    plan, root = _load_plan(creator_id, plan_path)
    anchors = [(root / value).resolve() for value in plan["assets"]["anchors"]]
    for anchor in anchors:
        if not anchor.is_file() or anchor.stat().st_size <= 0:
            raise FigmentTrainError(f"anchor is missing or empty: {anchor}")
    images = _grading_images(plan, root, stage)
    grade_dir = root / "grade" / stage
    grade_dir.mkdir(parents=True, exist_ok=True)
    # Track-2 Task B3: advisory identity/age/quality annotations, wrapped so a scorer
    # outage (missing model weights, no network, a bad anchor file) never blocks the
    # gate -- `score_cells.score` itself is advisory-only and must never keep or cull.
    advisory: dict[str, Any] | None = None
    try:
        advisory = _score_cells_module().score(images, anchors, grade_dir)
    except Exception as exc:
        advisory = None
        _write_json(
            grade_dir / "advisory-error.json",
            {"error": f"{type(exc).__name__}: {exc}"},
        )
    # Operator ruling 2026-09-03: no board reaches the operator until this fail-closed
    # gate has scored every cell -- see _run_identity_gate's own docstring for how a
    # total scoring outage still fails every cell closed rather than skipping the gate.
    gate_document = _run_identity_gate(
        plan, anchors, images, grade_dir,
        skip_judge=skip_judge, judge_backend=judge_backend,
    )
    local_research = judge_backend == "local-research"
    if local_research:
        gate_document["review_mode"] = "local-research"
        gate_document["research_provenance"] = {
            "executing_cli_sha256": _sha256(Path(__file__)),
            "identity_gate_sha256": _sha256(IDENTITY_GATE_MODULE),
            "stage2": "unavailable: local research mode does not invoke an external image judge",
        }
    # E4: `_identity_gate_module().write_gate_document` is the ONE writer of
    # `figment/gate@1` -- shared with `identity_gate.py`'s own `run_gate` CLI, so a
    # plan-driven grading stage and an ad hoc `run` write byte-identical gate.json.
    gate_path = _identity_gate_module().write_gate_document(
        grade_dir / "gate.json", gate_document,
    )

    manifest_path = grade_dir / "grading-manifest.json"
    template_path = grade_dir / "rulings.template.json"
    page_path = grade_dir / "board.html"
    grading_document = {"creator": creator_id, "stage": stage, "images": images}
    _write_json(manifest_path, grading_document)
    subject = _current_review_subject(plan, root, stage, grading_document)
    _write_json(
        grade_dir / "evaluation-inputs.json",
        _lineage_module().wrap_subject(
            _lineage_module().EVALUATION_SCHEMA, subject,
            creator=creator_id, stage=stage,
            # m9: bind the evaluation record to the exact gate.json it was graded
            # against -- _load_current_approval re-checks this the same way it
            # already re-checks rulings_sha256, so a gate.json swapped after grading
            # (but before the ruling is applied) is caught, not silently trusted.
            gate_sha256=_sha256(gate_path),
            **({
                "review_mode": "local-research",
                "research_provenance": gate_document["research_provenance"],
            } if local_research else {}),
        ),
    )
    _write_json(template_path, {
        "schema": "figment/rulings-template@1",
        "creator": creator_id,
        "stage": stage,
        "evaluation_subject_sha256": _lineage_module().canonical_sha256(subject),
        "decided_by": None,
        "decided_at": None,
        "rulings": [{
            "image_id": row["image_id"],
            "decision": None,
            "identity": None,
            "realism": None,
            "hands": None,
            "lighting": None,
            "adult_read": None,
            "garment_integrity": None,
            "real_person_resemblance": None,
            "why": "",
            # m9: always present (never conditional on local_research) -- an
            # attributed override is the same axis whatever review mode produced
            # the gate, and a template that sometimes omits the field invites a
            # rulings document that never carries it at all.
            "gate_override": "",
        } for row in images],
    })
    page_path.write_text(
        _grading_html(creator_id, stage, anchors, images, advisory, gate_document), encoding="utf-8",
    )
    return {
        "page": str(page_path),
        "rulings_template": str(template_path),
        "grading_manifest": str(manifest_path),
        "gate": str(gate_path),
    }


def _normalize_rulings(
    creator_id: str, stage: str, document: Any, image_ids: list[str],
    evaluation_subject_sha256: str,
) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise FigmentTrainError("rulings document must be an object")
    if document.get("creator") != creator_id or document.get("stage") != stage:
        raise FigmentTrainError("rulings creator/stage does not match the command")
    if document.get("evaluation_subject_sha256") != evaluation_subject_sha256:
        raise FigmentTrainError(
            "rulings were filled for a different evaluation subject; use the current "
            "grade's rulings template"
        )
    decided_by = document.get("decided_by")
    decided_at = document.get("decided_at")
    if not isinstance(decided_by, str) or not decided_by.strip():
        raise FigmentTrainError("rulings require a non-empty human decided_by identity")
    if not isinstance(decided_at, str) or not decided_at.strip():
        raise FigmentTrainError("rulings require a non-empty decided_at timestamp")
    raw = document.get("rulings")
    if not isinstance(raw, list):
        raise FigmentTrainError("rulings document must contain a rulings list")
    quality = ("identity", "realism", "hands", "lighting")
    safety = ("adult_read", "garment_integrity", "real_person_resemblance")
    by_id: dict[str, dict[str, Any]] = {}
    for row in raw:
        if not isinstance(row, dict) or not isinstance(row.get("image_id"), str):
            raise FigmentTrainError("every ruling must be an object with image_id")
        image_id = row["image_id"]
        if image_id in by_id:
            raise FigmentTrainError(f"duplicate ruling for {image_id!r}")
        decision = row.get("decision")
        if not isinstance(decision, str) or decision.lower() not in ("keep", "cull"):
            raise FigmentTrainError(f"ruling {image_id!r} needs decision keep|cull")
        normalized = dict(row)
        normalized["decision"] = decision.lower()
        for axis in (*quality, *safety):
            value = row.get(axis)
            if not isinstance(value, str) or not value.strip():
                raise FigmentTrainError(f"ruling {image_id!r} is missing axis {axis!r}")
            normalized[axis] = value.strip().lower()
        by_id[image_id] = normalized
    missing = [image_id for image_id in image_ids if image_id not in by_id]
    unexpected = sorted(set(by_id) - set(image_ids))
    if missing or unexpected:
        raise FigmentTrainError(
            f"rulings do not exactly cover the grading manifest; missing={missing}, "
            f"unexpected={unexpected}"
        )
    return {
        "schema": "figment/rulings@1",
        "creator": creator_id,
        "stage": stage,
        "evaluation_subject_sha256": evaluation_subject_sha256,
        "decided_by": decided_by.strip(),
        "decided_at": decided_at.strip(),
        "rulings": [by_id[image_id] for image_id in image_ids],
    }


def _checkpoint_candidate(
    plan: dict[str, Any], root: Path, step: int, *, reads=None,
) -> dict[str, Any]:
    training = plan["training"]
    allowed = _checkpoint_steps(training["steps"], training["save_every"]) + [training["steps"]]
    if step not in allowed:
        raise FigmentTrainError(
            f"checkpoint step {step} was not produced by this plan; choose one of {allowed}"
        )
    filename = _checkpoint_name(training["trigger"], None if step == training["steps"] else step)
    tester_matches: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    for run in plan["stages"]["tester"]["runs"]:
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path, reads=reads) != run["sha256"]:
            raise FigmentTrainError("tester manifest changed after the reviewed plan was written")
        manifest = _read_json(manifest_path, reads=reads)
        for job in manifest.get("jobs") or []:
            values = [
                item.get("value") for item in job.get("substitutions") or []
                if item.get("field") == "lora_name"
            ]
            if filename in values:
                tester_matches.append((run, manifest, job["output_name"]))
    if len(tester_matches) != 1:
        raise FigmentTrainError(
            f"tester manifest does not map checkpoint {filename!r} to exactly one candidate"
        )

    tester_run, tester_manifest, tester_image_id = tester_matches[0]
    state_path = root / "stage.json"
    state_exists = (
        reads.file(state_path, required=False) if reads is not None else state_path.is_file()
    )
    if not state_exists:
        raise FigmentTrainError(
            "checkpoint promotion requires this plan's completed train and tester stages"
        )
    state = _stage_state(state_path, plan["creator"], root / "plan.json", reads=reads)
    if "train" not in state.get("completed_stages", []):
        raise FigmentTrainError("checkpoint promotion requires this plan's completed train stage")
    if "tester" not in state.get("completed_stages", []):
        raise FigmentTrainError("checkpoint promotion requires this plan's completed tester stage")
    tester_state = state.get("runs", {}).get(tester_run["manifest"], {})
    if tester_state.get("status") != "complete":
        raise FigmentTrainError("checkpoint promotion requires its tester run to be complete")
    tester_inputs = tester_state.get("checkpoint_inputs")
    if not isinstance(tester_inputs, list) or not tester_inputs:
        raise FigmentTrainError(
            "completed tester run has no checkpoint digest inventory; rerun under the current "
            "driver before promoting a candidate"
        )
    _verify_tester_receipt_evidence(tester_manifest, root / tester_run["out"], reads=reads)

    matches: list[tuple[dict[str, Any], Path]] = []
    for run in plan["stages"].get("train", {}).get("runs", []):
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path, reads=reads) != run["sha256"]:
            raise FigmentTrainError("train manifest changed after the reviewed plan was written")
        manifest = _read_json(manifest_path, reads=reads)
        if filename not in [item.get("local") for item in manifest.get("artifacts") or []]:
            continue
        if state.get("runs", {}).get(run["manifest"], {}).get("status") != "complete":
            continue
        run_out = (
            reads.resolve(root / run["out"]) if reads is not None
            else (root / run["out"]).resolve()
        )
        checkpoint = (
            reads.resolve(run_out / filename) if reads is not None
            else (run_out / filename).resolve()
        )
        try:
            checkpoint.relative_to(run_out)
        except ValueError as exc:
            raise FigmentTrainError("selected checkpoint escapes its planned train output") from exc
        matches.append((run, checkpoint))
    if len(matches) != 1:
        raise FigmentTrainError(
            f"checkpoint {filename!r} is not a unique artifact of this plan's completed train run"
        )
    run, checkpoint = matches[0]
    if reads is not None:
        observed_checkpoint = reads.file(checkpoint, required=True)
        checkpoint_missing = observed_checkpoint is None or observed_checkpoint.size <= 0
    else:
        checkpoint_missing = not checkpoint.is_file() or checkpoint.stat().st_size <= 0
    if checkpoint_missing:
        raise FigmentTrainError(f"produced checkpoint is missing or empty: {checkpoint}")
    receipt = _read_json(checkpoint.parent / "run.json", reads=reads)
    artifact_rows = [
        item for item in receipt.get("artifacts") or []
        if item.get("remote") == filename and item.get("bytes") == (
            reads.file(checkpoint, required=True).size if reads is not None
            else checkpoint.stat().st_size
        )
    ]
    if (receipt.get("error") is not None or receipt.get("dry_run") is not False
            or receipt.get("termination_verified") is not True
            or len(artifact_rows) != 1):
        raise FigmentTrainError(
            f"checkpoint {filename!r} lacks a real successful, teardown-verified train receipt"
        )
    recorded_inputs = [
        item for item in tester_inputs
        if isinstance(item, dict) and item.get("filename") == filename
    ]
    current_input = {
        "filename": filename,
        "path": _relative(checkpoint, root, reads=reads),
        "bytes": (
            reads.file(checkpoint, required=True).size if reads is not None
            else checkpoint.stat().st_size
        ),
        "sha256": _sha256(checkpoint, reads=reads),
    }
    if len(recorded_inputs) != 1 or recorded_inputs[0] != current_input:
        raise FigmentTrainError(
            f"checkpoint {filename!r} no longer matches the bytes recorded for the completed "
            "tester run; rerun tester before promotion"
        )
    return {
        "step": step,
        "filename": filename,
        "tester_image_id": tester_image_id,
        "path": str(checkpoint),
        "bytes": (
            reads.file(checkpoint, required=True).size if reads is not None
            else checkpoint.stat().st_size
        ),
        "sha256": _sha256(checkpoint, reads=reads),
        "train_manifest": run["manifest"],
        "train_manifest_sha256": run["sha256"],
    }


def _imported_checkpoint_candidate(
    plan: dict[str, Any], root: Path, step: int, *, reads=None,
) -> dict[str, Any]:
    """`_checkpoint_candidate`'s counterpart for an imported checkpoint ladder
    (operator-trained LoRA path, MANDATE.md's tier constraint): there is no in-plan
    `train` receipt to match a candidate against, so provenance is bound to the plan's
    own plan-time-recorded `imported_checkpoints` inventory (sha-bound when staged)
    plus the completed tester run's own re-hash of the same files -- the same shape of
    evidence `_checkpoint_candidate` demands, sourced from the ladder import instead of
    a train manifest artifact."""
    ladder = plan.get("stages", {}).get("tester", {}).get("imported_checkpoints")
    if not isinstance(ladder, list) or not ladder:
        raise FigmentTrainError("plan has no imported checkpoint ladder recorded")
    entry = next((row for row in ladder if row.get("step") == step), None)
    if entry is None:
        allowed = sorted(row["step"] for row in ladder if isinstance(row.get("step"), int))
        raise FigmentTrainError(
            f"checkpoint step {step} was not imported by this plan; choose one of {allowed}"
        )
    filename = entry["filename"]
    tester_matches: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    for run in plan["stages"]["tester"]["runs"]:
        manifest_path = root / run["manifest"]
        if _sha256(manifest_path, reads=reads) != run["sha256"]:
            raise FigmentTrainError("tester manifest changed after the reviewed plan was written")
        manifest = _read_json(manifest_path, reads=reads)
        for job in manifest.get("jobs") or []:
            values = [
                item.get("value") for item in job.get("substitutions") or []
                if item.get("field") == "lora_name"
            ]
            if filename in values:
                tester_matches.append((run, manifest, job["output_name"]))
    if len(tester_matches) != 1:
        raise FigmentTrainError(
            f"tester manifest does not map imported checkpoint {filename!r} to exactly "
            "one candidate"
        )
    tester_run, tester_manifest, tester_image_id = tester_matches[0]

    state_path = root / "stage.json"
    state_exists = (
        reads.file(state_path, required=False) if reads is not None else state_path.is_file()
    )
    if not state_exists:
        raise FigmentTrainError("checkpoint promotion requires this plan's completed tester stage")
    state = _stage_state(state_path, plan["creator"], root / "plan.json", reads=reads)
    if "tester" not in state.get("completed_stages", []):
        raise FigmentTrainError("checkpoint promotion requires this plan's completed tester stage")
    tester_state = state.get("runs", {}).get(tester_run["manifest"], {})
    if tester_state.get("status") != "complete":
        raise FigmentTrainError("checkpoint promotion requires its tester run to be complete")
    tester_inputs = tester_state.get("checkpoint_inputs")
    if not isinstance(tester_inputs, list) or not tester_inputs:
        raise FigmentTrainError(
            "completed tester run has no checkpoint digest inventory; rerun tester under "
            "the current driver before promoting a candidate"
        )
    _verify_tester_receipt_evidence(tester_manifest, root / tester_run["out"], reads=reads)

    # The staged upload copy inside the plan root is the durable source of truth here
    # (there is no in-plan train artifact to match against) -- re-validate it against
    # the plan-time recorded sha, same "swapped file after planning" refusal class
    # `_validate_staged_checkpoint_upload` gives gen/detail's checkpoint upload.
    staged_operand = root / "train" / "runs" / "_uploads" / plan["creator"] / filename
    if reads is not None:
        staged = reads.resolve(staged_operand)
        observed = reads.file(staged, required=False)
        staged_missing = observed is None
    else:
        staged = staged_operand.resolve()
        staged_missing = not staged.is_file()
    if staged_missing or _sha256(staged, reads=reads) != entry.get("sha256"):
        raise FigmentTrainError(
            f"staged imported checkpoint {filename!r} changed after planning; create a "
            "fresh tester plan with --import-checkpoints"
        )
    current_bytes = (
        reads.file(staged, required=True).size if reads is not None else staged.stat().st_size
    )
    current_sha256 = _sha256(staged, reads=reads)
    recorded_inputs = [
        item for item in tester_inputs
        if isinstance(item, dict) and item.get("filename") == filename
    ]
    current_input = {
        "filename": filename, "path": _relative(staged, root, reads=reads),
        "bytes": current_bytes, "sha256": current_sha256,
    }
    if len(recorded_inputs) != 1 or recorded_inputs[0] != current_input:
        raise FigmentTrainError(
            f"imported checkpoint {filename!r} no longer matches the bytes recorded for "
            "the completed tester run; rerun tester before promotion"
        )
    return {
        "step": step,
        "filename": filename,
        "tester_image_id": tester_image_id,
        "path": str(staged),
        "bytes": current_bytes,
        "sha256": current_sha256,
        "train_manifest": None,
        "train_manifest_sha256": None,
    }


def _config_path_value(path: Path) -> str:
    path = Path(path).resolve()
    try:
        return path.relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return str(path)


def _persist_checkpoint_selection(
    plan: dict[str, Any], step: int, digest: str, approval_path: Path,
) -> None:
    persona_path = _persona_path_for_plan(plan)
    sidecar_path = persona_path.with_name("training.yaml")
    target = sidecar_path if sidecar_path.is_file() else persona_path
    document = _read_json(target)
    training = document.get("training")
    if not isinstance(training, dict):
        raise FigmentTrainError(f"cannot persist checkpoint selection: {target} has no training object")
    training.update({
        "chosen_checkpoint_step": step,
        "chosen_checkpoint_sha256": digest,
        "chosen_checkpoint_approval": _config_path_value(approval_path),
    })
    _write_json(target, document)


def _resolve_config_path(value: str, *, reads=None) -> Path:
    path = Path(value)
    candidate = path if path.is_absolute() else (ROOT / path)
    return reads.resolve(candidate) if reads is not None else candidate.resolve()


def _write_accepted_checkpoint(
    creator_id: str, plan: dict[str, Any], root: Path, normalized: dict[str, Any],
    approval_out: Path, accepted_checkpoint_out: Path, checkpoint: dict[str, Any],
    imported_ladder: bool,
) -> None:
    """Write `grade/tester/accepted-checkpoint.json` and persist the plan's checkpoint
    selection. `apply_rulings` reaches this from two places -- the idempotent-replay
    branch (rulings already applied, checkpoint newly promoted) and the normal
    fresh-ruling path -- which used to build the identical document independently;
    extracted so the two can never drift apart."""
    accepted_document = {
        "schema": _lineage_module().CHECKPOINT_SCHEMA,
        "creator": creator_id,
        "operator": {
            "decided_by": normalized["decided_by"],
            "decided_at": normalized["decided_at"],
        },
        "source_plan": str((root / "plan.json").resolve()),
        "source_plan_sha256": _sha256(root / "plan.json"),
        "approval_lineage": str(approval_out.resolve()),
        "approval_lineage_sha256": _sha256(approval_out),
        "training_inputs": _lineage_module().training_input_projection(plan["training"]),
        "checkpoint": checkpoint,
    }
    if imported_ladder:
        accepted_document["origin"] = "imported"
    _write_json(accepted_checkpoint_out, accepted_document)
    _persist_checkpoint_selection(
        plan, checkpoint["step"], checkpoint["sha256"], accepted_checkpoint_out,
    )


def apply_rulings(
    creator_id: str, stage: str, plan_path: Path, rulings_path: Path,
    checkpoint_step: int | None = None, *, reads=None,
) -> dict[str, str]:
    """Validate operator rulings, stamp QA, and materialize dataset keeps."""
    if stage not in GRADEABLE_STAGES:
        raise FigmentTrainError(f"apply-rulings stage must be one of {GRADEABLE_STAGES}")
    if reads is not None and not (stage == "gen" and checkpoint_step is None):
        raise FigmentTrainError(
            "reads-mode apply-rulings is restricted to gen review without a checkpoint step"
        )
    plan, root = (_load_plan(creator_id, plan_path) if reads is None else _load_plan(creator_id, plan_path, reads=reads))
    grade_dir = root / "grade" / stage
    grading_path = grade_dir / "grading-manifest.json"
    grading = (_read_json(grading_path) if reads is None else _read_json(grading_path, reads=reads))
    if grading.get("creator") != creator_id or grading.get("stage") != stage:
        raise FigmentTrainError("grading manifest creator/stage mismatch")
    images = grading.get("images")
    if not isinstance(images, list) or not images:
        raise FigmentTrainError("grading manifest has no images")
    image_ids = [row.get("image_id") for row in images]
    if any(not isinstance(value, str) for value in image_ids) or len(set(image_ids)) != len(image_ids):
        raise FigmentTrainError("grading manifest has invalid or duplicate image ids")
    evaluation_path = grade_dir / "evaluation-inputs.json"
    if not (reads.file(evaluation_path, required=False) is not None
        if reads is not None
        else evaluation_path.is_file()):
        raise FigmentTrainError(
            f"review freshness record is missing: {evaluation_path}; rebuild the grade"
        )
    evaluation = (_read_json(evaluation_path) if reads is None else _read_json(evaluation_path, reads=reads))
    if evaluation.get("schema") != _lineage_module().EVALUATION_SCHEMA:
        raise FigmentTrainError("review freshness record has an unsupported schema")
    try:
        _lineage_module().assert_current(
            evaluation, (_current_review_subject(plan, root, stage, grading) if reads is None else _current_review_subject(plan, root, stage, grading, reads=reads)),
            label=f"{stage} numeric evaluation",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    normalized = _normalize_rulings(
        creator_id, stage, (_read_json(Path(rulings_path)) if reads is None else _read_json(Path(rulings_path), reads=reads)), image_ids,
        evaluation["subject_sha256"],
    )
    if stage == "anchor":
        keeps = [r for r in normalized["rulings"] if r["decision"] == "keep"]
        if len(keeps) != 1 and any(r["decision"] != "cull" for r in normalized["rulings"]):
            raise FigmentTrainError(
                f"anchor rulings must keep exactly one candidate, got {len(keeps)}")

    # Operator ruling 2026-09-03: a cell the fail-closed identity/age/realism gate
    # marked FAIL can never be kept silently -- the ruling must carry an explicit,
    # non-empty "gate_override" reason. REVIEW-2026-09-07 findings #1/#2: this must be
    # fail-CLOSED, not fail-open. `build_grade` always writes a gate.json beside
    # board.html, so a missing file means the gate was bypassed (deleted, never run),
    # not that this grade dir predates the wiring -- refuse rather than tolerate it.
    # Every graded image id must be covered by gate.json (a partial rewrite must not
    # silently ungate a cell), and a gate row missing its own "pass" key (hand-edited,
    # truncated write, older schema) is treated exactly like an explicit
    # `"pass": false` row -- never defaulted to a silent PASS.
    gate_path = grade_dir / "gate.json"
    if not (reads.file(gate_path, required=False) is not None
        if reads is not None
        else gate_path.is_file()):
        raise FigmentTrainError(
            f"no gate.json at {gate_path}; run `figment_train.py grade` before apply-rulings"
        )
    gate_document = (_read_json(gate_path) if reads is None else _read_json(gate_path, reads=reads))
    if gate_document.get("schema") != "figment/gate@1":
        raise FigmentTrainError("gate.json must be the per-cell numeric figment/gate@1 document")
    gate_by_id: dict[str, dict[str, Any]] = {
        row["image_id"]: row for row in gate_document.get("rows", [])
    }
    ungated = [image_id for image_id in image_ids if image_id not in gate_by_id]
    if ungated:
        raise FigmentTrainError(f"gate.json does not cover every graded cell: {ungated}")

    review = deepcopy(grading)
    try:
        _qa_module().stamp(review, normalized)
    except ValueError as exc:
        raise FigmentTrainError(f"qa_stamp rejected rulings: {exc}") from exc
    ruling_by_id = {row["image_id"]: row for row in normalized["rulings"]}
    approved_rows = []
    for row in review["images"]:
        ruling = ruling_by_id[row["image_id"]]
        if ruling["decision"] == "keep":
            gate_row = gate_by_id.get(row["image_id"])
            if gate_row is None or gate_row.get("pass") is not True:
                override = ruling.get("gate_override")
                if not isinstance(override, str) or not override.strip():
                    raise FigmentTrainError(
                        f"kept cell {row['image_id']!r} failed the identity/age/realism gate "
                        f"({'; '.join(gate_row.get('reasons') or [])}) and its ruling carries "
                        "no gate_override reason"
                    )
            if row.get("safety_failed"):
                raise FigmentTrainError(
                    f"kept cell {row['image_id']!r} failed a mandatory safety axis"
                )
            if row.get("review_status") != "verified":
                raise FigmentTrainError(
                    f"kept cell {row['image_id']!r} failed a quality axis"
                )
            approved_rows.append({"image_id": row["image_id"], "path": row["path"]})
    rulings_out = grade_dir / "rulings.json"
    review_out = grade_dir / "review-manifest.json"
    approved_out = grade_dir / "approved-list.json"
    approval_out = grade_dir / "approval-lineage.json"
    rejection_out = grade_dir / "rejection-lineage.json"
    accepted_checkpoint_out = grade_dir / "accepted-checkpoint.json"
    if not approved_rows:
        if checkpoint_step is not None:
            raise FigmentTrainError("rulings approved no images")
        if any(r["decision"] != "cull" for r in normalized["rulings"]):
            raise FigmentTrainError("rulings approved no images")
        if (any(
            (
                reads.file(path, required=False) is not None
                if reads is not None
                else (path.exists() or path.is_symlink())
            )
            for path in (
                rulings_out, review_out, approved_out, approval_out, rejection_out,
                accepted_checkpoint_out,
            )
        )):
            raise FigmentTrainError("refusing to overwrite previously applied rulings")
        _write_json(rulings_out, normalized)
        _write_json(review_out, review)
        _write_json(
            rejection_out,
            _lineage_module().wrap_subject(
                _lineage_module().APPROVAL_SCHEMA, evaluation["subject"],
                creator=creator_id, stage=stage, decision="rejected",
                decided_by=normalized["decided_by"], decided_at=normalized["decided_at"],
                rulings_sha256=(_sha256(rulings_out) if reads is None else _sha256(rulings_out, reads=reads)),
                reviewed_subject=evaluation["subject"],
                reviewed_subject_sha256=evaluation["subject_sha256"],
                transition={"kind": "none", "requires_replan": False},
            ),
        )
        return {
            "rulings": str(rulings_out),
            "review_manifest": str(review_out),
            "rejection_lineage": str(rejection_out),
        }
    if stage == "dataset" and len(approved_rows) < 20:
        raise FigmentTrainError(
            f"dataset approved only {len(approved_rows)} images; training requires at least 20"
        )

    checkpoint = None
    imported_ladder = bool(plan.get("stages", {}).get("tester", {}).get("imported_checkpoints"))
    if checkpoint_step is not None:
        if stage != "tester":
            raise FigmentTrainError("--checkpoint-step is only valid for tester rulings")
        checkpoint = (
            _imported_checkpoint_candidate(plan, root, checkpoint_step)
            if imported_ladder else _checkpoint_candidate(plan, root, checkpoint_step)
        )
        if checkpoint["tester_image_id"] not in {row["image_id"] for row in approved_rows}:
            raise FigmentTrainError(
                f"checkpoint step {checkpoint_step} was not explicitly kept by the tester rulings"
            )

    if (any(
        (
            reads.file(path, required=False) is not None
            if reads is not None
            else (path.exists() or path.is_symlink())
        )
        for path in (
            rulings_out, review_out, approved_out, approval_out, rejection_out,
        )
    )):
        if not (stage == "tester" and checkpoint is not None
                and not (accepted_checkpoint_out.exists() or accepted_checkpoint_out.is_symlink())
                and rulings_out.is_file() and _read_json(rulings_out) == normalized):
            raise FigmentTrainError("refusing to overwrite previously applied rulings")
        _load_current_approval(plan, root, stage)
        approved_existing = _read_json(approved_out)
        if checkpoint["tester_image_id"] not in {
            row.get("image_id") for row in approved_existing.get("images") or []
        }:
            raise FigmentTrainError("selected checkpoint was not kept by the applied tester rulings")
        _write_accepted_checkpoint(
            creator_id, plan, root, normalized, approval_out, accepted_checkpoint_out,
            checkpoint, imported_ladder,
        )
        return {
            "rulings": str(rulings_out), "review_manifest": str(review_out),
            "approved_list": str(approved_out),
            "approval_lineage": str(approval_out),
            "accepted_checkpoint": str(accepted_checkpoint_out),
        }

    if stage == "dataset":
        approved_dir = grade_dir / "approved"
        dataset_dir = root / "train" / "runs" / f"{creator_id}-tensor-dataset"
        if approved_dir.exists() or dataset_dir.exists():
            raise FigmentTrainError("approved or training dataset directory already exists")
        with tempfile.TemporaryDirectory(prefix="apply-rulings-", dir=root) as temporary_name:
            temporary = Path(temporary_name)
            temporary_approved = temporary / "approved"
            temporary_dataset = temporary / "dataset"
            temporary_approved.mkdir()
            for index, row in enumerate(approved_rows, start=1):
                source = Path(row["path"])
                if not source.is_file() or source.stat().st_size <= 0:
                    raise FigmentTrainError(f"approved source image is missing or empty: {source}")
                shutil.copy2(
                    source,
                    temporary_approved /
                    f"{index:03d}-{row['image_id']}{source.suffix.lower()}",
                )
            builder = _build_set_module()
            # M4: an operator-declared `training.caption_mode: "qwen3vl"` routes
            # through the live pinned pod job (_live_qwen3vl_job_runner) instead of
            # the single-word "class" caption -- everything else about this local
            # assembly step is unchanged. Any other caption_mode value keeps the
            # existing "class" behaviour (build_training_set.py's own "provided" mode
            # is not reachable here -- it needs operator-authored captions this
            # function never has).
            qwen3vl = plan.get("training", {}).get("caption_mode") == "qwen3vl"
            build_kwargs: dict[str, Any] = dict(
                approved_cells=None,
                source_dir=None,
                out_dir=temporary_dataset,
                caption_word="woman",
                images_from=[temporary_approved],
                exclude=None,
            )
            if qwen3vl:
                trigger = plan["training"]["trigger"]
                build_kwargs.update(
                    caption_mode="qwen3vl",
                    trigger=trigger,
                    job_runner=_live_qwen3vl_job_runner(
                        creator_id, trigger, root, ledger_dir=Path(plan["ledger_dir"]),
                    ),
                )
            else:
                build_kwargs["caption_mode"] = "class"
            try:
                builder.build_training_set(**build_kwargs)
            except ValueError as exc:
                raise FigmentTrainError(f"build_training_set rejected approved images: {exc}") from exc
            except FigmentTrainError as exc:
                # Only ever raised from inside the live qwen3vl job_runner above (a
                # real pod/ledger/artifact failure) -- kept distinct from a rejected
                # image so the operator sees which layer actually failed.
                raise FigmentTrainError(f"qwen3vl caption pod job failed: {exc}") from exc
            shutil.copy2(root / plan["configs"]["train"], temporary_dataset / "training.json")
            approved_dir.parent.mkdir(parents=True, exist_ok=True)
            dataset_dir.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(temporary_approved), str(approved_dir))
            shutil.move(str(temporary_dataset), str(dataset_dir))
            dataset_subject = _lineage_module().dataset_subject(dataset_dir)
            _write_json(
                dataset_dir / "dataset-approval.json",
                _lineage_module().wrap_subject(
                    _lineage_module().DATASET_APPROVAL_SCHEMA, dataset_subject,
                    creator=creator_id, decision="verified",
                    decided_by=normalized["decided_by"], decided_at=normalized["decided_at"],
                    source_approval=str(approval_out.resolve()),
                ),
            )
    elif stage == "anchor":
        approved = approved_rows[0]
        image_id = approved["image_id"]
        source = Path(approved["path"])
        if not source.is_file() or source.stat().st_size <= 0:
            raise FigmentTrainError(f"approved anchor source image is missing or empty: {source}")
        persona_dir = (ROOT / plan["assets"]["persona_dir"]).resolve()
        anchors_dir = persona_dir / "anchors"
        anchors_dir.mkdir(parents=True, exist_ok=True)
        # Review LOW-13: take the extension from the actual source file rather than
        # hardcoding .png -- safe today only because SaveImage always emits PNG.
        extension = source.suffix.lower() or ".png"
        destination = anchors_dir / f"{image_id}{extension}"
        if destination.exists():
            raise FigmentTrainError(f"anchor destination already exists: {destination}")
        shutil.copy2(source, destination)
        chosen_document = {
            "schema": "figment/chosen-anchor@1",
            "creator": creator_id,
            "image_id": image_id,
            "path": str(destination),
            "sha256": _sha256(destination),
        }
        _write_json(grade_dir / "chosen-anchor.json", chosen_document)

        persona_path = persona_dir / "persona.yaml"
        persona_document = _read_json(persona_path)
        identity = persona_document.setdefault("identity", {})
        identity["history"] = identity.get("history", []) + identity.get("references", [])
        identity["references"] = [f"anchors/{image_id}{extension}"]
        _write_json(persona_path, persona_document)

    approved_document = {
        "schema": "figment/approved-images@1",
        "creator": creator_id,
        "stage": stage,
        "images": approved_rows,
    }
    _write_json(rulings_out, normalized)
    _write_json(review_out, review)
    _write_json(approved_out, approved_document)
    settled_subject = (_current_review_subject(plan, root, stage, grading) if reads is None else _current_review_subject(plan, root, stage, grading, reads=reads))
    approval_document = _lineage_module().wrap_subject(
        _lineage_module().APPROVAL_SCHEMA,
        settled_subject,
        creator=creator_id, stage=stage, decision="verified",
        decided_by=normalized["decided_by"], decided_at=normalized["decided_at"],
        rulings_sha256=(_sha256(rulings_out) if reads is None else _sha256(rulings_out, reads=reads)),
        reviewed_subject=evaluation["subject"],
        reviewed_subject_sha256=evaluation["subject_sha256"],
        transition=(
            {"kind": "anchor-promotion", "requires_replan": True,
             "from_subject_sha256": evaluation["subject_sha256"],
             "to_subject_sha256": _lineage_module().canonical_sha256(settled_subject)}
            if stage == "anchor" else {"kind": "none", "requires_replan": False}
        ),
    )
    _write_json(approval_out, approval_document)
    result = {
        "rulings": str(rulings_out),
        "review_manifest": str(review_out),
        "approved_list": str(approved_out),
        "approval_lineage": str(approval_out),
    }
    if checkpoint is not None:
        _write_accepted_checkpoint(
            creator_id, plan, root, normalized, approval_out, accepted_checkpoint_out,
            checkpoint, imported_ladder,
        )
        result["accepted_checkpoint"] = str(accepted_checkpoint_out)
    return result


def _validated_accepted_checkpoint(
    persona: dict[str, Any], training: dict[str, Any], *, reads=None,
) -> dict[str, Any]:
    """Return still-current checkpoint authority without copying source bytes."""
    step = training.get("chosen_checkpoint_step")
    digest = training.get("chosen_checkpoint_sha256")
    approval_value = training.get("chosen_checkpoint_approval")
    if step is None:
        raise FigmentTrainError(
            "gen requires a chosen checkpoint; apply tester rulings with --checkpoint-step"
        )
    if not isinstance(digest, str) or not isinstance(approval_value, str):
        raise FigmentTrainError(
            "legacy chosen_checkpoint_step has no checkpoint hash/provenance; re-apply the "
            "tester rulings with --checkpoint-step"
        )
    approval_path = _resolve_config_path(approval_value, reads=reads)
    if approval_path.name != "accepted-checkpoint.json" or approval_path.parent.name != "tester":
        raise FigmentTrainError("chosen checkpoint approval must be a tester accepted-checkpoint.json")
    expected_plan_path = approval_path.parents[2] / "plan.json"
    accepted = _read_json(approval_path, reads=reads)
    if (accepted.get("schema") != _lineage_module().CHECKPOINT_SCHEMA
            or accepted.get("creator") != persona["id"]):
        raise FigmentTrainError("chosen checkpoint approval is malformed or belongs to another creator")
    source_plan_raw = Path(accepted.get("source_plan", ""))
    source_plan_path = (
        reads.resolve(source_plan_raw) if reads is not None else source_plan_raw.resolve()
    )
    expected_plan_resolved = (
        reads.resolve(expected_plan_path) if reads is not None else expected_plan_path.resolve()
    )
    if source_plan_path != expected_plan_resolved:
        raise FigmentTrainError("chosen checkpoint approval names a plan outside its own review root")
    if _sha256(source_plan_path, reads=reads) != accepted.get("source_plan_sha256"):
        raise FigmentTrainError("chosen checkpoint source plan changed after promotion")
    source_plan, source_root = _load_plan(persona["id"], source_plan_path, reads=reads)
    approval_lineage = approval_path.with_name("approval-lineage.json")
    try:
        approval_lineage_sha256 = _sha256(approval_lineage, reads=reads)
    except OSError as exc:
        raise FigmentTrainError("tester approval lineage is missing after checkpoint promotion") from exc
    recorded_lineage_raw = Path(accepted.get("approval_lineage", ""))
    recorded_lineage = (
        reads.resolve(recorded_lineage_raw) if reads is not None
        else recorded_lineage_raw.resolve()
    )
    approval_lineage_resolved = (
        reads.resolve(approval_lineage) if reads is not None else approval_lineage.resolve()
    )
    if (recorded_lineage != approval_lineage_resolved
            or approval_lineage_sha256 != accepted.get("approval_lineage_sha256")):
        raise FigmentTrainError("tester approval lineage changed after checkpoint promotion")
    _load_current_approval(source_plan, source_root, "tester", reads=reads)
    lineage = _lineage_module()
    source_projection = lineage.training_input_projection(source_plan["training"])
    if accepted.get("training_inputs") != source_projection:
        raise FigmentTrainError("training inputs changed after checkpoint promotion")
    current_projection = lineage.training_input_projection(training)
    if accepted.get("origin") == "imported":
        # P4i: an imported checkpoint's provenance is the training config the tester
        # plan recorded at import time (`source_plan["imported_training_config"]`), not
        # the persona's live training.yaml -- so TRAIN_TIME_KEYS are validated against
        # that recorded projection (already proven above), and re-derived fresh from the
        # named config file (`_reload_imported_training_projection`) so a post-promotion
        # edit is caught. Every other projected key still has to match the persona's
        # current training.yaml, same authority the in-plan path always used.
        imported_config = source_plan.get("imported_training_config")
        if (not isinstance(imported_config, dict)
                or not isinstance(imported_config.get("path"), str)
                or not isinstance(imported_config.get("sha256"), str)):
            raise FigmentTrainError(
                "chosen checkpoint is marked imported but its tester plan has no "
                "imported_training_config; cannot validate its training provenance"
            )
        imported_config_path = _resolve_config_path(imported_config["path"], reads=reads)
        reloaded_projection = _reload_imported_training_projection(
            persona["id"], imported_config_path, reads=reads,
        )
        if reloaded_projection != source_projection:
            raise FigmentTrainError(
                "imported training config changed since the checkpoint ladder was "
                "screened; re-run --import-checkpoints with the current file"
            )
        gen_time_keys = set(current_projection) - lineage.TRAIN_TIME_KEYS
        current_gen_time = {key: current_projection[key] for key in gen_time_keys}
        source_gen_time = {key: source_projection[key] for key in gen_time_keys}
        if current_gen_time != source_gen_time:
            raise FigmentTrainError(
                "persona training changed after checkpoint promotion in a field this "
                "imported checkpoint does not own (e.g. trigger/base_arch/caption_mode); "
                "create a fresh gen plan"
            )
    elif current_projection != source_projection:
        raise FigmentTrainError("training inputs changed after checkpoint promotion")
    candidate = (
        _imported_checkpoint_candidate(source_plan, source_root, step, reads=reads)
        if accepted.get("origin") == "imported"
        else _checkpoint_candidate(source_plan, source_root, step, reads=reads)
    )
    recorded = accepted.get("checkpoint")
    if not isinstance(recorded, dict):
        raise FigmentTrainError("chosen checkpoint approval has no checkpoint record")
    for field in ("step", "filename", "tester_image_id", "path", "bytes", "sha256",
                  "train_manifest", "train_manifest_sha256"):
        if recorded.get(field) != candidate.get(field):
            raise FigmentTrainError(f"chosen checkpoint provenance changed at field {field!r}")
    if candidate["sha256"] != digest:
        raise FigmentTrainError("chosen checkpoint bytes do not match training configuration")

    return {
        "candidate": candidate,
        "digest": digest,
        "step": step,
        "approval_path": approval_path,
        "source_plan_path": source_plan_path,
        "approval_lineage_path": approval_lineage,
    }


def _accepted_checkpoint_snapshot(
    accepted_checkpoint: dict[str, Any], *, reads=None,
) -> dict[str, str]:
    """The approval/source binding compiled into a reviewed gen plan."""
    candidate = accepted_checkpoint["candidate"]
    return {
        "approval_sha256": _sha256(accepted_checkpoint["approval_path"], reads=reads),
        "source_plan_sha256": _sha256(accepted_checkpoint["source_plan_path"], reads=reads),
        "approval_lineage_sha256": _sha256(
            accepted_checkpoint["approval_lineage_path"], reads=reads,
        ),
        "checkpoint_sha256": candidate["sha256"],
    }


def _revalidate_planned_gen_authority(plan: dict[str, Any], *, reads=None) -> None:
    """Reject a compiled gen plan when its current source authority has changed."""
    planned_training = plan.get("training")
    planned_persona_sha256 = plan.get("persona_sha256")
    snapshot = plan.get("gen_authority")
    required = {
        "approval_sha256", "source_plan_sha256", "approval_lineage_sha256", "checkpoint_sha256",
    }
    if not isinstance(planned_training, dict) or not isinstance(planned_persona_sha256, str):
        raise FigmentTrainError("gen plan has no captured persona/training authority")
    if (not isinstance(snapshot, dict) or set(snapshot) != required
            or any(not isinstance(value, str) for value in snapshot.values())):
        raise FigmentTrainError("gen plan has no captured selected-checkpoint provenance; replan")
    persona, training = _current_persona_training(plan, reads=reads)
    persona_path = _persona_path_for_plan(plan, reads=reads)
    if (persona.get("id") != plan.get("creator")
            or _sha256(persona_path, reads=reads) != planned_persona_sha256):
        raise FigmentTrainError("current persona changed after gen planning; create a fresh gen plan")
    if training != planned_training:
        raise FigmentTrainError(
            "current training or checkpoint selection changed after gen planning; create a fresh gen plan"
        )
    try:
        current_snapshot = _accepted_checkpoint_snapshot(
            _validated_accepted_checkpoint(persona, training, reads=reads), reads=reads,
        )
    except OSError as exc:
        raise FigmentTrainError(
            "selected checkpoint source evidence cannot be read after gen planning"
        ) from exc
    if current_snapshot != snapshot:
        raise FigmentTrainError(
            "selected checkpoint approval provenance changed after gen planning; create a fresh gen plan"
        )


def _stage_accepted_checkpoint(
    out: Path, persona: dict[str, Any], training: dict[str, Any], *,
    accepted_checkpoint: dict[str, Any] | None = None,
) -> str:
    accepted_checkpoint = accepted_checkpoint or _validated_accepted_checkpoint(persona, training)
    candidate = accepted_checkpoint["candidate"]
    digest = accepted_checkpoint["digest"]
    step = accepted_checkpoint["step"]

    upload_name = _checkpoint_name(training["trigger"], step)
    staged_dir = out / "train" / "runs" / "accepted-checkpoint"
    staged_dir.mkdir(parents=True, exist_ok=True)
    staged = staged_dir / upload_name
    shutil.copy2(candidate["path"], staged)
    if _sha256(staged) != digest:
        raise FigmentTrainError("staged checkpoint hash differs from the approved checkpoint")
    return f"accepted-checkpoint/{upload_name}"


def command_gate(creator_id: str, stage: str, plan_path: Path) -> dict[str, Any]:
    """Read `grade/<stage>/gate.json` (written by `build_grade`) and return it --
    never recomputes the gate, so this is fast and matches exactly what the board a
    human is looking at was gated with. Raises if `grade` has not been run yet."""
    if stage not in GRADEABLE_STAGES:
        raise FigmentTrainError(f"gate stage must be one of {GRADEABLE_STAGES}")
    plan, root = _load_plan(creator_id, plan_path)
    gate_path = root / "grade" / stage / "gate.json"
    if not gate_path.is_file():
        raise FigmentTrainError(
            f"no gate.json at {gate_path}; run `figment_train.py grade` for this stage first"
        )
    document = _read_json(gate_path)
    if document.get("own_anchor") is None and not document.get("rows"):
        raise FigmentTrainError(f"gate.json at {gate_path} is empty or malformed")
    evaluation_path = root / "grade" / stage / "evaluation-inputs.json"
    if not evaluation_path.is_file():
        raise FigmentTrainError("cached gate has no freshness record; rebuild it with `grade`")
    evaluation = _read_json(evaluation_path)
    grading = _read_json(root / "grade" / stage / "grading-manifest.json")
    try:
        _lineage_module().assert_current(
            evaluation, _current_review_subject(plan, root, stage, grading),
            label=f"cached {stage} numeric gate",
        )
    except ValueError as exc:
        raise FigmentTrainError(str(exc)) from exc
    result = deepcopy(document)
    result["freshness"] = "cached-current"
    result["recalculated"] = False
    return result


def _format_gate_table(document: dict[str, Any]) -> str:
    header = ("image_id", "pass", "identity_own", "age_delta", "gloss", "niqe", "face_px", "reasons")
    rows = [header]
    for row in document.get("rows", []):
        def _fmt(value: Any) -> str:
            return f"{value:.3f}" if isinstance(value, (int, float)) else "n/a"
        rows.append((
            str(row.get("image_id")),
            "PASS" if row.get("pass") else "FAIL",
            _fmt(row.get("identity_own")),
            _fmt(row.get("age_delta")),
            _fmt(row.get("gloss")),
            _fmt(row.get("niqe")),
            _fmt(row.get("face_px")),
            "; ".join(row.get("reasons") or []),
        ))
    widths = [max(len(str(cell)) for cell in column) for column in zip(*rows)]
    lines = [
        "  ".join(str(cell).ljust(width) for cell, width in zip(row, widths))
        for row in rows
    ]
    summary = document.get("summary", {})
    lines.append("")
    lines.append(
        f"{summary.get('passed', 0)}/{summary.get('total', len(document.get('rows', [])))} passed"
    )
    if document.get("outage"):
        lines.append(f"GATE OUTAGE: {document['outage']}")
    return "\n".join(lines)


def _pipeline_downstream_root(primary_root: Path, stage: str) -> Path:
    """F1: gen/detail (and, once F6 wires it, video) are never part of a `--stage
    all` plan -- each is always planned by name against an already-ruled upstream
    stage. `pipeline` needs a single, deterministic (not a separate cursor file)
    place to look for -- or create -- each one's own plan on every invocation."""
    return primary_root / "downstream" / stage


def _pipeline_gate_instruction(
    creator_id: str, stage: str, plan_path: Path, grade: dict[str, str],
) -> str:
    apply_command = (
        f"py -3 orgs/figment/pipeline/figment_train.py apply-rulings --creator {creator_id} "
        f"--stage {stage} --plan {plan_path} --rulings <path to your filled rulings>"
    )
    return (
        f"GATE {stage}: operator review required.\n"
        f"  Board:            {grade['page']}\n"
        f"  Rulings template: {grade['rulings_template']}\n"
        f"  Fill every cell's seven axes plus decided_by/decided_at, then run:\n"
        f"    {apply_command}\n"
        f"  Re-invoke `pipeline --creator {creator_id} --plan {plan_path}` afterward "
        "to resume without replanning or rerunning this stage."
    )


def _deliverable_entry(validated: dict[str, Any], dest_dir: Path, root: Path) -> dict[str, Any]:
    """B1: `validated` is the return of `_validate_approved_still` (never a raw
    `approved-list.json` row) -- the deliverable copies exactly the bytes the
    approval authority just re-verified, and binds `manifest.json` to that
    validated sha256. m6: re-copies whenever the destination's bytes drift from
    the validated sha (a re-ruling, or a stale/edited file) so a re-ruling never
    leaves stale bytes in `deliverable/`."""
    source = Path(validated["path"])
    destination = dest_dir / f"{validated['image_id']}{source.suffix.lower()}"
    dest_dir.mkdir(parents=True, exist_ok=True)
    if not destination.is_file() or _sha256(destination) != validated["sha256"]:
        shutil.copy2(source, destination)
    return {
        "image_id": validated["image_id"],
        "path": _relative(destination, root),
        "sha256": validated["sha256"],
    }


def _ruling_attribution(document: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    return {
        "decided_by": document.get("decided_by"), "decided_at": document.get("decided_at"),
        "why": row.get("why"), "gate_override": row.get("gate_override"),
    }


def _deliverable_video(creator_id: str, primary_root: Path, video_root: Path) -> dict[str, Any]:
    """On GATE video's ruling the deliverable gains the reel derivative itself --
    `content/reel-templates.yaml`'s 1080x1920@30fps delivery file -- plus the exact
    native<->derivative correspondence `frame_assemble.build_reel_derivative` recorded
    (both movies' own sha256, the filter graph, both durations) and, per graded frame,
    the native frame's own digest from the assembly receipt beside its gate row. A reader
    can therefore prove the delivered mp4 is this run's own native movie re-rendered, and
    that the frames the identity gate scored are the frames that movie was built from --
    without trusting any of the three receipts on its own.

    B1-video: an `approved-list.json` row is never treated as authority here, exactly as
    B1 already refuses to for gen/detail stills. `_load_current_approval` is called first
    -- a stale approval (subject/evaluation/gate.json changed since ruling) refuses before
    any bytes are touched -- and `identity_rows` is built from that approval's OWN
    `subject.images`, never the plan's `approved-list.json`. Every graded row must carry a
    current `keep` ruling plus a gate pass or a non-empty attributed `gate_override`
    (mirrors `_validate_approved_still`'s own kept-row check). `assembly["movie"]`, every
    native frame `frame_assemble` recorded, and the delivered derivative are all re-hashed
    against their real on-disk bytes -- never trusted from a receipt's own claimed digest."""
    plan, loaded_root = _load_plan(creator_id, video_root / "plan.json")
    if loaded_root != video_root:
        raise FigmentTrainError("video plan root changed while loading")
    approval = _load_current_approval(plan, video_root, "video")

    grade_dir = video_root / "grade" / "video"
    directories = _video_evidence_dirs(video_root)
    assembly = _read_json(directories["assembly"] / "frame-assembly.json")
    reel = _read_json(directories["reel"] / "reel-derivative.json")
    extraction_path = directories["samples"] / "frame-extraction.json"
    correspondence = reel["correspondence"]
    candidate_id = (reel.get("candidate") or assembly.get("candidate") or {}).get("id")
    if not isinstance(candidate_id, str) or not candidate_id:
        raise FigmentTrainError("video evidence carries no review-candidate id")

    # B1-video: re-hash the assembled native movie and every native frame against
    # their real on-disk bytes -- a `frame-assembly.json` claim is never trusted alone.
    movie_path = ROOT / assembly["movie"]["path"]
    if not movie_path.is_file() or _sha256(movie_path) != assembly["movie"]["sha256"]:
        raise FigmentTrainError("assembled native movie bytes do not match its own receipt")

    frame_by_id: dict[str, dict[str, Any]] = {}
    for row in assembly.get("frames", []):
        frame_path = ROOT / row["path"]
        if not frame_path.is_file() or _sha256(frame_path) != row["sha256"]:
            raise FigmentTrainError(
                f"assembled native frame {row.get('path')!r} bytes do not match its own receipt"
            )
        frame_by_id[Path(row["path"]).stem] = row

    # B1-video: every identity row is fully validated -- current keep ruling, gate pass
    # or attributed override, and a present native frame -- BEFORE a single byte is
    # copied into deliverable/video/. A refusal here must never leave a partial or
    # ungated delivery on disk.
    gate_by_id = {
        row["image_id"]: row for row in _read_json(grade_dir / "gate.json").get("rows", [])
    }
    rulings_document = _read_json(grade_dir / "rulings.json")
    ruling_by_id = {row["image_id"]: row for row in rulings_document.get("rulings", [])}

    subject_images = (
        approval.get("subject", {}).get("images")
        if isinstance(approval.get("subject"), dict) else None
    )
    if not isinstance(subject_images, list) or not subject_images:
        raise FigmentTrainError("video approval carries no subject images")

    identity_rows = []
    for row in subject_images:
        image_id = row.get("image_id") if isinstance(row, dict) else None
        if not isinstance(image_id, str) or not image_id:
            raise FigmentTrainError("video approval subject image id is invalid")
        ruling = ruling_by_id.get(image_id)
        if not isinstance(ruling, dict) or ruling.get("decision") != "keep":
            continue
        gate_row = gate_by_id.get(image_id)
        override = ruling.get("gate_override")
        if (gate_row is None or gate_row.get("pass") is not True) and (
            not isinstance(override, str) or not override.strip()
        ):
            raise FigmentTrainError(f"kept video frame {image_id!r} lacks a gate pass or override")
        native = frame_by_id.get(image_id)
        if native is None:
            raise FigmentTrainError(
                f"graded video frame {image_id!r} is absent from the assembly receipt"
            )
        identity_rows.append({
            "image_id": image_id,
            "native_frame": {
                "path": native["path"], "bytes": native["bytes"],
                "sha256": native["sha256"], "index": native["index"],
            },
            "gate": gate_row,
            "ruling": _ruling_attribution(rulings_document, ruling),
        })
    if not identity_rows:
        raise FigmentTrainError("video approval carries no kept, gate-justified frames")

    destination_dir = primary_root / "deliverable" / "video"
    destination = destination_dir / f"{candidate_id}.mp4"
    if not destination.is_file() or _sha256(destination) != correspondence["derivative"]["sha256"]:
        destination_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / correspondence["derivative"]["path"], destination)
    digest = _sha256(destination)
    if digest != correspondence["derivative"]["sha256"]:
        raise FigmentTrainError(
            "delivered reel bytes do not match the recorded native->derivative correspondence"
        )
    if correspondence["native"]["sha256"] != assembly["movie"]["sha256"]:
        raise FigmentTrainError(
            "reel derivative is not bound to this plan's own assembled native movie"
        )

    # MINOR 7: an earlier ruling's mp4 the current manifest no longer references is
    # never left behind in deliverable/video/.
    if destination_dir.is_dir():
        for existing in destination_dir.iterdir():
            if existing.is_file() and existing.name != destination.name and existing.suffix.lower() == ".mp4":
                existing.unlink()

    return {
        "candidate_id": candidate_id,
        "reel": {
            "path": _relative(destination, primary_root),
            "bytes": destination.stat().st_size,
            "sha256": digest,
        },
        "delivery_profile": reel["delivery_profile"],
        "correspondence": correspondence,
        "native_movie": assembly["movie"],
        "extraction_receipt": {
            "path": _relative(extraction_path, ROOT), "sha256": _sha256(extraction_path),
        },
        "identity_under_motion": identity_rows,
    }


def _build_deliverable(
    creator_id: str, primary_root: Path, gen_root: Path, detail_root: Path,
    video_root: Path,
) -> dict[str, Any] | None:
    """The deliverable (F1's own spec, minimal -- no new schema beyond what the
    receipts already carry): the kept gen stills, the kept detail images, and a
    manifest.json binding the gen/detail plan sha, the chosen checkpoint, every kept
    cell's gate row, and its ruling attribution. Built once detail is ruled (None
    before then). Idempotent: a deliverable already bound to the current gen, detail,
    and video approval-lineage is returned as-is rather than rebuilt on every
    `pipeline` call -- gen's own approval-lineage sha is folded in alongside detail's
    so a gen re-ruling (a new kept set, even one that leaves detail's own digest
    unchanged) is never missed."""
    detail_approval_path = detail_root / "grade" / "detail" / "approval-lineage.json"
    if not detail_approval_path.is_file():
        return None
    gen_approval_path = gen_root / "grade" / "gen" / "approval-lineage.json"
    gen_approval_sha256 = _sha256(gen_approval_path)
    video_approval_path = video_root / "grade" / "video" / "approval-lineage.json"
    video_approval_sha256 = (
        _sha256(video_approval_path) if video_approval_path.is_file() else None
    )
    deliverable_dir = primary_root / "deliverable"
    manifest_path = deliverable_dir / "manifest.json"
    detail_approval_sha256 = _sha256(detail_approval_path)
    if manifest_path.is_file():
        existing = _read_json(manifest_path)
        if (existing.get("gen_approval_sha256") == gen_approval_sha256
                and existing.get("detail_approval_sha256") == detail_approval_sha256
                and existing.get("video_approval_sha256") == video_approval_sha256):
            return existing

    gen_plan_path = gen_root / "plan.json"
    detail_plan_path = detail_root / "plan.json"

    gen_approved = _read_json(gen_root / "grade" / "gen" / "approved-list.json")
    gen_gate_by_id = {
        row["image_id"]: row
        for row in _read_json(gen_root / "grade" / "gen" / "gate.json").get("rows", [])
    }
    gen_rulings_doc = _read_json(gen_root / "grade" / "gen" / "rulings.json")
    gen_ruling_by_id = {row["image_id"]: row for row in gen_rulings_doc.get("rulings", [])}

    detail_approved = _read_json(detail_root / "grade" / "detail" / "approved-list.json")
    detail_gate_by_id = {
        row["image_id"]: row
        for row in _read_json(detail_root / "grade" / "detail" / "gate.json").get("rows", [])
    }
    detail_rulings_doc = _read_json(detail_root / "grade" / "detail" / "rulings.json")
    detail_ruling_by_id = {row["image_id"]: row for row in detail_rulings_doc.get("rulings", [])}

    # B1: every row is re-verified through the approval authority before its bytes
    # are copied into the deliverable -- an `approved-list.json` entry alone is never
    # trusted, whatever path, gate state, or ruling it claims.
    stills = []
    for row in gen_approved.get("images", []):
        validated = validate_approved_gen_still(creator_id, gen_plan_path, row["image_id"])
        entry = _deliverable_entry(validated, deliverable_dir / "stills", primary_root)
        entry["gate"] = gen_gate_by_id.get(row["image_id"])
        entry["ruling"] = _ruling_attribution(
            gen_rulings_doc, gen_ruling_by_id.get(row["image_id"], {}),
        )
        stills.append(entry)

    detail_images = []
    for row in detail_approved.get("images", []):
        validated = validate_approved_detail_still(creator_id, detail_plan_path, row["image_id"])
        entry = _deliverable_entry(validated, deliverable_dir / "detail", primary_root)
        entry["gate"] = detail_gate_by_id.get(row["image_id"])
        entry["ruling"] = _ruling_attribution(
            detail_rulings_doc, detail_ruling_by_id.get(row["image_id"], {}),
        )
        detail_images.append(entry)

    gen_training = _read_json(gen_plan_path).get("training", {})
    # Read origin off the accepted-checkpoint record itself so the deliverable is
    # explicit about where the promoted LoRA came from (operator-trained ladder
    # imported via --import-checkpoints, vs. this pipeline's own in-plan train).
    checkpoint_origin = "in-plan"
    chosen_checkpoint_approval = gen_training.get("chosen_checkpoint_approval")
    if isinstance(chosen_checkpoint_approval, str):
        approval_full_path = _resolve_config_path(chosen_checkpoint_approval)
        if approval_full_path.is_file():
            checkpoint_origin = _read_json(approval_full_path).get("origin", "in-plan")
    manifest = {
        "schema": "figment/deliverable@1",
        "creator": creator_id,
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "checkpoint": {
            "step": gen_training.get("chosen_checkpoint_step"),
            "sha256": gen_training.get("chosen_checkpoint_sha256"),
            "origin": checkpoint_origin,
        },
        "gen_plan": {"path": str(gen_plan_path), "sha256": _sha256(gen_plan_path)},
        "detail_plan": {"path": str(detail_plan_path), "sha256": _sha256(detail_plan_path)},
        "gen_approval_sha256": gen_approval_sha256,
        "detail_approval_sha256": detail_approval_sha256,
        "video_approval_sha256": video_approval_sha256,
        "stills": stills,
        "detail": detail_images,
    }
    if video_approval_sha256 is not None:
        manifest["video"] = _deliverable_video(creator_id, primary_root, video_root)
    _write_json(manifest_path, manifest)
    return manifest


def command_pipeline(
    creator_id: str,
    *,
    plan_path: Path | None = None,
    out: Path | None = None,
    personas_root: Path = PERSONAS_ROOT,
    skip_pin_verify: bool = False,
    skip_judge: bool = False,
    dry_run: bool = False,
    from_stage: str | None = None,
    ledger_dir: Path | None = None,
    accept_budget: bool = False,
    style_lora: str | None = None,
    style_lora_strength: float | None = None,
    import_checkpoints: Path | None = None,
    import_training_config: Path | None = None,
) -> dict[str, Any]:
    """One resumable driver across anchor -> dataset -> smoke -> train -> tester
    -> gen -> detail. Dispatches to the EXISTING `run_planned_stage`, `build_grade`,
    `command_gate`-equivalent freshness reads, and `apply_rulings` is left to the
    operator (a ruling is a human act, per contract.md) -- this function never writes
    one. It stores no cursor/state file of its own: "next action" is derived every
    call from receipts (`stage.json`/`run.json`) and grade/rulings files already on
    disk, so killing and re-invoking `pipeline` is always safe.

    Exactly one of `plan_path` (resume an existing plan) or `out` (build a fresh
    `--stage all` plan there first) must be given. `gen` and `detail` are never part
    of that primary plan (README: "gen is NEVER included in `--stage all`", extended
    to detail too); `pipeline` plans each of them itself, by name,
    the moment its upstream ruling exists, into a deterministic
    `<primary_root>/downstream/<stage>` directory (`_pipeline_downstream_root`) so a
    later invocation finds the same plan rather than creating a second one.

    Halts with a printed operator instruction (board path, rulings template path, the
    exact `apply-rulings` command) and a `GATE <stage>: awaiting ruling` line at every
    gradeable stage whose ruling is not yet recorded, then returns with `status`
    `"GATE <stage>"` (exit 0 at the CLI layer -- this is normal operation, not an
    error). `dry_run` previews the next action (which stage would plan or run) without
    calling `run_planned_stage`/`build_plan`/`build_grade` at all -- it never invokes
    the pod harness, matching every other local-and-free command in this file; only
    `run_planned_stage` itself ever spends. There is deliberately no `max_usd`
    parameter here (or on `pipeline`'s CLI) -- ceilings are derived per-manifest at
    plan time (`manifest_ceiling`), never overridden at run time; see the README's
    Spend guards section.

    `video` is planned the same way, into `<primary_root>/downstream/video`, once
    `gen` is ruled -- but ONLY if this run root lies inside the repository, because
    `video_manifest`'s review-candidate mode binds the plan's own in-repo `persona.yaml`
    under one common containment root (`_video_authority_root`). A run rooted outside the
    repo stops with `stopped:video-out-of-tree` after writing everything it honestly can
    (the stills/detail deliverable); `gen` and `detail` themselves are unaffected. That
    is why `pipeline --out` defaults to `orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/`.

    `import_checkpoints` (operator-trained LoRA path, MANDATE.md's tier constraint),
    meaningful only together with `--out` (a fresh primary plan), plans `tester` as the
    primary plan's only stage instead of the usual `--stage all` -- anchor/dataset/
    smoke/train are skipped outright, never planned or run, because the loop below
    already only walks stages present in `primary_plan["stages"]`.
    """
    if (plan_path is None) == (out is None):
        raise FigmentTrainError("pipeline requires exactly one of --plan or --out")
    if from_stage is not None and from_stage not in PIPELINE_FROM_STAGES:
        raise FigmentTrainError(f"pipeline --from-stage must be one of {PIPELINE_FROM_STAGES}")
    if import_checkpoints is not None and plan_path is not None:
        raise FigmentTrainError("--import-checkpoints is only meaningful with --out (a fresh plan)")

    if plan_path is not None:
        primary_plan, primary_root = _load_plan(creator_id, plan_path)
        primary_plan_path = Path(plan_path).resolve()
    else:
        if dry_run:
            return {
                "status": "dry-run:plan",
                "message": f"would build a fresh --stage all plan at {Path(out).resolve()}",
            }
        primary_plan = build_plan(
            creator_id, "tester" if import_checkpoints is not None else "all", out,
            personas_root=personas_root, skip_pin_verify=skip_pin_verify,
            ledger_dir=ledger_dir, accept_budget=accept_budget,
            import_checkpoints=import_checkpoints,
            import_training_config=import_training_config,
        )
        primary_root = Path(out).resolve()
        primary_plan_path = primary_root / "plan.json"

    order = list(STAGES)
    if from_stage is not None:
        order = order[order.index(from_stage):]

    gen_root = _pipeline_downstream_root(primary_root, "gen")
    detail_root = _pipeline_downstream_root(primary_root, "detail")
    video_root = _pipeline_downstream_root(primary_root, "video")

    def deliverable_path() -> str | None:
        """Everything ruled so far, written once and re-read afterwards (idempotent on
        the detail + video approval digests it is bound to). Under `dry_run` this is
        read-only: an already-built deliverable is reported, but `_build_deliverable`
        (which copies bytes and writes manifest.json) is never invoked -- `dry_run`
        previews the next action without touching disk."""
        manifest_path = primary_root / "deliverable" / "manifest.json"
        if dry_run:
            return str(manifest_path) if manifest_path.is_file() else None
        built = _build_deliverable(
            creator_id, primary_root, gen_root, detail_root, video_root,
        )
        return str(manifest_path) if built is not None else None

    for stage in order:
        if stage in ("anchor", "dataset", "smoke", "train", "tester"):
            if stage not in primary_plan.get("stages", {}):
                continue
            active_plan, active_root, active_plan_path = (
                primary_plan, primary_root, primary_plan_path,
            )
        elif stage == "gen":
            if (gen_root / "plan.json").is_file():
                active_plan, active_root = _load_plan(creator_id, gen_root / "plan.json")
            else:
                if not (primary_root / "grade" / "tester" / "accepted-checkpoint.json").is_file():
                    return {
                        "status": "stopped:gen-not-planned",
                        "message": (
                            "tester has not been promoted with --checkpoint-step yet; "
                            "apply tester rulings before gen can be planned"
                        ),
                    }
                if dry_run:
                    return {
                        "status": "dry-run:gen",
                        "message": f"would build a fresh gen plan at {gen_root}",
                    }
                active_plan = build_plan(
                    creator_id, "gen", gen_root, personas_root=personas_root,
                    skip_pin_verify=skip_pin_verify, ledger_dir=ledger_dir,
                    accept_budget=accept_budget, style_lora=style_lora,
                    style_lora_strength=style_lora_strength,
                )
                active_root = gen_root
            active_plan_path = gen_root / "plan.json"
        elif stage == "detail":
            if (detail_root / "plan.json").is_file():
                active_plan, active_root = _load_plan(creator_id, detail_root / "plan.json")
            else:
                if not (gen_root / "grade" / "gen" / "approved-list.json").is_file():
                    return {
                        "status": "stopped:detail-not-planned",
                        "message": (
                            "gen has not been ruled yet; apply gen rulings before "
                            "detail can be planned"
                        ),
                    }
                if dry_run:
                    return {
                        "status": "dry-run:detail",
                        "message": f"would build a fresh detail plan at {detail_root}",
                    }
                active_plan = build_plan(
                    creator_id, "detail", detail_root, personas_root=personas_root,
                    skip_pin_verify=skip_pin_verify, approved_gen_plan=gen_root,
                    ledger_dir=ledger_dir, accept_budget=accept_budget,
                )
                active_root = detail_root
            active_plan_path = detail_root / "plan.json"
        elif stage == "video":
            deliverable = deliverable_path()
            if (video_root / "plan.json").is_file():
                active_plan, active_root = _load_plan(creator_id, video_root / "plan.json")
            else:
                if not (gen_root / "grade" / "gen" / "approval-lineage.json").is_file():
                    return {
                        "status": "stopped:video-not-planned",
                        "message": (
                            "gen has not been ruled yet; apply gen rulings before video "
                            "can be planned"
                        ),
                        "deliverable": deliverable,
                    }
                try:
                    _video_authority_root(primary_root, "this pipeline's run root")
                except FigmentTrainError as exc:
                    return {
                        "status": "stopped:video-out-of-tree",
                        "message": str(exc),
                        "deliverable": deliverable,
                    }
                if dry_run:
                    return {
                        "status": "dry-run:video",
                        "message": f"would build a fresh video plan at {video_root}",
                    }
                active_plan = build_plan(
                    creator_id, "video", video_root, personas_root=personas_root,
                    skip_pin_verify=skip_pin_verify, approved_gen_plan=gen_root,
                    ledger_dir=ledger_dir, accept_budget=accept_budget,
                )
                active_root = video_root
            active_plan_path = video_root / "plan.json"
        else:
            raise FigmentTrainError(f"pipeline does not know stage {stage!r}")

        state = _stage_state(active_root / "stage.json", creator_id, active_plan_path)
        if stage not in state.get("completed_stages", []):
            if dry_run:
                return {
                    "status": f"dry-run:{stage}",
                    "message": f"would run stage {stage!r} for plan {active_plan_path}",
                }
            run_planned_stage(creator_id, stage, active_plan_path)

        if stage in GRADEABLE_STAGES:
            grade_dir = active_root / "grade" / stage
            gate_path = grade_dir / "gate.json"
            approval_path = grade_dir / "approval-lineage.json"
            rejection_path = grade_dir / "rejection-lineage.json"
            if not gate_path.is_file():
                if dry_run:
                    return {
                        "status": f"dry-run:grade-{stage}",
                        "message": f"would grade stage {stage!r} for plan {active_plan_path}",
                    }
                grade = build_grade(
                    creator_id, stage, active_plan_path, skip_judge=skip_judge,
                )
            else:
                grade = {
                    "page": str(grade_dir / "board.html"),
                    "rulings_template": str(grade_dir / "rulings.template.json"),
                    "grading_manifest": str(grade_dir / "grading-manifest.json"),
                    "gate": str(gate_path),
                }
            if not approval_path.is_file() and not rejection_path.is_file():
                instruction = _pipeline_gate_instruction(
                    creator_id, stage, active_plan_path, grade,
                )
                print(instruction)
                print(f"GATE {stage}: awaiting ruling")
                result = {"status": f"GATE {stage}", "message": instruction}
                if stage == "video":
                    result["deliverable"] = deliverable
                return result
            if rejection_path.is_file() and not approval_path.is_file():
                return {
                    "status": f"stopped:{stage}-rejected",
                    "message": f"{stage} rulings kept no images; nothing to promote",
                }
            if stage == "anchor":
                approval = _read_json(approval_path)
                if approval.get("transition", {}).get("requires_replan"):
                    return {
                        "status": "stopped:anchor-promoted",
                        "message": (
                            "anchor promoted the persona references; this plan cannot "
                            f"continue -- invoke `pipeline --creator {creator_id} "
                            "--out <new-dir>` for a fresh --stage all plan"
                        ),
                    }

    # n11 (superseded by F6a): the old claim that `order` always ends with a
    # self-returning branch was true only while "detail" was the last real stage --
    # once GATE video is already ruled (approval-lineage.json on disk), the "video"
    # branch above falls through without returning, same as every other already-
    # ruled stage. This is that terminal return, now for "video" instead of the
    # removed dead `"complete:detail"` one.
    return {
        "status": "complete:video",
        "message": "pipeline complete through video",
        "deliverable": deliverable_path(),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="generate a creator-specific Track-1 plan")
    plan.add_argument("--creator", required=True)
    plan.add_argument("--stage", choices=(*STAGES, "all"), default="all")
    plan.add_argument("--out", required=True, type=Path)
    plan.add_argument(
        "--ledger-dir", type=Path,
        help="cost ledger root (frozen in plan: explicit, KB_LEDGER_DIR, managed OPS, then repo)",
    )
    plan.add_argument(
        "--skip-pin-verify", action="store_true",
        help="skip the live Hugging Face pin-verification preflight (offline/test use only)",
    )
    plan.add_argument(
        "--detail-images", default=None,
        help="glob of existing rendered cells to re-detail (only meaningful with "
             "--stage gen); emits an extra <id>-tensor-detail.yaml manifest",
    )
    plan.add_argument(
        "--approved-gen-plan", default=None, type=Path,
        help="directory of an already-ruled gen plan. With --stage detail every image in "
             "its grade/gen/approved-list.json is re-detailed; with --stage video one "
             "of them becomes the I2V first frame",
    )
    plan.add_argument(
        "--approved-gen-image-id", default=None,
        help="--stage video only: which kept gen still becomes the first frame "
             "(default: the first kept image id in sorted order)",
    )
    plan.add_argument(
        "--video-action", default=None,
        help=f"--stage video only: the short clothed motion instruction composed with the "
             f"persona's own look (default: {VIDEO_DEFAULT_ACTION!r})",
    )
    plan.add_argument(
        "--accept-budget", action="store_true",
        help="required to write a plan whose planned run ceilings exceed the arc "
             "cap remaining (arc_cap_usd - arc already spent); the acceptance and its "
             "numbers are recorded in plan.json's budget_preflight",
    )
    plan.add_argument(
        "--style-lora", default=None,
        help="gen-only style LoRA key (pins.pins.style_loras in tensor-pins.yaml), "
             "e.g. inline-skin; overrides persona.training.style_lora for this one plan "
             "-- never a persona fork",
    )
    plan.add_argument(
        "--style-lora-strength", default=None, type=float,
        help="LoraLoaderModelOnly strength for --style-lora (0 < x <= 1.5); "
             "defaults to persona.training.style_lora_strength (0.8) when omitted",
    )
    plan.add_argument(
        "--import-checkpoints", default=None, type=Path,
        help="only meaningful with --stage tester: a directory of loose, operator-"
             "trained *.safetensors checkpoint ladder files (MANDATE.md's tier "
             "constraint) to screen instead of an in-plan train stage's own artifacts",
    )
    plan.add_argument(
        "--import-training-config", default=None, type=Path,
        help="only meaningful with --import-checkpoints: the training.yaml the "
             "imported ladder was actually trained with (default: the persona's "
             "own current training.yaml)",
    )

    pipeline = commands.add_parser(
        "pipeline",
        help="resumable driver across anchor..video; halts at every gate, "
             "never plans/runs/grades twice for the same stage",
    )
    pipeline.add_argument("--creator", required=True)
    pipeline_target = pipeline.add_mutually_exclusive_group()
    pipeline_target.add_argument(
        "--plan", type=Path, help="resume an existing --stage all plan.json",
    )
    pipeline_target.add_argument(
        "--out", type=Path,
        help="build a fresh --stage all plan here first (default when neither --plan nor "
             "--out is given: orgs/figment/runs/<creator>/<YYYYMMDD-HHMMSS>/, the in-repo "
             "run root the video stage requires -- see _video_authority_root)",
    )
    pipeline.add_argument("--from-stage", choices=PIPELINE_FROM_STAGES, default=None)
    pipeline.add_argument("--dry-run", action="store_true")
    pipeline.add_argument(
        "--skip-pin-verify", action="store_true",
        help="skip the live Hugging Face pin-verification preflight (offline/test use only)",
    )
    pipeline.add_argument(
        "--skip-judge", action="store_true",
        help="omit stage 2 (the vlm_judge.py Claude vision judge) -- offline/test use "
             "only, NEVER pass this on a real grading run",
    )
    pipeline.add_argument("--ledger-dir", type=Path)
    pipeline.add_argument(
        "--accept-budget", action="store_true",
        help="required whenever a stage `pipeline` plans on its own (--out, or a "
             "downstream gen/detail/video plan) would exceed the arc cap remaining",
    )
    pipeline.add_argument(
        "--style-lora", default=None,
        help="applied only when pipeline plans its own downstream gen stage -- "
             "see `plan --style-lora`",
    )
    pipeline.add_argument(
        "--style-lora-strength", default=None, type=float,
        help="see `plan --style-lora-strength`",
    )
    pipeline.add_argument(
        "--import-checkpoints", default=None, type=Path,
        help="only meaningful with --out (a fresh primary plan): plan tester as the "
             "primary plan's only stage against this operator-trained checkpoint "
             "ladder directory, skipping anchor/dataset/smoke/train -- see "
             "`plan --import-checkpoints`",
    )
    pipeline.add_argument(
        "--import-training-config", default=None, type=Path,
        help="only meaningful with --import-checkpoints; see `plan --import-training-config`",
    )

    run = commands.add_parser("run", help="run one planned stage without retries")
    run.add_argument("--creator", required=True)
    run.add_argument("--stage", choices=(*STAGES, "all"), required=True)
    run.add_argument("--plan", required=True, type=Path)

    grade = commands.add_parser("grade", help="build a full-resolution grading board")
    grade.add_argument("--creator", required=True)
    grade.add_argument("--stage", choices=GRADEABLE_STAGES, required=True)
    grade.add_argument("--plan", type=Path, default=Path("plan.json"))
    grade.add_argument(
        "--skip-judge", action="store_true",
        help="omit stage 2 (the vlm_judge.py Claude vision judge) -- offline/test use "
             "only, NEVER pass this on a real grading run",
    )
    grade.add_argument(
        "--judge-backend", choices=("claude", "codex-diagnostic", "local-research"), default="claude",
        help="stage-2 backend; local-research omits external judging and cannot pass the gate",
    )

    apply = commands.add_parser("apply-rulings", help="validate and apply operator rulings")
    apply.add_argument("--creator", required=True)
    apply.add_argument("--stage", choices=GRADEABLE_STAGES, required=True)
    apply.add_argument("--plan", type=Path, default=Path("plan.json"))
    apply.add_argument("--rulings", required=True, type=Path)
    apply.add_argument(
        "--checkpoint-step", type=int, default=None,
        help="tester only: promote this explicitly kept checkpoint candidate",
    )

    gate = commands.add_parser("gate", help="print the fail-closed gate's pass/fail table")
    gate.add_argument("--creator", required=True)
    gate.add_argument("--stage", choices=GRADEABLE_STAGES, required=True)
    gate.add_argument("--plan", type=Path, default=Path("plan.json"))

    train_first = commands.add_parser(
        "train-first",
        help="Path-A train-first (r24 method 4 + r21 DOP): plan train+tester against an "
             "already-selected, already-captioned dataset dir, never the module-10 "
             "dataset stage",
    )
    train_first.add_argument("--creator", required=True)
    train_first.add_argument("--dataset-dir", required=True, type=Path)
    train_first.add_argument("--out", required=True, type=Path)
    train_first.add_argument(
        "--ledger-dir", type=Path,
        help="cost ledger root (frozen in plan: explicit, KB_LEDGER_DIR, managed OPS, then repo)",
    )
    train_first.add_argument(
        "--skip-pin-verify", action="store_true",
        help="skip the live Hugging Face pin-verification preflight (offline/test use only)",
    )
    train_first.add_argument(
        "--accept-budget", action="store_true",
        help="required to write a plan whose planned run ceilings exceed the arc "
             "cap remaining",
    )
    accept_dataset = commands.add_parser(
        "accept-dataset",
        help="record explicit operator acceptance of an existing train-first dataset",
    )
    accept_dataset.add_argument("--creator", required=True)
    accept_dataset.add_argument("--dataset-dir", required=True, type=Path)
    accept_dataset.add_argument("--decided-by", required=True)
    accept_dataset.add_argument("--decided-at", required=True)

    diagnostic = commands.add_parser(
        "held-out-diagnostic",
        help="freeze an unscored candidate-versus-no-LoRA evaluation protocol; never runs a pod",
    )
    diagnostic.add_argument("--creator", required=True)
    diagnostic.add_argument("--candidate-checkpoint", required=True, type=Path)
    diagnostic.add_argument("--out", required=True, type=Path)
    diagnostic.add_argument(
        "--canonical-anchor",
        help="exact current persona identity.references entry; required when more than one exists",
    )
    compile_diagnostic = commands.add_parser(
        "compile-held-out-diagnostic",
        help="compile one frozen non-promotable LoRA/control protocol; never runs a pod",
    )
    compile_diagnostic.add_argument("--creator", required=True)
    compile_diagnostic.add_argument("--protocol", required=True, type=Path)
    compile_diagnostic.add_argument("--candidate-checkpoint", required=True, type=Path)
    compile_diagnostic.add_argument("--out", required=True, type=Path)
    compile_diagnostic.add_argument("--ledger-dir", type=Path)
    return parser


def _print_train_budget(result: dict[str, Any]) -> None:
    train_stage = result.get("stages", {}).get("train")
    if not train_stage or not train_stage["runs"]:
        return
    budget = train_stage["runs"][0].get("budget")
    if not budget:
        return
    print(
        f"train budget: steps={budget['steps']} per_step_s={budget['per_step_s']} "
        f"job_timeout_seconds={budget['job_timeout_seconds']} "
        f"max_minutes={budget['max_minutes']} ceiling_usd=${budget['ceiling_usd']}"
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "plan":
            result = build_plan(
                args.creator, args.stage, args.out, skip_pin_verify=args.skip_pin_verify,
                detail_images=args.detail_images, approved_gen_plan=args.approved_gen_plan,
                approved_gen_image_id=args.approved_gen_image_id,
                video_action=args.video_action, ledger_dir=args.ledger_dir,
                accept_budget=args.accept_budget,
                style_lora=args.style_lora, style_lora_strength=args.style_lora_strength,
                import_checkpoints=args.import_checkpoints,
                import_training_config=args.import_training_config,
            )
            print(f"wrote {args.out.resolve() / 'plan.json'} ({len(result['stages'])} stage(s))")
            _print_train_budget(result)
        elif args.command == "pipeline":
            # F6a: the in-repo default run root. `command_pipeline` itself still requires
            # exactly one of plan/out -- the default is a CLI convenience, so a caller
            # that passes neither in-process still gets the explicit error.
            out = args.out
            if args.plan is None and out is None:
                out = _default_pipeline_out(args.creator)
                print(f"pipeline: new run root {out}")
            result = command_pipeline(
                args.creator, plan_path=args.plan, out=out,
                skip_pin_verify=args.skip_pin_verify, skip_judge=args.skip_judge,
                dry_run=args.dry_run, from_stage=args.from_stage,
                ledger_dir=args.ledger_dir, accept_budget=args.accept_budget,
                style_lora=args.style_lora, style_lora_strength=args.style_lora_strength,
                import_checkpoints=args.import_checkpoints,
                import_training_config=args.import_training_config,
            )
            print(f"pipeline: {result['status']}")
        elif args.command == "run":
            result = run_planned_stage(args.creator, args.stage, args.plan)
            print(f"stage state: {result['status']}")
        elif args.command == "grade":
            result = build_grade(
                args.creator, args.stage, args.plan,
                skip_judge=args.skip_judge, judge_backend=args.judge_backend,
            )
            print(f"grading page: {result['page']}")
            print(f"rulings template: {result['rulings_template']}")
        elif args.command == "gate":
            document = command_gate(args.creator, args.stage, args.plan)
            print("cached evaluation; freshness verified against current inputs (no recalculation)")
            print(_format_gate_table(document))
        elif args.command == "train-first":
            result = build_train_first_plan(
                args.creator, args.dataset_dir, args.out, skip_pin_verify=args.skip_pin_verify,
                ledger_dir=args.ledger_dir, accept_budget=args.accept_budget,
            )
            print(f"wrote {args.out.resolve() / 'plan.json'} "
                  f"({len(result['stages'])} stage(s))")
            _print_train_budget(result)
        elif args.command == "accept-dataset":
            result = accept_train_first_dataset(
                args.creator, args.dataset_dir,
                decided_by=args.decided_by, decided_at=args.decided_at,
            )
            print(f"dataset accepted: {Path(args.dataset_dir).resolve() / 'dataset-approval.json'}")
        elif args.command == "held-out-diagnostic":
            result = build_held_out_diagnostic_protocol(
                args.creator, args.candidate_checkpoint, args.out,
                canonical_anchor=args.canonical_anchor,
            )
            print(f"wrote unscored held-out diagnostic protocol: {args.out.resolve()}")
        elif args.command == "compile-held-out-diagnostic":
            result = compile_held_out_diagnostic(
                args.creator, args.protocol, args.candidate_checkpoint, args.out,
                ledger_dir=args.ledger_dir,
            )
            print(f"wrote non-promotable held-out diagnostic preparation: {args.out.resolve()}")
        else:
            result = apply_rulings(
                args.creator, args.stage, args.plan, args.rulings,
                checkpoint_step=args.checkpoint_step,
            )
            print(f"applied rulings: {result['rulings']}")
            if "rejection_lineage" in result:
                print(f"rejection lineage: {result['rejection_lineage']}")
            else:
                print(f"approved list: {result['approved_list']}")
    except (FigmentTrainError, OSError) as exc:
        print(f"STOP: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""identity_gate.py -- fail-closed per-cell identity/age/realism gate.

Extends `score_cells.py` (the advisory-only board annotator) rather than forking it:
this module reuses `train/identity_check.py`'s FaceNet embedder, `cosine`/`vector`
helpers, `compute_raw_metrics`, and `centroid`, and `score_cells.py`'s own age-bucket
label parser (`_bucket_midpoint`) -- loaded the same ad-hoc-by-path way every module in
this tree loads its siblings (no package `__init__.py` exists here).

Unlike `score_cells.score` -- which is advisory-only and MUST NEVER keep or cull a cell
(see that module's docstring and TENSOR-REPLICATION.md's "Grading protocol") -- this
module is the one place in the pipeline allowed to make a fail-closed pass/fail call.
Operator ruling (2026-09-03): no image board reaches the operator until this gate says a
shown cell holds identity, age and realism. A metric that could not be computed is
always a FAIL, never a silent pass -- see `gate()`.

Persona-agnostic by construction: nothing in this file names a specific creator. Every
persona-specific number (which reference anchor is "own", the minimum acceptable face
size) is read from whatever `persona.yaml` / `anchors` mapping a caller passes in, never
hardcoded. The convention this module assumes -- and that callers must supply --
is that `anchors` is keyed by reference stem (`"g01"`, `"g02"`, ...) and `own_anchor`
names whichever key the persona's own `identity.references[0]` resolves to; that
convention already encodes any operator ruling about which anchor an identity "is"
through DATA (persona.yaml's reference order), not code.

Realism has three legs, per the operator's brief:
  (a) NIQE -- a standalone, from-scratch reimplementation of Mittal et al. 2013's
      "Making a Completely Blind Image Quality Analyzer" (IEEE Signal Processing
      Letters). `pyiqa`'s NIQE is PolyForm-Noncommercial-licensed (r22 §6) and is never
      imported or vendored here; every line of `_niqe_features`/`_fit_mvg`/
      `compute_niqe` below is written from the paper's published equations, which are
      not themselves anyone's copyrighted code. This implementation is single-scale
      (the paper's is two-scale, full-res + half-res, concatenated to 36 features) --
      a deliberate simplification, documented rather than silently shipped. It also
      cannot use the paper's own "pristine" natural-image corpus (no license-clean
      source of that exact corpus was found in r22's pass); instead the "pristine"
      multivariate Gaussian is fit from whichever `anchors` a caller supplies -- a
      persona's own real reference photographs are themselves natural (non-AI-generated)
      images, and are the only license-clean natural-image set this pipeline has for any
      given persona. This makes the resulting NIQE score a "how far does this candidate's
      local-statistics fingerprint sit from THIS persona's own real photos" measure, not
      an absolute naturalness score against a broad natural-image distribution -- see
      `calibrate`'s calibration.md for how honestly this separates real verdicts.
  (b) face-crop Laplacian variance -- reuses `identity_check.compute_raw_metrics`
      unchanged, called on an actual MTCNN-detected face crop (this module's own
      addition; `identity_check._raw_metrics_for_image` documents that no
      face-cropper exists upstream of it yet).
  (c) a specular/gloss proxy -- fraction of near-saturated luminance pixels inside a
      classic YCbCr skin-tone range (Chai & Ngan 1999's widely published Cb in
      [77,127], Cr in [133,173] heuristic) within the face crop. This is a proxy, not a
      real skin segmentation model -- documented as such at `_gloss_proxy`.

The age classifier (`dima806/facial_age_image_detection`, Apache-2.0, r22 §6) is loaded
through a fail-closed pinned-revision downloader (`ensure_age_model`) that verifies the
weight file's sha256 against Hugging Face's own `X-Linked-ETag` header before ever
trusting a cached copy, and refuses outright if the resolved weight file is not
`.safetensors` -- see that function's docstring.
"""
from __future__ import annotations

import argparse
import glob as glob_module
import hashlib
import importlib.util
import json
import math
import os
import shutil
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import yaml

HERE = Path(__file__).resolve().parent
IDENTITY_MODULE_PATH = HERE / "train" / "identity_check.py"
SCORE_CELLS_MODULE_PATH = HERE / "score_cells.py"
VLM_JUDGE_MODULE_PATH = HERE / "vlm_judge.py"
DEFAULT_GATE_CONFIG_PATH = HERE / "gate.yaml"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

GATE_METRICS = ("identity_own", "age_delta", "gloss", "niqe", "face_px")
THRESHOLD_KEYS = (
    "identity_own_min", "age_delta_max_years", "gloss_max", "niqe_max", "face_px_min",
)
# Stage 1 of the two-stage gate (`two_stage_gate`, operator ruling 2026-09-06 folded
# from the vlm_judge.py build): ONLY the facenet own-anchor floor and a usable-face-crop
# floor -- "hard fail for gross identity misses," nothing more. `gate()` above (all five
# GATE_METRICS) is kept exactly as it was and is still available to any caller that
# wants the original single-stage check; it is simply no longer what `two_stage_gate`
# calls stage 1. See `identity_floor_gate`'s own docstring for why age_delta/gloss/niqe
# were dropped from hard-fail duty rather than folded in here too.
STAGE1_METRICS = ("identity_own", "face_px")
STAGE1_THRESHOLD_KEYS = ("identity_own_min", "face_px_min")

# --- pinned, license-clean, safetensors-only age classifier ------------------------
# dima806/facial_age_image_detection -- Apache-2.0, safetensors (r22 §6). Pinned to a
# specific commit and its root `model.safetensors`' LFS content hash, both read live
# from Hugging Face's model API/tree API and its resolve endpoint's `X-Linked-ETag`
# header on 2026-09-06 (see calibrate's own calibration.md for the run that re-verified
# these same figures against the live cache). Never loaded from a `.bin`/`.pt` file.
AGE_MODEL_REPO = "dima806/facial_age_image_detection"
AGE_MODEL_REVISION = "ad35933da48272de7295530766f3d6c56702eba8"
AGE_MODEL_WEIGHT_FILENAME = "model.safetensors"
AGE_MODEL_WEIGHT_SHA256 = "4ce822b91f33fbf51b75c71d447d6fa3eace831fb056c511b719e79bd117f097"
AGE_MODEL_AUX_FILES = ("config.json", "preprocessor_config.json")
AGE_MODEL_CACHE_ENV = "KB_FIGMENT_MODEL_CACHE"  # override hook, tests only


class IdentityGateError(RuntimeError):
    """The gate could not be evaluated, or a model failed integrity verification."""


# ---------------------------------------------------------------------------
# Sibling-module loading -- same ad-hoc-by-path pattern every module here uses (no
# package __init__.py exists in this tree).
# ---------------------------------------------------------------------------


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


def _identity_module():
    return _load_module("_figment_identity_gate_identity_check", IDENTITY_MODULE_PATH)


def _score_cells_module():
    return _load_module("_figment_identity_gate_score_cells", SCORE_CELLS_MODULE_PATH)


def _vlm_judge_module():
    """The stage-2 perceptual judge (vlm_judge.py), loaded the same ad-hoc-by-path way
    as every other sibling in this tree. Deliberately one-directional: vlm_judge.py
    never imports this module back (see its own module docstring), so there is no
    import-cycle risk from loading it here."""
    return _load_module("_figment_identity_gate_vlm_judge", VLM_JUDGE_MODULE_PATH)


# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------


def load_thresholds(
    persona: dict[str, Any] | None = None, gate_config_path: Path = DEFAULT_GATE_CONFIG_PATH,
) -> dict[str, float]:
    """Read `gate.yaml`'s defaults and, when `persona` is given, overlay `face_px_min`
    from that persona's OWN `identity.floor.min_face_px.value` (falling back to
    `gate.yaml`'s own `face_px_min` when the persona declares none) -- the one
    persona-specific number this module ever reads, and it is read generically from
    whatever persona document is passed in, never hardcoded to one creator."""
    document = yaml.safe_load(Path(gate_config_path).read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise IdentityGateError(f"{gate_config_path} does not contain a mapping")
    thresholds = dict(document)
    if persona is not None:
        try:
            min_face_px = persona["identity"]["floor"]["min_face_px"]["value"]
        except (KeyError, TypeError):
            min_face_px = None
        if isinstance(min_face_px, (int, float)):
            thresholds["face_px_min"] = float(min_face_px)
    return thresholds


def gate(scores: dict[str, Any], thresholds: dict[str, Any]) -> dict[str, Any]:
    """Fail-closed pass/fail for one cell's `score_cell` output. Every one of
    `GATE_METRICS` must be present in `scores` AND its corresponding threshold must be
    present in `thresholds`, or that metric fails with reason `"unavailable: <metric>"`
    -- a missing metric or a missing threshold are both treated the same way: a gap the
    gate cannot certify across, never a silent pass. `identity_own`/`face_px` must meet
    or exceed their floor; `|age_delta|`/`gloss`/`niqe` must not exceed their ceiling."""
    reasons: list[str] = []

    def _floor(metric: str, threshold_key: str, value: Any) -> None:
        if value is None:
            reasons.append(f"unavailable: {metric}")
            return
        limit = thresholds.get(threshold_key)
        if limit is None:
            reasons.append(f"unavailable: {threshold_key}")
            return
        if value < limit:
            reasons.append(f"{metric} {value:.4g} is below the required floor {limit:.4g}")

    def _ceiling(metric: str, threshold_key: str, value: Any, *, absolute: bool = False) -> None:
        if value is None:
            reasons.append(f"unavailable: {metric}")
            return
        limit = thresholds.get(threshold_key)
        if limit is None:
            reasons.append(f"unavailable: {threshold_key}")
            return
        measured = abs(value) if absolute else value
        if measured > limit:
            label = f"|{metric}|" if absolute else metric
            reasons.append(f"{label} {measured:.4g} exceeds the allowed ceiling {limit:.4g}")

    _floor("identity_own", "identity_own_min", scores.get("identity_own"))
    _ceiling("age_delta", "age_delta_max_years", scores.get("age_delta"), absolute=True)
    _ceiling("gloss", "gloss_max", scores.get("gloss"))
    _ceiling("niqe", "niqe_max", scores.get("niqe"))
    _floor("face_px", "face_px_min", scores.get("face_px"))

    return {"pass": not reasons, "reasons": reasons}


def load_judge_thresholds(gate_config_path: Path = DEFAULT_GATE_CONFIG_PATH) -> dict[str, float]:
    """Read `gate.yaml`'s `judge:` sub-mapping (`vlm_judge.JUDGE_THRESHOLD_KEYS`) --
    stage 2's thresholds, evidence-backed by `vlm_judge.py calibrate`'s own run over the
    same six evidence sets `identity_gate.py calibrate` used (see that persona's
    `judge-calibration.md`). Raises `IdentityGateError` when `gate.yaml` carries no
    `judge:` block at all -- a missing judge configuration is a setup error, not
    something `two_stage_gate` should silently paper over."""
    document = yaml.safe_load(Path(gate_config_path).read_text(encoding="utf-8"))
    judge_block = document.get("judge") if isinstance(document, dict) else None
    if not isinstance(judge_block, dict):
        raise IdentityGateError(f"{gate_config_path} has no 'judge:' mapping")
    return dict(judge_block)


def identity_floor_gate(scores: dict[str, Any], thresholds: dict[str, Any]) -> dict[str, Any]:
    """Stage 1 of the two-stage gate (`two_stage_gate`): hard fail for GROSS identity
    misses ONLY -- the facenet own-anchor cosine floor and a usable-face-crop-size
    floor (`STAGE1_METRICS`/`STAGE1_THRESHOLD_KEYS`). Fail-closed exactly like `gate()`:
    a missing metric or threshold both read as `"unavailable: <name>"`, never a silent
    pass.

    Operator ruling 2026-09-06 (folded from the vlm_judge.py build) narrowed stage 1 to
    just these two checks. `identity_gate.py`'s own 2026-09-06 calibration
    (`calibration.md`) showed the other three GATE_METRICS should NOT keep hard-fail
    duty going forward:
      * `age_delta_max_years` (the ViT age classifier) is actively harmful, not merely
        unvalidated -- EVERY evidence set's median age_delta is strongly negative
        (track1-dataset -7.0, lora-tester -6.6, qwen-anchor-edits -6.8 years) because the
        classifier itself misreads the persona's own real anchor photos as ~30 years old
        against an "early twenties" persona. Left wired as a hard fail, this ceiling
        would reject the operator's own BEST-verdict sets (the ones called "closer") for
        a reason that has nothing to do with those images and everything to do with a
        broken classifier -- exactly backwards from what stage 1 is for.
      * `gloss_max` (the YCbCr specular-highlight proxy) reads ~0.0000-0.0107 on EVERY
        evidence set including the anchors themselves, even the sets the operator called
        "glossy" -- it is not merely unvalidated, it is inert at its current threshold.
      * `niqe_max` is, per gate.yaml's own comment, "a judgment call, not a separating
        measurement" -- kept in `gate()` for any caller still using the single-stage
        check, but not promoted into stage 1's identity-miss-detection job either.
    All three metrics are still computed onto every `score_cell` row (informational,
    shown on the grading board) and `gate()` itself is untouched -- this function is
    additive, not a replacement.
    """
    reasons: list[str] = []

    def _floor(metric: str, threshold_key: str, value: Any) -> None:
        if value is None:
            reasons.append(f"unavailable: {metric}")
            return
        limit = thresholds.get(threshold_key)
        if limit is None:
            reasons.append(f"unavailable: {threshold_key}")
            return
        if value < limit:
            reasons.append(f"{metric} {value:.4g} is below the required floor {limit:.4g}")

    _floor("identity_own", "identity_own_min", scores.get("identity_own"))
    _floor("face_px", "face_px_min", scores.get("face_px"))
    return {"pass": not reasons, "reasons": reasons}


# REVIEW-2026-09-07 finding #3: `vlm_judge.py`'s `DEFAULT_WORKERS` was lowered to 2
# after the 2026-09-07 incident where 4 concurrent `claude` CLIs timed out 16/18 rows;
# this used to hardcode its own `= 4`, silently restoring the pre-incident condition on
# every `grade` run and the `identity_gate.py run` CLI (both pass this straight to
# `judge_images_for_stage`). One source now, not a copy that can drift again.
DEFAULT_GATE_WORKERS = _vlm_judge_module().DEFAULT_WORKERS


def run_two_stage_gate(
    load_persona: Callable[[], dict[str, Any]],
    anchors: list[Path],
    images: list[dict[str, Any]],
    out_dir: Path,
    *,
    skip_judge: bool = False,
    workers: int = DEFAULT_GATE_WORKERS,
    model: str | None = None,
) -> dict[str, Any]:
    """The one fail-closed two-stage gate composition EVERY caller of this module uses
    to gate a set of images against a persona's identity references -- extracted so
    `figment_train.py build_grade` (a plan-driven grading stage, via its own
    `_run_identity_gate`, which now just resolves plan-specific persona/anchors/images
    and delegates here) and this module's own plan-independent `run` CLI (`run_gate`,
    for a bake-off run dir, a batch folder, or any other ad hoc image set) gate
    identically and produce the exact same `figment/gate@1` schema that
    `expand/bakeoff/summarize.py` already consumes. No behaviour change for
    `build_grade`'s own tests -- this is the same body `_run_identity_gate` used to run
    inline, moved here verbatim.

    `load_persona` is a zero-arg thunk, not an already-resolved persona dict, so a
    persona-resolution failure (a malformed plan, a missing persona.yaml) is caught by
    the SAME outage handling below as a scorer/judge failure: the whole gate still
    produces a document, every cell explicitly FAILED closed, never silently promoted
    to pass or omitted (see the module docstring's "Unlike score_cells.score" note).

    `model`, when given, is forwarded to the stage-2 judge call
    (`vlm_judge.judge_images_for_stage`'s own `model=` kwarg); left unset, that
    function's own default model is used unchanged -- `build_grade`'s callers never
    pass this, so their behaviour is identical to before this function existed."""
    anchors_by_stem = {path.stem: path for path in anchors}
    # REVIEW-2026-09-07 finding #5: judge rows are keyed by image_id = path.stem, but
    # `_resolve_images` de-duplicates by PATH, not stem -- a shared stem across two
    # shard dirs (or two extensions of the same stem) would collapse in `judge_by_id`
    # and silently gate the second cell on the FIRST cell's judgement.
    # `apply_rulings` already rejects duplicate ids; this is the setup-error class the
    # gate itself must refuse fast on too (see this function's own docstring, "setup
    # errors the CLI should refuse fast on"), not paper over with a fail-closed doc.
    ids = [image["image_id"] for image in images]
    if len(set(ids)) != len(ids):
        raise IdentityGateError(
            f"duplicate image_id in the gate image set: "
            f"{sorted(set(i for i in ids if ids.count(i) > 1))}"
        )
    own_anchor = anchors[0].stem if anchors else None
    thresholds: dict[str, Any] = {}
    judge_thresholds: dict[str, Any] = {}
    judge_by_id: dict[str, dict[str, Any] | None] = {}
    outage: str | None = None
    try:
        persona = load_persona()
        thresholds = load_thresholds(persona)
        judge_thresholds = load_judge_thresholds()
        rows = score_cells_for_stage(images, anchors_by_stem, own_anchor=own_anchor)
        stage1_list = [identity_floor_gate(row, thresholds) for row in rows]

        if skip_judge:
            # Never even LOAD the judge module under --skip-judge (offline/test use
            # only) -- a stage-1-passing cell still fails overall, exactly the same
            # "unavailable: judge" verdict `two_stage_gate` would give a cell whose
            # judge call genuinely produced nothing, just without spending one.
            verdicts = [
                {
                    "pass": False,
                    "reasons": list(stage1["reasons"]) + ([] if not stage1["pass"] else ["unavailable: judge"]),
                    "stage1": stage1,
                    "stage2": None,
                }
                for stage1 in stage1_list
            ]
        else:
            to_judge = [image for image, verdict in zip(images, stage1_list) if verdict["pass"]]
            if to_judge and anchors:
                judge_module = _vlm_judge_module()
                judge_kwargs: dict[str, Any] = {"cache_dir": Path(out_dir) / "judge-cache", "workers": workers}
                if model is not None:
                    judge_kwargs["model"] = model
                judge_rows = judge_module.judge_images_for_stage(to_judge, anchors, **judge_kwargs)
                judge_by_id = {row["image_id"]: row for row in judge_rows}
            verdicts = [
                two_stage_gate(row, judge_by_id.get(row["image_id"]), thresholds, judge_thresholds)
                for row in rows
            ]
    except Exception as exc:
        outage = f"{type(exc).__name__}: {exc}"
        reason = f"unavailable: gate could not run ({outage})"
        rows = [{"image_id": row["image_id"]} for row in images]
        verdicts = [
            {"pass": False, "reasons": [reason], "stage1": None, "stage2": None} for _ in rows
        ]

    result_rows = []
    for row, verdict in zip(rows, verdicts):
        merged = dict(row)
        merged["pass"] = verdict["pass"]
        merged["reasons"] = verdict["reasons"]
        merged["stage1"] = verdict.get("stage1")
        merged["stage2"] = verdict.get("stage2")
        merged["judge"] = judge_by_id.get(row["image_id"])
        result_rows.append(merged)

    return {
        "schema": "figment/gate@1",
        "own_anchor": own_anchor,
        "thresholds": thresholds,
        "judge_thresholds": judge_thresholds,
        "judge_skipped": skip_judge,
        "outage": outage,
        "rows": result_rows,
        "summary": {
            "total": len(result_rows),
            "passed": sum(1 for row in result_rows if row["pass"]),
            "failed": sum(1 for row in result_rows if not row["pass"]),
        },
    }


def two_stage_gate(
    scores: dict[str, Any],
    judge_scores: dict[str, Any] | None,
    thresholds: dict[str, Any],
    judge_thresholds: dict[str, Any],
) -> dict[str, Any]:
    """The gate a real grading run uses: stage 1 (`identity_floor_gate`) short-circuits
    stage 2 -- a cell that is already a gross identity miss (or has no usable face at
    all) never spends a judge call, so `judge_scores` may legitimately be `None` when
    `stage1["pass"]` is `False` (never scored) as well as when it genuinely could not be
    read (`vlm_judge.judge_image`'s own fail-closed contract) -- both cases short-circuit
    identically here; the caller (`figment_train.py`'s `_run_identity_gate`) is the one
    place that distinguishes "never attempted" from "attempted and failed" for the
    board's own display.

    Overall `pass` requires BOTH stages; `reasons` concatenates stage 1's then stage 2's
    (empty list when stage 2 never ran). The full stage breakdown is preserved under
    `stage1`/`stage2` (`stage2` is `None` when short-circuited) so `gate.json` rows carry
    both, per the build brief."""
    stage1 = identity_floor_gate(scores, thresholds)
    if not stage1["pass"]:
        return {"pass": False, "reasons": list(stage1["reasons"]), "stage1": stage1, "stage2": None}
    judge_module = _vlm_judge_module()
    stage2 = judge_module.judge_gate(judge_scores, judge_thresholds)
    return {
        "pass": stage2["pass"],
        "reasons": list(stage1["reasons"]) + list(stage2["reasons"]),
        "stage1": stage1,
        "stage2": stage2,
    }


# ---------------------------------------------------------------------------
# Pinned, sha256-verified, safetensors-only age classifier
# ---------------------------------------------------------------------------


def _model_cache_root() -> Path:
    override = os.environ.get(AGE_MODEL_CACHE_ENV)
    if override:
        return Path(override)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise IdentityGateError(
            "LOCALAPPDATA is not set and no KB_FIGMENT_MODEL_CACHE override was given; "
            "cannot resolve the model cache directory"
        )
    return Path(local_app_data) / "kb-figment-models"


def _age_model_dir() -> Path:
    return _model_cache_root() / "dima806-facial_age_image_detection" / AGE_MODEL_REVISION


def _hf_resolve_url(repo: str, revision: str, filename: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/{revision}/{filename}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N802
        return None


def _fetch_x_linked_etag(url: str) -> str | None:
    """HEAD `url` (never following the CDN redirect) and return its `X-Linked-ETag`
    header -- the LFS blob's sha256 -- stripped of surrounding quotes. `None` when the
    header is absent (a non-LFS file, or a proxy that drops it); callers decide whether
    that is fatal."""
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, method="HEAD")
    try:
        response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as exc:
        response = exc
    header = response.headers.get("X-Linked-ETag")
    return header.strip('"') if header else None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    os.replace(temporary, destination)


def ensure_age_model() -> Path:
    """Resolve the pinned, sha256-verified, safetensors-only age classifier snapshot,
    downloading it into the local model cache (`%LOCALAPPDATA%/kb-figment-models`, or
    `$KB_FIGMENT_MODEL_CACHE` when set) on first use. Returns the snapshot directory.

    Fail-closed -- raises `IdentityGateError` rather than falling back to any other
    file or revision -- when:
      * the pinned weight filename is not `*.safetensors` (a defensive check on the
        module constant itself; guards against a future pin ever pointing at a
        pickle, per r22 §6's MiVOLO/PerceptCLIP rejections),
      * a fresh download's live `X-Linked-ETag` does not match the pinned
        `AGE_MODEL_WEIGHT_SHA256` (the upstream file changed since the pin was
        recorded) -- checked BEFORE any bytes are downloaded,
      * the sha256 of the bytes actually on disk does not match the pin -- checked on
        EVERY call, cached copy included, so a cache corrupted or tampered with after
        the fact is also caught, not only a fresh download.
    """
    if not AGE_MODEL_WEIGHT_FILENAME.endswith(".safetensors"):  # pragma: no cover
        raise IdentityGateError(
            f"pinned age-model weight file {AGE_MODEL_WEIGHT_FILENAME!r} is not "
            ".safetensors -- refusing a pickle weight file"
        )
    snapshot = _age_model_dir()
    weight_path = snapshot / AGE_MODEL_WEIGHT_FILENAME
    if not weight_path.is_file():
        url = _hf_resolve_url(AGE_MODEL_REPO, AGE_MODEL_REVISION, AGE_MODEL_WEIGHT_FILENAME)
        etag = _fetch_x_linked_etag(url)
        if etag != AGE_MODEL_WEIGHT_SHA256:
            raise IdentityGateError(
                "age model weight file changed upstream (or the network/proxy dropped "
                f"X-Linked-ETag): expected sha256 {AGE_MODEL_WEIGHT_SHA256}, "
                f"Hugging Face reports {etag!r}; refusing to download an unverified file"
            )
        _download(url, weight_path)
        for filename in AGE_MODEL_AUX_FILES:
            _download(_hf_resolve_url(AGE_MODEL_REPO, AGE_MODEL_REVISION, filename), snapshot / filename)
    actual = _sha256_file(weight_path)
    if actual != AGE_MODEL_WEIGHT_SHA256:
        raise IdentityGateError(
            "age model weight file on disk does not match the pinned sha256 (expected "
            f"{AGE_MODEL_WEIGHT_SHA256}, got {actual}) -- refusing to load a corrupted "
            f"or tampered file at {weight_path}"
        )
    return snapshot


# ---------------------------------------------------------------------------
# Real models -- lazily constructed once, reused across every score_cell call in a
# process. Tests never touch this class directly; they inject a fake via score_cell's
# own `models=` parameter instead.
# ---------------------------------------------------------------------------


class GateModels:
    """Owns every heavy model `score_cell` needs. Constructing one is expensive
    (FaceNet/MTCNN weights, the age classifier); build one and reuse it across a whole
    grading/calibration run rather than one per image."""

    def __init__(self) -> None:
        self._identity_module = None
        self._face_embedder = None
        self._age_processor = None
        self._age_model = None

    def _identity(self):
        if self._identity_module is None:
            self._identity_module = _identity_module()
        return self._identity_module

    def _face(self):
        if self._face_embedder is None:
            self._face_embedder = self._identity().FaceNetEmbedder()
        return self._face_embedder

    def embed(self, path: Path) -> list[float]:
        identity = self._identity()
        return identity.vector(self._face()(Path(path)))

    def detect(self, path: Path) -> dict[str, Any] | None:
        """The highest-confidence MTCNN detection on `path`: `{"box": (x1,y1,x2,y2),
        "prob": float, "crop": numpy RGB array}`, or `None` when no face is found."""
        from PIL import Image

        face = self._face()
        with Image.open(Path(path)) as image:
            rgb = image.convert("RGB")
            boxes, probabilities = face.detector.detect(rgb)
            if boxes is None or len(boxes) == 0:
                return None
            array = np.array(rgb)
            index = int(np.argmax(probabilities))
            x1, y1, x2, y2 = (int(round(value)) for value in boxes[index])
            x1, y1 = max(x1, 0), max(y1, 0)
            x2, y2 = min(x2, array.shape[1]), min(y2, array.shape[0])
            if x2 <= x1 or y2 <= y1:
                return None
            return {
                "box": (x1, y1, x2, y2),
                "prob": float(probabilities[index]),
                "crop": array[y1:y2, x1:x2],
            }

    def _age(self):
        if self._age_model is None:
            from transformers import AutoImageProcessor, AutoModelForImageClassification

            snapshot = ensure_age_model()
            self._age_processor = AutoImageProcessor.from_pretrained(snapshot, use_safetensors=True)
            self._age_model = AutoModelForImageClassification.from_pretrained(
                snapshot, use_safetensors=True,
            )
        return self._age_processor, self._age_model

    def predict_age(self, path: Path) -> float:
        """Expected age in years: softmax-weighted mean over the classifier's label
        buckets, reusing `score_cells.py`'s own `_bucket_midpoint` bucket-label parser
        (never forked -- see module docstring) so both scorers agree on what a label
        like `"21-25"` or `"90+"` means."""
        from PIL import Image
        import torch

        bucket_midpoint = _score_cells_module()._bucket_midpoint
        processor, model = self._age()
        with Image.open(Path(path)) as image:
            inputs = processor(images=image.convert("RGB"), return_tensors="pt")
        with torch.no_grad():
            logits = model(**inputs).logits
        probabilities = logits.softmax(dim=-1)[0].tolist()
        labels = [model.config.id2label[i] for i in range(len(probabilities))]
        return sum(
            bucket_midpoint(label) * probability for label, probability in zip(labels, probabilities)
        )


_DEFAULT_MODELS: GateModels | None = None


def _default_models() -> GateModels:
    global _DEFAULT_MODELS
    if _DEFAULT_MODELS is None:
        _DEFAULT_MODELS = GateModels()
    return _DEFAULT_MODELS


# ---------------------------------------------------------------------------
# Realism: NIQE (standalone reimplementation), face-crop Laplacian variance, gloss proxy
# ---------------------------------------------------------------------------


def _luma(rgb: np.ndarray) -> np.ndarray:
    """Rec. 601 luma -- the same weights `identity_check.compute_raw_metrics` and PIL's
    own "L" conversion use, kept consistent across every metric in this pipeline."""
    array = np.asarray(rgb, dtype=np.float64)
    if array.ndim == 2:
        return array
    return 0.299 * array[..., 0] + 0.587 * array[..., 1] + 0.114 * array[..., 2]


def _gaussian_kernel_1d(radius: int = 3, sigma: float = 7.0 / 6.0) -> np.ndarray:
    axis = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-(axis ** 2) / (2.0 * sigma * sigma))
    return kernel / kernel.sum()


def _separable_blur(gray: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """A 2D Gaussian blur via two 1D passes, edge-padded, written with the same
    shifted-slice-and-sum style `identity_check.compute_raw_metrics` uses for its
    Laplacian convolution -- numpy only, no scipy dependency."""
    radius = len(kernel) // 2

    def _pass(a: np.ndarray) -> np.ndarray:
        padded = np.pad(a, ((0, 0), (radius, radius)), mode="reflect")
        out = np.zeros_like(a)
        for offset, weight in enumerate(kernel):
            out += weight * padded[:, offset:offset + a.shape[1]]
        return out

    return _pass(_pass(gray.T).T)


def _mscn(gray: np.ndarray) -> np.ndarray:
    """Mean-subtracted contrast-normalized coefficients (Mittal et al. 2013, eq. 1-2):
    `(I - mu) / (sigma + 1)`, `mu`/`sigma` a local Gaussian-weighted mean/std."""
    kernel = _gaussian_kernel_1d()
    mu = _separable_blur(gray, kernel)
    mu_sq = _separable_blur(gray * gray, kernel)
    variance = np.maximum(mu_sq - mu * mu, 0.0)
    sigma = np.sqrt(variance)
    return (gray - mu) / (sigma + 1.0)


_GGD_GAMMA_RANGE = np.arange(0.2, 10.001, 0.01)
_GGD_GAMMA_FUNC = np.array([math.gamma(value) for value in np.concatenate(
    [1.0 / _GGD_GAMMA_RANGE, 2.0 / _GGD_GAMMA_RANGE, 3.0 / _GGD_GAMMA_RANGE],
)]).reshape(3, -1)
_EPS = 1e-12


def _fit_ggd(values: np.ndarray) -> tuple[float, float]:
    """Generalized Gaussian shape/variance fit (Sharifi & Leon-Garcia moment-matching
    estimator, as used by Mittal et al.'s reference NIQE/BRISQUE code): returns
    `(alpha, sigma)`."""
    sigma_sq = float(np.mean(values ** 2))
    mean_abs = float(np.mean(np.abs(values)))
    rho = sigma_sq / (mean_abs ** 2 + _EPS)
    gamma1, gamma2, gamma3 = _GGD_GAMMA_FUNC
    ratio_table = (gamma1 * gamma3) / (gamma2 ** 2)
    alpha = float(_GGD_GAMMA_RANGE[int(np.argmin(np.abs(ratio_table - rho)))])
    return alpha, math.sqrt(sigma_sq)


def _fit_aggd(values: np.ndarray) -> tuple[float, float, float, float]:
    """Asymmetric generalized Gaussian fit for a pairwise-product map (Mittal et al.
    2013, eq. 4-7 / the companion BRISQUE paper's AGGD estimator): returns
    `(alpha, left_variance, right_variance, eta)`."""
    left = values[values < 0]
    right = values[values >= 0]
    left_std = math.sqrt(float(np.mean(left ** 2))) if left.size else math.sqrt(_EPS)
    right_std = math.sqrt(float(np.mean(right ** 2))) if right.size else math.sqrt(_EPS)
    gamma_hat = left_std / right_std
    mean_abs_sq = float(np.mean(np.abs(values))) ** 2
    mean_sq = float(np.mean(values ** 2)) + _EPS
    r_hat = mean_abs_sq / mean_sq
    r_correction = (gamma_hat ** 3 + 1.0) * (gamma_hat + 1.0) / ((gamma_hat ** 2 + 1.0) ** 2)
    capital_r_hat = r_hat * r_correction
    gamma1, gamma2, gamma3 = _GGD_GAMMA_FUNC
    ratio_table = (gamma2 ** 2) / (gamma1 * gamma3)
    alpha = float(_GGD_GAMMA_RANGE[int(np.argmin(np.abs(ratio_table - capital_r_hat)))])
    g1 = math.gamma(1.0 / alpha)
    g2 = math.gamma(2.0 / alpha)
    g3 = math.gamma(3.0 / alpha)
    const = math.sqrt(g1 / g3)
    eta = (right_std - left_std) * const * (g2 / g1)
    return alpha, left_std ** 2, right_std ** 2, eta


_NIQE_MIN_BLOCK = 32


def _niqe_block_features(block: np.ndarray) -> np.ndarray | None:
    """The 18-dim per-patch NIQE feature vector: the MSCN map's own GGD fit (2 params)
    plus 4 pairwise-product-direction AGGD fits (4 params each) -- horizontal,
    vertical, main-diagonal, anti-diagonal. Single-scale (see module docstring for the
    documented deviation from the paper's two-scale, 36-dim version). `None` when the
    block is degenerate (a completely flat patch has zero variance in every direction
    and cannot be fit)."""
    mscn = _mscn(block)
    try:
        alpha0, sigma0 = _fit_ggd(mscn)
        features = [alpha0, sigma0 ** 2]
        for shift in ((0, 1), (1, 0), (1, 1), (1, -1)):
            dy, dx = shift
            shifted = np.roll(np.roll(mscn, -dy, axis=0), -dx, axis=1)
            height = mscn.shape[0] - abs(dy)
            width = mscn.shape[1] - abs(dx)
            product = (mscn * shifted)[:height, :width].ravel()
            features.extend(_fit_aggd(product))
    except (ValueError, ZeroDivisionError, FloatingPointError):
        return None
    if not all(math.isfinite(value) for value in features):
        return None
    return np.array(features, dtype=np.float64)


def _niqe_features(gray: np.ndarray, block: int = 96) -> np.ndarray:
    """Every valid block's 18-dim feature vector, stacked -- shape `(n_blocks, 18)`."""
    height, width = gray.shape
    side = min(block, height, width)
    if side < _NIQE_MIN_BLOCK:
        return np.empty((0, 18))
    rows = []
    for y0 in range(0, height - side + 1, side):
        for x0 in range(0, width - side + 1, side):
            patch = gray[y0:y0 + side, x0:x0 + side]
            features = _niqe_block_features(patch)
            if features is not None:
                rows.append(features)
    return np.array(rows) if rows else np.empty((0, 18))


def _fit_mvg(features: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Mean vector + regularized covariance of a stack of NIQE feature vectors. `None`
    when fewer than 2 valid blocks were found (a covariance is undefined)."""
    if features.shape[0] < 2:
        return None
    identity = _identity_module()
    mean = np.array(identity.centroid(features.tolist()))
    covariance = np.cov(features, rowvar=False)
    # Ridge regularization for numerical stability before inversion -- the same
    # practical adjustment the reference MATLAB NIQE implementation applies, needed
    # here because a persona's anchor set is a handful of images, not the paper's
    # 125-image pristine corpus, so the raw covariance is more likely near-singular.
    covariance = covariance + np.eye(covariance.shape[0]) * 1e-6
    return mean, covariance


def fit_pristine_niqe(reference_paths: list[Path]) -> tuple[np.ndarray, np.ndarray] | None:
    """The "pristine" multivariate Gaussian NIQE compares every candidate against,
    fit from `reference_paths` (a persona's own real anchor photographs -- see module
    docstring for why). `None` when fewer than two references embed into any valid
    NIQE block (too few/too-small images to fit a covariance)."""
    from PIL import Image

    all_features = []
    for path in reference_paths:
        try:
            with Image.open(Path(path)) as image:
                gray = _luma(np.array(image.convert("RGB")))
            features = _niqe_features(gray)
        except Exception:
            continue
        if features.shape[0]:
            all_features.append(features)
    if not all_features:
        return None
    stacked = np.concatenate(all_features, axis=0)
    return _fit_mvg(stacked)


def compute_niqe(
    image_rgb: np.ndarray, pristine: tuple[np.ndarray, np.ndarray],
) -> float | None:
    """NIQE distance of `image_rgb` against a `(mean, covariance)` pristine model from
    `fit_pristine_niqe`: `sqrt((mu1-mu2)^T ((cov1+cov2)/2)^-1 (mu1-mu2))` (Mittal et al.
    2013, eq. 9). `None` when the image is too small/flat to fit its own NIQE model."""
    gray = _luma(image_rgb)
    candidate = _fit_mvg(_niqe_features(gray))
    if candidate is None:
        return None
    mean1, cov1 = candidate
    mean2, cov2 = pristine
    if mean1.shape != mean2.shape:  # pragma: no cover - defensive, fixed feature width
        return None
    covariance = (cov1 + cov2) / 2.0
    try:
        inverse = np.linalg.inv(covariance)
    except np.linalg.LinAlgError:
        inverse = np.linalg.pinv(covariance)
    delta = mean1 - mean2
    distance_sq = float(delta @ inverse @ delta)
    return math.sqrt(max(distance_sq, 0.0))


# --- gloss proxy --------------------------------------------------------------------

_GLOSS_LUMA_THRESHOLD = 235.0


def _gloss_proxy(crop_rgb: np.ndarray) -> float | None:
    """Fraction of near-saturated luminance pixels within a classic YCbCr skin-tone
    band (Chai & Ngan 1999: Cb in [77,127], Cr in [133,173]) inside `crop_rgb`. This is
    a documented PROXY for specular skin highlights, not a learned skin-segmentation
    model -- it will over- or under-count on unusual lighting/skin tones, and is scored
    and calibrated as such (see calibrate's honesty notes on separability). `None` when
    no skin-toned pixel is found in the crop at all (an unusable crop for this metric,
    not a gloss value of zero)."""
    array = np.asarray(crop_rgb, dtype=np.float64)
    if array.ndim != 3 or array.shape[2] < 3 or array.shape[0] < 1 or array.shape[1] < 1:
        return None
    r, g, b = array[..., 0], array[..., 1], array[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b
    skin_mask = (cb >= 77) & (cb <= 127) & (cr >= 133) & (cr <= 173)
    skin_count = int(np.sum(skin_mask))
    if skin_count == 0:
        return None
    bright_skin = int(np.sum(skin_mask & (y >= _GLOSS_LUMA_THRESHOLD)))
    return bright_skin / skin_count


# ---------------------------------------------------------------------------
# score_cell -- the per-image contract function
# ---------------------------------------------------------------------------


def score_cell(
    image: str | Path,
    anchors: dict[str, str | Path],
    *,
    own_anchor: str | None = None,
    models: GateModels | None = None,
    anchor_embeddings: dict[str, list[float] | None] | None = None,
    anchor_ages: dict[str, float | None] | None = None,
    pristine_niqe: tuple[np.ndarray, np.ndarray] | None = None,
) -> dict[str, Any]:
    """Score one cell against `anchors` (a `{stem: path}` mapping). Never raises --
    every metric that could not be computed is `None` with a paired
    `unavailable[<metric>]` reason, so `gate()` fails closed on it rather than this
    function crashing the whole grading run.

    `anchor_embeddings`/`anchor_ages` let a caller (`calibrate`, `figment_train.py`'s
    per-stage gate wiring) precompute each anchor's embedding/age ONCE and reuse it
    across every cell in a run, instead of re-running the anchor through both models
    for every single candidate image -- `score_cell` recomputes them itself only when
    they are not supplied, so a single ad hoc call (tests, the CLI) stays simple.
    """
    models = models or _default_models()
    image = Path(image)
    result: dict[str, Any] = {
        "image_id": image.stem,
        "identity_own": None, "identity_max": None, "identity_mean": None,
        "identity_per_anchor": {},
        "face_px": None,
        "age_value": None, "age_anchor": None, "age_delta": None,
        "niqe": None, "laplacian_variance": None, "gloss": None,
        "unavailable": {},
    }
    identity = _identity_module()

    try:
        detection = models.detect(image)
    except Exception as exc:
        detection = None
        result["unavailable"]["face_detection"] = f"{type(exc).__name__}: {exc}"

    if detection is None:
        reason = result["unavailable"].get("face_detection", "no face detected")
        for metric in (
            "identity_own", "identity_max", "identity_mean", "face_px",
            "age_value", "age_delta", "niqe", "laplacian_variance", "gloss",
        ):
            result["unavailable"].setdefault(metric, reason)
        return result

    box = detection["box"]
    result["face_px"] = min(box[2] - box[0], box[3] - box[1])
    crop = detection["crop"]

    # --- identity ---------------------------------------------------------------
    try:
        own_vector = models.embed(image)
        per_anchor: dict[str, float | None] = {}
        for stem, anchor_path in anchors.items():
            try:
                anchor_vector = (
                    anchor_embeddings.get(stem) if anchor_embeddings is not None else None
                )
                if anchor_vector is None:
                    anchor_vector = models.embed(Path(anchor_path))
                per_anchor[stem] = identity.cosine(anchor_vector, own_vector)
            except Exception:
                per_anchor[stem] = None
        result["identity_per_anchor"] = per_anchor
        valid = [value for value in per_anchor.values() if value is not None]
        result["identity_max"] = max(valid) if valid else None
        result["identity_mean"] = statistics.fmean(valid) if valid else None
        if own_anchor is not None:
            result["identity_own"] = per_anchor.get(own_anchor)
        if result["identity_max"] is None:
            result["unavailable"]["identity_max"] = "no anchor embedded cleanly"
        if result["identity_mean"] is None:
            result["unavailable"]["identity_mean"] = "no anchor embedded cleanly"
        if result["identity_own"] is None:
            result["unavailable"]["identity_own"] = (
                "no own_anchor given" if own_anchor is None else f"unavailable: identity vs {own_anchor}"
            )
    except Exception as exc:
        reason = f"{type(exc).__name__}: {exc}"
        result["unavailable"]["identity_own"] = reason
        result["unavailable"]["identity_max"] = reason
        result["unavailable"]["identity_mean"] = reason

    # --- age ----------------------------------------------------------------------
    try:
        candidate_age = models.predict_age(image)
        result["age_value"] = candidate_age
        ages: list[float] = []
        for stem, anchor_path in anchors.items():
            cached = anchor_ages.get(stem) if anchor_ages is not None else None
            if cached is not None:
                ages.append(cached)
                continue
            try:
                ages.append(models.predict_age(Path(anchor_path)))
            except Exception:
                continue
        if ages:
            result["age_anchor"] = statistics.fmean(ages)
            result["age_delta"] = candidate_age - result["age_anchor"]
        else:
            result["unavailable"]["age_delta"] = "no anchor age could be computed"
    except Exception as exc:
        reason = f"{type(exc).__name__}: {exc}"
        result["unavailable"]["age_value"] = reason
        result["unavailable"]["age_delta"] = reason

    # --- realism: face-crop Laplacian variance -------------------------------------
    try:
        raw = identity.compute_raw_metrics(crop)
        if raw["unavailable_reason"]:
            result["unavailable"]["laplacian_variance"] = raw["unavailable_reason"]
        else:
            result["laplacian_variance"] = raw["laplacian_variance"]
    except Exception as exc:
        result["unavailable"]["laplacian_variance"] = f"{type(exc).__name__}: {exc}"

    # --- realism: gloss proxy -------------------------------------------------------
    try:
        gloss = _gloss_proxy(crop)
        result["gloss"] = gloss
        if gloss is None:
            result["unavailable"]["gloss"] = "no skin-toned pixels detected in face crop"
    except Exception as exc:
        result["unavailable"]["gloss"] = f"{type(exc).__name__}: {exc}"

    # --- realism: NIQE ---------------------------------------------------------------
    if pristine_niqe is None:
        result["unavailable"]["niqe"] = "no pristine NIQE reference model supplied"
    else:
        try:
            from PIL import Image

            with Image.open(image) as pil_image:
                rgb_array = np.array(pil_image.convert("RGB"))
            niqe_value = compute_niqe(rgb_array, pristine_niqe)
            result["niqe"] = niqe_value
            if niqe_value is None:
                result["unavailable"]["niqe"] = "image too small/flat to fit a NIQE model"
        except Exception as exc:
            result["unavailable"]["niqe"] = f"{type(exc).__name__}: {exc}"

    return result


def score_cells_for_stage(
    images: list[dict[str, Any]],
    anchors: dict[str, Path],
    *,
    own_anchor: str | None,
    models: GateModels | None = None,
) -> list[dict[str, Any]]:
    """Score every one of `images` (`{"image_id":..., "path":...}` rows, matching
    `score_cells.score`'s own row shape) against `anchors`, precomputing each anchor's
    embedding and predicted age exactly once and a shared NIQE pristine model exactly
    once, then reusing them across every cell -- the efficient batch path
    `figment_train.py`'s `build_grade` and this module's own `calibrate` both use, on
    top of the single-image `score_cell` contract. Never raises: a totally unexpected
    failure on one image degrades that image's row to `unavailable` reasons, exactly
    like `score_cell` itself, rather than aborting the whole stage."""
    models = models or _default_models()
    anchor_embeddings: dict[str, list[float] | None] = {}
    anchor_ages: dict[str, float | None] = {}
    for stem, path in anchors.items():
        try:
            anchor_embeddings[stem] = models.embed(Path(path))
        except Exception:
            anchor_embeddings[stem] = None
        try:
            anchor_ages[stem] = models.predict_age(Path(path))
        except Exception:
            anchor_ages[stem] = None
    pristine = fit_pristine_niqe(list(anchors.values()))

    rows = []
    for item in images:
        try:
            row = score_cell(
                item["path"], anchors, own_anchor=own_anchor, models=models,
                anchor_embeddings=anchor_embeddings, anchor_ages=anchor_ages,
                pristine_niqe=pristine,
            )
        except Exception as exc:  # pragma: no cover - score_cell itself never raises
            row = {"image_id": item.get("image_id", Path(item["path"]).stem), "unavailable": {
                metric: f"{type(exc).__name__}: {exc}" for metric in GATE_METRICS
            }}
        row["image_id"] = item.get("image_id", row["image_id"])
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# calibrate -- propose thresholds from real evidence sets
# ---------------------------------------------------------------------------

_DISTRIBUTION_METRICS = (
    "identity_own", "identity_max", "age_value", "age_delta", "gloss", "niqe",
    "laplacian_variance", "face_px",
)


def _distribution(values: list[float]) -> dict[str, float | int | None]:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    if not clean:
        return {"n": 0, "min": None, "p5": None, "median": None, "p95": None, "max": None}
    ordered = sorted(clean)
    return {
        "n": len(clean),
        "min": ordered[0],
        "p5": float(np.percentile(ordered, 5)),
        "median": float(statistics.median(ordered)),
        "p95": float(np.percentile(ordered, 95)),
        "max": ordered[-1],
    }


def _images_in(directory: Path) -> list[Path]:
    directory = Path(directory)
    if not directory.is_dir():
        return []
    return sorted(
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def _resolve_images(patterns: list[str]) -> list[Path]:
    """Every image named by `patterns` -- each entry is either an existing directory
    (every image file directly inside it, via `_images_in`) or a glob pattern (e.g.
    `*.png`, `some/dir/**/*.jpg`) -- de-duplicated by resolved path while preserving
    first-seen order across patterns. Mirrors `vlm_judge.py`'s own `_resolve_images`
    (that module keeps its own copy local rather than importing this one, to avoid any
    import-cycle risk now that this module imports vlm_judge.py for stage 2 -- see its
    docstring); `identity_gate.py run` needs the exact same dir-or-glob resolution
    without ever loading the judge module when `--skip-judge` is given, so it is kept
    local here too rather than reaching into vlm_judge.py for it."""
    resolved: list[Path] = []
    for pattern in patterns:
        path = Path(pattern)
        if path.is_dir():
            resolved.extend(_images_in(path))
            continue
        matches = sorted(Path(p) for p in glob_module.glob(pattern, recursive=True))
        resolved.extend(
            p for p in matches if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
        )
    seen: set[Path] = set()
    ordered: list[Path] = []
    for path in resolved:
        key = path.resolve()
        if key not in seen:
            seen.add(key)
            ordered.append(path)
    return ordered


def _anchor_pairwise_from_persona(persona: dict[str, Any]) -> dict[str, float] | None:
    """Reuse `identity_check.calibrate_anchors`'s already-written
    `identity.calibration.anchor_pairwise` when a persona has one (every reference
    scored pairwise against every other, computed once by that command) rather than
    re-embedding the same anchors a second time here."""
    try:
        pairwise = persona["identity"]["calibration"]["anchor_pairwise"]
    except (KeyError, TypeError):
        return None
    if isinstance(pairwise, dict) and pairwise:
        return {key: float(value) for key, value in pairwise.items()}
    return None


def _propose_identity_floor(
    anchor_pairwise: dict[str, float], passport_identity: list[float],
) -> tuple[float | None, str]:
    if not anchor_pairwise:
        return None, "no anchor-pairwise identity available; cannot propose a floor"
    anchor_min = min(anchor_pairwise.values())
    if not passport_identity:
        return round(anchor_min - 0.05, 4), (
            "no passport-candidate identity scores available; falling back to "
            "anchor-pairwise-min minus a 0.05 margin (identity_check.py's own "
            "calibrate-anchors convention)"
        )
    passport_max = max(passport_identity)
    if passport_max < anchor_min:
        proposed = round((passport_max + anchor_min) / 2.0, 4)
        return proposed, (
            f"clean separation: every anchor-pair cosine ({anchor_min:.4f} min) exceeds "
            f"every passport candidate's identity ({passport_max:.4f} max); proposed floor "
            "sits at the midpoint"
        )
    return round(anchor_min - 1e-4, 4), (
        f"NO clean separation: at least one passport candidate ({passport_max:.4f}) scores "
        f"at or above the anchors' own pairwise minimum ({anchor_min:.4f}); proposed floor "
        "is set just under anchor_min so the anchors still pass each other, but this floor "
        "will NOT reliably fail every passport candidate -- reported honestly, not hidden"
    )


def _propose_ceiling(
    anchor_values: list[float], other_sets: dict[str, list[float]], *, buffer_factor: float = 1.5,
) -> tuple[float | None, str]:
    """A ceiling proposal generic to gloss/age-delta/NIQE: `buffer_factor` times the
    anchor set's own worst (max) self-consistency value. Reports, per other set,
    whether that set's median sits above the proposed ceiling (a real separation) or
    not (the metric does not separate that set's operator verdict, said honestly)."""
    clean_anchor = [value for value in anchor_values if value is not None and math.isfinite(value)]
    if not clean_anchor:
        return None, "no anchor self-consistency values available; cannot propose a ceiling"
    base = max(clean_anchor)
    proposed = round(base * buffer_factor, 4) if base > 0 else round(base + 0.01, 4)
    notes = [f"anchor self-consistency max {base:.4f} x{buffer_factor} buffer = {proposed:.4f}"]
    for name, values in other_sets.items():
        clean = [value for value in values if value is not None and math.isfinite(value)]
        if not clean:
            notes.append(f"{name}: no values")
            continue
        median = statistics.median(clean)
        separates = median > proposed
        notes.append(
            f"{name} median {median:.4f} {'>' if separates else '<='} proposed ceiling "
            f"({'separates' if separates else 'does NOT separate'})"
        )
    return proposed, "; ".join(notes)


def calibrate(
    persona: dict[str, Any],
    sets: dict[str, Path],
    *,
    own_anchor: str | None = None,
    models: GateModels | None = None,
) -> dict[str, Any]:
    """Score every image in every one of `sets` (name -> directory) against
    `persona.identity.references`, propose gate thresholds from the resulting
    distributions, and report -- honestly -- which metrics do and do not separate the
    sets' operator verdicts. Nothing here is specific to any one persona: `persona` and
    `sets` are both supplied by the caller (see the module docstring and this module's
    `main()` for how the CLI builds them from `--creator`/`--set`)."""
    models = models or _default_models()
    persona_dir = Path(persona["_persona_path"]).resolve().parent if persona.get("_persona_path") else None
    references = persona["identity"]["references"]
    anchors = {
        Path(reference).stem: (persona_dir / reference).resolve() if persona_dir else Path(reference)
        for reference in references
    }
    if own_anchor is None:
        own_anchor = Path(references[0]).stem

    result_sets: dict[str, Any] = {}
    for name, directory in sets.items():
        paths = _images_in(Path(directory))
        images = [{"image_id": path.stem, "path": str(path)} for path in paths]
        rows = score_cells_for_stage(images, anchors, own_anchor=own_anchor, models=models)
        thresholds_preview = load_thresholds(persona)
        for row in rows:
            row["gate"] = gate(row, thresholds_preview)
        distributions = {
            metric: _distribution([row.get(metric) for row in rows])
            for metric in _DISTRIBUTION_METRICS
        }
        result_sets[name] = {
            "n": len(rows),
            "rows": rows,
            "distributions": distributions,
            "pass_count_preview": sum(1 for row in rows if row["gate"]["pass"]),
        }

    anchor_pairwise = _anchor_pairwise_from_persona(persona)
    if anchor_pairwise is None:
        # Fall back to computing it fresh (identity_check.calibrate_anchors's own
        # pairwise logic, reused rather than reimplemented) when persona.yaml carries
        # no prior identity.calibration block.
        identity = _identity_module()
        anchor_pairwise = {}
        try:
            calibration = identity.calibrate_anchors(Path(persona["_persona_path"]), models._face())
            anchor_pairwise = calibration["anchor_pairwise"]
        except Exception:
            anchor_pairwise = {}

    anchors_row_set = result_sets.get("anchors")
    anchor_identity_values = (
        [row.get("identity_own") for row in anchors_row_set["rows"]] if anchors_row_set else []
    )
    anchor_age_delta = (
        [row.get("age_delta") for row in anchors_row_set["rows"]] if anchors_row_set else []
    )
    anchor_gloss = [row.get("gloss") for row in anchors_row_set["rows"]] if anchors_row_set else []
    anchor_niqe = [row.get("niqe") for row in anchors_row_set["rows"]] if anchors_row_set else []

    passport_identity = [
        value for name, data in result_sets.items() if "passport" in name.lower()
        for value in [row.get("identity_own") for row in data["rows"]]
    ]
    other_sets_for_age = {
        name: [row.get("age_delta") for row in data["rows"]]
        for name, data in result_sets.items() if name != "anchors"
    }
    other_sets_for_gloss = {
        name: [row.get("gloss") for row in data["rows"]]
        for name, data in result_sets.items() if name != "anchors"
    }
    other_sets_for_niqe = {
        name: [row.get("niqe") for row in data["rows"]]
        for name, data in result_sets.items() if name != "anchors"
    }

    identity_floor, identity_note = _propose_identity_floor(anchor_pairwise, passport_identity)
    age_ceiling, age_note = _propose_ceiling(
        [v for v in anchor_age_delta if v is not None], other_sets_for_age,
    )
    gloss_ceiling, gloss_note = _propose_ceiling(
        [v for v in anchor_gloss if v is not None], other_sets_for_gloss,
    )
    niqe_ceiling, niqe_note = _propose_ceiling(
        [v for v in anchor_niqe if v is not None], other_sets_for_niqe,
    )
    try:
        face_px_min = persona["identity"]["floor"]["min_face_px"]["value"]
    except (KeyError, TypeError):
        face_px_min = None

    proposed_thresholds = {
        "identity_own_min": identity_floor,
        "age_delta_max_years": age_ceiling,
        "gloss_max": gloss_ceiling,
        "niqe_max": niqe_ceiling,
        "face_px_min": face_px_min,
    }
    separability = {
        "identity_own_min": identity_note,
        "age_delta_max_years": age_note,
        "gloss_max": gloss_note,
        "niqe_max": niqe_note,
        "face_px_min": "carried forward from persona.identity.floor.min_face_px, not "
                       "re-derived from these sets (see gate.yaml)",
    }

    return {
        "schema": "figment/identity-gate-calibration@1",
        "creator": persona.get("id"),
        "own_anchor": own_anchor,
        "anchors": {stem: str(path) for stem, path in anchors.items()},
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "anchor_pairwise_identity": anchor_pairwise,
        "sets": result_sets,
        "proposed_thresholds": proposed_thresholds,
        "separability": separability,
    }


def _render_calibration_md(calibration: dict[str, Any]) -> str:
    lines = [
        f"# identity_gate calibration -- {calibration.get('creator')}",
        "",
        f"generated: {calibration['generated_utc']}",
        f"own anchor: `{calibration['own_anchor']}`",
        "",
        "## Anchor pairwise identity",
        "",
    ]
    for pair, value in calibration["anchor_pairwise_identity"].items():
        lines.append(f"- `{pair}`: {value:.4f}")
    lines += ["", "## Per-set distributions", ""]
    for name, data in calibration["sets"].items():
        lines.append(f"### {name} (n={data['n']}, pass under gate.yaml preview: {data['pass_count_preview']})")
        lines.append("")
        lines.append("| metric | n | min | p5 | median | p95 | max |")
        lines.append("|---|---|---|---|---|---|---|")
        for metric, dist in data["distributions"].items():
            def _fmt(value):
                return f"{value:.4f}" if isinstance(value, float) else ("n/a" if value is None else str(value))
            lines.append(
                f"| {metric} | {dist['n']} | {_fmt(dist['min'])} | {_fmt(dist['p5'])} | "
                f"{_fmt(dist['median'])} | {_fmt(dist['p95'])} | {_fmt(dist['max'])} |"
            )
        lines.append("")
    lines += ["## Proposed thresholds", ""]
    for key, value in calibration["proposed_thresholds"].items():
        lines.append(f"- `{key}`: {value}")
        lines.append(f"  - separability: {calibration['separability'][key]}")
    return "\n".join(lines) + "\n"


def run_calibrate(
    creator_id: str, sets: dict[str, Path], out: Path, *, personas_root: Path,
) -> dict[str, str]:
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    # yaml.safe_load, not json.loads (REVIEW-2026-09-07 finding #12, nit): persona.yaml
    # is YAML -- json.loads only worked because today's personas happen to be
    # JSON-formatted, same as training_config.load_persona_with_training already reads
    # it. JSON is a YAML subset, so this is not a behaviour change for existing files.
    persona = yaml.safe_load(persona_path.read_text(encoding="utf-8"))
    persona["_persona_path"] = str(persona_path)
    calibration = calibrate(persona, sets)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / "calibration.json"
    md_path = out / "calibration.md"
    json_path.write_text(json.dumps(calibration, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(_render_calibration_md(calibration), encoding="utf-8")
    return {"json": str(json_path), "md": str(md_path)}


# ---------------------------------------------------------------------------
# run -- gate ANY image set (a bake-off run dir, a batch folder, an arbitrary glob)
# against one persona, exactly the way `figment_train.py build_grade` gates one
# plan-driven stage.
# ---------------------------------------------------------------------------


def run_gate(
    creator_id: str,
    image_patterns: list[str],
    out: Path,
    *,
    personas_root: Path,
    skip_judge: bool = False,
    workers: int = DEFAULT_GATE_WORKERS,
    model: str | None = None,
) -> dict[str, Any]:
    """Plan-independent front door onto `run_two_stage_gate` -- the SAME composition
    `figment_train.py build_grade`'s own `_run_identity_gate` delegates to -- so a
    bake-off run dir, a batch folder, or any other ad hoc image set gets gated exactly
    the way a plan-driven grading stage does, and the `gate.json` written here is
    byte-for-byte the same `figment/gate@1` schema `expand/bakeoff/summarize.py`
    already consumes.

    `--creator` resolves `<personas_root>/<creator_id>/persona.yaml` for its own
    identity references (`identity.references`, in that file's own order -- the first
    entry is the "own" anchor, same convention `calibrate`/`build_grade` both use),
    exactly like every other CLI in this pipeline (`vlm_judge.py run`, this module's
    own `calibrate`) -- never hardcoded to one creator. `image_patterns` is one or more
    directories and/or glob patterns, resolved and de-duplicated by `_resolve_images`.

    Raises `IdentityGateError` for a missing persona or an empty image resolution --
    both are setup errors the CLI should refuse fast on, unlike a scorer/judge failure
    AFTER a persona and an image set are in hand, which `run_two_stage_gate` itself
    still turns into a fail-closed `gate.json` rather than raising."""
    persona_path = Path(personas_root) / creator_id / "persona.yaml"
    if not persona_path.is_file():
        raise IdentityGateError(f"persona not found: {persona_path}")
    # yaml.safe_load, not json.loads (REVIEW-2026-09-07 finding #12, nit): persona.yaml
    # is YAML -- json.loads only worked because today's personas happen to be
    # JSON-formatted, same as training_config.load_persona_with_training already reads
    # it. JSON is a YAML subset, so this is not a behaviour change for existing files.
    persona = yaml.safe_load(persona_path.read_text(encoding="utf-8"))
    persona["_persona_path"] = str(persona_path)
    persona_dir = persona_path.parent
    references = persona["identity"]["references"]
    anchors = [(persona_dir / reference).resolve() for reference in references]

    paths = _resolve_images(image_patterns)
    if not paths:
        raise IdentityGateError(f"no images matched {image_patterns!r}")
    images = [{"image_id": path.stem, "path": str(path)} for path in paths]

    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    document = run_two_stage_gate(
        lambda: persona, anchors, images, out,
        skip_judge=skip_judge, workers=workers, model=model,
    )
    gate_path = out / "gate.json"
    gate_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"gate": str(gate_path), "document": document}


def format_gate_table(document: dict[str, Any]) -> str:
    """Render `run_gate`'s own `figment/gate@1` document as a fixed-width pass/fail
    table for this CLI's own audience: stage 1's `identity_own` next to stage 2's own
    `same_person`/`age_delta`/`skin_realism`/`gloss` (the judge's fields -- distinct
    from identity_gate.py's own `age_delta`/`gloss` stage-1 columns, which
    `figment_train.py`'s own `_format_gate_table` already prints for a plan-driven
    stage; this is the ad hoc `run` CLI's own per-image summary, not a duplicate of
    that one)."""
    header = (
        "image_id", "identity_own", "judge_same_person", "age_delta", "skin_realism",
        "gloss", "verdict", "reasons",
    )
    rows: list[tuple[str, ...]] = [header]

    def _fmt(value: Any) -> str:
        return f"{value:.3f}" if isinstance(value, (int, float)) else "n/a"

    for row in document.get("rows", []):
        judge = row.get("judge") or {}
        rows.append((
            str(row.get("image_id")),
            _fmt(row.get("identity_own")),
            _fmt(judge.get("same_person")),
            _fmt(judge.get("age_delta")),
            _fmt(judge.get("skin_realism")),
            _fmt(judge.get("gloss")),
            "PASS" if row.get("pass") else "FAIL",
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


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_set_arg(value: str) -> tuple[str, str]:
    if "=" not in value:
        raise argparse.ArgumentTypeError(f"--set must be NAME=PATH, got {value!r}")
    name, _, path = value.partition("=")
    if not name or not path:
        raise argparse.ArgumentTypeError(f"--set must be NAME=PATH, got {value!r}")
    return name, path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    calibrate_parser = commands.add_parser(
        "calibrate", help="score named evidence sets and propose gate thresholds",
    )
    calibrate_parser.add_argument("--creator", required=True)
    calibrate_parser.add_argument("--out", required=True, type=Path)
    calibrate_parser.add_argument(
        "--personas-root", type=Path,
        default=Path(__file__).resolve().parents[3] / "orgs" / "figment" / "personas",
    )
    calibrate_parser.add_argument(
        "--set", dest="sets", action="append", type=_parse_set_arg, default=[],
        help="NAME=PATH, repeatable; an 'anchors' set is always added automatically "
             "from the persona's own identity.references",
    )

    run_parser = commands.add_parser(
        "run",
        help="gate ANY image set (a bake-off run dir, a batch folder, a glob) against "
             "one persona -- the same fail-closed two-stage gate build_grade uses",
    )
    run_parser.add_argument("--creator", required=True)
    run_parser.add_argument(
        "--images", dest="images", action="append", required=True,
        help="a directory or glob pattern, repeatable",
    )
    run_parser.add_argument("--out", required=True, type=Path)
    run_parser.add_argument("--workers", type=int, default=DEFAULT_GATE_WORKERS)
    run_parser.add_argument(
        "--skip-judge", action="store_true",
        help="omit stage 2 (the vlm_judge.py Claude vision judge) -- offline/test use "
             "only, NEVER pass this on a real grading run",
    )
    run_parser.add_argument(
        "--model", default=None,
        help="stage-2 judge model override (default: vlm_judge.py's own default model)",
    )
    run_parser.add_argument(
        "--personas-root", type=Path,
        default=Path(__file__).resolve().parents[3] / "orgs" / "figment" / "personas",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(list(sys.argv[1:] if argv is None else argv))
    if args.command == "calibrate":
        persona_path = args.personas_root / args.creator / "persona.yaml"
        if not persona_path.is_file():
            print(f"identity-gate error: persona not found: {persona_path}", file=sys.stderr)
            return 2
        # REVIEW-2026-09-07 finding #12 (nit): this used to also `json.loads` the
        # persona and compute an `anchor_sets` dict here -- dead code, never used
        # (run_calibrate below re-resolves the persona itself and never receives
        # anchor_sets as an argument). `persona_dir` needs only the path, not the
        # persona's own content, so the load is gone, not converted to yaml.safe_load.
        persona_dir = persona_path.parent
        sets: dict[str, Path] = {"anchors": persona_dir / "anchors"}
        sets.update({name: Path(path) for name, path in args.sets})
        start = time.time()
        try:
            result = run_calibrate(
                args.creator, sets, args.out, personas_root=args.personas_root,
            )
        except (IdentityGateError, OSError, ValueError) as exc:
            print(f"identity-gate error: {exc}", file=sys.stderr)
            return 2
        elapsed = time.time() - start
        print(f"calibration written: {result['json']}")
        print(f"calibration written: {result['md']}")
        print(f"elapsed: {elapsed:.1f}s")
        return 0
    if args.command == "run":
        start = time.time()
        try:
            result = run_gate(
                args.creator, args.images, args.out, personas_root=args.personas_root,
                skip_judge=args.skip_judge, workers=args.workers, model=args.model,
            )
        except (IdentityGateError, OSError, ValueError) as exc:
            print(f"identity-gate error: {exc}", file=sys.stderr)
            return 2
        elapsed = time.time() - start
        print(format_gate_table(result["document"]))
        print(f"gate written: {result['gate']}")
        print(f"elapsed: {elapsed:.1f}s")
        return 0
    print(f"identity-gate error: unknown command {args.command!r}", file=sys.stderr)  # pragma: no cover
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

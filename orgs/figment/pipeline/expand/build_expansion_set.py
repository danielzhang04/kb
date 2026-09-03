#!/usr/bin/env python3
"""build_expansion_set.py — P2: the deterministic expansion-02 builder
(docs/superpowers/plans/2026-09-03-figment-creator-001-p1.md Task 5;
docs/superpowers/specs/2026-09-03-figment-creator-001-design.md §2.2/S2).

Generates the 60-cell expansion-02 allocation from `persona.grammar`
(`generate_allocation`), turns each cell into a look-spec-clean generation
prompt and a provisional caption sidecar (`build_prompt` / `build_caption`),
and emits six strict, ephemeral-pod manifests built from the verified
`klein4b_multiref_api.json` graph plus the non-graph fields copied verbatim
from `train/runs/creator-001-composite-02.yaml` (`build_manifests`).
`completed_shards` / `missing_shards` support resume; `harvest_runs` proves
provenance (termination, shard identity, output count, allocation hash, cost)
before ever copying a pixel into the tracked batch layout.

CLI: `build` (network-free, byte-reproducible) and `harvest` (validates all
provenance before copying anything). Never modifies a P1 scorer/QA/lifecycle/
gate/persona file — this module only reads `persona.py`'s `load_persona`,
`pod/runpod_run.py`'s manifest helpers, and `expand/batch_state.py`'s
reducer/writer; it is not itself a second writer of any of their state.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent            # .../pipeline/expand
PIPELINE = HERE.parent                             # .../pipeline
POD_RUNNER_PATH = PIPELINE / "pod" / "runpod_run.py"
PERSONA_MODULE_PATH = PIPELINE / "persona.py"
GATES_MODULE_PATH = PIPELINE / "gates.py"
BATCH_STATE_MODULE_PATH = HERE / "batch_state.py"


class ExpansionBuildError(ValueError):
    """The expansion-02 builder/harvester refuses to proceed."""


def _load_module(name: str, path: Path):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise ImportError(f"could not load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _pod():
    return _load_module("figment_expand_pod_runpod_run", POD_RUNNER_PATH)


def _persona_module():
    return _load_module("figment_expand_persona", PERSONA_MODULE_PATH)


def _gates_module():
    return _load_module("figment_expand_gates", GATES_MODULE_PATH)


def _batch_state_module():
    return _load_module("figment_expand_batch_state", BATCH_STATE_MODULE_PATH)


def _atomic_write_json(path: Path, data: Any) -> None:
    """Mirrors `gates.py`/`batch_state.py`'s own atomic-write helper (temp file,
    then `os.replace`) so the allocation table and (in tests) a freshly created
    `batch.json` can never be observed half-written."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Step 5.1 — cell grammar / deterministic allocation
# ---------------------------------------------------------------------------

BATCH_LABEL = "expansion-02"
JOBS_PER_SHARD = 10
SHARD_COUNT = 6

SEED_BASE = 520001
SEED_STEP = 1009


def _seed_for_ordinal(ordinal: int) -> int:
    return SEED_BASE + ordinal * SEED_STEP


def shard_id_for(index: int) -> str:
    """`index` is 1-based (1..SHARD_COUNT)."""
    return f"shard-{index:02d}"


def all_shard_ids(count: int = SHARD_COUNT) -> list[str]:
    return [shard_id_for(i) for i in range(1, count + 1)]


def generate_allocation(persona: dict) -> list[dict]:
    """Deterministically enumerate the 60-cell expansion-02 allocation from
    `persona["grammar"]` (design §2.2, plan Step 5.1). A pure function of the
    persona document alone: the same persona always yields the byte-identical
    allocation, in the fixed angle-major / distance / light traversal order.

    40 primary strata (one cell each, wardrobe rotating by ordinal), then the
    20 replicates — exactly the 20 half-body strata, walked in that same
    order, each re-rendered with a wardrobe family different from its
    stratum's primary (deterministic +1 rotation over the remaining four
    families) and a newly fixed seed.
    """
    grammar = persona["grammar"]
    angles = list(grammar["angles"])
    distances = list(grammar["distances"])
    lights = list(grammar["lights"])
    wardrobe_families = list(grammar["wardrobe_families"])
    n_families = len(wardrobe_families)
    if n_families < 2:
        raise ExpansionBuildError(
            "grammar.wardrobe_families needs at least two families so a "
            "replicate can always differ from its stratum's primary"
        )

    strata: list[dict] = []
    ordinal = 0
    for angle in angles:
        for distance in distances:
            for light in lights:
                ordinal += 1
                wardrobe_family = wardrobe_families[(ordinal - 1) % n_families]
                strata.append({
                    "cell_id": f"exp02-s{ordinal:03d}",
                    "ordinal": ordinal,
                    "is_replicate": False,
                    "angle": angle,
                    "distance": distance,
                    "light": light,
                    "wardrobe_family": wardrobe_family,
                    "stratum_id": f"strat-{ordinal:02d}",
                    "source_stratum_id": None,
                    "seed": _seed_for_ordinal(ordinal),
                })

    half_body_strata = [cell for cell in strata if cell["distance"] == "half"]

    replicates: list[dict] = []
    for rep_index, source in enumerate(half_body_strata, start=1):
        ordinal += 1
        family_index = wardrobe_families.index(source["wardrobe_family"])
        replicate_family = wardrobe_families[(family_index + 1) % n_families]
        replicates.append({
            "cell_id": f"exp02-r{rep_index:03d}",
            "ordinal": ordinal,
            "is_replicate": True,
            "angle": source["angle"],
            "distance": source["distance"],
            "light": source["light"],
            "wardrobe_family": replicate_family,
            "stratum_id": None,
            "source_stratum_id": source["stratum_id"],
            "seed": _seed_for_ordinal(ordinal),
        })

    cells = strata + replicates
    for cell in cells:
        cell["tag"] = (
            f"{cell['angle']}-{cell['distance']}-{cell['light']}-{cell['wardrobe_family']}"
        )
    return cells


def _shard_groups(allocation: list[dict]) -> list[list[dict]]:
    return [
        allocation[i:i + JOBS_PER_SHARD]
        for i in range(0, len(allocation), JOBS_PER_SHARD)
    ]


def completed_shards(batch: dict) -> set[str]:
    """The set of `shard_id`s already recorded in `batch["pod_runs"]`."""
    return {row["shard_id"] for row in batch.get("pod_runs", []) if row.get("shard_id")}


def missing_shards(allocation: list[dict], batch: dict) -> list[str]:
    """The shard ids (in order) not yet present in `batch["pod_runs"]`."""
    groups = _shard_groups(allocation)
    done = completed_shards(batch)
    return [sid for sid in all_shard_ids(len(groups)) if sid not in done]


# ---------------------------------------------------------------------------
# Step 5.2 — prompt and provisional-caption generation
# ---------------------------------------------------------------------------

# look-spec-v2.md §4b positive replacement phrasing / §4c adult-coded phrasing
# (paraphrased where needed to fit each grammar token); nothing here reaches
# into §4a's banned vocabulary — see the module-level NODE_5_NEGATIVE_PROMPT
# for the one static negative-prompt string this builder freezes into node 5.
ANGLE_PHRASES = {
    "front": "facing the camera directly, front-on",
    "three-quarter-l": "turned three-quarters to her own left, a three-quarter angle",
    "three-quarter-r": "turned three-quarters to her own right, a three-quarter angle",
    "profile-l": "turned into full left profile, her face seen from the side",
    "near-back": (
        "mostly turned away from the camera, a near-back view with only the "
        "edge of her face visible over her shoulder"
    ),
}

DISTANCE_PHRASES = {
    "close": "framed close, from the chest up",
    "half": "framed half-body, from the waist up",
}

LIGHT_PHRASES = {
    "flat-white": (
        "even, flat white light with no strong shadow, like daylight through a "
        "bedroom window on an overcast day"
    ),
    "window-day": "late-afternoon daylight through one window, with no other source in the room",
    "lamp-night": (
        "a single lamp across the room as the only light, so one side of her "
        "face falls into shadow and the image is a little noisy"
    ),
    "on-camera-flash": (
        "a direct on-camera phone flash at night, flattening her face and "
        "throwing a hard shadow on the wall behind her"
    ),
}

WARDROBE_PHRASES = {
    "corset-bustier": (
        "a fully opaque, intact corset-style bustier top over her torso, its "
        "boned structure holding its own shape, fabric unbroken and fully "
        "covering, paired with plain bottoms"
    ),
    "cami-chains": (
        "a fully opaque, intact camisole top layered with several thin silver "
        "chain necklaces, the fabric unbroken and fully covering her torso"
    ),
    "oversized-tee": (
        "a fully opaque, intact oversized cotton t-shirt that falls loosely "
        "past her hips, fabric unbroken and fully covering"
    ),
    "knit-cardigan": (
        "a fully opaque, intact knit cardigan buttoned over a plain top "
        "beneath it, fabric unbroken and fully covering"
    ),
    "going-out-mini": (
        "a fully opaque, intact long-sleeved going-out mini dress, fabric "
        "unbroken and fully covering down to mid-thigh"
    ),
}

CAPTION_WARDROBE = {
    "corset-bustier": "a corset-style bustier top",
    "cami-chains": "a camisole top layered with thin silver chains",
    "oversized-tee": "an oversized t-shirt",
    "knit-cardigan": "a buttoned knit cardigan",
    "going-out-mini": "a long-sleeved going-out mini dress",
}


def build_prompt(persona: dict, cell: dict) -> str:
    """One 80-250 word generation prompt per cell (Step 5.2). Every prompt
    states an explicit "adult woman" framing (never a bare pronoun), the
    requested angle and close/half-body distance, an identity-lock clause, one
    wardrobe family as a fully opaque intact outfit, environment, requested
    lighting, mood, phone-camera medium, and cleanup constraints — and
    contains no real name, no sexual/unclothed term, and none of
    look-spec-v2.md §4a's banned phrases in any form.
    """
    angle = ANGLE_PHRASES[cell["angle"]]
    distance = DISTANCE_PHRASES[cell["distance"]]
    light = LIGHT_PHRASES[cell["light"]]
    wardrobe = WARDROBE_PHRASES[cell["wardrobe_family"]]
    return (
        "A candid phone photo of an adult woman in her early twenties, about "
        "twenty-one — a college senior in her last year. Her hands and neck "
        "read the same age as her face, and she has an adult woman's "
        f"proportions and an adult woman's frame. She is {angle}, {distance}. "
        "Keep her identity, face shape, and features exactly as shown in the "
        "reference images; do not alter, blend, or invent any facial feature. "
        f"She is wearing {wardrobe}. The room is her own bedroom. "
        f"Lighting: {light}. She is not performing for the camera: her "
        "expression is relaxed, her shoulders are slouched, and she is "
        "looking slightly past the lens rather than into it. Shot handheld on "
        "a phone camera, straight out of the camera with no edits afterward, "
        "visible skin texture, no beauty filter, no warping, and no added or "
        "removed clothing in cleanup."
    )


def build_caption(persona: dict, cell: dict) -> str:
    """A provisional, explicitly-labelled generation caption (Step 5.2):
    describes visible clothed facts only, never a safety verdict. Later
    training must VLM-recaption selected images — this sidecar is a
    placeholder, not a training-ready caption."""
    angle_txt = cell["angle"].replace("-", " ")
    light_txt = cell["light"].replace("-", " ")
    distance_txt = "close" if cell["distance"] == "close" else "half-body"
    wardrobe_txt = CAPTION_WARDROBE[cell["wardrobe_family"]]
    return (
        f"provisional_generation_caption: adult woman, {distance_txt} framing, "
        f"{angle_txt} angle, {light_txt} lighting, wearing {wardrobe_txt}, "
        "fully clothed, candid phone photo."
    )


# ---------------------------------------------------------------------------
# Step 5.3 — strict manifests from the verified graph
# ---------------------------------------------------------------------------

# Rewritten to keep the safety-exclusion intent of composite-02.yaml's node 5
# in neutral wording that names no look-spec-v2.md §4a banned family (banned
# even in negation, per §4a's own rationale) — see plan Step 5.3.
NODE_5_NEGATIVE_PROMPT = (
    "nudity, exposed breasts, exposed genitals, transparent clothing, broken "
    "clothing, unnatural body proportions, heavy visible makeup, "
    "plastic-looking skin, studio product photograph."
)

# The exact manifest-level fields copied verbatim from the base (composite-02)
# manifest — plan Step 5.3. `models` and `custom_nodes` default to an empty
# list if the base manifest omits them (composite-02 always sets both).
COPIED_MANIFEST_KEYS = (
    "gpu", "image", "price_usd_per_hour", "models", "comfyui", "custom_nodes",
    "avoid_machine_hosts",
)
_OPTIONAL_COPIED_KEYS = frozenset({"models", "custom_nodes", "avoid_machine_hosts"})

# The only fields this task overrides on top of the copied base (plan Step
# 5.3): the 82-minute max_minutes (900 + 10*360 + 300 = 4800 s vs 4920 s) keeps 38% margin over the measured 260 s cold first job (P2R medium 3).
MANIFEST_OVERRIDES = {
    "job_timeout_seconds": 360,
    "readiness_timeout_seconds": 900,
    "max_minutes": 82,
    "container_disk_gb": 60,
    "volume_gb": 0,
}

# The identity-spec canonical reference order (g01, g02, g07) rebinds onto
# these three LoadImage node ids, in that exact order — plan Step 5.3.
REFERENCE_NODE_IDS = ("6", "7", "8")

# Every key this builder is willing to emit onto a manifest — a defensive
# mirror of pod/README.md's documented manifest schema (plan Step 5.3: "each
# emitted manifest has exactly the keys allowed by pod/README.md").
ALLOWED_MANIFEST_KEYS = frozenset({
    "gpu", "image", "template_id", "price_usd_per_hour",
    "readiness_timeout_seconds", "job_timeout_seconds",
    "avoid_machine_hosts", "avoid_machine_ids", "max_placement_attempts",
    "comfyui", "models", "custom_nodes", "workflow", "seed_fields", "jobs",
    "uploads", "max_minutes", "container_disk_gb", "volume_gb",
    "volume_mount_path",
})


def _rebind_workflow(workflow_path: Path, persona: dict) -> dict:
    """Load the verified `klein4b_multiref_api.json` graph, rebind its three
    LoadImage nodes to the persona's identity references (in identity-spec
    order), and freeze the neutral safety-exclusion negative prompt onto node
    5. Every other node (ReferenceLatent chains, EmptyFlux2LatentImage at
    1024x1280, CFGGuider cfg 4, Flux2Scheduler at 50 steps, Euler sampler) is
    preserved exactly as the verified graph defines it."""
    workflow = json.loads(Path(workflow_path).read_text(encoding="utf-8"))
    references = persona["identity"]["references"]
    if len(references) != len(REFERENCE_NODE_IDS):
        raise ExpansionBuildError(
            f"persona.identity.references must have exactly "
            f"{len(REFERENCE_NODE_IDS)} entries to rebind nodes "
            f"{REFERENCE_NODE_IDS}, got {len(references)}"
        )
    persona_id = persona["id"]
    for node_id, reference in zip(REFERENCE_NODE_IDS, references):
        node = workflow.get(node_id)
        if not isinstance(node, dict) or node.get("class_type") != "LoadImage":
            raise ExpansionBuildError(
                f"workflow node {node_id!r} is not a LoadImage node — refusing "
                "to rebind an unverified graph"
            )
        node["inputs"]["image"] = f"{persona_id}/{Path(reference).name}"

    node5 = workflow.get("5")
    if not isinstance(node5, dict) or node5.get("class_type") != "CLIPTextEncode":
        raise ExpansionBuildError(
            "workflow node '5' is not a CLIPTextEncode node — refusing to "
            "freeze the negative prompt onto an unverified graph"
        )
    node5["inputs"]["text"] = NODE_5_NEGATIVE_PROMPT

    node4 = workflow.get("4")
    if not isinstance(node4, dict) or node4.get("class_type") != "CLIPTextEncode":
        raise ExpansionBuildError(
            "workflow node '4' is not a CLIPTextEncode node — refusing to "
            "build per-job prompt substitutions against an unverified graph"
        )
    return workflow


def build_manifests(
    persona_path: Path, base_manifest_path: Path, workflow_path: Path, out_dir: Path,
) -> list[Path]:
    """Build the six strict, ephemeral-pod expansion-02 manifests (Step 5.3).
    Byte-reproducible: no wall-clock, randomness, or filesystem-order
    dependency — the same three input files always produce byte-identical
    output. Does not call the network and does not validate that the
    `_uploads/` staging files exist (that is `require_manifest`'s job at
    validation/run time, not the builder's)."""
    pod = _pod()
    persona_module = _persona_module()
    persona = persona_module.load_persona(Path(persona_path))
    persona_id = persona["id"]

    base_manifest = pod.load_manifest(Path(base_manifest_path))
    workflow = _rebind_workflow(Path(workflow_path), persona)

    allocation = generate_allocation(persona)
    expected_total = SHARD_COUNT * JOBS_PER_SHARD
    if len(allocation) != expected_total:
        raise ExpansionBuildError(
            f"expected {expected_total} allocated cells, got {len(allocation)}"
        )
    groups = _shard_groups(allocation)
    if len(groups) != SHARD_COUNT or any(len(g) != JOBS_PER_SHARD for g in groups):
        raise ExpansionBuildError(
            "allocation does not split evenly into "
            f"{SHARD_COUNT} shards of {JOBS_PER_SHARD} cells each"
        )

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    upload_files = [
        f"_uploads/{persona_id}/{Path(reference).name}"
        for reference in persona["identity"]["references"]
    ]

    paths: list[Path] = []
    for shard_number, cells in enumerate(groups, start=1):
        shard_id = shard_id_for(shard_number)
        manifest: dict[str, Any] = {}
        for key in COPIED_MANIFEST_KEYS:
            if key in base_manifest:
                manifest[key] = copy.deepcopy(base_manifest[key])
            elif key in _OPTIONAL_COPIED_KEYS:
                continue
            else:
                raise ExpansionBuildError(
                    f"base manifest {base_manifest_path} is missing required "
                    f"key {key!r}"
                )
        manifest["workflow"] = copy.deepcopy(workflow)
        manifest["seed_fields"] = ["noise_seed"]
        manifest["uploads"] = [{
            "files": list(upload_files),
            "subfolder": persona_id,
            "type": "input",
            "overwrite": True,
        }]
        manifest.update(MANIFEST_OVERRIDES)
        manifest["jobs"] = [
            {
                "seed": cell["seed"],
                "output_name": f"c001-{cell['cell_id']}",
                "expected_images": 1,
                "substitutions": [
                    {"node_id": "4", "field": "text", "value": build_prompt(persona, cell)},
                ],
            }
            for cell in cells
        ]

        unexpected = sorted(set(manifest) - ALLOWED_MANIFEST_KEYS)
        if unexpected:
            raise ExpansionBuildError(
                f"manifest for {shard_id} carries key(s) outside "
                f"pod/README.md's documented schema: {unexpected}"
            )

        manifest_path = out_dir / f"{persona_id}-{BATCH_LABEL}-{shard_id}.yaml"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8",
        )
        paths.append(manifest_path)

    return paths


# ---------------------------------------------------------------------------
# Step 5.4 — resume and harvest without a pod
# ---------------------------------------------------------------------------


def _shard_run_dir_name(persona_id: str, shard_id: str) -> str:
    return f"{persona_id}-{BATCH_LABEL}-{shard_id}"


def harvest_runs(
    persona_path: Path, allocation_path: Path, run_root: Path, batch_dir: Path,
) -> dict:
    """Validate every finished shard's provenance before copying anything
    (Step 5.4): `run.json.termination_verified is True`, shard identity
    (harvested output ids exactly match the shard's allocated cell ids),
    expected output count, the allocation hash the batch was created from,
    and cost — then append one `pod_runs[]` row per newly harvested shard
    (via `batch_state.record_pod_run`, append-only) and copy provenance JSON
    into `<batch_dir>/pod-runs/<shard_id>/` and images into
    `<batch_dir>/images/` (both ignored/tracked per the design's split — this
    function itself does not gitignore anything, the repo `.gitignore` does).

    Idempotent on an identical re-harvest of an already-recorded shard
    (returns it under `already_harvested`, adds no second cost row). A
    conflicting duplicate — the same `shard_id` with different content — is
    always an error, never a silent overwrite."""
    persona_module = _persona_module()
    gates_module = _gates_module()
    bs = _batch_state_module()

    persona = persona_module.load_persona(Path(persona_path), require_assets=False)
    persona_id = persona["id"]

    allocation_path = Path(allocation_path)
    allocation_doc = json.loads(allocation_path.read_text(encoding="utf-8"))
    allocation = allocation_doc["cells"] if isinstance(allocation_doc, dict) else allocation_doc
    allocation_sha256 = gates_module.sha256_file(allocation_path)

    groups = _shard_groups(allocation)
    run_root = Path(run_root)
    batch_dir = Path(batch_dir)
    batch_dir.mkdir(parents=True, exist_ok=True)
    batch_path = batch_dir / "batch.json"

    if batch_path.is_file():
        batch = json.loads(batch_path.read_text(encoding="utf-8"))
        if batch.get("allocation_sha256") != allocation_sha256:
            raise ExpansionBuildError(
                f"{batch_path} was created from a different allocation "
                f"({batch.get('allocation_sha256')!r} != {allocation_sha256!r}) "
                "— refusing to harvest against a stale batch"
            )
    else:
        cells = [
            {"cell_id": cell["cell_id"], "stratum_id": cell.get("stratum_id")}
            for cell in allocation
        ]
        batch = bs.new_batch(
            batch_id=BATCH_LABEL, persona_id=persona_id,
            allocation_sha256=allocation_sha256, cells=cells,
        )
        _atomic_write_json(batch_path, batch)

    summary: dict[str, list[str]] = {
        "harvested": [], "already_harvested": [], "skipped_not_run": [],
    }

    for shard_number, cells in enumerate(groups, start=1):
        shard_id = shard_id_for(shard_number)
        shard_run_dir = run_root / _shard_run_dir_name(persona_id, shard_id)
        run_json_path = shard_run_dir / "run.json"
        manifest_json_path = shard_run_dir / "manifest.json"

        if not run_json_path.is_file():
            summary["skipped_not_run"].append(shard_id)
            continue

        run_data = json.loads(run_json_path.read_text(encoding="utf-8"))
        if run_data.get("termination_verified") is not True:
            raise ExpansionBuildError(
                f"{shard_id}: run.json termination_verified is not True — "
                "refusing to harvest an unverified pod exit"
            )
        if not manifest_json_path.is_file():
            raise ExpansionBuildError(f"{shard_id}: manifest.json is missing")

        images_doc = json.loads(manifest_json_path.read_text(encoding="utf-8"))
        images = images_doc.get("images") if isinstance(images_doc, dict) else images_doc
        if not isinstance(images, list):
            raise ExpansionBuildError(f"{shard_id}: manifest.json has no images list")

        expected_ids = {f"c001-{cell['cell_id']}" for cell in cells}
        got_ids = {row.get("image_id") for row in images}
        if len(images) != len(cells) or got_ids != expected_ids:
            raise ExpansionBuildError(
                f"{shard_id}: harvested output identity mismatch (expected "
                f"{sorted(expected_ids)}, got {sorted(got_ids)})"
            )

        cost = round(float(run_data.get("estimated_actual_usd") or 0.0), 6)
        cell_ids = sorted(cell["cell_id"] for cell in cells)

        existing = next(
            (row for row in batch.get("pod_runs", []) if row.get("shard_id") == shard_id),
            None,
        )
        if existing is not None:
            if existing.get("cell_ids") == cell_ids and existing.get("cost_usd") == cost:
                summary["already_harvested"].append(shard_id)
                continue
            raise ExpansionBuildError(
                f"{shard_id}: conflicting duplicate harvest — a pod-run row "
                "already exists with different content; pod_runs is "
                "append-only and is never silently overwritten"
            )

        row = {
            "shard_id": shard_id,
            "run_json_path": str(run_json_path),
            "manifest_json_path": str(manifest_json_path),
            "cell_ids": cell_ids,
            "status": "harvested",
            "cost_usd": cost,
        }

        def _record(current_batch: dict, row: dict = row) -> dict:
            return bs.record_pod_run(current_batch, row)

        batch = bs.apply_batch(batch_path, _record)

        provenance_dir = batch_dir / "pod-runs" / shard_id
        provenance_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(run_json_path, provenance_dir / "run.json")
        shutil.copy2(manifest_json_path, provenance_dir / "manifest.json")

        images_dir = batch_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        for image_row in images:
            src = shard_run_dir / image_row["path"]
            if src.is_file():
                shutil.copy2(src, images_dir / image_row["path"])

        summary["harvested"].append(shard_id)

    return summary


# ---------------------------------------------------------------------------
# CLI — `build` (Step 5.5) and `harvest`
# ---------------------------------------------------------------------------


def _write_captions(persona: dict, allocation: list[dict], caption_dir: Path) -> int:
    caption_dir.mkdir(parents=True, exist_ok=True)
    for cell in allocation:
        sidecar = caption_dir / f"{cell['cell_id']}.txt"
        sidecar.write_text(build_caption(persona, cell) + "\n", encoding="utf-8")
    return len(allocation)


def _cli_build(args: argparse.Namespace) -> int:
    persona_module = _persona_module()
    persona = persona_module.load_persona(args.persona)
    persona_id = persona["id"]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    allocation = generate_allocation(persona)
    allocation_path = out_dir / f"{persona_id}-{BATCH_LABEL}-allocation.json"
    _atomic_write_json(allocation_path, {
        "schema": "figment/expansion-allocation@1",
        "persona_id": persona_id,
        "batch_id": BATCH_LABEL,
        "cells": allocation,
    })

    manifest_paths = build_manifests(args.persona, args.base_manifest, args.workflow, out_dir)

    caption_dir = out_dir / f"{persona_id}-{BATCH_LABEL}-captions"
    caption_count = _write_captions(persona, allocation, caption_dir)

    print(
        f"built {len(allocation)} cells in {len(manifest_paths)} shards "
        f"({JOBS_PER_SHARD} jobs each); {caption_count} caption sidecar(s) "
        f"written to {caption_dir}"
    )
    return 0


def _cli_harvest(args: argparse.Namespace) -> int:
    summary = harvest_runs(args.persona, args.allocation, args.run_root, args.batch_dir)
    print(
        f"harvested {len(summary['harvested'])} shard(s); "
        f"already-harvested {len(summary['already_harvested'])}; "
        f"not yet run {len(summary['skipped_not_run'])}"
    )
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="build_expansion_set.py",
        description="Deterministic expansion-02 builder and harvester (P2).",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    build_cmd = sub.add_parser(
        "build",
        help="build the allocation table, six manifests, and caption sidecars (network-free)",
    )
    build_cmd.add_argument("--persona", required=True, type=Path)
    build_cmd.add_argument("--base-manifest", required=True, type=Path)
    build_cmd.add_argument("--workflow", required=True, type=Path)
    build_cmd.add_argument("--out", required=True, type=Path)
    build_cmd.set_defaults(func=_cli_build)

    harvest_cmd = sub.add_parser(
        "harvest",
        help="validate finished pod-run provenance and copy it into the tracked batch layout",
    )
    harvest_cmd.add_argument("--persona", required=True, type=Path)
    harvest_cmd.add_argument("--allocation", required=True, type=Path)
    harvest_cmd.add_argument("--run-root", required=True, type=Path)
    harvest_cmd.add_argument("--batch-dir", required=True, type=Path)
    harvest_cmd.set_defaults(func=_cli_harvest)

    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        return args.func(args)
    except (ExpansionBuildError, ValueError, OSError) as exc:
        print(f"build_expansion_set error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
